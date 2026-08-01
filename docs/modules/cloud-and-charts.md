# 云端认证 + 歌曲热榜下载模块文档

> **状态**：历史模块文档。云端认证已于 v4.3.0 从 Supabase 迁移至自建服务器
> （JWT + WebSocket），当前实现见 `src-tauri/src/modules/server_api.rs` /
> `commands/cloud_auth.rs`，协议见 `server-planning/API-implementation.md`。
> 本文保留 Supabase 时代的方案与踩坑记录作参考。

> 本文档记录 Tauri 番茄钟应用"云端认证（Supabase）"和"歌曲热榜 + 下载"两个模块的实现方案与踩坑历史。
> 两个模块共用同一套 DeepSeek API Key 体系（云端模式从 Supabase 用户表派生、本地模式由用户手动输入），因此合并文档。
> 迁移自 Electron 旧版 `electron/src/modules/cloudAuth.js` + `electron/src/scripts/modules/charts.js` + `electron/main/ipc-cloud.js` + `electron/main/ipc-music.js`。

---

## 1. 模块概述

### 1.1 职责

本模块包含两个互相关联的子模块：

#### 子模块 A：云端认证（Cloud Auth）

- 双模式 API Key 管理：**云端登录**（Supabase 用户系统）↔ **本地配置**（手动输入 DeepSeek API Key），两模式互斥
- 用户注册 / 登录 / 退出 / 会话恢复（基于 Supabase REST API，**不使用** Supabase 客户端 SDK）
- 凭据持久化：用户名 + 密码使用 **AES-256-GCM** 加密落盘，密钥由机器特征（hostname + OS username）派生
- 自动登录：当 `autoLogin=true` 且凭据有效时，启动时自动恢复会话
- 连接测试：测试 Supabase 可达性并返回延迟（ms）
- API Key 模式持久化：`apiMode` 字段写入 `data.json`

#### 子模块 B：歌曲热榜 + 下载（Charts & Download）

- 热歌榜获取：网易云（榜单 ID `3778678`）/ QQ 音乐（topid `27`），均带主备双接口
- 歌曲下载：调用外部 `manual_downloader.exe`（Python 子进程）下载纯音乐版本，串行执行
- 下载模式开关：开启前需用户确认免责声明
- 手动下载：除从榜单点击下载外，支持手动输入"歌曲名 + 歌手"下载
- 下载状态查询：返回是否正在下载、当前歌曲、队列长度

### 1.2 设计要点

- **API Key 仅在 Rust 内存中**：前端只能查询布尔值 / 模式，不能直接读取云端密钥本身。本地模式才允许明文保存到 `data.json`。
- **Supabase 通过 REST API 直接调用**：Rust 端用 `reqwest::Client` + `apikey` / `Authorization: Bearer` 头访问 `/rest/v1/users`，避免引入 Supabase Rust SDK。
- **密码哈希使用 pbkdf2_hmac_sha512**（100_000 次迭代，64 字节输出），与 Node.js 旧版 `crypto.pbkdf2` 兼容。
- **榜单请求由 Rust 后端发起**：`music.163.com` / `y.qq.com` 等域名**不需要**加入前端 CSP（详见第 5 节）。

---

## 2. 架构图

### 2.1 云端认证数据流

```
┌──────────────────────────────────────────────────────────────────────┐
│                        前端 (Vue 3 + Pinia)                          │
│                                                                      │
│  ┌────────────────────┐    ┌─────────────────────────────────────┐  │
│  │ AuthPanel.vue       │    │ stores/auth.ts (Pinia Store)       │  │
│  │ - 登录/注册 Tab      │◄───┤ - state: mode/session/connOk/...   │  │
│  │ - 模式切换拨杆       │    │ - actions: login/register/logout  │  │
│  │ - 本地 API Key 输入  │    │ - init/restoreSession/testConn     │  │
│  └─────────┬──────────┘    └──────────────┬──────────────────────┘  │
│            │                              │                          │
│            ▼                              ▼                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ api/auth.ts                                                    │  │
│  │ - invoke<LoginResult>("cloud_login", {username, password})    │  │
│  │ - invoke<ConnectionTestResult>("cloud_test_connection")      │  │
│  │ - invoke<void>("save_credentials", {username,password,autoLogin})│
│  │ - invoke<boolean>("save_api_key", {apiKey})                  │  │
│  └──────────────────────┬───────────────────────────────────────┘  │
└─────────────────────────┼────────────────────────────────────────────┘
                          │ Tauri invoke (IPC)
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Rust 后端 (Tauri)                             │
│                                                                      │
│  ┌──────────────────────────────────────┐                            │
│  │ commands/cloud_auth.rs                │                            │
│  │ - cloud_login/cloud_register          │                            │
│  │ - cloud_logout/cloud_get_session       │                            │
│  │ - cloud_test_connection                │                            │
│  │ - save_credentials/load_credentials   │                            │
│  │ - get_api_key/save_api_key             │                            │
│  └────────┬──────────────────────────────┘                            │
│           │                                                            │
│           ▼                                                            │
│  ┌──────────────────────────────────────┐    ┌──────────────────────┐│
│  │ modules/cloud_auth.rs                  │    │ state.rs             ││
│  │ - hash_password (pbkdf2)               │    │ AppState {           ││
│  │ - encrypt_string (AES-256-GCM)         │    │   cloud_session:     ││
│  │ - generate_salt / generate_client_id   │    │     Mutex<Option<Sess││
│  │ - 凭据文件读写                          │    │   > }                ││
│  │ - SUPABASE_URL / SUPABASE_ANON_KEY     │    │ }                    ││
│  └────────┬──────────────────────────────┘    └──────────────────────┘│
│           │                                                            │
│           ▼                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │      reqwest::Client  ── HTTPS ──>  Supabase REST API            ││
│  │      Headers: apikey, Authorization: Bearer <ANON_KEY>           ││
│  │      GET  /rest/v1/users?select=...&username=eq.<name>            ││
│  │      POST /rest/v1/users  (Prefer: return=representation)        ││
│  └──────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
              https://sjexeynibnfqxvwehnxk.supabase.co
```

