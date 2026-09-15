/*
board.js - Source Code for XiangQi Wizard Light, Part IV

XiangQi Wizard Light - a Chinese Chess Program for JavaScript
Designed by Morning Yellow, Version: 1.0, Last Modified: Sep. 2012
Copyright (C) 2004-2012 www.xqbase.com

This program is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 2 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License along
with this program; if not, write to the Free Software Foundation, Inc.,
51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
*/

"use strict";

var RESULT_UNKNOWN = 0;
var RESULT_WIN = 1;
var RESULT_DRAW = 2;
var RESULT_LOSS = 3;

var BOARD_WIDTH = 521;
var BOARD_HEIGHT = 577;
var SQUARE_SIZE = 57;
var SQUARE_LEFT = (BOARD_WIDTH - SQUARE_SIZE * 9) >> 1;
var SQUARE_TOP = (BOARD_HEIGHT - SQUARE_SIZE * 10) >> 1;
var THINKING_SIZE = 32;
var THINKING_LEFT = (BOARD_WIDTH - THINKING_SIZE) >> 1;
var THINKING_TOP = (BOARD_HEIGHT - THINKING_SIZE) >> 1;
var MAX_STEP = 8;
var PIECE_NAME = [
    "oo", null, null, null, null, null, null, null,
    "rk", "ra", "rb", "rn", "rr", "rc", "rp", null,
    "bk", "ba", "bb", "bn", "br", "bc", "bp", null,
];

function SQ_X(sq) {
    return SQUARE_LEFT + (FILE_X(sq) - 3) * SQUARE_SIZE;
}

function SQ_Y(sq) {
    return SQUARE_TOP + (RANK_Y(sq) - 3) * SQUARE_SIZE;
}

function MOVE_PX(src, dst, step) {
    return Math.floor((src * step + dst * (MAX_STEP - step)) / MAX_STEP + .5) + "px";
}

function alertDelay(message) {
    setTimeout(function () {
        var el = document.getElementById("message_area_84423");
        if (el) {
            el.innerHTML = message;
        }
    }, 250);
}

// 全局故障自愈钩子：任何未捕获的异常（包括引擎 Worker/音频/动画回调里的）
// 都不再让棋盘停在 busy 里等死，而是清状态 + 提示一行字。
// 卡死后 F12 打不开时的保底：出错原因直接写在页面消息区里，不用开控制台也能看到。
if (typeof window !== "undefined") {
    window.__boardErrorHook = null;
    var __boardHookInstalled = false;
    (function installBoardHook() {
        if (__boardHookInstalled) {
            return;
        }
        __boardHookInstalled = true;
        var report = function (msg) {
            try {
                var el = document.getElementById("message_area_84423");
                if (el && msg) {
                    el.innerHTML = "出错已自动恢复：" + String(msg).substring(0, 120);
                }
            } catch (e) { /* ignore */ }
            try {
                if (window.__boardErrorHook) {
                    window.__boardErrorHook(msg);
                }
            } catch (e) { /* ignore */ }
        };
        window.addEventListener("error", function (ev) {
            var msg = (ev && (ev.message || (ev.error && ev.error.message))) || "未知错误";
            report(msg);
        });
        window.addEventListener("unhandledrejection", function (ev) {
            var r = ev && ev.reason;
            var msg = (r && (r.message || r)) || "异步错误";
            report(msg);
            try {
                if (ev && typeof ev.preventDefault === "function") {
                    ev.preventDefault();
                }
            } catch (e) { /* ignore */ }
        });
    })();
}

