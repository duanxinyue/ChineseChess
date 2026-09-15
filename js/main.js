"use strict";

var STARTUP_FEN = [
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w",
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKAB1R w",
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/R1BAKAB1R w",
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/9/1C5C1/9/RN2K2NR w",
];

function createOption(text, value, ie8) {
  var opt = document.createElement("option");
  opt.selected = true;
  opt.value = value;
  if (ie8) {
    opt.text = text;
  } else {
    opt.innerHTML = text.replace(/ /g, "&nbsp;");
  }
  return opt;
}


var board = new Board(container, "images/", "sounds/");
board.setSearch(16);
board.millis = 400;

board.computer = 1;
restoreEngine();
try {
  var savedMoveMode = localStorage.getItem("xiangqi_move_mode");
  if (savedMoveMode === "0" || savedMoveMode === "1" || savedMoveMode === "2") {
    selMoveMode.selectedIndex = parseInt(savedMoveMode, 10);
    board.computer = 1 - selMoveMode.selectedIndex;
  }
  var savedBook = localStorage.getItem("xiangqi_use_book");
  if (savedBook === "1" || savedBook === "0") {
    board.useBook = savedBook === "1";
  }
  var savedCrazy = localStorage.getItem("xiangqi_crazy");
  if (savedCrazy === "1" || savedCrazy === "0") {
    board.crazyMode = savedCrazy === "1";
  }
  var savedChase = localStorage.getItem("xiangqi_allow_chase");
  if (savedChase === "1" || savedChase === "0") {
    board.setChaseAllowed(savedChase === "1");
  }
  var chkBook = document.getElementById("chkUseBook");
  if (chkBook) {
    chkBook.checked = board.useBook;
  }
  var chkCrazy = document.getElementById("chkCrazy");
  if (chkCrazy) {
    chkCrazy.checked = board.crazyMode;
  }
  var chkChase = document.getElementById("chkAllowChase");
  if (chkChase) {
    chkChase.checked = board.allowChase;
  }
} catch (e) { /* ignore */ }
if (typeof EngineBridge != "undefined" && EngineBridge.setRuleOptions) {
  EngineBridge.setRuleOptions({ allowChase: board.allowChase !== false });
}
board.onAddMove = function() {
  // 若在"导入回看"中走到中途就落子，截断后面已导入的着法，并按新局面继续
  while (selMoveList.options.length > board.pos.mvList.length - 1) {
    selMoveList.options.length = board.pos.mvList.length - 1;
  }
  board.reviewMode = false;
  var counter = (board.pos.mvList.length >> 1);
  var space = (counter > 99 ? "    " : "   ");
  counter = (counter > 9 ? "" : " ") + counter + ".";
  var text = (board.pos.sdPlayer == 0 ? space : counter) + move2Iccs(board.mvLast);
  var value = "" + board.mvLast;
  try {
    selMoveList.add(createOption(text, value, false));
  } catch (e) {
    selMoveList.add(createOption(text, value, true));
  }
  // 选中最新一手会让浏览器自动把它滚进可视区；
  // 再在下一帧补一次 scrollTop，绕开 Chrome 对 <select> 同帧改 scrollTop 不生效的问题
  selMoveList.selectedIndex = selMoveList.options.length - 1;
  selMoveList.scrollTop = selMoveList.scrollHeight;
  requestAnimationFrame(function () {
    selMoveList.scrollTop = selMoveList.scrollHeight;
  });
};

function level_change() {
    let tt = document.getElementById("selLevel")
    board.millis = parseInt(tt.options[tt.selectedIndex].value);
}

function book_change(checked) {
    board.useBook = !!checked;
    try {
        localStorage.setItem("xiangqi_use_book", board.useBook ? "1" : "0");
    } catch (e) { /* ignore */ }
}

function crazy_change(checked) {
    board.crazyMode = !!checked;
    try {
        localStorage.setItem("xiangqi_crazy", board.crazyMode ? "1" : "0");
    } catch (e) { /* ignore */ }
}

