/*
engine.js - 多引擎切换桥接层

可选引擎:
  "xqw"      象棋巫师(XQWLight, 内置 JS 引擎, 同步搜索)
  "eleeye"   象眼(ElephantEye, WASM, UCCI 协议, Worker 后台搜索)
  "pikafish" 皮卡鱼(Pikafish, WASM, UCI 协议, Worker 后台搜索)

Worker 双通道:
  * 原生 Worker(file 页面在 http(s) 下可用, 直接加载 js/engines/ 下的引擎文件)
  * Blob Worker(在 file:// 或收紧的 WebView 里, 原生 Worker 被浏览器禁止时自动降级,
    引擎 JS / WASM / 权重全部以 base64 内嵌, 再经 wasmBinary / getPreloadedPackage /
    instantiateWasm 注入, 完全绕开文件访问)

对外接口:
  EngineBridge.supported(id) -> bool
  EngineBridge.displayName(id) -> string
  EngineBridge.load(id) -> Promise
  EngineBridge.search(id, fen, movetime) -> Promise<iccsMoveString>
  EngineBridge.unload(id)
*/
"use strict";

var ENGINE_LIST = [
  { id: "xqw", name: "象棋巫师（内置）", worker: "js/engines/xqw/xqw.worker.js?v=1" },
  { id: "eleeye", name: "象眼 ElephantEye（WASM）", wasm: true,
    worker: "js/engines/eleeye/eleeye.worker.js?v=13",
    bundle: "js/engines/eleeye/eleeye-bundle.js", bundleGlobal: "ELEEYE_BUNDLE" },
  { id: "pikafish", name: "皮卡鱼 Pikafish（WASM）", wasm: true,
    worker: "js/engines/pikafish/pikafish.worker.js?v=14",
    bundle: "js/engines/pikafish/pikafish-bundle.js", bundleGlobal: "PIKAFISH_BUNDLE" }
];
var FEN_EXTRA = " - - 0 1";

function engineInfo(id) {
  for (var i = 0; i < ENGINE_LIST.length; i++) {
    if (ENGINE_LIST[i].id === id) {
      return ENGINE_LIST[i];
    }
  }
  return null;
}

