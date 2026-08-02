# 菜园子模块文档（Garden）

> 适用版本：PomoSolo v4.0.0（Tauri 2 + Vue 3 + Pinia）
> 最后更新：2026-07-29

---

## 1. 模块概述

菜园子是 PomoSolo 的游戏化激励模块，作为一个**独立 Tauri 窗口**运行（与主番茄钟窗口分离）。它把"专注"转化为可视化收益：专注时长累计可解锁成就，签到/种植/收获形成金币经济循环，娱乐应用惩罚会扣减资源。

### 功能子系统

| 子系统 | 入口组件 | 说明 |
|--------|----------|------|
| 土地种植 | `GardenPlot.vue` | 12 块土地（3 列 × 4 行），前 6 块默认解锁，后 6 块需金币/成就解锁 |
| 种植轮盘 | `GardenPlantWheel.vue` | 点击空地弹出的 Canvas 径向选种菜单（5 扇区） |
| 背包 | `GardenBag.vue` | 显示种子与已收获作物，传统模式下点击种子选中用于种植 |
| 商店 | `GardenShop.vue` | 购买种子 / 出售作物双标签页弹窗 |
| 每日签到 | `GardenSignin.vue` | 连续签到、累计签到、本周记录、每日/每周/里程碑奖励 |
| 成就墙 | `GardenAchievement.vue` | 25 个成就（7 分类 + 1 隐藏），含进度条与奖励展示 |

### 经济循环

```
专注 ──累计时长──▶ 触发专注类成就（奖励种子/金币）
签到 ──每日──▶ 种子 + 金币（连续签到里程碑额外奖励）
商店 ──金币──▶ 购买种子 ──种植──▶ 等待生长 ──收获──▶ 作物
商店 ──作物──▶ 出售换金币
专注模式（奖惩机制）──▶ 计时器运行中每分钟 garden_grow 成长
惩罚（专注模式中断：3 次娱乐警告 / 运行中重置 / 手动关闭）──▶ 清空所有未成熟作物（garden_punishment）+ 损失明细弹窗
```

---

## 2. 架构图

### 2.1 启动链路

```
tauri.conf.json (garden 窗口, url: garden.html)
        │
        ▼
garden.html ──加载──▶ /src/garden.ts（入口脚本）
        │
        ▼
createApp(GardenMain).use(createPinia()).mount('#app')
        │
        ▼
GardenMain.vue（主界面，协调所有子组件）
```

### 2.2 组件与数据流

```
                    ┌─────────────────────────────────────────┐
                    │            GardenMain.vue               │
                    │  (顶层 .garden-frame，圆角 + 拖动区)     │
                    │                                         │
   ┌────────────────┼────────────────┬───────────┬───────────┐│
   │                │                │           │           ││
   ▼                ▼                ▼           ▼           ▼│
GardenPlot    GardenBag       GardenShop   GardenSignin  GardenAchievement
 (土地网格)    (背包)          (商店弹窗)   (签到弹窗)    (成就墙弹窗)
   │ click                          │           │              │
   │ plant/harvest/unlock           │           │              │
   ▼                                ▼           ▼              ▼
 GardenPlantWheel ◀──轮盘模式触发── handlePlant()
 (Canvas 径向选种)
   │ select seedKey
   ▼
┌──────────────────────────────────────────────────────────────┐
│                  useGardenStore (Pinia)                       │
│  src/stores/garden.ts                                         │
│  state: data(GardenState) / selectedSeed / tip / plantWheelMode│
│  actions: load / plant / harvest / buySeed / sellCrop /        │
│           unlockPlot / signIn / addFocus / punish              │
└──────────────────────┬───────────────────────────────────────┘
                       │ invoke()
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              src/api/garden.ts (Tauri invoke 封装)             │
│  gardenRead / gardenPlant / gardenHarvest / gardenBuySeed /    │
│  gardenSellCrop / gardenUnlockPlot / gardenSignin /            │
│  gardenUpdateFocus / gardenPunishment                          │
└──────────────────────┬───────────────────────────────────────┘
                       │ Tauri IPC
                       ▼
┌──────────────────────────────────────────────────────────────┐
│        src-tauri/src/commands/garden.rs (Rust)                │
│  #[tauri::command] garden_read / garden_write /                │
│  garden_plant / garden_harvest / garden_buy / garden_sell /    │
│  garden_unlock / garden_signin                                 │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
          modules/data_manager.rs
          (read_garden_data / write_garden_data 持久化)
```

### 2.3 关键设计点

- **单窗口单页**：`garden.html` 是独立 HTML 入口，不共享主窗口的 Vue 实例，自行 `createPinia()`。
- **Store 作为唯一数据源**：所有子组件只读 store 的 getters，写操作一律走 store action → api → Rust，前端不直接修改 `data`。
- **`toGardenState()` 收敛层**：store 在 `load()` / `applyResult()` 时用 `toGardenState(raw)` 对后端返回做字段容错与默认值回填，避免后端结构不完整时前端崩溃。

---

## 3. 关键代码位置索引

