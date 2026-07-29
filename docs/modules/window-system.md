# 窗口系统模块文档

> 模块归属：PomoSolo（Tauri 番茄钟）  
> 文档版本：v1.0  
> 适用代码版本：v4.0.0  
> 平台重点：Windows 10 / Windows 11（其他平台部分行为会自动降级）

---

## 1. 模块概述

### 1.1 职责

窗口系统模块负责管理应用所有窗口的生命周期、外观（圆角、阴影、透明、边框）、交互（拖动、最小化、关闭、置顶）以及运行时形态切换（主模式 ↔ 迷你模式、主窗口 ↔ 菜园子窗口）。

具体包括：

- 窗口创建与初始化（主窗口 `main`、菜园子窗口 `garden`）。
- 无边框 + 透明背景下的圆角与阴影渲染方案（解决 Windows DWM 系统级圆角与细线边框问题）。
- 自定义窗口控制按钮（关闭、最小化、置顶）。
- 迷你模式切换：在 CSS 层隐藏主界面 + Rust 层调整窗口尺寸/置顶/任务栏显示。
- 拖动区域声明（`-webkit-app-region: drag` 与 `data-tauri-drag-region`）。
- 多窗口协同（菜园子作为独立 `label: "garden"` 窗口，按需 show/hide）。

### 1.2 范围

| 范围内 | 范围外 |
|---|---|
| Tauri 窗口配置（tauri.conf.json） | 业务计时逻辑 |
| Rust 窗口命令（window.rs） | 音乐播放器业务逻辑（仅涉及其 z-index/overflow 与窗口系统的交互） |
| 前端窗口 API 封装（api/window.ts） | 模态框业务内容（仅涉及层叠上下文约束） |
| 顶层布局容器样式（`.window-frame` / `.container` / `.main-content`） | 各功能面板内部样式 |
| DWM 系统级圆角/边框处理 | 应用图标、打包配置 |

---

## 2. 架构图

### 2.1 窗口层级

应用运行时存在两个独立的 Tauri 窗口，二者互不嵌套：

```
┌─────────────────────────────────────────────────────────────────┐
│  Tauri 进程                                                      │
│                                                                  │
│  ┌─────────────────────────┐      ┌────────────────────────┐    │
│  │  窗口 "main" (默认)      │      │  窗口 "garden"          │    │
│  │  index.html             │      │  garden.html            │    │
│  │  520 × 560              │      │  400 × 520              │    │
│  │  decorations: false     │      │  decorations: false     │    │
│  │  transparent: true      │      │  transparent: true      │    │
│  │  shadow: false          │      │  shadow: false          │    │
│  │  visible: 默认显示       │      │  visible: false (按需)   │    │
│  └─────────────────────────┘      └────────────────────────┘    │
│           ↑                                ↑                     │
│           │ Rust 命令                       │ Rust 命令            │
│  enter/exit_mini_mode              show/hide_garden_window       │
│  minimize/close/set_always_on_top  disable_window_rounding       │
│  bring_to_front / cancel_always_on_top                          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 主窗口 DOM 层级与样式职责

```
body (flex 居中, background: transparent)
└── #app (100% × 100%, transparent)
    └── .window-frame                      ← 外层裁剪容器
          │  width:520  height:560
          │  border-radius:20px
          │  overflow:hidden               ← 圆角裁剪发生在这一层
          │  box-shadow:0 8px 32px ...     ← 应用阴影
          │
          ├── (mini-mode-active 时) 移除 border-radius / overflow / box-shadow
          │
          ├── <MiniMode v-if="visible">    ← 迷你模式番茄（绝对定位，z-index:1000）
          │     └── .mini-draggable [data-tauri-drag-region]
          │
          └── .container (v-show="!miniModeVisible")   ← 实际背景层
                │  width:100% height:100%
                │  border-radius:20px      ← 与外层一致，避免双层圆角缝隙
                │  overflow:hidden         ← 统一裁剪所有内部浮层/遮罩
                │  background: linear-gradient(...)
                │  display:flex
                │
                ├── .draggable             ← 顶部 35px 拖动区 (-webkit-app-region:drag)
                ├── <WindowControls>       ← 右上 关闭/最小化 (z-index:100)
                ├── <PinButton>            ← 右上 置顶
                ├── <ModeSlider>           ← 左上 模式拨杆
                ├── .sidebar               ← 左侧 160px (可收起至 0)
                ├── <SidebarCollapse>      ← 侧边栏收起按钮 (left:160px)
                │
                ├── .main-content          ← 右侧主区域
                │     │  flex:1
                │     │  z-index:1         ← ⚠ 创建独立层叠上下文（关键）
                │     │  ⚠ 不设 overflow:hidden（否则裁剪音乐弹框）
                │     ├── <HeaderButtons>
                │     ├── .timer-section
                │     │     └── <MusicPlayer>  ← z-index:200（被约束在 main-content 内）
                │     └── ...
                │
                └── 各 Modal 组件
                      └── .app-modal-overlay   ← 全局类，z-index:3000，相对 .container 定位
