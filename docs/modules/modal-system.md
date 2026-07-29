# Modal 弹窗系统

> 模块文档 · 适用于 Tauri 版 PomoSolo 番茄钟
> 涉及代码：`src/styles/global.css`、`src/App.vue`、`src/components/Modal.vue` 及 9 个业务弹窗组件。

---

## 1. 模块概述

PomoSolo 主窗口是一个 520×560、带 20px 圆角的圆角矩形（`.window-frame` > `.container`）。整个应用有 10+ 个弹窗（设置、统计、AI 助手、登录、自习室、音乐榜单、教程、前台检测警告、下载弹窗、模式切换确认等），如果每个新增弹窗都手动设置 `position / inset / z-index / 暗色背景 / 居中`，会出现三类问题：

1. **暗色遮罩扩散到圆角外**：因为 `position: fixed` 不受 `.container` 的 `overflow:hidden` 裁剪。
2. **圆角处出现尖角状浅色不透明痕迹**：因为 `.container` 没有同时设置 `border-radius + overflow:hidden`。
3. **样式重复**：每个组件都自己写一遍 overlay 样式，z-index 各不相同，互相打架。

本系统的目标是：**新增任何弹窗组件时，无需手动设置 position，直接复用全局 `.app-modal-overlay` 类或 `<Modal>` 组件即可一劳永逸地解决圆角裁剪、z-index、暗色背景、居中、动画五件事。**

---

## 2. 架构图

```
┌─────────────────────────────────────────────────────────────┐
│  <body>                                                     │
│    └─ #app                                                  │
│         └─ .window-frame   (520×560, border-radius:20px,    │
│                            overflow:hidden)                 │
│              ├─ MiniMode               (迷你模式时切换)      │
│              └─ .container   (border-radius:20px,           │
│                              overflow:hidden,               │
│                              position:relative) ★裁剪锚点   │
│                   ├─ .draggable                            │
│                   ├─ WindowControls / PinButton / ModeSlider│
│                   ├─ .sidebar                              │
│                   ├─ .main-content (z-index:1)             │
│                   │     ├─ HeaderButtons                    │
│                   │     ├─ .timer-section                   │
│                   │     └─ MusicPlayer (z-index:200)        │
│                   │                                         │
│                   └─ ★ 浮层弹窗（全部在 .container 内）     │
│                        ├─ <Modal>           z-index:3000    │
│                        │    ├─ AuthPanel                    │
│                        │    ├─ StudyRoom                    │
│                        │    └─ ForegroundWarning            │
│                        ├─ <div class="app-modal-overlay">   │
│                        │    ├─ DownloadDialog  z-index:3100 │
│                        │    └─ Charts 免责声明 z-index:3100 │
│                        └─ 自定义 overlay（历史遗留）         │
│                             ├─ SettingsPanel   z-index:100  │
│                             ├─ Statistics      z-index:100  │
│                             ├─ TutorialModal   z-index:200  │
│                             ├─ AIHelper        z-index:1000 │
│                             └─ Charts 主面板   z-index:1000 │
└─────────────────────────────────────────────────────────────┘
```

**关键点**：

- 所有 Modal 都挂在 `.container` 内部，靠 `.container` 的 `overflow:hidden + border-radius:20px` 把暗色遮罩裁剪在圆角内。
- `.app-modal-overlay` 全局类提供 `position:absolute`（相对 `.container` 定位），被 `.container` 裁剪。
- 历史遗留的自定义 overlay（SettingsPanel/Statistics/Tutorial/AIHelper/Charts）目前各自定义 `position:absolute`，也都在 `.container` 内，所以同样被裁剪——但 z-index 不统一，是后续要清理的对象。

---

## 3. 核心：通用模板

### 3.1 全局通用类 `.app-modal-overlay`

位置：`src/styles/global.css` 第 116–130 行

```css
/* ============ 通用弹窗遮罩模板 ============ */
/* 所有 Modal/浮层组件的遮罩层都应使用此类，或直接使用 <Modal> 组件 */
/* 自动处理：相对 .container 定位 + 被圆角裁剪 + 居中 + 暗色背景 */
/* 新增弹窗组件时只需 <div class="app-modal-overlay"> 即可，无需手动设置 position */
.app-modal-overlay {
  position: absolute;  /* 相对 .container 定位，被 .container 的 overflow:hidden 裁剪在圆角内 */
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
}
```

**这个类做了五件事**：

