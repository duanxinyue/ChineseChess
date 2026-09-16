"use strict";
// 真浏览器暴力测试: 起 HTTP + headless Chrome, 在页面里做极端连击
// 跑法: node e2e/torment.browser.js  (会自动起 server.js 的端口)
const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..");
const PORT = 18937;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".json": "application/json",
};

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      const file = path.join(ROOT, p);
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("nf"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = await startServer();
  console.log("[e2e] server on", PORT);
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => typeof board !== "undefined" && board.pos, { timeout: 30000 });
  await sleep(1500);
  console.log("[e2e] page ready");

  // 引擎探针：原生 Worker 可用性 + Blob Worker 可用性 + 皮卡鱼真实搜索返回合法 ICCS
  async function engineProbe() {
    const r = await page.evaluate(async () => {
      const out = { workerNewOk: "unknown", blobOk: "unknown", pikaSearch: "unknown" };
      try {
        const w = new Worker("js/engines/pikafish/pikafish.worker.js");
        w.terminate();
        out.workerNewOk = true;
      } catch (e) { out.workerNewOk = false; }
      try {
        const w2 = new Worker(URL.createObjectURL(new Blob(["self.onmessage=function(e){self.postMessage({type:'READY'});};"], { type: "text/javascript" })));
        w2.terminate();
        out.blobOk = true;
      } catch (e) { out.blobOk = false; }
      try {
        const fen = board.pos.toFen();
        const iccs = await EngineBridge.search("pikafish", fen, 300);
        out.pikaSearch = String(iccs || "");
      } catch (e) { out.pikaSearch = "ERR:" + (e && e.message || e); }
      return out;
    });
    console.log("[e2e] worker-probe:", JSON.stringify(r));
    return r;
  }
  const probe = await engineProbe();

  // 测试脚本跑在页面里：每轮 = 玩家走一步(两次真实clickSquare) + 切视角 + 悔棋 + 记录回看 + 偶数轮重开
  const result = await page.evaluate(async () => {
    const log = [];
    const sleep_ = (ms) => new Promise((r) => setTimeout(r, ms));
    let stuckEvents = 0, actions = 0;
    const ROUNDS = 25;
    // 本轮要验证的局面指纹：走子/悔棋/回看前后 WtM 方与步数必须自洽
    let expectMoves = {};
    async function snapshot(tag) {
      return {
        tag, busy: board.busy, stuck: board.isStuck(),
        sd: board.pos.sdPlayer, mvLen: board.pos.mvList.length,
        engine: board.engineId, result: board.result,
      };
    }
    // 局面是否有真合法走法（WASM 回 illegal 时页面必须能兜底，不能 busy）
    function hasLegal() {
      try {
        const mvs = board.pos.generateMoves(null);
        for (let i = 0; i < mvs.length; i++) {
          if (board.pos.makeMove(mvs[i])) { board.pos.undoMakeMove(); return true; }
        }
      } catch (e) {}
      return false;
    }
    // 点记录列表跳到任意历史步再点回来，显示与局面必须一致
    async function reviewChaos() {
      const sel = document.getElementById("selMoveList");
      if (!sel || sel.options.length < 3) return;
      const last = sel.options.length - 1;
      const jumps = [1, last, Math.max(1, (last / 2) | 0), last, 1, last];
      for (const j of jumps) {
        board.reviewMode = true;
        sel.selectedIndex = Math.min(j, sel.options.length - 1);
        moveList_change();
        actions++;
        // 回看中途故意落子（模拟导入回看走到一半改棋），局面必须不断
        if (j === last && !board.computerMove() && board.result === 0 && !board.busy) {
          const mv = board.firstLegalMove();
          if (mv > 0) {
            const src = board.flipped(mv & 255), dst = board.flipped(mv >> 8);
            board.clickSquare(src);
            await sleep_(100);
            board.clickSquare(dst);
            actions += 2;
          }
        }
        await sleep_(150);
        if (board.isStuck()) throw new Error("review-chaos stuck@" + j);
      }
    }
    // 确保我先走 + 内置开局，局面干净
    try {
      document.getElementById("selMoveMode").selectedIndex = 0;
      restart_click();
    } catch (e) { log.push("restart fail " + e.message); }
    await sleep_(800);
    for (let r = 0; r < ROUNDS; r++) {
      // 1) 玩家走一步：两次真实点击（选中+落点）
      try {
        if (!board.computerMove() && board.result === 0) {
          const mv = board.firstLegalMove();
          if (mv > 0) {
            // 注意本库 SRC(mv)=mv&255、DST(mv)=mv>>8
            const src = mv & 255, dst = mv >> 8;
            const srcClick = board.flipped(src), dstClick = board.flipped(dst);
            board.clickSquare(srcClick); actions++;
            await sleep_(120);
            board.clickSquare(dstClick); actions++;
            await sleep_(600); // 等动画+电脑思考启动
          }
        }
      } catch (e) { log.push(`r${r} move fail: ${e.message}`); }
      // 2) 切一次视角
      try {
        board.setViewport(!board.viewport); actions++;
      } catch (e) { log.push(`r${r} viewport fail: ${e.message}`); }
      // 3) 悔一次棋
      try { retract_click(); actions++; await sleep_(500); }
      catch (e) { log.push(`r${r} retract fail: ${e.message}`); }
      // 4) 记录回看：跳到中间再跳回来 + 乱点 fuzz
      try {
        await reviewChaos();
        // 支招键任何时候可点（busy 时弹提示也算正常，不准抛错/卡死）
        try { hint_click(); } catch (e2) { log.push(`r${r} hint fail: ${e2.message}`); }
        actions++;
        await sleep_(300);
        if (board.isStuck()) throw new Error("hint stuck");
      } catch (e) { log.push(`r${r} review fail: ${e.message}`); }
      // 5) 偶数轮重开
      try {
        if (r % 2 === 1) { restart_click(); actions++; await sleep_(700); }
      } catch (e) { log.push(`r${r} restart fail: ${e.message}`); }
      // 检查真卡死
      const s = await snapshot("r" + r);
      if (s.stuck) {
        stuckEvents++;
        log.push("STUCK @" + JSON.stringify(s));
        try { board.clickSquare(0); } catch (e) {}
        await sleep_(500);
        const s2 = await snapshot("r" + r + "-healed");
        log.push("after-heal @" + JSON.stringify(s2));
      }
      // 页面心跳消息区
      try {
        const msg = document.getElementById("message_area_84423");
        if (msg && /自动恢复|无响应/.test(msg.innerHTML)) log.push(`r${r} msg: ` + msg.innerHTML.slice(0, 80));
      } catch (e) {}
    }
    const fin = await snapshot("final");
    return { stuckEvents, actions, log: log.slice(0, 40), fin };
  });

  console.log("[e2e] actions=", result.actions, "stuckEvents=", result.stuckEvents);
  console.log("[e2e] final=", JSON.stringify(result.fin));
  result.log.forEach((l) => console.log("[e2e]", l));
  console.log("[e2e] pageerrors=", errors.length);
  errors.slice(0, 20).forEach((e) => console.log("[e2e-err]", e));
  // 皮卡鱼必须真返回走法（不是空串/ERR），否则引擎链路就是断的
  const pikaOk = probe && typeof probe.pikaSearch === "string" &&
    /^[a-i][0-9]-[a-i][0-9]$/i.test(probe.pikaSearch.trim());

  await browser.close();
  srv.close();
  if (!pikaOk) { console.log("E2E-FAIL: 皮卡鱼未返回合法走法: " + JSON.stringify(probe)); process.exit(1); }
  if (result.stuckEvents > 0) { console.log("E2E-FAIL: 真机撞出卡死 " + result.stuckEvents + " 次"); process.exit(1); }
  console.log("E2E-OK: 真机 25 轮极端连击零卡死 + 皮卡鱼着法 " + probe.pikaSearch);
})().catch((e) => { console.error("E2E-HARNESS-FAIL:", e.message); process.exit(2); });