```

### 2.3 关键层级数值速查

| 元素 | z-index | 所在层叠上下文 | 备注 |
|---|---|---|---|
| `.draggable` | 1 | `.container` | 顶部拖动区，低于按钮但高于背景 |
| `.sidebar-collapse-btn` | 10 | `.container` | 侧边栏收起按钮 |
| `.main-content` | 1 | `.container` | **创建独立层叠上下文** |
| `<MusicPlayer>` | 200 | `.main-content`（因父级 z-index:1 形成上下文） | 被约束在 main-content 内 |
| `<WindowControls>` 按钮 | 100 | `.container` | 始终可点击 |
| `.app-modal-overlay` | 3000 | `.container` | 全局遮罩，高于一切业务元素 |
| `<MiniMode>` | 1000 | `.window-frame` | 迷你模式覆盖主界面 |

---

## 3. 关键配置说明（tauri.conf.json）

主窗口配置（`app.windows[0]`，默认 `label: "main"`）：

```jsonc
{
  "title": "PomoSolo",
  "width": 520,
  "height": 560,
  "resizable": false,        // 禁止用户拖拽改变尺寸（迷你模式通过 Rust 命令显式 set_size）
  "center": true,            // 启动时居中
  "minimizable": true,       // 允许最小化（迷你模式运行时通过 set_minimizable(false) 临时禁用）
  "maximizable": false,      // 番茄钟固定尺寸，不需要最大化
  "fullscreen": false,
  "decorations": false,      // ⚠ 关键：移除系统标题栏与边框
  "transparent": true,       // ⚠ 关键：允许 webview 背景透明，露出 CSS 圆角外的区域
  "shadow": false,           // ⚠ 关键：禁用 DWM 系统阴影（避免细线尖角边框）
  "alwaysOnTop": false
}
```

菜园子窗口配置（`app.windows[1]`，`label: "garden"`）：

```jsonc
{
  "label": "garden",
  "title": "菜园子",
  "url": "garden.html",      // 独立入口 HTML，与主窗口隔离
  "width": 400,
  "height": 520,
  "resizable": false,
  "center": true,
  "decorations": false,
  "transparent": true,
  "shadow": false,
  "visible": false           // 启动时隐藏，由 show_garden_window 命令显式唤起
}
```

### 字段含义与取舍

| 字段 | 值 | 作用 | 为什么这样选 |
|---|---|---|---|
| `decorations` | `false` | 去掉系统标题栏、边框、最小化/关闭按钮 | 自定义 `WindowControls.vue`，并实现圆角外观 |
| `transparent` | `true` | 让 webview 根元素之外的区域透明 | CSS 圆角外侧需要露出桌面，而不是被白色/系统色填充 |
| `shadow` | `false` | 禁用 DWM 系统级阴影 | Windows 下 DWM 阴影会以细线尖角形式出现在圆角外侧（见踩坑 #2）。改由 CSS `box-shadow` 提供阴影 |
| `resizable` | `false` | 禁止拖拽改尺寸 | 主窗口固定 520×560，迷你模式由 Rust 显式控制 |
| `visible`（garden） | `false` | 启动不显示 | 菜园子按需打开，避免启动时多窗 |

> ⚠ 注意：`transparent: true` 要求 `decorations: false`，二者必须同时成立。  
> ⚠ `transparent: true` 在 macOS 上需要额外开启 `macos-private-mode`，本文档以 Windows 为主。

---

## 4. 关键代码位置索引

| 关注点 | 文件 | 行号 / 标识 |
|---|---|---|
| 主/菜园子窗口声明 | `src-tauri/tauri.conf.json` | `app.windows[0]` / `app.windows[1]` |
| 窗口命令注册 | `src-tauri/src/lib.rs` | `invoke_handler!` 中 `commands::window::*`（24-32 行） |
| 启动时禁用 DWM 圆角 | `src-tauri/src/lib.rs` | `setup` 闭包内 `#[cfg(windows)]` 块（87-95 行） |
| `disable_window_rounding` 实现 | `src-tauri/src/commands/window.rs` | 92-111 行（`DwmSetWindowAttribute` + `DWMWCP_DONOTROUND`） |
| 关闭/最小化/置顶命令 | `src-tauri/src/commands/window.rs` | `close_window` / `minimize_window` / `set_always_on_top` / `bring_to_front` / `cancel_always_on_top` |
| 菜园子窗口 show/hide | `src-tauri/src/commands/window.rs` | `show_garden_window` / `hide_garden_window` |
| 迷你模式进入/退出 | `src-tauri/src/commands/window.rs` | `enter_mini_mode`（60-67）/ `exit_mini_mode`（73-80） |
| windows crate 依赖（DWM 调用） | `src-tauri/Cargo.toml` | `[target.'cfg(windows)'.dependencies] windows = { version = "0.58", features = [..., "Win32_Graphics_Dwm"] }` |
| 前端窗口 API 封装 | `src/api/window.ts` | 全文件 |
| 顶层布局容器样式 | `src/App.vue` | `.window-frame`（397-417）/ `.container`（424-436）/ `.main-content`（705-715） |
| 全局 body/#app 样式 | `src/styles/global.css` | `html, body, #app`（61-71）/ `body`（73-80）/ `.app-modal-overlay`（120-130） |
| 窗口控制按钮 | `src/components/WindowControls.vue` | 全文件 |
| 迷你模式组件 | `src/components/MiniMode.vue` | `.mini-draggable` 含 `data-tauri-drag-region`（31 行） |
| 侧边栏收起按钮 | `src/components/SidebarCollapse.vue` | 全文件 |
| 最小化 → 迷你模式联动 | `src/App.vue` | `onMinimize`（207-220） |
| 迷你模式切换前端逻辑 | `src/App.vue` | `exitMiniMode`（201-204）/ `miniModeVisible` ref（72） |