| 属性 | 值 | 作用 |
|---|---|---|
| `position` | `absolute` | 相对最近的 `position:relative` 祖先（即 `.container`）定位，从而被 `overflow:hidden` 裁剪 |
| `inset` | `0` | 铺满 `.container` |
| `z-index` | `3000` | 高于 `.main-content`(1)、`MusicPlayer`(200)、`HeaderButtons`(100)，作为标准 Modal 层级 |
| `background` | `rgba(0,0,0,0.5)` | 半透明暗色遮罩 |
| `display: flex; align-items: center; justify-content: center` | — | 子元素（弹窗主体）水平垂直居中 |
| `padding: 20px; box-sizing: border-box` | — | 防止弹窗主体贴到 .container 边缘，确保圆角处不留白 |

### 3.2 两种使用方式

#### 方式 A：直接用 `<Modal>` 组件（推荐）

适用于「标准弹窗」——有标题、有关闭按钮、有主体内容、可能带 footer。

`src/components/Modal.vue` 内部已经把根节点写成 `class="app-modal-overlay modal-overlay"`，所以**使用 `<Modal>` 时自动套用全局样式**，无需任何额外配置。

```vue
<Modal
  :visible="isVisible"
  title="标题"
  :close-on-background="true"
  width="420px"
  @close="isVisible = false"
  @update:visible="(v) => (isVisible = v)"
>
  <p>弹窗内容</p>
  <template #footer>
    <button @click="onConfirm">确定</button>
  </template>
</Modal>
```

`<Modal>` 组件自带的便利功能：

- `v-model:visible`（通过 `update:visible` 事件）双向绑定
- `closeOnBackground` 点击遮罩关闭（默认 true）
- `showClose` 显示右上角 × 按钮（默认 true）
- `width` 自定义宽度（写入 `max-width`）
- 监听 ESC 键关闭
- 显示时锁定 `document.body.style.overflow = "hidden"`
- 内置 `<Transition name="modal">` 动画（opacity 0→1 + scale 0.92→1）

**已使用 `<Modal>` 的组件**：`AuthPanel.vue`、`StudyRoom.vue`、`ForegroundWarning.vue`（共 3 个，均通过 `<Modal>` 包裹）。

#### 方式 B：手写 `<div class="app-modal-overlay">`

适用于非标准弹窗（无标题栏、自定义内容、需要覆盖 z-index 等）。

```vue
<template>
  <div
    v-if="visible"
    class="app-modal-overlay my-dialog-overlay"
    @click="onBackdropClick"
  >
    <div class="my-dialog" role="dialog" aria-modal="true">
      <!-- 自定义内容 -->
    </div>
  </div>
</template>

<style scoped>
/* 仅在需要覆盖 z-index 时加一个修饰类 */
.my-dialog-overlay {
  z-index: 3100; /* 高于标准 Modal(3000) */
}

.my-dialog {
  background: #1a1a1a;
  border-radius: 14px;
  padding: 20px;
  width: 100%;
  max-width: 420px;
  /* ... */
}
</style>
```

**已使用方式 B 的组件**：
- `DownloadDialog.vue` — `class="app-modal-overlay download-dialog-overlay"` + `z-index:3100` 覆盖
- `Charts.vue` 内的免责声明子弹窗 — `class="app-modal-overlay charts-disclaimer-overlay"` + `z-index:3100` 覆盖

### 3.3 新增弹窗组件时无需手动设置 position

无论方式 A 还是方式 B，**`.app-modal-overlay` 全局类已经提供 `position:absolute / inset:0 / z-index:3000 / 暗色背景 / 居中 / padding`**，新增组件时只需关注弹窗主体（`.modal-container` 或自定义内层 div）的样式，不需要再写 `position / top / left / right / bottom / z-index / background / display:flex` 等任何 overlay 相关样式。

---

## 4. 关键代码位置索引

| 文件 | 行号 | 内容 |
|---|---|---|
| `src/styles/global.css` | 116–130 | `.app-modal-overlay` 全局通用类定义 |
| `src/App.vue` | 396–404 | `.window-frame`：外层 `border-radius:20px + overflow:hidden` |
| `src/App.vue` | 419–436 | `.container`：内层 `border-radius:20px + overflow:hidden + position:relative` ★ Modal 裁剪锚点 |
| `src/App.vue` | 382–390 | 8 个浮层弹窗在模板中的挂载位置（均在 `.container` 内） |
| `src/components/Modal.vue` | 91–125 | `<Modal>` 组件模板（根节点套用 `.app-modal-overlay`） |
| `src/components/Modal.vue` | 127–228 | `<Modal>` 组件样式 + `modal` Transition 定义 |
| `src/components/Modal.vue` | 22–88 | `<Modal>` 组件逻辑：ESC 监听、body 滚动锁定、背景点击关闭 |
| `src/components/DownloadDialog.vue` | 130–209 | 方式 B 示例：直接用 `.app-modal-overlay` + z-index 覆盖 |
| `src/components/Charts.vue` | 282–312 | Charts 内部免责声明子弹窗（方式 B） |
| `src/components/Charts.vue` | 559–562 | `.charts-disclaimer-overlay { z-index: 3100 }` 覆盖 |
| `src/components/DownloadDialog.vue` | 211–214 | `.download-dialog-overlay { z-index: 3100 }` 覆盖 |

