# UI 取证工具（`tools/ui/`）

> 部门：主部门 ｜ 建立：2026-09 仓库重构
>
> **一句话**：让开发者（尤其是 AI agent）**随时看到 UI、并自动发现 UI 问题** ——
> 不用启动应用、不用手点，一条命令出图 + 一份可读的问题清单。

---

## 1. 为什么需要它

重构前，改样式只能靠读 CSS 猜，或者人工启动应用点一遍。
历史上多次 UI bug（面板高度收缩、按钮被挤成两排、文字被裁、弹窗被祖先裁剪）
都是**用户实测才发现**的 —— 因为开发侧根本没有"看"的能力。

本工具把这件事变成一条命令。

**不新增任何 npm 依赖**：用 Node 24 自带的 `fetch` + 全局 `WebSocket` 直接驱动 CDP，
复用本机已装的 Chrome/Edge，不下载 Chromium。

---

## 2. 五条取证路径

| 路径 | 命令 | 做什么 | 什么时候用 |
|------|------|--------|-----------|
| **Web / PWA** | `npm run ui:shot -- --target desktop` | 浏览器里跑真实前端（注入 Tauri IPC mock），截图 + 审计 | 日常改样式、查任意状态，**最快最灵活** |
| **配方** | `npm run ui:shot -- --recipe desktop-panels` | 一次把一组真实面板全截下来 | 改完一轮要通盘核对 |
| **Tauri 真窗口截图** | `npm run ui:desktop` | 截**真实 Tauri 进程**的窗口（真 WebView2 + 真 Rust 后端） | 确认"浏览器里的效果"与真机一致 |
| **Tauri 真窗口驱动** | `npm run ui:drive -- --recipe desktop-quick` | **用代码点击真实窗口**并校验点击真的生效 | 端到端功能核对、真实热区审计 |
| **Android** | `npm run ui:android` | 手机/模拟器画面 + UI 层级审计 | 安卓端（独立仓库）改完核对 |

> **四者关系**：`ui:shot` 快、可编排、能摆任意状态，但数据是 mock；
> `ui:desktop` 截真图但不动它；`ui:drive` **既截真图又真的点它**。
> **不一致时以真窗口为准。**

### ★ 问题会直接打到终端

跑完命令后，布局审计结果会**汇总打印到终端**（按类型分组、按元素去重、按严重度排序），
不用去翻产物文件：

```
┌─ 发现的问题 ─────────────────────────────────────────────
│ 🔍 点击热区过小（<24px）：5 个元素
│    · … > button.sidebar-collapse-btn:nth-of-type(2)   8×50px
│    · … > button.music-collapse-btn   60×8px
│ 🔍 字号过小：5 个元素
│    · … > span.sidebar-collapse-icon   8px
└──────────────────────────────────────────────────────────
  完整表格（含说明与复现信息）：上面那个 index.md
```

> 早期版本只把问题写进 `index.md`（产物目录还被 gitignore），
> 结果**没人注意到有问题** —— 这是工具的失误，已修正为直接输出。

---

## 3. 快速上手

```bash
# ① 桌面端主窗口（自动起 vite dev server，用完自动关）
npm run ui:shot -- --target desktop

# ② 所有真实面板各截一张（设置/统计/教程/AI/图表/自习室/登录/深色）
npm run ui:shot -- --recipe desktop-panels

# ③ 菜园子窗口（独立窗口 400×520，摆出"有作物"的状态）
npm run ui:shot -- --target desktop-garden

# ④ PWA 断点全覆盖（手机/桌面 + 断点边界值）
npm run ui:shot -- --recipe pwa-screens

# ⑤ 真实 Tauri 窗口：只截图（需应用在跑）
npm run tauri:dev            # 另开一个终端
npm run ui:desktop

# ⑥ 真实 Tauri 窗口：用代码点击它并校验（自动起 dev server + 应用）
npm run ui:drive -- --recipe desktop-quick

# ⑦ Android（需模拟器已启动）
npm run ui:android -- --devices
npm run ui:android
```

**产物**：`temp-debug/ui-shots/<时间戳>-<标签>/`（已 gitignore）

```
temp-debug/ui-shots/20261008-040053-desktop-panels/
├── 01-00-main-desktop-viewport.png
├── 02-01-settings-desktop-viewport.png
├── ...
├── index.md          ★ 先读这个
└── manifest.json     同一份数据的机读版
```

