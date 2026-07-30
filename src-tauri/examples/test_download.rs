//! 下载流程测试程序
//!
//! 测试 B站搜索 → DASH 音频流获取 → 下载音频（跳过 DeepSeek，用第一个搜索结果）
//! 不需要 DeepSeek API key
//!
//! 运行：cd src-tauri && cargo run --example test_download -- "周杰伦 晴天"

use regex::Regex;
use reqwest::Client;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Debug)]
struct BiliVideo {
    bvid: String,
    title: String,
    author: String,
}

fn clean_title(title: &str) -> String {
    let re_html = Regex::new(r"<[^>]+>").unwrap();
    let re_space = Regex::new(r"\s+").unwrap();
    let s = re_html.replace_all(title, "");
    let s = re_space.replace_all(&s, " ");
    s.trim().to_string()
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))
}

async fn search_bilibili(keyword: &str) -> Result<Vec<BiliVideo>, String> {
    let client = build_client()?;
    let resp = client
        .get("https://api.bilibili.com/x/web-interface/search/type")
        .query(&[
            ("search_type", "video"),
            ("keyword", keyword),
            ("page", "1"),
            ("pagesize", "6"),
        ])
        .header("Referer", "https://www.bilibili.com/")
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .send()
        .await
        .map_err(|e| format!("搜索请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("搜索 HTTP {}", resp.status()));
    }

    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析搜索响应失败: {}", e))?;

    let result_arr = data
        .get("data")
        .and_then(|d| d.get("result"))
        .and_then(|r| r.as_array())
        .ok_or("搜索结果为空")?;

    let mut videos = Vec::new();
    for item in result_arr.iter().take(6) {
        let bvid = item
            .get("bvid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if bvid.is_empty() {
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
        videos.push(BiliVideo { bvid, title, author });
    }
    Ok(videos)
}

async fn get_dash_audio_url(bvid: &str, client: &Client) -> Result<String, String> {
    // 1. 获取 cid
    let view_resp = client
        .get("https://api.bilibili.com/x/web-interface/view")
        .query(&[("bvid", bvid)])
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await
        .map_err(|e| format!("view 请求失败: {}", e))?;

    let view_data: Value = view_resp
        .json()
        .await
        .map_err(|e| format!("解析 view 响应失败: {}", e))?;

    if view_data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        return Err(format!(
            "view 接口错误: {}",
            view_data
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("未知")
        ));
    }

    let cid = view_data
        .get("data")
        .and_then(|d| d.get("cid"))
        .and_then(|v| v.as_i64())
        .ok_or("无法获取 cid")?;

    println!("  cid: {}", cid);

    // 2. 获取 DASH 播放地址
    let play_resp = client
        .get("https://api.bilibili.com/x/player/playurl")
        .query(&[
            ("bvid", bvid),
            ("cid", &cid.to_string()),
            ("fnval", "16"),
            ("qn", "64"),
        ])
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await
        .map_err(|e| format!("playurl 请求失败: {}", e))?;

    let play_data: Value = play_resp
        .json()
        .await
        .map_err(|e| format!("解析 playurl 响应失败: {}", e))?;

    if play_data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        return Err(format!(
            "playurl 接口错误: {}",
            play_data
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("未知")
        ));
    }

    // 3. 选 bandwidth 最大的音频流
    let audio_arr = play_data
        .get("data")
        .and_then(|d| d.get("dash"))
        .and_then(|d| d.get("audio"))
        .and_then(|a| a.as_array())
        .ok_or("无 DASH 音频流")?;

    println!("  找到 {} 条音频流", audio_arr.len());

    let mut best_url: Option<String> = None;
    let mut best_bw: i64 = -1;
    for stream in audio_arr {
        let bw = stream
            .get("bandwidth")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let codecs = stream
            .get("codecs")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        println!(
            "    流: id={}, codecs={}, bandwidth={} bytes/s",
            stream.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
            codecs,
            bw
        );
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

async fn download_audio(url: &str, client: &Client, output: &Path) -> Result<u64, String> {
    let resp = client
        .get(url)
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("下载 HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取数据失败: {}", e))?;

    if bytes.is_empty() {
        return Err("数据为空".to_string());
    }

    let size = bytes.len() as u64;
    fs::write(output, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(size)
}

fn find_system_ffmpeg() -> Option<PathBuf> {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let output = std::process::Command::new(cmd).arg("ffmpeg").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path_str = String::from_utf8_lossy(&output.stdout);
    let first_line = path_str.lines().next()?;
    let path = PathBuf::from(first_line.trim());
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

#[tokio::main]
async fn main() {
    let keyword = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "周杰伦 晴天".to_string());

    println!("===== 下载流程测试 =====");
    println!("搜索关键词: {}", keyword);
    println!();

    // 步骤1: B站搜索
    println!("[1/4] 搜索B站视频...");
    let videos = match search_bilibili(&keyword).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("搜索失败: {}", e);
            std::process::exit(1);
        }
    };

    if videos.is_empty() {
        eprintln!("未找到视频");
        std::process::exit(1);
    }

    println!("  找到 {} 个视频:", videos.len());
    for (i, v) in videos.iter().enumerate() {
        println!("    {}. {} - {} [{}]", i + 1, v.title, v.author, v.bvid);
    }
    println!();

    // 步骤2: 选第一个视频（跳过 DeepSeek）
    let video = &videos[0];
    println!("[2/4] 选中视频: {} (bvid={})", video.title, video.bvid);
    println!();

    // 步骤3: 获取 DASH 音频流
    println!("[3/4] 获取 DASH 音频流...");
    let client = build_client().unwrap();
    let audio_url = match get_dash_audio_url(&video.bvid, &client).await {
        Ok(u) => u,
        Err(e) => {
            eprintln!("获取音频流失败: {}", e);
            std::process::exit(1);
        }
    };
    println!("  音频流 URL: {}...", &audio_url[..audio_url.len().min(80)]);
    println!();

    // 步骤4: 下载
    println!("[4/4] 下载音频流...");
    let output_dir = PathBuf::from("test_downloads");
    fs::create_dir_all(&output_dir).ok();

    let temp_m4a = output_dir.join("__test_download.m4a");
    let size = match download_audio(&audio_url, &client, &temp_m4a).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("下载失败: {}", e);
            std::process::exit(1);
        }
    };

    println!("  下载完成: {} bytes ({:.2} MB)", size, size as f64 / 1_048_576.0);

    // 检查 ffmpeg
    if let Some(ffmpeg) = find_system_ffmpeg() {
        println!("  发现系统 ffmpeg: {:?}", ffmpeg);
        let mp3_name = format!("test_{}.mp3", keyword.replace(" ", "_"));
        let output_mp3 = output_dir.join(&mp3_name);
        println!("  转码为 mp3: {:?}", output_mp3);

        let result = std::process::Command::new(&ffmpeg)
            .args(["-y", "-i"])
            .arg(&temp_m4a)
            .args(["-vn", "-acodec", "libmp3lame", "-q:a", "2"])
            .arg(&output_mp3)
            .output();

        match result {
            Ok(o) if o.status.success() => {
                println!("  mp3 转码成功: {:?}", output_mp3);
                let mp3_size = fs::metadata(&output_mp3).map(|m| m.len()).unwrap_or(0);
                println!("  mp3 大小: {} bytes ({:.2} MB)", mp3_size, mp3_size as f64 / 1_048_576.0);
                let _ = fs::remove_file(&temp_m4a);
            }
            Ok(o) => {
                eprintln!("  ffmpeg 转码失败: {}", String::from_utf8_lossy(&o.stderr));
                // 保留 m4a
                let m4a_name = format!("test_{}.m4a", keyword.replace(" ", "_"));
                let m4a_path = output_dir.join(&m4a_name);
                fs::rename(&temp_m4a, &m4a_path).ok();
                println!("  保留 m4a: {:?}", m4a_path);
            }
            Err(e) => {
                eprintln!("  启动 ffmpeg 失败: {}", e);
                let m4a_name = format!("test_{}.m4a", keyword.replace(" ", "_"));
                let m4a_path = output_dir.join(&m4a_name);
                fs::rename(&temp_m4a, &m4a_path).ok();
                println!("  保留 m4a: {:?}", m4a_path);
            }
        }
    } else {
        println!("  未找到系统 ffmpeg，直接保存为 m4a");
        let m4a_name = format!("test_{}.m4a", keyword.replace(" ", "_"));
        let m4a_path = output_dir.join(&m4a_name);
        fs::rename(&temp_m4a, &m4a_path).unwrap();
        println!("  m4a 文件: {:?}", m4a_path);
    }

    println!();
    println!("===== 测试完成 =====");
}