### 各业务弹窗 z-index 实际取值一览

| 组件 | overlay 类 | z-index | 是否符合规范 |
|---|---|---|---|
| `Modal.vue`（标准） | `.app-modal-overlay` | 3000 | ✅ |
| `AuthPanel.vue` | 经 `<Modal>` | 3000 | ✅ |
| `StudyRoom.vue` | 经 `<Modal>` | 3000 | ✅ |
| `ForegroundWarning.vue` | 经 `<Modal>` | 3000 | ✅ |
| `DownloadDialog.vue` | `.app-modal-overlay` + 覆盖 | 3100 | ✅（高于 Modal） |
| `Charts.vue` 免责声明 | `.app-modal-overlay` + 覆盖 | 3100 | ✅（高于 Charts 主面板） |
| `Charts.vue` 主面板 | 自定义 `.charts-modal` | 1000 | ⚠️ 历史遗留，建议迁移到 `.app-modal-overlay` |
| `AIHelper.vue` | 自定义 `.ai-modal` | 1000 | ⚠️ 历史遗留，建议迁移到 `.app-modal-overlay` |
| `SettingsPanel.vue` | 自定义 `.settings-overlay` | 100 | ⚠️ 历史遗留，建议迁移到 `.app-modal-overlay` |
| `Statistics.vue` | 自定义 `.stats-overlay` | 100 | ⚠️ 历史遗留，建议迁移到 `.app-modal-overlay` |
| `TutorialModal.vue` | 自定义 `.tutorial-overlay` | 200 | ⚠️ 历史遗留，建议迁移到 `.app-modal-overlay` |

> **历史遗留组件的问题**：z-index 取值分散（100/200/1000），没有统一规范。所幸它们都使用了 `position:absolute`，所以圆角裁剪没问题，但层级关系是隐式的（依赖 DOM 顺序）。**新增组件一律使用 `.app-modal-overlay` (z-index:3000) 或在修饰类里覆盖为 3100**。

---

## 5. 踩坑记录

### 5.1 暗色背景扩散到圆角外

**现象**

打开任意弹窗后，半透明黑色遮罩不仅在 `.container` 圆角矩形内，还溢出到圆角外，把整个 body 区域都蒙上一层暗色。在 Tauri 透明窗口背景下尤其明显——窗口边缘四个圆角外侧能看到一块块方形暗色斑块。

**根因**

Modal 的遮罩层用了 `position: fixed`。`fixed` 是相对 **视口（viewport）** 定位的，**完全脱离文档流，不会被任何祖先的 `overflow:hidden` 裁剪**。所以 `.container` 的 `border-radius + overflow:hidden` 对它无效，遮罩直接铺满整个浏览器/Tauri 视口（一个矩形），从圆角处溢出。

**错误尝试**

1. 在 `.container` 上加 `overflow:hidden` —— 无效，因为 `position:fixed` 不受祖先 overflow 影响。
2. 给遮罩层加 `border-radius:20px` —— 表面上能裁掉四角，但遮罩层尺寸大于 `.container`，圆角与 `.container` 圆角对不齐，且 `border-radius` 不裁剪子元素，弹窗主体仍会出现在圆角外。
3. 给遮罩层套一层 `.modal-wrapper` 用 `position:absolute` 包裹 `position:fixed` 的内层 —— 增加无意义嵌套，且 fixed 仍然脱离 wrapper。

**正确方案**

遮罩层改为 `position: absolute`，让遮罩相对 `.container`（`position:relative`）定位，从而被 `.container` 的 `overflow:hidden + border-radius` 裁剪在圆角内。

```css
/* ✅ 正确 */
.app-modal-overlay {
  position: absolute;  /* 不用 fixed */
  inset: 0;
  /* ... */
}
```

---

### 5.2 圆角处出现尖角状浅不透明痕迹

**现象**

弹窗打开后，`.container` 的四个圆角处出现一个浅浅的尖角状不透明痕迹（约 1–2px），颜色比遮罩略浅。视觉上像圆角没扣干净。

**根因**