---

## 5. 踩坑记录（最重要）

> 本节是模块文档的核心。每个坑按 **现象 → 根因 → 错误尝试 → 正确方案** 四段式记录。

### 坑 #1：双层圆角问题（外层系统圆角 + 内层 CSS 圆角，中间透明缝隙）

**现象**

在 Windows 11 上，窗口四角可见"两层圆角"：外侧是系统画的约 8px 圆角，内侧是 CSS 定义的 20px 圆角。两层圆角之间是一圈透明缝隙（露出桌面），并且外侧系统圆角处常伴随一条细线描边。视觉上窗口角部像"被切了一刀又补了一块"。

**根因**

Windows 11 22000+ 在 `decorations: false` + `transparent: true` 下，**仍然会默认应用 DWM 系统级窗口圆角**（约 8px，对应 `DWMWCP_ROUND`）。Tauri 的 `transparent: true` 让 webview 之外的像素透明，于是系统圆角与 CSS 圆角同时存在但半径不同，中间区域既不属于系统绘制的圆角填充，也不属于 CSS 圆角填充，形成透明缝隙。

**错误尝试**

1. 调大 CSS `border-radius`（例如改成 30px）期望"盖住"系统圆角 → 缝隙更宽，且系统圆角外的细线依然可见。
2. 给 `.window-frame` 加 `background` 填充透明缝隙 → 透明缝隙被填上颜色，但系统圆角外的细线尖角依然存在；且失去透明效果。
3. 给 `body` 加背景色 → 同上，且破坏迷你模式番茄造型（番茄外的区域不再是透明桌面）。

**正确方案**

显式调用 Win32 API 关闭系统圆角，让圆角完全由 CSS 负责。见 `disable_window_rounding()`（`window.rs` 92-111 行）：

```rust
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
};
// 将圆角偏好设为 DWMWCP_DONOTROUND
DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &preference, ...);
```

在 `lib.rs` 的 `setup` 中对 `main` 和 `garden` 两个窗口分别调用。

> ⚠ 关键：本项目直接依赖 `windows = "0.58"`，而 Tauri 2.11 内部依赖 `windows 0.61`，两者的 `HWND` 是不同类型。必须通过 `window.hwnd().0` 取出原始 `*mut c_void` 指针，再用本 crate 的 `HWND` 重新构造来桥接（见 `window.rs` 99-100 行）。

---

### 坑 #2：系统级细线尖角边框（DWM 阴影）

**现象**

即使关闭了系统圆角（坑 #1），窗口边缘仍可见一条 1px 左右的细线，且四个角是尖角（不是圆角）。这条细线在浅色桌面下尤其明显。

**根因**

这是 Windows DWM 为无边框窗口默认绘制的系统阴影/边框。在 `decorations: false` 下，DWM 仍会以"老式阴影"形式沿窗口矩形绘制一条细线，且因为它是按窗口矩形（尖角）绘制的，所以四个角呈现尖角。

**错误尝试**

1. 在 Rust 里用 `SetWindowLongW` 修改窗口样式，加上 `WS_THICKFRAME` 来"消除"边框 → **见坑 #3，这是反向操作，会让 DWM 回退到老式渲染**。
2. 尝试 `WS_POPUP` 风格 → 在某些 Windows 版本上仍有细线，且会破坏透明效果。
3. 在 CSS 里给 `.window-frame` 加 `outline` 或 `border` 覆盖 → 治标不治本，系统细线在 CSS 之外（DWM 层）绘制，CSS 无法盖住。

**正确方案**

在 `tauri.conf.json` 中设置 `shadow: false`，直接禁用 DWM 系统阴影。阴影改由 CSS `box-shadow` 提供：

```jsonc
// tauri.conf.json
"shadow": false
```

```css
/* App.vue .window-frame */
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
```

`shadow: false` 会让 DWM 不再绘制任何系统级边框/阴影，窗口像素完全由 webview 决定，细线尖角问题彻底消失。

---

### 坑 #3：为什么不能用 WS_THICKFRAME 移除边框（会让 DWM 回退到老式渲染）

**现象**

某次尝试在 `setup` 中用 Win32 API 给窗口加 `WS_THICKFRAME` 风格，期望"强制系统重新计算边框"。结果窗口出现传统的 Windows 边框（带标题栏高度感的上边框），圆角消失，DWM 阴影变成 Windows 7 风格的硬阴影。

**根因**

`WS_THICKFRAME` 在 Win32 语义里是"可调整大小的边框"。一旦加上该风格，DWM 会认为这是一个"传统可缩放窗口"，于是**回退到老式边框渲染路径**：绘制完整边框、关闭现代圆角、改用 GDI 风格阴影。这与我们追求的"完全无边框 + CSS 圆角 + CSS 阴影"目标完全相反。

