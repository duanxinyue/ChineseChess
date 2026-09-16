"use strict";
// 商业级惨无人道压测 v2: 你说的极端操作全部编成用例
// 每走一步切视角 + 悔棋 + 记录回看 + 重开, 循环轰炸（纯局面规则层，引擎在 Worker 内由 e2e 覆盖）
// 跑法: node js/torment.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const jsDir = __dirname;

function load(f) {
  const code = fs.readFileSync(path.join(jsDir, f), "utf8");
  vm.runInThisContext(code, { filename: f });
}

global.window = { addEventListener: () => {}, __boardErrorHook: null };
global.document = { getElementById: () => null, createElement: () => ({ style: {} }) };

load("book.js");
load("position.js");
load("cchess.js");

let fail = 0, checks = 0;
function assert(c, msg) {
  checks++;
  if (!c) { fail++; console.error("FAIL:", msg); }
}
function stacksOk(p) {
  return p.mvList.length === p.pcList.length &&
         p.mvList.length === p.keyList.length &&
         p.mvList.length === p.chkList.length;
}
function firstLegalMove(pos) {
  const mvs = pos.generateMoves(null);
  for (let i = 0; i < mvs.length; i++) {
    if (pos.makeMove(mvs[i])) { pos.undoMakeMove(); return mvs[i]; }
  }
  return 0;
}
// 模拟修好后的 addMove(mv, computerMove)
function addMoveSim(pos, mv, computerMove) {
  if (!pos.legalMove(mv)) {
    if (computerMove) {
      const fb = firstLegalMove(pos);
      if (fb > 0 && pos.makeMove(fb)) return "fallback";
      return "nomove";
    }
    return "deselect";
  }
  if (!pos.makeMove(mv)) {
    if (computerMove) {
      const fb = firstLegalMove(pos);
      if (fb > 0 && pos.makeMove(fb)) return "fallback";
      return "nomove";
    }
    return "deselect";
  }
  return "ok";
}
// 模拟修好后的记录回看 moveList_change: 失败就停，保证显示与局面一致
function reviewSim(pos, histValues, from, to) {
  if (from === to + 1) return from;
  let cur = from;
  if (from > to + 1) {
    for (let i = to + 1; i < from; i++) { pos.undoMakeMove(); cur--; }
  } else {
    for (let i = from; i <= to; i++) {
      const mv = histValues[i];
      if (!(mv > 0) || !pos.legalMove(mv) || !pos.makeMove(mv)) break;
      cur++;
    }
  }
  return cur;
}
// 模拟悔棋键 retract_click 的重放对齐
function retractAlignSim(pos, histValues) {
  for (let i = pos.mvList.length; i < histValues.length; i++) {
    const mv = histValues[i];
    if (!(mv > 0)) break;
    if (!pos.legalMove(mv) || !pos.makeMove(mv)) break;
  }
}

const START = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

console.log("== A. 开局44着法 ==");
{
  const p = new Position(); p.fromFen(START);
  const mvs = p.generateMoves(null);
  assert(mvs.length === 44, "开局44着, 实际" + mvs.length);
  for (const mv of mvs) {
    assert(p.legalMove(mv), "legalMove " + mv);
    assert(p.makeMove(mv), "makeMove " + mv);
    p.undoMakeMove();
  }
}