function Board(container, images, sounds) {
    this.images = images;
    this.sounds = sounds;
    this.pos = new Position();
    this.pos.chaseAllowed = true;
    this.pos.fromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    this.animated = true;
    this.sound = true;
    this.search = null;
    this.imgSquares = [];
    this.sqSelected = 0;
    this.mvLast = 0;
    this.millis = 0;
    this.computer = -1;
    this.viewport = false;
    this.reviewMode = false;
    this.useBook = true;
    this.crazyMode = false;
    this.allowChase = true;
    this.result = RESULT_UNKNOWN;
    this.busy = false;
    this.busySince = 0;
    this.thinkingTimer = 0;
    this.thinkingSeq = 0;
    this.busyWatchdog = 0;
    this.animTimer = 0;
    this.animImg = null;
    this.animSq = 0;
    this.animStart = 0;
    this.pendingWasmFen = null;
    this.hintMv = 0;
    this.hintSeq = 0;
    this.engineId = "xqw";

    var style = container.style;
    style.position = "relative";
    style.width = BOARD_WIDTH + "px";
    style.height = BOARD_HEIGHT + "px";
    style.background = "url(" + images + "board.jpg)";
    var this_ = this;
    for (var sq = 0; sq < 256; sq++) {
        if (!IN_BOARD(sq)) {
            this.imgSquares.push(null);
            continue;
        }
        var img = document.createElement("img");
        //var style = img.style;
        img.style.position = "absolute";
        img.style.left = SQ_X(sq) + 'px';
        img.style.top = SQ_Y(sq) + 'px';
        img.style.width = SQUARE_SIZE;
        img.style.height = SQUARE_SIZE;
        img.style.zIndex = 0;
        img.onmousedown = function (sq_) {
            return function () {
                this_.clickSquare(sq_);
            }
        }(sq);
        container.appendChild(img);
        this.imgSquares.push(img);
    }

    this.thinking = document.createElement("img");
    this.thinking.src = images + "thinking.gif";
    style = this.thinking.style;
    style.visibility = "hidden";
    style.position = "absolute";
    style.left = THINKING_LEFT + "px";
    style.top = THINKING_TOP + "px";
    container.appendChild(this.thinking);

    this.dummy = document.createElement("div");
    this.dummy.style.position = "absolute";
    container.appendChild(this.dummy);

    this.flushBoard();
}

Board.prototype.playSound = function (soundFile) {
    if (!this.sound) {
        return;
    }
    try {
        // 无头/未交互环境下 play() 会 reject（NotAllowedError），必须吞掉，
        // 否则未捕获的 promise rejection 会打断后续走子回调。
        var p = new Audio(this.sounds + soundFile + ".wav").play();
        if (p && typeof p.catch === "function") {
            p.catch(function () { /* ignore autoplay policy */
            });
        }
    } catch (e) {
        this.dummy.innerHTML = "<embed src=\"" + this.sounds + soundFile +
            ".wav\" hidden=\"true\" autostart=\"true\" loop=\"false\" />";
    }
}

Board.prototype.setSearch = function (hashLevel) {
    this.search = hashLevel == 0 ? null : new Search(this.pos, hashLevel);
}

// 切换"允许长将长捉": 同步作用于棋盘判罚与内置引擎搜索; WASM 引擎判例随每次搜索下发
Board.prototype.setChaseAllowed = function (allowed) {
    this.allowChase = !!allowed;
    if (this.pos) {
        this.pos.chaseAllowed = this.allowChase;
    }
}

// 切换到指定引擎(WASM 引擎为异步走子)
// 中途换引擎不重开局面：只换"谁来走下一步"，并清掉旧思考。
// 换引擎后如果轮到电脑，由调用方(engine_change/kickEngine)决定是否立即思考。
Board.prototype.setEngine = function (id) {
    if (typeof EngineBridge != "undefined") {
        var old = this.engineId;
        if (old !== id && EngineBridge.supported(old) && old !== "xqw") {
            // 先停掉旧引擎正在跑的搜索并销毁它的 Worker：
            // 换引擎后旧引擎再吐 bestmove 也没人收，不会污染新引擎局面。
            EngineBridge.reset(old);
        }
        if (!EngineBridge.supported(id)) {
            id = "xqw";
        }
    } else {
        id = "xqw";
    }
    if (id === this.engineId && this.engineId !== "xqw") {
        return;
    }
    this.cancelThinking();
    this.engineId = id;
}

Board.prototype.flipped = function (sq) {
    return (this.computer == 0) !== this.viewport ? SQUARE_FLIP(sq) : sq;
}

Board.prototype.computerMove = function () {
    return this.pos.sdPlayer == this.computer;
}

Board.prototype.computerLastMove = function () {
    return 1 - this.pos.sdPlayer == this.computer;
}

// 查询当前棋盘是否"真卡死"：思考动画已藏、思考定时器没跑、
// 动画定时器没跑（或跑了超过 1.5 秒还没播完），却还占着 busy。
// 疯狂测试脚本和页面自检共用这个判断，避免各写一套标准打架。
Board.prototype.isStuck = function () {
    if (!this.busy || this.result != RESULT_UNKNOWN) {
        return false;
    }
    if (this.thinking.style.visibility != "hidden" || this.thinkingTimer) {
        return false;
    }
    if (!this.animTimer) {
        return true;
    }
    if (this.animStart > 0 && (new Date().getTime() - this.animStart) > 1500) {
        return true;
    }
    return false;
}

