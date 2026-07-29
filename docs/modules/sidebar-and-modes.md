# 侧边栏 + 模式拨杆 + 迷你模式模块文档

> 本文档记录 Tauri 番茄钟应用"侧边栏收起 / 模式拨杆 / 专注模式 / 迷你模式"四个紧密耦合子模块的实现方案与踩坑历史。
> 模块从 Electron 旧版（`electron/src/scripts/renderer.js` + `electron/src/styles/*.css`）迁移至 Tauri + Vue 3 + Pinia 架构，Rust 端（`src-tauri/src/commands/window.rs`）负责窗口尺寸/置顶/任务栏的底层控制。

---

## 1. 模块概述

本模块负责番茄钟主界面左侧布局、应用模式切换、专注模式开关以及计时运行时的窗口缩小（迷你模式）。四者共享同一套侧边栏布局与窗口状态，因此合并为一份文档。

### 1.1 子模块职责

| 子模块 | 职责 | 关键组件 |
| --- | --- | --- |
| 侧边栏收起 | 左侧 160px 边栏可一键收起为 0，腾出空间给计时器；收起时联动隐藏模式拨杆 | `App.vue`、`SidebarCollapse.vue` |
| 模式拨杆 | 左上角三档拨杆：单次（single）↔ 计划（plan）↔ 正向（stopwatch），点击循环切换、标签直跳 | `ModeSlider.vue` |
| 专注模式 | 胶囊开关，开启后进入"工作期间禁止切窗"的专注态；仅 READY 阶段可切换；正向模式隐藏 | `FocusModeSwitch.vue` |
| 迷你模式 | 计时运行中最小化时，窗口缩为 180×220 的番茄切片造型，置顶且从任务栏隐藏 | `MiniMode.vue`、`App.vue`、Rust `window.rs` |

### 1.2 与原 Electron 版的差异

原版使用 `document.querySelector('.container').style.display = 'none'` 切换主界面与迷你界面；Tauri 版改为 Vue 的 `v-show` + 独立的 `<MiniMode>` 组件，并由 Rust 端 `enter_mini_mode` / `exit_mini_mode` 命令调整窗口物理尺寸（原版也调用主进程 IPC，但容器隐藏靠 JS）。

原版侧边栏收起仅切换 `sidebar-collapsed` class，由全局 CSS 控制宽度；Tauri 版沿用此思路，但额外处理了 ModeSlider 的联动隐藏（原版 ModeSlider 在收起状态下并未显式隐藏，靠侧边栏 overflow 裁切）。

---

## 2. 架构图

### 2.1 DOM 层级

```
.window-frame (520×560, border-radius:20, overflow:hidden)
├── .mini-mode-active?  ← miniModeVisible 时切换 180×220、去掉圆角/阴影
├── LoadingOverlay
├── MiniMode (v-if visible, position:absolute, z-index:1000)
└── .container (v-show="!miniModeVisible", flex, 渐变背景)
    │   :class="[themeClass, modeClass, appModeClass, { 'sidebar-collapsed' }]"
    ├── .draggable              (top:0, height:35px, z-index:1, 拖动区)
    ├── WindowControls          (右上角, 关闭/最小化)
    ├── PinButton               (右上角, 置顶)
    ├── ModeSlider              (左上角, left:8 top:10, z-index:50)  ← 收起时滑出
    ├── .sidebar                (left, width:160, flex-column)
    │   ├── 单次: Presets
    │   ├── 计划: plan-list + add-buttons
    │   ├── 正向: stopwatch-description
    │   └── .sidebar-stats      (margin-top:auto, 今日完成/累计专注)
    ├── SidebarCollapse         (position:absolute, left:160, top:50%, z-index:10)
    ├── .main-content           (flex:1, z-index:1, min-width:0)
    │   │   :class="{ 'mode-animating': modeAnimating }"
    │   ├── HeaderButtons       (position:absolute, left:10 top:10, z-index:100)
    │   ├── .timer-section      (mode-animating 时触发 modeSwitchFade 动画)
    │   │   ├── .title "🍅 番茄钟"
    │   │   ├── ModeSwitch      (v-if appMode==='single', 工作/休息)
    │   │   ├── .timer-container (200×200 圆环)
    │   │   │   ├── NoteManager  (position:absolute, top:50, left:50%)
    │   │   │   ├── TimerProgress
    │   │   │   └── .timer-inner (165×165) > Timer
    │   │   ├── FocusModeSwitch (v-if appMode!=='stopwatch')
    │   │   ├── .buttons (开始/重置)
    │   │   └── .status
    │   └── MusicPlayer         (绝对定位底部)
    └── 浮层: Statistics / SettingsPanel / AIHelper / AuthPanel / StudyRoom / Charts ...
```

### 2.2 z-index 层级表

| 层级 | 元素 | z-index |
| --- | --- | --- |
| 拖动区 | `.draggable` | 1 |
| 主区域 | `.main-content` | 1（创建独立层叠上下文） |
| 收起按钮 | `.sidebar-collapse-btn` | 10 |
| 模式拨杆 | `.mode-slider-container` | 50 |
| 功能按钮列 | `.header-buttons` | 100 |
| 迷你模式 | `.mini-mode` | 1000 |
| Modal 浮层 | `.app-modal-overlay` | 3000（见 MODAL_SYSTEM.md） |

