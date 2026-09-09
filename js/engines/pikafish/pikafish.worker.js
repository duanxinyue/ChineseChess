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

function postOut(line) {
  line = String(line || "").replace(/[\r\n]+$/, "");
  if (!line) {
    return;
  }
  if (line.indexOf("uciok") >= 0) {
    self.postMessage({ type: "READY" });
  } else if (line.indexOf("bestmove") === 0) {
    var parts = line.split(/\s+/);
    self.postMessage({ type: "BEST_MOVE", move: parts.length > 1 ? parts[1] : "", seq: lastSeq });
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
    if (!engineModule) {
      return;
    }
    lastSeq = data.seq;
    try {
      // 判例开关随每次搜索下发: 允许长将长捉=AllowChase, 否则=亚洲规则
      var chase = data.allowChase !== false;
      engineModule.sendCommand("setoption name Repetition Rule value " + (chase ? "AllowChase" : "AsianRule"));
      engineModule.sendCommand("setoption name Draw Rule value None");
      engineModule.sendCommand("setoption name Sixty Move Rule value " + (chase ? "false" : "true"));
      if (data.fen) {
        // 补齐成标准 7 段式 FEN, 兼容 UCI/UCCI 协议
        var fen = data.fen.indexOf(" - ") >= 0 ? data.fen : data.fen + " - - 0 1";
        engineModule.sendCommand("position fen " + fen);
      }
      engineModule.sendCommand("go movetime " + (data.movetime || 500));
    } catch (err) {
      self.postMessage({ type: "ERROR", message: "皮卡鱼搜索失败: " + err });
    }
  }
};