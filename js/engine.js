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
  { id: "xqw", name: "象棋巫师（内置 JS）", wasm: false },
  { id: "eleeye", name: "象眼 ElephantEye（WASM）", wasm: true,
    worker: "js/engines/eleeye/eleeye.worker.js?v=5",
    bundle: "js/engines/eleeye/eleeye-bundle.js", bundleGlobal: "ELEEYE_BUNDLE" },
  { id: "pikafish", name: "皮卡鱼 Pikafish（WASM）", wasm: true,
    worker: "js/engines/pikafish/pikafish.worker.js?v=6",
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
      "var engine=null,lastSeq=0;",
      "function onOut(line){line=String(line||'').replace(/[\\r\\n]+$/,'');if(!line)return;",
      " if(line.indexOf('uciok')>=0){self.postMessage({type:'READY'});}",
      " else if(line.indexOf('bestmove')===0){var p=line.split(/\\s+/);self.postMessage({type:'BEST_MOVE',move:(p.length>1?p[1]:''),seq:lastSeq});}",
      "}",
      "function runSearch(d){if(!engine||!d||!d.fen){return;}lastSeq=d.seq||lastSeq;",
      " try{var fen=(d.fen.indexOf(' - ')<0)?d.fen+' - - 0 1':d.fen;",
      "  engine.sendCommand('setoption name Repetition Rule value '+(d.allowChase===false?'AsianRule':'AllowChase'));",
      "  engine.sendCommand('setoption name Draw Rule value None');",
      "  engine.sendCommand('setoption name Sixty Move Rule value '+(d.allowChase===false?'true':'false'));",
      "  engine.sendCommand('position fen '+fen);engine.sendCommand('go movetime '+(d.movetime||500));}",
      " catch(err){postErr('皮卡鱼搜索失败: '+err);}}",
      "self.onmessage=function(e){var d=e.data||{};",
      " if(d.type==='STOP'){try{engine.sendCommand('stop');}catch(e){}return;}",
      " if(d.type==='SEARCH'){if(!engine){return;}runSearch(d);}}",
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
    "var engine=null,lastSeq=0;",
    "function onOut(line){line=String(line||'').trim();if(!line)return;",
    " if(line.indexOf('bestmove')===0){var p=line.split(/\\s+/);self.postMessage({type:'BEST_MOVE',move:(p.length>1?p[1]:''),seq:lastSeq});}",
    "}",
    "function cmd(c){if(engine&&typeof engine.ccall==='function'){try{engine.ccall('execute_ucci_command',null,['string'],[c]);}catch(e){postErr(String(e));}}}",
    "function runSearch(d){if(!engine||!d||!d.fen){return;}lastSeq=d.seq||lastSeq;",
    " try{var fen=(d.fen.indexOf(' - ')<0)?d.fen+' - - 0 1':d.fen;cmd('position fen '+fen);cmd('go movetime '+(d.movetime||500));}",
    " catch(err){postErr('象眼搜索失败: '+err);}}",
    "self.onmessage=function(e){var d=e.data||{};",
    " if(d.type==='STOP'){cmd('stop');return;}",
    " if(d.type==='SEARCH'){if(!engine){return;}runSearch(d);}}",
    "try{",
    " (0, eval)(ENGINE_SRC);",
    " createEleeyeModule({noInitialRun:true,print:onOut,printErr:function(){},",
    "  instantiateWasm:function(info,receive){WebAssembly.instantiate(b64ToU8(WASM_B64),info)",
    "   .then(function(res){receive(res.instance||res);},function(e){postErr('象眼 wasm 初始化失败: '+e);});}",
    " }).then(function(mod){engine=mod;",
    "  if(typeof engine.ccall==='function'){try{engine.ccall('init_eleeye_engine',null,[],[]);cmd('ucci');}catch(e3){postErr(String(e3));}}",
    "  self.postMessage({type:'READY'});",
    " }).catch(function(err){postErr('象眼加载失败: '+err);});",
    "}catch(err){postErr('象眼加载失败: '+err);}"
  ].join("\n");
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
      states[id] = { worker: null, mode: null, ready: false, promise: null, rejectTimer: null, error: null, seq: 0, pendingDispatched: false, _resolve: null, _reject: null };
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
      cb(d.move, d.info);
    }
  }

  // 挂起的搜索必须有始有终：ERROR / 线程崩溃 / 超时都要 reject 它，
  // 否则棋盘 busy 永久为 true，点哪都没用。
  function failSearch(id, seq, err) {
    var cb = searches[seq];
    if (!cb) {
      return;
    }
    delete searches[seq];
    var rej = searches[seq + ":reject"];
    delete searches[seq + ":reject"];
    if (rej) {
      rej(err);
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
        st.pendingDispatched = false;
      }
    } else if (d.type === "BEST_MOVE") {
      // 迟到的旧搜索结果（换引擎/悔棋/重开后才回来）直接丢弃，
      // 上层同样用 thinkingSeq 守卫，这里双保险，不让旧着法污染新局面。
      if (d.seq !== undefined && d.seq !== null && st.seq && d.seq !== st.seq) {
        delete searches[d.seq];
        delete searches[d.seq + ":reject"];
        return;
      }
      deliver(id, d);
    }
  }

  // 取消指定引擎正在进行的搜索：换引擎/悔棋/重开/看门狗兜底时调用，
  // 让 Worker 停掉旧思考，并清理主线程挂起的旧 seq，避免迟到 BEST_MOVE 污染新局面。
  function stop(id) {
    var st = state(id);
    if (st.seq) {
      delete searches[st.seq];
      delete searches[st.seq + ":reject"];
      st.seq = 0;
    }
    st.pendingDispatched = false;
    if (st.worker) {
      try {
        st.worker.postMessage({ type: "STOP" });
      } catch (e) { /* worker 可能已销毁，忽略 */ }
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
        st.pendingDispatched = false;
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
      if (!info || !info.wasm) {
        reject(new Error("未知引擎: " + id));
        return;
      }
      if (typeof Worker == "undefined") {
        reject(new Error("当前环境不支持 Web Worker，无法使用 WASM 引擎"));
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
    if (id === "xqw") {
      st.ready = true;
      return Promise.resolve();
    }
    if (st.promise) {
      return st.promise;
    }
    st.promise = new Promise(function (resolve, reject) {
      st._resolve = resolve;
      st._reject = reject;
      spawnWorker(id).catch(function (e) {
        if (st._reject) {
          st._reject(e);
          st._reject = null;
        }
      });
      st.rejectTimer = setTimeout(function () {
        if (!st.ready) {
          st.error = "引擎加载超时";
          if (st._reject) {
            st._reject(new Error(st.error));
            st._reject = null;
          }
        }
      }, 45000);
    });
    return st.promise;
  }

  function unload(id) {
    var st = state(id);
    if (id === "xqw") {
      return;
    }
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
    st.pendingDispatched = false;
    st._resolve = null;
    st._reject = null;
  }

  function search(id, fen, movetime) {
    return new Promise(function (resolve, reject) {
      var st = state(id);
      var seq = ++seqAlloc;
      searches[seq] = resolve; // 由 deliver() 在 BEST_MOVE 时最终 resolve
      searches[seq + ":reject"] = reject;

      var failFast = function (err) {
        failSearch(id, seq, err);
      };

      var run = function () {
        // 引擎就绪前只排队一次：主线程记下 seq 并等 load 成功后下发 SEARCH，
        // Worker 侧不再重复补发（旧的双下发会导致 uci 引擎连续 go 两次、
        // 第二个 bestmove 顶掉第一个，seq 错乱后棋盘收不到正确回调）。
        // 无论哪条路，保证这次走子一定有 BEST_MOVE 或 reject，不锁棋盘。
        if (!st.worker || !st.ready) {
          st.seq = seq;
          if (!st.pendingDispatched) {
            st.pendingDispatched = true;
            load(id).then(function () {
              st.pendingDispatched = false;
              if (state(id).ready && state(id).worker && searches[seq]) {
                st.seq = seq;
                try {
                  state(id).worker.postMessage({
                    type: "SEARCH",
                    fen: fen.indexOf(" - ") < 0 ? fen + FEN_EXTRA : fen,
                    movetime: movetime || 500,
                    seq: seq,
                    allowChase: ruleOpts.allowChase !== false
                  });
                } catch (e) {
                  failFast(e);
                }
              }
            }, function (err) {
              st.pendingDispatched = false;
              failFast(err);
            });
          } else {
            load(id).then(function () { /* 首个排队者会下发 SEARCH */ }, failFast);
          }
          // 兜底超时: 正常应在 movetime 前后返回
          setTimeout(function () {
            failFast(new Error("引擎思考超时"));
          }, (movetime || 500) + 15000);
          return;
        }
        st.seq = seq;
        try {
          st.worker.postMessage({
            type: "SEARCH",
            fen: fen.indexOf(" - ") < 0 ? fen + FEN_EXTRA : fen,
            movetime: movetime || 500,
            seq: seq,
            allowChase: ruleOpts.allowChase !== false
          });
        } catch (e) {
          failFast(e);
        }
        // 兜底超时: 正常应在 movetime 前后返回
        setTimeout(function () {
          failFast(new Error("引擎思考超时"));
        }, (movetime || 500) + 15000);
      };

      if (st.worker && st.ready) {
        run();
      } else {
        load(id).then(run, failFast);
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