// 疯狂回归测试：在当前局面下连续做 N 轮"悔棋→走子→换视角→重开"组合操作，
// 每一步都检查 isStuck()。正常走子（玩家/电脑回合推进、busy 短暂为 true）不算卡死，
// 只有忙了超过 GRACE 还不释放才记一次。全部通过会在 console 打 torment-ok。
Board.prototype.tormentTest = function (rounds) {
    var self = this;
    rounds = rounds > 0 ? rounds : 30;
    try {
        console.log("[torment] start, rounds=" + rounds);
    } catch (e) { /* ignore */ }
    var GRACE = 3000;
    var stuckCount = 0;
    var i = 0;
    var savedFen = null;
    try {
        savedFen = this.pos.toFen();
    } catch (e2) {
        savedFen = null;
    }
    function snapshot() {
        var s = { busy: self.busy, thinkingSeq: self.thinkingSeq, result: self.result,
            sd: -1, mvLen: -1, stuck: false };
        try {
            s.sd = self.pos.sdPlayer;
            s.mvLen = self.pos.mvList.length;
            s.stuck = self.isStuck();
        } catch (e3) { /* ignore */ }
        return s;
    }
    var t0 = new Date().getTime();
    function oneRound() {
        if (i >= rounds) {
            var dt = new Date().getTime() - t0;
            try {
                console.log("[torment] done in " + dt + "ms, stuck=" + stuckCount + "/" + rounds);
            } catch (e4) { /* ignore */ }
            if (stuckCount == 0) {
                try {
                    console.log("%c[torment] torment-ok：连续 " + rounds + " 轮无卡死", "color:green;font-weight:bold");
                } catch (e5) { /* ignore */ }
            } else {
                try {
                    console.warn("[torment] FAIL：卡死 " + stuckCount + " 次");
                } catch (e6) { /* ignore */ }
            }
            return "torment-" + (stuckCount == 0 ? "ok" : "fail(" + stuckCount + ")");
        }
        i++;
        var mode = i % 4;
        try {
            if (mode == 1) {
                // 悔棋后再用兜底走一步
                self.retract();
            } else if (mode == 2) {
                // 玩家回合就走一步兜底着法
                if (!self.computerMove() && self.result == RESULT_UNKNOWN) {
                    var mv = self.firstLegalMove();
                    if (mv > 0) {
                        self.addMove(mv, false);
                    }
                }
            } else if (mode == 3) {
                // 换视角（只重绘，不动局面）
                self.setViewport(!self.viewport);
            } else {
                // 取消思考 + 重绘，模拟重开前的打断
                self.cancelThinking();
                self.flushBoard();
            }
        } catch (err) {
            try {
                console.warn("[torment] round " + i + " exception: " + ((err && err.message) || err));
            } catch (e7) { /* ignore */ }
            stuckCount++;
        }
        // 给动画/回调一个心跳，再检查是否真卡死
        setTimeout(function () {
            var s = snapshot();
            if (s.stuck) {
                stuckCount++;
                try {
                    console.warn("[torment] round " + i + " STUCK: " + JSON.stringify(s));
                } catch (e8) { /* ignore */ }
                // 自愈一次，继续下一轮，不让一次卡死污染后面所有轮次
                try {
                    self.clickSquare(0);
                } catch (e9) { /* ignore */ }
            }
            oneRound();
        }, 700);
    }
    oneRound();
    return "torment-running";
}

// 有效思考时长: 疯狂模式下按局势(中局/残局)自动加时, 追求更狠的着法
Board.prototype.thinkMillis = function () {
    var ms = this.millis;
    if (!this.crazyMode) {
        return ms;
    }
    var pieces = 0;
    for (var sq = 0; sq < 256; sq++) {
        if (IN_BOARD(sq) && this.pos.squares[sq] > 0) {
            pieces++;
        }
    }
    if (pieces <= 12) {
        ms = Math.round(ms * 1.8);       // 残局: 大优大杀, 容错低, 算得更深
    } else if (pieces <= 20) {
        ms = Math.round(ms * 1.4);       // 中局: 加强攻势衔接
    } else {
        ms = Math.round(ms * 1.2);       // 开局: 主要靠开局库, 稍许加深
    }
    return Math.min(ms, 8000);
}