### 2.2 歌曲榜单 / 下载数据流

```
┌──────────────────────────────────────────────────────────────────────┐
│                        前端 (Vue 3)                                  │
│                                                                      │
│  ┌────────────────────┐    ┌─────────────────────────────────────┐  │
│  │ Charts.vue          │    │ DownloadDialog.vue                  │  │
│  │ - 榜单表格          │    │ - 歌曲名/歌手输入框                 │  │
│  │ - 源切换（网易/QQ）  │    │ - 下载状态展示                      │  │
│  │ - 下载模式开关      │    │ - 替代 window.prompt                │  │
│  │ - 免责声明弹窗      │    │                                     │  │
│  │   (替代 window.confirm)│    │                                     │  │
│  └─────────┬──────────┘    └──────────────┬──────────────────────┘  │
│            │                              │                          │
│            ▼                              ▼                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ api/charts.ts                                                   │  │
│  │ - invoke<ChartsResult>("charts_fetch", {source})               │  │
│  │ - invoke<DownloadResult>("download_song", {title, artist})     │  │
│  │ - invoke<DownloadStatusInfo>("get_download_status")            │  │
│  └──────────────────────┬───────────────────────────────────────┘  │
└─────────────────────────┼────────────────────────────────────────────┘
                          │ Tauri invoke (IPC)
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Rust 后端 (Tauri)                             │
│                                                                      │
│  ┌──────────────────────────────────────────────────────┐            │
│  │ commands/charts.rs                                     │            │
│  │ - charts_fetch(source)                                │            │
│  │   ├── fetch_netease_primary  (music.163.com API)      │            │
│  │   ├── fetch_netease_backup   (music.163.com HTML)     │            │
│  │   ├── fetch_qq_primary        (c.y.qq.com)             │            │
│  │   └── fetch_qq_backup         (u.y.qq.com)            │            │
│  │ - download_song(title, artist)                        │            │
│  │   └── execute_download  ──> manual_downloader.exe     │            │
│  │       args: -s "<title> - <artist>" -k <api_key>       │            │
│  │       env: PYTHONIOENCODING=utf-8                     │            │
│  │ - get_download_status                                 │            │
│  └────────┬──────────────────────────────────────────────┘            │
│           │                                                            │
│           ▼                                                            │
│  ┌──────────────────────────┐    ┌──────────────────────────────────┐│
│  │ state.rs                  │    │ 外部进程                        ││
│  │ ChartsState {             │    │ - music.163.com / y.qq.com      ││
│  │   inner: Mutex<ChartsInner>│   │ - manual_downloader.exe         ││
│  │ }                         │    │   (Python + ffmpeg + you-get)    ││
│  └──────────────────────────┘    └──────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

退出码契约（`manual_downloader.exe`）：

| 退出码 | status 字符串 | success | 含义 |
|--------|---------------|---------|------|
| 0 | `downloaded` | true | 下载成功 |
| 2 | `exists` | true | 文件已存在，跳过下载 |
| 3 | `no_video` | false | 未找到相关视频 |
| 4 | `no_instrumental` | false | 未找到符合条件的纯音乐视频 |
| 其他 | `failed` | false | 通用失败 |

---

## 3. 关键代码位置索引

### 3.1 前端

| 文件 | 作用 | 关键行 |
|------|------|--------|
| `src/components/AuthPanel.vue` | 登录/注册/本地配置 UI | 模式切换拨杆 194-213；登录表单 259-289；本地 Key 输入 326-354 |
| `src/components/Charts.vue` | 音乐榜单弹窗 | 源切换 193-209；下载模式 219-226；免责声明 282-312；下载弹窗挂载 314-321 |
| `src/components/DownloadDialog.vue` | 自定义下载弹窗 | 输入框 152-176；状态展示 179-181；下载逻辑 76-110 |
| `src/stores/auth.ts` | 认证 Store | `init` 73-87；`login` 205-232；`switchMode` 171-196；`tryAutoLogin` 134-150 |
| `src/api/auth.ts` | 认证 API 封装 + 类型定义 | `LoginResult` 41-46；`ConnectionTestResult` 56-63；invoke 调用 71-177 |
| `src/api/charts.ts` | 榜单 API 封装 + 类型定义 | `DownloadStatus` 33；`chartsFetch` 50-52；`downloadSong` 55-57 |

### 3.2 后端

| 文件 | 作用 | 关键行 |
|------|------|--------|
| `src-tauri/src/commands/cloud_auth.rs` | 认证 Tauri 命令 | `cloud_login` 87-155；`cloud_test_connection` 232-257；`supabase_client` 72-84 |
| `src-tauri/src/modules/cloud_auth.rs` | Supabase 集成 + 凭据加密 | `SUPABASE_URL` 20；`hash_password` 100-105；`encrypt_string` 64-80；`derive_machine_key` 46-61 |
| `src-tauri/src/commands/charts.rs` | 榜单/下载 Tauri 命令 | `charts_fetch` 338-360；`download_song` 367-426；`execute_download` 458-504；退出码映射 496-502 |
| `src-tauri/src/state.rs` | 全局状态 | `AppState.cloud_session` 81；`ChartsInner` 45-56（含 `api_key` 字段） |
| `src-tauri/src/lib.rs` | 命令注册 | `invoke_handler` 15-82；认证命令 33-45；charts 命令 78-81 |
| `src-tauri/tauri.conf.json` | CSP 配置 | `csp` 第 43 行 |

---

## 4. 踩坑记录（最重要）

### 4.1 Supabase 连接失败

#### 4.1.1 根因 1：CSP 配置未允许 supabase.co 域名

- **现象**：前端 `cloud_test_connection` 调用返回失败，浏览器 DevTools Console 报 CSP 违规：`Refused to connect to 'https://sjexeynibnfqxvwehnxk.supabase.co/...' because it violates the following Content Security Policy directive: "connect-src 'self' ..."`
- **根因**：`tauri.conf.json` 的 `app.security.csp.connect-src` 默认只允许 `'self'`，没有列出 Supabase 域名。Tauri WebView 的所有外发请求受 CSP 约束。
- **错误尝试**：
  - 一度怀疑是网络代理问题，关闭代理后仍失败
  - 一度怀疑是 Supabase 项目未启用，直接用 `curl` 测试可达，证明 Supabase 端正常
- **正确方案**：在 `tauri.conf.json` 的 `csp.connect-src` 中追加 `https://sjexeynibnfqxvwehnxk.supabase.co`：

  ```jsonc
  // src-tauri/tauri.conf.json:43
  "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://sjexeynibnfqxvwehnxk.supabase.co https://api.deepseek.com"
  ```

  注意：当前 CSP 中**故意没有**包含 `music.163.com` / `y.qq.com` 等榜单域名，因为榜单请求由 Rust 后端发起（`reqwest::Client`），不经过前端 WebView 的 CSP 限制。详见第 5 节。

