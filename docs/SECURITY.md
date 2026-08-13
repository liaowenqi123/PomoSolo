# PomoSolo 安全设计

> 本文档描述 PomoSolo v4.0（Tauri v2 + Vue 3）的安全机制、与旧版 Electron 的对比、已知限制和威胁模型。

---

## 1. 安全概览

PomoSolo 的安全设计围绕以下目标展开：

1. **本地凭据加密存储**：用户保存的账号密码不能明文落盘
2. **云端密码安全哈希**：服务端不存储明文密码，验证时用 PBKDF2
3. **API Key 隔离**：DeepSeek API Key 不进入渲染进程的网络请求
4. **渲染层最小权限**：CSP 白名单 + capabilities 按需授权
5. **加密跨平台一致**：不依赖 OS DPAPI 等系统 API，行为可预测

---

## 2. 加密机制

### 2.1 AES-256-GCM（替代 Electron safeStorage）

#### 算法选择

| 维度 | Electron safeStorage | PomoSolo v4.0 |
|------|---------------------|---------------|
| 算法 | Windows: DPAPI；macOS: Keychain；Linux: libsecret | AES-256-GCM（纯 Rust 实现） |
| 跨平台一致性 | ❌ 不同 OS 行为不同 | ✅ 完全一致 |
| 密钥来源 | OS 托管 | 由机器特征派生（PBKDF2） |
| 完整性保护 | 无（DPAPI 只加密） | ✅ GCM 模式带认证标签 |
| 调试性 | 黑盒 | 可独立测试 |

#### 实现（`src-tauri/src/modules/cloud_auth.rs`）

**密钥派生**：

```rust
fn derive_machine_key() -> [u8; KEY_LENGTH] {  // KEY_LENGTH = 32
    let hostname = hostname::get().unwrap_or_default();
    let username = whoami::username();

    let mut salt = Vec::new();
    salt.extend_from_slice(hostname.as_bytes());
    salt.extend_from_slice(username.as_bytes());
    salt.extend_from_slice(b"PomoSolo-v4-credential-key");

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha512>(
        b"PomoSolo-machine-key",  // 固定 password
        &salt,
        100_000,                  // 迭代数
        &mut key,
    );
    key
}
```

**加密**：

```rust
pub fn encrypt_string(plaintext: &str) -> Result<String, String> {
    let key = derive_machine_key();
    let cipher = Aes256Gcm::new_from_slice(&key)?;

    let mut nonce_bytes = [0u8; 12];  // 96-bit nonce
    OsRng.fill_bytes(&mut nonce_bytes);  // CSPRNG
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())?;

    // 拼接 nonce + ciphertext 后 base64
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(base64_encode(&combined))
}
```

**解密**：

```rust
pub fn decrypt_string(encrypted: &str) -> Result<String, String> {
    let key = derive_machine_key();
    let cipher = Aes256Gcm::new_from_slice(&key)?;

    let combined = base64_decode(encrypted)?;
    if combined.len() < 12 { return Err("Invalid ciphertext length".into()); }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext)?;
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}
```

#### 关键设计点

- **AES-256-GCM** 而非 AES-CBC：GCM 模式自带认证标签（GMAC），能检测密文是否被篡改
- **Nonce 随机生成**：每次加密用 `OsRng`（CSPRNG）生成 12 字节随机 nonce，与密文一同存储
- **Nonce 不复用**：由于每次随机生成，相同明文每次加密结果不同
- **密钥不落盘**：派生密钥仅在内存中使用，不持久化
- **机器绑定**：密钥派生用 hostname + username，换机器无法解密

#### 应用场景

- `credentials.json` 中的 `password_encrypted` 字段：保存的账号密码
- 未来可扩展用于加密 API Key（当前 API Key 仍明文存于 `data.json`）

### 2.2 PBKDF2-SHA512 密码哈希

#### 算法参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 算法 | PBKDF2-HMAC-SHA512 | 与 Electron 版 `crypto.pbkdf2(password, salt, 100000, 64, 'sha512')` 完全一致 |
| 迭代数 | 100,000 | 与旧版兼容 |
| 输出长度 | 64 字节（512 位） | SHA-512 原生长度 |
| Salt | 16 字节随机 | 每个用户独立 |
| Salt 编码 | hex（32 字符） | 与旧版兼容 |
| Hash 编码 | hex（128 字符） | 与旧版兼容 |

#### 实现