| 关注点 | 文件 | 行号 | 说明 |
|--------|------|------|------|
| garden 窗口配置 | `src-tauri/tauri.conf.json` | 28-40 | label=garden, 400×520, resizable:false |
| 入口 HTML | `garden.html` | 1-12 | 挂载点 `#app`，加载 `/src/garden.ts` |
| 入口脚本 | `src/garden.ts` | 1-8 | createApp + createPinia + mount |
| 主界面框架 | `GardenMain.vue` | 88-148 | template 结构；圆角/拖动区/关闭按钮 |
| `.garden-frame` 圆角 | `GardenMain.vue` | 152-162 | border-radius:16px + overflow:hidden |
| 拖动区 | `GardenMain.vue` | 91, 165-173 | data-tauri-drag-region + -webkit-app-region |
| 弹窗状态管理 | `GardenMain.vue` | 22-30 | shopVisible / signinVisible / achievementVisible / wheel* |
| 种植分支（轮盘 vs 传统） | `GardenMain.vue` | 40-55 | plantWheelMode 决定走轮盘还是 selectedSeed |
| 土地网格 | `GardenPlot.vue` | 151-164 | grid-template-columns: repeat(3, 1fr) |
| 滚动条样式 | `GardenPlot.vue` | 166-182 | ::-webkit-scrollbar 系列 |
| 格子点击逻辑 | `GardenPlot.vue` | 49-64 | locked→忽略；有crop→收获/提示；空地→plant |
| 解锁条件判断 | `GardenPlot.vue` | 73-84 | coins 类型看金币；achievement 类型看成就解锁 |
| 种植轮盘绘制 | `GardenPlantWheel.vue` | 55-150 | Canvas 2D 绘制扇形/图标/数量 |
| 轮盘定位 | `GardenPlantWheel.vue` | 201-215 | 基于 clientX/Y，钳制在 .garden-frame 边界内 |
| 轮盘扇区命中 | `GardenPlantWheel.vue` | 153-173 | atan2 计算角度，中心区域返回 -1 |
| 商店弹窗 | `GardenShop.vue` | 49-114 | buy/sell 双标签；position:fixed; inset:0 |
| 背包 | `GardenBag.vue` | 42-84 | 种子列表（可选）+ 作物列表 |
| 签到弹窗 | `GardenSignin.vue` | 144-205 | 连续/累计天数、本周圆点、今日奖励列表 |
| 签到数据读取 | `GardenSignin.vue` | 42-45 | store.data.signIn.{continuousDays,totalDays,weekRecords} |
| 今日是否可签到 | `stores/garden.ts` | 316-319 | signIn.lastDate !== today (toISOString) |
| Store 定义 | `stores/garden.ts` | 284-513 | state/getters/actions 全集 |
| `toGardenState` 容错 | `stores/garden.ts` | 246-282 | 字段缺失时回填 DEFAULT_GARDEN |
| 静态配置表 | `stores/garden.ts` | 44-162 | CROP_CONFIG / ACHIEVEMENT_CONFIG / 奖励表 |
| API 封装 | `api/garden.ts` | 70-177 | invoke 命令封装与类型声明 |
| API 命令未注册警告 | `api/garden.ts` | 17-18 | 注释说明 lib.rs 暂未注册命令 |
| Rust 签到实现 | `commands/garden.rs` | 197-291 | garden_signin 含键名修正与兼容逻辑 |
| 签到键名修正 | `commands/garden.rs` | 206-216 | 强制写 "signIn"（camelCase），非对象则重置 |
| 日期工具函数 | `commands/garden.rs` | 13-77 | epoch→YMD / 星期几（UTC） |

---

## 4. 踩坑记录（最重要）

> 以下每个踩坑均包含：**现象 / 根因 / 错误尝试 / 正确方案**。

---

### 4.1 窗口尺寸固定 400×520，resizable: false

**现象**：菜园子窗口无法拖拽改变大小，最大化按钮缺失；如果内容超出会被裁切而非撑大窗口。

**根因**：`tauri.conf.json` 中 garden 窗口显式配置了 `"resizable": false`，且未配置 `maximizable`（默认随 resizable）。窗口尺寸被锁死为 400×520。

**错误尝试**：
1. 试图用 CSS `width: 100%; height: 100%` 让内容自适应——但窗口本身不可拉伸，内容只能在固定画布内排布。
2. 把 12 块土地全铺开不滚动——4 行 × 3 列在 520px 高度内放不下（顶部 header + 底部背包 + tip 占去大量空间），底部菜地被截断。

**正确方案**：
- 接受 400×520 固定尺寸，把 `.garden-grid` 设为 `flex:1; min-height:0; overflow-y:auto`，让土地区域成为可滚动弹性区。
- 顶部 header（金币/标题/导航按钮）、底部背包区（`flex-shrink:0`）、tip 条保持固定高度，只有中间网格滚动。
- 配置位置：`tauri.conf.json` 第 32-34 行 `"width": 400, "height": 520, "resizable": false`。

---

### 4.2 一行三个菜地：grid-template-columns: repeat(3, 1fr)