---

## 4. ★ 先读 `index.md`

`index.md` 是给人/agent 读的清单，**不用逐张打开图片**就知道截了什么、哪里有问题：

```markdown
| # | 文件 | 视口 | 模式 | 体积 | 耗时 | 问题 |
|---|------|------|------|------|------|------|
| 1 | [01-00-main-...png](...) | 520×560@2x | viewport | 451.6 KB | 9974 ms | ❌ 错误 1 / 🔍 布局 13 |
| 2 | [02-01-settings-...png](...) | 520×560@2x | viewport | 124.3 KB | 2586 ms | 🔍 布局 80 |

## 问题详情
### 02-01-settings-....png
**布局审计（80 条）：**
| 类型 | 元素 | 数值 | 说明 |
|------|------|------|------|
| `overlay-blocking` | `div.loading-overlay` | 覆盖 100% 视口，挡住 29 个可交互元素 | ... |
```

---

## 5. 布局审计（本工具最有价值的部分）

每次截图都会在页面里跑一次审计，判据**对应本项目历史上真出过的 bug**：

| 类型 | 判据 | 对应的历史 bug |
|------|------|--------------|
| `overlay-blocking` | 固定/绝对定位元素覆盖 ≥50% 视口且挡住多个可交互元素 | 卡在"正在启动…"遮罩后面 |
| `text-clip` | `overflow:hidden` 且 `scrollHeight > clientHeight` | 教程展开文字被裁（flex 子项缺 `min-height:0`） |
| `overflow-y` / `overflow-x` | 内容超出容器但**没开滚动** | 底部内容被裁 |
| `out-of-viewport` | 元素 bounding rect 超出视口 | 弹窗被祖先 `overflow:hidden` 裁剪 |
| `covered` | 元素中心 `elementFromPoint` 命中的不是它自己 | 被浮层盖住点不到（z-index 问题） |
| `tiny-target` | 可点击元素任一边 < 24px（默认） | 成就墙分类按钮太小点不到 |
| `tiny-font` | 字号 < 10px | 可读性差 |

> **`overlay-blocking` 的折叠逻辑**：整屏遮罩会一次性盖住几十个元素，
> 逐个报会淹没有效信息 → 按"遮挡者"分组，同一个遮挡者盖住 ≥多个元素时折叠成**一条**。

Android 端用 `uiautomator dump` 做**同一套判据**（`tiny-target` 按 dp，阈值 44dp），
两端问题清单可以直接对照。

---

## 6. Tauri IPC mock（让真实前端在浏览器里跑起来）

浏览器里没有 Tauri，`@tauri-apps/api` 的 `invoke` 会抛
`Cannot read properties of undefined (reading 'invoke')` → 所有 store 初始化失败 →
界面永远卡在加载遮罩后面 → **截图毫无意义**。

解法：在**页面脚本执行前**注入 `window.__TAURI_INTERNALS__`。
官方 API（`@tauri-apps/api@2.11.1`）只依赖 4 个成员，已核对过：

| 成员 | 用途 |
|------|------|
| `invoke(cmd, args)` | 所有命令调用 |
| `transformCallback(cb, once)` | 事件回调登记 |
| `unregisterCallback(id)` | 注销 |
| `convertFileSrc(path)` | 资源路径 |

于是 **`src/` 下的真实组件与 store 一行不改**就能在浏览器里跑 —— 与 PWA 的
"alias 换层"同一思路，但这里是"注入底座"，连 alias 都不需要。

事件也走通了：`listen()` → `plugin:event|listen` → mock 记录回调，
之后可用 `__UI_MOCK__.emit(事件名, 载荷)` 主动派发，
所以 `music-progress` / `ws-event` / 前台检测告警这类状态都能"摆"出来再截图。

### 场景（`--scenario`）

`--list-scenarios` 看全部。当前：

| 场景 | 摆出什么状态 |
|------|------------|
| `fresh` | 全新安装态（无数据、未登录、未播放） |
| `focusing` | 正在专注 + 有备注 + 有统计 |
| `garden-rich` | 菜园子有作物（含枯萎、成熟、空地） |
| `music-playing` | 音乐播放中 + 有播放列表 + 自定义标签 |
| `charts-rich` | 榜单有数据 |
| `update-available` | 有更新 |
| `cloud-signed-in` | 云模式 + 已登录 |