### 2.3 状态来源

```
stores/timer.ts
  ├─ appMode: 'single' | 'plan' | 'stopwatch'   ← ModeSlider 控制
  ├─ mode: 'work' | 'break'                      ← ModeSwitch 控制
  ├─ phase: 'ready' | 'running' | 'finished'     ← 控制 FocusModeSwitch disabled
  └─ setAppMode(): running 时拒绝切换

stores/settings.ts
  ├─ showSidebarCollapseBtn  ← 控制 SidebarCollapse 是否渲染
  ├─ showHeaderExpandBtn     ← 控制 HeaderButtons 展开按钮
  ├─ minimizeBehavior: 'tray' | 'minimize'  ← 决定运行时最小化是否进迷你模式
  └─ miniExitMode: 'double-click' | 'button'

App.vue 本地状态
  ├─ sidebarCollapsed: ref(false)
  ├─ miniModeVisible: ref(false)
  ├─ focusModeEnabled: ref(false)
  └─ modeAnimating: ref(false)  ← watch timer.appMode 触发, 320ms 后清除
```

---

## 3. 关键代码位置索引

| 关注点 | 文件 | 行号 / 标识 |
| --- | --- | --- |
| 容器 class 拼装 | `src/App.vue` | `themeClass` / `modeClass` / `appModeClass` computed |
| `sidebar-collapsed` class 绑定 | `src/App.vue` | template `.container` :class |
| 侧边栏收起样式 | `src/App.vue` `<style scoped>` | `.container.sidebar-collapsed .sidebar` |
| ModeSlider 联动隐藏 | `src/App.vue` `<style scoped>` | `.container.sidebar-collapsed :deep(.mode-slider-container)` |
| 模式切换动画 | `src/App.vue` `<style scoped>` | `@keyframes modeSwitchFade` + `.main-content.mode-animating .timer-section` |
| 迷你模式容器切换 | `src/App.vue` | `.window-frame.mini-mode-active` + `v-show="!miniModeVisible"` |
| 收起按钮位置/动画 | `src/components/SidebarCollapse.vue` | `.sidebar-collapse-btn` / `.collapsed` |
| 拨杆循环切换逻辑 | `src/components/ModeSlider.vue` | `onSliderCycle()` |
| 拨杆滑块位置 | `src/components/ModeSlider.vue` | `.mode-slider--plan` / `.mode-slider--stopwatch` |
| 专注模式状态文案 | `src/components/FocusModeSwitch.vue` | template `{{ active ? "开启" : "关闭" }}` |
| 迷你模式可拖动 | `src/components/MiniMode.vue` | `<div class="mini-draggable" data-tauri-drag-region>` |
| 迷你展开按钮位置 | `src/components/MiniMode.vue` | `.btn-expand-mini { bottom:10px; right:10px }` |
| 进入/退出迷你模式 API | `src/api/window.ts` | `enterMiniMode()` / `exitMiniMode()` |
| Rust 窗口尺寸调整 | `src-tauri/src/commands/window.rs` | `enter_mini_mode` (L60) / `exit_mini_mode` (L73) |
| 最小化 → 迷你模式判定 | `src/App.vue` | `onMinimize()` |
| 备注框定位 | `src/components/NoteManager.vue` | `.note-manager { position:absolute; top:50px; left:50%; transform:translateX(-50%); max-width:100px; width:100px }` |
| 原版模式拨杆逻辑 | `electron/src/scripts/renderer.js` | L338 `DOM.modeSlider.addEventListener('click', ...)` |
| 原版迷你模式逻辑 | `electron/src/scripts/renderer.js` | L572 `enterMiniMode()` / L600 `exitMiniMode()` |

---

## 4. 踩坑记录（最重要）

### 4.1 侧边栏收起按钮边框方向反了

- **现象**：侧边栏展开时，收起按钮的圆角和描边出现在左侧（贴着侧边栏内部），右侧（应贴主区域）没有边界，视觉上按钮"陷进"侧边栏里。
- **根因**：按钮初始定位写成 `left: 152px`，被放在了 `.sidebar`（宽 160px）的内部右边缘附近，导致按钮整体位于侧边栏区域内，圆角方向自然朝向侧边栏内侧。
- **错误尝试**：
  1. 给按钮加 `border-right: none` 试图擦掉右边的线 —— 治标不治本，按钮位置仍错。
  2. 调整 `border-radius` 数值，希望视觉上"看起来对" —— 但 hover 时按钮放大，边界依然错位。
- **正确方案**：按钮应贴在侧边栏**右边缘外侧**，即 `left: 160px`（恰好等于 sidebar 宽度），并通过 `border-left: none` + `border-radius: 0 6px 6px 0` 让圆角朝向主区域。收起状态 `left: 0` 时再补回 `border-left`（此时按钮变成窗口最左边界，需要左侧描边）。
- **最终代码**（`src/components/SidebarCollapse.vue`）：
  ```css
  .sidebar-collapse-btn {
    position: absolute;
    left: 160px;            /* 关键：在 sidebar 右边缘外侧 */
    top: 50%;
    transform: translateY(-50%);
    border-left: none;      /* 展开时左侧贴 sidebar，无需描边 */
    border-radius: 0 6px 6px 0;  /* 圆角朝右（主区域方向） */
    transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1), ...;
  }
  .sidebar-collapse-btn.collapsed {
    left: 0;                /* 收起后贴窗口最左 */
    border-left: 1px solid rgba(255,255,255,0.2);  /* 补回左侧描边 */
  }
  ```