**现象**：12 块土地需要排成 4 行 3 列；如果用 flex 横向排列，换行后间距不均；如果用固定像素宽度，窗口缩放（虽然不可缩放，但开发时改尺寸）会错位。

**根因**：土地是正方形（`aspect-ratio: 1`），需要等宽三列且自动换行，CSS Grid 的 `repeat(3, 1fr)` 是最直接的方案。

**错误尝试**：
1. 用 `display: flex; flex-wrap: wrap` + 固定 `width: 30%`——百分比加 gap 后每行只能挤进 2 个或间距不稳。
2. 用 `grid-template-columns: 1fr 1fr 1fr`——功能等价但啰嗦。

**正确方案**：
```css
.garden-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 12px;
  max-width: 400px;   /* 与窗口宽度对齐 */
  margin: 0 auto;
}
```
配合 `.garden-plot { aspect-ratio: 1; }` 保证格子始终为正方形。位置：`GardenPlot.vue` 第 151-164 行。

---

### 4.3 菜园子窗口圆角：.garden-frame border-radius:16px + overflow:hidden

**现象**：garden 窗口配置了 `decorations:false` + `transparent:true`（无边框透明窗口），如果不处理，窗口是直角矩形，与系统圆角风格不搭，四个角会露出透明区域的硬边。

**根因**：Tauri 无边框透明窗口本身没有圆角，圆角必须由前端 CSS 实现。但仅有 `border-radius` 不够——子元素溢出会戳破圆角，必须配合 `overflow:hidden`。

**错误尝试**：
1. 只加 `border-radius: 16px` 不加 `overflow: hidden`——子元素（如 header 背景、网格）的直角溢出到圆角外，四个角仍是直角。
2. 给 `body` 加圆角——`body` 默认有 margin，且 Vue 挂载的 `#app` 未设置满高，圆角不生效。

**正确方案**：
```css
.garden-frame {
  width: 100%;
  height: 100%;
  border-radius: 16px;
  overflow: hidden;        /* 关键：裁切子元素溢出 */
  background: linear-gradient(135deg, #2d5a27 0%, #1a3a15 100%);
}
```
位置：`GardenMain.vue` 第 152-162 行。同时确保 `garden.html` 的 `body` 无默认 margin（由 `global.css` 处理），`#app` 满高。

> **注意**：`overflow: hidden` 会裁切溢出的普通流/绝对定位元素，但 `position: fixed` 的弹窗不受影响（见 4.7）。`GardenPlantWheel` 的 `getPosition()` 会把轮盘钳制在 `.garden-frame` 边界内，避免被裁切。

---

### 4.4 滚动条样式：.garden-grid 的 -webkit-scrollbar

**现象**：土地区域内容超出时出现滚动条，但 Tauri 内嵌 WebView 默认滚动条是系统原生样式（粗、亮色），在深色游戏化界面中极不协调，且占用宽度导致格子跳动。

**根因**：WebKit 内核默认滚动条不做暗色适配，必须手动用 `::-webkit-scrollbar` 系列伪元素定制。

**错误尝试**：
1. 只设 `scrollbar-width: thin`（Firefox 属性）——WebKit 不识别，滚动条不变。
2. 设 `::-webkit-scrollbar { display: none }`——滚动条消失但用户不知道还能滚动，体验差。

**正确方案**：同时写 Firefox 与 WebKit 两套，滚动条做窄、做半透明：
```css
.garden-grid {
  scrollbar-width: thin;                                    /* Firefox */
  scrollbar-color: rgba(255,255,255,0.25) transparent;       /* Firefox */
}
.garden-grid::-webkit-scrollbar { width: 5px; }              /* WebKit 宽度 */
.garden-grid::-webkit-scrollbar-track { background: transparent; border-radius: 3px; }
.garden-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.25); border-radius: 3px; }
.garden-grid::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); }
```
位置：`GardenPlot.vue` 第 162-182 行。商店面板（`GardenShop.vue` 第 268-283 行）和成就列表（`GardenAchievement.vue` 第 330-345 行）也复用了同一套滚动条样式。

---

### 4.5 签到按钮无反应：Rust 后端写入键名错误（signin 而非 signIn）且类型错误（数组而非对象）

**现象**：点击"立即签到"后，提示签到成功，但签到状态不更新——连续签到天数始终为 0，"今日已签到"判断始终为可签到（按钮不会变成"今日已签到"），本周记录圆点不点亮。重启窗口后所有签到记录丢失。

**根因**：双层错误叠加：

1. **键名大小写不一致**：Rust 后端 `garden_signin` 最初把签到数据写入了 `"signin"`（全小写）键，而前端 `toGardenState()` 读取的是 `g.signIn`（camelCase）。键名不匹配导致前端每次 `load()` 都拿不到签到数据，回退到 `DEFAULT_GARDEN.signIn`（`lastDate: null`），所以 `canSignInToday` 永远为 `true`。
2. **数据类型错误**：旧版 Rust 把 `signIn` 写成了数组而非对象。前端 `toGardenState()` 的守卫是 `g.signIn && typeof g.signIn === "object"`——数组也满足 `typeof === "object"`，于是被强转为 `SignInState`，但数组没有 `lastDate` 等字段，读取到的全是 `undefined`，`canSignInToday` 用默认值判断仍为可签到。

