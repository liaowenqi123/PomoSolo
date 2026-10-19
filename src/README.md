# `src/` —— 桌面端前端

> **范围**：只讲本目录（Vue 3 + TypeScript + Pinia 的桌面端前端）。
> 后端命令与 Rust 模块见 [`../src-tauri/README.md`](../src-tauri/README.md)；
> PWA 专属层见 [`./pwa/README.md`](./pwa/README.md)。
> 整体结构/版本/模块数量不在这里手写，运行 `npm run docs:map` 生成到
> [`../docs/PROJECT_MAP.md`](../docs/PROJECT_MAP.md)。

## 1. 目录职责

| 目录 | 职责 |
|---|---|
| `api/` | `invoke()` / `listen()` 的 TypeScript 封装；按领域分文件 |
| `stores/` | Pinia 业务状态；组件只通过 store 改状态 |
| `components/` | Vue 单文件组件（含 `garden/` 子目录） |
| `utils/` | 无副作用的纯函数（如音乐库整理） |
| `styles/global.css` | 颜色 token、z-index 层级、全局布局基础 |
| `pwa/` | PWA 专属层；**不是**桌面端前端的一部分，见该目录 README |

## 2. 数据流

```
组件 (components/)
  → Pinia store (stores/)
    → API 封装 (api/*.ts)
      → Tauri invoke
        → Rust command (src-tauri/src/commands/)
          → module / 文件 / 网络 / 音频
```

- Rust 主动推送的事件用 `listen("event-name", ...)` 消费；事件名与 Rust 侧 `emit` 严格一致。
- 组件不要直接 `invoke()`；统一走 `api/`，便于 PWA 端通过 alias 替换传输层。

## 3. 新增一个 Tauri 命令（前端侧）

1. 在 `src-tauri/src/commands/<领域>.rs` 实现命令，并在 `src-tauri/src/lib.rs` 的
   `generate_handler!` 注册（漏注册时前端会报“命令不存在”）；
2. 在 `src/api/<领域>.ts` 封装 `invoke()`，写清楚入参/返回类型；
3. 在 `stores/` 暴露动作，组件只消费 store。

Rust ↔ TS 字段对齐、序列化注意点见 [`../src-tauri/README.md`](../src-tauri/README.md)。

## 4. UI 硬约束（改样式前必读）

- **圆角统一 20px**；`.container` 需要 `border-radius:20px` + `overflow:hidden` 裁剪内部元素。
- **z-index 必须用 `styles/global.css` 的 CSS 变量**（`--z-base` / `--z-modal` / …），禁止 magic number。
- **滚动条只由 `styles/scrollbar.css` 全局兜底**：任何元素意外溢出都会自动得到细滚动条；
  组件里**不要**再写 `::-webkit-scrollbar` / `scrollbar-width` / `scrollbar-color`。
  需要“稳定留槽”或阻止滚动链的容器加 `.app-scroll`（旧 `.scrollable` 仍兼容），
  紧凑菜单可加 `.app-scroll--compact`。
- **深色容器内文字用显式亮色**，禁用 `var(--text-color)`：它跟随主题，亮色主题下会黑字黑底。
- **Modal 统一**：`#1a1a1a` 背景 + 白字 + `.app-modal-overlay` 遮罩。
- **不要给 `.main-content` 加 `overflow:hidden` / `z-index:1`**：会物理裁剪弹窗、破坏层叠上下文。
- **点外部关闭用 `pointerdown` / `mousedown`，不要用 `click`**：
  `click` 是 mouseup 语义，拖拽或“按下后滑出再松手”会误关面板。
- **in-app 面板不做“窗口失焦自动关”**：只提供「按下外部 + Esc」两种零瞄准退出。
  Esc 的层级是：全屏层 → 先收回上一层 → 再按一次才关闭。

## 5. 开发与验证

```bash
npm run dev                 # Vite dev server（前端单独调试）
npm test                    # Vitest
npx vue-tsc --noEmit        # 类型检查
npm run ui:check            # 静态约定：滚动条唯一来源 / z-index magic number / Modal
npm run ui:test             # 无头 Edge UI 回归：滚动条兜底、z-index 契约、右键/关闭
npm run ui:shot -- --target desktop
npm run ui:shot -- --recipe desktop-panels
npm run ui:shot -- --recipe desktop-music-library --show-scrollbars  # 截图显示滚动条
```

改任何 UI 之前先截图/布局审计，用法见 [`../tools/ui/README.md`](../tools/ui/README.md)。
不要靠读 CSS 猜；历史上面板高度收缩、按钮被挤成两排、文字被裁、弹窗被祖先裁剪
都是截图后才定位的。`ui:check` 与 `ui:test` 已接入 CI，发布前会拦住回归。

## 6. 与 PWA 的边界

PWA 通过 Vite alias 把本目录的 `components/` / `stores/` / `api/` **原样编译**进 PWA。
因此：

- 不要在 `src/pwa/` 里复制组件；
- 改本目录的组件/store 时，默认 PWA 会同步生效；
- 只有浏览器做不到的能力（本地文件、前台检测、系统级下载）才在 PWA 层做降级。
