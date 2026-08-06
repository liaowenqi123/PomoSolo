# Electron 应用自动更新技术文档

> **状态**：历史设计文档（Electron + Supabase 时代）。Tauri 版自动更新从 v4.5.15 起
> 改为**客户端自实现更新器**（`src-tauri/src/commands/update.rs`），支持在设置中选择更新源：
> - GitHub（默认）：`https://github.com/liaowenqi123/PomoSolo/releases/latest/download/latest.json`，下载快但国内可能不稳定
> - 服务器：`http://115.159.49.112/updates/latest.json`，稳定但仅 3Mbps 较慢
>
> 流程：请求所选源 `latest.json`（version/url/signature）→ 版本比较 → 下载安装包（进度事件
> `update-status: downloading`）→ 校验 Ed25519 签名（公钥来自 `tauri.conf.json` plugins.updater.pubkey）
> → 启动安装器并退出应用。`tauri-plugin-updater` 的 endpoints 编译期固定无法运行时切换，故未复用其检查/安装路径。
>
> ⚠️ **插件 endpoints 必须只含 https（v4.5.16 闪退修复）**：`tauri-plugin-updater` 仍注册在 `lib.rs` 但完全不参与
> 检查/下载/安装。它的 `plugins.updater.endpoints` 配置在**插件初始化时**校验，**非 https 端点（如 `http://115.159.49.112/...`）
> 会直接 panic → 应用启动即闪退**（v4.5.15 曾踩坑，进程起来几秒消失 / WebView2 报 localhost 拒绝连接）。
> 因此该配置只保留 https 占位地址（GitHub），两个真实更新源地址硬编码在 `update.rs` 中，运行时切换与插件配置无关。
>
> ⚠️ **latest.json 解析必须按 tauri 规范（v4.5.17 修复）**：`update.rs` 的 `LatestJson` 从 `platforms.windows-x86_64.{url,signature}`
> 提取下载信息（v4.5.15/4.5.16 曾把 `url`/`signature` 定义在顶层 → 全链报 `missing field 'url'`）。已用真实发布物
> 做夹具回归测试（`test_parse_real_github_latest_json` / `test_parse_real_server_latest_json`），改更新解析逻辑
> 必须先更新夹具再跑测试。
>
> ⚠️ **版本号识别语义化（v4.5.18 修复）**：此前 `is_newer` 把 "4.6.0-beta.0" 与 "4.6.0" 当作同一版本，
> 无法区分正式版与 beta → 会漏推正式版更新。v4.5.18 重写为语义化比较：
> - `is_newer` 每段解析为 `(数字, 有无 prerelease 后缀)` 二元组，同数字带后缀的**更旧**（"4.6.0-beta.0" < "4.6.0"）
> - 新增 `is_prerelease`：任一数字段带非数字后缀（beta/alpha/rc）即 prerelease
> - `check_update` 新增 `allow_beta` 参数（默认 false）：正式渠道遇到 prerelease 时 emit
>   `not-available + betaOnly:true + betaVersion`，不打扰正式用户；设置面板新增"接收 Beta 版本更新"开关（默认关），
>   开启后 `allow_beta=true` 才会把 beta 当可更新项提示。
>
> ⚠️ **Beta 检测数据源修复（v4.5.19）**：v4.5.18 只修了版本比较逻辑，但**数据源仍拿不到 beta**——
> GitHub 的 `releases/latest/download/latest.json` 端点永远指向最新**非 prerelease** release（即 v4.5.18），
> 服务器 `/updates/latest.json` 也只有一份（被正式版覆盖）→ 开了 Beta 开关也检测不到 4.6.0-beta.0。
> v4.5.19 起 `fetch_latest_json(source, allow_beta)` 按渠道分流：
> - GitHub Beta 渠道：调 GitHub API `releases?per_page=100`（含 prerelease），用 `is_newer` 语义找版本号
>   最大的 release，取其 `latest.json` 资产下载地址（未认证限流 60 次/时/IP，检查频率低够用）；
> - 服务器 Beta 渠道：独立文件 `http://115.159.49.112/updates/latest-beta.json`（正式/测试互不覆盖，已部署 4.6.0-beta.0）；
> - `download_and_install` 同步新增 `allow_beta` 参数（前端下载时透传，否则下载阶段会重新拉正式版 latest.json）。
>
> ⚠️ **签名验证修复（v4.5.20，最重要）**：自 v4.5.15 自实现更新器起，`verify_installer` 从未验证通过过任何真实安装包
> （现象：下载完报"安装包签名验证失败，已拒绝安装"，4.5.17~4.5.19 全部中招）。三重根因：
> - **公钥偏移错误**：`parse_pubkey` 取 RWT 行解码后 `bytes[3..35]`，实际公钥在 `[10..42]`（格式 = "Ed"(2) + key_id(8) + 公钥(32)）→ 提取的是垃圾值，没有对应私钥；
> - **签名格式错误**：latest.json `signature` = base64(minisign 签名文本)（RUT 行解码 74 字节 = "ED"(2)+key_id(8)+签名(64)），旧代码期望解码后正好 64 字节；
> - **算法错误**：tauri 是**预哈希模式** `Ed25519(blake2b-512(文件))`（RUT 行 [0..2]="ED" 大写），旧代码用裸 Ed25519 直签文件。
> v4.5.20 重写 `verify_installer`：正确解析 minisign 格式 + blake2b-512 预哈希验证（新增 `blake2` 依赖），
> 同时兼容裸 64 字节直签格式。已用真实 v4.5.19 发布物验证通过（RUT[10:74] + blake2b prehash）。
> **老客户端升级须知**：已装的 4.5.15~4.5.19 客户端因错误公钥（垃圾值），**任何签名都无法通过其验证**，
> 自动更新路径不可修复 → 老用户需**手动下载 v4.5.20 安装包覆盖安装一次**（NSIS 安装器不做签名校验），
> 装好后自动更新恢复正常。
>
> ⚠️ **服务器公告 / 官方指引（v4.5.21）**：为彻底解决"更新出错时用户不知道怎么做（曾逼用户删除重装）"的问题，
> 新增公告机制：
> - 服务器静态文件 `http://115.159.49.112/updates/notice.json`（**零服务器代码改动**），字段：
>   `active`（总开关）、`level`（warning/error/info）、`text`（指引文案）、`url`（指引链接）、
>   `min_version`/`max_version`（生效版本范围，语义化比较，空=不限）；
> - 前端**更新出错**（签名验证失败/下载失败等 `update-status: error`）时，经 Rust 命令
>   `fetch_notice(version)` 拉取公告并展示在设置面板"关于"区（CSP 限制 `connect-src 'self'`，
>   前端不能直接 fetch，必须走 Rust reqwest）；
> - 拉取失败 / 非 200 / 解析失败 / 未 active / 不在版本范围 → 后端返回 `Ok(None)`，**不打扰用户**；
> - 部署后 4.5.15~4.5.19 老用户更新失败时会看到"请手动升级 v4.5.20 覆盖安装"指引，不再需要删重装。

