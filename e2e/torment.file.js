"use strict";
// file:// 双击场景真机复刻: 用 --allow-file-access-from-files 起 Chrome,
// 直接 file:// 打开 index.html, 走 Blob Worker 降级链路
// 跑法: node e2e/torment.file.js
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    protocolTimeout: 300000,
    args: ["--no-sandbox", "--disable-dev-shm-usage",
      "--allow-file-access-from-files",
      "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  const fileUrl = "file:///" + ROOT.replace(/\\/g, "/") + "/index.html";
  console.log("[file] goto", fileUrl);
  // file:// 笨办法：不一次 evaluate 跑 10 步（主线程冻住会拖死 CDP），
  // 而是 Node 侧一步一步驱动，每步都带超时，快照定位。
  async function step(cmd, timeoutMs) {
    try {
      return await Promise.race([
        page.evaluate(cmd),
        sleep(timeoutMs || 30000).then(() => ({ __timeout: true })),
      ]);
    } catch (e) {
      return { __err: String((e && e.message) || e).slice(0, 160) };
    }
  }
  await page.goto(fileUrl, { waitUntil: "load", timeout: 120000 });
  // file:// 下 6MB bundle 解析 + WASM 初始化慢；defer 脚本全部执行完才有 board
  await page.waitForFunction(() => typeof window.board !== "undefined" && window.board.pos, { timeout: 120000 });
  await sleep(8000);
  console.log("[file] page ready");

  const logs = [];
  let stuck = 0, actions = 0;
  async function snap() {
    return step(() => ({
      busy: board.busy, stuck: board.isStuck(), engine: board.engineId,
      mode: (typeof EngineBridge !== "undefined" && EngineBridge.mode(board.engineId)) || "none",
      mvLen: board.pos.mvList.length, sd: board.pos.sdPlayer,
      think: board.thinking.style.visibility,
      msg: (document.getElementById("message_area_84423") || {}).innerHTML || "",
    }), 15000);
  }
  logs.push("init " + JSON.stringify(await snap()));
  await step(() => { try { restart_click(); } catch (e) {} }, 15000);
  actions++;
  await sleep(1500);
  for (let r = 0; r < 10; r++) {
    // 玩家走一步（两次点击分开驱动，避免单次 evaluate 里 sleep 拖死 CDP）
    await step(() => {
      if (!board.computerMove() && board.result === 0 && !board.busy) {
        const mv = board.firstLegalMove();
        if (mv > 0) board.clickSquare(board.flipped(mv >> 8));
      }
    }, 15000);
    actions++;
    await sleep(400);
    await step(() => {
      if (!board.computerMove() && board.result === 0 && !board.busy && board.sqSelected) {
        const mv = board.firstLegalMove();
        if (mv > 0) board.clickSquare(board.flipped(mv & 255));
      }
    }, 15000);
    actions++;
    // 等电脑走完：轮询快照而不是在页面里 while-sleep（冻住也能看到快照停在哪）
    let s = null;
    for (let w = 0; w < 40; w++) {
      await sleep(1000);
      s = await snap();
      if (!s || s.__timeout || s.__err) break;
      if (!s.busy && !board.computerMove) break;
      if (!s.busy) {
        const turn = await step(() => board.pos.sdPlayer + "/" + board.computer, 10000);
        if (turn && !turn.__timeout && !turn.__err) break;
      }
      if (s && s.busy === false && s.think === "hidden") break;
    }
    s = await snap();
    logs.push(`r${r} ` + JSON.stringify(s));
    if (s && s.stuck) {
      stuck++;
      await step(() => { try { board.clickSquare(0); } catch (e) {} }, 15000);
    }
    if (r === 4) {
      await step(() => {
        try {
          const sel = document.getElementById("selEngine");
          sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
          engine_change();
        } catch (e) {}
      }, 20000);
      actions++;
      await sleep(2000);
      await step(() => { try { retract_click(); } catch (e) {} }, 15000);
      actions++;
      await sleep(1000);
    }
  }
  console.log("[file] actions=", actions, "stuck=", stuck);
  logs.forEach((l) => console.log("[file]", l));
  console.log("[file] pageerrors=", errors.length);
  errors.slice(0, 10).forEach((e) => console.log("[file-err]", e));
  await browser.close();
  if (stuck > 0) { console.log("FILE-FAIL"); process.exit(1); }
  console.log("FILE-OK: file:// 双击 10 步零卡死");
})().catch((e) => { console.error("FILE-HARNESS-FAIL:", e.message); process.exit(2); });
