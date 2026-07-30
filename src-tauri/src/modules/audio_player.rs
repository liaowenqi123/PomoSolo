//! 音频播放器模块（Rust 原生实现，替代 Python music.py）
//!
//! 使用 rodio（基于 cpal + symphonia）实现：
//! - 音频解码：MP3/WAV/FLAC/OGG/M4A(AAC)
//! - 输出设备枚举/切换（cpal WASAPI）
//! - 播放控制：暂停/恢复/跳转/音量
//! - 播放列表：随机/顺序/单曲循环 + 双向历史表

use std::fs;
use std::io::BufReader;
use std::path::PathBuf;
use std::time::Duration;

use rand::seq::SliceRandom;
use rodio::{source::Source, Decoder, OutputStream, OutputStreamHandle, Sink};
use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;

/// 支持的音频格式
const SUPPORTED_FORMATS: &[&str] = &[".wav", ".mp3", ".flac", ".ogg", ".m4a"];

/// 预设标签默认颜色
fn preset_colors() -> std::collections::HashMap<&'static str, &'static str> {
    let mut m = std::collections::HashMap::new();
    m.insert("学习", "#64b4ff");
    m.insert("运动", "#ff9664");
    m.insert("休息", "#64e664");
    m
}

/// 播放模式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayMode {
    Shuffle,
    Order,
    Loop,
}

impl PlayMode {
    pub fn from_str(s: &str) -> Self {
        match s {
            "order" => PlayMode::Order,
            "loop" => PlayMode::Loop,
            _ => PlayMode::Shuffle,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            PlayMode::Shuffle => "shuffle",
            PlayMode::Order => "order",
            PlayMode::Loop => "loop",
        }
    }
}

/// 设备信息（返回给前端）
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: usize,
    pub name: String,
    pub hostapi: String,
    pub is_default: bool,
}

/// 播放器状态快照（用于 emit 事件）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub playing: bool,
    pub name: String,
    pub current: u64,
    pub duration: u64,
    pub has_prev: bool,
    pub play_mode: String,
}

/// 音频播放器
///
/// 注意：OutputStream 内部包含 cpal::Stream，后者不是 Send（因为某些平台的
/// 音频 API 是线程本地的）。在 Windows WASAPI 上，只要同一时间只有一个线程
/// 访问（通过 Mutex 保证），跨线程移动是安全的。
pub struct AudioPlayer {
    // 音频输出（_stream 必须保持存活）
    _stream: Option<OutputStream>,
    stream_handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,

    // 播放状态
    volume: f32,
    track_name: String,
    duration: u64,
    playing: bool,
    paused: bool,
    play_mode: PlayMode,

    // 播放列表
    music_dir: PathBuf,
    playlist: Vec<String>,
    play_history: Vec<(String, bool)>, // (song_name, is_manual)
    history_index: i32,
    current_song_index: i32,

    // 当前设备索引
    current_device_id: Option<usize>,
    initialized: bool,

    // seek 偏移：用 skip_duration 跳过前 N 秒后，rodio 的 Sink::get_pos() 从 0
    // 重新计时（基于挂钟），因此真实播放位置 = position_offset + get_pos()。
    position_offset: u64,
}

// Safety: AudioPlayer 通过 tokio::sync::Mutex 保护，同一时间只有一个线程访问。
// OutputStream 在 Windows WASAPI 上跨线程移动是安全的（COM 对象在单线程访问下无问题）。
unsafe impl Send for AudioPlayer {}

impl AudioPlayer {
    pub fn new() -> Self {
        Self {
            _stream: None,
            stream_handle: None,
            sink: None,
            volume: 1.0,
            track_name: String::new(),
            duration: 0,
            playing: false,
            paused: true,
            play_mode: PlayMode::Shuffle,
            music_dir: PathBuf::new(),
            playlist: Vec::new(),
            play_history: Vec::new(),
            history_index: -1,
            current_song_index: -1,
            current_device_id: None,
            initialized: false,
            position_offset: 0,
        }
    }

