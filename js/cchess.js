"use strict";

function CHR(n) {
  return String.fromCharCode(n);
}

function ASC(c) {
  return c.charCodeAt(0);
}

function move2Iccs(mv) {
  var sqSrc = SRC(mv);
  var sqDst = DST(mv);
  return CHR(ASC("A") + FILE_X(sqSrc) - FILE_LEFT) +
      CHR(ASC("9") - RANK_Y(sqSrc) + RANK_TOP) + "-" +
      CHR(ASC("A") + FILE_X(sqDst) - FILE_LEFT) +
      CHR(ASC("9") - RANK_Y(sqDst) + RANK_TOP);
}

// 把内部走法翻译成中文着法，例如 炮二平五、马8进7、前车进一
function moveToString(pos, mv) {
  var sqSrc = SRC(mv);
  var sqDst = DST(mv);
  var pc = pos.squares[sqSrc];
  var sd = pos.sdPlayer;
  var type = pc & 7;
  var name = (sd == 0 ?
      ["帅", "仕", "相", "马", "车", "炮", "兵"] :
      ["将", "士", "象", "马", "车", "炮", "卒"])[type];
  var num = sd == 0 ? "一二三四五六七八九" : "123456789";
  var fileSrc = FILE_X(sqSrc);
  var fileDst = FILE_X(sqDst);
  var numSrc = sd == 0 ? 12 - fileSrc : fileSrc - 2;
  var numDst = sd == 0 ? 12 - fileDst : fileDst - 2;
  var fwd = sd == 0 ? RANK_Y(sqDst) < RANK_Y(sqSrc) : RANK_Y(sqDst) > RANK_Y(sqSrc);
  var steps = Math.abs(RANK_Y(sqDst) - RANK_Y(sqSrc));

  // 同一直线上同方同兵种多于一枚时，用 前/后/中 区分
  var prefix = name;
  var list = [];
  for (var sq = 0; sq < 256; sq++) {
    if ((sq & 0x0f) == fileSrc && pos.squares[sq] == pc) {
      list.push(sq);
    }
  }
  if (list.length > 1) {
    list.sort(function (a, b) {
      return (sd == 0 ? 1 : -1) * (RANK_Y(a) - RANK_Y(b));
    });
    var idx = list.indexOf(sqSrc);
    if (idx == 0) {
      prefix = "前" + name;
    } else if (idx == list.length - 1) {
      prefix = "后" + name;
    } else {
      prefix = "中" + name;
    }
  }

  if (type == 1 || type == 2 || type == 3) {
    // 士/相/马：斜行，进/退 + 目标路
    return prefix + num[numSrc - 1] + (fwd ? "进" : "退") + num[numDst - 1];
  }
  if (type == 6) {
    // 兵/卒：只进或横移
    return prefix + num[numSrc - 1] +
        (fileSrc == fileDst ? "进一" : "平" + num[numDst - 1]);
  }
  // 帅/车/炮：直线
  return prefix + num[numSrc - 1] +
      (fileSrc == fileDst ?
          (fwd ? "进" : "退") + num[steps - 1] :
          "平" + num[numDst - 1]);
}