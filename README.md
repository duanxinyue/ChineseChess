# 与电脑下象棋 · PC 网页版

纯前端、零后端、零构建的中国象棋人机对弈网页。采用皮卡鱼（Pikafish）NNUE 引擎，全部在浏览器本地运行（WASM），打开即玩、可完全离线，适合直接部署为静态站点或个人使用。

> 本项目以开源引擎 [Pikafish](https://www.pikafish.com/)（皮卡鱼）为唯一 AI 引擎。界面布局参考自永乐象棋棋谱网「与电脑下象棋」页面，底层局面与走法规则代码血统来自 [XQWLight](https://www.xqbase.com/)（黄晨，GPL-2.0+）。代码血统、致谢与许可证见文末。

---

## 功能

- **皮卡鱼引擎**：Pikafish（NNUE 神经网络评估），当前免费中国象棋引擎中棋力最强一档
- **开局库**：内置约 1.2 万条开局谱，默认开启，开局按谱秒出子
- **疯狂模式**：中局/残局自动加深思考，追求压迫式进攻
- **判例开关**：默认勾选「允许长将长捉」——长将、长捉、长期不变招不判和不判负；取消勾选则按亚洲规则判罚（长打作负、双方不变作和）
- **对局控制**：谁先走 / 让子（单马、双马、九子）/ 悔棋 / 重新开始 / 音效 / 对方视角
- **记录管理**：着法列表实时记录，双击回看任意一步（导入回看模式），支持导出/导入 ICCS 文本棋谱
- **AI 支招**：一键提示当前局面最佳着法
- **响应式布局**：桌面端棋盘 + 侧栏，窄屏自动堆叠为上下布局

## 快速开始

**方式一（最简单）**：直接双击打开 `index.html`。项目无任何构建步骤、无外部 CDN 依赖，`file://` 协议下同样可用（引擎 Worker 会自动降级为 Blob Worker 运行）。

**方式二（本地服务器）**：

```bash
# Python
python -m http.server 8080

# 或 Node
npx serve .
# 或
node server.js
```

然后浏览器访问 `http://localhost:8080`。

## 目录结构

```
├── index.html              # 单页入口（游戏区 + 控制面板）
├── css/
│   ├── site.css            # 基础样式（源自站点模板）
│   ├── mobile-app.css      # 自研：面板卡片化 + 响应式布局
│   └── font-awesome.css    # 图标库
├── js/
│   ├── board.js            # 棋盘交互 / 动画 / 判罚流程
│   ├── position.js         # 局面与着法规则引擎
│   ├── book.js             # 开局库
│   ├── cchess.js           # ICCS 记法转换等工具
│   ├── engine.js           # 自研：皮卡鱼引擎统一桥接层（EngineBridge）
│   ├── main.js             # 页面逻辑：模式/让子/记录/导入导出
│   └── engines/
│       └── pikafish/       # 皮卡鱼 WASM（NNUE，原生 Worker + Blob 降级）
├── images/ sounds/ fonts/  # 静态资源（棋子图片与音效来源于 XQWLight 发行包）
├── server.js               # 可选：零依赖本地静态服务器
└── _gen_bundles.js         # 开发工具：把 .wasm/.data 打成 JS base64 包
```

## 架构

```
┌─────────────── 页面（main.js / board.js）───────────────┐
│  对局控制 · 判罚 · 记录 · 设置                            │
└───────────────┬─────────────────────────────────────────┘
                │ 统一接口
┌────────── EngineBridge（engine.js）────────────────────┐
│  引擎装载/卸载 · 并发时序（seq） · 超时兜底 · 状态展示      │
│  Worker 原生不可用时自动降级为 Blob Worker               │
├──────────────────────────────────────────────────────────┤
│  Pikafish（NNUE）  WASM (UCI/UCCI)                      │
└──────────────────────────────────────────────────────────┘
```

关键点：

- `EngineBridge` 将皮卡鱼引擎统一为 `search(fen, movetime) → Promise<iccs>`，负责 Worker 生命周期、请求时序与超时降级；在 `file://` 等禁止原生 Worker 的环境自动改走 Blob Worker。
- 判例开关（允许长将长捉）会同步下发到皮卡鱼（`setoption Repetition Rule` 等），保证引擎走法与棋盘判罚一致。
- 开局库在页面层（前 12 步）有一道闸，可整体关闭。

## 引擎清单

| 引擎 | 形态 | 协议 | 许可证 |
|---|---|---|---|
| Pikafish 皮卡鱼 | WASM + NNUE | UCI / UCCI | GPL-3.0 |

重新编译引擎的 WASM 产物请参考上游项目的 Emscripten 构建流程，产物通过 `_gen_bundles.js` 打成 base64 包随仓库分发。

## 许可证与代码血统

本仓库整体以 **GPL-3.0** 发布（见 `LICENSE`），但各部分版权与许可证归属如下，请务必保留各源文件顶部的版权头：

```
皮卡鱼 Pikafish（GPL-3.0）
  ├─ 永乐象棋棋谱网「与电脑下象棋」页面（界面参考来源）
  │   └─ 本项目（GPL-3.0）：
  │      ├─ 引擎桥接层 EngineBridge / Blob Worker 降级
  │      ├─ 开局库开关 / 疯狂模式 / 判例开关
  │      └─ 记录导入导出、响应式面板
  └─ 局面与走法规则代码血统来自 XQWLight（黄晨，GPL-2.0+）
```

附带的前端库（jQuery、Bootstrap、FontAwesome、layer 等）分别保留各自的 MIT/自定义许可证。

## 致谢

- [皮卡鱼 Pikafish](https://www.pikafish.com/) —— NNUE 引擎（国际象棋 Stockfish 的中国象棋移植）
- [象棋巫师 xqbase.com](https://www.xqbase.com/) —— 局面与走法规则代码及棋盘素材来源
- 永乐象棋棋谱网 —— 人机对弈页面的界面参考

## 开发与贡献

- 无构建步骤：改完 JS/CSS 刷新即生效。
- 重新打包引擎产物：`node _gen_bundles.js`（读取 `js/engines/*/*.wasm|*.data`，输出 `*-bundle.js`）。
- 提交前请检查：不包含 `Android/` 等本地打包产物与浏览器调试残留（已由 `.gitignore` 排除）。

## 相关链接

- Pikafish：https://www.pikafish.com/
- XQWLight：https://www.xqbase.com/
