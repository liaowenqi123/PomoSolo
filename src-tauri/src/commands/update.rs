//! 自动更新 commands
//!
//! 自实现更新器（支持运行时选择更新源）：
//!   tauri-plugin-updater 的 endpoints 编译期固定（tauri.conf.json），无法运行时切换，
//!   因此检查 / 下载 / 安装全部自实现，仅复用其签名（Ed25519）与安装包规范。
//!
//! ⚠️ 插件 endpoints 配置只保留 https 占位地址（GitHub）：
//!   tauri-plugin-updater 仍注册但完全不参与检查/下载/安装；其 endpoints 在插件初始化时
//!   校验，非 https 端点（如 http://115.159.49.112/...）会直接 panic 导致应用启动闪退
//!   （v4.5.15 踩坑，v4.5.16 修复）。真实更新源地址见下方 UpdateSource::latest_json_url，
//!   运行时切换与插件配置无关。
//!
//! 更新源：
//!   github —— 默认。下载快但国内可能不稳定（https 加密）。
//!   server —— 用户自己的服务器（http://115.159.49.112/updates/），稳定但只有 3Mbps，慢。
//!
//! 兼容原 Electron 版（electron-updater）的事件协议：
//!   emit("update-status", { status, version, ... })
//!
//! 状态机：
//!   checking → available | not-available | error
//!   available → (用户点击下载) → downloading → downloaded → (启动安装器并退出)
//!
//! 用户数据备份：
//!   运行时音乐目录 = app_data_dir/music（用户数据区，安装/更新不覆盖）。
//!   安装包内置歌曲在 resource_dir/music，启动时由 merge_music_dir 合并到用户目录
//!   （不覆盖已有文件）；更新前备份 resource_dir/music 中老版本残留的用户歌曲。

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

/// 更新源
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateSource {
    Github,
    Server,
}

impl UpdateSource {
    /// 解析前端传入的源名（默认 github）
    fn parse(source: Option<String>) -> Self {
        match source.as_deref() {
            Some("server") => Self::Server,
            _ => Self::Github,
        }
    }

    /// 各更新源的 latest.json 地址（正式渠道：不含 prerelease）
    fn latest_json_url(&self) -> &'static str {
        match self {
            Self::Github => {
                "https://github.com/liaowenqi123/PomoSolo/releases/latest/download/latest.json"
            }
            Self::Server => "http://115.159.49.112/updates/latest.json",
        }
    }

    /// Beta 渠道（allow_beta=true）的 latest.json 地址
    ///
    /// GitHub 的 `releases/latest` 端点永远指向最新**非 prerelease** release，
    /// 拿不到 beta/alpha/rc → 走 GitHub API 找版本号最大的 release（含 prerelease，
    /// v4.5.19 修复）；服务器约定单独的 `latest-beta.json` 文件（正式/测试互不覆盖）。
    fn latest_beta_json_url(&self) -> &'static str {
        match self {
            Self::Github => {
                // 实际地址需经 GitHub API 解析（版本号最大 release 的 latest.json 资产），
                // 见 fetch_latest_json 的 allow_beta 分支。
                "https://api.github.com/repos/liaowenqi123/PomoSolo/releases?per_page=100"
            }
            Self::Server => "http://115.159.49.112/updates/latest-beta.json",
        }
    }
}

/// 平台下载信息（tauri updater 规范：嵌套在 `platforms.<os>` 下）
#[derive(Debug, Deserialize)]
struct PlatformInfo {
    url: String,
    signature: String,
}

/// 服务器 latest.json 结构（tauri updater 规范）
///
/// ```json
/// {"version":"4.5.16","notes":"...","pub_date":"...","platforms":{"windows-x86_64":{"url":"...","signature":"..."}}}
/// ```
///
/// ⚠️ v4.5.16 曾把 `url`/`signature` 定义在顶层导致 `missing field 'url'` 解析失败
/// （检查/下载全链崩），v4.5.17 改为按规范从 `platforms.windows-x86_64` 提取。
#[derive(Debug, Deserialize)]
struct LatestJson {
    version: String,
    notes: Option<String>,
    #[serde(rename = "pub_date")]
    pub_date: Option<String>,
    platforms: std::collections::HashMap<String, PlatformInfo>,
}

impl LatestJson {
    /// 取 windows-x86_64 平台的下载信息（下载地址 + 签名）
    fn windows_platform(&self) -> Result<&PlatformInfo, String> {
        self.platforms
            .get("windows-x86_64")
            .ok_or_else(|| "更新信息缺少 windows-x86_64 平台配置".to_string())
    }
}

/// 获取备份数据目录（与 data.json 同级：app_data_dir/PomoSolo/）
fn get_backup_base_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录: {}", e))?;
    path.push("PomoSolo");
    fs::create_dir_all(&path).map_err(|e| format!("创建数据目录失败: {}", e))?;
    Ok(path)
}

/// 更新信息（返回给前端）
#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
}

/// 服务器公告（/updates/notice.json，v4.5.21 新增）
///
/// 更新失败（签名验证失败/下载失败/解析失败）时向前端展示官方指引，
/// 避免用户在出错时不知道怎么做（教训：v4.5.20 签名 bug 曾逼用户重装）。
/// 网络失败/无公告返回 None——公告是增强能力，不阻塞任何流程。
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateNotice {
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub min_version: String,
    #[serde(default)]
    pub max_version: String,
}

/// 公告是否对当前版本生效：min_version <= version <= max_version（空表示不限）
fn notice_in_range(notice: &UpdateNotice, version: &str) -> bool {
    let after_min =
        notice.min_version.is_empty() || !is_newer(&notice.min_version, version);
    let before_max =
        notice.max_version.is_empty() || !is_newer(version, &notice.max_version);
    after_min && before_max
}