#### 4.1.2 根因 2：Rust 后端返回类型与前端期望不匹配

- **现象**：登录调用成功，但前端 `auth.session` 始终为 `null`；连接测试调用返回 `result.ok` 为 `undefined`，前端 `connectionOk` 始终为 `false`。
- **根因**：
  1. **登录返回字段不匹配**：早期 Rust 后端返回的是 `{ success, session, error }`（用 `session` 字段），但前端 `LoginResult` 期望的是 `{ success, user, error }`（用 `user` 字段）。前端代码 `if (result.success && result.user)` 永远为 false，导致登录后 session 不更新。
  2. **连接测试返回类型不匹配**：早期 Rust 后端直接返回 `Result<bool, String>`（即 `true` / `false`），但前端期望的是 `ConnectionTestResult` 对象 `{ ok, latency, error }`。前端 `result.ok` 为 `undefined`，被当作 falsy。
- **错误尝试**：
  - 在前端 `try/catch` 包裹 `result.ok`，把 undefined 当 false 处理 → 表面"不报错"但状态显示"连接失败"
  - 一度怀疑是 Tauri IPC 序列化问题，去查 `serde` 标注，浪费时间
- **正确方案**：在 `commands/cloud_auth.rs` 中定义与前端类型一一对应的 Rust 结构体，字段名严格对齐：

  ```rust
  // commands/cloud_auth.rs:49-69
  #[derive(Debug, Serialize)]
  pub struct LoginResult {
      pub success: bool,
      pub user: Option<cloud_auth::Session>,   // 字段名 user（不是 session）
      pub error: Option<String>,
  }

  #[derive(Debug, Serialize)]
  pub struct ConnectionTestResult {
      pub ok: bool,                             // 对象，不是裸 bool
      pub latency: Option<u64>,
      pub error: Option<String>,
  }
  ```

  并且 `cloud_login` 函数最后构造返回值时使用 `user: Some(session)` 而不是 `session: Some(...)`（见 `cloud_auth.rs:150-154`）。

  > **教训**：跨语言类型契约必须文档化，且字段名严格对齐。建议在 Rust 结构体上方注释中标注"与前端 src/api/auth.ts 的 XxxResult 对齐"，便于后续维护。

#### 4.1.3 修复验证

修复后的状态：

- `tauri.conf.json:43` 已包含 `https://sjexeynibnfqxvwehnxk.supabase.co`
- `commands/cloud_auth.rs` 的 `LoginResult` / `RegisterResult` / `ConnectionTestResult` 字段与 `src/api/auth.ts` 完全对齐
- `cloud_login` 返回 `user: Some(session)` 字段
- `cloud_test_connection` 返回 `ConnectionTestResult { ok, latency, error }`

---

### 4.2 命令未注册：charts_fetch / download_song / get_download_status

- **现象**：前端调用 `invoke("charts_fetch", ...)` 直接抛出错误：`command charts_fetch not found`。DevTools Network 没有 Supabase 请求，说明请求根本没到 Rust。
- **根因**：`src-tauri/src/lib.rs` 的 `invoke_handler` 宏里只注册了认证命令，没有注册 charts 相关的三个命令。Rust 编译能通过（因为函数本身已经 `#[tauri::command]` 标注），但运行时 Tauri 找不到这个命令。
- **错误尝试**：
  - 一度以为是前端 invoke 命令名拼错，反复对照 `charts_fetch` 与 `chartsFetch` 的 snake/camel 转换（其实 Tauri 自动转换，前端用 camelCase 即可）
  - 加了 `console.log` 看错误信息，才确认是 "command not found"
- **正确方案**：在 `lib.rs:78-81` 的 `invoke_handler!` 宏中追加：

  ```rust
  // src-tauri/src/lib.rs:78-81
  // 音乐榜单 / 下载
  commands::charts::charts_fetch,
  commands::charts::download_song,
  commands::charts::get_download_status,
  ```

  > **教训**：新增任何 `#[tauri::command]` 函数后，**必须**在 `lib.rs` 的 `invoke_handler!` 宏里注册。详见第 6 节 Checklist。

#### 4.2.1 附带问题：`src/api/auth.ts` 顶部注释陈旧

- **现象**：`src/api/auth.ts` 第 12 行注释写着 *"注意：当前 src-tauri/src/lib.rs 暂未注册这些命令，调用会失败。等后端 commands 注册后即可直接使用。"*
- **根因**：注释写于早期阶段，命令早已在 `lib.rs:33-45` 注册完成，注释未同步更新。
- **影响**：误导后来者以为命令未注册，浪费时间排查。
- **建议**：删除该注释，或改为"已在 `lib.rs:33-45` 注册"。

---

### 4.3 DownloadStatus 类型不匹配：前端 "success" vs Rust "downloaded"