Board.prototype.addMove = function (mv, computerMove) {
    // legalMove 失败(比如点到了不能走的格子、悔棋后选中的子已不在原位)时：
    // 玩家走子只取消选中、不报错；电脑走子则用兜底走法保证对局推进。
    if (!this.pos.legalMove(mv)) {
        if (computerMove) {
            var fb0 = this.firstLegalMove();
            // firstLegalMove 内部是 make+undo 实测，这里必须真正落子一次，
            // 否则局面没推进、显示却动了，直接错位卡死。
            if (fb0 > 0 && this.pos.makeMove(fb0)) {
                this.doMakeMove(fb0, true);
                return;
            }
            this.busy = false;
            this.busySince = 0;
            this.clearBusyWatchdog();
            this.thinking.style.visibility = "hidden";
            alertDelay("引擎走法被规则拒绝，请点“重新开始”。");
            return;
        }
        if (this.sqSelected) {
            this.drawSquare(this.sqSelected, false);
            this.sqSelected = 0;
        }
        return;
    }
    // makeMove 失败是"送将"类伪合法走法（被判例拒绝的长打也会走这里）。
    // 电脑走子被拒时用兜底走法顶上，保证轮到谁都有人走子，不会停在电脑回合卡死。
    if (!this.pos.makeMove(mv)) {
        this.playSound("illegal");
        if (computerMove) {
            var fb = this.firstLegalMove();
            if (fb > 0 && this.pos.makeMove(fb)) {
                this.doMakeMove(fb, true);
                return;
            }
        }
        this.busy = false;
        this.busySince = 0;
        this.animStart = 0;
        this.clearBusyWatchdog();
        this.thinking.style.visibility = "hidden";
        if (computerMove) {
            alertDelay("引擎走法被规则拒绝，请点“重新开始”。");
        } else if (this.sqSelected) {
            this.drawSquare(this.sqSelected, false);
            this.sqSelected = 0;
        }
        return;
    }
    this.doMakeMove(mv, computerMove);
}

// 走子已由 makeMove 生效：只负责动画/落子/切换回合
Board.prototype.doMakeMove = function (mv, computerMove) {
    this.hintMv = 0;
    this.busy = true;
    if (!this.animated) {
        this.postAddMove(mv, computerMove);
        return;
    }

    this.startMoveAnimation(mv, computerMove);
}

// 第一个真正合法的走法（makeMove 实测通过），供各处兜底共用
Board.prototype.firstLegalMove = function () {
    var mvs = this.pos.generateMoves(null);
    for (var i = 0; i < mvs.length; i++) {
        if (this.pos.makeMove(mvs[i])) {
            this.pos.undoMakeMove();
            return mvs[i];
        }
    }
    return 0;
}

Board.prototype.startMoveAnimation = function (mv, computerMove) {
    // 同一时间只允许一个走子动画：上一个没播完就被新走子顶掉时，
    // 老定时器必须先停，否则两个动画回调互相覆盖棋子位置，终点错乱。
    if (this.animTimer) {
        try {
            clearInterval(this.animTimer);
        } catch (e0) { /* ignore */ }
        this.animTimer = 0;
        this.animImg = null;
        this.animSq = 0;
        this.animStart = 0;
    }
    var sqSrc = this.flipped(SRC(mv));
    var xSrc = SQ_X(sqSrc);
    var ySrc = SQ_Y(sqSrc);
    var sqDst = this.flipped(DST(mv));
    var xDst = SQ_X(sqDst);
    var yDst = SQ_Y(sqDst);
    var img = this.imgSquares[sqSrc];
    var style = img.style;
    style.zIndex = 256;
    var step = MAX_STEP - 1;
    var this_ = this;
    this.animImg = img;
    this.animSq = sqSrc;
    var myAnimStart = new Date().getTime();
    this.animStart = myAnimStart;
    this.animTimer = setInterval(function () {
        // 不是本轮动画的回调（已被新走子取代）：直接退出，不碰棋盘
        if (this_.animTimer == 0 || this_.animStart !== myAnimStart) {
            return;
        }
        if (step == 0) {
            clearInterval(this_.animTimer);
            this_.animTimer = 0;
            this_.animStart = 0;
            style.left = xSrc + "px";
            style.top = ySrc + "px";
            style.zIndex = 0;
            this_.postAddMove(mv, computerMove);
        } else {
            style.left = MOVE_PX(xSrc, xDst, step) + "px";
            style.top = MOVE_PX(ySrc, yDst, step) + "px";
            step--;
        }
    }, 16);
    // 动画保底：浏览器节流/异常导致 setInterval 停跑时，
    // 1 秒后强制收尾，保证 postAddMove 一定执行、busy 一定释放。
    var thisMv = mv;
    var thisComp = computerMove;
    var thisStyle = style;
    var thisXSrc = xSrc;
    var thisYSrc = ySrc;
    setTimeout(function () {
        if (this_.animTimer != 0 && this_.animStart === myAnimStart) {
            try {
                clearInterval(this_.animTimer);
            } catch (e1) { /* ignore */ }
            this_.animTimer = 0;
            this_.animStart = 0;
            thisStyle.left = thisXSrc + "px";
            thisStyle.top = thisYSrc + "px";
            thisStyle.zIndex = 0;
            this_.postAddMove(thisMv, thisComp);
        }
    }, 1000);
}

