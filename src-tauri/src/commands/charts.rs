//! 音乐榜单 commands
//!
//! 对应 Electron 旧版 src/modules/chartsFetcher.js + main/ipc-music.js 中的
//! `charts-fetch`、`download-song`、`download-status` 三个 IPC handler。
//!
//! 前端通过 src/api/charts.ts 调用：
//! - charts_fetch(source) -> 热歌榜（网易云 / QQ音乐）
//! - download_song(title, artist) -> 调用纯 Rust 下载器（B站搜索 + DeepSeek + DASH + ffmpeg）
//! - get_download_status -> 下载队列状态

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::{ChartsState, MusicState};

// ===== 通用 HTTP 请求 =====

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// 抓取 URL 内容，返回字符串。最多跟随 3 次重定向。
async fn fetch_text(url: &str, referer: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(url)
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .header("Referer", referer)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    resp.text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))
}

// ===== 通用解析辅助 =====

/// 按 key 顺序取第一个字符串字段值；都缺失时返回默认值
fn first_string(song: &Value, keys: &[&str], default: &str) -> String {
    for key in keys {
        if let Some(v) = song.get(*key).and_then(|v| v.as_str()) {
            return v.to_string();
        }
    }
    default.to_string()
}

/// 提取歌手名：优先 artists/singer 数组（join " / "），兜底 authorName 字符串
fn extract_artist(song: &Value) -> String {
    for key in ["artists", "singer"] {
        if let Some(arr) = song.get(key).and_then(|v| v.as_array()) {
            let names: Vec<&str> = arr
                .iter()
                .filter_map(|a| a.get("name").and_then(|n| n.as_str()))
                .collect();
            if !names.is_empty() {
                return names.join(" / ");
            }
        }
    }
    first_string(song, &["authorName"], "")
}

/// 提取专辑名：优先 album.name（嵌套），兜底 albumname/albumName 字符串
fn extract_album(song: &Value) -> String {
    if let Some(n) = song
        .get("album")
        .and_then(|v| v.get("name"))
        .and_then(|v| v.as_str())
    {
        return n.to_string();
    }
    first_string(song, &["albumname", "albumName"], "")
}

/// 歌曲列表 → 榜单条目（前 10 首）。兼容各接口字段差异：
/// 网易云（name/artists/album.name）、QQ（songname|title/singer/albumname）。
fn to_chart_songs(songs: &[Value]) -> Vec<Value> {
    songs
        .iter()
        .take(10)
        .enumerate()
        .map(|(i, item)| {
            let song = item.get("data").unwrap_or(item);
            json!({
                "rank": i + 1,
                "title": first_string(song, &["name", "title", "songname"], "未知歌曲"),
                "artist": extract_artist(song),
                "album": extract_album(song),
            })
        })
        .collect()
}

/// 主接口失败 → 备用接口的降级抓取（打日志，都失败返回空列表）
async fn fetch_with_fallback(
    primary: impl std::future::Future<Output = Result<Vec<Value>, String>>,
    backup: impl std::future::Future<Output = Result<Vec<Value>, String>>,
    label: &str,
) -> Vec<Value> {
    match primary.await {
        Ok(songs) => return songs,
        Err(e) => eprintln!("[Charts] {}主接口失败: {}", label, e),
    }
    match backup.await {
        Ok(songs) => songs,
        Err(e) => {
            eprintln!("[Charts] {}备用接口失败: {}", label, e);
            Vec::new()
        }
    }
}

// ===== 网易云热歌榜 =====

/// 抓取网易云音乐热歌榜（榜单 ID: 3778678）
async fn fetch_netease_hot() -> Vec<Value> {
    fetch_with_fallback(fetch_netease_primary(), fetch_netease_backup(), "网易云").await
}