- **现象**：下载成功后，前端 toast 显示的是 `❌ 下载失败`（默认错误分支），而不是 `✅ 下载成功`。
- **根因**：
  - 前端 `DownloadStatus` 类型早期定义为 `"success" | "exists" | "failed"`（用 `success` 表示下载成功）
  - Rust 后端 `charts.rs::execute_download` 在退出码 0 时返回 `status: "downloaded"`（用 `downloaded` 而非 `success`）
  - 前端 `handleDownload` 中的判断逻辑是 `if (result.status === "exists") ... else ...`，进入 else 分支但 status 既不是 `no_video` 也不是 `no_instrumental`，最终走到默认错误分支
- **错误尝试**：
  - 一度尝试修改 Rust 把 `"downloaded"` 改回 `"success"`，但发现 `exists` 也是成功状态，单一 `success` 不足以表达"已存在"语义
  - 一度在前端做 `status === "downloaded" || status === "success"` 的兼容判断，丑陋
- **正确方案**：统一类型契约，前端 `DownloadStatus` 与 Rust 退出码映射严格对齐：

  ```ts
  // src/api/charts.ts:33
  export type DownloadStatus =
    | "downloaded"      // 退出码 0
    | "exists"          // 退出码 2
    | "no_video"       // 退出码 3
    | "no_instrumental" // 退出码 4
    | "failed";        // 其他
  ```

  Rust 端映射（`charts.rs:496-502`）：

  ```rust
  let result = match code {
      0 => json!({ "success": true,  "status": "downloaded" }),
      2 => json!({ "success": true,  "status": "exists" }),
      3 => json!({ "success": false, "status": "no_video",        "error": "未找到相关视频" }),
      4 => json!({ "success": false, "status": "no_instrumental", "error": "未找到符合条件的纯音乐视频" }),
      _ => json!({ "success": false, "status": "failed",          "error": "下载失败" }),
  };
  ```

  前端判断（`Charts.vue:88-101`）：

  ```ts
  if (result.status === "exists") {
    showToast(`ℹ️ "${title}" 已存在，无需下载`, "info");
  } else {
    showToast(`✅ "${title}" 下载成功`, "success");
  }
  ```

  > **教训**：退出码 → 字符串的映射要在前后端两侧各写一份，且字段值必须用同一套字符串。建议在 Rust 代码注释中显式标注每个 status 对应的退出码（已标注，见 `charts.rs:495`）。

---

### 4.4 原生弹窗问题：window.confirm / window.prompt 显示系统弹窗

- **现象**：开启下载模式时，弹出一个**操作系统原生**的确认框（Windows 上的 MessageBox 样式），与应用的暗色 UI 完全不协调；手动下载歌曲时，弹出原生 prompt 框，输入框样式无法定制。
- **根因**：早期迁移时直接复用了 Electron 旧版的 `window.confirm()` / `window.prompt()`。在浏览器里这两个 API 是同步阻塞的，但 Tauri WebView 在 Windows 上调起的是系统原生 MessageBox，样式与 Web UI 完全脱节，且 `window.prompt` 在某些 WebView 版本下行为不稳定。
- **错误尝试**：
  - 尝试用 `window.confirm` 包裹 Promise，强行异步化 → 不可行，原生 confirm 本身就是阻塞的
  - 尝试给 `window.confirm` 加 CSS → 不可能，原生弹窗不接受 CSS
- **正确方案**：用 Vue 自定义组件替代：

  1. **替代 `window.confirm`**：在 `Charts.vue:282-312` 新增免责声明弹窗 `<div class="charts-disclaimer">`，通过 `showDisclaimer` ref 控制显示，按钮触发 `confirmDisclaimer()` / `cancelDisclaimer()`。

     ```ts
     // Charts.vue:110-128
     function handleToggleDownloadMode() {
       if (!downloadMode.value) {
         showDisclaimer.value = true;   // 弹自定义弹窗，不调 window.confirm
         return;
       }
       downloadMode.value = false;
     }
     ```

  2. **替代 `window.prompt`**：新建 `src/components/DownloadDialog.vue`，提供歌曲名/歌手双输入框 + 下载按钮 + 状态展示。`Charts.vue:314-321` 挂载该组件，通过 `showDownloadDialog` ref 控制。

  3. **z-index 层级**：免责声明弹窗 z-index 3100，高于 Charts 弹窗 1000；下载弹窗也 3100。避免被 Charts 弹窗遮挡（见 `Charts.vue:561` 和 `DownloadDialog.vue:213` 注释）。

  > **教训**：Tauri 应用中**永远不要**使用 `window.confirm` / `window.alert` / `window.prompt`。全部用 Vue 组件实现。Modal 系统参见 `docs/MODAL_SYSTEM.md`。

---

### 4.5 下载模式无法输入歌曲名：原实现只能从榜单选择

- **现象**：用户打开"下载模式"后，只能从榜单点击下载按钮，无法手动输入"我想下载的歌名"。榜单里没有的歌完全没法下。
- **根因**：Electron 旧版 `charts.js` 的下载模式只支持"点榜单按钮 → 调 download-song"，没有"手动输入歌名"的入口。迁移时直接复刻了旧逻辑。
- **错误尝试**：
  - 一度在榜单表格上方加一个 `<input>` 直接调 `downloadSong`，但没有免责声明复用、没有状态展示，体验割裂
- **正确方案**：
  1. 在 `Charts.vue` 工具栏新增"📥 手动下载"按钮（`Charts.vue:228-234`），仅在 `downloadMode=true` 时显示
  2. 点击后调用 `openManualDownload()`，清空预填字段，打开 `DownloadDialog`
  3. 同时支持从榜单点击下载按钮 → `openSongDownload(title, artist)` 预填字段 → 打开 `DownloadDialog`，用户可在弹窗内再编辑
  4. `DownloadDialog` 通过 `@downloaded` 事件把结果回传给 `Charts.vue`，由后者统一展示 toast

  ```ts
  // Charts.vue:130-142
  function openManualDownload() {
    downloadDialogTitle.value = "";
    downloadDialogArtist.value = "";
    showDownloadDialog.value = true;
  }

  function openSongDownload(title: string, artist: string) {
    downloadDialogTitle.value = title;
    downloadDialogArtist.value = artist;
    showDownloadDialog.value = true;
  }
  ```

  > **教训**：UI 设计要考虑"主路径 + 兜底路径"。榜单点击是主路径，手动输入是兜底路径，二者应共用同一个下载组件。