/// 拉取服务器公告（按当前版本过滤生效范围）
#[tauri::command]
pub async fn fetch_notice(version: String) -> Result<Option<UpdateNotice>, String> {
    const NOTICE_URL: &str = "http://115.159.49.112/updates/notice.json";
    let resp = match reqwest::Client::new()
        .get(NOTICE_URL)
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(None), // 公告拉取失败不打扰用户
    };
    let text = match resp.text().await {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    let notice: UpdateNotice = match serde_json::from_str(&text) {
        Ok(n) => n,
        Err(_) => return Ok(None),
    };
    if !notice.active || !notice_in_range(&notice, &version) {
        return Ok(None);
    }
    Ok(Some(notice))
}

/// 拉取更新信息（正式渠道拉 latest.json；allow_beta=true 拉 beta 渠道）
///
/// GitHub 正式渠道用 `releases/latest`（永不返回 prerelease）；
/// Beta 渠道（v4.5.19 修复）走 GitHub API 列出全部 release（含 prerelease），
/// 用 `is_newer` 语义找版本号最大的 release，取其 latest.json 资产的下载地址。
/// 服务器 Beta 渠道为独立的 `latest-beta.json`（正式/测试互不覆盖）。
async fn fetch_latest_json(source: UpdateSource, allow_beta: bool) -> Result<LatestJson, String> {
    let url = if allow_beta {
        match source {
            UpdateSource::Github => github_latest_json_asset_url().await?,
            UpdateSource::Server => source.latest_beta_json_url().to_string(),
        }
    } else {
        source.latest_json_url().to_string()
    };
    let resp = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", "PomoSolo-Updater")
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("请求更新信息失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("更新源返回 HTTP {}", resp.status()));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取更新信息失败: {}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("解析更新信息失败: {}", e))
}

/// GitHub API release 对象（仅取所需字段）
#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

/// 通过 GitHub API 找出版本号最大的 release（含 prerelease）的 latest.json 资产地址
///
/// `releases/latest` 端点排除 prerelease，Beta 检测必须走 API 列表。
/// 用 `is_newer` 语义比较（"4.6.0-beta.0" > "4.5.18"），draft / 无 latest.json 资产的跳过。
async fn github_latest_json_asset_url() -> Result<String, String> {
    let resp = reqwest::Client::new()
        .get("https://api.github.com/repos/liaowenqi123/PomoSolo/releases?per_page=100")
        .header("User-Agent", "PomoSolo-Updater")
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("查询 GitHub Release 列表失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub API 返回 HTTP {}", resp.status()));
    }
    let releases: Vec<GithubRelease> = resp
        .json()
        .await
        .map_err(|e| format!("解析 GitHub Release 列表失败: {}", e))?;
    pick_best_release_asset(&releases)
        .map(|(_, url)| url)
        .ok_or_else(|| "GitHub 上未找到可用的 latest.json".to_string())
}

/// 从 release 列表里选出版本号最大（语义化，含 prerelease）且带 latest.json 资产的
/// 发布，返回其 (version, latest.json 下载地址)。draft / 无 latest.json 资产的跳过。
fn pick_best_release_asset(releases: &[GithubRelease]) -> Option<(String, String)> {
    let mut best: Option<(String, String)> = None; // (version, latest.json 下载地址)
    for r in releases {
        if r.draft {
            continue;
        }
        let version = r.tag_name.trim_start_matches('v');
        let Some(asset) = r.assets.iter().find(|a| a.name == "latest.json") else {
            continue;
        };
        let is_better = match &best {
            None => true,
            Some((cur, _)) => is_newer(version, cur),
        };
        if is_better {
            best = Some((version.to_string(), asset.browser_download_url.clone()));
        }
    }
    best
}

/// 版本号比较：latest > current 时有更新
///
/// 段内取数字前缀（"15-beta" → 15），支持变长版本号与 prerelease（v4.5.18 修复）：
/// - 同数字但带 prerelease 后缀的版本**更旧**（"4.6.0-beta.0" < "4.6.0"，语义化版本规则）
/// - 数字大的段胜出（"4.6.0-beta.0" > "4.5.17"，新 minor 的 beta 仍比旧 release 新）
fn is_newer(latest: &str, current: &str) -> bool {
    let parse_seg = |s: &str| -> (u64, bool) {
        let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
        // has_suffix：该段带非数字后缀（prerelease 标记，如 "0-beta"、"15-alpha"）
        (digits.parse().unwrap_or(0), digits.len() != s.len())
    };
    let l: Vec<(u64, bool)> = latest.split('.').map(parse_seg).collect();
    let c: Vec<(u64, bool)> = current.split('.').map(parse_seg).collect();
    for i in 0..l.len().max(c.len()) {
        let a = l.get(i).copied().unwrap_or((0, false));
        let b = c.get(i).copied().unwrap_or((0, false));
        if a.0 != b.0 {
            return a.0 > b.0;
        }
        if a.1 != b.1 {
            // 数字相同：带 prerelease 后缀的版本更旧（正式版 > 同版本 beta）
            return !a.1;
        }
    }
    false
}

/// 判断版本号是否为 prerelease（beta/alpha/rc 等，v4.5.18 新增）
///
/// 语义化版本：prerelease 以 `-` 后缀形式出现在某段数字之后（如 "0-beta"）。
/// 正式渠道默认跳过 prerelease，避免把 beta 当作正式更新推给用户。
fn is_prerelease(version: &str) -> bool {
    version.split('.').any(|seg| {
        let digits: String = seg.chars().take_while(|c| c.is_ascii_digit()).collect();
        !digits.is_empty() && digits.len() != seg.len()
    })
}