`.container` 只设置了 `overflow:hidden` 没设置 `border-radius`，或只设置了 `border-radius` 没设置 `overflow:hidden`。两者必须同时存在，浏览器才会按圆角路径裁剪子元素。

- 只有 `overflow:hidden` 没 `border-radius`：按矩形裁剪，圆角处的遮罩会被切出方形毛刺。
- 只有 `border-radius` 没 `overflow:hidden`：圆角只是 `.container` 自己的边框形状，不影响内部子元素，遮罩照样溢出到圆角外。

**错误尝试**

1. 给遮罩层加 `border-radius:20px` —— 遮罩层尺寸和 `.container` 一致时勉强对齐，但只要有 `padding` 或边框错位就会出现亚像素缝隙。
2. 给 `.container` 加 `clip-path: inset(0 round 20px)` —— 可行但性能差，且某些 Chromium 版本上有锯齿。

**正确方案**

`.container` 同时设置 `border-radius:20px` 和 `overflow:hidden`，浏览器会用圆角路径裁剪所有子元素（包括 absolute 定位的遮罩层），圆角处干净利落。

```css
/* ✅ 正确 - src/App.vue 第 424–436 行 */
.container {
  width: 100%;
  height: 100%;
  border-radius: 20px;     /* ★ 必须与 .window-frame 一致 */
  overflow: hidden;        /* ★ 必须同时存在 */
  position: relative;      /* ★ 让 .app-modal-overlay 的 absolute 有锚点 */
  background: linear-gradient(...);
}
```

---

### 5.3 一劳永逸方案

把 5.1 和 5.2 的根因合并，得到「一劳永逸」的组合方案：

**`.window-frame` 与 `.container` 双层都加 `border-radius:20px + overflow:hidden`**

```css
/* src/App.vue 第 397–404 行 */
.window-frame {
  width: 520px;
  height: 560px;
  border-radius: 20px;
  overflow: hidden;
  position: relative;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

/* src/App.vue 第 424–436 行 */
.container {
  width: 100%;
  height: 100%;
  border-radius: 20px;   /* 与 .window-frame 一致，不会产生双层圆角缝隙 */
  overflow: hidden;
  position: relative;
  /* ... */
}
```

**为什么需要双层？**

- `.window-frame` 的圆角：裁剪 `.container` 的渐变背景溢出到外层 box-shadow 之外（保险层）。
- `.container` 的圆角：裁剪内部所有 Modal 遮罩层（主裁剪层，因为 `.app-modal-overlay` 是 absolute 相对 `.container` 定位的）。

**为什么不会出现「双层圆角缝隙」？**

`.container` 是 `width:100%; height:100%`，完全填满 `.window-frame`，二者圆角半径相同（20px），圆角路径完全重合，不会出现内外两层圆角的缝隙。

**所有 Modal 都用 `.app-modal-overlay`**：新增弹窗直接 `<div class="app-modal-overlay">` 或 `<Modal>`，无需再关心 position / 裁剪 / 暗色背景 / 居中——这就是「一劳永逸」。

---

### 5.4 所有 Modal 出现时都要有动画

**现象**

如果弹窗直接 `v-if` 切换，没有过渡，会出现「瞬间闪现/消失」的硬切，体验割裂。

**规范**

所有 Modal 出现/消失必须使用统一的 Transition：**遮罩层 opacity 0→1，弹窗主体 scale 0.92→1**，时长 0.25s，缓动函数 `cubic-bezier(0.34, 1.56, 0.64, 1)`（带轻微回弹）。

```css
/* 遮罩层 opacity 过渡 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.25s ease;
}

/* 弹窗主体 scale 过渡（带回弹） */
.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.92);
}
```

**Transition 名称约定**：

| 名称 | 使用者 |
|---|---|
| `modal` | `<Modal>` 组件、`AIHelper.vue`、`Charts.vue` |
| `panel` | `SettingsPanel.vue`、`Statistics.vue`、`TutorialModal.vue` |

> 历史上 `panel` 和 `modal` 两个名称都存在，**新增组件统一用 `modal`**。两者的关键帧完全一致，只是名称不同，不影响视觉效果。

---

### 5.5 garden 窗口的 Modal 保持 `position:fixed`

**现象**

菜园子（garden）窗口是一个**独立窗口**（通过 `showGardenWindow()` Tauri 命令打开的新窗口），不在主窗口的 `.container` 内。如果它的 Modal 也用 `position:absolute`，会找不到 `position:relative` 的祖先，定位错误。

**规范**

garden 窗口内的 Modal（如 `GardenAchievement.vue`、`GardenShop.vue`、`GardenSignin.vue`、`GardenPlantWheel.vue`）**保持 `position:fixed`**，因为它们不在主窗口 `.container` 内，需要相对 garden 窗口的视口定位。

