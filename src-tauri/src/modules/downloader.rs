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

const DEEPSEEK_SYSTEM_PROMPT: &str = "你是纯音乐视频判断器。我会给你6个B站视频标题，你需要选出最像是纯音乐/原版音乐的视频编号。\n\n判断标准：\n**优先选择**（是纯音乐/原版）：\n- 标题包含\"无损\"、\"Hi-Res\"、\"FLAC\"、\"24bit\"、\"[音乐]\"、\"纯享版\"、\"官方\"等\n- \"百万录音棚\"系列\n- 只有音乐和画面，没有额外解说或人声干扰\n- 在其他条件相当时，优先选择非MV版本（纯音乐音频源），因为MV可能含有对白、环境音、场景音效等非音乐内容；但如果其它选项明显不符（如AI翻唱、教学、倍速修改等），MV版本也可以选择\n\n**排除**（不是纯音乐或者出现修改或者出现重复循环）：\n- 标题包含\"AI翻唱\"、\"教程\"、\"钢琴教学\"、\"吉他教学\"、\"cover\"、\"翻唱\"、\"反应\"、\"解说\"\n- 有升key、降key、倍速修改（如\"1.5倍速\"、\"+2key\"）\n- 有明显的人声互动或评论\n- 单曲循环、单曲循环1h（可能循环多次）\n\n**回复格式**：\n- 只回复一个数字 1-6（最符合条件的视频编号）\n- 如果没有一个是纯音乐，回复 None\n- 不要有任何其他内容";

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

/// 查找 ffmpeg：仅查打包的 resource（v4.5.3 起禁用系统 PATH 检测，
/// 避免下载/转码行为依赖用户机器环境；无打包资源时返回 None，走内置 shine-rs 转码）
///
/// 返回 None 表示未找到 ffmpeg（调用方应使用内置转码）
fn find_ffmpeg(app: &AppHandle) -> Option<PathBuf> {
    // 打包的 resource（debug 从 music-player/，release 从 resource_dir/）
    let resource_path = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.join("music-player").join("ffmpeg.exe"))
            .unwrap_or_default()
    } else {
        app.path()
            .resource_dir()
            .ok()
            .map(|d| d.join("ffmpeg.exe"))
            .unwrap_or_default()
    };
    if resource_path.exists() {
        return Some(resource_path);
    }

    None
}

/// 响度归一化目标与限幅（内置转码路径，纯 Rust，不依赖 ffmpeg）
///
/// 用 RMS 作为感知响度的代理：B站各源音量不一，下载时统一到固定 RMS，
/// 目标偏响（用户可随时调小音量，但太轻则拉满也不够），同时限制增益幅度与削波。
const TARGET_RMS_DB: f64 = -14.0; // 目标 RMS（偏响）
const MAX_GAIN_DB: f64 = 18.0; // 最大增益：过轻的源最多提升 18dB，避免放大底噪
const MIN_GAIN_DB: f64 = -12.0; // 最大衰减：已偏响的源最多压 12dB，保持"偏响"取向

/// 计算响度归一化增益（纯函数，便于单测）。
///
/// 返回作用于 PCM 的线性增益系数。规则：
/// 1. 空/静音 → 增益 1.0（不放大底噪）；
/// 2. 目标增益 = 目标 RMS / 当前 RMS，并夹在 [MIN_GAIN_DB, MAX_GAIN_DB]；
/// 3. 削波保护：若增益后峰值超满幅，则降增益至不削波。
fn compute_loudness_gain(samples: &[i16]) -> f64 {
    if samples.is_empty() {
        return 1.0;
    }
    // 单遍整数累加平方和与峰值，避免逐样本 f64 转换（下载阶段性能关键）
    let mut sum_sq: u64 = 0;
    let mut peak: i32 = 0;
    for &s in samples {
        let v = s as i32;
        sum_sq += (v * v) as u64;
        let a = v.abs();
        if a > peak {
            peak = a;
        }
    }

    let n = samples.len() as f64;
    let rms = (sum_sq as f64 / n).sqrt() / 32768.0;
    if rms <= 1e-6 {
        return 1.0;
    }

    let target_lin = 10f64.powf(TARGET_RMS_DB / 20.0);
    let max_gain = 10f64.powf(MAX_GAIN_DB / 20.0);
    let min_gain = 10f64.powf(MIN_GAIN_DB / 20.0);
    let mut gain = (target_lin / rms).clamp(min_gain, max_gain);

    let peak_lin = peak as f64 / 32768.0;
    if peak_lin > 0.0 && peak_lin * gain > 1.0 {
        gain = 1.0 / peak_lin;
    }
    gain
}