/// 解析 tauri.conf.json 中 updater.pubkey（minisign 公钥文本的 base64）
///
/// 配置格式：base64( "untrusted comment: minisign public key: XXXX\nRWT<base64>" )，
/// RWT 行 base64 解码后 42 字节 = [0..2]算法 + [2..10]key_id + [10..42]Ed25519 公钥。
/// ⚠️ v4.5.20 修复：此前错误取 bytes[3..35]（把 key_id 尾段拼进公钥），导致提取的公钥
/// 是垃圾值、任何真实签名都无法通过验证（现象：下载完提示"安装包签名验证失败"）。
fn parse_pubkey(pubkey_b64: &str) -> Option<[u8; 32]> {
    let text = B64.decode(pubkey_b64).ok()?;
    let text = String::from_utf8(text).ok()?;
    let line = text.lines().find(|l| l.trim().starts_with("RWT"))?;
    let bytes = B64.decode(line.trim()).ok()?;
    if bytes.len() < 42 {
        return None;
    }
    bytes.get(10..42)?.try_into().ok()
}

/// 校验安装包签名（v4.5.20 重写）
///
/// tauri updater 的 latest.json `signature` 字段 = base64(minisign 签名文本)：
///   untrusted comment: signature from tauri secret key
///   RUT<base64>   ← 解码 74 字节 = [0..2]算法 + [2..10]key_id + [10..74]Ed25519 签名
///   trusted comment: timestamp:... file:...
///   <base64>      ← 64 字节 global signature（本实现不校验，只做主签名验证）
///
/// 算法标记：[0..2] == "ED"(0x45 0x44) → 预哈希模式 Ed25519(blake2b-512(文件))；
/// [0..2] == "Ed"(0x45 0x64) → 直签模式 Ed25519(文件)。
///
/// 兼容旧格式：若 signature 是裸 64 字节 Ed25519 签名的 base64，按直签模式验证。
fn verify_installer(data: &[u8], signature_b64: &str, pubkey_b64: &str) -> bool {
    let Some(pk) = parse_pubkey(pubkey_b64) else {
        return false;
    };
    let Ok(vk) = VerifyingKey::from_bytes(&pk) else {
        return false;
    };

    // 1) 裸 64 字节签名（base64 直解码）：直签文件内容
    if let Ok(sig_bytes) = B64.decode(signature_b64) {
        if let Ok(sig) = <[u8; 64]>::try_from(sig_bytes.as_slice()) {
            if vk.verify(data, &Signature::from_bytes(&sig)).is_ok() {
                return true;
            }
        }
    }

    // 2) tauri minisign 格式：signature = base64(minisign 签名文本)
    let Ok(text) = B64.decode(signature_b64) else {
        return false;
    };
    let Ok(text) = String::from_utf8(text) else {
        return false;
    };
    let Some(sig_line) = text.lines().find(|l| l.trim().starts_with("RUT")) else {
        return false;
    };
    let Ok(bin1) = B64.decode(sig_line.trim()) else {
        return false;
    };
    if bin1.len() != 74 {
        return false;
    }
    let prehashed = bin1[0..2] == [0x45, 0x44]; // "ED" = 预哈希
    let Ok(sig) = <[u8; 64]>::try_from(&bin1[10..74]) else {
        return false;
    };
    let sig = Signature::from_bytes(&sig);
    if prehashed {
        use blake2::digest::{Update, VariableOutput};
        let Ok(mut hasher) = blake2::Blake2bVar::new(64) else {
            return false;
        };
        hasher.update(data);
        let mut h = [0u8; 64];
        if hasher.finalize_variable(&mut h).is_err() {
            return false;
        }
        vk.verify(&h, &sig).is_ok()
    } else {
        vk.verify(data, &sig).is_ok()
    }
}

/// 读取 tauri.conf.json 配置中的更新公钥（plugins.updater.pubkey）
fn get_update_pubkey(app: &AppHandle) -> Result<String, String> {
    let config = serde_json::to_value(app.config().clone())
        .map_err(|e| format!("读取更新配置失败: {}", e))?;
    config
        .get("plugins")
        .and_then(|p| p.get("updater"))
        .and_then(|u| u.get("pubkey"))
        .and_then(|p| p.as_str())
        .map(String::from)
        .ok_or_else(|| "缺少更新公钥配置".to_string())
}

/// 安装包临时保存路径（系统临时目录，按版本命名避免冲突）
fn temp_dest_path(version: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("pomosolo_update_{version}.exe"));
    p
}

/// 下载安装包到本地，通过 "update-status" 事件上报进度
async fn download_installer(
    app: &AppHandle,
    url: &str,
    dest: &PathBuf,
) -> Result<(), String> {
    let resp = reqwest::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| format!("下载更新失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("下载更新返回 HTTP {}", resp.status()));
    }
    let total = resp.content_length();
    let mut stream = resp.bytes_stream();
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("创建临时文件失败: {}", e))?;
    let mut transferred: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入临时文件失败: {}", e))?;
        transferred = transferred.saturating_add(chunk.len() as u64);
        let percent = match total {
            Some(t) if t > 0 => (transferred as f64 / t as f64 * 100.0).round() as u64,
            _ => 0,
        };
        let _ = app.emit(
            "update-status",
            serde_json::json!({
                "status": "downloading",
                "percent": percent,
                "transferred": transferred,
                "total": total,
            }),
        );
    }
    Ok(())
}