### 4.2 侧边栏收起时 ModeSlider 不隐藏

- **现象**：点击收起按钮后，侧边栏宽度变为 0，但左上角的 ModeSlider（单次/计划/正向拨杆）仍悬停在原位，叠在主区域上方，且仍可点击切换模式。
- **根因**：ModeSlider 是 `.container` 的直接子元素（`position: absolute; left: 8px; top: 10px`），不属于 `.sidebar`，因此 `.sidebar` 的 `width: 0` + `overflow: hidden` 不会裁切到它。原版 Electron 中也有此问题，但原版 ModeSlider 在收起态下视觉上被主区域内容盖住，不明显。
- **错误尝试**：
  1. 把 ModeSlider 移进 `.sidebar` 内部 —— 破坏布局，拨杆会随侧边栏一起消失，但展开时位置和层级也变了。
  2. 在 `sidebarCollapsed` 时 `v-if` 干脆移除 ModeSlider —— 切换太突兀，没有过渡动画，且拨杆消失后主区域内容会跳位。
- **正确方案**：用 `:deep()` 穿透 scoped 样式，在 `.container.sidebar-collapsed` 状态下给 `.mode-slider-container` 加 `opacity: 0` + `pointer-events: none` + `transform: translateX(-160px)`，并保留 0.3s 过渡。这样拨杆会随侧边栏一起向左滑出视窗、淡出，且不可点击，与侧边栏动画节奏一致。
- **最终代码**（`src/App.vue` `<style scoped>`）：
  ```css
  :deep(.mode-slider-container) {
    transition: opacity 0.3s ease,
                transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .container.sidebar-collapsed :deep(.mode-slider-container) {
    opacity: 0;
    pointer-events: none;
    transform: translateX(-160px);
  }
  ```

### 4.3 侧边栏收起动画用 translateX 会留空白

- **现象**：收起侧边栏时，侧边栏区域出现一条明显的透明空白带，主区域没有补位过来，看起来"侧边栏消失了但位置还在"。
- **根因**：最初尝试用 `transform: translateX(-160px)` 把侧边栏移出视窗，但 `transform` 不改变元素的布局尺寸，`.sidebar` 仍占据 160px 的 flex 空间，`.main-content` 的 `flex: 1` 自然不会扩展过来。
- **错误尝试**：
  1. 给 `.main-content` 加 `margin-left: -160px` 配合位移 —— hack 写法，且展开时需要反向 margin，动画时序难同步。
  2. 用 `display: none` 直接移除侧边栏 —— 没有过渡动画，体验突兀。
- **正确方案**：动画 `width` 从 160px 到 0（配合 `padding` 同步归零、`border-right` 移除、`opacity` 淡出）。`width` 是布局属性，改变后 `.main-content` 的 `flex: 1` 会自然扩展填满。`flex-shrink: 0` 在展开态保证侧边栏不被压缩，收起态由 `width: 0` 直接覆盖。
- **最终代码**（`src/App.vue`）：
  ```css
  .sidebar {
    width: 160px;
    flex-shrink: 0;
    transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                padding 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                opacity 0.2s ease;
  }
  .container.sidebar-collapsed .sidebar {
    width: 0;
    padding-left: 0;
    padding-right: 0;
    border-right: none;
    opacity: 0;
  }
  ```

### 4.4 备注区域过长顶到时钟圆框

- **现象**：在计时器圆环上方输入较长的备注时，输入框会向两侧延伸，盖住或顶到时钟圆环（TimerProgress / timer-inner），视觉上输入框和圆环"粘"在一起。
- **根因**：备注框没有设 `max-width`，`<input>` 默认会撑满 flex 容器宽度；又因为 `.timer-container` 是 200×200 的圆，输入框横向溢出后就侵入圆环区域。
- **错误尝试**：
  1. 给 `.timer-container` 加 `overflow: hidden` —— 会裁切进度环的阴影和动画，副作用太大。
  2. 缩短 `maxlength` —— 治标不治本，输入框本身宽度仍可能超过圆环直径。
- **正确方案**：给 `.note-manager` 设 `max-width: 100px` + `width: 100px`，强制输入框宽度小于圆环内径；同时给 `.note-manager__input` 设 `min-width: 0`（flex 子项默认 `min-width: auto`，不显式归零会导致 `flex: 1` 无法收缩到内容宽度以下）。
- **最终代码**（`src/components/NoteManager.vue`）：
  ```css
  .note-manager {
    position: absolute;
    top: 50px;
    max-width: 100px;   /* 关键：限制宽度，不顶到圆框 */
    width: 100px;
  }
  .note-manager__input {
    flex: 1;
    min-width: 0;       /* 关键：允许 flex 子项收缩 */
  }
  ```

### 4.5 备注区域未居中

- **现象**：备注框在计时器圆环上方左右不对称，偏左或偏右，看起来歪歪扭扭。
- **根因**：用 `left: 50%` 定位时，元素的左边缘被放到容器 50% 处，但元素自身宽度没有用 `transform: translateX(-50%)` 回退一半，导致整体偏右。
- **错误尝试**：
  1. 用 `margin-left: -50px`（宽度一半）手动补偿 —— 宽度一旦改动就要同步改 margin，维护成本高。
  2. 用 `text-align: center` —— 只能让输入框内文字居中，不能让输入框本身居中。