---

### 4.6 ChartsInner.api_key 永远为 None（本地模式已修复，云端链路见 4.7）

- **现象**：用户登录或配置本地 API Key 后，点击下载按钮，**永远**返回错误"请先登录或配置 DeepSeek API Key"。
- **根因**：
  - `state.rs:45-56` 中 `ChartsInner` 有 `api_key: Option<String>` 字段，初始化为 `None`
  - `charts.rs::download_song` 第 392-403 行检查 `charts_state.inner.lock().await.api_key`，若为 `None` 或空串直接返回错误
  - 但 `commands/cloud_auth.rs::save_api_key`（第 273-278 行）**只把 apiKey 写入 `data.json`**，**没有同步更新 `ChartsState.inner.api_key`**：

    ```rust
    // commands/cloud_auth.rs:272-278
    pub async fn save_api_key(app: AppHandle, api_key: String) -> Result<bool, String> {
        let mut data = data_manager::read_data(&app)?;
        data["apiKey"] = Value::String(api_key);
        data_manager::write_data(&app, &data)?;
        Ok(true)
        // ❌ 缺一步：app.state::<ChartsState>().inner.lock().await.api_key = Some(api_key);
    }
    ```

  - 同样，`cloud_login` 成功后也**没有**把派生的 API Key 写入 `ChartsState`（按设计云端模式的 API Key 来自后端，不应在前端暴露，但下载器需要明文 API Key 才能调用 DeepSeek）
- **错误尝试**：
  - 一度怀疑是 `manual_downloader.exe` 路径问题，反复检查 `get_downloader_path` 的 debug/release 分支
  - 一度以为是 mutex 死锁，把锁拆细
- **正确方案（已实施，本地模式）**：
  1. **新增 Tauri 命令 `charts_set_api_key(api_key: String)`**（`commands/charts.rs:476-484`，已在 `lib.rs` 注册），前端在 `save_api_key` 成功后调用，把 API Key 注入 `ChartsState.inner.api_key`。

     ```rust
     // commands/charts.rs:476-484
     #[tauri::command]
     pub async fn charts_set_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
         let charts_state = app.state::<ChartsState>();
         let mut guard = charts_state.inner.lock().await;
         guard.api_key = if api_key.is_empty() { None } else { Some(api_key) };
         Ok(())
     }
     ```

  2. `commands/cloud_auth.rs::save_api_key` 已改为直接同步 `ChartsState.inner.api_key`（写入 `data.json` 后同步内存）。
  3. 前端 `stores/auth.ts::saveLocalApiKey` 成功后调用 `chartsSetApiKey(key)`（`auth.ts:264-266`）。

  4. **云端模式修复见 4.7**（登录后从服务器拉取注入，本轮新增）。

- **临时绕过**：已无。本地模式配置 Key 后下载即可用；云端模式见 4.7。

> **教训**：当一个状态有"持久化存储"和"内存缓存"两份时，写入路径必须同步更新两份，否则内存缓存永远是初值。

---

### 4.7 全新电脑云端登录后仍报"无 DeepSeek API Key"（已修复）

- **现象**：全新电脑安装番茄钟 → 云端登录（admin 账号）→ 下载歌曲仍报"请先登录或配置 DeepSeek API Key"。UI 上已登录（`hasApiKey` 云端模式只看 session 存在），但实际下载器拿不到 Key。
- **根因**（三处叠加，迁移自建服务器时整条云端 Key 链路丢失）：
  1. **服务器无 DeepSeek Key 存储**：旧版从 Supabase `api_keys` 表拉取 `name='deepseek'` 的 Key；自建服务器（Python+PostgreSQL）没有 `api_keys` 表，也没有下发接口。
  2. **客户端未解析 `admin` 字段**：`commands/cloud_auth.rs::ApiUser` 结构体缺少 `admin` 字段，`api_user_to_session` 硬编码 `admin: false`（服务器登录响应其实已返回 `admin`），导致前端 `AuthPanel` 也不显示 Admin 标识。
  3. **客户端登录后无注入逻辑**：`cloud_login` / `cloud_get_session` 成功后从未把 Key 注入 `ChartsState`；`ai.rs::resolve_api_key` 注释宣称"云端登录 admin 拉取"但代码从未实现。
- **正确方案（已实施）**：
  1. **服务器端**：新增 `api_keys` 表 + `GET/PUT /api/v1/config/deepseek-key`（仅 admin），Key 从旧 Supabase `api_keys` 表迁移一行（`name='deepseek'`）。详见 `server-planning/API-implementation.md`。
  2. **客户端（`commands/cloud_auth.rs`）**：
     - `ApiUser` 增加 `admin` 字段（`#[serde(default)]`），`api_user_to_session` 使用真实值
     - 新增 `sync_deepseek_key(state, app)`：admin 用户登录/恢复会话成功后调用 `GET /api/v1/config/deepseek-key`，把返回的 Key 注入 `ChartsState.inner.api_key`（非 admin 或接口失败静默跳过）
     - 调用时机：`perform_login` 成功后、`cloud_get_session` 三个分支（内存会话存在 / 自动登录成功 / 自动登录由 perform_login 内部同步）
- **验证**：服务器端已端到端验证（未登录 401 / 普通用户 403 / admin 200+key）；客户端链路需 `npm run tauri dev` 登录 admin 账号后实测下载。
- **遗留**：非 admin 用户云端登录仍无 Key（与旧版设计一致，仅 admin 可拿 Key）。若未来要开放给普通用户，需服务器部门评估权限模型。

---

## 5. CSP 配置清单

### 5.1 当前 CSP（`tauri.conf.json:43`）