    /// 设置音乐目录
    pub fn set_music_dir(&mut self, dir: PathBuf) {
        self.music_dir = dir;
    }

    /// 初始化：创建默认输出流，扫描播放列表
    pub fn init(&mut self) -> Result<bool, String> {
        // 创建默认输出流
        let (stream, handle) =
            OutputStream::try_default().map_err(|e| format!("创建音频输出流失败: {}", e))?;
        self._stream = Some(stream);
        self.stream_handle = Some(handle);

        // 记录默认设备索引
        let host = cpal::default_host();
        let default_device = host.default_output_device();
        if let Some(ref default_dev) = default_device {
            let default_name = default_dev.name().ok();
            if let Ok(devs) = host.output_devices() {
                for (i, device) in devs.enumerate() {
                    if Some(&device.name().unwrap_or_default()) == default_name.as_ref() {
                        self.current_device_id = Some(i);
                        break;
                    }
                }
            }
        }

        // 扫描播放列表
        self.playlist = self.scan_directory();
        if self.playlist.is_empty() {
            self.initialized = true;
            return Ok(false);
        }

        // 选择第一首歌
        let first_song = if self.play_mode == PlayMode::Shuffle {
            self.playlist.choose(&mut rand::thread_rng()).cloned()
        } else {
            Some(self.playlist[0].clone())
        };

        if let Some(ref song) = first_song {
            self.track_name = song.clone();
            self.duration = self.get_song_duration(song);
            self.current_song_index = self
                .playlist
                .iter()
                .position(|s| s == song)
                .map(|i| i as i32)
                .unwrap_or(-1);
        }

        self.playing = true;
        self.paused = true; // 初始暂停状态
        self.initialized = true;
        Ok(true)
    }