- **正确方案**：标准居中三件套 `left: 50%` + `transform: translateX(-50%)`。注意 `fadeInDown` 动画的 keyframes 也必须保留 `translateX(-50%)`，否则动画期间会偏移。
- **最终代码**（`src/components/NoteManager.vue`）：
  ```css
  .note-manager {
    left: 50%;
    transform: translateX(-50%);
  }
  @keyframes fadeInDown {
    from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  ```

### 4.6 模式拨杆点按跳转 vs 循环切换

- **现象**：迁移初期，把拨杆的 click 事件实现成"根据点击位置跳转到对应档位"（即点击右侧 1/3 区域跳到 stopwatch），结果与原版交互不符，老用户反馈"点一下应该切到下一档，现在点哪跳哪"。
- **根因**：原版 Electron `renderer.js` 的 `DOM.modeSlider.click` 监听器是**循环切换下一档**逻辑（single → plan → stopwatch → single），并不读取鼠标坐标。迁移时凭"拨杆都是点哪跳哪"的直觉写错了。
- **错误尝试**：
  1. 计算点击 X 坐标除以 1/3 决定档位 —— 行为错误，且 thumb 在过渡动画期间点击坐标会误判。
- **正确方案**：完全复刻原版逻辑 —— 点击轨道或 thumb 都触发 `onSliderCycle()`，按 `['single','plan','stopwatch']` 顺序取 `indexOf` 当前模式，`+1` 取模得到下一档。**标签（label）点击**才是直接跳转，二者分离。
- **最终代码**（`src/components/ModeSlider.vue`）：
  ```ts
  function onSliderCycle() {
    const order: AppMode[] = ["single", "plan", "stopwatch"];
    const idx = order.indexOf(timer.appMode);
    timer.setAppMode(order[(idx + 1) % order.length]);
  }
  // template:
  // <div class="mode-slider" @click="onSliderCycle">...</div>
  // <span class="mode-label" @click="onLabelClick(m.key)">{{ m.label }}</span>
  ```
- **补充**：原版还有"正向计时运行时不允许切换"的判断（`renderer.js` L340），当前 Tauri 版的 `timer.setAppMode` 在 `phase === 'running'` 时直接 return，已覆盖此约束。

### 4.7 模式拨杆切换动画节奏

- **现象**：拨杆滑块切换时，右侧主区域（标题、模式按钮、计时器）瞬间突变，没有过渡，体验生硬；而原版有"内容淡入+轻微上移"的过渡。
- **根因**：只给拨杆 thumb 加了 `transition: all 0.3s`，右侧 `.main-content` 内容没有任何过渡，Vue 的 `v-if` 切换 ModeSwitch 等组件时直接 DOM 替换。
- **错误尝试**：
  1. 给所有子元素加 `transition: all 0.3s` —— 性能差，且 `v-if` 移除/插入的元素无法过渡。
- **正确方案**：在 `App.vue` 用 `watch(() => timer.appMode)` 监听模式变化，触发一个 320ms 的 `modeAnimating` ref 为 true，给 `.main-content` 加 `mode-animating` class，由 CSS `animation: modeSwitchFade 0.32s` 触发 `.timer-section` 的淡入+位移。时长 320ms 与 thumb 的 0.3s 过渡节奏对齐，加 20ms 余量避免动画提前结束。
- **最终代码**（`src/App.vue`）：
  ```ts
  const modeAnimating = ref(false);
  let modeAnimTimer;
  watch(() => timer.appMode, () => {
    modeAnimating.value = true;
    clearTimeout(modeAnimTimer);
    modeAnimTimer = setTimeout(() => { modeAnimating.value = false; }, 320);
  });
  ```
  ```css
  .main-content.mode-animating .timer-section {
    animation: modeSwitchFade 0.32s cubic-bezier(0.4, 0, 0.2, 1);
  }
  @keyframes modeSwitchFade {
    0%   { opacity: 0; transform: translateY(8px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  ```

### 4.8 专注模式拨杆文本：开启/关闭 vs 已开启/空

- **现象**：迁移初期，专注模式开关右侧的状态文案写成"已开启"（active 时）和空字符串（inactive 时），与原版不符；老用户反馈"关闭状态下右侧空着很奇怪，不知道开关当前是什么状态"。
- **根因**：原版 `renderer.js` L282 明确是 `AppState.focusModeEnabled ? '开启' : '关闭'`，即始终显示文案，只是颜色随 active 切换。迁移时凭直觉写成了"已开启/空"。
- **错误尝试**：
  1. 关闭时显示"已关闭" —— 文案冗余，且与原版不一致。
- **正确方案**：始终显示文案，active 时为"开启"（绿色 `#81c784`），inactive 时为"关闭"（半透明白）。注意原版在 stopwatch 模式下会清空文案（`focusModeStatus.textContent = ''`），但 Tauri 版通过 `v-if="timer.appMode !== 'stopwatch'"` 直接隐藏整个组件，不需要单独清空文案。
- **最终代码**（`src/components/FocusModeSwitch.vue`）：
  ```vue
  <span class="focus-mode-status" :class="{ active }">
    {{ active ? "开启" : "关闭" }}
  </span>
  ```
  ```css
  .focus-mode-status { color: rgba(255,255,255,0.7); min-width: 24px; }
  .focus-mode-status.active { color: #81c784; }
  ```