```
default-src 'self';
style-src 'self' 'unsafe-inline';
script-src 'self';
img-src 'self' data:;
font-src 'self' data:;
connect-src 'self' https://sjexeynibnfqxvwehnxk.supabase.co https://api.deepseek.com
```

### 5.2 `connect-src` 允许的域名清单

| 域名 | 用途 | 必要性 |
|------|------|--------|
| `'self'` | Tauri WebView 内部资源（devUrl `http://localhost:5173` / 打包后 `tauri://localhost`） | 必须 |
| `https://sjexeynibnfqxvwehnxk.supabase.co` | Supabase REST API（登录、注册、连接测试） | 必须 |
| `https://api.deepseek.com` | DeepSeek AI API（前端直接调用） | 必须 |

### 5.3 故意未加入 CSP 的域名（重要）

| 域名 | 用途 | 不加入 CSP 的原因 |
|------|------|-------------------|
| `https://music.163.com` | 网易云热歌榜 | 由 **Rust 后端** `reqwest::Client` 发起，不经过前端 WebView，**不受 CSP 约束** |
| `https://c.y.qq.com` / `https://u.y.qq.com` | QQ 音乐热歌榜 | 同上 |
| `https://platform.deepseek.com` | 仅 `AuthPanel.vue:330` 的 `<a target="_blank">` 链接 | `default-src 'self'` 不约束 `<a>` 跳转，且是外部浏览器打开 |

> **常见误判**：看到榜单请求失败，第一反应是"CSP 没加 music.163.com"。**实际上榜单请求在 Rust 端发起，CSP 完全不管**。如果榜单请求失败，应该检查 Rust 端日志（`eprintln!` 输出），而非 CSP。

### 5.4 CSP 修改注意事项

- 修改 `tauri.conf.json` 后**必须重启 `npm run tauri dev`**（不是 Vite HMR），CSP 才会生效。
- `dangerousDisableAssetCspModification: false`（当前值）表示 Tauri 不会自动放宽 CSP，所有外发请求必须显式列出。
- 生产构建（`npm run tauri build`）会使用同一份 CSP，无需额外配置。

---

## 6. 命令注册 Checklist

新增任何 `#[tauri::command]` 函数后，**必须**完成以下步骤：

