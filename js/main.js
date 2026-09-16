"use strict";

// 唯一引擎：皮卡鱼 Pikafish（WASM + NNUE）
var ENGINE_ID = "pikafish";

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
board.millis = 400;

board.computer = 1;
initEngine();
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
// 恢复为"电脑先走"时立刻让皮卡鱼开一局
if (board.computerMove() && board.result === RESULT_UNKNOWN) {
  kickEngine();
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

// 让皮卡鱼快速算一手推荐走法（返回 Promise<内部走法>）
function requestBestMove(millis) {
  return EngineBridge.search(ENGINE_ID, board.pos.toFen(), millis || 400).then(function (iccs) {
    var mv = iccs2Move(iccs);
    if (mv > 0 && board.pos.legalMove(mv)) {
      return mv;
    }
    throw new Error("引擎走法异常");
  });
}

/* ==================== 引擎（皮卡鱼 Pikafish） ==================== */

function setEngStatus(st, err) {
  var el = document.getElementById("engStatus");
  if (!el) {
    return;
  }
  if (st === "loading") {
    el.innerHTML = '<span style="color:#9a7b4f">皮卡鱼引擎加载中…</span>';
  } else if (st === "ready") {
    var suffix = "";
    try {
      suffix = EngineBridge.mode(ENGINE_ID) === "blob" ? "（离线兼容模式）" : "";
    } catch (e) { /* ignore */ }
    el.innerHTML = '<span style="color:#2e7d32">皮卡鱼已就绪' + suffix + "</span>";
  } else {
    var tip = String((err && err.message) || err || "").replace(/"/g, "&#34;");
    el.innerHTML = '<span style="color:#c0392b" title="' + tip +
        '">引擎加载失败，对局将自动补走</span>';
  }
}

// 唯一引擎皮卡鱼：页面打开即预热 Worker（http 原生 Worker / file:// 自动 Blob 降级），
// 玩家走第一步时引擎通常已就绪，脱谱第一手不必干等加载。
function initEngine() {
  board.engineId = ENGINE_ID;
  setEngStatus("loading");
  try {
    EngineBridge.load(ENGINE_ID).then(function () {
      setEngStatus("ready");
    }, function (err) {
      setEngStatus("error", err);
    });
  } catch (e) {
    setEngStatus("error", e);
  }
}

// 轮到电脑走且棋局未结束时, 让皮卡鱼从现有局面接着思考
function kickEngine() {
  if (!board.busy && board.result === RESULT_UNKNOWN && board.computerMove()) {
    board.response();
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

// iccs2Move 由 cchess.js 提供（ICCS 记法转内部走法）

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