**错误尝试**：
1. 在前端 `GardenSignin.vue` 里反复检查 `handleSignIn` 的事件绑定与 `signing` 防抖逻辑——逻辑没问题，按钮确实触发了调用。
2. 在 store 的 `signIn()` action 里加 `console.log` 发现 `result.success === true` 但 `applyResult` 后 `data.signIn.lastDate` 仍为 `null`——误以为是 `applyResult` 没执行，实际是 `toGardenState` 读了错键。
3. 试图在前端做键名兼容（同时读 `signin` 和 `signIn`）——治标不治本，且数组类型问题仍存在。

**正确方案**：在 Rust 后端 `garden_signin` 中修正（`commands/garden.rs` 第 206-216 行）：

```rust
// 1. 强制使用 camelCase 键名 "signIn"（与前端一致）
let signin = obj
    .entry("signIn".to_string())
    .or_insert(Value::Object(serde_json::Map::new()));

// 2. 兼容旧数据：若 signIn 之前是数组（类型错误）则重置为对象
if !signin.is_object() {
    *signin = Value::Object(serde_json::Map::new());
}
```

同时在 Rust 中以 camelCase 写入所有签到字段：`lastDate` / `continuousDays` / `totalDays` / `weekRecords`（第 250-252 行），与前端 `SignInState` 接口完全对齐。

前端 `toGardenState()`（`stores/garden.ts` 第 262-265 行）也保留防御性回退：若 `signIn` 不是对象则用默认值，保证后端数据异常时前端不崩溃。

---

### 4.6 签到数据结构：SignInState（camelCase，前后端统一）

**现象**：签到相关字段在前端用 camelCase，在 Rust 也必须用 camelCase，不能按 Rust 惯例用 snake_case，否则 `serde_json` 序列化后前端 `toGardenState` 取不到值。

**根因**：Rust `serde_json::Value` 是手动 `insert` 字符串键名，键名完全由代码决定，不会自动转换。前端 TypeScript 接口定义的是 camelCase，两边必须人工对齐。

**错误尝试**：
1. Rust 端按惯例写 `last_date` / `continuous_days` / `total_days` / `week_records`——前端读 `lastDate` 取到 `undefined`，签到判断失效（同 4.5 的衍生问题）。

**正确方案**：前后端统一 camelCase。最终结构如下（前端 `stores/garden.ts` 第 182-187 行定义，Rust `garden.rs` 第 250-252 行写入）：

```typescript
// 前端：src/stores/garden.ts
export interface SignInState {
  lastDate: string | null;        // "YYYY-MM-DD"（UTC）
  continuousDays: number;         // 连续签到天数
  totalDays: number;              // 累计签到天数
  weekRecords: boolean[];         // 本周签到记录，索引 0=周日, 1=周一...6=周六
}
```

```rust
// 后端：src-tauri/src/commands/garden.rs（手动 insert camelCase 键）
signin_obj.insert("lastDate".to_string(), Value::String(date.clone()));
signin_obj.insert("continuousDays".to_string(), Value::from(new_continuous));
signin_obj.insert("totalDays".to_string(), Value::from(new_total));
// weekRecords: [bool; 7]
```

> **注意时区**：前端用 `new Date().toISOString().split("T")[0]` 取日期（UTC），Rust 端 `today_date_string()` 也基于 UTC（`epoch_secs_to_ymd`），两端必须用同一时区，否则跨日凌晨会出现"昨天还能签到，今天却提示已签到"。当前两端均为 UTC。

---

### 4.7 garden 窗口 Modal 保持 position:fixed（不在主窗口 .container 内）

**现象**：商店/签到/成就墙弹窗打开后，遮罩层没有覆盖整个窗口，或者弹窗被 `.garden-frame` 的 `overflow:hidden` 裁切，只露出一部分；种植轮盘定位偏移，出现在错误位置。

**根因**：
- `.garden-frame` 设了 `overflow: hidden` + `border-radius: 16px`。如果弹窗用 `position: absolute` 且相对于 `.garden-frame`，会被裁切。
- 弹窗若被放在某个有 `transform` / `filter` 的祖先内，`position: fixed` 会退化为相对于该祖先定位，而非视口，导致遮罩范围错位。
- garden 窗口是独立窗口，**不应复用主窗口的 `.container` 布局壳**，否则容器自身的 `max-width` / `padding` / `transform` 会干扰 fixed 定位。

**错误尝试**：
1. 把弹窗用 `position: absolute` 放在 `.garden-frame` 内——被 `overflow:hidden` 裁切，且绝对定位参考系是 `.garden-frame`（relative），遮罩仅覆盖框架内容区，圆角外的透明区域不遮罩。
2. 把弹窗放进主窗口的 `.container` 包裹层——容器有固定宽度/居中样式，弹窗定位偏移。