> ## Phase 2：P2P 种子下载安装包（v4.6.0-beta.0，2026-08-04）
>
> 服务器 3Mbps 慢、GitHub 国内不稳 → 用户本机带宽充裕，增加**在线种子 P2P 直连**路径：
>
> **种子端**（分享安装包开关，需登录）：`SettingsPanel` → 开启后 `startSeedSharing(appVersion)`
> 调 `p2p_seed_register`（version + 文件名 + size）注册 → 每 30s `p2p_seed_heartbeat` 保活 →
> 关闭/登出时 `p2p_seed_unregister`。服务器只维护内存种子表（user_id → {version, file, size, last_seen}，
> 60s 无心跳自动清理），**不存文件、不中转数据**（见 `server-planning/ws_server.py` p2p:seed_* 消息）。
>
> **下载端**（更新按钮，种子优先）：`check_update` 返回的 `UpdateInfo` 新增 `signature` 字段（来自 latest.json）
> → 下载前 `p2p_seed_list(version)` 查在线种子 → 有种子则前端 WebRTC 收片（`p2pReceive` DataChannel 分片）
> → 逐片调 `update_seed_download_chunk`（Rust 落盘到系统临时目录 `pomosolo_update_{version}.exe`）
> → 收齐后 Rust `finish_seed_install` 复用 `verify_installer` 校验 Ed25519 签名 → 通过则启动安装器并退出应用。
> 无种子 / P2P 失败（`onError` → `update_seed_download_abort` 清会话删残留）→ 自动回退现有
> `downloadAndInstall`（服务器/GitHub）。
>
> **实现文件**：Rust `commands/p2p.rs`（p2p_seed_register/heartbeat/unregister/list，seed_list 走 ws::request
> 请求-响应）+ `commands/update.rs`（update_seed_download_begin/chunk/abort + `SeedDownload` 全局单会话）；
> 前端 `api/seed.ts`（4 个命令封装）+ `api/update.ts`（signature + 3 个 seed 下载命令）+ `seed.ts`（管理器
> start/stop + 30s 心跳）+ `stores/settings.ts`（shareInstaller 开关）+ `SettingsPanel.vue`（开关 UI + trySeedDownload）。
> 收齐判定用 `chunk_received` 纯函数（index+1 >= total，乱序取 max；total 未定时只累计不判定）。
> 打洞/建连/传输全部复用现有 WebRTC 栈（浏览器原生 `RTCPeerConnection` + 服务器 peer:* 信令，见 P2P 架构文档），
> 客户端零新增依赖。

