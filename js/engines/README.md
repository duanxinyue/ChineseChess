# 第三方引擎文件说明

本目录包含两个基于 WebAssembly 的第三方象棋引擎，均按其开源许可使用，仅供个人学习，**请勿商用**。

## 皮卡鱼 Pikafish（`pikafish/`）

- 引擎：皮卡鱼（Pikafish），由 Stockfish 移植而来的免费开源中国象棋引擎，含 NNUE 神经网络评估，棋力为当前免费引擎中最强一档。
- 许可：GPLv3
- 上游：https://github.com/official-pikafish/Pikafish
- 本目录为「皮卡鱼网页版」社区构建的单线程 WASM 版本（`pikafish.js` / `pikafish.wasm` / `pikafish.data`，数据包内为 NNUE 权重 `pikafish.nnue`），经 UCI 协议驱动。
- `pikafish.worker.js` 为本项目自写的主线程↔Worker UCI 桥接。

## 象眼 ElephantEye（`eleeye/`）

- 引擎：象眼（ElephantEye），黄晨（Morning Yellow）开源的经典中国象棋引擎。
- 许可：LGPL v2.1 / GPL（详见 `eleeye/third-party` 上游仓库说明）
- 上游：https://github.com/xqbase/eleeye
- 本目录的 `eleeye.js` / `eleeye.wasm` 来自 billzi2016/Chinese-Chess-AI 的 WASM 移植（https://github.com/billzi2016/Chinese-Chess-AI），采用 UCCI 协议。
- `eleeye.worker.js` 在原项目 worker 基础上补充了 UCCI 握手 `ucci` 与搜索序号回传。

## 使用说明

- 三个引擎统一由主线程桥接层 `js/engine.js`（`EngineBridge`）调度：
  - 内置引擎「象棋巫师」直接在 JS 内同步搜索；
  - 两个 WASM 引擎在 独立 Web Worker 中搜索，不阻塞界面。
- 引擎在「引擎」下拉中选择，切换后自动开始新一局；「电脑水平」档位对三个引擎都生效（以思考毫秒数调节棋力）。
- 引擎在 Worker 中后台思考。若运行环境禁止加载 `file://` 路径的 Worker（如 Chrome 直接双击打开 `index.html`、或收紧权限的 WebView），引擎会自动降级为「Blob Worker + 内嵌引擎数据」（`*-bundle.js`），同样离线可用，首次加载会稍慢。