| 场景 | position | 原因 |
|---|---|---|
| 主窗口 `.container` 内的 Modal | `absolute` | 被 `.container` 的 `overflow:hidden` 裁剪到圆角内 |
| garden 窗口的 Modal | `fixed` | 不在 `.container` 内，需相对视口定位 |
| 迷你模式 MiniMode 内的弹层 | （视情况） | MiniMode 不在 `.container` 内 |

**判断口诀**：组件模板是否挂在 `src/App.vue` 的 `.container` 内？是 → `absolute`；否 → `fixed`。

---

### 5.6 z-index 层级规范

**规范层级**（推荐值）：

| 层 | z-index | 用途 | 实现 |
|---|---|---|---|
| 标准内容 | 1–200 | sidebar、main-content、HeaderButtons、MusicPlayer | 各组件 scoped 样式 |
| TutorialModal | 200 | 教程弹窗（历史值，建议提升到 3000） | `.tutorial-overlay` |
| 标准业务弹窗 | 1000 | AIHelper、Charts 主面板（历史值，建议迁移） | 自定义 overlay |
| **标准 Modal** | **3000** | AuthPanel、StudyRoom、ForegroundWarning、DownloadDialog、Modal 通用组件 | `.app-modal-overlay` 全局类 |
| **高层 Modal** | **3100** | 需要在标准 Modal 之上弹出的子对话框 | `.app-modal-overlay` + 修饰类覆盖 |
| LoadingOverlay | 9999 | 全局加载遮罩（必须最高） | `.loading-overlay` |
| MusicPlayer 内部弹层 | 9999（在 main-content 层叠上下文内） | 设备列表、音量条等 | 不会越过 Modal，因为 main-content `z-index:1` 创建了独立层叠上下文 |

**关键设计**：

- `.main-content` 设 `z-index:1` 创建独立层叠上下文，把内部 MusicPlayer 的 `z-index:9999` **约束在 main-content 内**，不会越过外层 `.app-modal-overlay(3000)`。这是「MusicPlayer 设备列表 z-index 高达 9999 却不会盖住 Modal」的根本原因。
- 子对话框（如 `DownloadDialog`、`Charts 免责声明`）需要盖在父弹窗之上，用修饰类覆盖为 `3100`：

```css
/* src/components/DownloadDialog.vue 第 211–214 行 */
.download-dialog-overlay {
  z-index: 3100; /* 高于标准 Modal(3000) */
}

/* src/components/Charts.vue 第 559–562 行 */
.charts-disclaimer-overlay {
  z-index: 3100; /* 高于 Charts 主面板(1000) */
}
```

**新增 Modal 的 z-index 决策树**：

```
这个 Modal 会被另一个 Modal 调用出来吗？
├─ 是（子对话框）  → 用 .app-modal-overlay + 修饰类 z-index:3100
└─ 否（顶层弹窗）  → 直接用 .app-modal-overlay，z-index:3000（默认值，无需覆盖）
```

---

### 5.7 不要使用 `window.confirm` / `window.prompt` / `window.alert`

**现象**

在浏览器里 `window.confirm("xxx")` 会弹出一个浏览器原生的确认框。但在 **Tauri 环境**下，没有「浏览器」，`window.confirm` 会被 Tauri 的 webview 转译为**操作系统原生弹窗**（Windows 上是 User32 MessageBox，macOS 上是 NSAlert）。这会带来三个问题：

1. **样式与 app 完全脱节**：原生弹窗是系统主题（Windows 浅色/深色），跟 PomoSolo 的暗色 UI 风格割裂。
2. **窗口层级问题**：原生弹窗可能出现在 Tauri 窗口后面，或者阻塞主线程导致窗口卡住。
3. **不可定制**：无法改字体、图标、按钮文案、动画。

**规范**

PomoSolo 内**禁止使用 `window.confirm` / `window.prompt` / `window.alert`**。

**替代方案：自定义组件**

| 原生 API | 替代方案 | 示例组件 |
|---|---|---|
| `window.confirm(message)` | 用 `<Modal>` 或 `.app-modal-overlay` 写一个确认对话框，带「取消 / 确定」两个按钮 | `Charts.vue` 的免责声明子弹窗（`charts-disclaimer`） |
| `window.prompt(message, default)` | 用 `.app-modal-overlay` 写一个带输入框的对话框 | `DownloadDialog.vue`（带歌曲名/歌手输入框） |
| `window.alert(message)` | 用 `<Modal>` 显示信息，单按钮「知道了」 | `ForegroundWarning.vue` 的 API Key 错误弹窗 |