async fn fetch_netease_primary() -> Result<Vec<Value>, String> {
    let url = "https://music.163.com/api/playlist/detail?id=3778678";
    let body = fetch_text(url, "https://music.163.com/").await?;
    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let tracks = json
        .get("result")
        .and_then(|v| v.get("tracks"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(to_chart_songs(&tracks))
}

async fn fetch_netease_backup() -> Result<Vec<Value>, String> {
    let url = "https://music.163.com/discover/toplist?id=3778678";
    let html = fetch_text(url, "https://music.163.com/").await?;

    // 尝试从 HTML 中提取 song-list-pre-data
    if let Some(start) = html.find("id=\"song-list-pre-data\"") {
        if let Some(content_start) = html[start..].find('>') {
            let rest = &html[start + content_start + 1..];
            if let Some(end) = rest.find("</textarea>") {
                let raw = &rest[..end];
                let decoded = urldecode(raw);
                if let Ok(songs) = serde_json::from_str::<Vec<Value>>(&decoded) {
                    return Ok(to_chart_songs(&songs));
                }
            }
        }
    }

    Err("无法解析 HTML".to_string())
}

/// 简易 URL 解码（百分号编码 -> 字符）
fn urldecode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""),
                16,
            ) {
                result.push(b as char);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            result.push(' ');
        } else {
            result.push(bytes[i] as char);
        }
        i += 1;
    }
    result
}

// ===== QQ音乐热歌榜 =====

async fn fetch_qq_hot() -> Vec<Value> {
    fetch_with_fallback(fetch_qq_primary(), fetch_qq_backup(), "QQ").await
}

async fn fetch_qq_primary() -> Result<Vec<Value>, String> {
    let url = "https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=27&needNewCode=1&uin=0&format=json&platform=h5&tpl=3&page=detail&type=top&song_begin=0&song_num=10";
    let body = fetch_text(url, "https://y.qq.com/").await?;
    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let songs = json
        .get("songlist")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(to_chart_songs(&songs))
}