### 补 fixture（反馈闭环）

截图后 `index.md` 会列出**未被 fixture 覆盖的命令**（返回 null 的那些）：

```markdown
## Tauri IPC mock 覆盖情况
**未被 fixture 覆盖的命令（返回 null，共 3 个）：**
- `music_sync_state`
- `study_room_get_detail`
```

→ 要摆出对应状态，就在 `lib/tauri-mock.mjs` 的 `BASE_FIXTURES` / `SCENARIOS` 里补一条。

> **形状要对**：例如 `cloud_test_connection` 必须返回 `{ ok }`（见 `src/api/auth.ts` 的
> `ConnectionTestResult`），返回 `null` 会让 auth store 抛
> `Cannot read properties of null (reading 'ok')`。

---

## 7. 为什么用"配方"而不是组件画廊

本项目多数界面是**状态机驱动**的（面板开合、模式切换、弹窗）。
直接用真实 app + IPC mock 点开面板，比另建画廊更贴近真机，也不会与实现漂移。

配方定义在 `lib/recipes.mjs`：

| 配方 | 内容 |
|------|------|
| `desktop-panels` | 主界面 + 设置/统计/教程/AI/图表/自习室/登录/深色 |
| `desktop-garden` | 菜园子窗口（有作物 / 空两种状态） |
| `desktop-states` | 主窗口在 5 种 mock 状态下的样子 |
| `desktop-music-library` | 音乐库面板三个选项卡各一张（v4.8 重点） |
| `desktop-responsive` | 同一页面在 520/1280/1920/2560 下的表现 |
| `pwa-screens` | PWA 手机/桌面 + 断点边界全覆盖 |
| `full-sweep` | 全量巡检（主窗口全部面板 + 多分辨率，耗时较长） |

**加配方**：编辑 `lib/recipes.mjs`，加一条即可（选择器用 `title` 属性最稳，
例如 `[title="设置"]`，见 `src/components/HeaderButtons.vue`）。

---

## 8. 视口预设为什么是这些数

`--list-views` 看全部。关键几个**不是随便挑的**：

| 预设 | 尺寸 | 来源 |
|------|------|------|
| `desktop` | 520×560 | **`src-tauri/tauri.conf.json` 主窗口真实尺寸**（已用真窗口实测核对：logical=520×560） |
| `garden` | 400×520 | tauri.conf.json 菜园子窗口真实尺寸 |
| `bp-560-below` / `bp-560` | 559 / 560 | PWA 手机/桌面分界（`src/pwa/README.md`） |
| `bp-1200-below` / `bp-1200` | 1199 / 1200 | PWA 尺寸上档断点 |
| `bp-1920-below` / `bp-1920-1200` | 1919×1199 / 1920×1200 | PWA 4K 高档位断点 |

> **取断点边界值（±1px）**：布局 bug 最爱藏在断点那一像素上。

---

## 9. 真实窗口：截图与驱动（`ui:desktop` / `ui:drive`）

### 9.1 截图（`ui:desktop`，Win32 PrintWindow）

踩过的坑都写在 `capture-window.ps1` 注释里：

1. **WebView2 必须用 `PW_RENDERFULLCONTENT`（flag=2）**，否则只能抓到空白/边框；
   脚本同时试 flag=2 与 0 各存一张，便于对照；
2. **DPI 感知**：用 `GetDpiForWindow` 取实际缩放。本机 150% → 真窗口
   `physical=780x840 dpi=144 scale=1.50 logical=520x560`。
   **物理像素 ≠ CSS 像素，不换算会得到尺寸对不上的图**；
3. **窗口最小化时 PrintWindow 抓到空白** → 先 `ShowWindow(SW_RESTORE)`；
4. **透明窗口**（本项目主窗口 `transparent:true`）会留下未初始化像素 →
   先在底色上铺一层再叠加窗口位图；
5. 用 `DWMWA_EXTENDED_FRAME_BOUNDS` 取**不含投影**的边界，避免四周黑边。

同时产出 `window-meta.json`（尺寸/DPI/logical），可直接核对
"浏览器里 520×560"是否等于"真机 520×560"。