```rust
const PBKDF2_ITERATIONS: u32 = 100_000;

pub fn hash_password(password: &str, salt: &str) -> String {
    let salt_bytes = salt.as_bytes();
    let mut derived_key = [0u8; 64];
    pbkdf2_hmac::<Sha512>(password.as_bytes(), salt_bytes, PBKDF2_ITERATIONS, &mut derived_key);
    hex_encode(&derived_key)
}

pub fn generate_salt() -> String {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    hex_encode(&salt)
}
```

#### 与 Electron 版的兼容性

**完全兼容**。Electron 端：

```js
crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
    resolve({ hash: derivedKey.toString('hex'), salt });
});
```

Rust 端用相同 password + salt 计算出的 hex 字符串与 Node.js 完全一致。这意味着：

- v3.x 注册的用户，v4.0 可以直接登录验证
- v4.0 注册的用户，v3.x 也可以验证
- 迁移过程无需重置密码

#### 应用场景

- 自建服务器 `users` 表（`pbkdf2$100000$<salt>$<hash>` 单字段，兼容迁移自 Supabase 的老数据）
- 注册时：生成随机 salt → 计算 hash → 存入数据库
- 登录时：查询用户的 salt → 计算 hash → 与数据库 hash 比对

#### 为什么不用 bcrypt / argon2？

主要是**兼容性**。Electron v3.x 已经用 PBKDF2-SHA512-100000 存了大量用户密码，迁移到新算法需要用户全部重置密码。100,000 次迭代在 2026 年虽然偏低（OWASP 建议 600,000+），但配合 16 字节随机 salt 和 SHA-512 仍然可接受。

**未来演进**：新注册用户可考虑切到 argon2id，老用户在下次改密码时迁移。

### 2.3 加密相关依赖

`Cargo.toml`：

```toml
aes-gcm = "0.10"                              # AES-256-GCM
pbkdf2 = { version = "0.12", features = ["simple"] }  # PBKDF2
sha2 = "0.10"                                 # SHA-512
rand = "0.8"                                  # OsRng CSPRNG
base64 = "0.22"                               # Base64 编解码
hostname = "0.4"                              # 机器标识
whoami = "1.5"                                # 用户名
```

---

## 3. API Key 隔离策略

### 3.1 问题背景

DeepSeek API Key 是敏感凭据，泄露后会被滥用扣费。Electron 版的 API Key 流向：

```
data.json ──读取──► 渲染进程 ──► fetch(deepseek API) ──► 网络
```

渲染进程（Chromium）有完整的 JS 执行能力，API Key 一旦进入渲染进程，理论上可被 XSS 攻击或恶意插件窃取。

### 3.2 PomoSolo v4.0 的隔离设计

```
data.json ──读取──► Rust 后端 ──► reqwest 调用 DeepSeek ──► 网络
                        ▲
                        │ get_api_key() 命令（仅返回是否已配置）
                        │
                      渲染进程（只拿到布尔值，拿不到 Key 本身）
```

#### 当前实现

| 命令 | 返回值 | 暴露范围 |
|------|--------|---------|
| `get_api_key` | `Option<String>` | ⚠️ 当前会返回完整 Key，待改进 |
| `save_api_key` | `()` | 写入 data.json |
| `foreground_set_api_key` | `()` | 写入内存 `RwLock<Option<String>>`，不落盘 |
| `foreground_is_ready` | `bool` | ✅ 只返回布尔值 |

#### 改进方向

`get_api_key` 命令当前为兼容前端"显示已配置的 Key"功能而返回完整字符串。**建议改为**：

- 新增 `has_api_key() -> bool` 命令，仅返回布尔值
- `get_api_key` 标记为 `#[deprecated]` 或限制只在设置面板调用
- 所有需要使用 Key 的网络请求（AI 规划、前台检测）由 Rust 端发起，前端只传业务参数

#### 前台检测中的 Key 隔离

`modules/foreground_inspection.rs` 中的 `check_is_entertainment` 函数：

```rust
pub async fn check_is_entertainment(api_key: &str, window_title: &str) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))  // ← Key 在 Rust 端使用
        .json(&body)
        .send()
        .await?;
    // ...
}
```

API Key 仅在 Rust 进程内存中传递，前端从未接触到。

### 3.3 API 模式（云端 / 本地）

PomoSolo 支持两种 API 模式：