**正确方案**：
- garden 入口 `src/garden.ts` 直接 `createApp(GardenMain).mount('#app')`，**不套任何 `.container`**，`#app` 即满屏。
- 所有弹窗（GardenShop / GardenSignin / GardenAchievement）用 `position: fixed; inset: 0; z-index: 1000`，直接作为 `.garden-frame` 的子节点渲染。由于 `.garden-frame` 及其祖先没有 `transform`/`filter`，`fixed` 正确相对于视口（即整个 400×520 窗口）定位，遮罩完整覆盖窗口。
- 种植轮盘 `GardenPlantWheel` 用 `position: fixed; z-index: 1100`（高于其他弹窗），通过 `getPosition()` 基于点击的 `clientX/clientY` 定位并钳制在 `.garden-frame` 边界内（第 201-215 行），避免被 `overflow:hidden` 裁切。

```css
/* 所有弹窗统一模式 */
.shop-modal,
.signin-modal,
.achievement-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
}
.plant-wheel {
  position: fixed;
  z-index: 1100;  /* 高于普通弹窗 */
}
```

---

### 4.8 窗口拖动：data-tauri-drag-region

**现象**：garden 窗口配置了 `decorations: false`（无系统标题栏），无法用鼠标拖动移动窗口。

**根因**：无边框窗口默认没有可拖动区域，必须由前端显式声明拖动区。Tauri 2 提供两种方式：`data-tauri-drag-region` 属性（推荐）或 CSS `-webkit-app-region: drag`。

**错误尝试**：
1. 给整个 `.garden-frame` 加 `data-tauri-drag-region`——导致所有子元素（按钮、格子）都无法点击，拖动事件吞掉了点击事件。
2. 只加 `-webkit-app-region: drag` 不加 `no-drag`——关闭按钮、导航按钮落在拖动区内无法点击。

**正确方案**（`GardenMain.vue` 第 91 行 + 第 165-194 行）：
- 用一个独立的透明 `.garden-draggable` 层（绝对定位，顶部 `height: 30px`，`z-index: 1`）作为拖动区，并加 `data-tauri-drag-region`。
- 关闭按钮显式设置 `-webkit-app-region: no-drag`，确保可点击。
- 顶部 header 的导航按钮（签到/商店/成就）位于拖动区下方（`padding-top: 34px` 让 header 内容避开 30px 拖动层），不在拖动区内，天然可点击。

```html
<!-- 顶部 30px 透明拖动层 -->
<div class="garden-draggable" data-tauri-drag-region></div>
<!-- 关闭按钮在拖动层之上，显式 no-drag -->
<button class="garden-close-btn" @click="handleClose">×</button>
```

```css
.garden-draggable {
  -webkit-app-region: drag;
  position: absolute;
  top: 0; left: 0; width: 100%; height: 30px;
  z-index: 1;
}
.garden-close-btn {
  -webkit-app-region: no-drag;  /* 关键：让按钮可点击 */
  z-index: 10;
}
```

---

### 4.9【补充发现】前端 API 与 Rust 命令名/参数名不匹配

> 此问题在 `api/garden.ts` 顶部注释已声明（第 17-18 行："当前 src-tauri/src/lib.rs 暂未注册这些命令，调用会失败"）。以下是详细对照，供后续对齐使用。

**现象**：前端调用 `garden_buy_seed` / `garden_sell_crop` / `garden_unlock_plot` 等命令时，Rust 后端实际注册的是 `garden_buy` / `garden_sell` / `garden_unlock`，命令名和参数名都对不上，`invoke` 直接抛错。

**根因**：前端 `api/garden.ts` 与 Rust `commands/garden.rs` 由不同阶段编写，命名约定未对齐。

**对照表**：

| 前端 api/garden.ts 调用 | Rust 实际命令 | 命令名 | 参数名 | 返回类型 |
|---|---|---|---|---|
| `gardenRead` | `garden_read` | ✅ 一致 | — | Rust 返回 raw `Value` |
| `gardenWrite` | `garden_write` | ✅ 一致 | `gardenData` vs `data` ⚠️ | Rust 返回 `()` vs 前端期望 `bool` |
| `gardenPlant(plotIndex, seedId)` | `garden_plant(plot_id, crop)` | ✅ 一致 | `plotIndex` vs `plot_id` ⚠️；`seedId` vs `crop` ⚠️ | Rust 返回 raw `Value` ⚠️ |
| `gardenHarvest(plotIndex)` | `garden_harvest(plot_id)` | ✅ 一致 | `plotIndex` vs `plot_id` ⚠️ | Rust 返回 raw `Value` ⚠️ |
| `gardenBuySeed(seedId, quantity)` | `garden_buy(item, price)` | ❌ 不一致 | 完全不同 | Rust 返回 raw `Value` ⚠️ |
| `gardenSellCrop(cropId, quantity)` | `garden_sell(item, price)` | ❌ 不一致 | 完全不同 | Rust 返回 raw `Value` ⚠️ |
| `gardenUnlockPlot(plotIndex)` | `garden_unlock(plot_id)` | ❌ 不一致 | `plotIndex` vs `plot_id` ⚠️ | Rust 返回 raw `Value` ⚠️ |
| `gardenSignin()` | `garden_signin()` | ✅ 一致 | — | ✅ Rust 返回 `GardenOperationResult` 形状 |
| `gardenUpdateFocus(minutes)` | ❌ Rust 未实现 | — | — | — |
| `gardenPunishment(lossAmount)` | ❌ Rust 未实现 | — | — | — |