function chase_change(checked) {
    board.setChaseAllowed(checked);
    try {
        localStorage.setItem("xiangqi_allow_chase", board.allowChase ? "1" : "0");
    } catch (e) { /* ignore */ }
    if (typeof EngineBridge != "undefined" && EngineBridge.setRuleOptions) {
        EngineBridge.setRuleOptions({ allowChase: board.allowChase });
    }
}


function applyMoveMode() {
  board.computer = 1 - selMoveMode.selectedIndex;
  try {
    localStorage.setItem("xiangqi_move_mode", String(selMoveMode.selectedIndex));
  } catch (e) { /* ignore */ }
}

function restart_click() {
  selMoveList.options.length = 1;
  selMoveList.selectedIndex = 0;
  board.reviewMode = false;
  applyMoveMode();
  board.restart(STARTUP_FEN[selHandicap.selectedIndex]);
  var msgArea = document.getElementById("message_area_84423");
  if (msgArea) {
    msgArea.innerHTML = "";
  }
}

function retract_click() {
  // 商业级：悔棋键永远有效。先把显示列表与真实局面先对齐（重放缺的步），
  // 再退棋。任何异常都不让棋盘停在 busy 里。
  try {
    board.reviewMode = false;
    for (var i = board.pos.mvList.length; i < selMoveList.options.length; i ++) {
      var backMv = parseInt(selMoveList.options[i].value);
      if (!(backMv > 0)) {
        break;
      }
      if (!board.pos.legalMove(backMv) || !board.pos.makeMove(backMv)) {
        break;
      }
    }
    board.retract();
  } catch (e) {
    try { board.forceRecover(); } catch (e2) { /* ignore */ }
    try { board.flushBoard(); } catch (e3) { /* ignore */ }
  }
  try {
    selMoveList.options.length = board.pos.mvList.length;
    selMoveList.selectedIndex = selMoveList.options.length - 1;
  } catch (e4) { /* ignore */ }
}

// 支招：让引擎快速算一手，并高亮提示
function hint_click() {
  if (board.search == null) {
    alert("支招需要启用搜索引擎（请选择“电脑先走”并重新开始）。");
    return;
  }
  if (board.result != RESULT_UNKNOWN) {
    alert("对局已结束，无法支招。");
    return;
  }
  if (board.busy) {
    alert("请等当前走子完成后再支招。");
    return;
  }
  if (board.pos.generateMoves().length == 0) {
    alert("当前局面已无走法。");
    return;
  }
  board.hintSeq = (board.hintSeq + 1) & 0xffff;
  var seq = board.hintSeq;
  requestBestMove(400).then(function (mv) {
    if (board.hintSeq !== seq || board.result != RESULT_UNKNOWN) {
      return;
    }
    board.reviewMode = false;
    board.hintMv = mv;
    board.drawSquare(SRC(mv), false);
    board.drawSquare(DST(mv), false);
    var msgArea = document.getElementById("message_area_84423");
    if (msgArea) {
      msgArea.innerHTML = "支招：" + moveToString(board.pos, mv) +
          "（" + move2Iccs(mv) + "）";
    }
  }, function (err) {
    alert("支招失败：" + ((err && err.message) || err));
  });
}

// 让当前引擎给出推荐走法（返回 Promise<内部走法>）
// file:// 下 WASM 引擎不可用时，自动回退内置引擎，不弹窗打断
function requestBestMove(millis) {
  return new Promise(function (resolve, reject) {
    if (board.engineId == "xqw") {
      try {
        var mv = board.search.searchMain(LIMIT_DEPTH, millis);
        if (mv <= 0 || !board.pos.legalMove(mv)) {
          var mvs = board.pos.generateMoves();
          mv = mvs.length > 0 ? mvs[0] : 0;
        }
        resolve(mv);
      } catch (e) {
        reject(e);
      }
      return;
    }
    EngineBridge.search(board.engineId, board.pos.toFen(), millis).then(function (iccs) {
      var mv = iccs2Move(String(iccs || ""));
      if (mv <= 0 || !board.pos.legalMove(mv)) {
        var mvs = board.pos.generateMoves();
        mv = mvs.length > 0 ? mvs[0] : 0;
      }
      resolve(mv);
    }, function (err) {
      var isFile = false;
      try {
        isFile = typeof location != "undefined" && location.protocol === "file:";
      } catch (e) { /* ignore */ }
      if (isFile && board.search != null) {
        try {
          var mv2 = board.search.searchMain(LIMIT_DEPTH, millis);
          if (mv2 <= 0 || !board.pos.legalMove(mv2)) {
            var mvs2 = board.pos.generateMoves();
            mv2 = mvs2.length > 0 ? mvs2[0] : 0;
          }
          if (mv2 > 0) {
            resolve(mv2);
            return;
          }
        } catch (e2) { /* ignore, fall through to reject */ }
      }
      reject(err);
    });
  });
}