| 模式 | Key 来源 | 适用场景 |
|------|---------|---------|
| `cloud` | 服务端 Session（用户登录后由后端代理调用） | 共享 Key，普通用户 |
| `local` | 用户本地保存的 DeepSeek API Key | 自带 Key，高级用户 |

模式切换通过 `get_api_mode` / `set_api_mode` 命令，存于 `data.json` 的 `apiMode` 字段。

---

## 4. CSP 内容安全策略

### 4.1 配置（`tauri.conf.json`）

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self' data:",
      "dangerousDisableAssetCspModification": false
    }
  }
}
```

### 4.2 指令逐项说明

| 指令 | 值 | 说明 |
|------|-----|------|
| `default-src` | `'self'` | 默认所有资源只能从应用自身加载（禁止任意外部域名） |
| `style-src` | `'self' 'unsafe-inline'` | 允许内联样式（Vue 的 scoped style 需要） |
| `script-src` | `'self'` | **不允许 `unsafe-eval`、不允许内联脚本**（最严格） |
| `img-src` | `'self' data:` | 允许 data URL（用于内联图标） |
| `font-src` | `'self' data:` | 允许 data URL 字体 |

### 4.3 关键限制

- **无 `unsafe-eval`**：不能用 `eval()`、`new Function()`，影响部分模板编译（Vue 3 完整版默认不需要）
- **无 `unsafe-inline` 脚本**：所有 JS 必须来自 `'self'`，内联 `<script>` 被禁
- **无外部域名**：所有 API 请求走 Rust 端 `reqwest`，不从前端 `fetch`
- **`connect-src` 未显式声明**：默认回退到 `default-src 'self'`，前端 `fetch` 外部域名会被拦截

### 4.4 与 Electron 版对比

| 维度 | Electron v3.x | Tauri v2 v4.0 |
|------|---------------|----------------|
| 默认 CSP | 无 | 强制配置 |
| `unsafe-eval` | 默认允许 | ❌ 禁止 |
| `unsafe-inline` 脚本 | 默认允许 | ❌ 禁止 |
| 外部域名访问 | 默认允许 | ❌ 禁止 |
| 配置位置 | `webPreferences` + meta 标签 | `tauri.conf.json`（构建时固化） |

### 4.5 `dangerousDisableAssetCspModification`

设置为 `false`，意味着 Tauri 不会自动放宽 CSP 来加载资源。所有资源必须在 CSP 白名单内。

---

## 5. 权限模型（Capabilities）

### 5.1 配置（`src-tauri/capabilities/default.json`）

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    "core:window:default",
    "core:window:allow-close",
    "core:window:allow-minimize",
    "core:window:allow-set-always-on-top",
    "core:window:allow-set-focus"
  ]
}
```

### 5.2 设计原则

- **白名单制**：只有显式列出的权限才被授予
- **按窗口粒度**：`"windows": ["main"]` 限制权限只作用于主窗口
- **最小权限**：未列出的窗口操作（如 `allow-set-size`、`allow-maximize`）默认拒绝

### 5.3 与 Electron 对比

| 维度 | Electron | Tauri v2 |
|------|----------|----------|
| 权限粒度 | 渲染进程要么有 Node 全权限，要么无 | 按权限项白名单 |
| 配置方式 | `webPreferences.nodeIntegration` 等布尔位 | JSON capabilities 文件 |
| 窗口隔离 | 全部共享同一组权限 | 按窗口名授权 |
| 运行时修改 | 可动态切换 | 编译时确定 |

### 5.4 当前已授权的权限

| 权限 | 用途 |
|------|------|
| `core:default` | Tauri 核心默认权限（IPC、事件等） |
| `shell:allow-open` | 允许通过 `tauri-plugin-shell` 打开外部链接 |
| `core:window:default` | 窗口默认操作 |
| `core:window:allow-close` | 关闭窗口（`close_window` 命令） |
| `core:window:allow-minimize` | 最小化（`minimize_window` 命令） |
| `core:window:allow-set-always-on-top` | 置顶（`set_always_on_top` 命令） |
| `core:window:allow-set-focus` | 抢占焦点（`bring_to_front` 命令） |

未授权的操作（如 `allow-set-size`、`allow-maximize`、`allow-unminimize`）会被 Tauri 运行时拒绝。

---

## 6. 与 Electron 版本的安全对比

### 6.1 攻击面缩减