### 9.2 驱动（`ui:drive`，UI Automation）

**用代码点击真实窗口，并校验点击真的生效。**

#### 为什么不用 CDP 驱动 WebView2

实测：**Tauri v2 会程序化注入 WebView2 的 `additionalBrowserArgs`，从而覆盖
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量** → 调试端口不开放
（`--remote-debugging-port=9333` 探测失败，即使 `tauri.conf.json` 里没写这个字段）。
要开 CDP 必须改 `tauri.conf.json` 并**重新编译**。

所以改用 **UI Automation**：无需改动应用、无需重编译，而且拿到的是
**真实屏幕坐标与真实热区尺寸**。

#### 三个必须知道的坑

1. **WebView2 的无障碍树是惰性构建的** —— 第一次遍历只能看到宿主 Pane
   （17 个节点），必须「走一遍 → 等 0.9s → 再走一遍」才拿得到 DOM 内容（90+ 节点）。
   脚本已内置双次遍历并取节点更多的那次。
2. **`BoundingRectangle` 是屏幕物理像素**，要除以 `dpi/96` 才是 CSS 像素。
   本机 150% → 除以 1.5（与 Web 端审计因此可以互相印证）。
3. **定位元素优先用 `HelpTextContains`（= HTML `title` 属性），不要用 emoji 名称**：
   主题按钮的 Name 会随主题在 `☀️`/`🌙` 之间变，写死 `🌙` 会在浅色模式下报
   "找不到元素"。`helpTextContains: "切换深色模式"` 两种状态都能命中。

#### 两种点击方式（重要区别）

| 方式 | 走真实输入管线 | 移动光标 | 能测什么 |
|------|--------------|---------|---------|
| **UIA Invoke/Legacy/Selection**（默认） | ❌ 绕过命中测试 | ❌ 不动 | 「功能逻辑通不通」 |
| **`--allow-sendinput`**（Win32 真鼠标） | ✅ | ✅ 会动 | 「用户点不点得到」（遮挡、热区、z-index） |

> **两种都做一遍才完整**：InvokePattern 通 + SendInput 也通 = 功能与可用性都 OK。
> 只用 InvokePattern 会漏掉"按钮被浮层盖住"这类问题。

#### 点击"生效"怎么判

不靠"没报错就算成功"（早期版本因此把**点击失败误判成生效**）。判据是：

- `expect: [...]` → 这些文案必须在点击后**从无到有**出现（最多重试 4s）
- `expectGone: [...]` → 这些文案必须**从有到无**（关闭动作用它）

判定依据是点击前后的 **UIA 元素名称集合差集**，比截图对比更精确。

#### 配方里踩出来的两条经验

- **面板关闭后顶部图标栏会收起**，主题/统计/AI 等按钮**从无障碍树消失**
  → 点面板按钮前必须先点「展开/收起」（配方里写成 `clicks: [UIA_EXPAND, byTitle("设置")]`）；
- **`×` 有歧义**：既是窗口关闭按钮（`window-controls__btn--close`）也是各面板关闭按钮
  （`settings-panel__close`）。不加 `classNameNotContains: "window-controls"`
  会匹配到窗口关闭按钮，**一点就把整个应用关掉**。

#### 真实热区审计

`ui:drive` 会顺带审计真实窗口的点击热区，报的是 **CSS 类名**（= 去哪改），不是 emoji：

```
🔍 真实点击热区审计：5 条（阈值 24 css px）
   · sidebar-collapse-btn  8×50.7 css px  (12×76 @1.5x)
   · music-collapse-btn  60×8.7 css px  (90×13 @1.5x)
   · music-btn music-playlist-btn  20×20 css px  (30×30 @1.5x)
```

> **阈值分桌面与触摸两种，别用错**：
> `24` = 桌面指针目标下限（WCAG 2.5.8，默认）；
> `44` = 触摸目标（WCAG 2.5.5 / 本项目 PWA 规矩，用于手机）。
> 对 520×560 的桌面窗口用 44 会把 39×39 的正常图标**全报成问题**（32 条噪声 vs 5 条真问题）。

---

## 10. 目录结构