/* ==================== 引擎切换 ==================== */

function engine_change() {
  var sel = document.getElementById("selEngine");
  var id = sel ? sel.options[sel.selectedIndex].value : "xqw";
  if (typeof EngineBridge == "undefined" || !EngineBridge.supported(id)) {
    id = "xqw";
  }
  var prevId = board.engineId;
  // 中途换引擎不重开棋局: 先冻结旧思考并销毁旧 Worker（旧 bestmove 再也回不来），
  // 再切引擎。切换瞬间棋盘永远可点，不会出现"换引擎换死"。
  board.setEngine(id);
  board.forceRecover();
  try {
    localStorage.setItem("xiangqi_engine", id);
  } catch (e) { /* ignore */ }
  setEngStatus();
  if (id == "xqw") {
    kickEngine();
    return;
  }
  EngineBridge.load(id).then(function () {
    if (board.engineId !== id) {
      return; // 等待加载期间用户又切回了别的引擎
    }
    setEngStatus();
    kickEngine();
  }, function (err) {
    alert("引擎加载失败：" + ((err && err.message) || err) + "，已回退。");
    if (sel) {
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value == prevId) {
          sel.selectedIndex = i;
          break;
        }
      }
    }
    try {
      localStorage.setItem("xiangqi_engine", prevId);
    } catch (e) { /* ignore */ }
    board.setEngine(prevId);
    setEngStatus();
    kickEngine();
  });
}

// 轮到电脑走且棋局未结束时, 让当前引擎从现有局面接着思考
function kickEngine() {
  if (!board.busy && board.result === RESULT_UNKNOWN &&
      board.search != null && board.computerMove()) {
    board.response();
  }
}

function setEngStatus() {
  var el = document.getElementById("engStatus");
  if (!el) {
    return;
  }
  if (board.engineId == "xqw") {
    el.innerHTML = "";
  } else if (EngineBridge.ready(board.engineId)) {
    el.innerHTML = "（" + EngineBridge.displayName(board.engineId) + " 已就绪）";
  } else {
    el.innerHTML = "（" + EngineBridge.displayName(board.engineId) + " 加载中…）";
  }
}

// 恢复上次选择的引擎，并在后台预热 WASM 引擎
function restoreEngine() {
  var saved = "xqw";
  try {
    saved = localStorage.getItem("xiangqi_engine") || "xqw";
  } catch (e) { /* ignore */ }
  var sel = document.getElementById("selEngine");
  if (sel) {
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value == saved) {
        sel.selectedIndex = i;
        break;
      }
    }
  }
  if (saved != "xqw" && typeof EngineBridge != "undefined" && EngineBridge.supported(saved)) {
    EngineBridge.load(saved).then(function () {
      if (board.engineId == "xqw") {
        board.setEngine(saved);
        setEngStatus();
      }
    }, function () { /* 预热失败不打扰用户 */ });
  }
}

function moveList_change() {
  // 记录列表回看：任何状态下可点。先冻结思考/动画（旧 bestmove 作废），
  // 再 undo/重放到目标步。单步失败就停在当前位置，保证显示与局面永远一致。
  try {
    board.cancelThinking();
    board.cancelAnimation();
  } catch (e0) { /* ignore */ }
  if (board.result == RESULT_UNKNOWN && !board.reviewMode) {
    selMoveList.selectedIndex = selMoveList.options.length - 1;
    return;
  }
  var from = board.pos.mvList.length;
  var to = selMoveList.selectedIndex;
  if (from == to + 1) {
    return;
  }
  board.hintMv = 0;
  if (from > to + 1) {
    for (var i = to + 1; i < from; i ++) {
      board.pos.undoMakeMove();
    }
  } else {
    for (var i = from; i <= to; i ++) {
      var fwdMv = parseInt(selMoveList.options[i].value);
      if (!(fwdMv > 0) || !board.pos.legalMove(fwdMv) || !board.pos.makeMove(fwdMv)) {
        break;
      }
    }
  }
  board.flushBoard();
}