**错误尝试**

1. `SetWindowLongW` 加 `WS_THICKFRAME` → 出现老式边框（如上）。
2. 加 `WS_THICKFRAME` 后再立刻 `SetWindowPos` 移除 → 闪烁，且 DWM 状态已被污染，需重启窗口才恢复。
3. 同时加 `WS_POPUP | WS_THICKFRAME` → 行为不一致，不同 Windows 版本表现不同。

**正确方案**

**不要在 Rust 里手动修改窗口样式**。`lib.rs` 的 `setup` 中有明确注释（84-86 行）：

```rust
// 系统边框（细线阴影）由 tauri.conf.json 的 `shadow: false` 配置移除，
// 不要在此处修改窗口样式（WS_THICKFRAME 等），否则 DWM 会回退到老式边框渲染。
```

正确组合是：`tauri.conf.json` 三件套 `decorations:false + transparent:true + shadow:false`，加上 `disable_window_rounding()` 关闭系统圆角。**完全不碰 Win32 窗口样式**。

---

### 坑 #4：Windows 11 DWM 圆角偏好设置

**现象**

坑 #1 中提到的 `DwmSetWindowAttribute` 调用，在 Windows 10 上无效（Win10 无系统圆角），在 Windows 11 上有效但需要正确的属性常量与版本判断。

**根因**

`DWMWA_WINDOW_CORNER_PREFERENCE` 是 Windows 11 22000+ 才引入的 DWM 属性。可选值：

| 常量 | 值 | 含义 |
|---|---|---|
| `DWMWCP_DEFAULT` | 0 | 跟随系统设置 |
| `DWMWCP_DONOTROUND` | 1 | 不圆角（本项目使用） |
| `DWMWCP_ROUND` | 2 | 小圆角（~8px） |
| `DWMWCP_ROUNDSMALL` | 3 | 更小圆角 |

**错误尝试**

1. 用 `DWMWA_WINDOW_CORNER_PREFERENCE` 的旧数值常量 → 编译失败或行为不符。
2. 在 `setup` 之前调用 → 窗口句柄尚未就绪，`hwnd()` 返回 `None`。
3. 只对 `main` 窗口调用，忘记 `garden` → 菜园子窗口仍有系统圆角。

**正确方案**

在 `setup` 闭包中（窗口已创建）对两个窗口都调用，并用 `#[cfg(windows)]` 条件编译保证跨平台可编译：

```rust
.setup(|_app| {
    #[cfg(windows)]
    {
        if let Some(main_window) = _app.get_webview_window("main") {
            commands::window::disable_window_rounding(&main_window);
        }
        if let Some(garden_window) = _app.get_webview_window("garden") {
            commands::window::disable_window_rounding(&garden_window);
        }
    }
    Ok(())
})
```

非 Windows 平台提供空实现（`window.rs` 113-114 行），避免编译错误。

---

### 坑 #5：正确方案总览 — shadow:false + disable_window_rounding + .container border-radius + overflow:hidden

**现象**

综合坑 #1~#4，最终需要一个稳定、可复现的配置组合，让 Windows 10/11 上都能呈现"纯 CSS 圆角 + CSS 阴影 + 无系统边框"。

**根因**

Windows 的窗口外观由三层决定：(1) Tauri 配置 → (2) DWM 系统级渲染 → (3) webview/CSS 渲染。三层必须一致协作，任一层"擅自"绘制都会留下痕迹。

**正确方案（最终组合）**

| 层 | 配置 | 文件 |
|---|---|---|
| Tauri 配置 | `decorations:false`、`transparent:true`、`shadow:false` | `tauri.conf.json` |
| DWM 系统级 | `DwmSetWindowAttribute(DWMWCP_DONOTROUND)` 在 `setup` 中调用 | `lib.rs` + `window.rs` |
| webview/CSS | `.window-frame` 与 `.container` **同** `border-radius:20px` + **同** `overflow:hidden`，阴影由 `.window-frame` 的 `box-shadow` 提供 | `App.vue` |

**为什么 `.window-frame` 和 `.container` 都要设 `border-radius` + `overflow:hidden`？**

- `.window-frame` 的 `overflow:hidden` 负责把 `box-shadow` 之外的圆角裁剪掉（实际阴影由 `box-shadow` 在元素外部绘制，不受 `overflow:hidden` 影响）。
- `.container` 的 `border-radius` + `overflow:hidden` 负责裁剪内部所有内容（渐变背景、Modal 遮罩的暗色背景、浮层），避免它们在圆角处露出方形不透明痕迹。
- 二者 `border-radius` 必须一致（都是 20px），否则又会出现"双层圆角缝隙"（这次是两层 CSS 圆角之间的缝隙）。
- `.container` 填满 `.window-frame`（`width:100%; height:100%`），所以不会产生透明间隙。

---

### 坑 #6：main-content overflow:hidden 会裁剪音乐播放器弹框（被误认为侧边栏遮挡）

**现象**