/// 检查更新
///
/// 返回 Ok(Some(info)) 表示有更新，Ok(None) 表示已是最新。
/// 同时 emit "update-status" 事件（status: available / not-available / error）。
///
/// - `source`: 更新源（github / server）
/// - `allow_beta`: 是否接收 prerelease（beta/alpha/rc）版本。默认 false：
///   正式渠道跳过 prerelease，latest.json 里只有 beta 时视为"无更新"（emit
///   not-available + betaOnly:true，前端提示可开启 Beta 接收）。
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    source: Option<String>,
    allow_beta: Option<bool>,
) -> Result<Option<UpdateInfo>, String> {
    // dev 模式跳过（无打包安装环境，避免误报）
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let source = UpdateSource::parse(source);
    let allow_beta = allow_beta.unwrap_or(false);
    let _ = app.emit("update-status", serde_json::json!({ "status": "checking" }));

    let latest = match fetch_latest_json(source, allow_beta).await {
        Ok(l) => l,
        Err(e) => {
            let msg = format!("检查更新失败: {}", e);
            let _ = app.emit("update-status", serde_json::json!({
                "status": "error",
                "message": msg,
            }));
            return Err(msg);
        }
    };

    let current = env!("CARGO_PKG_VERSION");
    // 正式渠道识别问题修复（v4.5.18）：latest 是 beta/alpha/rc（prerelease）时，
    // 只有用户开启"接收 Beta 版本"才提示更新；否则不打扰正式版用户。
    if !allow_beta && is_prerelease(&latest.version) {
        let _ = app.emit("update-status", serde_json::json!({
            "status": "not-available",
            "betaOnly": true,
            "betaVersion": &latest.version,
        }));
        return Ok(None);
    }
    if !is_newer(&latest.version, current) {
        let _ = app.emit("update-status", serde_json::json!({
            "status": "not-available",
        }));
        return Ok(None);
    }

    let info = UpdateInfo {
        version: latest.version.clone(),
        notes: latest.notes.clone().unwrap_or_default(),
        date: latest.pub_date.clone(),
    };
    let _ = app.emit(
        "update-status",
        serde_json::json!({
            "status": "available",
            "version": &info.version,
            "releaseDate": &info.date,
        }),
    );
    Ok(Some(info))
}

/// 下载并安装更新
///
/// 流程：备份用户数据 → 拉取 latest.json → 下载安装包 → 验证 Ed25519 签名 → 启动安装器并退出。
/// 通过 "update-status" 事件报告下载进度（status: downloading / downloaded / error）。
#[tauri::command]
pub async fn download_and_install(
    app: AppHandle,
    source: Option<String>,
    allow_beta: Option<bool>,
) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("开发模式不支持安装更新".to_string());
    }
    let source = UpdateSource::parse(source);
    let allow_beta = allow_beta.unwrap_or(false);

    // 1. 备份用户下载的歌曲（避免被安装包覆盖）
    if let Err(e) = backup_music_dir(&app) {
        eprintln!("[updater] 备份 music/ 目录失败: {}", e);
        // 备份失败不阻塞更新，继续
    }

    // 2. 拉取更新信息（下载地址 + 签名；Beta 渠道与检查时保持一致）
    let latest = fetch_latest_json(source, allow_beta)
        .await
        .map_err(|e| {
            let msg = format!("获取更新信息失败: {}", e);
            let _ = app.emit("update-status", serde_json::json!({
                "status": "error",
                "message": msg,
            }));
            msg
        })?;

    // 3. 下载安装包
    let platform = latest.windows_platform().map_err(|e| {
        let msg = format!("获取更新信息失败: {}", e);
        let _ = app.emit("update-status", serde_json::json!({
            "status": "error",
            "message": msg,
        }));
        msg
    })?;
    let dest = temp_dest_path(&latest.version);
    if let Err(e) = download_installer(&app, &platform.url, &dest).await {
        let msg = format!("下载更新失败: {}", e);
        let _ = app.emit("update-status", serde_json::json!({
            "status": "error",
            "message": msg,
        }));
        return Err(msg);
    }

    // 4. 验证 Ed25519 签名（防篡改，失败拒绝安装）
    let pubkey = get_update_pubkey(&app)?;
    let exe_bytes = fs::read(&dest).map_err(|e| format!("读取安装包失败: {}", e))?;
    if !verify_installer(&exe_bytes, &platform.signature, &pubkey) {
        let msg = "安装包签名验证失败，已拒绝安装".to_string();
        let _ = app.emit("update-status", serde_json::json!({
            "status": "error",
            "message": msg,
        }));
        return Err(msg);
    }

    // 5. 启动安装器并退出应用（安装器完成安装后应用重启）
    let _ = app.emit(
        "update-status",
        serde_json::json!({ "status": "downloaded" }),
    );
    std::process::Command::new(&dest)
        .spawn()
        .map_err(|e| format!("启动安装器失败: {}", e))?;
    std::thread::sleep(std::time::Duration::from_millis(500));
    app.exit(0);
    Ok(())
}