| 攻击面 | Electron v3.x | Tauri v2 v4.0 |
|--------|---------------|----------------|
| 渲染层 RCE | Chromium 漏洞 + Node 集成风险 | WebView2 漏洞（无 Node 集成） |
| XSS → 本地代码执行 | `nodeIntegration: true` 时致命 | 不可能（无 Node） |
| 依赖供应链 | npm + Electron 本身 | npm + crates.io（Rust 生态更小） |
| IPC 滥用 | `ipcMain.on` 默认无校验 | Tauri 命令显式注册 + 类型校验 |
| DevTools 泄露 | 生产模式可手动打开 | `#[cfg(debug_assertions)]` 编译时控制 |

### 6.2 加密改进

| 维度 | Electron | Tauri v2 |
|------|----------|----------|
| 算法 | OS DPAPI（Windows）/ Keychain（Mac）/ libsecret（Linux） | AES-256-GCM（纯 Rust，跨平台一致） |
| 完整性保护 | ❌（DPAPI 只加密） | ✅（GCM 认证标签） |
| 跨平台 | ❌（不同 OS 行为不同） | ✅ |
| 密钥托管 | OS 托管 | 由机器特征派生 |
| 调试性 | 黑盒 | 可独立测试 |
| 备份可移植性 | ❌（DPAPI 加密的无法跨机器恢复） | ⚠️（密钥绑定 hostname + username，同机器可恢复） |

### 6.3 密码哈希

完全兼容，无回归。

### 6.4 已知回归

| 项 | 说明 | 缓解 |
|----|------|------|
| API Key 仍明文存储 | `data.json` 中 `apiKey` 字段未加密 | 建议用 `encrypt_string` 加密存储 |
| 单点登录心跳未实现 | Electron 版有 60s 心跳 + 2min 超时检查 | 待迁移 |
| 用户数据备份未加密 | `userData-backup.js` 迁移未完成 | 待迁移 |

---

## 7. 已知限制

### 7.1 加密层

- **密钥派生依赖 hostname + username**：如果用户改了计算机名或用户名，旧凭据无法解密，需要重新登录
- **派生 password 是固定字符串** `"PomoSolo-machine-key"`：理论上逆向代码可知，但配合 100,000 次迭代 + 机器特征 salt，攻击成本仍较高
- **无密钥旋转机制**：一旦密钥派生算法变更，所有旧密文需重新加密
- **AES-GCM nonce 长度固定 12 字节**：标准做法，但需确保 `OsRng` 真随机（Rust `getrandom` crate 在 Windows 上调 `BCryptGenRandom`，安全）

### 7.2 API Key 层

- `get_api_key` 命令当前返回完整 Key（见 3.2 改进方向）
- API Key 明文存于 `data.json`，任何能读取该文件的进程都能拿到
- 无 Key 过期 / 轮换机制

### 7.3 CSP 层

- `style-src 'unsafe-inline'` 是为了 Vue scoped style，理论上可改为 `'self'` + nonce，但需要 Vite 配置调整
- `connect-src` 未显式声明，依赖 `default-src 'self'` 兜底；建议显式声明以提升可读性

### 7.4 权限层

- `shell:allow-open` 允许打开任意外部链接，理论上可被诱导打开恶意 URL（实际由 `tauri-plugin-shell` 内部校验 scheme）
- 未配置 deeplink / URL scheme 验证

### 7.5 网络层

- 已从 Supabase 迁移至自建服务器：access token（JWT，15 分钟）+ refresh token（30 天滚动），过期自动续期；refresh token 存储于服务端 `sessions` 表，登出即失效
- `SERVER_URL` 已切换 HTTPS（`https://api.pomogrow.top`），JWT 通过 WS query 传递（`wss://api.pomogrow.top/ws`）
- DeepSeek API 调用走 HTTPS，但无证书 pinning（标准 `reqwest` 默认信任系统证书）

### 7.6 进程层

- Python 子进程（`music.exe`）通过 stdin/stdout JSON 通信，无身份认证。本地攻击者理论上可注入命令，但需要先获取进程句柄
- Rust 主进程崩溃时 `panic = "abort"` 直接退出，无 panic 信息泄露到日志（release 模式 `strip = true`）

---

## 8. 威胁模型

### 8.1 在范围内