音乐播放器的输出设备下拉、播放列表浮层、音量滑块弹出后，部分被裁剪。最初怀疑是左侧 `.sidebar` 在 z-index 上"遮挡"了播放器弹框，尝试给播放器加高 z-index 无效。

**根因**

真正的裁剪源是 `.main-content` 上的 `overflow:hidden`（如果误加）。音乐播放器绝对定位在 `.main-content` 底部，其弹框（设备列表、播放列表）需要向上展开并可能超出 `.main-content` 的边界。一旦 `.main-content` 设了 `overflow:hidden`，超出部分被物理裁剪，视觉上和"被侧边栏遮挡"非常相似，但本质完全不同。

**错误尝试**

1. 给 `<MusicPlayer>` 不断加大 `z-index`（100 → 200 → 9999）→ 无效，因为问题不是层叠而是裁剪。
2. 给 `.sidebar` 设 `z-index:-1` → 破坏侧边栏按钮交互，问题依旧。
3. 给 `.main-content` 加 `overflow:visible` 但同时保留圆角裁剪需求 → 矛盾。

**正确方案**

**`.main-content` 不设 `overflow:hidden`**（见 `App.vue` 705-715 行注释）。圆角裁剪的职责完全交给 `.container` 的 `overflow:hidden` 统一负责。`.main-content` 只负责布局（flex）和层叠上下文（`z-index:1`，见坑 #7）。

```css
/* App.vue */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  padding-bottom: 10px;
  position: relative;
  z-index: 1;          /* 创建层叠上下文，见坑 #7 */
  min-width: 0;
  /* ⚠ 不要设 overflow:hidden，否则音乐播放器弹框被裁剪 */
}
```

> 排查要点：如果某个弹框"看起来被遮挡"，先检查父级链路上是否有 `overflow:hidden`，而不是先调 `z-index`。

---

### 坑 #7：z-index 层叠上下文 — .main-content 需要 z-index:1 创建上下文，否则内部 z-index:200 会越过外层 z-index:3000 的 Modal

**现象**

音乐播放器（`z-index:200`）在某些情况下会浮在模态框遮罩（`.app-modal-overlay` `z-index:3000`）之上，看起来"穿透"了遮罩。尝试给 Modal 加再高的 z-index（9999）也压不住。

**根因**

CSS `z-index` 只在**同一个层叠上下文**内才有意义。如果 `.main-content` 没有创建独立的层叠上下文，那么 `<MusicPlayer>` 的 `z-index:200` 会直接参与外层 `.container` 的层叠竞争，与 `.app-modal-overlay` 的 `z-index:3000` 同处一个上下文 —— 表面上 200 < 3000 应该没问题。

但实际陷阱在于：`.main-content` 是 `.container` 的 flex 子元素，且设置了 `position:relative`。如果没有显式 `z-index:1`，`.main-content` 不形成层叠上下文，其内部的 `z-index:200` 元素会"逃逸"到外层参与竞争；而 `.app-modal-overlay` 虽然数值更高，但浏览器对"已定位且 z-index 非 auto 的元素"与"未形成上下文的子元素"的层叠顺序处理存在边界 case，特别是当 MusicPlayer 内部还有自己的 `position:relative` + `transform` 时，可能形成意外的"伪上下文"导致顺序错乱。

**错误尝试**

1. 给 `.app-modal-overlay` 不断加大 `z-index`（3000 → 9999 → 99999）→ 仍偶发穿透。
2. 给 `<MusicPlayer>` 设 `z-index:-1` → 播放器被侧边栏遮挡，且交互失效。
3. 给 `.container` 设 `isolation:isolate` → 部分场景有效，但不解决 main-content 内部元素逃逸问题。

**正确方案**

给 `.main-content` 设 `z-index:1`（+ `position:relative`）**显式创建独立层叠上下文**。这样 `<MusicPlayer>` 的 `z-index:200` 被约束在 `.main-content` 上下文内，其对外层 `.container` 的"等效 z-index"就是 `.main-content` 的 1，远低于 `.app-modal-overlay` 的 3000，永远不会穿透。

```css
/* App.vue .main-content */
position: relative;
z-index: 1;   /* ⭐ 创建独立层叠上下文，约束内部 MusicPlayer(z-index:200) */
```

> 规则记法：**想用 z-index 压住别人的子元素，要么把自己提到更高的上下文，要么给对方的父级创建上下文把它"关进去"。** 本项目选择后者。

---

### 坑 #8：迷你模式切换 — 需要 v-show 隐藏主界面 + Rust 调整窗口尺寸

**现象**

进入迷你模式时，希望窗口从 520×560 缩小到 180×220 并显示番茄造型。最初只调了 Rust 的 `set_size`，结果主界面内容被压缩变形，番茄造型无法显示；或者只在前端切换显示，结果窗口尺寸不变，番茄造型周围全是空白主界面。

**根因**

迷你模式涉及两个必须协同的维度：

1. **OS 窗口尺寸**：必须由 Rust 调用 `set_size(LogicalSize::new(180.0, 220.0))`。
2. **webview 内部内容**：必须用 `v-show` 隐藏 `.container`，并用 `v-if`/`v-show` 显示 `<MiniMode>`。

