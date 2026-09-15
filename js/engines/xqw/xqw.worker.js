"use strict";
/* xqw.worker.js - 内置象棋巫师引擎 Worker 化
 * 根治卡死的重写核心：以前 xqw 的 Search.searchMain 直接跑在主线程，
 * 中残局一算就是几百毫秒到几秒，主线程被占住时点击、心跳 setInterval、
 * EngineBridge 超时全部冻住，看起来就是"点哪都不管用，两秒也不恢复"。
 * 现在 xqw 与象眼/皮卡鱼一样走异步 Worker + seq 协议，主线程永远不阻塞。
 */
importScripts("../../book.js");
importScripts("../../position.js");
importScripts("../../search.js");
importScripts("../../cchess.js");

var pos = null;
var search = null;
var lastSeq = 0;
var searching = false;
var stopPending = false;
var pendingSearch = null;

function ensureInit() {
  if (!pos) {
    pos = new Position();
    search = new Search(pos, 16);
  }
}

function runSearch(d) {
  ensureInit();
  searching = true;
  lastSeq = d.seq || lastSeq;
  var mySeq = lastSeq;
  var movetime = d.movetime || 400;
  var useBook = d.useBook !== false;
  var allowChase = d.allowChase !== false;
  var fen = d.fen;
  // 用 setTimeout 让出消息循环，保证 STOP/新 SEARCH 能插进来
  setTimeout(function () {
    if (stopPending) {
      // 在等待期间被 STOP 掉：直接丢弃，不计算
      stopPending = false;
      searching = false;
      drainPending();
      return;
    }
    var mv = 0;
    try {
      pos.fromFen(fen);
      pos.chaseAllowed = allowChase;
      search.useBook = useBook;
      // 开局库先行（同步但极快，微秒级）
      if (useBook) {
        try { mv = pos.bookMove(); } catch (e) { mv = 0; }
        if (mv > 0) {
          if (!pos.legalMove(mv)) { mv = 0; }
          else {
            if (pos.makeMove(mv)) { pos.undoMakeMove(); }
            else { mv = 0; }
          }
          if (mv > 0) {
            searching = false;
            if (stopPending) { stopPending = false; drainPending(); return; }
            self.postMessage({ type: "BEST_MOVE", move: move2Iccs(mv), seq: mySeq });
            drainPending();
            return;
          }
          mv = 0;
        }
      }
      mv = search.searchMain(LIMIT_DEPTH, movetime);
    } catch (e) {
      searching = false;
      self.postMessage({ type: "ERROR", message: "内置引擎搜索失败: " + (e && e.message || e) });
      drainPending();
      return;
    }
    searching = false;
    if (stopPending) {
      stopPending = false;
      drainPending();
      return;
    }
    var iccs = "";
    try {
      if (mv > 0 && pos.legalMove(mv)) { iccs = move2Iccs(mv); }
    } catch (e2) { iccs = ""; }
    self.postMessage({ type: "BEST_MOVE", move: iccs, seq: mySeq });
    drainPending();
  }, 0);
}

function drainPending() {
  if (pendingSearch && !searching) {
    var q = pendingSearch;
    pendingSearch = null;
    runSearch(q);
  }
}

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.type === "INIT") {
    try {
      ensureInit();
      self.postMessage({ type: "READY" });
      if (pendingSearch && !searching) {
        var q = pendingSearch;
        pendingSearch = null;
        runSearch(q);
      }
    } catch (err) {
      self.postMessage({ type: "ERROR", message: "内置引擎初始化失败: " + err });
    }
  } else if (d.type === "SEARCH") {
    var req = { fen: d.fen, movetime: d.movetime || 400, seq: d.seq, allowChase: d.allowChase, useBook: d.useBook };
    if (searching) {
      pendingSearch = req;
      stopPending = true;
      return;
    }
    if (!pos) { pendingSearch = req; ensureInit(); }
    runSearch(req);
  } else if (d.type === "STOP") {
    pendingSearch = null;
    if (searching) { stopPending = true; }
  }
};