/// 备份 resource_dir/music/ 到 app_config_dir/backup/music/
///
/// 跳过三首内置歌曲（文件名以 " - 番茄钟.mp3" 结尾）。
/// 在下载安装更新前调用，防止安装包覆盖用户下载的歌曲。
fn backup_music_dir(app: &AppHandle) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取资源目录: {}", e))?;
    let music_dir = resource_dir.join("music");

    if !music_dir.exists() {
        return Ok(());
    }

    let config_dir = get_backup_base_dir(app)?;
    let backup_dir = config_dir.join("backup").join("music");
    // 清理旧备份
    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir).map_err(|e| format!("清理旧备份失败: {}", e))?;
    }
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {}", e))?;

    let mut backed_up = 0;
    for entry in fs::read_dir(&music_dir).map_err(|e| format!("读取 music/ 失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let filename = entry.file_name();
        let name = filename.to_string_lossy();

        // 跳过内置歌曲（避免备份 14MB 的固定文件）
        if is_builtin_song(&name) {
            continue;
        }

        let dest = backup_dir.join(&filename);
        fs::copy(entry.path(), &dest).map_err(|e| format!("备份文件 {} 失败: {}", name, e))?;
        backed_up += 1;
    }

    eprintln!("[updater] 已备份 {} 个用户文件到 {:?}", backed_up, backup_dir);
    Ok(())
}