两者缺一不可。只调 Rust 尺寸，webview 内容仍是 520×560 的主界面被强行塞进 180×220，布局错乱；只切换前端，窗口物理尺寸仍是 520×560，番茄造型只占左上角，右侧大片空白且 body 的 flex 居中会把 `.window-frame` 居中导致 MiniMode 被推出视口。

**错误尝试**

1. 只调 Rust `set_size` → 主界面被挤压变形。
2. 只切换前端 `v-show` → 窗口尺寸不变，空白。
3. 用 `v-if` 销毁 `.container` 再重建 → 重建后状态丢失（计时器、播放器状态等），且重建有闪烁。
4. 在 `.window-frame` 上保留固定 520×560 → body flex 居中后 MiniMode 偏移。

**正确方案**

四步协同：

1. **前端**：`.container` 用 `v-show="!miniModeVisible"` 隐藏（保留 DOM，不丢状态）；`<MiniMode>` 用 `v-if="props.visible"` 显示。
2. **前端**：`.window-frame` 在 `mini-mode-active` 时切换为 180×220，并移除 `border-radius`/`overflow:hidden`/`box-shadow`/`border`（让番茄造型不被外框裁剪）：

```css
.window-frame.mini-mode-active {
  width: 180px;
  height: 220px;
  border-radius: 0;
  overflow: visible;
  box-shadow: none;
  border: none;
}
```

3. **Rust**：`enter_mini_mode` 调整窗口尺寸 + 置顶 + 禁止最小化 + 从任务栏隐藏：

```rust
window.set_size(LogicalSize::new(180.0, 220.0));
window.set_always_on_top(true);
window.set_minimizable(false);
window.set_skip_taskbar(true);
```

4. **前端 API**：`src/api/window.ts` 的 `enterMiniMode()`/`exitMiniMode()` 封装 `invoke` 调用。

**触发入口**（`App.vue` 207-220 行）：最小化按钮在计时器运行 + 设置为 `minimizeBehavior === "tray"` 时进入迷你模式，否则走真正的 `minimize_window`。

```ts
async function onMinimize() {
  if (timer.isRunning && settings.settings.minimizeBehavior === "tray") {
    miniModeVisible.value = true;
    void enterMiniModeApi();
  } else {
    await minimizeWindow();
  }
}
```

退出迷你模式由 `<MiniMode>` 的 `⬆` 按钮触发 `expand` 事件 → `exitMiniMode()`（前端置 `miniModeVisible=false` + 调 `exitMiniModeApi()` 恢复 520×560）。

> 注意 `LogicalSize` 用的是 CSS 像素，会随 DPI 缩放。迷你模式 180×220 与 CSS 的 `.mini-mode` 尺寸一致，DPI 缩放下不会错位。

---

### 坑 #9：迷你模式拖动 — data-tauri-drag-region

**现象**

迷你模式下番茄窗口无法用鼠标拖动。主界面用 `-webkit-app-region: drag`（在 `.draggable` 上）能正常拖动，但迷你模式是另一套 DOM，没有继承该样式。

**根因**

Tauri 2 的窗口拖动有两种声明方式：

1. CSS：`-webkit-app-region: drag`（WebView2/Tauri 通用，主界面使用）。
2. HTML 属性：`data-tauri-drag-region`（Tauri 2 推荐方式，更语义化）。

`<MiniMode>` 是独立组件，且其根元素 `.mini-mode` 是装饰性背景（番茄造型），不能整体设为 drag（否则按钮无法点击）。需要一个透明的覆盖层专门承担拖动。

**错误尝试**

1. 给 `.mini-mode` 根元素加 `-webkit-app-region: drag` → 番茄上的"展开"按钮无法点击（drag 区域拦截事件）。
2. 给 `.mini-tomato` 加 drag → 同上，且进度环 SVG 也无法交互。
3. 不加任何 drag 声明 → 完全无法拖动。

**正确方案**

在 `<MiniMode>` 内部放一个透明全屏覆盖层 `.mini-draggable`，并打上 `data-tauri-drag-region`：

```html
<div v-if="props.visible" class="mini-mode">
  <div class="mini-draggable" data-tauri-drag-region></div>
  <!-- 叶子、番茄、按钮等 z-index 高于 .mini-draggable -->
</div>
```

```css
.mini-draggable {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 8;   /* 低于按钮(10)、番茄主体(2)... 等需要交互的元素需高于 8 */
}
```

**z-index 排布要点**（见 `MiniMode.vue`）：

- `.mini-draggable` z-index: 8（承担拖动，但让出按钮区域）。
- `.btn-expand-mini` z-index: 10（展开按钮可点击）。
- `.mini-leaves` z-index: 5、`.mini-tomato` z-index: 2（装饰，在 drag 层之下，不拦截拖动）。

这样：鼠标在番茄主体任意位置按下都能拖动（因为 `.mini-draggable` 覆盖全屏且 z-index 高于装饰），但展开按钮（z-index:10 > 8）仍可点击。

> ⚠ `data-tauri-drag-region` 是 Tauri 2 推荐方式，比 `-webkit-app-region: drag` 更稳定（后者在某些 WebView2 版本下与点击事件冲突）。主界面 `.draggable` 仍用 CSS 方式是出于历史兼容，新代码（MiniMode）优先用 `data-tauri-drag-region`。