/// 对 i16 交错 PCM 应用线性增益，并做最终限幅防止溢出。
fn apply_gain(samples: &mut [i16], gain: f64) {
    if (gain - 1.0).abs() < 1e-9 {
        return;
    }
    for s in samples.iter_mut() {
        let v = *s as f64 * gain;
        *s = v.round().clamp(-32768.0, 32767.0) as i16;
    }
}

/// 内置音频 → mp3 转码（不依赖系统 ffmpeg）
///
/// 流程：symphonia 解封装/解码（m4a/AAC 或 mp3）→ i16 交错 PCM → 响度归一化 →
/// mp3lame-encoder（libmp3lame）编码。采样率/声道取自解码器输出，码率固定 192kbps。
/// 同时用于「预处理已下载歌曲」的响度归一化（下载流程复用同一函数）。
pub fn normalize_audio_to_mp3(input: &Path, output: &Path) -> Result<(), String> {
    use mp3lame_encoder::{Bitrate, Builder, FlushNoGap, InterleavedPcm};
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = fs::File::open(input).map_err(|e| format!("打开音频失败: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = input.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("解析 m4a 失败: {:?}", e))?;
    let mut format = probed.format;

    // 选第一个可解码音轨
    let track_id = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "m4a 中无可解码音轨".to_string())?
        .id;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.id == track_id)
        .ok_or_else(|| "找不到音轨".to_string())?;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("创建 AAC 解码器失败: {:?}", e))?;

    // 第一遍：解码全部音频为 i16 交错 PCM，同时记录采样规格
    let mut pcm: Vec<i16> = Vec::new();
    let mut sample_rate: u32 = 0;
    let mut channels: u32 = 0;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue, // 单帧解码失败跳过
        };

        let spec = *decoded.spec();
        if sample_rate == 0 {
            sample_rate = spec.rate;
            channels = spec.channels.count() as u32;
        }

        let mut buf = SampleBuffer::<i16>::new(decoded.capacity() as u64, spec);
        buf.copy_interleaved_ref(decoded);
        pcm.extend_from_slice(buf.samples());
    }

    if pcm.is_empty() || sample_rate == 0 || channels == 0 {
        return Err("m4a 未解码到有效 PCM".to_string());
    }

    // 响度归一化：把整段 PCM 规整到统一 RMS，稍偏响且不削波
    let gain = compute_loudness_gain(&pcm);
    apply_gain(&mut pcm, gain);

    // 第二遍：分块编码为 mp3，末尾 flush
    let mut encoder = Builder::new()
        .ok_or_else(|| "初始化 LAME 失败".to_string())?
        .with_num_channels(channels as u8)
        .map_err(|e| format!("设置声道失败: {:?}", e))?
        .with_sample_rate(sample_rate)
        .map_err(|e| format!("设置采样率失败: {:?}", e))?
        .with_brate(Bitrate::Kbps192)
        .map_err(|e| format!("设置码率失败: {:?}", e))?
        .build()
        .map_err(|e| format!("构建 LAME 编码器失败: {:?}", e))?;

    let mut mp3_bytes: Vec<u8> = Vec::new();
    let mut out_buf: Vec<u8> = Vec::new();
    // 一个 MP3 帧的 PCM 样本数（交错）：1152 * 声道数
    let frame_samples = (1152 * channels as usize).max(1);
    for chunk in pcm.chunks(frame_samples) {
        out_buf.clear();
        out_buf.reserve(mp3lame_encoder::max_required_buffer_size(chunk.len()));
        let n = encoder
            .encode(
                InterleavedPcm(chunk),
                out_buf.spare_capacity_mut(),
            )
            .map_err(|e| format!("MP3 编码失败: {:?}", e))?;
        unsafe {
            out_buf.set_len(n);
        }
        mp3_bytes.extend_from_slice(&out_buf);
    }

    // flush 收尾
    out_buf.clear();
    out_buf.reserve(8192);
    let n = encoder
        .flush::<FlushNoGap>(out_buf.spare_capacity_mut())
        .map_err(|e| format!("MP3 编码收尾失败: {:?}", e))?;
    unsafe {
        out_buf.set_len(n);
    }
    mp3_bytes.extend_from_slice(&out_buf);

    fs::write(output, &mp3_bytes).map_err(|e| format!("写入 mp3 失败: {}", e))?;
    Ok(())
}