**参考实现**：

`src/components/Charts.vue` 第 110–128 行——曾经用 `window.confirm` 询问「是否开启下载模式」，现在改为自定义 `charts-disclaimer` 子弹窗：

```vue
<!-- Charts.vue 第 282–312 行 -->
<div
  v-if="showDisclaimer"
  class="app-modal-overlay charts-disclaimer-overlay"
  @click="(e) => { if (e.target === e.currentTarget) cancelDisclaimer(); }"
>
  <div class="charts-disclaimer" role="alertdialog" aria-modal="true">
    <div class="charts-disclaimer__header">
      <h3 class="charts-disclaimer__title">⚠️ 下载须知</h3>
    </div>
    <div class="charts-disclaimer__body">
      下载的音乐仅供个人学习使用，请遵守相关版权法律。是否继续开启下载模式？
    </div>
    <div class="charts-disclaimer__footer">
      <button @click="cancelDisclaimer">取消</button>
      <button @click="confirmDisclaimer">继续开启</button>
    </div>
  </div>
</div>
```

`src/components/DownloadDialog.vue` 第 1–11 行的注释明确写道：

```
替代原生 window.prompt / window.confirm 的自定义弹窗：
- 包含歌曲名称输入框（必填）和歌手输入框（可选）
- 包含下载按钮和取消按钮
- 显示下载状态（下载中、成功、已存在、失败等）
```

---

## 6. 新增 Modal 组件 Checklist

新增一个弹窗组件时，按以下步骤对照检查：

### 步骤 1：选择实现方式

- [ ] 是标准弹窗（有标题/关闭按钮/主体/footer）？→ **用 `<Modal>` 组件包裹**（方式 A）
- [ ] 是非标准弹窗（无标题栏、自定义内容、需要覆盖 z-index）？→ **手写 `<div class="app-modal-overlay">`**（方式 B）

### 步骤 2：模板挂载位置

- [ ] 组件模板必须挂在 `src/App.vue` 的 `.container` 内（与其他浮层并列，第 382–390 行附近）
- [ ] **不要**挂在 `.main-content` 内（否则会被 main-content 的 `z-index:1` 层叠上下文限制，无法盖住 MusicPlayer）
- [ ] **不要**挂在 `body` 直接子级（脱离 `.container`，圆角裁剪失效）

### 步骤 3：overlay 样式

- [ ] 用方式 A：根节点是 `<Modal>`，无需写任何 overlay 样式
- [ ] 用方式 B：根节点 `class="app-modal-overlay <组件名>-overlay"`
- [ ] **不要**在 scoped 样式里写 `position: fixed`
- [ ] **不要**在 scoped 样式里写 `position: absolute; inset: 0`（已被 `.app-modal-overlay` 提供，重复无害但冗余）
- [ ] 如需覆盖 z-index（子对话框场景），在修饰类里写 `z-index: 3100`

### 步骤 4：z-index 决策

- [ ] 顶层弹窗 → 用默认 `3000`，不写覆盖
- [ ] 子对话框（被另一个 Modal 调用）→ 写修饰类 `z-index: 3100`

### 步骤 5：动画

- [ ] 用 `<Transition name="modal">` 包裹根节点
- [ ] 复制 `modal-enter-active / modal-leave-active / modal-enter-from / modal-leave-to` 四组样式（见 5.4）
- [ ] 弹窗主体（内层 div）的过渡：`transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)`
- [ ] 起始状态：`opacity: 0` + `transform: scale(0.92)`

### 步骤 6：交互

- [ ] 点击遮罩关闭：`@click="e => { if (e.target === e.currentTarget) close() }"`
- [ ] ESC 键关闭：用 `<Modal>` 自带；方式 B 需自行监听 `keydown`
- [ ] 关闭时 emit `close` 事件（或 `update:visible=false`）

### 步骤 7：内容样式

- [ ] 弹窗主体背景：`#1a1a1a`（与全局统一）
- [ ] 圆角：`14px` 或 `16px`（与现有组件一致）
- [ ] 阴影：`box-shadow: 0 20px 60px rgba(0,0,0,0.4)`
- [ ] 最大宽度：`max-width: 90vw`，避免超出窗口
- [ ] 最大高度：`max-height: 85vh`，超出时内部滚动
- [ ] 滚动条样式：复用全局 `::-webkit-scrollbar` 风格（6px 宽，半透明白色）

### 步骤 8：可访问性

- [ ] 弹窗主体加 `role="dialog" aria-modal="true"`
- [ ] 关闭按钮加 `aria-label="关闭"`
- [ ] 确认对话框用 `role="alertdialog"`