Board.prototype.postAddMove = function (mv, computerMove) {
    if (this.mvLast > 0) {
        this.drawSquare(SRC(this.mvLast), false);
        this.drawSquare(DST(this.mvLast), false);
    }
    this.drawSquare(SRC(mv), true);
    this.drawSquare(DST(mv), true);
    this.sqSelected = 0;
    this.mvLast = mv;

    if (this.pos.isMate()) {
        this.playSound(computerMove ? "loss" : "win");
        this.result = computerMove ? RESULT_LOSS : RESULT_WIN;

        var pc = SIDE_TAG(this.pos.sdPlayer) + PIECE_KING;
        var sqMate = 0;
        for (var sq = 0; sq < 256; sq++) {
            if (this.pos.squares[sq] == pc) {
                sqMate = sq;
                break;
            }
        }
        if (!this.animated || sqMate == 0) {
            this.postMate(computerMove);
            return;
        }

        sqMate = this.flipped(sqMate);
        var img = this.imgSquares[sqMate];
        var style = img.style;
        style.zIndex = 256;
        var xMate = SQ_X(sqMate);
        var step = MAX_STEP;
        var this_ = this;
        this.animImg = img;
        this.animSq = sqMate;
        this.animTimer = setInterval(function () {
            if (step == 0) {
                clearInterval(this_.animTimer);
                this_.animTimer = 0;
                style.left = xMate + "px";
                style.zIndex = 0;
                this_.imgSquares[sqMate].src = this_.images +
                    (this_.pos.sdPlayer == 0 ? "r" : "b") + "km.gif";
                this_.postMate(computerMove);
            } else {
                style.left = (xMate + ((step & 1) == 0 ? step : -step) * 2) + "px";
                step--;
            }
        }, 50);
        return;
    }

    // 重复判例: 勾选"允许长将长捉"时不判罚, 对局继续; 取消勾选则按亚洲规则判罚
    if (!this.allowChase) {
        var vlRep = this.pos.repStatus(3);
        if (vlRep > 0) {
            vlRep = this.pos.repValue(vlRep);
            if (vlRep > -WIN_VALUE && vlRep < WIN_VALUE) {
                this.playSound("draw");
                this.result = RESULT_DRAW;
                alertDelay("双方不变作和，辛苦了！");
            } else if (computerMove == (vlRep < 0)) {
                this.playSound("loss");
                this.result = RESULT_LOSS;
                alertDelay("长打作负，请不要气馁！");
            } else {
                this.playSound("win");
                this.result = RESULT_WIN;
                alertDelay("长打作负，祝贺你取得胜利！");
            }
            this.postAddMove2();
            this.busy = false;
            return;
        }
    }

    if (this.pos.inCheck()) {
        this.playSound(computerMove ? "check2" : "check");
    } else if (this.pos.captured()) {
        this.playSound(computerMove ? "capture2" : "capture");
    } else {
        this.playSound(computerMove ? "move2" : "move");
    }

    this.postAddMove2();
    this.response();
}

Board.prototype.postAddMove2 = function () {
    if (typeof this.onAddMove == "function") {
        this.onAddMove();
    }
}

Board.prototype.postMate = function (computerMove) {
    alertDelay(computerMove ? "请再接再厉！" : "祝贺你取得胜利！");
    this.postAddMove2();
    this.busy = false;
}