/// 判断文件名是否为内置番茄钟歌曲（应跳过备份）
///
/// 内置歌曲命名格式："艺术家 - 番茄钟.mp3"（共 3 首），跳过避免重复备份 14MB。
fn is_builtin_song(filename: &str) -> bool {
    filename.ends_with(" - 番茄钟.mp3")
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{SigningKey, Signer};

    /// 构造 tauri minisign 公钥文本的 base64
    /// （RWT 行 = base64(42 字节) = "Ed" + key_id + 公钥；base64 恰以 "RWT" 开头）
    fn make_pubkey_b64(keypair: &SigningKey) -> String {
        let mut bin = Vec::with_capacity(42);
        bin.extend_from_slice(&[0x45, 0x64]); // "Ed"
        bin.extend_from_slice(&[0xfb, 0x21, 0xb5, 0xed, 0x19, 0xdf, 0xef, 0x70]); // key_id
        bin.extend_from_slice(&keypair.verifying_key().to_bytes());
        assert_eq!(bin.len(), 42);
        let text = format!(
            "untrusted comment: minisign public key: TEST\n{}\n",
            B64.encode(&bin)
        );
        B64.encode(text.as_bytes())
    }

    /// 构造 tauri 预哈希签名文本（signature = base64(minisign 文本)，RUT 行 = "ED" + key_id + 签名）
    fn make_tauri_prehashed_sig_b64(keypair: &SigningKey, data: &[u8]) -> String {
        use blake2::digest::{Update, VariableOutput};
        let mut hasher = blake2::Blake2bVar::new(64).unwrap();
        hasher.update(data);
        let mut h = [0u8; 64];
        hasher.finalize_variable(&mut h).unwrap();
        let sig = keypair.sign(&h);
        let mut bin1 = Vec::with_capacity(74);
        bin1.extend_from_slice(&[0x45, 0x44]); // "ED" = 预哈希模式
        bin1.extend_from_slice(&[0xfb, 0x21, 0xb5, 0xed, 0x19, 0xdf, 0xef, 0x70]); // key_id
        bin1.extend_from_slice(&sig.to_bytes());
        assert_eq!(bin1.len(), 74);
        let text = format!(
            "untrusted comment: signature from tauri secret key\n{}\ntrusted comment: timestamp:0 file:test\nAAAA\n",
            B64.encode(&bin1)
        );
        B64.encode(text.as_bytes())
    }

    #[test]
    fn test_is_builtin_song_matches_pattern() {
        assert!(is_builtin_song("钢琴曲 - 番茄钟.mp3"));
        assert!(is_builtin_song("吉他曲 - 番茄钟.mp3"));
        assert!(is_builtin_song("环境音 - 番茄钟.mp3"));
    }

    #[test]
    fn test_is_builtin_song_rejects_user_mp3() {
        assert!(!is_builtin_song("周杰伦 - 稻香.mp3"));
        assert!(!is_builtin_song("纯音乐.mp3"));
    }

    #[test]
    fn test_is_builtin_song_rejects_m4a() {
        // 内置歌曲均为 mp3，m4a 应不视为内置
        assert!(!is_builtin_song("钢琴曲 - 番茄钟.m4a"));
    }

    #[test]
    fn test_is_builtin_song_rejects_empty() {
        assert!(!is_builtin_song(""));
    }

    #[test]
    fn test_is_builtin_song_minimal_match() {
        // 仅 " - 番茄钟.mp3" 也满足 ends_with 判断（视为内置，保守跳过）
        assert!(is_builtin_song(" - 番茄钟.mp3"));
    }

    #[test]
    fn test_is_builtin_song_case_sensitive() {
        // 文件名检查大小写敏感（与旧版行为一致）
        assert!(!is_builtin_song("钢琴曲 - 番茄钟.MP3"));
        assert!(!is_builtin_song("钢琴曲 - 番茄钟.Mp3"));
    }

    #[test]
    fn test_update_source_parse_defaults_to_github() {
        assert_eq!(UpdateSource::parse(None), UpdateSource::Github);
        assert_eq!(UpdateSource::parse(Some("".into())), UpdateSource::Github);
        assert_eq!(UpdateSource::parse(Some("unknown".into())), UpdateSource::Github);
    }

    #[test]
    fn test_update_source_parse_server() {
        assert_eq!(UpdateSource::parse(Some("server".into())), UpdateSource::Server);
    }

    #[test]
    fn test_update_source_latest_json_url() {
        assert!(UpdateSource::Github
            .latest_json_url()
            .starts_with("https://github.com/"));
        assert!(UpdateSource::Server
            .latest_json_url()
            .starts_with("http://115.159.49.112/"));
    }

    #[test]
    fn test_is_newer_true_cases() {
        assert!(is_newer("4.5.15", "4.5.14"));
        assert!(is_newer("4.6.0", "4.5.99"));
        assert!(is_newer("5.0.0", "4.9.9"));
        assert!(is_newer("4.5.14.1", "4.5.14"));
    }

    #[test]
    fn test_is_newer_false_cases() {
        assert!(!is_newer("4.5.14", "4.5.15"));
        assert!(!is_newer("4.5.14", "4.5.14"));
        assert!(!is_newer("4.5.0", "4.6.0"));
        assert!(!is_newer("4.5", "4.5.1"));
    }

    #[test]
    fn test_is_newer_ignores_non_numeric() {
        // 前缀相同，非数字段忽略（按可解析数字逐位比较）
        assert!(is_newer("4.5.15-beta", "4.5.14"));
        assert!(!is_newer("4.5.14-beta", "4.5.14"));
    }

    #[test]
    fn test_is_newer_prerelease_beta_versus_release() {
        // v4.5.18 修复的语义化版本规则：
        // 4.6.0-beta.0 < 4.6.0（正式版发布后 beta 用户能升到正式版）
        assert!(is_newer("4.6.0", "4.6.0-beta.0"));
        assert!(!is_newer("4.6.0-beta.0", "4.6.0"));
        // beta 递增
        assert!(is_newer("4.6.0-beta.1", "4.6.0-beta.0"));
        assert!(!is_newer("4.6.0-beta.0", "4.6.0-beta.1"));
        // 新 minor 的 beta 仍比旧 release 新
        assert!(is_newer("4.6.0-beta.0", "4.5.17"));
        assert!(!is_newer("4.5.17", "4.6.0-beta.0"));
        // rc 同理
        assert!(is_newer("4.6.0-rc.1", "4.6.0-beta.0"));
        assert!(!is_newer("4.6.0-rc.1", "4.6.0"));
    }

    #[test]
    fn test_is_prerelease_detects_beta_alpha_rc() {
        assert!(is_prerelease("4.6.0-beta.0"));
        assert!(is_prerelease("4.6.0-beta.1"));
        assert!(is_prerelease("4.6.0-rc.1"));
        assert!(is_prerelease("4.6.0-alpha"));
    }

    #[test]
    fn test_is_prerelease_rejects_release_versions() {
        assert!(!is_prerelease("4.5.17"));
        assert!(!is_prerelease("4.6.0"));
        assert!(!is_prerelease("4.6.0.1"));
        assert!(!is_prerelease(""));
    }

    /// 构造 GitHub release（测试辅助）
    fn rel(tag: &str, draft: bool, has_asset: bool) -> GithubRelease {
        GithubRelease {
            tag_name: tag.to_string(),
            draft,
            assets: if has_asset {
                vec![GithubAsset {
                    name: "latest.json".to_string(),
                    browser_download_url: format!("https://example.com/{}/latest.json", tag),
                }]
            } else {
                vec![]
            },
        }
    }

    #[test]
    fn test_pick_best_release_prefers_highest_semver_including_prerelease() {
        // v4.5.19 修复：Beta 检测必须能选出版本号最大的 release（含 prerelease）。
        // 4.6.0-beta.0 > 4.5.18（新 minor 的 beta 仍比旧 release 新）。
        let releases = vec![
            rel("v4.5.18", false, true),
            rel("v4.6.0-beta.0", false, true),
            rel("v4.5.17", false, true),
        ];
        let best = pick_best_release_asset(&releases).unwrap();
        assert_eq!(best.0, "4.6.0-beta.0");
        assert_eq!(best.1, "https://example.com/v4.6.0-beta.0/latest.json");
    }

    #[test]
    fn test_pick_best_release_skips_draft_and_missing_asset() {
        let releases = vec![
            rel("v4.6.0-beta.0", true, true), // draft 跳过
            rel("v4.5.18", false, false),     // 无 latest.json 资产跳过
            rel("v4.5.17", false, true),
        ];
        let best = pick_best_release_asset(&releases).unwrap();
        assert_eq!(best.0, "4.5.17");
        assert!(pick_best_release_asset(&[]).is_none());
    }

    #[test]
    fn test_notice_in_range_filters_by_version() {
        fn notice(min: &str, max: &str) -> UpdateNotice {
            UpdateNotice {
                active: true,
                level: "warning".into(),
                text: "测试公告".into(),
                url: "http://example.com".into(),
                min_version: min.into(),
                max_version: max.into(),
            }
        }
        // min/max 空 = 不限
        assert!(notice_in_range(&notice("", ""), "4.5.20"));
        // 范围内
        assert!(notice_in_range(&notice("4.5.15", "4.5.19"), "4.5.17"));
        assert!(notice_in_range(&notice("4.5.15", "4.5.19"), "4.5.15"));
        assert!(notice_in_range(&notice("4.5.15", "4.5.19"), "4.5.19"));
        // 范围外
        assert!(!notice_in_range(&notice("4.5.15", "4.5.19"), "4.5.14"));
        assert!(!notice_in_range(&notice("4.5.15", "4.5.19"), "4.5.20"));
        // 只设一端
        assert!(notice_in_range(&notice("", "4.5.19"), "4.5.10"));
        assert!(!notice_in_range(&notice("", "4.5.19"), "4.5.20"));
        assert!(notice_in_range(&notice("4.5.15", ""), "4.5.21"));
        assert!(!notice_in_range(&notice("4.5.15", ""), "4.5.14"));
    }

    #[test]
    fn test_parse_pubkey_extracts_32_bytes() {
        // 使用 tauri.conf.json 中的真实公钥配置
        let pubkey = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDcwRUZERjE5RURCNTIxRkIKUldUN0liWHRHZC92Y0U1NnoxUXBGWFl1aG5BdVkwY2c4eHBEN1h5dm1qQlVLSzdmQWRWQmdqS3MK";
        let pk = parse_pubkey(pubkey).expect("应能解析出公钥");
        assert_eq!(pk.len(), 32);
        // v4.5.20 修复：公钥在 RWT 行解码后 [10..42]（"Ed" + key_id8 + 公钥32）。
        // 旧实现取 bytes[3..35] 得到垃圾公钥 → 真实签名永远验证失败。
        let hex: String = pk.iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(
            hex,
            "4e7acf542915762e86702e634720f31a43ed7caf9a305428aedf01d5418232ac",
            "公钥偏移错误会导致任何真实签名都无法通过验证"
        );
    }

    #[test]
    fn test_verify_installer_accepts_tauri_prehashed_signature() {
        // v4.5.20 修复：tauri 签名 = Ed25519(blake2b-512(文件))，minisign 文本格式
        let keypair = SigningKey::from_bytes(&[7u8; 32]);
        let data = b"fake installer content for unit test";
        let sig_b64 = make_tauri_prehashed_sig_b64(&keypair, data);
        let pubkey_b64 = make_pubkey_b64(&keypair);

        // 真实预哈希签名必须通过（此前旧实现永远失败）
        assert!(
            verify_installer(data, &sig_b64, &pubkey_b64),
            "tauri 预哈希签名应通过验证"
        );
        // 篡改文件内容 → 必须失败
        assert!(!verify_installer(b"tampered content", &sig_b64, &pubkey_b64));
        // 公钥不匹配 → 必须失败
        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert!(!verify_installer(data, &sig_b64, &make_pubkey_b64(&other)));
    }

    #[test]
    fn test_verify_installer_accepts_legacy_raw_signature() {
        // 兼容旧格式：裸 64 字节 Ed25519 直签文件内容的 base64
        let keypair = SigningKey::from_bytes(&[8u8; 32]);
        let data = b"raw signature test";
        let sig = keypair.sign(data);
        let sig_b64 = B64.encode(sig.to_bytes());
        let pk_b64 = make_pubkey_b64(&keypair);
        let pk = parse_pubkey(&pk_b64);
        let vk = pk.and_then(|p| VerifyingKey::from_bytes(&p).ok());
        assert!(vk.is_some(), "公钥应能解析并构造 VerifyingKey");
        assert!(verify_installer(data, &sig_b64, &pk_b64));
        assert!(!verify_installer(b"other", &sig_b64, &make_pubkey_b64(&keypair)));
    }

    #[test]
    fn test_parse_pubkey_rejects_invalid() {
        assert!(parse_pubkey("not base64 !!!").is_none());
        assert!(parse_pubkey("").is_none());
        // base64 有效但不是 minisign 文本
        assert!(parse_pubkey("aGVsbG8gd29ybGQ=").is_none());
    }

    #[test]
    fn test_verify_installer_rejects_tampered_data() {
        // 用真实公钥 + 伪造签名 → 必须验证失败（无真实私钥不可能通过）
        let pubkey = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDcwRUZERjE5RURCNTIxRkIKUldUN0liWHRHZC92Y0U1NnoxUXBGWFl1aG5BdVkwY2c4eHBEN1h5dm1qQlVLSzdmQWRWQmdqS3MK";
        let fake_sig = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
        assert!(!verify_installer(b"fake exe bytes", fake_sig, pubkey));
        // 非法 base64 签名
        assert!(!verify_installer(b"fake", "not-base64", pubkey));
    }

    /// v4.5.16 实际发布到 GitHub Release 的 latest.json（真实内容，防解析回归）。
    /// v4.5.16 的 `missing field 'url'` 崩溃就是解析不了这种 platforms 嵌套格式。
    const REAL_GITHUB_LATEST_JSON: &str = r#"{"version":"4.5.16","notes":"v4.5.16 紧急修复：v4.5.15 更新器插件 endpoints 含 http 端点导致应用启动即闪退（tauri-plugin-updater 初始化强制 https）。移除 http 端点、仅保留 https 占位，运行时更新源切换（GitHub/服务器）不受影响。","pub_date":"2026-08-03T14:39:15Z","platforms":{"windows-x86_64":{"url":"https://github.com/liaowenqi123/PomoSolo/releases/download/v4.5.16/PomoSolo_4.5.16_x64-setup.exe","signature":"dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUN0liWHRHZC92Y09tQU9sTEJjVWtyeWVXdW9yMFA2N3pZZzNBTFRiSVRNTGlvYkpCcFZVTGJyMkZ0bmx2Qm9xQ2lkeTJENUM2NURNWU42eFJhbnNYQXBodkxLTjJBbkFNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg1NzY3OTE5CWZpbGU6UG9tb1NvbG9fNC41LjE2X3g2NC1zZXR1cC5leGUKcllQa3BtaGsrMlhwV0ttN1dJK1RXM3RQUzF3OG9iUkorRk13bDJCMjZFTmJieEFFTzlucS82RTU1QkxRVU8vTjhaRnlreC9Qa3NNY2dDKzZXaHlHRFE9PQo="}}}"#;

    /// v4.5.16 实际发布到服务器 /updates/ 的 latest.json（url 指向服务器）
    const REAL_SERVER_LATEST_JSON: &str = r#"{"version":"4.5.16","notes":"v4.5.16 紧急修复：v4.5.15 更新器插件 endpoints 含 http 端点导致应用启动即闪退（tauri-plugin-updater 初始化强制 https）。移除 http 端点、仅保留 https 占位，运行时更新源切换（GitHub/服务器）不受影响。","pub_date":"2026-08-03T14:39:15Z","platforms":{"windows-x86_64":{"url":"http://115.159.49.112/updates/PomoSolo_4.5.16_x64-setup.exe","signature":"dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUN0liWHRHZC92Y09tQU9sTEJjVWtyeWVXdW9yMFA2N3pZZzNBTFRiSVRNTGlvYkpCcFZVTGJyMkZ0bmx2Qm9xQ2lkeTJENUM2NURNWU42eFJhbnNYQXBodkxLTjJBbkFNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg1NzY3OTE5CWZpbGU6UG9tb1NvbG9fNC41LjE2X3g2NC1zZXR1cC5leGUKcllQa3BtaGsrMlhwV0ttN1dJK1RXM3RQUzF3OG9iUkorRk13bDJCMjZFTmJieEFFTzlucS82RTU1QkxRVU8vTjhaRnlreC9Qa3NNY2dDKzZXaHlHRFE9PQo="}}}"#;

    #[test]
    fn test_parse_real_github_latest_json() {
        let j: LatestJson = serde_json::from_str(REAL_GITHUB_LATEST_JSON)
            .expect("真实 GitHub latest.json 必须能解析（v4.5.16 曾在此崩溃）");
        assert_eq!(j.version, "4.5.16");
        let p = j.windows_platform().expect("windows-x86_64 平台必须存在");
        assert!(p.url.starts_with("https://github.com/"));
        assert!(!p.signature.is_empty());
        assert_eq!(p.signature.len(), 420);
    }

    #[test]
    fn test_parse_real_server_latest_json() {
        let j: LatestJson = serde_json::from_str(REAL_SERVER_LATEST_JSON)
            .expect("真实服务器 latest.json 必须能解析");
        assert_eq!(j.version, "4.5.16");
        let p = j.windows_platform().unwrap();
        assert!(p.url.starts_with("http://115.159.49.112/updates/"));
        assert_eq!(p.signature.len(), 420);
    }

    #[test]
    fn test_windows_platform_missing_returns_error() {
        // platforms 为空或只有其他平台时，必须给出明确错误而不是 panic
        let j: LatestJson =
            serde_json::from_str(r#"{"version":"1.0.0","platforms":{}}"#).unwrap();
        assert!(j.windows_platform().is_err());
        let j2: LatestJson = serde_json::from_str(
            r#"{"version":"1.0.0","platforms":{"linux-x86_64":{"url":"u","signature":"s"}}}"#,
        )
        .unwrap();
        assert!(j2.windows_platform().is_err());
    }
}

/// 将内置歌曲与历史备份合并到用户音乐目录（app_data_dir/music）
///
/// 在应用启动时调用（setup 钩子），替代 restore_music_dir。
///
/// 设计：运行时音乐目录与安装目录分离 —— 用户下载的歌曲放在
/// `app_data_dir/music`，安装/更新包永远只覆盖安装目录（resource_dir），
/// 不会碰到用户音乐。各来源的歌曲合并过去，规则为**不覆盖已有同名文件**：
///
/// 1. `resource_dir/resources/music`：安装包内置歌曲（Tauri resources 打包位置，全新安装时存在）
/// 2. `resource_dir/music`：老版本（4.4.x）遗留的用户音乐目录（升级场景迁移）
/// 3. `backup/music`：更新前备份的老版本用户歌曲（老版本 → 新版本迁移）
pub fn merge_music_dir(app: &AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    let target = app_data_dir.join("music");
    fs::create_dir_all(&target).map_err(|e| format!("创建用户音乐目录失败: {}", e))?;

    let mut merged = 0;

    // 来源 1：安装包内置歌曲（resource_dir/resources/music）+ 老版本遗留目录（resource_dir/music）
    if let Ok(resource_dir) = app.path().resource_dir() {
        let mut builtin_srcs = Vec::new();
        // Tauri resources 打包位置（4.5.0+）：resources/music/
        let packed = resource_dir.join("resources").join("music");
        if packed.exists() {
            builtin_srcs.push(packed);
        }
        // 老版本（4.4.x）遗留的用户音乐目录（升级时一并迁移）
        let legacy = resource_dir.join("music");
        if legacy.exists() {
            builtin_srcs.push(legacy);
        }
        for src in builtin_srcs {
            for entry in fs::read_dir(&src).map_err(|e| format!("读取内置音乐失败: {}", e))? {
                let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
                let filename = entry.file_name();
                let dest = target.join(&filename);
                // 不覆盖用户已有的歌曲（含用户自定义的同名文件）
                if dest.exists() {
                    continue;
                }
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        fs::copy(entry.path(), &dest)
                            .map_err(|e| format!("复制内置歌曲失败: {}", e))?;
                        merged += 1;
                    }
                }
            }
        }
    }

    // 来源 2：更新前备份的老版本用户歌曲（backup/music），合并后删除备份
    let backup_dir = get_backup_base_dir(app)?.join("backup").join("music");
    if backup_dir.exists() {
        for entry in fs::read_dir(&backup_dir).map_err(|e| format!("读取备份失败: {}", e))? {
            let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
            let filename = entry.file_name();
            let dest = target.join(&filename);
            if dest.exists() {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    fs::copy(entry.path(), &dest).map_err(|e| format!("迁移备份歌曲失败: {}", e))?;
                    merged += 1;
                }
            }
        }
        let _ = fs::remove_dir_all(&backup_dir);
    }

    eprintln!("[updater] 已合并 {} 个音乐文件到用户目录 {:?}", merged, target);
    Ok(())
}