    /// 扫描音乐目录
    fn scan_directory(&self) -> Vec<String> {
        let mut files = Vec::new();
        if self.music_dir.exists() && self.music_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&self.music_dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        let lower = name.to_lowercase();
                        if SUPPORTED_FORMATS.iter().any(|ext| lower.ends_with(ext)) {
                            files.push(name.to_string());
                        }
                    }
                }
            }
        }
        files.sort();
        files
    }

    /// 刷新播放列表（热更新）
    pub fn refresh_playlist(&mut self) -> (bool, bool) {
        let new_files = self.scan_directory();
        if new_files.is_empty() {
            self.playlist.clear();
            return (false, false);
        }

        let current_exists = if self.track_name.is_empty() {
            false
        } else {
            new_files.contains(&self.track_name)
        };

        self.playlist = new_files;
        if current_exists {
            self.current_song_index = self
                .playlist
                .iter()
                .position(|s| s == &self.track_name)
                .map(|i| i as i32)
                .unwrap_or(-1);
        } else {
            self.current_song_index = -1;
        }

        (true, current_exists)
    }

    /// 获取歌曲时长（秒）
    ///
    /// 用 rodio::Decoder 解码后取 total_duration（与原 Python 实现一致）。
    fn get_song_duration(&self, name: &str) -> u64 {
        let path = self.music_dir.join(name);
        match fs::File::open(&path) {
            Ok(file) => {
                let source = Decoder::new(BufReader::new(file));
                match source {
                    Ok(decoder) => decoder
                        .total_duration()
                        .map(|d| d.as_secs())
                        .unwrap_or(0),
                    Err(_) => 0,
                }
            }
            Err(_) => 0,
        }
    }

    /// 播放指定歌曲
    ///
    /// 使用 rodio 原生 Decoder + skip_duration 实现：
    /// - Decoder 流式解码（不一次性加载到内存）
    /// - seek 通过 skip_duration 跳过前 N 秒样本（解码丢弃，稳定无电流声）
    pub fn play_song(&mut self, name: &str, start_position: f64) -> Result<(), String> {
        let path = self.music_dir.join(name);
        if !path.exists() {
            return Err("song_missing".to_string());
        }

        let file = fs::File::open(&path).map_err(|e| format!("打开文件失败: {}", e))?;

        // 用 rodio 原生 Decoder 解码（流式，不解码整首）
        let source = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("解码失败: {}, 文件: {}", e, name))?;

        // 获取总时长
        let duration = source
            .total_duration()
            .map(|d| d.as_secs())
            .unwrap_or(0);

        // seek：用 skip_duration 跳过前 N 秒样本（始终调用以保持类型一致）
        let source = source.skip_duration(Duration::from_secs_f64(start_position.max(0.0)));

        let source = source.amplify(self.volume);

        // 停止当前播放
        self.stop_sink();

        // 记录 seek 偏移：get_pos() 从 sink 创建后从 0 计时，
        // 真实播放位置 = position_offset + get_pos()
        self.position_offset = start_position.max(0.0) as u64;

        // 创建新的 Sink 并流式播放
        let handle = self
            .stream_handle
            .as_ref()
            .ok_or("音频输出未初始化")?
            .clone();
        let sink = Sink::try_new(&handle).map_err(|e| format!("创建 Sink 失败: {}", e))?;
        sink.set_volume(self.volume);
        sink.append(source);
        sink.play();

        self.sink = Some(sink);
        self.track_name = name.to_string();
        self.duration = duration;
        self.playing = true;
        self.paused = false;

        Ok(())
    }

    /// 停止当前 Sink
    fn stop_sink(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
    }

    /// 暂停/恢复切换
    ///
    /// 首次调用时（init 后 sink 为 None），自动加载并播放当前歌曲。
    /// 返回 true 表示首次播放（刚加载歌曲），false 表示暂停/恢复。
    pub fn toggle_play(&mut self) -> Result<bool, String> {
        if self.sink.is_none() {
            // 首次播放：加载当前歌曲
            if self.track_name.is_empty() {
                return Err("没有可播放的歌曲".to_string());
            }
            self.play_song(&self.track_name.clone(), 0.0)?;
            return Ok(true);
        }

        if let Some(ref sink) = self.sink {
            if self.paused {
                sink.play();
                self.paused = false;
            } else {
                sink.pause();
                self.paused = true;
            }
        }
        Ok(false)
    }

    /// 跳转到指定位置
    ///
    /// 优先用 rodio 原生 `Sink::try_seek`：不重建 sink，无音频重叠、get_pos 连续。
    /// try_seek 不支持时 fallback 到重建 sink + skip_duration。
    pub fn seek(&mut self, seconds: f64) -> Result<(), String> {
        if self.track_name.is_empty() {
            return Err("没有正在播放的歌曲".to_string());
        }
        // 优先用 rodio 原生 try_seek（不重建 sink，无音频重叠、无 get_pos 断裂）
        if let Some(ref sink) = self.sink {
            let pos = Duration::from_secs_f64(seconds.max(0.0));
            if sink.try_seek(pos).is_ok() {
                // try_seek 成功后 get_pos 反映 seek 后的真实位置，清除 offset
                self.position_offset = 0;
                return Ok(());
            }
        }
        // fallback：没有 sink 或 try_seek 不支持，重建 sink + skip_duration
        let name = self.track_name.clone();
        self.play_song(&name, seconds)
    }

    /// 设置音量
    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
        if let Some(ref sink) = self.sink {
            sink.set_volume(self.volume);
        }
    }

    /// 设置播放模式
    pub fn set_play_mode(&mut self, mode: PlayMode) {
        self.play_mode = mode;
        if mode == PlayMode::Shuffle {
            self.play_history.clear();
            self.history_index = -1;
        }
    }

    /// 获取下一首歌
    pub fn get_next_song(&mut self, auto_play: bool) -> Option<String> {
        self.refresh_playlist();
        if self.playlist.is_empty() {
            return None;
        }

        // 单曲循环
        if self.play_mode == PlayMode::Loop {
            if self.current_song_index < 0 {
                self.current_song_index = 0;
            }
            return Some(self.playlist[self.current_song_index as usize].clone());
        }

        // 当前歌曲
        let current = if self.history_index >= 0
            && self.history_index < self.play_history.len() as i32
        {
            Some(self.play_history[self.history_index as usize].0.clone())
        } else {
            None
        };

        // 自动播放时清理当前位置之后的历史
        if auto_play && self.history_index >= 0 {
            self.play_history.truncate((self.history_index + 1) as usize);
        }

        // 生成下一首
        let next = if self.play_mode == PlayMode::Shuffle {
            if self.playlist.len() > 1 {
                let mut rng = rand::thread_rng();
                let current_str = current.unwrap_or_default();
                loop {
                    let s = self.playlist.choose(&mut rng).unwrap().clone();
                    if s != current_str {
                        break s;
                    }
                }
            } else {
                self.playlist[0].clone()
            }
        } else {
            // 顺序模式
            if self.current_song_index < 0 {
                self.current_song_index = 0;
            } else {
                self.current_song_index = ((self.current_song_index as usize + 1)
                    % self.playlist.len())
                    as i32;
            }
            self.playlist[self.current_song_index as usize].clone()
        };

        self.play_history
            .push((next.clone(), !auto_play));
        self.history_index = (self.play_history.len() - 1) as i32;
        self.current_song_index = self
            .playlist
            .iter()
            .position(|s| s == &next)
            .map(|i| i as i32)
            .unwrap_or(-1);

        Some(next)
    }

    /// 获取上一首歌
    pub fn get_prev_song(&mut self) -> Option<String> {
        self.refresh_playlist();
        if self.playlist.is_empty() {
            return None;
        }

        // 单曲循环
        if self.play_mode == PlayMode::Loop {
            if self.current_song_index < 0 {
                self.current_song_index = 0;
            }
            return Some(self.playlist[self.current_song_index as usize].clone());
        }

        // 历史表中还有前一首
        if self.history_index > 0 {
            self.history_index -= 1;
            let prev = self.play_history[self.history_index as usize].0.clone();
            self.current_song_index = self
                .playlist
                .iter()
                .position(|s| s == &prev)
                .map(|i| i as i32)
                .unwrap_or(-1);
            return Some(prev);
        }

        // 历史表开头，生成新歌
        let current = if self.history_index >= 0
            && self.history_index < self.play_history.len() as i32
        {
            Some(self.play_history[self.history_index as usize].0.clone())
        } else {
            None
        };

        let new_song = if self.play_mode == PlayMode::Shuffle {
            if self.playlist.len() > 1 {
                let mut rng = rand::thread_rng();
                let current_str = current.unwrap_or_default();
                loop {
                    let s = self.playlist.choose(&mut rng).unwrap().clone();
                    if s != current_str {
                        break s;
                    }
                }
            } else {
                self.playlist[0].clone()
            }
        } else {
            if self.current_song_index < 0 {
                self.current_song_index = (self.playlist.len() - 1) as i32;
            } else {
                self.current_song_index = if self.current_song_index == 0 {
                    (self.playlist.len() - 1) as i32
                } else {
                    self.current_song_index - 1
                };
            }
            self.playlist[self.current_song_index as usize].clone()
        };

        self.play_history.insert(0, (new_song.clone(), true));
        self.history_index = 0;
        self.current_song_index = self
            .playlist
            .iter()
            .position(|s| s == &new_song)
            .map(|i| i as i32)
            .unwrap_or(-1);

        Some(new_song)
    }

    /// 获取随机歌曲
    pub fn get_random_song(&self) -> Option<String> {
        self.playlist.choose(&mut rand::thread_rng()).cloned()
    }

    /// 检查歌曲是否结束
    pub fn is_song_ended(&self) -> bool {
        if let Some(ref sink) = self.sink {
            sink.empty()
        } else {
            false
        }
    }

    /// 获取当前播放位置（秒）
    ///
    /// 真实位置 = position_offset + sink.get_pos()。
    /// skip_duration 跳过的秒数记在 offset 里，sink 创建后 get_pos 从 0 计时。
    pub fn get_position(&self) -> u64 {
        if let Some(ref sink) = self.sink {
            self.position_offset + sink.get_pos().as_secs()
        } else {
            self.position_offset
        }
    }

    /// 获取状态快照
    pub fn snapshot(&self) -> PlayerSnapshot {
        PlayerSnapshot {
            playing: self.playing && !self.paused,
            name: self.track_name.clone(),
            current: self.get_position(),
            duration: self.duration,
            has_prev: true,
            play_mode: self.play_mode.as_str().to_string(),
        }
    }

    /// 获取播放列表（带标签）
    pub fn get_playlist_with_tags(&mut self) -> (Vec<PlaylistSong>, String, i32) {
        self.refresh_playlist();
        let tags = self.load_tags();
        let colors = preset_colors();
        let custom_tags: std::collections::HashMap<String, String> = tags
            .get("_customTags")
            .and_then(|v| v.as_object())
            .map(|m| {
                m.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default();

        let songs: Vec<PlaylistSong> = self
            .playlist
            .iter()
            .map(|song| {
                let tag_data = tags.get(song);
                match tag_data {
                    None => PlaylistSong {
                        name: song.clone(),
                        tag: "自定义".to_string(),
                        tag_color: None,
                    },
                    Some(serde_json::Value::String(s)) => {
                        let color = custom_tags
                            .get(s)
                            .map(|c| c.clone())
                            .or_else(|| colors.get(s.as_str()).map(|c| c.to_string()));
                        PlaylistSong {
                            name: song.clone(),
                            tag: s.clone(),
                            tag_color: color,
                        }
                    }
                    Some(obj) => PlaylistSong {
                        name: song.clone(),
                        tag: obj
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("自定义")
                            .to_string(),
                        tag_color: obj
                            .get("color")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    },
                }
            })
            .collect();

        (songs, self.track_name.clone(), self.current_song_index)
    }

    /// 删除歌曲
    pub fn delete_song(&mut self, song_name: &str) -> Result<(), String> {
        if self.track_name == song_name {
            return Err("无法删除当前已加载的歌曲".to_string());
        }
        let path = self.music_dir.join(song_name);
        if !path.exists() {
            return Err("歌曲文件不存在".to_string());
        }
        fs::remove_file(&path).map_err(|e| format!("删除文件失败: {}", e))?;
        self.refresh_playlist();
        Ok(())
    }

    // ===== 标签管理 =====

    fn tags_path(&self) -> PathBuf {
        self.music_dir.join("tags.json")
    }

    fn load_tags(&self) -> serde_json::Value {
        let path = self.tags_path();
        if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        }
    }

    fn save_tags(&self, tags: &serde_json::Value) -> Result<(), String> {
        let path = self.tags_path();
        let content =
            serde_json::to_string_pretty(tags).map_err(|e| format!("序列化失败: {}", e))?;
        fs::write(&path, content).map_err(|e| format!("写入文件失败: {}", e))
    }

    pub fn get_custom_tags(&self) -> serde_json::Value {
        self.load_tags()
            .get("_customTags")
            .cloned()
            .unwrap_or(serde_json::json!({}))
    }

    pub fn add_custom_tag(&self, tag_name: &str, color: &str) -> Result<(), String> {
        let mut tags = self.load_tags();
        if !tags.is_object() {
            tags = serde_json::json!({});
        }
        if tags.get("_customTags").is_none() {
            tags["_customTags"] = serde_json::json!({});
        }
        tags["_customTags"][tag_name] = serde_json::json!(color);
        self.save_tags(&tags)
    }

    pub fn delete_custom_tag(&self, tag_name: &str) -> Result<(), String> {
        let mut tags = self.load_tags();
        if let Some(custom) = tags.get_mut("_customTags").and_then(|v| v.as_object_mut()) {
            custom.remove(tag_name);
            self.save_tags(&tags)
        } else {
            Err("标签不存在".to_string())
        }
    }

    pub fn update_song_tag(
        &self,
        song_name: &str,
        tag_name: &str,
        tag_color: Option<&str>,
    ) -> Result<(), String> {
        let mut tags = self.load_tags();
        let colors = preset_colors();
        let custom_tags = self.get_custom_tags();

        let color = if let Some(c) = tag_color {
            c.to_string()
        } else {
            custom_tags
                .get(tag_name)
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| colors.get(tag_name).map(|c| c.to_string()))
                .unwrap_or_default()
        };

        tags[song_name] = serde_json::json!({
            "name": tag_name,
            "color": color
        });

        self.save_tags(&tags)
    }

    // ===== 设备管理 =====

    /// 获取输出设备列表
    pub fn list_devices() -> Vec<DeviceInfo> {
        let host = cpal::default_host();
        let mut devices = Vec::new();

        // 获取默认设备名用于标记
        let default_name = host
            .default_output_device()
            .and_then(|d| d.name().ok());

        if let Ok(devs) = host.output_devices() {
            for (i, device) in devs.enumerate() {
                let name = device.name().unwrap_or_else(|_| "Unknown".to_string());
                let is_default = default_name.as_deref() == Some(&name);
                devices.push(DeviceInfo {
                    id: i,
                    name: name.chars().take(50).collect(),
                    hostapi: "WASAPI".to_string(),
                    is_default,
                });
            }
        }

        devices
    }

    /// 切换输出设备
    pub fn set_device(&mut self, device_id: usize) -> Result<(), String> {
        let host = cpal::default_host();
        let devices: Vec<_> = host
            .output_devices()
            .map_err(|e| format!("枚举设备失败: {}", e))?
            .collect();

        if device_id >= devices.len() {
            return Err("设备 ID 无效".to_string());
        }

        let device = &devices[device_id];

        // 保存当前播放位置
        let position = self.get_position();
        let current_song = if self.track_name.is_empty() {
            None
        } else {
            Some(self.track_name.clone())
        };

        // 停止当前播放
        self.stop_sink();

        // 重建输出流
        self._stream = None;
        self.stream_handle = None;

        let (stream, handle) = OutputStream::try_from_device(device)
            .map_err(|e| format!("创建设备输出流失败: {}", e))?;
        self._stream = Some(stream);
        self.stream_handle = Some(handle);
        self.current_device_id = Some(device_id);

        // 恢复播放
        if let Some(song) = current_song {
            if !self.paused {
                self.play_song(&song, position as f64)?;
            } else {
                // 暂停状态：加载歌曲信息但不播放
                self.duration = self.get_song_duration(&song);
                self.track_name = song;
            }
        }

        Ok(())
    }

    /// 获取当前设备 ID
    pub fn current_device(&self) -> Option<usize> {
        self.current_device_id
    }

    /// 是否已初始化
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// 是否在播放
    pub fn is_playing(&self) -> bool {
        self.playing && !self.paused
    }

    /// 当前歌曲名
    pub fn current_track(&self) -> &str {
        &self.track_name
    }

    /// 当前时长
    pub fn current_duration(&self) -> u64 {
        self.duration
    }

    /// 音量
    pub fn volume(&self) -> f32 {
        self.volume
    }

    /// 播放模式
    pub fn play_mode(&self) -> PlayMode {
        self.play_mode
    }

    /// 播放列表
    pub fn playlist(&self) -> &[String] {
        &self.playlist
    }
}

/// 播放列表歌曲（带标签）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSong {
    pub name: String,
    pub tag: String,
    pub tag_color: Option<String>,
}
