/**
 * eleeye.worker.js - 象眼 WASM 引擎 Web Worker 算力桥接器
 * 严格连接真实象眼 WASM 实例与 UCCI 协议，零伪造数据
 *
 * @engine ElephantEye (象眼中国象棋引擎)
 * @author 黄晨 (Morning Yellow)
 * @license GNU Lesser General Public License v2.1 (LGPL v2.1)
 * @see third-party/eleeye
 */

var wasmModule = null;
var lastSeq = 0;
var pendingSearch = null;
var stopPending = false;

// 使用 Emscripten 工厂模式异步初始化象眼 WASM 模块
try {
  importScripts('eleeye.js');
  if (typeof createEleeyeModule === 'function') {
    createEleeyeModule({
      noInitialRun: true,
      print: function (text) {
        if (!text) return;
        handleEngineStdoutLine(text);
      },
      printErr: function (text) {
        console.warn('[ElephantEye WASM Engine Log]', text);
      }
    }).then(function (mod) {
      wasmModule = mod;
      if (typeof wasmModule.ccall === 'function') {
        wasmModule.ccall('init_eleeye_engine', null, [], []);
      }
      // UCCI 握手: 必须先发 ucci, 引擎才响应 position/go
      sendUCCICmdToEngine('ucci');
      self.postMessage({ type: 'READY' });
      // 就绪后补执行排队的搜索
      if (pendingSearch) {
        var p0 = pendingSearch;
        pendingSearch = null;
        executeSearch(p0.fen, p0.movetime);
      }
    }).catch(function (err) {
      console.error('象眼 WASM 模块实例化失败:', err);
    });
  }
} catch (e) {
  console.error('加载 eleeye.js 胶水代码失败:', e);
}

self.onmessage = function (e) {
  const data = e.data || {};
  const type = data.type;

  if (type === 'INIT') {
    if (wasmModule) {
      self.postMessage({ type: 'READY' });
    }
  } else if (type === 'SEARCH') {
    const fen = data.fen;
    const movetime = data.movetime || 5000;
    lastSeq = data.seq || lastSeq;

    // 未就绪时排队：READY 后补执行，不丢搜索（丢了主线程就永远等不到 BEST_MOVE）
    if (!wasmModule) {
      pendingSearch = { fen: fen, movetime: movetime, seq: lastSeq };
      return;
    }
    executeSearch(fen, movetime);
  } else if (type === 'STOP') {
    // 主线程换引擎/悔棋/重开/看门狗兜底时取消旧思考：
    // 正在跑的 go 用 stop 指令打断（UCCI 标准指令）。
    // 置 stopPending，吞掉引擎被打断后吐出的那条 bestmove（见 handleEngineStdoutLine）。
    pendingSearch = null;
    stopPending = true;
    sendUCCICmdToEngine('stop');
  }
};

// 向 WASM 象眼引擎发送 UCCI 指令
function sendUCCICmdToEngine(cmd) {
  if (wasmModule && typeof wasmModule.ccall === 'function') {
    try {
      wasmModule.ccall('execute_ucci_command', null, ['string'], [cmd]);
    } catch (e) {
      console.error('发送 UCCI 指令到 WASM 引擎失败:', e);
    }
  }
}

function executeSearch(fen, movetime) {
  sendUCCICmdToEngine(`position fen ${fen}`);
  sendUCCICmdToEngine(`go movetime ${movetime}`);
}

/**
 * 监听并解析象眼引擎标准输出 stdout 每一行的 UCCI 字符串
 */
var currentSearchStats = null;
var maxSearchDepth = 0;

function handleEngineStdoutLine(line) {
  if (!line) return;
  line = line.trim();

  // 1. 解析 UCCI 实时搜索状态 info 消息
  if (line.startsWith('info')) {
    const info = parseUcciInfoLine(line);
    if (info) {
      if (!currentSearchStats) {
        currentSearchStats = { depth: '-', nodes: '-', nps: '-', time: '-', score: null };
      }
      if (info.depth !== undefined) {
        maxSearchDepth = Math.max(maxSearchDepth, info.depth);
        currentSearchStats.depth = maxSearchDepth;
      }
      if (info.nodes !== undefined) currentSearchStats.nodes = info.nodes;
      if (info.nps !== undefined) currentSearchStats.nps = info.nps;
      if (info.time !== undefined) currentSearchStats.time = info.time;
      if (info.score !== undefined) currentSearchStats.score = info.score;

      self.postMessage({
        type: 'INFO',
        info: info
      });
    }
  }
  // 2. 解析引擎最终决策 bestmove 消息
  else if (line.startsWith('bestmove')) {
    // stop 指令后引擎吐出的第一条 bestmove 属于被打断的旧搜索：
    // 必须吞掉，否则它会顶着新搜索的 seq 被主线程当成新着法接受，污染新局面。
    if (stopPending) {
      stopPending = false;
      currentSearchStats = null;
      maxSearchDepth = 0;
      return;
    }
    const parts = line.split(/\s+/);
    const bestMove = parts[1];
    if (!currentSearchStats) {
      currentSearchStats = { depth: '-', nodes: '-', nps: '-', time: '-', score: null };
    }
    if (maxSearchDepth > 0) {
      currentSearchStats.depth = maxSearchDepth;
    }
    self.postMessage({
      type: 'BEST_MOVE',
      move: bestMove,
      seq: lastSeq,
      info: currentSearchStats
    });
    currentSearchStats = null;
    maxSearchDepth = 0;
  }
}

/**
 * 解析 UCCI info 文本流
 * 例如: "info depth 10 score 120 time 1500 nodes 350000 pv h2e2..."
 */
function parseUcciInfoLine(line) {
  const tokens = line.split(/\s+/);
  const result = {};

  for (let i = 1; i < tokens.length - 1; i++) {
    const key = tokens[i];
    const val = tokens[i + 1];

    if (key === 'depth') result.depth = parseInt(val, 10);
    else if (key === 'score') result.score = parseInt(val, 10);
    else if (key === 'time') result.time = parseInt(val, 10);
    else if (key === 'nodes') result.nodes = parseInt(val, 10);
    else if (key === 'nps') result.nps = parseInt(val, 10);
  }

  if (result.nodes !== undefined && result.time !== undefined && result.time > 0 && result.nps === undefined) {
    result.nps = Math.round((result.nodes * 1000) / result.time);
  }

  return (Object.keys(result).length > 0) ? result : null;
}