async fn fetch_qq_backup() -> Result<Vec<Value>, String> {
    let url = "https://u.y.qq.com/cgi-bin/musicu.fcg?data=%7B%22topList%22%3A%7B%22module%22%3A%22musicToplist.ToplistInfoServer%22%2C%22method%22%3A%22GetDetail%22%2C%22param%22%3A%7B%22topid%22%3A27%2C%22num%22%3A10%2C%22period%22%3A%222026-03-30%22%7D%7D%7D";
    let body = fetch_text(url, "https://y.qq.com/").await?;
    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let songs = json
        .get("topList")
        .and_then(|v| v.get("data"))
        .and_then(|v| v.get("data"))
        .and_then(|v| v.get("songInfoList"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(to_chart_songs(&songs))
}

// ===== Tauri Commands =====

/// 获取热歌榜单
///
/// 对应 Electron `charts-fetch` IPC handler。
/// source: "netease" | "qq"
#[tauri::command]
pub async fn charts_fetch(app: AppHandle, source: String) -> Result<Value, String> {
    // 触发音乐子进程启动（用户可能在没启动过音乐播放器时直接打开榜单）
    let _ = app.state::<MusicState>();

    let songs = if source == "qq" {
        fetch_qq_hot().await
    } else {
        fetch_netease_hot().await
    };

    if songs.is_empty() {
        return Ok(json!({
            "success": false,
            "error": "获取榜单失败，请稍后重试"
        }));
    }

    Ok(json!({
        "success": true,
        "songs": songs
    }))
}

/// 下载歌曲
///
/// 对应 Electron `download-song` IPC handler。
/// 调用纯 Rust 下载器（B站搜索 + DeepSeek 选片 + DASH 音频流下载 + ffmpeg 转码），
/// 串行执行（用 Mutex 保证一次只下载一首）。
#[tauri::command]
pub async fn download_song(
    app: AppHandle,
    title: String,
    artist: String,
) -> Result<Value, String> {
    let charts_state = app.state::<ChartsState>();

    // 检查 API Key
    let api_key = {
        let guard = charts_state.inner.lock().await;
        match guard.api_key.clone() {
            Some(k) if !k.is_empty() => k,
            _ => {
                return Ok(json!({
                    "success": false,
                    "error": "请先登录或配置 DeepSeek API Key"
                }));
            }
        }
    };

    // 标记开始下载（设置 current_song）
    {
        let mut guard = charts_state.inner.lock().await;
        guard.is_downloading = true;
        guard.current_song = Some(crate::state::CurrentSong {
            title: title.clone(),
            artist: artist.clone(),
        });
    }

    // 计算 music 目录路径与完整歌曲名
    let song_name = build_song_name(&title, &artist);
    let music_dir = match get_music_dir(&app) {
        Ok(p) => p,
        Err(e) => {
            let mut guard = charts_state.inner.lock().await;
            guard.is_downloading = false;
            guard.current_song = None;
            return Ok(json!({
                "success": false,
                "status": "failed",
                "error": e
            }));
        }
    };

    // 执行下载（纯 Rust 实现，替代 manual_downloader.exe + you-get）
    let dl_result = match crate::modules::downloader::download_song(
        &app,
        &song_name,
        &api_key,
        &music_dir,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => crate::modules::downloader::DownloadResult {
            success: false,
            status: "failed".to_string(),
            error: Some(e),
        },
    };

    // 清除下载状态
    {
        let mut guard = charts_state.inner.lock().await;
        guard.is_downloading = false;
        guard.current_song = None;
    }

    // 转换为前端期望的 JSON
    Ok(serde_json::to_value(&dl_result).unwrap_or_else(|_| {
        json!({
            "success": false,
            "status": "failed",
            "error": "序列化下载结果失败"
        })
    }))
}

/// 一键预处理所有已下载歌曲：统一响度（RMS 归一化）
///
/// 兼容旧版本下载的、尚未做响度归一化的 mp3/m4a：
/// 遍历 music 目录，逐首 decode → 响度归一化 → 重新编码为 mp3（192kbps）。
/// 通过 `preprocess-progress` 事件向前端报告进度（current/total/name）。
#[tauri::command]
pub async fn preprocess_all_songs(app: AppHandle) -> Result<Value, String> {
    let music_dir = get_music_dir(&app)?;

    let mut files: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(&music_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ext == "mp3" || ext == "m4a" {
                files.push(path);
            }
        }
    }

    let total = files.len();
    let mut processed = 0usize;
    let mut failed = 0usize;

    for (i, file) in files.iter().enumerate() {
        let name = file
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let _ = app.emit(
            "preprocess-progress",
            json!({ "current": i + 1, "total": total, "name": name }),
        );

        let target = file.with_extension("mp3");
        // m4a 且已有同名 mp3 时跳过，避免覆盖
        if target != *file && target.exists() {
            eprintln!("[Preprocess] 跳过 {}：已存在同名 mp3", name);
            continue;
        }

        let tmp = file.with_extension("preprocess.tmp");
        match crate::modules::downloader::normalize_audio_to_mp3(file, &tmp) {
            Ok(()) => {
                if target != *file {
                    let _ = fs::remove_file(file);
                }
                match fs::rename(&tmp, &target) {
                    Ok(()) => processed += 1,
                    Err(e) => {
                        eprintln!("[Preprocess] 替换文件失败 {}: {}", name, e);
                        let _ = fs::remove_file(&tmp);
                        failed += 1;
                    }
                }
            }
            Err(e) => {
                eprintln!("[Preprocess] 预处理失败 {}: {}", name, e);
                let _ = fs::remove_file(&tmp);
                failed += 1;
            }
        }
    }

    let _ = app.emit(
        "preprocess-progress",
        json!({ "current": total, "total": total, "name": "", "done": true }),
    );

    Ok(json!({
        "success": true,
        "processed": processed,
        "failed": failed,
        "total": total
    }))
}

/// 获取下载状态
///
/// 对应 Electron `download-status` IPC handler。
#[tauri::command]
pub async fn get_download_status(app: AppHandle) -> Result<Value, String> {
    let charts_state = app.state::<ChartsState>();
    let guard = charts_state.inner.lock().await;

    Ok(json!({
        "isDownloading": guard.is_downloading,
        "currentSong": guard.current_song.as_ref().map(|s| {
            json!({
                "title": s.title,
                "artist": s.artist
            })
        }),
        "queueLength": 0usize
    }))
}

/// 注入 API Key 到 ChartsState 内存
///
/// 修复 docs/modules/cloud-and-charts.md 4.6 节 Bug：`save_api_key` 只写 `data.json`，
/// 不同步 `ChartsState.inner.api_key`，导致 `download_song` 始终返回"请先登录或配置 DeepSeek API Key"。
///
/// 由前端在 `save_api_key` / `cloud_login` 成功后主动调用，把 API Key 注入内存。
/// 传空串则清空内存中的 Key。
#[tauri::command]
pub async fn charts_set_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    let charts_state = app.state::<ChartsState>();
    let mut guard = charts_state.inner.lock().await;
    guard.api_key = if api_key.is_empty() {
        None
    } else {
        Some(api_key)
    };
    Ok(())
}