/// 检查 music 目录是否已存在同名歌曲（.mp3 或 .m4a，文件名包含歌名即视为已存在）
fn find_existing_song(music_dir: &Path, song_name: &str) -> bool {
    let entries = match fs::read_dir(music_dir) {
        Ok(e) => e,
        Err(_) => return false,
    };
    let target = song_name.to_lowercase();
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "mp3" && ext != "m4a" {
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

/// B站搜索重试次数与退避间隔
const SEARCH_RETRY_ATTEMPTS: usize = 3;
const SEARCH_RETRY_BASE_DELAY_MS: u64 = 500;

/// 单次 B站搜索（网络/HTTP/解析/API 错误均返回 Err；仅 code==0 时返回 Ok）
async fn search_bilibili_once(keyword: &str, cookie: &str) -> Result<Vec<BiliVideo>, String> {
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

    let resp = req
        .send()
        .await
        .map_err(|e| format!("B站搜索请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("B站搜索 HTTP {}", resp.status()));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取搜索响应失败: {}", e))?;

    if body.trim().is_empty() {
        return Err("B站搜索返回空响应".to_string());
    }

    let data: Value =
        serde_json::from_str(&body).map_err(|e| format!("解析搜索 JSON 失败: {}", e))?;

    if data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        let msg = data
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        return Err(format!("B站搜索 API 错误: {}", msg));
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

/// B站搜索视频（带重试）
///
/// GET https://api.bilibili.com/x/web-interface/search/type
/// 返回前 6 个结果。
///
/// 偶发网络抖动 / 限流会导致单次搜索失败，旧实现把任何失败都当作「无结果」返回，
/// 前端便提示「未找到音乐」。这里对瞬时失败做有限重试，降低误判。
pub async fn search_bilibili(keyword: &str, cookie: &str) -> Result<Vec<BiliVideo>, String> {
    let mut last_err = String::from("未知错误");
    for attempt in 1..=SEARCH_RETRY_ATTEMPTS {
        match search_bilibili_once(keyword, cookie).await {
            Ok(v) => return Ok(v),
            Err(e) => {
                last_err = e;
                if attempt < SEARCH_RETRY_ATTEMPTS {
                    eprintln!(
                        "[Downloader] B站搜索第 {} 次失败，{}ms 后重试: {}",
                        attempt,
                        SEARCH_RETRY_BASE_DELAY_MS * attempt as u64,
                        last_err
                    );
                    tokio::time::sleep(Duration::from_millis(
                        SEARCH_RETRY_BASE_DELAY_MS * attempt as u64,
                    ))
                    .await;
                }
            }
        }
    }
    // 重试耗尽仍失败：返回空（保持旧版 no_video 语义），错误已在 stderr 留痕
    eprintln!(
        "[Downloader] B站搜索重试 {} 次仍失败: {}",
        SEARCH_RETRY_ATTEMPTS, last_err
    );
    Ok(Vec::new())
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
    let mut cmd = std::process::Command::new(ffmpeg_path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW，禁止弹出 cmd 黑框
    }
    cmd.arg("-y")
        .arg("-i")
        .arg(input)
        .arg("-vn")
        .arg("-acodec")
        .arg("libmp3lame")
        .arg("-q:a")
        .arg("2")
        .arg(output);
    let result = tokio::process::Command::from(cmd)
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
    if find_existing_song(music_dir, &clean_name) {
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

    // 7. 转码为 mp3：优先打包 ffmpeg（已禁用系统 PATH 检测），否则内置 shine-rs 转码，
    //    内置转码失败才回退保存 m4a（rodio 0.21 可直接播放 m4a）
    let ffmpeg_path = find_ffmpeg(app);

    if let Some(ffmpeg) = ffmpeg_path {
        // 有打包 ffmpeg：尝试转码为 mp3
        let output_mp3 = music_dir.join(format!("{}.mp3", clean_name));
        match convert_to_mp3(&temp_m4a, &output_mp3, &ffmpeg).await {
            Ok(()) => {
                let _ = fs::remove_file(&temp_m4a);
                eprintln!("[Downloader] 已保存为 mp3: {:?}", output_mp3);
            }
            Err(e) => {
                // ffmpeg 转码失败（如精简版不支持 libmp3lame），回退到 m4a
                eprintln!(
                    "[Downloader] ffmpeg 转码失败，回退到 m4a: {}",
                    e
                );
                let output_m4a = music_dir.join(format!("{}.m4a", clean_name));
                fs::rename(&temp_m4a, &output_m4a)
                    .map_err(|e| format!("重命名 m4a 失败: {}", e))?;
                eprintln!(
                    "[Downloader] 已保存为 m4a: {:?}",
                    output_m4a
                );
            }
        }
    } else {
        // 无 ffmpeg：内置转码（shine-rs 纯 Rust），失败才回退 m4a
        let output_mp3 = music_dir.join(format!("{}.mp3", clean_name));
        match normalize_audio_to_mp3(&temp_m4a, &output_mp3) {
            Ok(()) => {
                let _ = fs::remove_file(&temp_m4a);
                eprintln!("[Downloader] 内置转码成功: {:?}", output_mp3);
            }
            Err(e) => {
                eprintln!("[Downloader] 内置转码失败，回退 m4a: {}", e);
                let output_m4a = music_dir.join(format!("{}.m4a", clean_name));
                fs::rename(&temp_m4a, &output_m4a)
                    .map_err(|e| format!("重命名 m4a 失败: {}", e))?;
                eprintln!("[Downloader] 已保存为 m4a: {:?}", output_m4a);
            }
        }
    }

    Ok(DownloadResult::ok("downloaded"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ===== clean_title =====

    #[test]
    fn test_clean_title_removes_html_tags() {
        let raw = r#"<em class="keyword">周杰伦</em> - 稻草人"#;
        assert_eq!(clean_title(raw), "周杰伦 - 稻草人");
    }

    #[test]
    fn test_clean_title_collapses_whitespace() {
        let raw = "  周杰伦   稻草人  \n  主题曲  ";
        assert_eq!(clean_title(raw), "周杰伦 稻草人 主题曲");
    }

    #[test]
    fn test_clean_title_handles_plain_text() {
        // 无 HTML 标签、无多余空白时，应原样返回
        let raw = "周杰伦 - 稻草人";
        assert_eq!(clean_title(raw), "周杰伦 - 稻草人");
    }

    #[test]
    fn test_clean_title_strips_nested_tags() {
        let raw = r#"<span><em>foo</em></span> bar"#;
        assert_eq!(clean_title(raw), "foo bar");
    }

    #[test]
    fn test_clean_title_empty_string() {
        assert_eq!(clean_title(""), "");
        assert_eq!(clean_title("   "), "");
    }

    // ===== clean_filename =====

    #[test]
    fn test_clean_filename_removes_illegal_chars() {
        let raw = r#"song<name>:"/\\|?*"#;
        // 所有 Windows 非法字符都应被移除
        assert_eq!(clean_filename(raw), "songname");
    }

    #[test]
    fn test_clean_filename_keeps_legal_chars() {
        let raw = "周杰伦 - 稻草人 (Live).mp3";
        assert_eq!(clean_filename(raw), "周杰伦 - 稻草人 (Live).mp3");
    }

    #[test]
    fn test_clean_filename_empty_string() {
        assert_eq!(clean_filename(""), "");
    }

    #[test]
    fn test_clean_filename_chinese_filename() {
        // 中文文件名应保留，仅移除非法字符
        assert_eq!(clean_filename("稻/草?人"), "稻草人");
    }

    // ===== load_cookie_file =====

    #[test]
    fn test_load_cookie_file_nonexistent_returns_empty() {
        let path = Path::new("/this/path/does/not/exist/cookies.txt");
        assert_eq!(load_cookie_file(path), "");
    }

    #[test]
    fn test_load_cookie_file_parses_netscape_format() {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        let cookie_path = dir.path().join("cookies.txt");
        // Netscape cookie 格式：domain	tail	path	secure	expires	name	value
        std::fs::write(
            &cookie_path,
            "# Netscape HTTP Cookie File\n\
             .bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tabc123\n\
             .bilibili.com\tTRUE\t/\tFALSE\t0\tbili_jct\tdef456\n",
        )
        .expect("写入 cookie 文件失败");

        let cookies = load_cookie_file(&cookie_path);
        assert!(cookies.contains("SESSDATA=abc123"), "应包含 SESSDATA cookie");
        assert!(cookies.contains("bili_jct=def456"), "应包含 bili_jct cookie");
        assert_eq!(
            cookies, "SESSDATA=abc123; bili_jct=def456",
            "多个 cookie 应用 '; ' 分隔"
        );
    }

    #[test]
    fn test_load_cookie_file_skips_comments_and_empty_lines() {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        let cookie_path = dir.path().join("cookies.txt");
        std::fs::write(
            &cookie_path,
            "# 这是注释\n\
             \n\
             .example.com\tTRUE\t/\tFALSE\t0\tkey\tvalue\n",
        )
        .expect("写入 cookie 文件失败");

        let cookies = load_cookie_file(&cookie_path);
        assert_eq!(cookies, "key=value");
    }

    #[test]
    fn test_load_cookie_file_skips_malformed_lines() {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        let cookie_path = dir.path().join("cookies.txt");
        // 字段数不足 7 的行应被跳过
        std::fs::write(
            &cookie_path,
            "incomplete\tline\tonly\tthree\tfields\n\
             .example.com\tTRUE\t/\tFALSE\t0\tkey\tvalue\n",
        )
        .expect("写入 cookie 文件失败");

        let cookies = load_cookie_file(&cookie_path);
        assert_eq!(cookies, "key=value");
    }

    #[test]
    fn test_load_cookie_file_empty_file_returns_empty() {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        let cookie_path = dir.path().join("cookies.txt");
        std::fs::write(&cookie_path, "").expect("写入空 cookie 文件失败");
        assert_eq!(load_cookie_file(&cookie_path), "");
    }

    // ===== find_existing_song =====

    #[test]
    fn test_find_existing_song_returns_true_when_mp3_matches() {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        std::fs::write(dir.path().join("周杰伦 - 稻草人.mp3"), b"fake mp3")
            .expect("写入失败");
        assert!(find_existing_song(dir.path(), "周杰伦 - 稻草人"));
        // 子串匹配也算
        assert!(find_existing_song(dir.path(), "稻草人"));
    }

    #[test]
    fn test_find_existing_song_returns_true_when_m4a_matches() {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        std::fs::write(dir.path().join("周杰伦 - 稻草人.m4a"), b"fake m4a")
            .expect("写入失败");
        assert!(find_existing_song(dir.path(), "稻草人"));
    }

    #[test]
    fn test_find_existing_song_returns_false_when_no_match() {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        std::fs::write(dir.path().join("其他歌曲.mp3"), b"fake mp3").expect("写入失败");
        assert!(!find_existing_song(dir.path(), "稻草人"));
    }

    #[test]
    fn test_find_existing_song_ignores_other_extensions() {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        // txt / flac 等不应被识别为已存在歌曲（flac 不在白名单）
        std::fs::write(dir.path().join("稻草人.txt"), b"text").expect("写入失败");
        assert!(!find_existing_song(dir.path(), "稻草人"));
    }

    #[test]
    fn test_find_existing_song_case_insensitive() {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        std::fs::write(dir.path().join("SongName.mp3"), b"fake mp3").expect("写入失败");
        // 大小写不敏感
        assert!(find_existing_song(dir.path(), "songname"));
        assert!(find_existing_song(dir.path(), "SONGNAME"));
    }

    #[test]
    fn test_find_existing_song_nonexistent_dir_returns_false() {
        let path = Path::new("/this/path/does/not/exist");
        assert!(!find_existing_song(path, "anything"));
    }

    // ===== DownloadResult 构造器 =====

    #[test]
    fn test_download_result_ok_constructor() {
        let r = DownloadResult::ok("downloaded");
        assert!(r.success);
        assert_eq!(r.status, "downloaded");
        assert!(r.error.is_none());
    }

    #[test]
    fn test_download_result_fail_constructor() {
        let r = DownloadResult::fail("no_video", "未找到视频");
        assert!(!r.success);
        assert_eq!(r.status, "no_video");
        assert_eq!(r.error.as_deref(), Some("未找到视频"));
    }

    // ===== 响度归一化 =====

    #[test]
    fn test_compute_loudness_gain_empty_and_silence() {
        // 空切片与静音：增益 1.0，不放大底噪
        assert_eq!(compute_loudness_gain(&[]), 1.0);
        assert_eq!(compute_loudness_gain(&[0i16; 1024]), 1.0);
    }

    #[test]
    fn test_compute_loudness_gain_boosts_quiet_track() {
        // 一个较安静的恒定信号（-30 dBFS = 0.0316 线性），应被提升（增益 > 1）
        let level = (32768.0 * 10f64.powf(-30.0 / 20.0)) as i16;
        let samples = vec![level; 4096];
        let gain = compute_loudness_gain(&samples);
        assert!(gain > 1.0, "安静音源应被放大，实际 gain={}", gain);
    }

    #[test]
    fn test_compute_loudness_gain_attenuates_loud_track() {
        // 一个较响的恒定信号（-6 dBFS = 0.501 线性），应被压低（增益 < 1）
        let level = (32768.0 * 10f64.powf(-6.0 / 20.0)) as i16;
        let samples = vec![level; 4096];
        let gain = compute_loudness_gain(&samples);
        assert!(gain < 1.0, "响音源应被压低，实际 gain={}", gain);
    }

    #[test]
    fn test_compute_loudness_gain_no_clipping() {
        // 近满幅但 RMS 较低的信号（高动态）：增益不应导致削波
        // 用半幅正弦近似：峰值 ~0.5，RMS ~0.354（-9 dBFS）→ 增益 < 1，天然不削波
        let samples: Vec<i16> = (0..4096)
            .map(|i| (0.5 * (i as f64).sin() * 32768.0) as i16)
            .collect();
        let gain = compute_loudness_gain(&samples);
        // 应用后所有样本应在 i16 范围内
        for &s in &samples {
            let v = s as f64 * gain;
            assert!(v.abs() <= 32768.0, "增益后不应削波: {}", v);
        }
    }

    #[test]
    fn test_apply_gain_scales_samples() {
        let mut samples = vec![100i16, -200, 300];
        apply_gain(&mut samples, 2.0);
        assert_eq!(samples, vec![200i16, -400, 600]);
    }

    #[test]
    fn test_apply_gain_unity_is_noop() {
        let mut samples = vec![100i16, -200, 300];
        let before = samples.clone();
        apply_gain(&mut samples, 1.0);
        assert_eq!(samples, before);
    }
}
