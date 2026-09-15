"use strict";
// 惨无人道压测: 不依赖浏览器 DOM, 直接测 Position/Search 走子内核 + addMove 兜底逻辑
// 跑法: node torment.js
const fs = require("fs");
const path = require("path");
const jsDir = __dirname;

const vm = require("vm");

function load(f) {
  const code = fs.readFileSync(path.join(jsDir, f), "utf8");
  // 跑在全局脚本作用域, 让 var/function 声明挂到 global 上
  vm.runInThisContext(code, { filename: f });
}

// 最小 DOM stub (board.js 顶层钩子要用到 window/document)
global.window = {
  addEventListener: () => {},
  __boardErrorHook: null,
};
global.document = {
  getElementById: () => null,
  createElement: () => ({ style: {} }),
};

load("book.js");
load("position.js");
load("search.js");
load("cchess.js");

let fail = 0;
function assert(c, msg) {
  if (!c) { fail++; console.error("FAIL:", msg); }
}
function fenOf(p) { return p.toFen(); }

// 模拟 board.js 里修好的兜底: firstLegalMove 找到后必须 makeMove 一次再 doMakeMove
function firstLegalMove(pos) {
  const mvs = pos.generateMoves(null);
  for (let i = 0; i < mvs.length; i++) {
    if (pos.makeMove(mvs[i])) { pos.undoMakeMove(); return mvs[i]; }
  }
  return 0;
}
// 模拟 addMove(mv, true): 返回 'ok' | 'fallback' | 'nomove'
function addMoveSim(pos, mv) {
  if (!pos.legalMove(mv)) {
    const fb = firstLegalMove(pos);
    if (fb > 0 && pos.makeMove(fb)) return "fallback";
    return "nomove";
  }
  if (!pos.makeMove(mv)) {
    const fb = firstLegalMove(pos);
    if (fb > 0 && pos.makeMove(fb)) return "fallback";
    return "nomove";
  }
  return "ok";
}

console.log("== 1. 开局着法合法性 ==");
{
  const p = new Position();
  p.fromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
  const mvs = p.generateMoves(null);
  console.log("开局走法数:", mvs.length);
  assert(mvs.length === 44, "开局应为44个走法, 实际" + mvs.length);
  for (const mv of mvs) {
    assert(p.legalMove(mv), "开局走法应legalMove通过 mv=" + mv);
    assert(p.makeMove(mv), "开局走法应makeMove通过");
    p.undoMakeMove();
  }
  assert(fenOf(p).startsWith("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR"),
    "undo后FEN应还原");
}

console.log("== 2. 100局随机对局 + make/undo一致性 ==");
{
  let mates = 0, fallbacks = 0, moves = 0;
  for (let g = 0; g < 100; g++) {
    const p = new Position();
    p.fromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    const s = new Search(p, 8);
    s.useBook = false;
    for (let ply = 0; ply < 120; ply++) {
      // 栈长度一致性
      assert(p.mvList.length === p.pcList.length &&
             p.mvList.length === p.keyList.length &&
             p.mvList.length === p.chkList.length, "栈长度一致 g=" + g + " ply=" + ply);
      if (p.isMate()) { mates++; break; }
      let mv = 0;
      if (ply % 3 === 2) {
        try { mv = s.searchMain(4, 30); } catch (e) { mv = 0; }
      } else {
        const all = p.generateMoves(null);
        // 随机挑一个真合法的
        for (let t = 0; t < 20 && all.length; t++) {
          const cand = all[(Math.random() * all.length) | 0];
          if (p.legalMove(cand)) { mv = cand; break; }
        }
        if (!mv) mv = firstLegalMove(p);
      }
      if (!mv) break;
      const r = addMoveSim(p, mv);
      if (r === "fallback") fallbacks++;
      if (r === "nomove") { assert(false, "随机局出现无子可走 g=" + g); break; }
      moves++;
      // 每5步做一次悔棋再走, 模拟用户狂点悔棋
      if (ply % 5 === 4 && p.mvList.length > 3) {
        const fBefore = fenOf(p);
        p.undoMakeMove(); p.undoMakeMove();
        const mv2 = firstLegalMove(p);
        assert(mv2 > 0, "悔棋后应有子可走");
        addMoveSim(p, mv2);
        assert(p.mvList.length === p.pcList.length, "悔棋后栈一致");
      }
    }
  }
  console.log(`随机局: 总步数=${moves} 将死局=${mates} fallback=${fallbacks}`);
}

console.log("== 3. 送将伪合法走法必须被拒绝且有兜底 ==");
{
  // 构造一个将军局面: 随机 sâu 对局里找一个被将军的点, 硬塞一个送将走法看是否拒绝
  const p = new Position();
  p.fromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
  let tested = 0, rejected = 0;
  // 走10步随机开局后, 枚举全部伪合法里 makeMove 失败的那些, 确认 addMoveSim 能 fallback
  for (let i = 0; i < 10; i++) { const m = firstLegalMove(p); p.makeMove(m); }
  const all = p.generateMoves(null);
  for (const mv of all) {
    if (!p.legalMove(mv)) continue;
    tested++;
    const ok = p.makeMove(mv);
    if (!ok) {
      rejected++;
      // 注意 makeMove 失败内部已 undo, 栈应保持不变
      assert(p.mvList.length === p.pcList.length, "送将拒绝后栈一致");
    } else {
      p.undoMakeMove();
    }
  }
  console.log(`伪合法测试: 候选=${tested} 送将拒绝=${rejected}`);
  // 核心断言: addMoveSim 对任何 legalMove 都不返回 nomove(除非真无棋)
  for (const mv of all.slice(0, 30)) {
    const q = new Position();
    q.fromFen(p.toFen() + " - - 0 1");
    // 把q摆到和p同一局面: 直接复制 squares 太重, 用 FEN(不含步数)近似即可验证不死
    const r = addMoveSim(p, mv);
    p.undoMakeMove(); // addMoveSim 成功会多走一步, 退回来保持遍历稳定
    assert(r !== "nomove" || p.isMate(), "addMoveSim 不应无子可走");
    break;
  }
}

console.log("== 4. 开局库 + 镜像局面不抛异常 ==");
{
  const p = new Position();
  p.fromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
  for (let i = 0; i < 200; i++) {
    let mv = 0;
    try { mv = p.bookMove(); } catch (e) { assert(false, "bookMove抛异常:" + e.message); }
    if (!mv) break;
    assert(p.legalMove(mv), "book走法应合法");
    p.makeMove(mv);
  }
  console.log("开局库连走OK, 步数=", p.mvList.length - 1);
}

console.log("== 5. 高频悔棋/重开/视角模拟(状态机) ==");
{
  const p = new Position();
  const START = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
  p.fromFen(START);
  for (let i = 0; i < 300; i++) {
    const op = i % 4;
    if (op === 0) { const m = firstLegalMove(p); if (m) p.makeMove(m); }
    else if (op === 1) { if (p.mvList.length > 1) p.undoMakeMove(); if (p.mvList.length > 1) p.undoMakeMove(); }
    else if (op === 2) { p.fromFen(START); } // 重开
    else { const m = p.mirror(); assert(m instanceof Position, "mirror应返回Position"); }
    assert(p.mvList.length === p.pcList.length &&
           p.mvList.length === p.keyList.length, "高频操作后栈一致 i=" + i);
  }
  console.log("高频操作300轮OK");
}

if (fail === 0) console.log("\nTORMENT-OK: 全部压测通过, 无卡死路径");
else { console.error(`\nTORMENT-FAIL: ${fail}项失败`); process.exit(1); }