**返回类型不匹配的后果**：前端 `applyResult(result)` 检查 `result.gardenData`。只有 `garden_signin` 返回了 `{ success, gardenData, unlockedAchievements }` 形状；其余 Rust 命令返回的是裸 garden data 对象（没有 `gardenData` 字段），导致 `result.gardenData` 为 `undefined`，**store 不会刷新**，前端 UI 看不到种植/收获/买卖/解锁的效果。

**正确方案（待落地）**：以 `garden_signin` 为模板，统一所有 Rust 命令的返回为 `GardenOperationResult` 形状，并对齐命令名与参数名（camelCase 参数需配合 Tauri 的 `rename_all` 或手动映射）。当前 `api/garden.ts` 顶部注释已标记此为已知问题。

---

### 4.10【补充发现】Plot 数据结构前后端不一致

**现象**：即使命令对齐，种植/收获后前端 `Plot` 字段也对不上——前端读 `plot.locked` / `plot.progress` / `plot.plantedAt`，Rust 写的是 `plot.state`（"growing"/"empty"/"locked"）。

**对照**：

| 字段 | 前端 `Plot` 期望 | Rust 实际写入 |
|------|------------------|---------------|
| 锁定状态 | `locked: boolean` | `state: "locked"` |
| 作物 | `crop: string\|null` | `crop: string` + `state: "growing"` |
| 生长进度 | `progress: number`（分钟） | ❌ 未写入 |
| 种植时间 | `plantedAt: string\|null` | ❌ 未写入 |
| 空地 | `crop: null` | `state: "empty"` |

**根因**：Rust 端用简化的 `state` 字符串状态机，前端用结构化字段。`toGardenState` 直接把 `plots` 透传为 `Plot[]`，不做字段映射，所以 Rust 的 `state` 字段前端读不到，前端的 `locked`/`progress` Rust 不写。

**影响**：土地锁定状态、生长进度在前端可能始终显示为默认值。`GardenPlot.vue` 的 `getProgress` 依赖 `plot.progress`，若 Rust 不写则进度永远为 0。

**正确方案（待落地）**：Rust 端需按前端 `Plot` 结构写入 `locked` / `crop` / `progress` / `plantedAt`，或在 `toGardenState` 增加从 `state` 到结构化字段的映射层。

---

## 5. 数据结构清单

### 5.1 前端类型定义（src/stores/garden.ts）

#### GardenState（菜园子完整状态）

```typescript
export interface GardenState {
  coins: number;                    // 金币
  seeds: SeedBag;                   // 种子背包 { 种子ID: 数量 }
  crops: CropBag;                   // 作物背包 { 作物ID: 数量 }
  plots: Plot[];                    // 12 块土地
  warehouse: unknown[];             // 仓库（预留）
  signIn: SignInState;              // 签到状态
  achievements: AchievementMap;     // 成就解锁记录
  achievementStats: AchievementStats; // 成就统计指标
}
```

#### Plot（单块土地）

```typescript
export interface Plot {
  id: number;                       // 土地索引 0-11
  crop: string | null;              // 当前作物ID（null=空地）
  progress: number;                 // 生长进度（分钟）
  plantedAt: string | null;         // 种植时间戳
  locked?: boolean;                 // 是否锁定
}
```

默认值（`DEFAULT_GARDEN.plots`）：12 块地，前 6 块 `locked:false`，第 7-12 块 `locked:true`。

#### SignInState（签到状态）

```typescript
export interface SignInState {
  lastDate: string | null;          // 上次签到日期 "YYYY-MM-DD"（UTC）
  continuousDays: number;           // 连续签到天数
  totalDays: number;                // 累计签到天数
  weekRecords: boolean[];           // 本周记录 [7]，索引 0=周日...6=周六
}
```

#### AchievementStats（成就统计）

```typescript
export interface AchievementStats {
  totalFocusMinutes: number;        // 累计专注分钟
  totalHarvestCount: number;        // 累计收获次数
  totalPlantCount: number;          // 累计种植次数
  totalCoinsEarned: number;         // 累计获得金币
  cropTypesCollected: string[];     // 已收集作物种类ID
}
```

#### AchievementMap（成就解锁记录）

```typescript
export type AchievementMap = Record<
  string,
  { unlocked: boolean; unlockedAt: string } | undefined
>;
```

#### CropConfig（作物配置，静态）

```typescript
export interface CropConfig {
  name: string;        // 中文名
  growTime: number;    // 生长所需分钟
  icon: string;        // emoji 图标
  seedType: string;    // 种子类型ID
  rarity: Rarity;      // "common" | "rare" | "legend"
  value: number;       // 价值
  seedPrice: number;   // 种子售价
  sellPrice: number;   // 作物收购价
}
```

