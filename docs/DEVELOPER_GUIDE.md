# 开发者指南

> 本文档含旧版 Electron + Supabase 内容（历史参考）。当前版本为 **Tauri v2 + Vue 3 + Rust**，
> 云端后端为自建服务器（JWT + WebSocket），对接文档见 `server-planning/API-implementation.md`。

本文档为番茄钟项目的开发者提供技术参考，包含项目架构、模块说明、开发规范等内容。

---

## 目录

- [项目架构](#项目架构)
- [目录结构](#目录结构)
- [核心模块](#核心模块)
- [进程通信](#进程通信)
- [数据存储](#数据存储)
- [开发环境](#开发环境)
- [构建与打包](#构建与打包)
- [代码规范](#代码规范)
- [常见问题](#常见问题)

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [MODAL_SYSTEM.md](./MODAL_SYSTEM.md) | 弹窗系统架构说明（BaseModal/AnimatedModal） |
| [GARDEN_DATA_ARCHITECTURE.md](./GARDEN_DATA_ARCHITECTURE.md) | 菜园子数据架构说明（原子操作、互斥锁） |
| [BUGFIX_RECORDS.md](./BUGFIX_RECORDS.md) | Bug 修复记录 |

---

## 项目架构

### 技术栈

**前端：**
- Electron 34.0.0 - 桌面应用框架
- HTML5/CSS3/JavaScript (ES6)
- Chart.js 4.5.1 - 数据可视化

**后端子进程：**
- Python 3.x - 音乐播放和前台检测
- sounddevice/soundfile - 音频处理
- pynput - 全局快捷键监听
- openai - DeepSeek API调用

**云端服务：**
- Supabase - 用户认证和数据同步

### 多进程架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron 主进程 (main.js)                 │
│  - 窗口管理（主窗口、菜园子窗口）                              │
│  - IPC 通信路由                                              │
│  - 系统托盘                                                  │
│  - 模块协调（音乐、前台检测、AI助手、云认证）                   │
└───────────────┬─────────────────────────────────────┬───────┘
                │ stdin/stdout (JSON Lines)           │ stdin/stdout (JSON Lines)
                ▼                                     ▼
┌───────────────────────────┐         ┌───────────────────────────┐
│   music.exe (Python)      │         │ foreground_inspection.exe │
│   - 音频播放控制           │         │ - 前台窗口检测            │
│   - 设备管理               │         │ - AI 娱乐判断             │
│   - 快捷键监听             │         │ - 黑白名单管理            │
│   - 播放列表管理           │         │ - 历史记录学习            │
└───────────────────────────┘         └───────────────────────────┘
```

---

## 目录结构

```
electron_pomodoro/
├── main.js                    # Electron 主进程入口
├── preload.js                 # 预加载脚本（IPC 桥接）
├── package.json               # 项目配置和依赖
│
├── src/                       # 前端资源目录
│   ├── index.html             # 主页面（计时器、音乐播放器等）
│   ├── garden.html            # 菜园子独立窗口
│   ├── loading.html           # 启动加载页
│   │
│   ├── styles/                # CSS 样式（按功能拆分）
│   │   ├── base.css           # 基础样式、CSS 变量、主题
│   │   ├── sidebar.css        # 侧边栏（预设列表、计划列表）
│   │   ├── main-content.css   # 主内容区（计时器、模式切换）
│   │   ├── music-player.css   # 音乐播放器
│   │   ├── modal.css          # 弹窗通用样式
│   │   ├── modes.css          # 工作/休息模式
│   │   ├── statistics.css     # 统计图表
│   │   ├── charts.css         # 热歌榜单
│   │   ├── ai-helper.css      # AI助手
│   │   ├── api-key-modal.css  # API配置弹窗
│   │   ├── garden.css         # 菜园子基础样式
│   │   ├── gardenBag.css      # 菜园子背包样式
│   │   ├── gardenShop.css     # 菜园子商店样式
│   │   ├── gardenSignin.css   # 菜园子签到样式
│   │   ├── gardenAchievement.css # 菜园子成就样式
│   │   └── settings.css       # 设置弹窗
│   │
│   ├── scripts/               # 渲染进程脚本
│   │   ├── renderer.js        # 主入口，初始化所有模块
│   │   └── modules/           # 功能模块（IIFE 封装）
│   │       ├── utils.js       # 工具函数（时间格式化、作物配置等）
│   │       ├── dom.js         # DOM 元素缓存
│   │       ├── dataStore.js   # 本地数据读写（通过IPC）
│   │       ├── stats.js       # 统计数据管理
│   │       ├── modal.js       # 弹窗基类（BaseModal, AnimatedModal）
│   │       ├── apiKeyManager.js # API Key 管理UI
│   │       ├── wheelPicker.js # 滚轮选择器
│   │       ├── presets.js     # 时间预设管理
│   │       ├── planMode.js    # 计划模式（任务队列、拖拽排序）
│   │       ├── noteManager.js # 备注管理
│   │       ├── timer.js       # 计时器核心（三阶段架构）
│   │       ├── mode.js        # 工作/休息模式切换
│   │       ├── appState.js    # 应用状态（专注模式、迷你模式）
│   │       ├── callbacks.js   # 回调函数注册
│   │       ├── theme.js       # 深色模式
│   │       ├── tutorial.js    # 教程弹窗
│   │       ├── musicPlayer.js # 音乐播放器 UI
│   │       ├── aiHelper.js    # AI 规划助手 UI
│   │       ├── statistics.js  # 数据统计（Chart.js集成）
│   │       ├── garden.js           # 菜园子主入口
│   │       ├── gardenPlot.js       # 菜园子-土地格子模块
│   │       ├── gardenBag.js        # 菜园子-背包模块
│   │       ├── gardenShop.js       # 菜园子-商店模块
│   │       ├── gardenSignin.js     # 菜园子-签到模块
│   │       ├── gardenAchievement.js # 菜园子-成就模块
│   │       ├── foregroundDetection.js # 前台检测 UI（警告、惩罚弹窗）
│   │       ├── charts.js      # 热歌榜单（网易云/QQ音乐）
│   │       └── settings.js    # 设置管理
│   │
│   └── modules/               # 主进程模块（Node.js）
│       ├── dataManager.js     # 本地数据文件读写
│       ├── musicProcess.js    # 音乐子进程通信
│       ├── foregroundInspection.js  # 前台检测子进程通信
│       ├── cloudAuth.js       # 云端认证（Supabase）
│       ├── aiAssistant.js     # AI 助手（DeepSeek API）
│       ├── chartsFetcher.js   # 榜单抓取（网易云/QQ音乐）
│       └── songDownloader.js  # 歌曲下载器
│
├── music-player/              # Python 音乐播放器
│   ├── music.py               # 源码（~1200行）
│   ├── music.exe              # 打包后可执行文件
│   ├── manual_downloader.py   # 手动下载器源码
│   ├── manual_downloader.exe  # 下载器可执行文件
│   ├── youget_download.py     # you-get下载脚本
│   └── music/                 # 音乐文件目录
│       ├── tags.json          # 歌曲标签配置
│       └── *.mp3              # MP3音乐文件
│
├── foreground_inspection/     # Python 前台检测
│   ├── foreground_inspection.py  # 源码（~500行）
│   ├── foreground_inspection.exe # 打包后可执行文件
│   ├── model_config.json      # DeepSeek API 配置
│   └── list_config.json       # 黑白名单和历史记录
│
├── doc/                       # 项目文档
│   ├── BUGFIX_RECORDS.md      # Bug修复记录
│   └── DEVELOPER_GUIDE.md     # 开发者指南（本文档）
│
└── dist/                      # 打包输出目录
    └── 番茄钟-win32-x64/      # Windows可执行版本
```

---

## 核心模块

### 1. 计时器模块 (timer.js)

**职责：** 实现精确计时的核心逻辑

**关键特性：**
- **三阶段架构：** READY → RUNNING → FINISHED
- **时间戳计算：** 解决后台节流问题，保证计时准确性
- **状态保存/恢复：** 支持模式切换时保持状态

**阶段定义：**
```javascript
const PHASE = {
  READY: 'ready',       // 准备阶段 - 等待开始
  RUNNING: 'running',   // 运行阶段 - 计时中
  FINISHED: 'finished'  // 结束阶段 - 等待重置
}
```

**API：**
```javascript
Timer.init(elements, callbacks)  // 初始化
Timer.start()                     // 开始计时
Timer.pause()                     // 暂停
Timer.reset()                     // 重置
Timer.setTime(minutes)            // 设置时长
Timer.getPhase()                  // 获取当前阶段
Timer.getTimeLeft()               // 获取剩余时间
```

---

### 2. 音乐播放器 (musicPlayer.js + music.py)

**职责：** 提供音乐播放功能和UI交互

**架构：**
- **渲染进程 (musicPlayer.js):** UI渲染、用户交互、IPC通信
- **Python子进程 (music.py):** 实际音频播放、设备切换、快捷键监听

**通信协议：**
```json
// Electron → Python
{"command": "toggle"}
{"command": "seek", "position": 30}
{"command": "set_device", "device_id": 5}

// Python → Electron
{"event": "status", "data": {"playing": true, "name": "song.mp3"}}
{"event": "track_change", "data": {"name": "new_song.mp3", "duration": 180}}
```

**特性：**
- 随机/顺序播放模式
- 音频输出设备切换
- 全局快捷键（右Ctrl组合键）
- 播放超时检测（3秒无响应报错）
- 歌曲标签系统（学习/运动/休息/自定义）
- 播放列表管理（删除、标签编辑）

---

### 3. 前台检测 (foregroundDetection.js + foreground_inspection.py)

**职责：** 检测用户是否切换到娱乐应用，防止分心

**工作流程：**
1. 专注模式开启且计时器运行时自动启动
2. 每秒检测当前前台窗口标题
3. 匹配黑名单 → 直接警告
4. 不在白名单 → AI判断（Admin用户）或询问用户
5. 累计3次警告触发惩罚（作物枯萎）

**判定来源：**
- `blacklist`: 黑名单直接命中
- `history`: 历史AI判断结果
- `ai`: 实时AI判断

**API Key要求：**
- Admin用户登录后自动获取DeepSeek API Key
- 非Admin用户或未登录：跳过AI判断，仅使用黑白名单

---

### 4. 菜园子系统 (garden.*.js)

**职责：** 游戏化激励机制，种菜收获增加趣味性

**模块架构（v2.6.0 重构）：**

菜园子代码按功能拆分为多个模块，每个模块控制在500行以内：

| 模块 | 文件 | 职责 |
|------|------|------|
| 主入口 | `garden.js` | 初始化、状态管理、协调子模块 |
| 土地格子 | `gardenPlot.js` | 格子渲染、种植、收获、解锁 |
| 背包系统 | `gardenBag.js` | 背包展开/收起、种子/作物列表渲染 |
| 商店系统 | `gardenShop.js` | 购买种子、出售作物 |
| 签到系统 | `gardenSignin.js` | 每日签到、奖励发放 |
| 成就系统 | `gardenAchievement.js` | 成就墙、进度显示 |

**样式拆分（garden.*.css）：**
- `garden.css` - 基础框架、格子样式
- `gardenBag.css` - 背包样式
- `gardenShop.css` - 商店弹窗样式
- `gardenSignin.css` - 签到弹窗样式
- `gardenAchievement.css` - 成就墙弹窗样式

**核心功能：**
- **种植系统：** 12块土地，5种作物（胡萝卜、番茄、向日葵、玫瑰、金桂树）
- **成长机制：** 专注时间内作物持续生长，每分钟更新进度
- **惩罚机制：** 专注中断（前台检测3次警告/手动重置）导致作物枯萎
- **商店系统：** 购买种子、出售作物、金币交易
- **签到系统：** 每日签到奖励、连续签到里程碑、每周特殊奖励
- **成就系统：** 6大类成就（专注、收获、种植、收集、财富、坚持）

**性能优化（v2.6.0）：**
- 入场动画等待数据加载完成后触发，避免内容闪烁
- 模块化加载，代码更易维护

**数据结构：**
```javascript
{
  coins: 100,
  seeds: { carrot: 5, tomato: 2, ... },
  plots: [
    { id: 0, crop: 'carrot', progress: 15, plantedAt: '2026-04-04T...' },
    { id: 1, crop: null, progress: 0, locked: false },
    ...
  ],
  crops: { carrot: 3, tomato: 1, ... },
  achievements: { focus_60: { unlocked: true, unlockedAt: '...' } },
  achievementStats: { totalFocusMinutes: 120, ... },
  signIn: { lastDate: '...', continuousDays: 7, ... }
}
```

---

### 5. 计划模式 (planMode.js)

**职责：** 支持多任务队列，自动依次执行番茄钟

**功能：**
- 添加工作/休息任务到队列
- 拖拽调整任务顺序
- 自动进入下一项任务
- 每个任务可添加备注
- 与AI助手集成（AI生成计划）

**拖拽排序实现：**
```javascript
// dragstart → 标记拖拽源
// dragover → 显示放置目标
// drop → 重新排序数组并保存
```

---

### 6. AI助手 (aiHelper.js + aiAssistant.js)

**职责：** 使用DeepSeek API根据自然语言生成番茄钟计划

**使用流程：**
1. 用户输入需求："我要学习3小时，每45分钟休息10分钟"
2. 发送到DeepSeek API
3. AI返回结构化计划
4. 用户确认后一键应用到计划模式

**Prompt设计：**
```
你是一个番茄钟规划助手。根据用户的需求，生成合理的工作/休息计划。
返回JSON格式：{"summary": "...", "plan": [{"type": "work/break", "minutes": 45, "description": "..."}]}
```

---

### 7. 数据统计 (statistics.js)

**职责：** 记录和展示专注数据

**统计维度：**
- 每日：当天专注次数、总时长
- 每周：本周每天的数据对比
- 每月：本月趋势分析

**图表类型：**
- 柱状图：直观对比每天的专注时长
- 折线图：观察长期趋势
- 饼状图：工作/休息占比

**数据来源：**
- 每次计时完成（FINISHED阶段）记录到 `stats` 对象
- 部分完成的专注时间也会记录（带备注）

---

## 进程通信

### Electron IPC 架构

**主进程 ↔ 渲染进程：**
```javascript
// 主进程注册 handler
ipcMain.handle('read-data', () => {
  return dataManager.readData()
})

// 渲染进程调用
const data = await window.electronAPI.readData()
```

**预加载脚本暴露API：**
```javascript
// preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  readData: () => ipcRenderer.invoke('read-data'),
  musicTogglePlay: () => ipcRenderer.send('music-toggle'),
  onMusicStatus: (callback) => ipcRenderer.on('music-status', callback)
})
```

### Python 子进程通信

**stdin/stdout JSON Lines协议：**

```python
# Python端发送
import json, sys
output = json.dumps({"event": "status", "data": {...}}, ensure_ascii=False)
sys.stdout.write(output + "\n")  # 换行符分隔
sys.stdout.flush()
```

```javascript
// Node.js端接收
musicProcess.stdout.on('data', (data) => {
  const lines = data.toString().split('\n')
  lines.forEach(line => {
    if (line.trim()) {
      const event = JSON.parse(line)
      handleEvent(event)
    }
  })
})
```

**关键注意事项：**
- 必须设置UTF-8编码：`sys.stdout.reconfigure(encoding='utf-8')`
- 每条消息以换行符 `\n` 结尾
- 避免在stdout输出调试信息（会干扰JSON解析）

---

## 数据存储

### 本地数据

**存储位置：**
- 开发环境：`%APPDATA%/pomodoro-timer/data/data.json`
- 打包后：同上（Electron userData路径）

**数据结构：**
```javascript
{
  apiKey: null,              // DeepSeek API Key（本地模式）
  apiMode: 'cloud',          // 'cloud' | 'local'
  stats: {
    date: "Sat Apr 04 2026",
    todayCount: 5,
    totalMinutes: 125
  },
  presets: {
    work: [15, 25, 45, 60],
    break: [5, 10, 15]
  },
  planList: [],              // 计划模式任务队列
  audioDevice: null,         // 音频输出设备ID
  miniModePosition: [x, y],  // 迷你模式窗口位置
  settings: {                // 用户设置
    darkMode: false,
    autoStart: false,
    minimizeBehavior: 'mini',
    showGardenBtn: true,
    ...
  },
  garden: { ... }            // 菜园子数据
}
```

**读写API：**
```javascript
// 渲染进程
const data = await window.electronAPI.readData()
await window.electronAPI.writeData(updatedData)

// 主进程
const dataManager = require('./src/modules/dataManager')
const data = dataManager.readData()
dataManager.writeData(data)
```

### 云端数据

**Supabase集成：**
- 用户认证（注册/登录/会话管理）
- Admin用户获取DeepSeek API Key
- 普通用户无法使用AI功能

**认证流程：**
1. 用户输入用户名密码
2. 调用Supabase Auth API
3. 验证成功后检查是否为admin角色
4. Admin用户从Supabase Database读取API Key
5. API Key仅存内存，不持久化到本地

---

## 开发环境

### 环境要求

- Node.js >= 16.x
- npm >= 8.x
- Python 3.8+ （仅修改Python源码时需要）

### 安装依赖

```bash
npm install
```

### 启动开发模式

```bash
npm start
```

这会：
1. 设置控制台编码为UTF-8
2. 启动Electron应用
3. 自动加载 `music-player/music.exe` 和 `foreground_inspection/foreground_inspection.exe`

### 调试技巧

**渲染进程调试：**
- 打开DevTools：`Ctrl+Shift+I`（需在代码中添加快捷键或菜单）
- 查看Console日志：`console.log()` 输出到DevTools

**主进程调试：**
- 日志输出到终端：`console.log()` 在启动终端可见
- 使用 `electron-debug` 包进行高级调试

**Python子进程调试：**
- stderr输出：`print("debug", file=sys.stderr)` 可在主进程终端看到
- 查看进程是否启动：任务管理器查找 `music.exe` 和 `foreground_inspection.exe`

---

## 构建与打包

### 发布流程约定（强制）

> 规则：**每次完成代码改动或准备打包/发版前，必须先同步更新文档**，再 commit + push。
> 文档落后于代码时禁止发版。

- 涉及功能的改动 → 同步更新对应文档：
  - 接口/协议变化 → `server-planning/API-implementation.md`
  - 模块架构/流程变化 → `docs/` 下对应架构文档（如 `STUDY_ROOM_ARCHITECTURE.md`）
  - 自建服务器代码改动 → 在 `server-planning/API-implementation.md` 留言区记录并同步服务器部门
- 发版顺序：改代码 → 更新文档 → commit（含文档）→ push → 打 tag → 触发 CI 构建/发布
- 禁止在文档未更新的情况下直接 `npm run build` / `build:installer` / 打 tag
- 构建运行位置（自建 runner，v4.5.8 起）：
  - `test`（Test & Coverage）与 `release` job 仍在 GitHub 托管 runner 执行
  - `build`（NSIS 打包）job 由**本地自建 runner** 执行（`d:\actions-runner`，label `self-hosted, windows, x64`）——速度快、不排队、不占 GitHub 构建配额；首次运行需全量编译较慢，之后依赖 rust-cache 加速
  - 使用前自建 runner 必须处于运行状态：前台 `d:\actions-runner\run.cmd`（或已安装为 Windows 服务）；若未启动，build job 会一直排队直至超时，需手动启动 runner 或临时把 `runs-on` 改回 `windows-latest`
  - 工具链与缓存全部放 D 盘（`D:\pomosolo-cache\{cargo,rustup,npm}`），避免占 C 盘；机器空间有限，注意定期清理 `D:\actions-runner\_work` 下历史 job 目录

### 打包为可执行文件

```bash
npm run build
```

**打包产物：**
- `dist/番茄钟-win32-x64/番茄钟.exe` - 主程序
- `dist/番茄钟-win32-x64/resources/` - 资源目录
  - `music.exe` - 音乐播放器
  - `music/` - 音乐文件和tags.json
  - `manual_downloader.exe` - 手动下载器
  - `foreground_inspection.exe` - 前台检测
  - `list_config.json` - 黑白名单配置
  - `model_config.json` - AI模型配置

### 创建安装包

```bash
npm run build:installer
```

这会生成NSIS安装包（`.exe`），包含：
- 安装向导
- 桌面快捷方式
- 开始菜单项
- 卸载程序

**构建速度（Cargo.toml `[profile.release]`）：**
- v4.5.9 起改为 `lto = "thin"` + `codegen-units = 16`：链接可并行 + 恢复并行 codegen，构建提速数倍（7800X3D 16 线程用满）；体积略增（~1MB）、性能差异 <2%
- 旧配置（fat LTO + codegen-units=1）把编译/链接压成单线程，全量构建 30-40 分钟且 CPU 占用低，勿改回

**安装包配置（package.json）：**
```json
{
  "build": {
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "installerIcon": "src/tomato-page-1-256.ico",
      ...
    }
  }
}
```

### 排除文件

打包时会排除以下目录以减小体积：
- `music-player/` 源码（只包含exe）
- `foreground_inspection/` 源码
- `supabase-test/` 测试目录
- `node_modules/` 中的测试和文档

---

## 代码规范

### Git提交规范

使用前缀标识提交类型：

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat:` | 新功能 | `feat: 添加开机自启动功能` |
| `fix:` | 修复Bug | `fix: 修复计时器暂停后时间重置的问题` |
| `docs:` | 文档修改 | `docs: 更新 README 安装说明` |
| `refactor:` | 代码重构 | `refactor: 重构计时器模块` |
| `style:` | 代码格式（不影响功能） | `style: 修复缩进` |
| `chore:` | 构建/工具相关 | `chore: 更新依赖版本` |
| `perf:` | 性能优化 | `perf: 优化计时器tick频率` |

### JavaScript编码规范

**模块化：**
- 使用IIFE（立即执行函数表达式）封装模块
- 通过 `window.ModuleName` 暴露公共API
- 严格模式：`'use strict'`

**命名约定：**
- 变量/函数：camelCase
- 常量：UPPER_SNAKE_CASE
- 类/构造函数：PascalCase

**示例：**
```javascript
;(function() {
  'use strict'
  
  let state = {}
  const MAX_RETRIES = 3
  
  function init(options) { ... }
  function handleClick() { ... }
  
  window.MyModule = {
    init: init
  }
})()
```

### CSS规范

**CSS变量：**
- 所有颜色、尺寸使用CSS变量定义
- 支持深色模式通过 `[data-theme="dark"]` 覆盖变量

**命名：**
- BEM风格：`.block__element--modifier`
- 语义化命名：`.timer-container`, `.btn-start`

---

## 常见问题

### Q1: Python子进程启动失败

**症状：** 终端显示 "spawn music.exe ENOENT"

**解决：**
1. 检查exe文件是否存在于正确路径
2. 开发环境：`music-player/music.exe`
3. 打包后：`resources/music.exe`
4. 确认没有被杀毒软件误杀

### Q2: 前台检测不工作

**症状：** 专注模式下切换到娱乐应用没有警告

**排查步骤：**
1. 确认已登录Admin账户
2. 检查 `foreground_inspection/list_config.json` 配置
3. 查看主进程日志是否有 "API key invalid" 错误
4. 确认 `foreground_inspection.exe` 正在运行

### Q3: 数据丢失

**症状：** 重启应用后统计数据清零

**原因：**
- 数据文件损坏或权限不足

**解决：**
1. 找到数据文件：`%APPDATA%/pomodoro-timer/data/data.json`
2. 检查文件是否可读可写
3. 查看备份文件（如果有）

### Q4: 音乐无法播放

**症状：** 点击播放按钮无反应

**排查：**
1. 检查音频输出设备是否正确
2. 尝试切换设备（点击🎧按钮）
3. 查看Python进程stderr输出
4. 确认MP3文件存在于 `music/` 目录

### Q5: 打包后体积过大

**优化方案：**
1. 移除不必要的依赖
2. 使用 `@electron/packager` 的 `--ignore` 参数排除源码
3. 压缩音乐文件（降低比特率）
4. 使用UPX压缩exe（可选）

---

## 贡献指南

欢迎提交Issue和Pull Request！

**提交Bug报告：**
- 描述问题现象
- 提供复现步骤
- 附上相关日志或截图

**提交新功能：**
- 先开Issue讨论必要性
- 遵循现有代码风格
- 添加必要的注释

---

## 联系方式

- GitHub: https://github.com/liaowenqi123/electron_pomodoro
- Issues: https://github.com/liaowenqi123/electron_pomodoro/issues
