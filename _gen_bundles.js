// 临时生成:BLOB 兜底用引擎 bundle(生成后删除本脚本)
const fs = require('fs');
const path = require('path');

function b64(buf) {
  return Buffer.from(buf).toString('base64');
}

const out = {
  pikafish: {
    file: 'js/engines/pikafish/pikafish-bundle.js',
    global: 'PIKAFISH_BUNDLE',
    js: fs.readFileSync('js/engines/pikafish/pikafish.js', 'utf8'),
    wasm: b64(fs.readFileSync('js/engines/pikafish/pikafish.wasm')),
    data: b64(fs.readFileSync('js/engines/pikafish/pikafish.data')),
  },
  eleeye: {
    file: 'js/engines/eleeye/eleeye-bundle.js',
    global: 'ELEEYE_BUNDLE',
    js: fs.readFileSync('js/engines/eleeye/eleeye.js', 'utf8'),
    wasm: b64(fs.readFileSync('js/engines/eleeye/eleeye.wasm')),
  },
};

for (const key of Object.keys(out)) {
  const o = out[key];
  const obj = { js: o.js, wasm: o.wasm };
  if (o.data) obj.data = o.data;
  const content = 'var ' + o.global + '=' + JSON.stringify(obj) + ';\n';
  fs.writeFileSync(o.file, content);
  console.log(o.file, '->', (fs.statSync(o.file).size / 1048576).toFixed(2) + 'MB');
}