5 种作物（`CROP_CONFIG`）：

| key | 名称 | 图标 | 生长(分钟) | 稀有度 | 种子价 | 收购价 |
|-----|------|------|-----------|--------|--------|--------|
| carrot | 胡萝卜 | 🥕 | 25 | common | 8 | 10 |
| tomato | 番茄 | 🍅 | 50 | common | 16 | 20 |
| sunflower | 向日葵 | 🌻 | 90 | rare | 40 | 50 |
| rose | 玫瑰 | 🌹 | 120 | rare | 64 | 80 |
| osmanthus | 金桂树 | 🌳 | 180 | legend | 120 | 150 |

#### 土地解锁配置（PLOT_UNLOCK_CONFIG）

| 索引 | 解锁方式 | 条件 |
|------|----------|------|
| 0-5 | default | 默认解锁 |
| 6 | coins | 100 金币 |
| 7 | coins | 150 金币 |
| 8 | achievement | 连续签到100天（signin100） |
| 9 | achievement | 累计获得5000金币（coins5000） |
| 10 | coins | 500 金币 |
| 11 | coins | 800 金币 |

### 5.2 API 层类型（src/api/garden.ts）

```typescript
// 后端返回的原始数据（弱类型，由 toGardenState 收敛）
export interface GardenData {
  [key: string]: unknown;
}

// 操作结果（前端期望的返回形状）
export interface GardenOperationResult {
  success: boolean;
  unlockedAchievements?: Achievement[];
  gardenData?: GardenData;
  error?: string;
}

// 惩罚结果
export interface PunishmentResult {
  hasLoss: boolean;
  losses: Array<{ type: string; amount: number }>;
  totalMinutes: number;
}
```

### 5.3 Rust 端数据约定（commands/garden.rs）

Rust 端不定义强类型 struct，而是直接操作 `serde_json::Value`，手动 `insert` 键名。**关键约定：所有键名必须用 camelCase 与前端对齐**（见踩坑 4.5/4.6）。

签到相关写入字段：
- 顶层键：`"signIn"`（不是 `signin`）
- 子字段：`lastDate` / `continuousDays` / `totalDays` / `weekRecords`

日期工具函数（`commands/garden.rs` 第 13-77 行）：
- `today_date_string()` → `"YYYY-MM-DD"`（UTC）
- `date_string_offset(n)` → 偏移 n 天的日期串（UTC）
- `week_day_index()` → 0=周日...6=周六（UTC，基准 1970-01-01 周四）

---

## 6. 窗口配置说明

### 6.1 tauri.conf.json 中的 garden 窗口

```json
{
  "label": "garden",
  "title": "菜园子",
  "url": "garden.html",
  "width": 400,
  "height": 520,
  "resizable": false,
  "center": true,
  "decorations": false,
  "transparent": true,
  "shadow": false,
  "visible": false
}
```

| 配置项 | 值 | 原因 |
|--------|-----|------|
| `label` | `"garden"` | 窗口唯一标识，前端通过此 label 显示/隐藏 |
| `url` | `"garden.html"` | 独立 HTML 入口，非主窗口的 SPA 路由 |
| `width`/`height` | 400×520 | 固定尺寸，容纳 3 列土地 + header + 背包 + tip |
| `resizable` | `false` | 游戏化界面不需要拉伸，避免布局错乱 |
| `decorations` | `false` | 无系统标题栏，由前端自绘圆角 + 拖动区 + 关闭按钮 |
| `transparent` | `true` | 配合 `decorations:false` 实现圆角透明窗口 |
| `shadow` | `false` | 避免透明窗口边缘出现系统阴影框 |
| `visible` | `false` | 启动时隐藏，由主窗口通过 `showGardenWindow` 显式显示 |

### 6.2 与主窗口的对比

| 属性 | 主窗口 | garden 窗口 |
|------|--------|-------------|
| label | （默认） | `garden` |
| 尺寸 | 520×560 | 400×520 |
| resizable | false | false |
| decorations | false | false |
| transparent | true | true |
| visible | （默认 true） | false（按需显示） |

### 6.3 显示/隐藏

前端通过 `src/api/window.ts` 的 `hideGardenWindow()` 隐藏（`GardenMain.vue` 第 11 行导入，第 83-85 行调用）。显示由主窗口侧调用相应 show 逻辑。

---

## 7. 常见问题排查

### Q1：点击签到按钮提示"签到失败"

**排查步骤**：
1. 检查 `src-tauri/src/lib.rs` 是否注册了 `garden_signin` 命令（`invoke_handler` 中是否 `.invoke_handler(garden::garden_signin)`）。`api/garden.ts` 注释明确指出命令可能未注册。
2. 检查 Rust `garden_signin` 是否写入 camelCase 键 `"signIn"`（见踩坑 4.5）。若写成了 `signin`，前端读不到状态。
3. 查看开发者工具 Console 是否有 `invoke` 错误（命令不存在 / 参数名不匹配）。

### Q2：签到成功但状态不更新（按钮仍是"立即签到"）