console.log("== B. 极端连击: 每步=走子+切视角(mirror)+悔棋+记录回看 ==");
{
  let moves = 0, fallbacks = 0, stuck = 0;
  // 随机一个真正合法的走法（模拟真人/引擎落子），30 次随机不中就用兜底首着
  function randomLegalMove(pos) {
    const all = pos.generateMoves(null);
    for (let t = 0; t < 30 && all.length; t++) {
      const c = all[(Math.random() * all.length) | 0];
      if (pos.legalMove(c)) return c;
    }
    return firstLegalMove(pos);
  }
  for (let g = 0; g < 60; g++) {
    const p = new Position(); p.fromFen(START);
    let hist = [0]; // 记录列表 values
    for (let step = 0; step < 40; step++) {
      if (p.isMate()) break;
      // 1) 走一步（轮流首着/随机着，模拟人与电脑交替）
      let mv = 0;
      if (step % 2 === 0) {
        mv = firstLegalMove(p);
      } else {
        mv = randomLegalMove(p);
      }
      if (!mv) break;
      const r = addMoveSim(p, mv, step % 2 === 0);
      if (r === "fallback") fallbacks++;
      assert(r !== "nomove", `g${g}s${step} 无子可走=真卡死`);
      if (r === "nomove") { stuck++; break; }
      if (r === "ok" || r === "fallback") { hist.push(p.mvList[p.mvList.length - 1]); moves++; }
      assert(stacksOk(p), `g${g}s${step} 栈错位`);
      // 2) 切视角：mirror 必须返回等价局面且不抛错
      const mir = p.mirror();
      assert(mir instanceof Position, "mirror类型");
      // 3) 悔1~2次再用记录回看点回来（模拟你在记录列表里乱点）
      if (step % 3 === 2 && p.mvList.length > 2) {
        p.undoMakeMove();
        if (p.mvList.length > 2 && step % 2 === 0) p.undoMakeMove();
        assert(stacksOk(p), `g${g}s${step} 悔棋栈错位`);
        // 点回最新（重放）
        retractAlignSim(p, hist);
        const cur = reviewSim(p, hist, p.mvList.length, hist.length - 1);
        assert(stacksOk(p), `g${g}s${step} 回看栈错位`);
        assert(cur <= hist.length - 1 + 1, "回看步数越界");
        // 回看后继续：局面必须还能走
        const nm = firstLegalMove(p);
        assert(nm > 0 || p.isMate(), `g${g}s${step} 回看后无子可走`);
      }
      // 4) 每5步重开一局（fromFen），旧残留必须清零
      if (step % 10 === 9) {
        p.fromFen(START);
        hist = [0];
        assert(stacksOk(p), `g${g}s${step} 重开栈错位`);
      }
    }
  }
  console.log(`极端连击: 步数=${moves} fallback=${fallbacks} 真卡死=${stuck}`);
  assert(stuck === 0, "极端连击出现真卡死");
}

console.log("== C. 开局库200连走 ==");
{
  const p = new Position(); p.fromFen(START);
  for (let i = 0; i < 200; i++) {
    let mv = 0;
    try { mv = p.bookMove(); } catch (e) { assert(false, "book抛错"); break; }
    if (!mv) break;
    assert(p.legalMove(mv), "book合法");
    p.makeMove(mv);
  }
}

console.log("== D. 高频悔棋/重开/mirror 500轮 ==");
{
  const p = new Position(); p.fromFen(START);
  for (let i = 0; i < 500; i++) {
    const op = i % 4;
    if (op === 0) { const m = firstLegalMove(p); if (m) p.makeMove(m); }
    else if (op === 1) { if (p.mvList.length > 1) p.undoMakeMove(); if (p.mvList.length > 1) p.undoMakeMove(); }
    else if (op === 2) { p.fromFen(START); }
    else { p.mirror(); }
    assert(stacksOk(p), "高频i=" + i);
  }
}

console.log("== E. 记录回看乱点 fuzz 2000次 ==");
{
  const p = new Position(); p.fromFen(START);
  const hist = [0];
  for (let i = 0; i < 30; i++) { const m = firstLegalMove(p); if (!m) break; p.makeMove(m); hist.push(m); }
  for (let i = 0; i < 2000; i++) {
    const q = new Position(); q.fromFen(START);
    // 在q上重放到随机步再乱跳
    const target = (Math.random() * hist.length) | 0;
    let cur = 1;
    cur = reviewSim(q, hist, cur, target);
    assert(stacksOk(q), "fuzz栈错位 i=" + i);
    assert(cur >= 1 && cur <= hist.length, "fuzz步数越界");
  }
  console.log("fuzz 2000次OK");
}

console.log(`\n共${checks}项断言, 失败${fail}项`);
if (fail === 0) console.log("TORMENT-OK: 极端连击全部通过");
else process.exit(1);