### 步骤 9：禁止事项自查

- [ ] **没有**使用 `window.confirm / window.prompt / window.alert`
- [ ] **没有**使用 `position: fixed`（除非组件挂在 garden 窗口）
- [ ] **没有**把 Modal 挂在 `.main-content` 内
- [ ] **没有**在 `.app-modal-overlay` 之外另写一套 overlay 样式

---

## 7. 动画规范

### 7.1 统一的 Transition 名称

| 名称 | 关键帧 | 使用者 |
|---|---|---|
| `modal` | opacity 0→1 + scale 0.92→1 | `<Modal>`、`AIHelper.vue`、`Charts.vue` |
| `panel` | opacity 0→1 + scale 0.92→1 | `SettingsPanel.vue`、`Statistics.vue`、`TutorialModal.vue` |

> 两个名称的关键帧**完全相同**，只是历史命名不同。**新增组件统一用 `modal`**，已有的 `panel` 不强制改名。

### 7.2 关键帧定义（可直接复制）

```css
/* 遮罩层 opacity 过渡 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.25s ease;
}

/* 弹窗主体 scale 过渡（带回弹） */
.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 起始/结束状态 */
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.92);
}
```

**注意**：`.modal-container` 选择器要替换成你组件内弹窗主体的实际类名（如 `.ai-modal__panel`、`.charts-modal__panel`、`.settings-panel` 等）。

### 7.3 参数说明

| 参数 | 值 | 说明 |
|---|---|---|
| `opacity` 时长 | `0.25s` | 遮罩淡入淡出 |
| `opacity` 缓动 | `ease` | 标准缓动 |
| `transform` 时长 | `0.25s` | 与 opacity 同步 |
| `transform` 缓动 | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 带 12% 过冲的回弹曲线，弹性而不浮夸 |
| 起始 scale | `0.92` | 缩小 8%，出现时放大回 1，营造「弹出」感 |

### 7.4 禁止事项

- ❌ 不要用 `0.3s` 以上的时长（拖沓）
- ❌ 不要用 `linear` 缓动（机械感）
- ❌ 不要给遮罩层加 `transform`（会让暗色背景跟着缩放，露出底层）
- ❌ 不要给弹窗主体加 `opacity` 过渡（主体应保持不透明，只 scale）

---

## 8. 常见问题排查

### 8.1 弹窗遮罩溢出到圆角外

**排查**：

1. 打开 DevTools，选中遮罩层根节点，检查 `position` 是否为 `absolute`（不能是 `fixed`）。
2. 检查 `.container` 是否有 `border-radius:20px + overflow:hidden + position:relative`。
3. 检查组件是否挂在 `.container` 内（`src/App.vue` 模板里）。

**修复**：

- 把 `position: fixed` 改成 `position: absolute`。
- 或直接套用 `.app-modal-overlay` 全局类。

### 8.2 圆角处有浅色尖角痕迹

**排查**：

1. 检查 `.container` 是否同时有 `border-radius` 和 `overflow:hidden`（缺一不可）。
2. 检查 `.window-frame` 是否也有 `border-radius + overflow:hidden`（外层保险）。
3. 检查 `.container` 和 `.window-frame` 的 `border-radius` 值是否一致（不一致会出现双层圆角缝隙）。

**修复**：

```css
.window-frame,
.container {
  border-radius: 20px;
  overflow: hidden;
}
```

### 8.3 弹窗被 MusicPlayer 盖住

**排查**：

1. 检查弹窗是否挂在 `.main-content` 内（**错误**，应挂在 `.container` 直接子级）。
2. 检查弹窗 z-index 是否低于 200（MusicPlayer 是 200）。

**修复**：

- 把弹窗移到 `.container` 直接子级（与其他浮层并列）。
- 使用 `.app-modal-overlay`（z-index:3000，自动高于 MusicPlayer 的 200）。

### 8.4 子对话框被父弹窗盖住

**现象**：在 Charts 弹窗里点「下载」，弹出的 DownloadDialog 反而被 Charts 盖住。

**排查**：

1. 检查子对话框 z-index 是否高于父弹窗。
2. Charts 主面板 z-index 是 1000（历史值），DownloadDialog 是 3100，应该能盖住。
3. 如果父弹窗也用 `.app-modal-overlay`（z-index:3000），则子对话框必须 ≥3100。

**修复**：

```css
.child-dialog-overlay {
  z-index: 3100; /* 高于父弹窗的 3000 */
}
```

### 8.5 弹窗瞬间出现/消失，没有过渡