**排查步骤**：
1. 在 store `applyResult` 处打印 `result.gardenData`——若 Rust 返回的是裸 data 而非 `{ gardenData: data }` 形状，`result.gardenData` 为 undefined，store 不刷新。
2. 确认 `garden_signin` 返回值结构为 `{ success, gardenData, unlockedAchievements }`（`garden.rs` 第 286-290 行已正确实现）。
3. 确认 `toGardenState` 读取的是 `g.signIn`（camelCase），且 Rust 写入的也是 `"signIn"`。

### Q3：种植/收获后 UI 无变化

**排查步骤**：
1. 这是已知的 API 不匹配问题（见踩坑 4.9）。Rust 的 `garden_plant` / `garden_harvest` 返回裸 `Value`，缺少 `gardenData` 包装，`applyResult` 不刷新。
2. 检查命令名：前端调 `garden_plant`（✅ 名字一致），但参数名前端传 `plotIndex`/`seedId`，Rust 收 `plot_id`/`crop`——Tauri 默认 camelCase 转 snake_case 可能不生效，需确认。
3. 检查 Plot 字段：Rust 写 `state`，前端读 `locked`/`progress`（见踩坑 4.10）。

### Q4：土地格子被截断 / 无法滚动

**排查步骤**：
1. 确认 `.garden-grid` 有 `flex: 1; min-height: 0; overflow-y: auto`（`GardenPlot.vue` 第 159-161 行）。缺 `min-height: 0` 会导致 flex 子项不收缩，无法滚动。
2. 确认父级 `.garden-frame` 是 `flex-direction: column`，且背包区 `.garden-bag-area` 有 `flex-shrink: 0` 不被压缩。
3. 确认窗口尺寸未被改动（400×520，resizable:false）。

### Q5：弹窗（商店/签到/成就）遮罩不完整或被裁切

**排查步骤**：
1. 确认弹窗用 `position: fixed; inset: 0`（不是 `absolute`）。
2. 确认弹窗没有被放在带 `transform`/`filter` 的祖先内（会破坏 fixed 定位）。
3. 确认 `src/garden.ts` 没有套 `.container` 包裹层，`#app` 直接挂载 `GardenMain`。
4. 确认 `.garden-frame` 的 `overflow: hidden` 只影响普通流子元素，不影响 `fixed` 弹窗（见踩坑 4.7）。

### Q6：窗口无法拖动 / 关闭按钮点不到

**排查步骤**：
1. 确认顶部有 `data-tauri-drag-region` 的元素（`.garden-draggable`）。
2. 确认关闭按钮有 `-webkit-app-region: no-drag`，否则落在拖动区内不可点击。
3. 确认拖动层 `z-index` 低于关闭按钮（拖动层 z-index:1，关闭按钮 z-index:10）。

### Q7：种植轮盘位置偏移 / 出现在窗口外

**排查步骤**：
1. `GardenPlantWheel` 的 `getPosition()` 基于点击事件的 `clientX/clientY`，钳制在 `.garden-frame` 的 `getBoundingClientRect()` 边界内（第 201-215 行）。
2. 若 `.garden-frame` 不存在（querySelector 返回 null），回退到 `window.innerWidth/innerHeight` 钳制。
3. 确认轮盘 `position: fixed` 且 `z-index: 1100`（高于其他弹窗）。

### Q8：跨日签到异常（昨天签到今天提示已签到 / 或反之）

**排查步骤**：
1. 前端取日期用 `new Date().toISOString().split("T")[0]`（UTC），Rust 用 `today_date_string()`（UTC）。两端必须同为 UTC，不能一端 UTC 一端本地时区。
2. `canSignInToday` 比较 `signIn.lastDate !== today`——若 `lastDate` 是本地时区写入的字符串，与 UTC 的 today 比较会差一天。
3. 连续签到判断：Rust 用 `date_string_offset(-1)` 取昨天，与 `lastDate` 比较（`garden.rs` 第 233-246 行）。

---

## 附录：模块文件清单

| 文件 | 角色 |
|------|------|
| `garden.html` | 窗口 HTML 入口 |
| `src/garden.ts` | Vue 应用入口（createApp + Pinia） |
| `src/components/garden/GardenMain.vue` | 主界面（框架/拖动/协调子组件） |
| `src/components/garden/GardenPlot.vue` | 土地网格（12 格） |
| `src/components/garden/GardenPlantWheel.vue` | Canvas 种植轮盘 |
| `src/components/garden/GardenBag.vue` | 背包（种子/作物） |
| `src/components/garden/GardenShop.vue` | 商店弹窗（买种子/卖作物） |
| `src/components/garden/GardenSignin.vue` | 签到弹窗 |
| `src/components/garden/GardenAchievement.vue` | 成就墙弹窗 |
| `src/stores/garden.ts` | Pinia store + 静态配置 + 类型定义 |
| `src/api/garden.ts` | Tauri invoke 封装 |
| `src-tauri/src/commands/garden.rs` | Rust 命令实现 |
| `src-tauri/tauri.conf.json` | 窗口配置（garden 窗口段） |