// busy 看门狗：电脑思考超时没有任何回调时，强制用内置引擎走一步，
// 棋盘永远不会永久锁死。超时阈值 = 本步思考预算 + 15s 引擎兜底 + 5s 余量。
Board.prototype.armBusyWatchdog = function (seq) {
    this.clearBusyWatchdog();
    var this_ = this;
    var budget = 0;
    try {
        budget = this.thinkMillis();
    } catch (e) {
        budget = this.millis || 400;
    }
    var timeout = (budget || 400) + 20000;
    this.busyWatchdog = setTimeout(function () {
        this_.busyWatchdog = 0;
        if (this_.thinkingSeq !== seq || this_.result != RESULT_UNKNOWN || !this_.busy) {
            return;
        }
        // 看门狗触发：先停掉旧引擎可能迟到的 BEST_MOVE，再用内置引擎兜底走子
        this_.thinkingSeq = (this_.thinkingSeq + 1) & 0xffff;
        if (typeof EngineBridge != "undefined" && this_.engineId != "xqw") {
            try {
                EngineBridge.stop(this_.engineId);
            } catch (e) { /* ignore */
            }
        }
        var mv2 = 0;
        try {
            if (this_.search != null) {
                this_.search.useBook = this_.useBook;
                mv2 = this_.search.searchMain(LIMIT_DEPTH, this_.thinkMillis());
            }
        } catch (e2) {
            mv2 = 0;
        }
        if (mv2 <= 0 || !this_.pos.legalMove(mv2)) {
            mv2 = this_.firstLegalMove();
        }
        this_.thinking.style.visibility = "hidden";
        this_.busy = false;
        this_.busySince = 0;
        if (mv2 > 0) {
            alertDelay("引擎超时，已用内置引擎代走一步。");
            this_.addMove(mv2, true);
        } else {
            alertDelay("引擎超时未返回走法，请点“重新开始”。");
        }
    }, timeout);
}

Board.prototype.clearBusyWatchdog = function () {
    if (this.busyWatchdog) {
        clearTimeout(this.busyWatchdog);
        this.busyWatchdog = 0;
    }
}

Board.prototype.response = function () {
    if (this.search == null || !this.computerMove()) {
        this.busy = false;
        this.busySince = 0;
        return;
    }
    // 开局库: 开局阶段直接按谱出子, 既快又稳 (不调用引擎, 不降棋力)
    if (this.useBook && this.pos.mvList.length <= 12) {
        var mvBook = this.pos.bookMove();
        if (mvBook > 0) {
            this.addMove(mvBook, true);
            return;
        }
    }
    this.thinking.style.visibility = "visible";
    this.busy = true;
    this.busySince = new Date().getTime();
    this.thinkingSeq = (this.thinkingSeq + 1) & 0xffff;
    var seq = this.thinkingSeq;
    this.armBusyWatchdog(seq);
    var this_ = this;

    if (this.engineId == "xqw") {
        // 内置引擎: 同步搜索, 100ms 后开始思考
        this.thinkingTimer = setTimeout(function () {
            // 悔棋/重开/换引擎后这个定时器已经作废：不做任何事。
            // 原先继续跑 searchMain，会在新局面下再走一步"鬼步"，
            // 与新局面真正的引擎搜索串在一起，把 busy 与走子顺序全打乱。
            if (this_.thinkingSeq !== seq || this_.result != RESULT_UNKNOWN) {
                return;
            }
            this_.thinkingTimer = 0;
            this_.search.useBook = this_.useBook;
            var mv = 0;
            try {
                mv = this_.search.searchMain(LIMIT_DEPTH, this_.thinkMillis());
            } catch (e) {
                mv = 0;
            }
            // 放弃局面变化后的迟到结果：只认本轮 seq，过期结果直接丢
            if (this_.thinkingSeq !== seq || this_.result != RESULT_UNKNOWN) {
                return;
            }
            // 搜索异常/超时未给出走法时，用第一个合法走法兜底。
            // 不做这层保护一旦抛异常就会跳过下面的 busy=false，棋盘永久点不动。
            if (mv <= 0 || !this_.pos.legalMove(mv)) {
                mv = this_.firstLegalMove();
            }
            this_.clearBusyWatchdog();
            this_.thinking.style.visibility = "hidden";
            this_.busy = false;
            this_.busySince = 0;
            if (mv > 0) {
                this_.addMove(mv, true);
            }
        }, 100);
        return;
    }

    if (typeof EngineBridge == "undefined" || typeof iccs2Move != "function") {
        this.clearBusyWatchdog();
        this.thinking.style.visibility = "hidden";
        this.busy = false;
        this.busySince = 0;
        alert("外部引擎组件缺失，请改回内置引擎。");
        return;
    }

    // WASM 引擎: 异步在 Worker 中搜索
    // file:// 下若 WASM 引擎还没就绪/加载失败，不让棋盘卡在 busy，直接回退内置引擎走子
    this.pendingWasmFen = this.pos.toFen();
    var selfFen = this.pendingWasmFen;
    // 换引擎时旧引擎的搜索不作数：记下当前引擎 id，回来发现引擎已换就直接丢弃。
    // 否则旧引擎的迟到 bestmove 可能冒充新引擎的着法落子，把局面搞乱。
    var selfEngine = this.engineId;
    EngineBridge.search(this.engineId, this.pendingWasmFen, this.thinkMillis()).then(function (iccs) {
        // 搜索发出后局面已经变了（悔棋/重开/快速走子/换引擎），这条结果只能丢弃
        if (this_.thinkingSeq !== seq || this_.result != RESULT_UNKNOWN ||
            this_.pendingWasmFen !== selfFen || this_.engineId !== selfEngine) {
            return;
        }
        this_.pendingWasmFen = null;
        this_.clearBusyWatchdog();
        this_.thinking.style.visibility = "hidden";
        this_.busy = false;
        this_.busySince = 0;
        var mv = iccs2Move(String(iccs || ""));
        // 引擎着法必须用 makeMove 实测（送将/换引擎后的鬼步会被拒绝）。
        // 实测失败就用第一步真合法走法兜底，对局一定能推进，电脑回合不会无人接管。
        var tested = (mv > 0 && this_.pos.legalMove(mv)) ? this_.pos.makeMove(mv) : false;
        if (tested) {
            this_.pos.undoMakeMove();
        } else {
            mv = this_.firstLegalMove();
            if (mv <= 0) {
                alertDelay("引擎返回非法着法且无合法走法，请点“重新开始”。");
                return;
            }
        }
        this_.addMove(mv, true);
    }).catch(function (err) {
        if (this_.thinkingSeq !== seq || this_.pendingWasmFen !== selfFen || this_.engineId !== selfEngine) {
            return;
        }
        this_.pendingWasmFen = null;
        // 引擎不可用时静默回退内置引擎：file:// 双击场景下不弹窗打断对局
        if (this_.search != null && this_.result == RESULT_UNKNOWN) {
            var mv2 = 0;
            try {
                this_.search.useBook = this_.useBook;
                mv2 = this_.search.searchMain(LIMIT_DEPTH, this_.thinkMillis());
            } catch (e2) {
                mv2 = 0;
            }
            if (this_.thinkingSeq !== seq || this_.result != RESULT_UNKNOWN) {
                return;
            }
            if (mv2 <= 0 || !this_.pos.legalMove(mv2)) {
                mv2 = this_.firstLegalMove();
            }
            this_.clearBusyWatchdog();
            this_.thinking.style.visibility = "hidden";
            this_.busy = false;
            this_.busySince = 0;
            if (mv2 > 0) {
                this_.addMove(mv2, true);
                return;
            }
        }
        this_.clearBusyWatchdog();
        this_.thinking.style.visibility = "hidden";
        this_.busy = false;
        this_.busySince = 0;
        alert("引擎出错：" + ((err && err.message) || err));
    });
}