### 4.9 设置拨杆颜色与背景融为一体

- **现象**：设置面板里的拨杆（focusModeSwitch 同款样式被复用）在某些自定义主题下，开启态的绿色背景与设置面板背景色完全一样，看不出拨杆是开是关。
- **根因**：CSS 中用了 `var(--accent)` 但**没有 fallback 值**，当主题未定义 `--accent` 变量时，`background` 计算为空，浏览器回退到 `transparent`，于是拨杆透明，与背景同色。
- **错误尝试**：
  1. 给每个主题都补上 `--accent` 定义 —— 治标不治本，用户自定义主题仍可能漏定义。
- **正确方案**：所有引用 CSS 变量的地方都加 fallback：`var(--accent, #e94560)`。即使变量未定义也能拿到一个合理的默认色。主组件拨杆（FocusModeSwitch）使用的是硬编码 `rgba(76,175,80,0.6)`，本身没问题；但被复用到设置面板的拨杆若改用 `var(--accent)`，必须带 fallback。
- **示例**：
  ```css
  /* 错误：无 fallback */
  background: var(--accent);
  /* 正确：带 fallback */
  background: var(--accent, #e94560);
  ```

### 4.10 统计页面数字颜色为黑色

- **现象**：统计浮层（Statistics 组件）的数字在深色主题下显示为纯黑（`#000`），与深色背景几乎不可见。
- **根因**：迁移时直接复制了原版样式，原版在浅色主题下数字颜色是继承的默认黑色，迁移后没有显式设颜色，继承了浏览器默认 `color: black`。
- **错误尝试**：
  1. 给统计组件加 `color: var(--text-color)` —— 又踩了 4.9 的坑，没 fallback 时变量未定义仍可能回退到黑。
- **正确方案**：统计数字显式设为 `#fff`（或 `rgba(255,255,255,0.95)`），不依赖继承和变量。侧边栏 `.stat-value` 也遵循此规则。
- **最终代码**（参照 `src/App.vue` `.stat-value`）：
  ```css
  .stat-value {
    font-weight: 600;
    color: #fff;   /* 显式白色，不依赖继承 */
    font-size: 13px;
  }
  ```

### 4.11 迷你模式启动时原界面不关闭

- **现象**：点击最小化进入迷你模式后，Rust 窗口尺寸已缩为 180×220，但原 520×560 的主界面（侧边栏、计时器、按钮等）仍渲染在 180×220 的视窗里，被严重裁切，且 MiniMode 番茄造型叠在主界面之上，视觉混乱。
- **根因**：原版 Electron 用 `document.querySelector('.container').style.display = 'none'` 显式隐藏主容器；Tauri 版初期只调用了 `enterMiniModeApi()`（Rust 缩窗口），没有同步隐藏 Vue 的 `.container`，导致主界面仍在 DOM 中渲染。
- **错误尝试**：
  1. 给 MiniMode 加更高 z-index 盖住主界面 —— 主界面仍在后台渲染，性能浪费，且 180×220 视窗里主界面的绝对定位元素会溢出。
  2. 用 `v-if="miniModeVisible"` 销毁主容器 —— 销毁后所有 store 监听、MusicPlayer 状态都会断，退出迷你模式时需要重建，体验差。
- **正确方案**：用 `v-show="!miniModeVisible"`（仅 `display: none`，保留 DOM 和状态）隐藏 `.container`，同时 MiniMode 用 `v-if="props.visible"` 渲染。配合 `.window-frame.mini-mode-active` 把外层容器尺寸同步缩到 180×220，并移除 `border-radius` / `overflow:hidden` / `box-shadow`，让 MiniMode 的番茄造型（叶子超出主体）不被外框裁切。Rust 端 `enter_mini_mode` 负责物理窗口尺寸，前端 CSS 负责容器尺寸，二者必须同步。
- **最终代码**（`src/App.vue`）：
  ```vue
  <div class="window-frame" :class="{ 'mini-mode-active': miniModeVisible }">
    <MiniMode :visible="miniModeVisible" @expand="exitMiniMode" />
    <div v-show="!miniModeVisible" class="container" ...>
      ...
    </div>
  </div>
  ```
  ```css
  .window-frame.mini-mode-active {
    width: 180px;
    height: 220px;
    border-radius: 0;
    overflow: visible;    /* 让番茄叶子超出主体不被裁切 */
    box-shadow: none;
    border: none;
  }
  ```

### 4.12 迷你模式窗口尺寸与置顶/任务栏配置

- **现象**：迷你模式窗口尺寸不对（过大或过小）、不置顶（被其他窗口盖住）、仍在任务栏显示一个独立图标（与主窗口任务栏图标重复或冲突）。
- **根因**：迷你模式的窗口参数需要在 Rust 端显式设置，仅靠前端 CSS 改容器尺寸不够 —— 物理窗口尺寸、置顶、任务栏可见性都是窗口管理器层面的事。
- **错误尝试**：
  1. 只在前端改 CSS，不调 Rust —— 窗口物理尺寸仍 520×560，CSS 缩小后四周透明，点击穿透混乱。
  2. 置顶用前端 `setAlwaysOnTop(true)` 但不设 `skip_taskbar` —— 任务栏会多出一个"迷你番茄"图标，与主窗口图标并存。