/* ==================== 导出 / 导入对局记录 ==================== */

// 生成导出的文本内容
function recordText() {
  var moves = [];
  for (var i = 1; i < board.pos.mvList.length; i++) {
    moves.push(move2Iccs(board.pos.mvList[i]));
  }
  var texts = [
    "【与电脑下象棋】对局记录",
    "版本:1",
    "红方:" + (board.computer == 1 ? "人" : "电脑"),
    "开局棋谱:" + STARTUP_FEN[selHandicap.selectedIndex],
    "着法:" + moves.join(" "),
  ];
  return texts.join("\n") + "\n";
}

function export_click() {
  var now = new Date();
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  var filename = "对局记录-" + now.getFullYear() + pad(now.getMonth() + 1) +
      pad(now.getDate()) + "-" + pad(now.getHours()) + pad(now.getMinutes()) + ".txt";
  var blob = new Blob([recordText()], { type: "text/plain;charset=utf-8" });
  if (window.navigator && window.navigator.msSaveBlob) {
    window.navigator.msSaveBlob(blob, filename);
    return;
  }
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

function import_click() {
  document.getElementById("fileRecord").click();
}

function importFile_click() {
  var input = document.getElementById("fileRecord");
  var file = input.files && input.files[0];
  if (!file) {
    return;
  }
  var reader = new FileReader();
  reader.onload = function () {
    loadRecord(String(reader.result));
    input.value = "";
  };
  reader.readAsText(file, "utf-8");
}

// 把 ICCS 记法（如 h2-e2、H2E2）转换为内部走法；解析失败返回 0
function iccs2Move(text) {
  var m = String(text).trim().toLowerCase().match(/^([a-i])([0-9])-?([a-i])([0-9])$/);
  if (!m) return 0;
  return MOVE(COORD_XY(m[1].charCodeAt(0) - 94, 60 - m[2].charCodeAt(0)),
              COORD_XY(m[3].charCodeAt(0) - 94, 60 - m[4].charCodeAt(0)));
}

function loadRecord(text) {
  var fen = "";
  var movesText = "";
  var lines = String(text).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var match = line.match(/^开局棋谱[:：]\s*(.+)$/);
    if (match) {
      fen = match[1].trim();
      continue;
    }
    match = line.match(/^着法[:：]\s*(.*)$/);
    if (match) {
      movesText = match[1];
    }
  }
  if (!fen) {
    alert("无法识别该文件：缺少【开局棋谱】信息，无法导入！");
    return;
  }
  board.cancelThinking();
  board.cancelAnimation();
  board.busy = false;
  board.result = RESULT_UNKNOWN;
  board.hintMv = 0;
  board.pos.fromFen(fen);
  selMoveList.options.length = 1;
  selMoveList.selectedIndex = 0;

  var tokens = movesText.split(/[\s,，;；]+/);
  var count = 0;
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i].trim();
    if (!token) {
      continue;
    }
    var mv = /^\d+$/.test(token) ? parseInt(token, 10) : iccs2Move(token);
    if (mv <= 0 || !board.pos.legalMove(mv)) {
      alert("第 " + (count + 1) + " 手走法无法识别或非法：" + token + "\n导入已中止，请检查文件。");
      board.flushBoard();
      selMoveList.selectedIndex = selMoveList.options.length - 1;
      board.reviewMode = count > 0;
      return;
    }
    board.pos.makeMove(mv);
    board.mvLast = mv;
    board.onAddMove();
    count++;
  }
  board.flushBoard();
  selMoveList.scrollTop = selMoveList.scrollHeight;
  selMoveList.selectedIndex = selMoveList.options.length - 1;
  board.reviewMode = count > 0;
  alert("已导入 " + count + " 手走法。现在可以点击记录列表回看整局，或继续对弈。");
}