// 按引擎生成自包含的 Blob Worker 源码(无任何外部文件依赖)
function buildBlobWorkerSource(id, bundle) {
  var b64 = function (s) { return JSON.stringify(s); };
  var js = function (s) { return JSON.stringify(s); };
  if (id === "pikafish") {
    return [
      "var WASM_B64=" + b64(bundle.wasm) + ";",
      "var DATA_B64=" + b64(bundle.data) + ";",
      "var ENGINE_SRC=" + js(bundle.js) + ";",
      "function b64ToU8(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}",
      "function postErr(m){self.postMessage({type:'ERROR',message:m});}",
      "var engine=null,lastSeq=0,pendingSearch=null,stopPending=false,engineSearching=false;",
      "function runSearch(d){if(!engine||!d||!d.fen){return;}engineSearching=true;lastSeq=d.seq||lastSeq;",
      " try{var fen=(d.fen.indexOf(' - ')<0)?d.fen+' - - 0 1':d.fen;",
      "  engine.sendCommand('setoption name Repetition Rule value '+(d.allowChase===false?'AsianRule':'AllowChase'));",
      "  engine.sendCommand('setoption name Draw Rule value None');",
      "  engine.sendCommand('setoption name Sixty Move Rule value '+(d.allowChase===false?'true':'false'));",
      "  engine.sendCommand('position fen '+fen);engine.sendCommand('go movetime '+(d.movetime||500));}",
      " catch(err){engineSearching=false;postErr('皮卡鱼搜索失败: '+err);}}",
      "function drainPending(){if(pendingSearch&&engine&&!engineSearching){var q=pendingSearch;pendingSearch=null;runSearch(q);}}",
      "function onOut(line){line=String(line||'').replace(/[\\r\\n]+$/,'');if(!line)return;",
      " if(line.indexOf('uciok')>=0){self.postMessage({type:'READY'});drainPending();}",
      " else if(line.indexOf('bestmove')===0){engineSearching=false;",
      "  if(stopPending){stopPending=false;drainPending();return;}",
      "  var p=line.split(/\\s+/);self.postMessage({type:'BEST_MOVE',move:(p.length>1?p[1]:''),seq:lastSeq});drainPending();}",
      "}",
      "self.onmessage=function(e){var d=e.data||{};",
      " if(d.type==='STOP'){pendingSearch=null;if(engineSearching){stopPending=true;}",
      "  try{if(engine){engine.sendCommand('stop');}}catch(e0){}return;}",
      " if(d.type==='SEARCH'){var req={fen:d.fen,movetime:d.movetime||500,seq:d.seq,allowChase:d.allowChase};",
      "  if(!engine){pendingSearch=req;return;}",
      "  if(engineSearching){pendingSearch=req;stopPending=true;try{engine.sendCommand('stop');}catch(e1){}return;}",
      "  runSearch(req);}}",
      "try{",
      " (0, eval)(ENGINE_SRC);",
      " var cfg={locateFile:function(p){return p;},wasmBinary:b64ToU8(WASM_B64),",
      "  getPreloadedPackage:function(n,s){return b64ToU8(DATA_B64).buffer;},",
      "  onReceiveStdout:onOut,onReceiveStderr:function(){},onExit:function(){}};",
      " Pikafish(cfg).then(function(mod){engine=mod;try{",
      "  mod.sendCommand('setoption name Hash value 256');",
      "  mod.sendCommand('uci');",
      " }catch(e2){postErr('皮卡鱼初始化失败: '+e2);}})",
      "  .catch(function(err){postErr('皮卡鱼加载失败: '+err);});",
      "}catch(err){postErr('皮卡鱼加载失败: '+err);}"
    ].join("\n");
  }
  // eleeye
  return [
    "var WASM_B64=" + b64(bundle.wasm) + ";",
    "var ENGINE_SRC=" + js(bundle.js) + ";",
    "function b64ToU8(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}",
    "function postErr(m){self.postMessage({type:'ERROR',message:m});}",
    "var engine=null,lastSeq=0,pendingSearch=null,stopPending=false,engineSearching=false;",
    "function onOut(line){line=String(line||'').trim();if(!line)return;",
    " if(line.indexOf('bestmove')===0){engineSearching=false;",
    "  if(stopPending){stopPending=false;drainPending();return;}",
    "  var p=line.split(/\\s+/);self.postMessage({type:'BEST_MOVE',move:(p.length>1?p[1]:''),seq:lastSeq});drainPending();}",
    "}",
    "function cmd(c){if(engine&&typeof engine.ccall==='function'){try{engine.ccall('execute_ucci_command',null,['string'],[c]);}catch(e){postErr(String(e));}}}",
    "function runSearch(d){if(!engine||!d||!d.fen){return;}engineSearching=true;lastSeq=d.seq||lastSeq;",
    " try{var fen=(d.fen.indexOf(' - ')<0)?d.fen+' - - 0 1':d.fen;cmd('position fen '+fen);cmd('go movetime '+(d.movetime||500));}",
    " catch(err){engineSearching=false;postErr('象眼搜索失败: '+err);}}",
    "function drainPending(){if(pendingSearch&&engine&&!engineSearching){var q=pendingSearch;pendingSearch=null;runSearch(q);}}",
    "self.onmessage=function(e){var d=e.data||{};",
    " if(d.type==='STOP'){pendingSearch=null;if(engineSearching){stopPending=true;}cmd('stop');return;}",
    " if(d.type==='SEARCH'){var req={fen:d.fen,movetime:d.movetime||500,seq:d.seq};",
    "  if(!engine){pendingSearch=req;return;}",
    "  if(engineSearching){pendingSearch=req;stopPending=true;cmd('stop');return;}",
    "  runSearch(req);}}}",
    "try{",
    " (0, eval)(ENGINE_SRC);",
    " createEleeyeModule({noInitialRun:true,print:onOut,printErr:function(){},",
    "  instantiateWasm:function(info,receive){WebAssembly.instantiate(b64ToU8(WASM_B64),info)",
    "   .then(function(res){receive(res.instance||res);},function(e){postErr('象眼 wasm 初始化失败: '+e);});}",
    " }).then(function(mod){engine=mod;",
    "  if(typeof engine.ccall==='function'){try{engine.ccall('init_eleeye_engine',null,[],[]);cmd('ucci');}catch(e3){postErr(String(e3));}}",
    "  self.postMessage({type:'READY'});",
    "  drainPending();",
    " }).catch(function(err){postErr('象眼加载失败: '+err);});",
    "}catch(err){postErr('象眼加载失败: '+err);}"
  ].join("\n");
}