// ===== 下载器辅助 =====

#[derive(Clone)]
pub struct DownloadTask {
    pub title: String,
    pub artist: String,
    pub song_name: String,
}

/// 获取 music 目录路径（music-player/music/）
///
/// debug 模式：CARGO_MANIFEST_DIR/../music-player/music/
/// release 模式：app_data_dir()/music/（用户数据区，与 music.rs 一致）
fn get_music_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let path = PathBuf::from(manifest_dir)
            .parent()
            .ok_or("无法定位项目根目录")?
            .join("music-player")
            .join("music");
        Ok(path)
    } else {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
        Ok(app_data_dir.join("music"))
    }
}

/// 拼接歌曲文件名：title 不为空且 artist 不为空 → "title - artist"，否则返回 title
fn build_song_name(title: &str, artist: &str) -> String {
    if artist.is_empty() {
        title.to_string()
    } else {
        format!("{} - {}", title, artist)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ===== urldecode =====

    #[test]
    fn test_urldecode_plain_ascii_unchanged() {
        // 纯 ASCII 文本应原样返回
        assert_eq!(urldecode("hello world"), "hello world");
        assert_eq!(urldecode("ABC123"), "ABC123");
    }

    #[test]
    fn test_urldecode_percent_encoded_ascii() {
        // %20 = 空格
        assert_eq!(urldecode("hello%20world"), "hello world");
        // %41 = 'A'
        assert_eq!(urldecode("%41%42%43"), "ABC");
    }

    #[test]
    fn test_urldecode_plus_to_space() {
        assert_eq!(urldecode("hello+world"), "hello world");
        // 混合 + 与 %20
        assert_eq!(urldecode("a+b%20c"), "a b c");
    }

    #[test]
    fn test_urldecode_handles_incomplete_percent() {
        // % 后不足 2 字符时应保留原字符
        assert_eq!(urldecode("100%"), "100%");
        assert_eq!(urldecode("50%2"), "50%2");
    }

    #[test]
    fn test_urldecode_handles_invalid_hex() {
        // %GG 不是合法十六进制，应保留 %
        assert_eq!(urldecode("foo%GGbar"), "foo%GGbar");
    }

    #[test]
    fn test_urldecode_empty_string() {
        assert_eq!(urldecode(""), "");
    }

    #[test]
    fn test_urldecode_mixed_encoding() {
        // 实际网易云 API 返回的 song-list-pre-data 包含 %2C 等编码
        assert_eq!(urldecode("a%2Cb%2Cc"), "a,b,c");
    }

    // ===== build_song_name =====

    #[test]
    fn test_build_song_name_with_artist() {
        assert_eq!(build_song_name("稻香", "周杰伦"), "稻香 - 周杰伦");
    }

    #[test]
    fn test_build_song_name_without_artist() {
        assert_eq!(build_song_name("纯音乐", ""), "纯音乐");
    }

    #[test]
    fn test_build_song_name_empty_both() {
        assert_eq!(build_song_name("", ""), "");
    }

    #[test]
    fn test_build_song_name_empty_title_with_artist() {
        // artist 非空但 title 空 → " - artist"（保持原逻辑，不做特殊处理）
        assert_eq!(build_song_name("", "周杰伦"), " - 周杰伦");
    }
}
