//! 纯 Rust 音乐下载器
//!
//! 替代 Python manual_downloader.py + you-get：
//! - B站搜索 API（reqwest）
//! - DeepSeek 选片（reqwest）
//! - DASH 音频流直下载（跳过视频流，仅下载音频）
//! - ffmpeg 转码 m4a → mp3
//!
//! 参考：music-player/manual_downloader.py

use regex::Regex;
use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEEPSEEK_SYSTEM_PROMPT: &str = "你是纯音乐视频判断器。我会给你6个B站视频标题，你需要选出最像是纯音乐/原版音乐的视频编号。\n\n判断标准：\n**优先选择**（是纯音乐/原版）：\n- 标题包含\"无损\"、\"Hi-Res\"、\"FLAC\"、\"24bit\"、\"[音乐]\"、\"纯享版\"、\"官方\"等\n- \"百万录音棚\"系列\n- 只有音乐和画面，没有额外解说或人声干扰\n\n**排除**（不是纯音乐或者出现修改或者出现重复循环）：\n- 标题包含\"AI翻唱\"、\"教程\"、\"钢琴教学\"、\"吉他教学\"、\"cover\"、\"翻唱\"、\"反应\"、\"解说\"\n- 有升key、降key、倍速修改（如\"1.5倍速\"、\"+2key\"）\n- 有明显的人声互动或评论\n- 单曲循环、单曲循环1h（可能循环多次）\n\n**回复格式**：\n- 只回复一个数字 1-6（最符合条件的视频编号）\n- 如果没有一个是纯音乐，回复 None\n- 不要有任何其他内容";

/// B站视频搜索结果
#[derive(Debug, Clone, Serialize)]
pub struct BiliVideo {
    pub bvid: String,
    pub aid: i64,
    /// 已清洗 HTML 标签的标题
    pub title: String,
    pub author: String,
    pub url: String,
}

/// 下载结果（对应前端期望的 JSON 结构）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub success: bool,
    /// "downloaded" / "exists" / "no_video" / "no_instrumental" / "failed"
    pub status: String,
    pub error: Option<String>,
}

impl DownloadResult {
    fn ok(status: &str) -> Self {
        Self {
            success: true,
            status: status.to_string(),
            error: None,
        }
    }

    fn fail(status: &str, error: &str) -> Self {
        Self {
            success: false,
            status: status.to_string(),
            error: Some(error.to_string()),
        }
    }
}

// ===== 辅助函数 =====

/// 清洗标题中的 HTML 标签（<em class="keyword">...</em> 等）与多余空白
fn clean_title(title: &str) -> String {
    let re_html = Regex::new(r"<[^>]+>").unwrap();
    let re_space = Regex::new(r"\s+").unwrap();
    let s = re_html.replace_all(title, "");
    let s = re_space.replace_all(&s, " ");
    s.trim().to_string()
}

/// 清洗文件名中的非法字符（Windows 不允许的字符）
fn clean_filename(name: &str) -> String {
    let re = Regex::new(r#"[<>:"/\\|?*]"#).unwrap();
    re.replace_all(name, "").to_string()
}

/// 构建复用的 HTTP 客户端（不带 Cookie，Cookie 在每个请求中单独添加）
fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))
}

/// 加载 Netscape 格式的 Cookie 文件，返回 "name=value; name2=value2" 格式
fn load_cookie_file(cookie_file: &Path) -> String {
    let content = match fs::read_to_string(cookie_file) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    let mut cookies: Vec<String> = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // Netscape cookie 格式：tab 分隔，第 6 字段是 name，第 7 字段是 value
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 7 {
            cookies.push(format!("{}={}", parts[5], parts[6]));
        }
    }
    cookies.join("; ")
}

/// 获取 ffmpeg.exe 路径
/// debug 模式从 CARGO_MANIFEST_DIR/../music-player/ffmpeg.exe
/// release 从 resource_dir()/ffmpeg.exe
fn get_ffmpeg_path(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let path = PathBuf::from(manifest_dir)
            .parent()
            .ok_or("无法定位项目根目录")?
            .join("music-player")
            .join("ffmpeg.exe");
        if path.exists() {
            Ok(path)
        } else {
            Err(format!("未找到 ffmpeg.exe: {:?}", path))
        }
    } else {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("无法获取资源目录: {}", e))?;
        let path = resource_dir.join("ffmpeg.exe");
        if path.exists() {
            Ok(path)
        } else {
            Err(format!("未找到 ffmpeg.exe: {:?}", path))
        }
    }
}