- **正确方案**：Rust 端 `enter_mini_mode` 命令一次性设置四项：尺寸 180×220、`always_on_top: true`、`minimizable: false`（防止迷你态被最小化消失）、`skip_taskbar: true`（从任务栏隐藏，只保留托盘）。退出时 `exit_mini_mode` 全部恢复。
- **最终代码**（`src-tauri/src/commands/window.rs`）：
  ```rust
  pub async fn enter_mini_mode(app: AppHandle) {
      if let Some(window) = app.get_webview_window("main") {
          let _ = window.set_size(LogicalSize::new(180.0, 220.0));
          let _ = window.set_always_on_top(true);
          let _ = window.set_minimizable(false);
          let _ = window.set_skip_taskbar(true);
      }
  }
  pub async fn exit_mini_mode(app: AppHandle) {
      if let Some(window) = app.get_webview_window("main") {
          let _ = window.set_size(LogicalSize::new(520.0, 560.0));
          let _ = window.set_always_on_top(false);
          let _ = window.set_minimizable(true);
          let _ = window.set_skip_taskbar(false);
      }
  }
  ```
- **注意**：使用 `LogicalSize`（CSS 像素）而非 `PhysicalSize`，避免在高 DPI 屏幕上尺寸被缩放系数放大。

### 4.13 迷你模式可拖动：data-tauri-drag-region

- **现象**：迷你模式窗口无法用鼠标拖动移动位置，标题栏区域（番茄叶子）点击没反应。
- **根因**：Tauri 默认只有 `decorations: true` 的系统标题栏可拖动；本项目 `decorations: false`（无边框），必须显式声明拖动区域。原版 Electron 用 `-webkit-app-region: drag`（见 `.draggable`），Tauri 不识别此属性，需要用 `data-tauri-drag-region`。
- **错误尝试**：
  1. 在迷你模式外层 `.mini-mode` 加 `data-tauri-drag-region` —— 整个迷你窗口都变成拖动区，点击展开按钮也会被拖动事件吞掉。
- **正确方案**：单独放一个 `.mini-draggable` 覆盖层，`position: absolute; width: 100%; height: 100%`，加 `data-tauri-drag-region`，`z-index: 8`（低于展开按钮的 z-index:10，低于番茄主体的 z-index:2 之上）。展开按钮和番茄主体通过更高 z-index 浮在拖动层之上，可正常点击。
- **最终代码**（`src/components/MiniMode.vue`）：
  ```vue
  <div class="mini-mode">
    <div class="mini-draggable" data-tauri-drag-region></div>
    <div class="mini-leaves">...</div>
    <div class="mini-tomato">...</div>
    <button class="btn-expand-mini">⬆</button>
  </div>
  ```
  ```css
  .mini-draggable {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    z-index: 8;   /* 低于按钮(10)，高于番茄主体(2) */
  }
  ```
- **补充**：原版 Electron 还支持 `miniExitMode: 'double-click'`（双击番茄退出），通过给 `.mini-tomato` 绑 `dblclick` 实现；Tauri 版当前仅实现按钮退出，双击退出若要支持需在 `.mini-tomato` 上加 `@dblclick`。

### 4.14 迷你模式展开按钮位置

- **现象**：展开按钮（⬆）位置不固定，有时盖住时间数字，有时跑到番茄叶子上面，有时被番茄主体遮住点击不到。
- **根因**：按钮没有显式定位，跟随 flex 流动；而 `.mini-mode` 是 `flex-direction: column`，按钮会被排到番茄主体下方，但番茄主体已占满 160×160，按钮被挤出视窗。
- **错误尝试**：
  1. 用 `margin-top: -28px` 把按钮拉回来 —— 不稳定，番茄尺寸一变就错位。
  2. 放在 `.mini-tomato` 内部 `position: absolute` —— 相对番茄定位，番茄圆角会裁切按钮。
- **正确方案**：按钮作为 `.mini-mode` 的直接子元素，用 `position: absolute; bottom: 10px; right: 10px` 固定在迷你窗口右下角（180×220 的右下角），`z-index: 10` 确保可点击。番茄主体居中，按钮在右下角不遮挡时间数字。
- **最终代码**（`src/components/MiniMode.vue`）：
  ```css
  .btn-expand-mini {
    position: absolute;
    bottom: 10px;
    right: 10px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.3);
    color: white;
    z-index: 10;   /* 高于拖动层(8)，可点击 */
  }
  ```

---

## 5. 最终布局清单

### 5.1 主界面（非迷你模式）

| 元素 | 定位 | 尺寸 | z-index | 动画 |
| --- | --- | --- | --- | --- |
| `.window-frame` | static | 520×560 | - | - |
| `.draggable` | absolute, top:0 left:0 | 100%×35 | 1 | - |
| `.sidebar` | flex 子项 | 160×100% | auto | width/padding/opacity 0.3s |
| `.sidebar-collapse-btn` | absolute, left:160 top:50% | 8×50 | 10 | left 0.3s, width/height 0.2s |
| `.mode-slider-container` | absolute, left:8 top:10 | auto | 50 | opacity/transform 0.3s（收起时） |
| `.header-buttons` | absolute, left:10 top:10 | auto | 100 | max-height/clip-path 0.3s |
| `.main-content` | flex:1 | auto | 1 | - |
| `.timer-section` | flex:1 | auto | auto | modeSwitchFade 0.32s（模式切换时） |
| `.note-manager` | absolute, top:50 left:50% | 100×26 | 10 | fadeInDown 0.3s |
| `.focus-mode-switch` | flex 子项 | 44×24 | auto | background/left 0.3s |
| MusicPlayer | absolute, bottom | auto | 200 | 见 music-player.md |

