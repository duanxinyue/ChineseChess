/**
 * pikafish.worker.js - 皮卡鱼(Pikafish)WASM 引擎的 UCI 桥接 Worker
 *
 * 协议(与 eleeye.worker.js 保持一致):
 *   主线程 -> Worker:  { type: "INIT" }
 *                     { type: "SEARCH", fen, movetime, seq }
 *   Worker -> 主线程:  { type: "READY" }
 *                     { type: "INFO",  info }
 *                     { type: "BEST_MOVE", move, seq }
 *                     { type: "ERROR", message }
 *
 * 引擎文件在同目录: pikafish.js / pikafish.wasm / pikafish.data
 */
"use strict";

// 加载皮卡鱼 WASM 胶水(与 worker 同目录)
importScripts('pikafish.js');

var engineModule = null;
var stdoutReady = false;
var searchPending = null;
var stopPending = false;
var engineSearching = false;

function runSearchNow(d) {
  engineSearching = true;
  lastSeq = d.seq || lastSeq;
  try {
    // 判例开关随每次搜索下发: 允许长将长捉=AllowChase, 否则=亚洲规则
    var chase = d.allowChase !== false;
    engineModule.sendCommand("setoption name Repetition Rule value " + (chase ? "AllowChase" : "AsianRule"));
    engineModule.sendCommand("setoption name Draw Rule value None");
    engineModule.sendCommand("setoption name Sixty Move Rule value " + (chase ? "false" : "true"));
    if (d.fen) {
      // 补齐成标准 7 段式 FEN, 兼容 UCI/UCCI 协议
      var fen = d.fen.indexOf(" - ") >= 0 ? d.fen : d.fen + " - - 0 1";
      engineModule.sendCommand("position fen " + fen);
    }
    engineModule.sendCommand("go movetime " + (d.movetime || 500));
  } catch (err) {
    engineSearching = false;
    self.postMessage({ type: "ERROR", message: "皮卡鱼搜索失败: " + err });
  }
}

function drainPending() {
  if (searchPending && engineModule && !engineSearching) {
    var p = searchPending;
    searchPending = null;
    runSearchNow(p);
  }
}

function postOut(line) {
  line = String(line || "").replace(/[\r\n]+$/, "");
  if (!line) {
    return;
  }
  if (line.indexOf("uciok") >= 0) {
    self.postMessage({ type: "READY" });
    drainPending();
  } else if (line.indexOf("bestmove") === 0) {
    engineSearching = false;
    // stop 指令后引擎吐出的第一条 bestmove 属于被打断的旧搜索：吞掉它，
    // 否则它会顶着新搜索的 seq 被主线程当成新着法接受，走出与当前局面
    // 不符的"鬼步"，棋盘从此停在电脑回合一动不动。
    if (stopPending) {
      stopPending = false;
      drainPending();
      return;
    }
    var parts = line.split(/\s+/);
    self.postMessage({ type: "BEST_MOVE", move: parts.length > 1 ? parts[1] : "", seq: lastSeq });
    drainPending();
  } else if (line.indexOf("info ") === 0) {
    self.postMessage({ type: "INFO", info: line });
  }
}

var lastSeq = 0;

self.onmessage = function (e) {
  var data = e.data || {};
  var type = data.type;

  if (type === "INIT") {
    try {
      // 与 pikafish.js 同目录, 通过相对路径加载 wasm 与 nnue 数据包
      var base = self.location.href.substring(0, self.location.href.lastIndexOf("/") + 1);
      var config = {
        locateFile: function (path) {
          return base + path;
        },
        onReceiveStdout: function (line) {
          postOut(line);
        },
        onReceiveStderr: function (line) {
          // 引擎的警告信息忽略
        },
      };
      var ready = Pikafish(config); // returns a Promise, resolves on runtime init
      ready.then(function (mod) {
        engineModule = mod;
        // 哈希加大: 长思考时重复局面缓存更多, 同等时间算得更深
        mod.sendCommand("setoption name Hash value 256");
        mod.sendCommand("uci");
      }).catch(function (err) {
        self.postMessage({ type: "ERROR", message: "皮卡鱼初始化失败: " + err });
      });
    } catch (err) {
      self.postMessage({ type: "ERROR", message: "皮卡鱼加载失败: " + err });
    }
  } else if (type === "SEARCH") {
    var req = { fen: data.fen, movetime: data.movetime || 500, seq: data.seq, allowChase: data.allowChase };
    if (!engineModule) {
      // 引擎还没就绪：把搜索排队，等 uciok/READY 后补执行。
      // 原先直接 return 会丢掉这次搜索，主线程永远等不到 BEST_MOVE，
      // 棋盘 busy 锁死、点哪都没用。
      searchPending = req;
      return;
    }
    if (engineSearching) {
      // 旧 go 还挂着（stop 可能还在路上）：先 stop，等它的 bestmove 被吞掉后补执行。
      searchPending = req;
      stopPending = true;
      try {
        engineModule.sendCommand("stop");
      } catch (err) { /* ignore */ }
      return;
    }
    runSearchNow(req);
  } else if (type === "STOP") {
    // 主线程悔棋/重开/换引擎时取消旧思考：正在跑的 go 用 stop 指令打断（UCI 标准指令）。
    // 只有引擎确实在搜索时才会收到被打断的 bestmove，才需要置 stopPending 吞掉它；
    // 引擎空闲时乱置会把下一次正常搜索的 bestmove 也吞掉，导致棋盘死等。
    searchPending = null;
    if (engineSearching) {
      stopPending = true;
    }
    if (engineModule) {
      try {
        engineModule.sendCommand("stop");
      } catch (err) { /* ignore */ }
    }
  }
};