## 一、概述

本文档描述如何为 Electron 应用实现自动更新功能。用户第一次安装时可以选择安装目录，后续更新完全静默自动完成。

**适用场景：**
- Windows 平台
- NSIS 安装包
- 网盘存储更新文件
- Supabase 存储版本信息

---

## 二、安装依赖

```bash
npm install --save-dev electron-builder
npm install --save electron-updater
npm install --save @supabase/supabase-js
npm install --save electron-log
```

---

## 三、配置 package.json

在 `package.json` 中添加以下配置：

```json
{
  "name": "your-app",
  "version": "1.0.0",
  "main": "main.js",
  "build": {
    "appId": "com.yourcompany.yourapp",
    "productName": "你的应用名称",
    "directories": {
      "output": "dist"
    },
    "win": {
      "target": "nsis",
      "icon": "build/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "allowElevation": true,
      "perMachine": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "你的应用名称",
      "uninstallDisplayName": "你的应用名称"
    },
    "publish": [
      {
        "provider": "generic",
        "url": "https://你的网盘更新文件夹地址/"
      }
    ]
  },
  "scripts": {
    "build": "electron-builder",
    "publish": "electron-builder --publish always"
  }
}
```

### 配置说明

| 配置项 | 说明 |
|--------|------|
| `oneClick: false` | 使用向导式安装界面，用户可以点击下一步 |
| `allowToChangeInstallationDirectory: true` | 允许用户修改安装路径 |
| `perMachine: true` | 安装到 Program Files 目录（需要管理员权限） |
| `publish.url` | 存放 latest.yml 和安装包的网盘文件夹地址 |

---

## 四、主进程更新代码

在 `main.js` 中添加以下代码：