/// 检查 music 目录是否已存在同名 mp3（文件名包含歌名即视为已存在，忽略大小写）
fn find_existing_mp3(music_dir: &Path, song_name: &str) -> bool {
    let entries = match fs::read_dir(music_dir) {
        Ok(e) => e,
        Err(_) => return false,
    };
    let target = song_name.to_lowercase();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("mp3") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if stem.contains(&target) {
            return true;
        }
    }
    false
}

// ===== 核心功能 =====

/// B站搜索视频
///
/// GET https://api.bilibili.com/x/web-interface/search/type
/// 返回前 6 个结果。任何失败均返回空 Vec（与 Python 行为一致）。
pub async fn search_bilibili(keyword: &str, cookie: &str) -> Result<Vec<BiliVideo>, String> {
    let client = build_client()?;

    let mut req = client
        .get("https://api.bilibili.com/x/web-interface/search/type")
        .query(&[
            ("search_type", "video"),
            ("keyword", keyword),
            ("page", "1"),
            ("pagesize", "6"),
        ])
        .header("Referer", "https://www.bilibili.com/")
        .header("Accept-Language", "zh-CN,zh;q=0.9");
    if !cookie.is_empty() {
        req = req.header("Cookie", cookie);
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[Downloader] B站搜索请求失败: {}", e);
            return Ok(Vec::new());
        }
    };

    if !resp.status().is_success() {
        eprintln!("[Downloader] B站搜索 HTTP {}", resp.status());
        return Ok(Vec::new());
    }

    let body = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[Downloader] 读取搜索响应失败: {}", e);
            return Ok(Vec::new());
        }
    };

    if body.trim().is_empty() {
        eprintln!("[Downloader] B站搜索返回空响应");
        return Ok(Vec::new());
    }

    let data: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[Downloader] 解析搜索 JSON 失败: {}", e);
            return Ok(Vec::new());
        }
    };

    if data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        let msg = data
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        eprintln!("[Downloader] B站搜索 API 错误: {}", msg);
        return Ok(Vec::new());
    }

    let result_arr = data
        .get("data")
        .and_then(|d| d.get("result"))
        .and_then(|r| r.as_array());

    let videos = match result_arr {
        Some(arr) => arr,
        None => return Ok(Vec::new()),
    };

    let mut out: Vec<BiliVideo> = Vec::new();
    for item in videos.iter().take(6) {
        let bvid = item
            .get("bvid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let aid = item.get("aid").and_then(|v| v.as_i64()).unwrap_or(0);
        if bvid.is_empty() && aid == 0 {
            continue;
        }
        let raw_title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let title = clean_title(raw_title);
        let author = item
            .get("author")
            .and_then(|v| v.as_str())
            .or_else(|| {
                item.get("owner")
                    .and_then(|o| o.get("name"))
                    .and_then(|v| v.as_str())
            })
            .unwrap_or("")
            .to_string();
        let url = if !bvid.is_empty() {
            format!("https://www.bilibili.com/video/{}", bvid)
        } else {
            format!("https://www.bilibili.com/video/av{}", aid)
        };
        out.push(BiliVideo {
            bvid,
            aid,
            title,
            author,
            url,
        });
    }

    Ok(out)
}

/// DeepSeek 选片
///
/// POST https://api.deepseek.com/chat/completions
/// 返回 Ok(None) 表示没有符合条件的视频，Ok(Some(idx)) 表示选中索引（0-based）。
/// API 调用失败返回 Err。
pub async fn deepseek_select(videos: &[BiliVideo], api_key: &str) -> Result<Option<usize>, String> {
    if videos.is_empty() {
        return Ok(None);
    }

    // 取前 6 个，构造编号列表
    let titles_text = videos
        .iter()
        .take(6)
        .enumerate()
        .map(|(i, v)| format!("{}. {}", i + 1, v.title))
        .collect::<Vec<_>>()
        .join("\n");

    let user_prompt = format!(
        "以下是6个视频标题，请选出最像纯音乐的一个：\n\n{}",
        titles_text
    );

    let client = build_client()?;
    let resp = client
        .post("https://api.deepseek.com/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&json!({
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": DEEPSEEK_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0
        }))
        .send()
        .await
        .map_err(|e| format!("DeepSeek API 请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("DeepSeek API HTTP {}: {}", status, text));
    }

    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 DeepSeek 响应失败: {}", e))?;

    let content = data
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    eprintln!("[Downloader] DeepSeek 选择: {}", content);

    // "none" → 没有符合条件的
    if content.eq_ignore_ascii_case("none") {
        return Ok(None);
    }

    // 解析数字 1-6
    let re = Regex::new(r"\b([1-6])\b").unwrap();
    if let Some(caps) = re.captures(&content) {
        if let Ok(n) = caps[1].parse::<usize>() {
            if n >= 1 && n <= videos.len() {
                return Ok(Some(n - 1));
            }
        }
    }

    eprintln!("[Downloader] 无法解析 DeepSeek 响应: {}", content);
    Ok(None)
}