// xqw 自包含 Blob Worker：file:// 下 new Worker(相对路径)+importScripts 全被禁，
// 只能把 worker 源码与 book/position/search/cchess 内联拼成一个 Blob。
// 文件不大（book.js 300KB 级），fetch 同源 file 理论可读；读不到就 reject，
// 上层 catch 会走主线程同步 searchMain 最后一搏，对局不断。
function buildXqwBlob() {
  function fetchText(url) {
    return fetch(url, { cache: "force-cache" }).then(function (r) {
      if (!r.ok) {
        throw new Error("HTTP " + r.status);
      }
      return r.text();
    });
  }
  return Promise.all([
    fetchText("js/engines/xqw/xqw.worker.js?v=1"),
    fetchText("js/book.js"),
    fetchText("js/position.js"),
    fetchText("js/search.js"),
    fetchText("js/cchess.js")
  ]).then(function (parts) {
    var workerSrc = parts[0];
    // 去掉 worker 头部的 importScripts，换成内联源码
    workerSrc = workerSrc.replace(/importScripts\([^)]*\);?/g, "");
    return parts[1] + "\n" + parts[2] + "\n" + parts[3] + "\n" + parts[4] + "\n" + workerSrc;
  });
}

// 懒加载 bundle 脚本(仅在 Blob 降级时用到)
function loadBundle(id) {
  var info = engineInfo(id);
  if (!info || !info.bundle) {
    return Promise.reject(new Error("该引擎没有离线数据包"));
  }
  var name = info.bundleGlobal;
  var root = (typeof window != "undefined") ? window : (typeof self != "undefined" ? self : null);
  if (root && root[name]) {
    return Promise.resolve(root[name]);
  }
  return new Promise(function (resolve, reject) {
    var s = document.createElement("script");
    s.src = info.bundle;
    s.onload = function () {
      var b = root ? root[name] : null;
      if (b) {
        resolve(b);
      } else {
        reject(new Error("离线数据包加载后未找到 " + name));
      }
    };
    s.onerror = function () {
      reject(new Error("无法加载离线数据包 " + info.bundle));
    };
    document.head.appendChild(s);
  });
}