```javascript
const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createClient } = require('@supabase/supabase-js');
const log = require('electron-log');

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

const supabase = createClient('你的SUPABASE_URL', '你的SUPABASE_ANON_KEY');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadFile('index.html');
}

async function checkForUpdate() {
  try {
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      log.info('获取版本信息失败');
      return;
    }

    const latestVersion = data[0];
    const currentVersion = app.getVersion();

    log.info('当前版本: ' + currentVersion);
    log.info('最新版本: ' + latestVersion.version);

    if (latestVersion.version !== currentVersion) {
      log.info('发现新版本，开始更新');
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: latestVersion.update_url
      });
      autoUpdater.checkForUpdates();
    } else {
      log.info('当前已是最新版本');
    }
  } catch (err) {
    log.error('检查更新出错: ' + err.message);
  }
}

function setupAutoUpdater() {
  autoUpdater.on('update-available', (info) => {
    log.info('发现新版本: ' + info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-status', '发现新版本，正在下载...');
    }
  });

  autoUpdater.on('update-not-available', () => {
    log.info('当前已是最新版本');
  });

  autoUpdater.on('download-progress', (progressObj) => {
    let percent = progressObj.percent.toFixed(2);
    log.info('下载进度: ' + percent + '%');
    if (mainWindow) {
      mainWindow.webContents.send('update-progress', percent);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('更新下载完成: ' + info.version);
    dialog.showMessageBox({
      type: 'info',
      title: '更新可用',
      message: '新版本 ' + info.version + ' 已下载完成',
      detail: '是否立即重启应用以完成安装？',
      buttons: ['稍后', '立即安装']
    }).then((result) => {
      if (result.response === 1) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    log.error('更新出错: ' + err.message);
  });
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
  checkForUpdate();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

---

## 五、Supabase 数据库表结构

在 Supabase SQL 编辑器中执行：

```sql
CREATE TABLE app_versions (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL,
  download_url TEXT NOT NULL,
  update_url TEXT NOT NULL,
  release_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

每次发布新版本时插入一条记录：

```sql
INSERT INTO app_versions (version, download_url, update_url, release_notes)
VALUES (
  '1.1.0',
  'https://网盘地址/你的应用-Setup-1.1.0.exe',
  'https://网盘地址/更新文件夹/',
  '修复了若干问题'
);
```

---

## 六、打包命令

打包生成安装包：

```bash
npm run build
```

打包完成后，`dist` 目录下会生成三个文件：

```
dist/
├── 你的应用-Setup-1.0.0.exe
├── 你的应用-Setup-1.0.0.exe.blockmap
└── latest.yml
```

---

## 七、发布新版本的步骤

1. 修改 `package.json` 中的 `version` 字段，例如从 `1.0.0` 改为 `1.1.0`
2. 运行打包命令：`npm run build`
3. 将 `dist` 目录下的三个新文件上传到网盘，覆盖旧的 `latest.yml`
4. 在 Supabase 的 `app_versions` 表中插入新版本记录
5. 完成，用户下次打开软件会自动更新

---

## 八、常见问题

### 问题1：更新时弹出安装界面，不是静默的

**原因：** electron-updater 调用的是安装程序，但 NSIS 配置的 `oneClick: false` 不会影响自动更新的静默行为。`quitAndInstall()` 默认传递 `/S` 参数实现静默安装。如果仍然弹出界面，检查是否有其他配置覆盖了默认行为。

### 问题2：第一次安装后找不到 blockmap 文件

**原因：** blockmap 文件是在安装过程中自动生成并保存在用户本地 AppData 目录下的，不需要手动处理。

### 问题3：版本比对不生效

**原因：** 检查 Supabase 中存储的 `version` 字段与 `package.json` 中的 `version` 是否都是字符串格式，确保两者格式一致。

### 问题4：开发环境下 autoUpdater 不工作

**原因：** electron-updater 在开发环境下默认不工作，只会输出日志。需要打包成 exe 后才能测试更新功能。

---

## 九、目录说明

### 用户电脑上的相关目录

| 目录 | 说明 |
|------|------|
| `C:\Users\用户名\AppData\Local\你的应用名\` | 主程序目录 |
| `C:\Users\用户名\AppData\Local\你的应用名-updater\` | 更新缓存目录（存放 blockmap） |

### 服务器/网盘上需要的文件

```
更新文件夹/
├── latest.yml                           # 必须存在
├── 你的应用-Setup-1.0.0.exe              # 当前版本安装包
├── 你的应用-Setup-1.0.0.exe.blockmap     # 当前版本块映射
├── 你的应用-Setup-1.1.0.exe              # 新版本安装包
└── 你的应用-Setup-1.1.0.exe.blockmap     # 新版本块映射
```

> **注意：** 服务器上需要保留所有历史版本的 blockmap 文件，因为用户可能从不同旧版本升级。`latest.yml` 永远指向最新版本。