---

## 6. 最终配置清单（一劳永逸的配置组合）

复制以下组合到新 Tauri 项目即可获得一致的"无边框圆角透明窗口"体验。

### 6.1 `tauri.conf.json`（窗口字段）

```jsonc
{
  "app": {
    "windows": [
      {
        "label": "main",            // 可省略，默认即 main
        "title": "YourApp",
        "width": 520,
        "height": 560,
        "resizable": false,
        "center": true,
        "minimizable": true,
        "maximizable": false,
        "fullscreen": false,
        "decorations": false,       // ⭐ 必须false
        "transparent": true,        // ⭐ 必须true
        "shadow": false,            // ⭐ 必须false（禁用 DWM 细线边框）
        "alwaysOnTop": false
      }
    ]
  }
}
```

### 6.2 `Cargo.toml`（windows crate 依赖）

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_Graphics_Dwm",        # ⭐ DwmSetWindowAttribute
] }
```

> 若 Tauri 升级导致内部 windows crate 版本变动，注意 `HWND` 类型桥接（见坑 #1）。

### 6.3 Rust：`disable_window_rounding` 函数

完整代码见 `src-tauri/src/commands/window.rs` 92-111 行。关键点：

```rust
#[cfg(windows)]
pub fn disable_window_rounding(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    };
    if let Ok(hwnd) = window.hwnd() {
        // ⭐ 桥接 Tauri 内部 windows 0.61 的 HWND 到本项目 windows 0.58 的 HWND
        let hwnd = HWND(hwnd.0 as *mut std::ffi::c_void);
        let preference = DWMWCP_DONOTROUND;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &preference as *const _ as *const std::ffi::c_void,
                std::mem::size_of_val(&preference) as u32,
            );
        }
    }
}

#[cfg(not(windows))]
pub fn disable_window_rounding(_window: &tauri::WebviewWindow) {}
```

### 6.4 Rust：`setup` 中对所有窗口调用

```rust
.setup(|_app| {
    #[cfg(windows)]
    {
        for label in ["main", "garden"] {
            if let Some(w) = _app.get_webview_window(label) {
                commands::window::disable_window_rounding(&w);
            }
        }
    }
    Ok(())
})
```

### 6.5 CSS：三层容器样式

```css
/* 全局：html/body/#app 必须透明 */
html, body, #app {
  width: 100%; height: 100%;
  overflow: hidden;
  background: transparent;     /* ⭐ 必须transparent */
}
body {
  background: transparent;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
}

/* 外层裁剪容器：负责圆角裁剪 + 阴影 */
.window-frame {
  width: 520px; height: 560px;
  border-radius: 20px;
  overflow: hidden;            /* ⭐ 裁剪圆角 */
  position: relative;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);   /* ⭐ CSS 提供阴影（替代 DWM） */
}

/* 内层背景容器：与外层同 border-radius + overflow:hidden */
.container {
  width: 100%; height: 100%;
  border-radius: 20px;         /* ⭐ 必须与 .window-frame 一致 */
  overflow: hidden;            /* ⭐ 裁剪内部浮层/遮罩 */
  background: linear-gradient(135deg, var(--c1), var(--c2));
  position: relative;
  display: flex;
}

/* 主内容区：创建层叠上下文，不设 overflow:hidden */
.main-content {
  flex: 1;
  position: relative;
  z-index: 1;                  /* ⭐ 约束内部高 z-index 元素 */
  /* ⚠ 不要 overflow:hidden */
}

