# 第三方引擎文件说明

本目录包含基于 WebAssembly 的第三方象棋引擎皮卡鱼（Pikafish），按其开源许可使用，仅供个人学习，**请勿商用**。

## 皮卡鱼 Pikafish（`pikafish/`）

- 引擎：皮卡鱼（Pikafish），由 Stockfish 移植而来的免费开源中国象棋引擎，含 NNUE 神经网络评估，棋力为当前免费引擎中最强一档。
- 许可：GPLv3
- 上游：https://github.com/official-pikafish/Pikafish
- 本目录为「皮卡鱼网页版」社区构建的单线程 WASM 版本（`pikafish.js` / `pikafish.wasm` / `pikafish.data`，数据包内为 NNUE 权重 `pikafish.nnue`），经 UCI 协议驱动。
- `pikafish.worker.js` 为本项目自写的主线程↔Worker UCI 桥接，与 EngineBridge 统一消息格式。

## 使用说明

- 引擎统一由主线程桥接层 `js/engine.js`（`EngineBridge`）调度，在独立 Web Worker 中搜索，不阻塞界面。
- 「电脑水平」档位以思考毫秒数调节棋力，对皮卡鱼引擎生效。
- 若运行环境禁止加载 `file://` 路径的 Worker（如 Chrome 直接双击打开 `index.html`、或收紧权限的 WebView），引擎会自动降级为「Blob Worker + 内嵌引擎数据」（`pikafish-bundle.js`），同样离线可用，首次加载会稍慢。