### 5.2 迷你模式

| 元素 | 定位 | 尺寸 | z-index | 备注 |
| --- | --- | --- | --- | --- |
| `.window-frame.mini-mode-active` | static | 180×220 | - | 去圆角/阴影/overflow |
| `.mini-mode` | absolute, top:0 left:0 | 180×220 | 1000 | - |
| `.mini-draggable` | absolute, 全覆盖 | 100%×100% | 8 | `data-tauri-drag-region` |
| `.mini-leaves` | relative | 80×40 | 5 | 叶子摆动动画 2.5~3.2s |
| `.mini-tomato` | relative | 160×160 | 2 | 渐变红 + 内外阴影 |
| `.mini-progress-ring` | absolute | 130×130 | - | SVG, r=62, stroke-dashoffset 1s linear |
| `.mini-timer-inner` | flex 居中 | 100×100 | - | 半透明内圈 |
| `.mini-time-display` | - | - | - | 26px, #fff, tabular-nums |
| `.btn-expand-mini` | absolute, bottom:10 right:10 | 28×28 | 10 | hover translateY(-2px) |

### 5.3 侧边栏收起态

| 元素 | 展开态 | 收起态 |
| --- | --- | --- |
| `.sidebar` | width:160, padding:38px 12px 15px 12px, opacity:1 | width:0, padding:0, opacity:0, border-right:none |
| `.sidebar-collapse-btn` | left:160, border-left:none, icon:◀ | left:0, border-left:1px, icon:▶ |
| `.mode-slider-container` | opacity:1, transform:none | opacity:0, pointer-events:none, transform:translateX(-160px) |

---

## 6. 模式切换逻辑

### 6.1 三种应用模式（appMode）

| 模式 | 标签 | 侧边栏内容 | 主区域差异 |
| --- | --- | --- | --- |
| `single` 单次 | 单次 | 时间预设（Presets）+ 滚轮 | 显示 ModeSwitch（工作/休息） |
| `plan` 计划 | 计划 | 番茄计划列表（plan-list + add-buttons） | 隐藏 ModeSwitch，按计划顺序执行 |
| `stopwatch` 正向 | 正向 | 说明文字 | 隐藏 ModeSwitch + FocusModeSwitch，从零累计 |

### 6.2 切换入口

1. **拨杆点击**（`onSliderCycle`）：循环切换下一档，不跳转。
   - single → plan → stopwatch → single → ...
2. **标签点击**（`onLabelClick`）：直接跳转到对应档位。
3. **约束**：`timer.setAppMode` 在 `phase === 'running'` 时直接 return，运行中无法切换。

### 6.3 切换流程

```
用户点击拨杆/标签
   ↓
ModeSlider.onSliderCycle / onLabelClick
   ↓
timer.setAppMode(newMode)
   ├─ phase === 'running'? → return（拒绝切换）
   └─ appMode = newMode; phase = 'ready'
   ↓
App.vue watch(() => timer.appMode) 触发
   ├─ modeAnimating = true
   ├─ .main-content 添加 .mode-animating class
   ├─ .timer-section 播放 modeSwitchFade 0.32s 动画
   └─ 320ms 后 modeAnimating = false, 移除 class
   ↓
Vue 重新渲染：
   ├─ .sidebar 内容随 appMode 切换（v-if/v-else-if/v-else）
   ├─ ModeSwitch v-if="appMode==='single'" 显示/隐藏
   └─ FocusModeSwitch v-if="appMode!=='stopwatch'" 显示/隐藏
   ↓
拨杆 thumb 通过 .mode-slider--{appMode} class 调整 left 值
   ├─ single: left:3px
   ├─ plan:   left:16px
   └─ stopwatch: left:29px
   （thumb 自带 transition:all 0.3s，与主区域动画同步）
```

### 6.4 专注模式（FocusModeSwitch）联动

- 仅在 `appMode !== 'stopwatch'` 时渲染（正向计时无专注概念）。
- `disabled` prop 绑定 `timer.phase !== 'ready'`，运行中不可切换。
- 开启后由 `App.vue` 的 `focusModeEnabled` ref 接管，传给前台检测/菜园子等模块使用。
- 状态文案始终显示"开启"/"关闭"，颜色随 active 切换。

---

## 7. 常见问题排查

### 7.1 侧边栏收起后主区域没扩展

**排查**：
1. 检查 `.sidebar` 是否设了 `transition: width`，且收起态 `width: 0`（不是 `transform: translateX`）。
2. 检查 `.sidebar` 是否有 `flex-shrink: 0` —— 展开态需要它防止被压缩，但收起态靠 `width: 0` 覆盖，二者不冲突。
3. 检查 `.main-content` 是否有 `flex: 1` 和 `min-width: 0`（防止内容撑爆）。