var EngineBridge = (function () {
  var states = {};
  var searches = {};
  var seqAlloc = 0;
  // 判例开关: 随每次搜索下发, 由各 worker 在搜索前同步到引擎
  var ruleOpts = { allowChase: true };

  function state(id) {
    if (!states[id]) {
      states[id] = { worker: null, mode: null, ready: false, promise: null, rejectTimer: null, error: null, seq: 0, _resolve: null, _reject: null };
    }
    return states[id];
  }

  function deliver(id, d) {
    var st = state(id);
    var seq = (d.seq !== undefined && d.seq !== null) ? d.seq : st.seq;
    var cb = searches[seq];
    if (cb) {
      delete searches[seq];
      delete searches[seq + ":reject"];
      if (st.seq === seq) {
        st.seq = 0;
      }
      cb(d.move, d.info);
    }
  }

  // 挂起的搜索必须有始有终：ERROR / 线程崩溃 / 超时都要 reject 它，
  // 否则棋盘 busy 永久为 true，点哪都没用。
  // 注意：search() 里 resolve 已被包装为“结算一次就停计时器”，
  // 这里只处理 reject 通道；resolve 通道由 deliver() 直接调用包装器。
  function failSearch(id, seq, err) {
    var cb = searches[seq];
    if (!cb) {
      return;
    }
    delete searches[seq];
    var rej = searches[seq + ":reject"];
    delete searches[seq + ":reject"];
    if (rej) {
      try {
        rej(err);
      } catch (eR) { /* 上层已结算则忽略 */ }
    }
  }

  function onWorkerMessage(id, ev) {
    var st = state(id);
    var d = ev.data || {};
    if (d.type === "READY") {
      st.ready = true;
      st.error = null;
      if (st.rejectTimer) {
        clearTimeout(st.rejectTimer);
        st.rejectTimer = null;
      }
      if (st._resolve) {
        st._resolve();
        st._resolve = null;
      }
    } else if (d.type === "ERROR") {
      st.error = d.message || "引擎错误";
      if (st._reject) {
        st._reject(new Error(st.error));
        st._reject = null;
      }
      // 搜索阶段的报错：结束当前挂起的搜索，交给上层回退内置引擎
      if (st.seq) {
        failSearch(id, st.seq, new Error(st.error));
        st.seq = 0;
      }
    } else if (d.type === "BEST_MOVE") {
      // 迟到的旧搜索结果（悔棋/重开/换引擎/看门狗兜底后才回来）直接丢弃：
      // 上层 board.js 用 thinkingSeq 守卫，这里把已失效的 seq 一并清理，双保险
      if (d.seq !== undefined && d.seq !== null && st.seq && d.seq !== st.seq) {
        delete searches[d.seq];
        delete searches[d.seq + ":reject"];
        return;
      }
      deliver(id, d);
    }
  }

  function attachWorker(id, worker) {
    var st = state(id);
    st.worker = worker;
    worker.onmessage = function (ev) {
      onWorkerMessage(id, ev);
    };
    worker.onerror = function (ev) {
      st.error = (ev && ev.message) || "引擎线程异常";
      if (st._reject) {
        st._reject(new Error(st.error));
        st._reject = null;
      }
      // 线程崩溃同样结束挂起的搜索，不让棋盘锁死
      if (st.seq) {
        failSearch(id, st.seq, new Error(st.error));
        st.seq = 0;
      }
    };
    worker.postMessage({ type: "INIT" });
  }

  // file:// 下浏览器直接禁止 new Worker(相对路径)，连试都不用试，直接走 Blob；
  // http(s) 下优先原生 Worker，被收紧的 WebView 禁止时再降级 Blob。
  function isFileProtocol() {
    try {
      return typeof location != "undefined" && location.protocol === "file:";
    } catch (e) {
      return false;
    }
  }

  function spawnWorker(id) {
    var st = state(id);
    var info = engineInfo(id);
    return new Promise(function (resolve, reject) {
      if (!info) {
        reject(new Error("未知引擎: " + id));
        return;
      }
      if (typeof Worker == "undefined") {
        reject(new Error("当前环境不支持 Web Worker，无法使用后台引擎"));
        return;
      }
      // xqw 内置引擎同样走 Worker：原生 Worker 直接加载 xqw.worker.js，
      // 它用 importScripts 拉 book/position/search/cchess，无任何外部依赖。
      // file:// 下浏览器直接禁止 new Worker(相对路径)，同步抛错，走下面的 Blob 降级：
      // 把 xqw.worker.js + book/position/search/cchess 打包成自包含 Blob Worker。
      if (id === "xqw") {
        if (!isFileProtocol()) {
          var xw = null;
          try {
            xw = new Worker(info.worker);
          } catch (e) {
            xw = null;
          }
          if (xw) {
            st.mode = "native";
            attachWorker(id, xw);
            resolve();
            return;
          }
        }
        buildXqwBlob().then(function (src) {
          var xw2 = null;
          try {
            xw2 = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
          } catch (e2) {
            reject(new Error("当前环境无法创建引擎线程"));
            return;
          }
          st.mode = "blob";
          attachWorker(id, xw2);
          resolve();
        }, reject);
        return;
      }
      if (!info.wasm) {
        reject(new Error("未知引擎: " + id));
        return;
      }
      if (!isFileProtocol()) {
        var worker = null;
        try {
          worker = new Worker(info.worker);
        } catch (e) {
          worker = null;
        }
        if (worker) {
          st.mode = "native";
          attachWorker(id, worker);
          resolve();
          return;
        }
      }
      // 降级: 拉取离线数据包, 构建自包含 Blob Worker
      loadBundle(id).then(function (bundle) {
        var src;
        try {
          src = buildBlobWorkerSource(id, bundle);
        } catch (e) {
          reject(e);
          return;
        }
        var worker2 = null;
        try {
          worker2 = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
        } catch (e) {
          reject(new Error("当前环境无法创建引擎线程，已回退内置引擎"));
          return;
        }
        st.mode = "blob";
        attachWorker(id, worker2);
        resolve();
      }, function (err) {
        reject(err);
      });
    });
  }

  function load(id) {
    var st = state(id);
    if (st.promise) {
      return st.promise;
    }
    var timeoutMs = (id === "xqw") ? 15000 : 45000;
    st.promise = new Promise(function (resolve, reject) {
      st._resolve = resolve;
      st._reject = reject;
      try {
        spawnWorker(id).catch(function (e) {
          if (st._reject) {
            st._reject(e);
            st._reject = null;
          }
        });
      } catch (eSync) {
        // spawnWorker 里同步抛错（比如 file:// 下 new Worker 直接炸）：
        // 必须进 reject，否则 load() 的 promise 永远 pending，棋盘 busy 锁死。
        if (st._reject) {
          st._reject(eSync);
          st._reject = null;
        }
      }
      st.rejectTimer = setTimeout(function () {
        if (!st.ready) {
          st.error = "引擎加载超时";
          if (st._reject) {
            st._reject(new Error(st.error));
            st._reject = null;
          }
        }
      }, timeoutMs);
    });
    // promise 自带 catch 吞掉未处理 rejection 告警，上层 failFast 照常工作
    st.promise.catch(function () { /* 已由 failFast/上层处理 */ });
    return st.promise;
  }

  // 取消指定引擎正在进行的搜索：悔棋/重开/换引擎/看门狗兜底时调用。
  // 让 Worker 停掉旧思考（UCI/UCCI 的 stop 指令），并清理主线程挂起的旧 seq，
  // 避免迟到的 BEST_MOVE 污染新局面。
  function resetSearch(id) {
    var st = state(id);
    if (st.seq) {
      delete searches[st.seq];
      delete searches[st.seq + ":reject"];
      st.seq = 0;
    }
    if (st.worker) {
      try {
        st.worker.terminate();
      } catch (e) { /* ignore */ }
    }
    st.worker = null;
    st.ready = false;
    st.promise = null;
    st.error = null;
    st._resolve = null;
    st._reject = null;
  }

  function stop(id) {
    var st = state(id);
    if (st.seq) {
      delete searches[st.seq];
      delete searches[st.seq + ":reject"];
      st.seq = 0;
    }
    if (st.worker) {
      try {
        st.worker.postMessage({ type: "STOP" });
      } catch (e) { /* worker 可能已销毁，忽略 */ }
    }
  }

  function unload(id) {
    var st = state(id);
    if (st.rejectTimer) {
      clearTimeout(st.rejectTimer);
      st.rejectTimer = null;
    }
    if (st.worker) {
      try { st.worker.terminate(); } catch (e) { /* ignore */ }
    }
    st.worker = null;
    st.ready = false;
    st.promise = null;
    st.error = null;
    st.seq = 0;
    st._resolve = null;
    st._reject = null;
  }

  // 统一 SEARCH 消息体：xqw 多带 useBook（开局库开关），WASM 引擎忽略多余字段
  function searchPayload(fen, movetime, seq, useBook) {
    return {
      type: "SEARCH",
      fen: fen.indexOf(" - ") < 0 ? fen + FEN_EXTRA : fen,
      movetime: movetime || 500,
      seq: seq,
      allowChase: ruleOpts.allowChase !== false,
      useBook: useBook !== false
    };
  }

  function search(id, fen, movetime, useBook) {
    return new Promise(function (resolve, reject) {
      var st = state(id);
      var seq = ++seqAlloc;
      searches[seq] = resolve; // 由 deliver() 在 BEST_MOVE 时最终 resolve
      searches[seq + ":reject"] = reject;

      var settled = false;
      var timer = 0;
      var failFast = function (err) {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          try { clearTimeout(timer); } catch (eT) { /* ignore */ }
          timer = 0;
        }
        failSearch(id, seq, err);
      };
      // BEST_MOVE 到达即结算：停掉兜底计时器，不再让它 15 秒后误伤
      var wrapResolve = function (mv, info) {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          try { clearTimeout(timer); } catch (eT2) { /* ignore */ }
          timer = 0;
        }
        resolve(mv, info);
      };
      searches[seq] = wrapResolve;

      var run = function () {
        // 引擎还没就绪：把搜索排队，主线程的 failFast + 超时兜底会管住它；
        // Worker 侧就绪后也会补执行排队的 SEARCH（见各 worker 的 pendingSearch），
        // 两边配合，保证这次走子一定有 BEST_MOVE 或 reject，不锁棋盘。
        if (!st.worker || !st.ready) {
          st.seq = seq;
          try {
            load(id).then(function () {
              if (settled) {
                return;
              }
              if (state(id).ready && state(id).worker && searches[seq]) {
                st.seq = seq;
                try {
                  state(id).worker.postMessage(searchPayload(fen, movetime, seq, useBook));
                } catch (e) {
                  failFast(e);
                }
              }
            }, failFast);
          } catch (eSync) {
            failFast(eSync);
          }
          // 兜底超时: 正常应在 movetime 前后返回
          timer = setTimeout(function () {
            failFast(new Error("引擎思考超时"));
          }, (movetime || 500) + 15000);
          return;
        }
        st.seq = seq;
        try {
          st.worker.postMessage(searchPayload(fen, movetime, seq, useBook));
        } catch (e) {
          failFast(e);
          return;
        }
        // 兜底超时: 正常应在 movetime 前后返回
        timer = setTimeout(function () {
          failFast(new Error("引擎思考超时"));
        }, (movetime || 500) + 15000);
      };

      try {
        if (st.worker && st.ready) {
          run();
        } else {
          load(id).then(run, failFast);
        }
      } catch (eOuter) {
        failFast(eOuter);
      }
    });
  }

  function supported(id) {
    return engineInfo(id) != null;
  }

  function displayName(id) {
    var info = engineInfo(id);
    return info ? info.name : id;
  }

  return {
    load: load,
    unload: unload,
    reset: resetSearch,
    stop: stop,
    search: search,
    supported: supported,
    displayName: displayName,
    ready: function (id) { return state(id).ready; },
    mode: function (id) { return state(id).mode; },
    setRuleOptions: function (opts) {
      if (opts && typeof opts.allowChase === "boolean") {
        ruleOpts.allowChase = opts.allowChase;
      }
    }
  };
})();