| 威胁 | 缓解措施 |
|------|---------|
| 凭据文件被复制到其他机器 | AES-256-GCM 密钥由 hostname + username 派生，跨机器无法解密 |
| 凭据文件被篡改 | GCM 认证标签会检测到篡改，解密失败 |
| 渲染层 XSS 窃取 API Key | API Key 使用在 Rust 端，渲染层只能拿到布尔值（改进后） |
| 渲染层 XSS 执行任意代码 | Tauri 无 Node 集成，CSP 禁止 `unsafe-eval` 和内联脚本 |
| 暴力破解云端密码 | PBKDF2-SHA512 100,000 次迭代 + 16 字节随机 salt |
| 中间人攻击 API 调用 | 全部走 HTTPS |
| 恶意网页注入（CSP 绕过） | 严格 CSP，外部资源加载全禁 |

### 8.2 不在范围内

| 威胁 | 说明 |
|------|------|
| **本地管理员权限攻击者** | 攻击者有管理员权限时可读取进程内存、注入 DLL，任何客户端加密都无效 |
| **物理设备访问** | 攻击者拿到机器物理访问权可离线破解（但仍受密钥派生保护） |
| **零日漏洞** | WebView2 / Rust 编译器 / 依赖库的未知漏洞 |
| **服务端漏洞** | 自建服务器 / DeepSeek 服务端被攻破 |
| **社会工程** | 钓鱼攻击骗取用户主动输入凭据到伪造界面 |

### 8.3 假设

- 用户机器未被 rootkit 感染
- 用户操作系统为正版 Windows 10/11，WebView2 已更新到最新版
- 用户不会主动用管理员权限修改 `credentials.json` 并期待它仍能解密
- 自建服务器（`SERVER_URL`）已配置强 JWT_SECRET，且仅通过 HTTPS 对外提供服务（当前为 HTTP + 内网策略，备案后切 HTTPS）
- access token 15 分钟过期 + refresh token 30 天滚动刷新，refresh token 泄露风险可控

---

## 9. 安全审计清单

定期检查以下项：

- [ ] `tauri.conf.json` 的 CSP 是否仍为严格白名单
- [ ] `capabilities/default.json` 是否遵循最小权限原则
- [ ] `Cargo.lock` 中 `aes-gcm` / `pbkdf2` / `sha2` 是否有已知 CVE（`cargo audit`）
- [ ] `package.json` 中前端依赖是否有已知漏洞（`npm audit`）
- [ ] `credentials.json` 文件权限是否为仅当前用户可读写（Windows ACL）
- [ ] 自建服务器 `JWT_SECRET` 是否足够强、是否未泄露
- [ ] `get_api_key` 命令是否仍返回完整 Key（应为布尔值）
- [ ] DevTools 在 release 构建中是否禁用（`#[cfg(debug_assertions)]` 应保证）
- [ ] Rust 端 `unwrap()` 是否会在恶意输入下 panic（应改为 `?` + `map_err`）

---

## 10. 安全相关代码位置速查

| 关注点 | 文件路径 |
|--------|---------|
| AES-GCM 加密 | `src-tauri/src/modules/cloud_auth.rs::encrypt_string / decrypt_string` |
| 密钥派生 | `src-tauri/src/modules/cloud_auth.rs::derive_machine_key` |
| PBKDF2 密码哈希 | `src-tauri/src/modules/cloud_auth.rs::hash_password / generate_salt` |
| 凭据文件路径 | `src-tauri/src/modules/cloud_auth.rs::get_credentials_path` |
| 凭据存储 / 读取 / 清除 | `src-tauri/src/modules/cloud_auth.rs::save_credentials / load_credentials / clear_credentials` |
| 云端登录验证 | `src-tauri/src/commands/cloud_auth.rs::cloud_login` |
| API Key 读写 | `src-tauri/src/commands/cloud_auth.rs::get_api_key / save_api_key` |
| API 模式切换 | `src-tauri/src/commands/cloud_auth.rs::get_api_mode / set_api_mode` |
| 前台检测 API Key 隔离 | `src-tauri/src/modules/foreground_inspection.rs::check_is_entertainment` |
| CSP 配置 | `src-tauri/tauri.conf.json::app.security.csp` |
| 权限配置 | `src-tauri/capabilities/default.json` |
| 数据目录 | `src-tauri/src/modules/data_manager.rs::get_data_dir` |
| Rust 依赖版本 | `src-tauri/Cargo.toml` + `Cargo.lock` |
| 前端依赖版本 | `package.json` + `package-lock.json` |

---

## 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构设计
- [MIGRATION.md](./MIGRATION.md) - 迁移指南（含安全改进对比）
- [README.md](../README.md) - 项目总览