/// 获取 DASH 音频流 URL
///
/// 1. GET view 接口取 cid
/// 2. GET playurl 接口取 data.dash.audio[]，选 bandwidth 最大的音频流
pub async fn get_dash_audio_url(
    bvid: &str,
    cookie: &str,
    client: &Client,
) -> Result<String, String> {
    if bvid.is_empty() {
        return Err("bvid 为空".to_string());
    }

    // 1. 获取 cid
    let mut view_req = client
        .get("https://api.bilibili.com/x/web-interface/view")
        .query(&[("bvid", bvid)])
        .header("Referer", "https://www.bilibili.com/");
    if !cookie.is_empty() {
        view_req = view_req.header("Cookie", cookie);
    }
    let view_resp = view_req.send().await.map_err(|e| format!("view 请求失败: {}", e))?;

    if !view_resp.status().is_success() {
        return Err(format!("view 接口 HTTP {}", view_resp.status()));
    }

    let view_data: Value = view_resp
        .json()
        .await
        .map_err(|e| format!("解析 view 响应失败: {}", e))?;

    if view_data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        let msg = view_data
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        return Err(format!("view 接口错误: {}", msg));
    }

    let cid = view_data
        .get("data")
        .and_then(|d| d.get("cid"))
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "无法获取 cid".to_string())?;

    // 2. 获取 DASH 播放地址
    let mut play_req = client
        .get("https://api.bilibili.com/x/player/playurl")
        .query(&[
            ("bvid", bvid),
            ("cid", &cid.to_string()),
            ("fnval", "16"),
            ("qn", "64"),
        ])
        .header("Referer", "https://www.bilibili.com/");
    if !cookie.is_empty() {
        play_req = play_req.header("Cookie", cookie);
    }
    let play_resp = play_req.send().await.map_err(|e| format!("playurl 请求失败: {}", e))?;

    if !play_resp.status().is_success() {
        return Err(format!("playurl 接口 HTTP {}", play_resp.status()));
    }

    let play_data: Value = play_resp
        .json()
        .await
        .map_err(|e| format!("解析 playurl 响应失败: {}", e))?;

    if play_data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        let msg = play_data
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        return Err(format!("playurl 接口错误: {}", msg));
    }

    // 3. 选 bandwidth 最大的音频流
    let audio_arr = play_data
        .get("data")
        .and_then(|d| d.get("dash"))
        .and_then(|d| d.get("audio"))
        .and_then(|a| a.as_array())
        .ok_or_else(|| "无 DASH 音频流".to_string())?;

    let mut best_url: Option<String> = None;
    let mut best_bw: i64 = -1;
    for stream in audio_arr {
        let bw = stream.get("bandwidth").and_then(|v| v.as_i64()).unwrap_or(0);
        if bw > best_bw {
            if let Some(base) = stream.get("base_url").and_then(|v| v.as_str()) {
                if !base.is_empty() {
                    best_bw = bw;
                    best_url = Some(base.to_string());
                }
            }
        }
    }

    best_url.ok_or_else(|| "未找到可用的音频流 URL".to_string())
}

