# 项目级许可证说明

本仓库整体以 **GPL-3.0-or-later** 发布（完整文本见 `LICENSE`）。

但仓库内各部分遵循各自的原始许可证与版权归属，请务必保留源文件顶部的版权头：

| 部分 | 版权 / 来源 | 许可证 |
|---|---|---|
| `js/position.js`、`js/board.js`、`js/book.js`、`js/cchess.js` 及 `images/`、`sounds/` | XQWLight，Copyright (C) 2004-2012 www.xqbase.com（黄晨） | GPL-2.0-or-later |
| `js/engines/pikafish/*` | Pikafish（皮卡鱼，Stockfish 系）引擎的 WebAssembly 移植 | GPL-3.0 |
| `js/engine.js`、`js/main.js` 及其他未标注第三方版权头的文件 | 本项目作者 | GPL-3.0-or-later |
| `js/jquery.min.js`、`js/bootstrap.min.js`、`css/font-awesome.css`、`js/layer.min.js`、`fonts/` | 各自的上游库 | 保留其原始许可证（MIT 等） |

上述各部分在同一个静态页面中作为独立组件协同工作。按 GPL/LGPL 的要求，分发本仓库（或其衍生作品）时：

1. 保留全部版权声明、许可证文本与本说明；
2. 提供（或指向）完整源代码；
3. 移植的引擎二进制（`*.wasm`、`*.data` 及其打包产物 `*-bundle.js`）同样受各自原始许可证约束，对应源码可从下列上游获取：
   - Pikafish：https://www.pikafish.com/

本仓库中的界面布局参考自永乐象棋棋谱网「与电脑下象棋」页面。该页面本身是 XQWLight 的公开改版；本项目与其不存在隶属关系，如界面权利人提出异议请联系作者调整。

与上游项目无任何背书关系（no endorsement implied）。