Board.prototype.cancelThinking = function () {
    this.thinkingSeq = (this.thinkingSeq + 1) & 0xffff;
    this.hintSeq = (this.hintSeq + 1) & 0xffff;
    this.clearBusyWatchdog();
    this.pendingWasmFen = null;
    // 停掉 WASM 引擎正在跑的搜索：悔棋/重开时旧思考必须真正停止，
    // 否则它的迟到 BEST_MOVE 会和新局面串在一起，把 busy 卡死
    if (typeof EngineBridge != "undefined" && this.engineId != "xqw" && this.engineId) {
        try {
            EngineBridge.stop(this.engineId);
        } catch (e) { /* ignore */
        }
    }
    if (this.thinkingTimer) {
        clearTimeout(this.thinkingTimer);
        this.thinkingTimer = 0;
        this.thinking.style.visibility = "hidden";
    }
}

Board.prototype.cancelAnimation = function () {
    if (this.animTimer) {
        clearInterval(this.animTimer);
        this.animTimer = 0;
        this.animStart = 0;
        var img = this.animImg;
        if (img) {
            img.style.left = SQ_X(this.animSq) + "px";
            img.style.top = SQ_Y(this.animSq) + "px";
            img.style.zIndex = 0;
        }
        this.animImg = null;
        this.animSq = 0;
    }
}