/// 下载音频流到文件
///
/// GET url with Referer header → 写入文件
pub async fn download_audio_stream(
    url: &str,
    client: &Client,
    output_path: &Path,
) -> Result<(), String> {
    let resp = client
        .get(url)
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await
        .map_err(|e| format!("下载音频流请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("下载音频流 HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取音频流数据失败: {}", e))?;

    if bytes.is_empty() {
        return Err("音频流数据为空".to_string());
    }

    // 确保父目录存在
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    fs::write(output_path, &bytes).map_err(|e| format!("写入音频文件失败: {}", e))?;

    Ok(())
}

/// ffmpeg 转码 m4a → mp3
pub async fn convert_to_mp3(
    input: &Path,
    output: &Path,
    ffmpeg_path: &Path,
) -> Result<(), String> {
    let result = tokio::process::Command::new(ffmpeg_path)
        .arg("-y")
        .arg("-i")
        .arg(input)
        .arg("-vn")
        .arg("-acodec")
        .arg("libmp3lame")
        .arg("-q:a")
        .arg("2")
        .arg(output)
        .output()
        .await
        .map_err(|e| format!("启动 ffmpeg 失败: {}", e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let tail = if stderr.len() > 400 {
            &stderr[stderr.len() - 400..]
        } else {
            &stderr
        };
        return Err(format!("ffmpeg 转换失败: {}", tail));
    }

    Ok(())
}

/// 完整下载编排
///
/// 1. 检查 music/ 目录是否已存在同名 mp3
/// 2. 加载 bilibili_cookies.txt（如果存在）
/// 3. search_bilibili(song_name)
/// 4. deepseek_select(videos, api_key)
/// 5. get_dash_audio_url(bvid)
/// 6. download_audio_stream → temp.m4a
/// 7. convert_to_mp3 temp.m4a → music/song_name.mp3
/// 8. 删除 temp.m4a
pub async fn download_song(
    app: &AppHandle,
    song_name: &str,
    api_key: &str,
    music_dir: &Path,
) -> Result<DownloadResult, String> {
    let clean_name = clean_filename(song_name);

    // 1. 检查是否已存在
    if find_existing_mp3(music_dir, &clean_name) {
        return Ok(DownloadResult::ok("exists"));
    }

    // 确保 music 目录存在
    fs::create_dir_all(music_dir).map_err(|e| format!("创建 music 目录失败: {}", e))?;

    // 2. 加载 Cookie
    let cookie_file = music_dir
        .parent()
        .map(|p| p.join("bilibili_cookies.txt"))
        .unwrap_or_else(|| music_dir.join("bilibili_cookies.txt"));
    let cookie = load_cookie_file(&cookie_file);

    // 3. B站搜索
    let videos = search_bilibili(song_name, &cookie).await?;
    if videos.is_empty() {
        return Ok(DownloadResult::fail("no_video", "未找到相关视频"));
    }

    // 4. DeepSeek 选片
    let selected = match deepseek_select(&videos, api_key).await {
        Ok(idx) => idx,
        Err(e) => {
            return Ok(DownloadResult::fail("failed", &e));
        }
    };

    let selected_idx = match selected {
        Some(i) => i,
        None => {
            return Ok(DownloadResult::fail(
                "no_instrumental",
                "未找到符合条件的纯音乐视频",
            ));
        }
    };

    let video = &videos[selected_idx];
    eprintln!(
        "[Downloader] 选中: {} - {}",
        video.title, video.author
    );

    // 5. 获取 DASH 音频流 URL
    let client = build_client()?;
    let audio_url = match get_dash_audio_url(&video.bvid, &cookie, &client).await {
        Ok(u) => u,
        Err(e) => {
            return Ok(DownloadResult::fail("failed", &e));
        }
    };

    // 6. 下载音频流到临时文件
    let temp_m4a = music_dir.join("__temp_download.m4a");
    if let Err(e) = download_audio_stream(&audio_url, &client, &temp_m4a).await {
        let _ = fs::remove_file(&temp_m4a);
        return Ok(DownloadResult::fail("failed", &e));
    }

    // 7. 转码为 mp3
    let ffmpeg_path = match get_ffmpeg_path(app) {
        Ok(p) => p,
        Err(e) => {
            let _ = fs::remove_file(&temp_m4a);
            return Ok(DownloadResult::fail("failed", &e));
        }
    };

    let output_mp3 = music_dir.join(format!("{}.mp3", clean_name));
    if let Err(e) = convert_to_mp3(&temp_m4a, &output_mp3, &ffmpeg_path).await {
        let _ = fs::remove_file(&temp_m4a);
        return Ok(DownloadResult::fail("failed", &e));
    }

    // 8. 删除临时文件
    let _ = fs::remove_file(&temp_m4a);

    Ok(DownloadResult::ok("downloaded"))
}