```
tools/ui/
├── README.md                  ← 本文件
├── shot.mjs                   Web/PWA 截图 CLI（目标/视口/配方/mock/审计）
├── desktop-shot.mjs           Tauri 真窗口截图 CLI
├── desktop-drive.mjs          Tauri 真窗口**驱动** CLI（UIA 点击 + 校验 + 热区审计）
├── android-shot.mjs           Android 截图 + 层级审计 CLI
├── capture-window.ps1         Win32 PrintWindow 实现（DPI 感知）
└── lib/
    ├── cdp.mjs                ★ 零依赖 CDP 客户端（启动/附着/截图/真实输入/DOM 静止等待）
    ├── browsers.mjs           定位本机 Chrome/Edge
    ├── tauri-mock.mjs         ★ Tauri IPC mock + fixture + 场景
    ├── probe.mjs              ★ 控制台/异常/网络采集 + 布局审计
    ├── targets.mjs            内置目标 + 视口预设
    ├── recipes.mjs            截图配方（RECIPES）+ 真实窗口驱动配方（DRIVE_RECIPES）
    ├── servers.mjs            dev server 生命周期（不用管道，重定向到日志）
    ├── shots.mjs              产物目录 + index.md/manifest.json
    ├── uia.ps1                ★ UI Automation：dump / click / audit（真实窗口驱动内核）
    ├── android-audit.mjs      uiautomator XML 解析 + 布局审计
    ├── _selftest.mjs          CDP 内核自测（不需要服务器）
    └── _android-audit-selftest.mjs  Android 审计自测（不需要设备）
```

---

## 11. 自测

```bash
npm run ui:selftest
```

- `_selftest.mjs`：启动浏览器 → 建页 → 设视口 → 求值 → 截图 → 元素截图 → 核对 DPR；
- `_android-audit-selftest.mjs`：用样例 XML 校验 bounds 解析、px→dp 换算、
  热区判据、越界判据、隐藏节点跳过（10 项断言）。

---

## 12. 常用参数速查

### `ui:shot`（浏览器）

```
--target <名>       内置目标（--list-targets）
--recipe <名>       配方（--list-recipes）
--url <地址>        任意 URL
--view <名|WxH>     视口（--list-views），可重复
--scenario <名>     mock 场景（--list-scenarios）
--full              整页截图
--selector <css>    只截某元素
--click <css>       截图前点击（可重复）
--eval <js>         截图前执行脚本（可重复）
--wait-for <js>     等待页面条件
--no-settle         不等 DOM 静止（默认会等）
--no-audit          跳过布局审计
--no-image          只要诊断不要图
--browser <edge|chrome>   默认 Edge（与桌面端同为 WebView2 内核）
--keep-open         截完不关浏览器（调试）
--json              只输出 manifest JSON
--list-browsers / --list-views / --list-targets / --list-recipes / --list-scenarios
```

### `ui:drive`（真实窗口）

```
--recipe <名>       驱动配方（--list-recipes）
--click <UIA定位>   自定义点击（可重复；见下）
--name <标签>       本轮标签
--allow-sendinput   改用真鼠标（会动光标，但能测遮挡/热区）
--no-launch         附着到已在运行的应用
--no-server         不起 dev server
--exe <路径>        指定 exe（默认 src-tauri/target/debug/pomo-solo.exe）
--process <名> / --title <子串>   定位窗口
--no-audit          跳过真实热区审计
--min-target-css <px>  热区阈值（默认 24 桌面 / 44 触摸）
--keep-open         驱动完不关应用
```

> 自定义点击的定位语法在配方里（`lib/recipes.mjs` 的 `DRIVE_RECIPES`），
> 支持 `helpTextContains`（推荐）/ `name` / `nameContains` / `controlType` /
> `classNameContains` / `classNameNotContains` / `index`。

### 为什么默认等"DOM 静止"

本项目加载遮罩是 `onMounted` 完成后**再 `setTimeout` 800ms** 才隐藏
（见 `src/App.vue`）。固定 `sleep` 很容易抢在它前面，截到"正在启动…"的糊图。
用"DOM 不再变化"作为就绪信号稳得多（`--no-settle` 可关）。

---

## 13. 产物归属（重要）

`temp-debug/ui-shots/` **已 gitignore，不入库**。
截图是**一次性取证产物**，不是交付物 —— 不要提交进仓库。

需要长期留存的 UI 现状图，请放 `docs/` 下并在文档里引用。