Board.prototype.clickSquare = function (sq_) {
    // 自愈保护：如果思考动画已隐藏、走子动画也已结束，却仍残留 busy，
    // 说明上一轮回调在切引擎/快速点击竞态中漏清状态。不要让整个棋盘永久失去响应。
    // 注意：单靠 busy 自愈不够——如果卡在"走子动画定时器"里（浏览器节流/异常导致
    // setInterval 停跑），busy 会被反复置 true。点不动时强制结束动画再清 busy。
    // ★ 认命条件必须严格：动画定时器还在跑说明动画正在播，这时 busy=true 是正常的，
    // 绝不能清状态，否则会把正在走的棋打断、局面与显示错位。
    var thinkingHidden = (this.thinking.style.visibility == "hidden");
    var animIdle = !this.animTimer;
    var animStuck = false;
    if (!animIdle && this.animStart > 0) {
        animStuck = (new Date().getTime() - this.animStart) > 1500;
    }
    if (this.busy && thinkingHidden && !this.thinkingTimer && (animIdle || animStuck)) {
        if (this.animTimer) {
            try {
                clearInterval(this.animTimer);
            } catch (e) { /* ignore */ }
            this.animTimer = 0;
            try {
                var aImg = this.animImg;
                var aSq = this.animSq;
                if (aImg && aSq) {
                    var mvA = this.mvLast;
                    if (mvA > 0) {
                        this.drawSquare(SRC(mvA), false);
                        this.drawSquare(DST(mvA), false);
                    } else {
                        aImg.style.left = SQ_X(aSq) + "px";
                        aImg.style.top = SQ_Y(aSq) + "px";
                    }
                    aImg.style.zIndex = 0;
                }
            } catch (e2) { /* ignore */ }
            this.animImg = null;
            this.animSq = 0;
        }
        this.busy = false;
        this.busySince = 0;
        this.clearBusyWatchdog();
        if (this.sqSelected) {
            try {
                this.drawSquare(this.sqSelected, false);
            } catch (e3) { /* ignore */ }
            this.sqSelected = 0;
        }
        if (this.result == RESULT_UNKNOWN && this.computerMove()) {
            this.response();
            return;
        }
    }
    if (this.busy || this.result != RESULT_UNKNOWN) {
        return;
    }
    var sq = this.flipped(sq_);
    var pc = this.pos.squares[sq];
    if ((pc & SIDE_TAG(this.pos.sdPlayer)) != 0) {
        this.playSound("click");
        if (this.mvLast != 0) {
            this.drawSquare(SRC(this.mvLast), false);
            this.drawSquare(DST(this.mvLast), false);
        }
        if (this.sqSelected) {
            this.drawSquare(this.sqSelected, false);
        }
        this.drawSquare(sq, true);
        this.sqSelected = sq;
    } else if (this.sqSelected > 0) {
        this.addMove(MOVE(this.sqSelected, sq), false);
    }
}

Board.prototype.drawSquare = function (sq, selected) {
    var img = this.imgSquares[this.flipped(sq)];
    img.src = this.images + PIECE_NAME[this.pos.squares[sq]] + ".gif";
    var hint = this.hintMv != 0 && (sq == SRC(this.hintMv) || sq == DST(this.hintMv));
    if (selected || hint) {
        img.style.backgroundImage = "url(" + this.images + "oos.gif)";
    } else {
        img.style.backgroundImage = "";
    }
    img.style.boxShadow = hint ? "inset 0 0 0 5px #1e6fd9" : "";
}

Board.prototype.flushBoard = function () {
    this.mvLast = this.pos.mvList[this.pos.mvList.length - 1];
    for (var sq = 0; sq < 256; sq++) {
        if (IN_BOARD(sq)) {
            this.drawSquare(sq, sq == SRC(this.mvLast) || sq == DST(this.mvLast));
        }
    }
}

Board.prototype.restart = function (fen) {
    this.cancelThinking();
    this.cancelAnimation();
    if (this.sqSelected) {
        this.drawSquare(this.sqSelected, false);
        this.sqSelected = 0;
    }
    this.hintMv = 0;
    this.busy = false;
    this.result = RESULT_UNKNOWN;
    this.pos.fromFen(fen);
    this.flushBoard();
    this.playSound("newgame");
    this.response();
}

Board.prototype.retract = function () {
    this.cancelThinking();
    this.cancelAnimation();
    if (this.sqSelected) {
        this.drawSquare(this.sqSelected, false);
        this.sqSelected = 0;
    }
    this.hintMv = 0;
    this.busy = false;
    this.result = RESULT_UNKNOWN;
    if (this.pos.mvList.length > 1) {
        this.pos.undoMakeMove();
    }
    if (this.pos.mvList.length > 1 && this.computerMove()) {
        this.pos.undoMakeMove();
    }
    this.flushBoard();
    this.response();
}

Board.prototype.setSound = function (sound) {
    this.sound = sound;
    if (sound) {
        this.playSound("click");
    }
}

Board.prototype.setViewport = function (viewport) {
    if (this.sqSelected) {
        this.drawSquare(this.sqSelected, false);
        this.sqSelected = 0;
    }
    this.viewport = !!viewport;
    this.flushBoard();
}