- [ ] **步骤 1**：在 `commands/xxx.rs` 中定义函数，并加 `#[tauri::command]` 宏
- [ ] **步骤 2**：在 `commands/mod.rs` 中 `pub mod xxx;`（已有则跳过）
- [ ] **步骤 3**：在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]` 宏中追加 `commands::xxx::function_name,`
- [ ] **步骤 4**：在 `src/api/xxx.ts` 中写 `invoke<T>("function_name", { args })` 封装
- [ ] **步骤 5**：在 `src/stores/xxx.ts` 中调用封装好的 API（如有需要）
- [ ] **步骤 6**：在前端组件中调用 Store action 或 API
- [ ] **步骤 7**：删除 `src/api/xxx.ts` 顶部任何"暂未注册"的旧注释
- [ ] **步骤 8**：测试命令实际可调用（DevTools Network 应看到 IPC 调用，而非 "command not found"）

### 当前已注册命令清单（`lib.rs:15-82`）

| 模块 | 命令 |
|------|------|
| 计时器 | `get_timer_state` |
| 数据 | `read_data` / `write_data` / `read_settings` / `write_settings` |
| 窗口 | `close_window` / `minimize_window` / `set_always_on_top` / `bring_to_front` / `cancel_always_on_top` / `show_garden_window` / `hide_garden_window` / `enter_mini_mode` / `exit_mini_mode` |
| **云端认证** | `save_credentials` / `load_credentials` / `clear_credentials` / `cloud_login` / `cloud_register` / `cloud_logout` / `cloud_get_session` / `cloud_test_connection` / `get_api_key` / `save_api_key` / `get_api_mode` / `set_api_mode` |
| 菜园子 | `garden_read` / `garden_write` / `garden_plant` / `garden_harvest` / `garden_buy` / `garden_sell` / `garden_unlock` / `garden_signin` |
| 前台检测 | `foreground_start` / `foreground_stop` / `foreground_get_status` / `foreground_set_api_key` / `foreground_is_ready` |
| 音乐播放器 | `music_toggle_play` / `music_next` / `music_prev` / `music_seek` / `music_set_volume` / `music_set_play_mode` / `music_get_status` / `music_get_playlist` / `music_get_devices` / `music_set_device` / `music_play_song` / `music_delete_song` / `music_get_custom_tags` / `music_add_custom_tag` / `music_delete_custom_tag` / `music_update_tag` |
| **音乐榜单 / 下载** | `charts_fetch` / `download_song` / `get_download_status` |

### 待新增命令（修复 4.6 Bug）

- `charts_set_api_key`：注入 API Key 到 `ChartsState.inner.api_key`，在登录 / 保存本地 Key 成功后由前端调用

---

## 7. 前后端接口契约

> **命名约定**：Tauri 命令参数在 Rust 端用 `snake_case`，前端 `invoke` 时用 `camelCase`，Tauri 会自动转换（如 `auto_login` ↔ `autoLogin`，`api_key` ↔ `apiKey`）。

### 7.1 云端认证命令

#### `cloud_login`

```rust
// commands/cloud_auth.rs:87
pub async fn cloud_login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<LoginResult, String>
```

| 方向 | 类型 |
|------|------|
| 前端调用 | `invoke<LoginResult>("cloud_login", { username, password })` |
| 返回 `LoginResult.success` | `boolean` |
| 返回 `LoginResult.user` | `Session \| null`（成功时非空） |
| 返回 `LoginResult.error` | `string \| null`（失败时非空，如"用户名不存在"、"密码错误"） |

`Session` 结构（与前端 `auth.ts:23-27` 对齐）：

```ts
interface Session {
  id: number;       // i64
  username: string;
  admin: boolean;
}
```

#### `cloud_register`

```rust
// commands/cloud_auth.rs:159
pub async fn cloud_register(
    username: String,
    password: String,
) -> Result<RegisterResult, String>
```

| 返回字段 | 类型 | 说明 |
|----------|------|------|
| `success` | `boolean` | |
| `error` | `string \| null` | 如"用户名至少需要2个字符"、"用户名已存在" |

校验规则：用户名 ≥ 2 字符，密码 ≥ 6 字符。用户名冲突由 Supabase 返回 PostgreSQL 错误码 `23505`（unique_violation）识别。

#### `cloud_logout`

```rust
// commands/cloud_auth.rs:218
pub async fn cloud_logout(state: State<'_, AppState>) -> Result<(), String>
```

无参数，无返回值。仅清空 `AppState.cloud_session`，不调用 Supabase。

#### `cloud_get_session`

```rust
// commands/cloud_auth.rs:226
pub async fn cloud_get_session(state: State<'_, AppState>) -> Result<Option<Session>, String>
```

返回 `Session | null`。未登录返回 `null`。

#### `cloud_test_connection`

```rust
// commands/cloud_auth.rs:233
pub async fn cloud_test_connection() -> Result<ConnectionTestResult, String>
```

```ts
interface ConnectionTestResult {
  ok: boolean;
  latency?: number;   // ms
  error?: string;
}
```

测试方式：`GET {SUPABASE_URL}/rest/v1/users?select=id&limit=1`，记录耗时。

#### `save_credentials`

```rust
// commands/cloud_auth.rs:17
pub async fn save_credentials(
    app: AppHandle,
    username: String,
    password: String,
    auto_login: bool,   // 注意：前端 invoke 时用 autoLogin
) -> Result<(), String>
```

密码使用 AES-256-GCM 加密后落盘到 `app_data_dir/PomoSolo/credentials.json`。加密密钥由 `hostname + OS username + "PomoSolo-v4-credential-key"` 派生（`derive_machine_key`，见 `modules/cloud_auth.rs:46-61`）。

#### `load_credentials`

```rust
// commands/cloud_auth.rs:27
pub async fn load_credentials(app: AppHandle) -> Result<Option<Credentials>, String>
```

返回 `Credentials | null`：

```ts
interface Credentials {
  username: string;
  passwordEncrypted?: string;  // base64
  clientId?: string;
  autoLogin?: boolean;
}
```

> 注意：前端拿到的 `passwordEncrypted` 仍是加密态，前端无法解密。自动登录的明文密码由 Rust 端在 `cloud_get_session` 内部解密使用（当前未实现，详见 `stores/auth.ts:126-133` 注释）。

#### `clear_credentials`

```rust
// commands/cloud_auth.rs:32
pub async fn clear_credentials(app: AppHandle) -> Result<(), String>
```

删除凭据文件。

#### `get_api_key`

```rust
// commands/cloud_auth.rs:263
pub async fn get_api_key(app: AppHandle) -> Result<Option<String>, String>
```

从 `data.json` 的 `apiKey` 字段读取。本地模式才有效。

#### `save_api_key`

```rust
// commands/cloud_auth.rs:273
pub async fn save_api_key(app: AppHandle, api_key: String) -> Result<bool, String>
```

写入 `data.json` 的 `apiKey` 字段。返回 `true`。

> **⚠️ 已知 Bug**：此函数不同步更新 `ChartsState.inner.api_key`，导致下载功能失效。详见 4.6。

#### `get_api_mode` / `set_api_mode`

```rust
pub async fn get_api_mode(app: AppHandle) -> Result<String, String>      // 返回 "cloud" | "local"
pub async fn set_api_mode(app: AppHandle, mode: String) -> Result<bool, String>
```

默认值 `"cloud"`。持久化到 `data.json` 的 `apiMode` 字段。

### 7.2 音乐榜单 / 下载命令

#### `charts_fetch`

```rust
// commands/charts.rs:339
pub async fn charts_fetch(app: AppHandle, source: String) -> Result<Value, String>
```

| 参数 | 取值 |
|------|------|
| `source` | `"netease"` \| `"qq"` |

返回 `ChartsResult`：

```ts
interface ChartsResult {
  success: boolean;
  songs?: ChartSong[];   // 成功时返回，最多 10 首
  error?: string;
}

interface ChartSong {
  rank: number;
  title: string;
  artist: string;
  album: string;
}
```

数据源：
- 网易云主接口：`GET https://music.163.com/api/playlist/detail?id=3778678`
- 网易云备用接口：`GET https://music.163.com/discover/toplist?id=3778678`（解析 HTML 中的 `song-list-pre-data`）
- QQ 主接口：`GET https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=27&...`
- QQ 备用接口：`GET https://u.y.qq.com/cgi-bin/musicu.fcg?data=...`

主接口失败自动回退备用接口，备用接口失败返回空数组（前端展示"获取榜单失败"）。

#### `download_song`

```rust
// commands/charts.rs:367
pub async fn download_song(
    app: AppHandle,
    title: String,
    artist: String,
) -> Result<Value, String>
```

返回 `DownloadResult`：

```ts
interface DownloadResult {
  success: boolean;
  status?: DownloadStatus;
  error?: string;
}

type DownloadStatus =
  | "downloaded"       // 退出码 0
  | "exists"           // 退出码 2
  | "no_video"         // 退出码 3
  | "no_instrumental"  // 退出码 4
  | "failed";          // 其他
```

执行流程：
1. 检查 `ChartsState.inner.downloader_path`，未设置则调用 `get_downloader_path` 定位
2. 检查 `ChartsState.inner.api_key`，为空则返回错误"请先登录或配置 DeepSeek API Key"
3. 设置 `is_downloading=true`、`current_song`
4. 调用 `manual_downloader.exe -s "<title> - <artist>" -k <api_key>`，env `PYTHONIOENCODING=utf-8`
5. 根据退出码映射 `DownloadResult`
6. 清除 `is_downloading`、`current_song`

下载器路径定位（`get_downloader_path`）：
- Debug 模式：`{CARGO_MANIFEST_DIR}/../music-player/manual_downloader.exe`
- Release 模式：`{resource_dir}/manual_downloader.exe`

#### `get_download_status`

```rust
// commands/charts.rs:432
pub async fn get_download_status(app: AppHandle) -> Result<Value, String>
```

返回 `DownloadStatusInfo`：

```ts
interface DownloadStatusInfo {
  isDownloading: boolean;
  currentSong?: { title: string; artist: string };
  queueLength: number;   // 当前固定为 0，未实现队列
}
```

---

## 8. 常见问题排查

### 8.1 登录失败：连接 Supabase 超时

1. 检查 `tauri.conf.json:43` 的 CSP 是否包含 `https://sjexeynibnfqxvwehnxk.supabase.co`
2. 检查网络代理，必要时关闭代理或加白名单
3. 查看 DevTools Network 面板，确认请求是否实际发出
4. 查看 Rust 终端是否有 `eprintln!` 输出
5. 直接用 `curl` 测试 Supabase 可达性：`curl -H "apikey: sb_publishable_..." https://sjexeynibnfqxvwehnxk.supabase.co/rest/v1/users?select=id&limit=1`

### 8.2 调用命令报 "command xxx not found"

1. 确认 `commands/xxx.rs` 中函数有 `#[tauri::command]` 宏
2. **确认 `lib.rs` 的 `invoke_handler!` 宏中已注册该命令**（最常遗漏）
3. 重启 `npm run tauri dev`（命令注册在编译期，HMR 不生效）
4. 检查前端 `invoke("command_name", ...)` 的命令名是否为 `snake_case`（如 `charts_fetch` 而非 `chartsFetch`）

### 8.3 下载永远返回"请先登录或配置 DeepSeek API Key"

这是 4.6 节描述的已知 Bug，`ChartsState.inner.api_key` 永远为 `None`。需按 4.6 方案修复。

### 8.4 榜单请求失败但 Rust 端无报错

1. 检查网络是否能访问 `https://music.163.com/api/playlist/detail?id=3778678`
2. 网易云接口偶尔返回 HTML 反爬页面，备用接口会尝试解析 `song-list-pre-data`
3. QQ 音乐备用接口的 `period` 参数（如 `2026-03-30`）可能过期，需更新为当天日期
4. Rust 端 `fetch_text` 超时设为 10 秒，网络慢时可能超时

### 8.5 下载成功但 toast 显示"下载失败"

这是 4.3 节描述的 `DownloadStatus` 类型不匹配问题。已修复，确保前端 `DownloadStatus` 字符串与 Rust 退出码映射完全对齐。若再次出现，检查：

- 前端 `charts.ts:33` 的 `DownloadStatus` 类型定义
- Rust `charts.rs:496-502` 的退出码 → status 字符串映射
- 两侧字符串是否完全一致（区分大小写）

### 8.6 凭据解密失败（跨机器拷贝 credentials.json）

凭据加密密钥由 `hostname + OS username` 派生，**跨机器无法解密**。换机器或换用户登录后，旧凭据文件会解密失败。解决：调用 `clear_credentials` 删除旧文件，重新登录。

### 8.7 自动登录失败

当前实现下，`tryAutoLogin`（`stores/auth.ts:134-150`）只检查凭据存在性，实际明文密码解密由 Rust 端 `cloud_get_session` 处理，但**后端尚未实现自动登录逻辑**（详见 `stores/auth.ts:126-133` 注释）。临时方案：每次启动需要手动登录。彻底方案：在 `cloud_get_session` 内部检查凭据文件，若 `auto_login=true` 且密码验证通过，自动重建 `cloud_session`。

### 8.8 注册返回"用户名已存在"但实际是新用户

Supabase 通过 PostgreSQL 错误码 `23505`（unique_violation）识别。若 Supabase 端 `users.username` 未设置 unique 约束，重复用户名会被静默插入，不会触发 `23505`。检查 Supabase 控制台 `users` 表的 `username` 列是否有 unique 约束。

### 8.9 `cloud_login` 返回 `result.user` 为 `null` 但 `success` 为 `true`

不会发生。当前实现下 `success=true` 必然伴随 `user=Some(session)`。若出现此现象，检查 Rust 端 `LoginResult` 构造逻辑（`cloud_auth.rs:150-154`）。

---

## 附录：相关文件清单

### 前端

- `src/components/AuthPanel.vue`
- `src/components/Charts.vue`
- `src/components/DownloadDialog.vue`
- `src/stores/auth.ts`
- `src/api/auth.ts`
- `src/api/charts.ts`

> **注**：`src/stores/charts.ts` **不存在**。Charts.vue 直接调用 `src/api/charts.ts` 的 `chartsFetch` / `downloadSong`，没有 Pinia Store 中间层。如需添加（如缓存榜单数据、跨组件共享下载状态），可参考 `stores/music.ts` 的结构。

### 后端

- `src-tauri/src/commands/cloud_auth.rs`
- `src-tauri/src/commands/charts.rs`
- `src-tauri/src/modules/cloud_auth.rs`
- `src-tauri/src/state.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`

### 外部依赖

- Supabase 项目：`https://sjexeynibnfqxvwehnxk.supabase.co`
- 下载器：`music-player/manual_downloader.exe`（Python 实现，源码 `manual_downloader.py`，依赖 `ffmpeg.exe` + `you-get.exe`）
- 旧版 Electron 实现（参考）：`electron/src/modules/cloudAuth.js` / `electron/src/scripts/modules/charts.js` / `electron/main/ipc-cloud.js` / `electron/main/ipc-music.js`

### 相关文档

- `docs/MODAL_SYSTEM.md`：自定义弹窗系统设计（替代 `window.confirm` / `window.prompt`）
- `docs/SECURITY.md`：凭据加密与 API Key 安全设计
- `docs/modules/music-player.md`：音乐播放器模块文档（与本模块共享 API Key 体系）
- `docs/SINGLE_LOGIN_DESIGN.md`：单点登录设计（云端模式）