/* 模态遮罩：全局类，相对 .container 定位 */
.app-modal-overlay {
  position: absolute;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
```

---

## 7. 常见问题排查

> 按"如果出现 X 现象，检查 Y"的格式编排。

### Q1：窗口四个角是尖角，且有一条细线描边

- **检查 1**：`tauri.conf.json` 是否设了 `"shadow": false`。若为 `true`，DWM 会绘制细线尖角边框。
- **检查 2**：`setup` 中是否调用了 `disable_window_rounding`。
- **检查 3**：是否在 Rust 里偷偷加了 `WS_THICKFRAME` 等窗口样式（会让 DWM 回退老式渲染）。移除任何 `SetWindowLongW` 修改样式的代码。

### Q2：圆角处可见透明缝隙（露出桌面）

- **检查 1**：`.window-frame` 和 `.container` 的 `border-radius` 是否一致。不一致会产生"双层圆角缝隙"。
- **检查 2**：`.container` 是否 `width:100%; height:100%` 填满 `.window-frame`。若有 margin/padding 导致未填满，中间会露出透明区。
- **检查 3**：`disable_window_rounding` 是否真的执行了（Windows 11 上 `DwmSetWindowAttribute` 失败会静默返回错误，可临时把 `let _ =` 改成 `dbg!` 检查返回值）。

### Q3：模态框遮罩压不住音乐播放器（播放器浮在遮罩之上）

- **检查 1**：`.main-content` 是否有 `position:relative` + `z-index:1`。缺任一都不会形成层叠上下文，内部 `z-index:200` 会逃逸。
- **检查 2**：`.app-modal-overlay` 是否用了全局类（`src/styles/global.css` 中的 `z-index:3000`）。若组件内自定义了遮罩类，可能没继承 3000。
- **检查 3**：Modal 是否挂在 `.container` 下（而不是 `.main-content` 下）。若挂在 `.main-content` 内，会被 `z-index:1` 上下文困住。

### Q4：音乐播放器的设备列表/播放列表弹出后被裁剪

- **检查 1**：`.main-content` 是否误加了 `overflow:hidden`。移除它。
- **检查 2**：`<MusicPlayer>` 自身是否设了 `overflow:visible`（`MusicPlayer.vue` 334 行）。
- **检查 3**：弹框父级链路（`.music-wrapper` 等）是否 `overflow:visible`。若任一祖先 `overflow:hidden`，弹框会被裁。
- **排查方法**：浏览器 DevTools 选中弹框元素，查看"Computed → overflow"链路，定位第一个 `hidden` 的祖先。

### Q5：进入迷你模式后，番茄造型周围有白色/渐变背景框

- **检查 1**：`.window-frame.mini-mode-active` 是否移除了 `border-radius`/`overflow:hidden`/`box-shadow`/`border`。任一保留都会让外框可见。
- **检查 2**：`.container` 是否真的被 `v-show` 隐藏（检查 `display:none` 是否生效）。
- **检查 3**：`body` 是否 `background:transparent`。若 body 有背景色，番茄外的透明区会显示该色。

### Q6：迷你模式窗口尺寸不对（番茄被裁或周围有空白）

- **检查 1**：Rust `enter_mini_mode` 的 `set_size` 值（`LogicalSize::new(180.0, 220.0)`）是否与 CSS `.mini-mode`（`180px × 220px`）和 `.window-frame.mini-mode-active`（`180px × 220px`）三方一致。
- **检查 2**：是否用了 `LogicalSize` 而非 `PhysicalSize`。`PhysicalSize` 在高 DPI 下会与 CSS 像素不匹配。
- **检查 3**：`exit_mini_mode` 是否恢复 `520.0, 560.0`（与 `tauri.conf.json` 的初始 `width/height` 一致）。

### Q7：迷你模式无法拖动

- **检查 1**：`.mini-draggable` 是否有 `data-tauri-drag-region` 属性。
- **检查 2**：`.mini-draggable` 的 `z-index`（8）是否低于需要交互的元素（展开按钮 10）。若 drag 层 z-index 最高，会拦截所有点击。
- **检查 3**：`.mini-draggable` 是否覆盖了整个 `.mini-mode`（`width:100%; height:100%`）。若尺寸不足，部分区域无法拖动。

### Q8：菜园子窗口仍有系统圆角 / 细线边框

- **检查 1**：`setup` 中是否对 `garden` 窗口也调用了 `disable_window_rounding`（坑 #4 已强调，容易漏）。
- **检查 2**：`garden.html` 对应的 CSS 是否也遵循了三层容器 + `transparent body` 方案（菜园子是独立 webview，不共享 `App.vue` 样式）。

### Q9：DPI 缩放下圆角/阴影错位

- **检查 1**：所有尺寸是否用 CSS px（`border-radius`、`width`、`height`），而非物理像素。
- **检查 2**：Rust `set_size` 是否用 `LogicalSize`（CSS px）而非 `PhysicalSize`。
- **检查 3**：`tauri.conf.json` 的 `width/height` 本身就是逻辑像素，与 `LogicalSize` 一致。

### Q10：开发模式正常，打包后窗口有黑边/白边

- **检查 1**：CSP 是否阻止了某些样式（`tauri.conf.json` 的 `security.csp`）。本项目 CSP 允许 `'unsafe-inline'` 样式，若打包时被收紧，内联 `<style>` 会失效。
- **检查 2**：`transparent: true` 在某些旧版 WebView2 Runtime 下支持不全，提示用户升级 WebView2。
- **检查 3**：打包配置是否意外覆盖了 `tauri.conf.json`（检查 `bundle` 字段与构建脚本）。

---

## 附录：模块文件清单

| 文件 | 角色 |
|---|---|
| `src-tauri/tauri.conf.json` | 窗口声明与外观配置 |
| `src-tauri/Cargo.toml` | windows crate 依赖（DWM 调用） |
| `src-tauri/src/lib.rs` | setup 中调用 `disable_window_rounding`，注册窗口命令 |
| `src-tauri/src/commands/window.rs` | 全部窗口命令实现 + `disable_window_rounding` |
| `src/api/window.ts` | 前端 invoke 封装 |
| `src/App.vue` | 顶层布局容器样式（`.window-frame`/`.container`/`.main-content`）+ 迷你模式联动 |
| `src/styles/global.css` | `body`/`#app` 透明样式 + `.app-modal-overlay` 全局类 |
| `src/components/WindowControls.vue` | 关闭/最小化按钮 |
| `src/components/MiniMode.vue` | 迷你模式番茄造型 + 拖动区 |
| `src/components/SidebarCollapse.vue` | 侧边栏收起按钮（与窗口系统交互较少，主要影响布局） |