**排查**：

1. 检查根节点是否被 `<Transition name="modal">` 包裹。
2. 检查 `v-if` 是否直接写在 `<Transition>` 内部（不能写在 `<Transition>` 外层）。
3. 检查 scoped 样式里是否有 `modal-enter-active` 等四个类。

**修复**：

```vue
<!-- ✅ 正确 -->
<Transition name="modal">
  <div v-if="visible" class="app-modal-overlay">
    ...
  </div>
</Transition>

<!-- ❌ 错误：v-if 在 Transition 外 -->
<div v-if="visible">
  <Transition name="modal">
    <div class="app-modal-overlay">...</div>
  </Transition>
</div>
```

### 8.6 ESC 键不关闭弹窗

**排查**：

1. 用 `<Modal>` 组件？→ 自带 ESC 监听，无需处理。
2. 用方式 B？→ 需自行监听 `document.addEventListener("keydown", onKeydown)`，并在 `onBeforeUnmount` 时移除。
3. 检查 `App.vue` 的全局 `handleKeydown` 是否已处理该弹窗的 `showXxx = false`（第 158–170 行）。

**修复**：

- 优先用 `<Modal>` 组件，自动处理 ESC。
- 方式 B 参考 `DownloadDialog.vue` 第 122–127 行的 `handleKeydown` 实现。

### 8.7 弹窗打开后背景仍可滚动

**排查**：

1. 用 `<Modal>` 组件？→ 自带 `document.body.style.overflow = "hidden"`。
2. 用方式 B？→ 需在 `watch(visible)` 里手动锁定/解锁 body overflow。

**修复**：

```ts
watch(
  () => props.visible,
  (v) => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = v ? "hidden" : "";
  },
);

onBeforeUnmount(() => {
  if (typeof document !== "undefined") {
    document.body.style.overflow = "";
  }
});
```

### 8.8 garden 窗口的弹窗定位错乱

**现象**：在 garden 窗口打开 `GardenShop` 等弹窗，弹窗出现在主窗口而非 garden 窗口。

**排查**：

1. 检查 garden 窗口组件是否用了 `position: absolute`（错误，应 `fixed`）。
2. garden 窗口不在主窗口 `.container` 内，不能用 `.app-modal-overlay`。

**修复**：

- garden 窗口内的弹窗保持 `position: fixed`（如 `GardenShop.vue`、`GardenAchievement.vue` 等现有实现）。
- 不要把 garden 弹窗迁移到 `.app-modal-overlay`。

### 8.9 历史遗留组件迁移指南

要把 `SettingsPanel / Statistics / TutorialModal / AIHelper / Charts 主面板` 迁移到统一规范：

1. 把根节点的自定义 overlay 类（如 `.settings-overlay`）改为 `class="app-modal-overlay <组件名>-overlay"`。
2. 删除 scoped 样式里的 `position / inset / background / display / align-items / justify-content / z-index`（除非需要覆盖 z-index）。
3. z-index 决策：是否被其他 Modal 调用？
   - 否 → 不写覆盖（默认 3000）
   - 是 → 写 `<组件名>-overlay { z-index: 3100 }`
4. 保留 Transition 名称（已有的 `panel` 不用改名，新增用 `modal`）。
5. 测试：圆角裁剪、动画、ESC、点击遮罩关闭、与其他弹窗的层级关系。

---

## 附录：相关文件清单

| 文件路径 | 角色 |
|---|---|
| `src/styles/global.css` | 全局 `.app-modal-overlay` 通用类 |
| `src/App.vue` | `.window-frame` / `.container` 圆角裁剪锚点；8 个浮层挂载位置 |
| `src/components/Modal.vue` | 通用 Modal 组件（方式 A） |
| `src/components/SettingsPanel.vue` | 设置面板（历史遗留，自定义 overlay） |
| `src/components/Statistics.vue` | 统计面板（历史遗留，自定义 overlay） |
| `src/components/TutorialModal.vue` | 教程弹窗（历史遗留，自定义 overlay） |
| `src/components/AIHelper.vue` | AI 助手（历史遗留，自定义 overlay） |
| `src/components/Charts.vue` | 音乐榜单（历史遗留主面板 + 规范的免责声明子弹窗） |
| `src/components/AuthPanel.vue` | 登录面板（用 `<Modal>`，规范） |
| `src/components/StudyRoom.vue` | 自习室（用 `<Modal>`，规范） |
| `src/components/ForegroundWarning.vue` | 前台检测警告（用 `<Modal>`，规范） |
| `src/components/DownloadDialog.vue` | 下载弹窗（方式 B，规范，z-index:3100） |