### 7.2 收起按钮位置错乱

**排查**：
1. 确认 `left: 160px`（展开态）和 `left: 0`（收起态），不是 152px。
2. 确认按钮是 `.container` 的直接子元素，不是 `.sidebar` 的子元素（否则会随 sidebar 一起消失）。
3. 确认 `transition: left 0.3s`，否则位置瞬变无动画。

### 7.3 模式拨杆点击没反应

**排查**：
1. 检查 `timer.phase` 是否为 `'running'` —— 运行中 `setAppMode` 会被拒绝。
2. 检查是否在收起态 —— `.container.sidebar-collapsed` 下 `.mode-slider-container` 有 `pointer-events: none`。
3. 检查 `@click` 是否绑定在 `.mode-slider`（轨道）上，而不是只在 thumb 上。

### 7.4 模式切换时右侧内容无动画

**排查**：
1. 检查 `App.vue` 的 `watch(() => timer.appMode)` 是否正确触发 `modeAnimating = true`。
2. 检查 `.main-content` 是否绑定了 `:class="{ 'mode-animating': modeAnimating }"`。
3. 检查 `modeAnimTimer` 是否被 `clearTimeout` 正确清理（防止快速切换时动画中断）。
4. 检查 `@keyframes modeSwitchFade` 是否定义且未被其他样式覆盖。

### 7.5 迷你模式窗口尺寸不对 / 有透明边

**排查**：
1. 确认 Rust 端 `enter_mini_mode` 调用了 `set_size(LogicalSize::new(180.0, 220.0))`，不是 PhysicalSize。
2. 确认前端 `.window-frame.mini-mode-active` 也设了 `width: 180px; height: 220px`（前端容器尺寸必须与物理窗口同步，否则 body flex 居中会把 520×560 容器居中，MiniMode 被推出视口）。
3. 确认 `.window-frame.mini-mode-active` 移除了 `border-radius` / `overflow: hidden` / `box-shadow` / `border`，否则番茄叶子被裁切或出现外框。

### 7.6 迷你模式无法拖动

**排查**：
1. 确认 `.mini-draggable` 元素带有 `data-tauri-drag-region` 属性（不是 `-webkit-app-region: drag`，那是 Electron 的）。
2. 确认 `.mini-draggable` 的 `z-index`（8）低于展开按钮（10），否则按钮点不到。
3. 确认 `.mini-draggable` 的尺寸是 `100% × 100%` 且 `position: absolute`，否则拖动区域不覆盖整个窗口。

### 7.7 迷你模式退出后主界面异常

**排查**：
1. 确认 `exitMiniMode` 同时调用了 `miniModeVisible = false`（前端）和 `exitMiniModeApi()`（Rust 恢复窗口尺寸）。
2. 确认 `.container` 用的是 `v-show`（不是 `v-if`），否则退出迷你模式时主界面需要重建，MusicPlayer 等状态丢失。
3. 确认 Rust `exit_mini_mode` 恢复了 `always_on_top: false`、`minimizable: true`、`skip_taskbar: false`，否则窗口仍置顶/不可最小化/不在任务栏。

### 7.8 备注框盖住时钟圆环

**排查**：
1. 确认 `.note-manager` 有 `max-width: 100px` + `width: 100px`（小于圆环内径 165px）。
2. 确认 `.note-manager__input` 有 `min-width: 0`（flex 子项可收缩）。
3. 确认 `.note-manager` 的 `top` 值（50px）让它在圆环上方，而不是叠在圆环上。

### 7.9 专注模式开关运行中可点击

**排查**：
1. 确认 `FocusModeSwitch` 的 `disabled` prop 绑定了 `timer.phase !== 'ready'`。
2. 确认 `.focus-mode-container.disabled` 有 `pointer-events: none` + `opacity: 0.6`。
3. 确认 `toggle()` 函数开头有 `if (props.disabled) return` 兜底。

### 7.10 拨杆 thumb 位置与 appMode 不同步

**排查**：
1. 检查 `.mode-slider` 是否绑定了 `:class="sliderClass"`（computed 返回 `mode-slider--{appMode}`）。
2. 检查三个 class 的 `left` 值：single=3px, plan=16px, stopwatch=29px（差距 13px，与 thumb 宽度 14px + 间距匹配）。
3. 检查 thumb 的 `transition: all 0.3s`，否则瞬变无动画。

---

## 8. 参考文件

- 主容器与状态：`src/App.vue`
- 收起按钮：`src/components/SidebarCollapse.vue`
- 模式拨杆：`src/components/ModeSlider.vue`
- 工作/休息切换：`src/components/ModeSwitch.vue`
- 专注模式：`src/components/FocusModeSwitch.vue`
- 迷你模式：`src/components/MiniMode.vue`
- 功能按钮列：`src/components/HeaderButtons.vue`
- 备注框：`src/components/NoteManager.vue`
- 设置 store：`src/stores/settings.ts`
- 计时器 store：`src/stores/timer.ts`
- 窗口 API：`src/api/window.ts`
- Rust 窗口命令：`src-tauri/src/commands/window.rs`
- 原版 Electron 逻辑：`electron/src/scripts/renderer.js`
- Modal 系统文档：`docs/MODAL_SYSTEM.md`
- 音乐播放器文档：`docs/modules/music-player.md`
