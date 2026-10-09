//! 音频播放器模块（Rust 原生实现，替代 Python music.py）
//!
//! 使用 rodio（基于 cpal + symphonia）实现：
//! - 音频解码：MP3/WAV/FLAC/OGG/M4A(AAC)
//! - 输出设备枚举/切换（cpal WASAPI）
//! - 播放控制：暂停/恢复/跳转/音量
//! - 播放列表：随机/顺序/单曲循环 + 双向历史表

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use rand::seq::SliceRandom;
use rodio::{source::Source, Decoder, OutputStream, OutputStreamBuilder, Sink};
use rodio::mixer::Mixer;
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
    /// 实际播放音量（0.0-1.0）：前端启动后以 status 为准同步 UI，
    /// 避免前端持久化丢失/被覆盖时音量 UI 与实际播放音量不一致
    pub volume: f32,
}

/// 音频播放器
///
/// 注意：OutputStream 内部包含 cpal::Stream，后者不是 Send（因为某些平台的
/// 音频 API 是线程本地的）。在 Windows WASAPI 上，只要同一时间只有一个线程
/// 访问（通过 Mutex 保证），跨线程移动是安全的。
pub struct AudioPlayer {
    // 音频输出（_stream 必须保持存活）
    _stream: Option<OutputStream>,
    // rodio 0.21：OutputStreamHandle 已移除，Sink 通过 &Mixer 创建（内部克隆 Arc）
    mixer: Option<Mixer>,
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
    /// 播放集合（用户自定义播放列表，Set 语义）：
    /// - None：未设置，播放范围 = 全库（默认行为，历史兼容）
    /// - Some(非空)：只播集合内的歌（推入序 = 顺序模式的迭代序）
    /// - Some(空)：集合已清空 → 自然结束后停止自动切歌（手动切歌回落全库）
    active_list: Option<Vec<String>>,
    play_history: Vec<(String, bool)>, // (song_name, is_manual)
    history_index: i32,
    current_song_index: i32,
    /// 预摇的下一首（v4.12，仅 Shuffle 模式用）。
    ///
    /// 为什么需要它：Shuffle 模式下"下一首"原本是**切换那一刻**才随机摇出来的，
    /// 因此谁都无法提前知道（同步听歌的听众也就无法提前预取）。
    /// 现在改成"当前歌一开始播就先摇好下一首"——对用户完全不可感知，
    /// 但 `peek_next_song()` 与实际播放**必然一致**，预取才能命中。
    ///
    /// 附带修好一个既有毛病：以前任何"偷看下一首"都只能调 `get_next_song`，
    /// 而它会 `play_history.push(...)` + 改 `history_index` → "上一首"会重播当前歌。
    pre_rolled_next: Option<String>,

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
            mixer: None,
            sink: None,
            volume: 1.0,
            track_name: String::new(),
            duration: 0,
            playing: false,
            paused: true,
            play_mode: PlayMode::Shuffle,
            music_dir: PathBuf::new(),
            playlist: Vec::new(),
            active_list: None,
            play_history: Vec::new(),
            history_index: -1,
            current_song_index: -1,
            pre_rolled_next: None,
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
        // 创建默认输出流（rodio 0.21：OutputStreamBuilder + open_default_stream）
        let stream = OutputStreamBuilder::open_default_stream()
            .map_err(|e| format!("创建音频输出流失败: {}", e))?;
        self.mixer = Some(stream.mixer().clone());
        self._stream = Some(stream);

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

        // 播放集合引用清理：文件已删除的歌从集合移除；
        // 集合被清空后保持 Some(空) 标记（= 用户已清空 → 自然结束后停止自动切歌）
        if let Some(list) = self.active_list.as_mut() {
            list.retain(|s| new_files.contains(s));
        }

        // 首次扫描：为新文件创建默认记录（内置→「内置」目录，其余→未分类），已有记录不覆盖
        self.ensure_scan_records(&new_files);

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
    /// 分片 MP4（fMP4）等无 duration 信息的文件返回 0 时，回退到全文件解码计数估算。
    fn get_song_duration(&self, name: &str) -> u64 {
        let path = self.music_dir.join(name);
        match fs::File::open(&path) {
            Ok(file) => {
                let source = Decoder::try_from(file);
                match source {
                    Ok(decoder) => {
                        let d = decoder.total_duration().map(|d| d.as_secs()).unwrap_or(0);
                        if d > 0 {
                            d
                        } else {
                            self.scan_estimate_duration(&path)
                        }
                    }
                    Err(_) => 0,
                }
            }
            Err(_) => 0,
        }
    }

    /// 全文件解码计数估算时长（用于 total_duration 缺失的分片 MP4）
    ///
    /// 重新打开文件并迭代全部样本，按 (总样本 / 声道数 / 采样率) 换算秒。
    /// 仅当 total_duration 不可用时触发（普通 mp3/m4a 不受影响）。
    fn scan_estimate_duration(&self, path: &std::path::Path) -> u64 {
        let Ok(file) = fs::File::open(path) else {
            return 0;
        };
        let Ok(mut source) = Decoder::try_from(file) else {
            return 0;
        };
        let sample_rate = source.sample_rate() as u64;
        let channels = source.channels() as u64;
        if sample_rate == 0 || channels == 0 {
            return 0;
        }
        let mut total_samples: u64 = 0;
        for _ in source.by_ref() {
            total_samples += 1;
        }
        (total_samples / channels / sample_rate) as u64
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

        // 用 rodio 原生 Decoder 解码（rodio 0.21：try_from 自动包装，支持 m4a/AAC）
        let source = Decoder::try_from(file)
            .map_err(|e| format!("解码失败: {}, 文件: {}", e, name))?;

        // 获取总时长（fMP4 无 duration 信息时全文件扫描估算，保证进度条有最大值）
        let duration = source
            .total_duration()
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let duration = if duration > 0 {
            duration
        } else {
            self.scan_estimate_duration(&path)
        };

        // seek：用 skip_duration 跳过前 N 秒样本（始终调用以保持类型一致）
        let source = source.skip_duration(Duration::from_secs_f64(start_position.max(0.0)));

        let source = source.amplify(self.volume);

        // 停止当前播放
        self.stop_sink();

        // 记录 seek 偏移：get_pos() 从 sink 创建后从 0 计时，
        // 真实播放位置 = position_offset + get_pos()
        self.position_offset = start_position.max(0.0) as u64;

        // 创建新的 Sink 并流式播放（rodio 0.21：Sink::connect_new(&Mixer)，不再返回 Result）
        let mixer = self
            .mixer
            .as_ref()
            .ok_or("音频输出未初始化")?;
        let sink = Sink::connect_new(mixer);
        sink.set_volume(self.volume);
        sink.append(source);
        sink.play();

        self.sink = Some(sink);
        self.track_name = name.to_string();
        self.duration = duration;
        self.playing = true;
        self.paused = false;

        // v4.12：当前歌开始播 → 立刻预摇下一首。
        // Shuffle 模式下这一步让"下一首"从"切换那一刻才知道"变成"现在就确定"，
        // 于是同步听歌的听众可以提前预取（peek_next_song 与实际播放必然一致）。
        self.ensure_pre_roll();

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
        // 钳制到 [0, 当前歌曲时长]：DJ 广播/下载校准的 seek 目标可能超出
        // 当前歌曲时长（旧歌信息覆盖新歌/信息堆积），超界 seek 会让播放器
        // 位置超过时长，进度条出现超出最大值
        let target = seconds.clamp(0.0, self.duration as f64);
        // 优先用 rodio 原生 try_seek（不重建 sink，无音频重叠、无 get_pos 断裂）
        if let Some(ref sink) = self.sink {
            let pos = Duration::from_secs_f64(target);
            if sink.try_seek(pos).is_ok() {
                // try_seek 成功后 get_pos 反映 seek 后的真实位置，清除 offset
                self.position_offset = 0;
                return Ok(());
            }
        }
        // fallback：没有 sink 或 try_seek 不支持，重建 sink + skip_duration
        let name = self.track_name.clone();
        self.play_song(&name, target)
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
        // v4.12：播放范围/模式变了 → 重摇下一首（切到 Shuffle 必须摇；切走则清掉）
        self.ensure_pre_roll();
    }

    /// 获取下一首歌
    pub fn get_next_song(&mut self, auto_play: bool) -> Option<String> {
        self.refresh_playlist();
        if self.playlist.is_empty() {
            return None;
        }

        // 播放集合语义：
        // - Some(空) = 已清空：自然结束（auto_play=true）→ 停止；手动切歌回落全库
        // - Some(非空) = 只在该集合内取歌；None = 全库
        if matches!(&self.active_list, Some(l) if l.is_empty()) && auto_play {
            return None;
        }
        let working: Vec<String> = match &self.active_list {
            Some(l) if !l.is_empty() => l.clone(),
            _ => self.playlist.clone(),
        };
        if working.is_empty() {
            return None;
        }

        // 单曲循环
        if self.play_mode == PlayMode::Loop {
            if self.current_song_index < 0 {
                self.current_song_index = 0;
            }
            let idx = (self.current_song_index as usize).min(working.len().saturating_sub(1));
            return Some(working[idx].clone());
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
            if working.len() > 1 {
                let current_str = current.unwrap_or_else(|| self.track_name.clone());
                /*
                 * v4.12：优先用**预摇**结果，保证 peek_next_song() 与实际播放一致
                 * （预取才能命中）。预摇结果失效时（歌单变了/摇到了当前歌）才现摇。
                 */
                let pre = self
                    .pre_rolled_next
                    .take()
                    .filter(|s| working.iter().any(|w| w == s) && s != &current_str);
                match pre {
                    Some(s) => s,
                    None => {
                        let mut rng = rand::thread_rng();
                        // 历史为空时以当前播放曲为"不重复对象"，避免随机到同一首重复播放
                        loop {
                            let s = working.choose(&mut rng).unwrap().clone();
                            if s != current_str {
                                break s;
                            }
                        }
                    }
                }
            } else {
                working[0].clone()
            }
        } else {
            // 顺序/列表循环模式：在 working 列表内取模前进（列表循环）
            let pos = working
                .iter()
                .position(|s| s == &self.track_name)
                .map(|i| i as i32)
                .unwrap_or(0);
            let idx = ((pos + 1) % working.len() as i32) as usize;
            working[idx].clone()
        };

        self.play_history
            .push((next.clone(), !auto_play));
        self.history_index = (self.play_history.len() - 1) as i32;
        self.current_song_index = working
            .iter()
            .position(|s| s == &next)
            .map(|i| i as i32)
            .unwrap_or(-1);

        // v4.12：本轮的"下一首"已被消费 → 立刻为新的下一首预摇，
        // 保证任何时刻 peek_next_song() 都指向真正会播的那首。
        self.ensure_pre_roll();

        Some(next)
    }

    /// 计算播放范围（与 get_next_song 内的 working 语义一致）
    fn next_working_list(&self) -> Vec<String> {
        match &self.active_list {
            Some(l) if !l.is_empty() => l.clone(),
            _ => self.playlist.clone(),
        }
    }

    /// **纯函数**：算出"下一首会是谁"，**不改动任何状态**。
    ///
    /// ⚠️ 绝不能用 `get_next_song` 代替它来"偷看" —— 那个函数会
    /// `play_history.push(...)` 并改写 `history_index`/`current_song_index`，
    /// 结果"上一首"会重播当前歌（历史被污染）。这正是本函数存在的原因。
    ///
    /// 各模式的可预测性：
    /// - `Loop`（单曲循环）：下一首就是当前歌 → 精确
    /// - `Order`（顺序/列表循环）：在播放范围内取模前进 → 精确
    /// - `Shuffle`：用**预摇**结果 → 精确（v4.12 起；以前根本不可预测）
    pub fn peek_next_song(&self) -> Option<String> {
        let working = self.next_working_list();
        if working.is_empty() {
            return None;
        }
        if self.play_mode == PlayMode::Loop {
            let idx = (self.current_song_index.max(0) as usize).min(working.len() - 1);
            return Some(working[idx].clone());
        }
        if self.play_mode == PlayMode::Shuffle {
            // 预摇结果可能因歌单变化而失效 → 失效就返回 None（调用方当作"不知道"），
            // 而不是瞎猜一个：预取错歌会白费带宽。
            return self
                .pre_rolled_next
                .clone()
                .filter(|s| working.iter().any(|w| w == s) && s != &self.track_name);
        }
        let pos = working
            .iter()
            .position(|s| s == &self.track_name)
            .map(|i| i as i32)
            .unwrap_or(0);
        let idx = ((pos + 1) % working.len() as i32) as usize;
        Some(working[idx].clone())
    }

    /// 预摇下一首（v4.12）：让 `peek_next_song()` 与实际播放一致。
    ///
    /// - Shuffle：现在就摇好并存起来（用户不可感知；切换时直接用这个结果）
    /// - Order/Loop：可精确推导，无需预摇（清掉以免误导）
    ///
    /// 调用时机：当前歌开始播放时（`play_song`）、以及每消费掉一个"下一首"之后
    /// （`get_next_song` 末尾）。
    pub fn ensure_pre_roll(&mut self) {
        if self.play_mode != PlayMode::Shuffle {
            self.pre_rolled_next = None;
            return;
        }
        let working = self.next_working_list();
        if working.is_empty() {
            self.pre_rolled_next = None;
            return;
        }
        if working.len() == 1 {
            self.pre_rolled_next = Some(working[0].clone());
            return;
        }
        let current = self.track_name.clone();
        let mut rng = rand::thread_rng();
        loop {
            let s = working.choose(&mut rng).unwrap().clone();
            if s != current {
                self.pre_rolled_next = Some(s);
                break;
            }
        }
    }

    /// 获取上一首歌
    pub fn get_prev_song(&mut self) -> Option<String> {
        self.refresh_playlist();
        if self.playlist.is_empty() {
            return None;
        }

        // 集合已清空：手动切歌回落全库（与 get_next_song 的 None 分支对称）
        let working: Vec<String> = match &self.active_list {
            Some(l) if !l.is_empty() => l.clone(),
            _ => self.playlist.clone(),
        };
        if working.is_empty() {
            return None;
        }

        // 单曲循环
        if self.play_mode == PlayMode::Loop {
            if self.current_song_index < 0 {
                self.current_song_index = 0;
            }
            let idx = (self.current_song_index as usize).min(working.len().saturating_sub(1));
            return Some(working[idx].clone());
        }

        // 历史表中还有前一首
        if self.history_index > 0 {
            self.history_index -= 1;
            let prev = self.play_history[self.history_index as usize].0.clone();
            self.current_song_index = working
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
            if working.len() > 1 {
                let mut rng = rand::thread_rng();
                let current_str = current.unwrap_or_else(|| self.track_name.clone());
                loop {
                    let s = working.choose(&mut rng).unwrap().clone();
                    if s != current_str {
                        break s;
                    }
                }
            } else {
                working[0].clone()
            }
        } else {
            let pos = working
                .iter()
                .position(|s| s == &self.track_name)
                .map(|i| i as i32)
                .unwrap_or(0);
            let idx = if pos <= 0 {
                working.len() - 1
            } else {
                (pos - 1) as usize
            };
            working[idx].clone()
        };

        self.play_history.insert(0, (new_song.clone(), true));
        self.history_index = 0;
        self.current_song_index = working
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
            // 先看缓冲：sink 还有数据 → 肯定没播完
            if !sink.empty() {
                return false;
            }
            // 缓冲空但播放位置还没接近歌曲末尾 → 不是"播完"，而是：
            // seek fallback 用 skip_duration 惰性跳过 seek 目标期间，source 还在
            // 解码丢弃前 N 秒样本，sink 缓冲暂时为空（真实位置 = position_offset）。
            // 若此时判定"播完"会自动切歌——表现为下载完成后 seek 校准到 DJ 进度，
            // 随后播放器突然从头播下一首（用户反馈"跳回 2s/3s 开始播放"）。
            if self.duration == 0 {
                // 时长未知：保持旧行为（缓冲空即视为结束）
                return true;
            }
            // 容差 2s：位置已接近歌曲末尾才判定播完（避免时长估算误差导致不自动切歌）
            self.get_position() >= self.duration.saturating_sub(2)
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
            volume: self.volume,
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
                let (path, tags, source) = match tags.get(song) {
                    Some(v) => parse_song_record(v),
                    None => (String::new(), Vec::new(), String::new()),
                };
                let primary = tags.first().cloned().unwrap_or_else(|| "自定义".to_string());
                let color = custom_tags
                    .get(&primary)
                    .map(|c| c.clone())
                    .or_else(|| colors.get(primary.as_str()).map(|c| c.to_string()));
                PlaylistSong {
                    name: song.clone(),
                    tag: primary.clone(),
                    tag_color: color,
                    tags: Some(tags),
                    path: Some(path),
                    source: Some(source),
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
        if let Some(list) = self.active_list.as_mut() {
            list.retain(|s| s != song_name);
        }
        // 清理标签/记录
        let mut tags = self.load_tags();
        if tags.is_object() {
            if tags.as_object().unwrap().contains_key(song_name) {
                tags.as_object_mut().unwrap().remove(song_name);
                let _ = self.save_tags(&tags);
            }
        }
        self.refresh_playlist();
        Ok(())
    }

    /// 首次扫描记录补全（仅在确有新信息时写盘，避免污染开发目录的 tags.json 构建种子）：
    /// - 内置歌曲：无记录 → 建 {path:"内置", source:"builtin"}；
    ///   有记录但无 path（旧版字符串/{name,color} 种子）→ 升级为 v2 对象并补「内置」目录（一次性迁移）；
    ///   已有目录归属（用户移动过）→ 不覆盖。
    /// - 其余文件：不建纯默认记录（缺省读取即"未分类/无标签"），等下载/P2P 等真实来源落库时再建。
    fn ensure_scan_records(&mut self, files: &[String]) {
        let mut tags = self.load_tags();
        if !tags.is_object() {
            tags = serde_json::json!({});
        }
        let mut changed = false;
        for f in files {
            if !is_builtin_song(f) {
                continue;
            }
            let existing = tags.get(f).cloned(); // 拷贝，避免借用冲突
            match existing {
                None => {
                    tags[f] = serde_json::json!({ "path": "内置", "tags": [], "source": "builtin" });
                    changed = true;
                }
                Some(v) => {
                    let (path, tags_vec, _) = parse_song_record(&v);
                    if !path.is_empty() {
                        continue; // 已有目录归属（含用户移动过）：不覆盖
                    }
                    // 旧格式（字符串 / {name,color}）：升级为 v2 对象并补「内置」目录
                    let mut record = v.as_object().cloned().unwrap_or_default();
                    record.insert("path".to_string(), serde_json::json!("内置"));
                    record.insert("source".to_string(), serde_json::json!("builtin"));
                    record.entry("tags".to_string()).or_insert(serde_json::json!(tags_vec));
                    tags[f] = serde_json::Value::Object(record);
                    changed = true;
                }
            }
        }
        if changed {
            let _ = self.save_tags(&tags);
        }
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

    // ===== 歌曲记录 v2（目录归属 path / 多值标签 tags / 来源 source） =====

    /// 首次创建记录时按来源自动归类（已有记录不覆盖）：
    /// download → 「下载」，p2p → 空目录（前端按用户名补「{用户}传输」），其余按调用方传参。
    /// 返回是否新建了记录。
    pub fn ensure_song_record(
        &mut self,
        song: &str,
        default_path: &str,
        source: &str,
    ) -> Result<bool, String> {
        let mut tags = self.load_tags();
        if !tags.is_object() {
            tags = serde_json::json!({});
        }
        if tags.get(song).is_some() {
            return Ok(false);
        }
        tags[song] = serde_json::json!({
            "path": default_path,
            "tags": [],
            "source": source,
        });
        self.save_tags(&tags)?;
        Ok(true)
    }

    /// 读取歌曲记录（path, tags, source）；无记录时返回默认（未分类/无标签/来源空）
    pub fn get_song_meta(&self, song: &str) -> (String, Vec<String>, String) {
        match self.load_tags().get(song) {
            Some(v) => parse_song_record(v),
            None => (String::new(), Vec::new(), String::new()),
        }
    }

    /// 设置单首歌曲目录归属（无记录时按默认补全）
    pub fn set_song_path(&mut self, song: &str, path: &str) -> Result<bool, String> {
        let mut tags = self.load_tags();
        if !tags.is_object() {
            tags = serde_json::json!({});
        }
        let rec = tags
            .as_object_mut()
            .ok_or("tags.json 结构异常".to_string())?
            .entry(song.to_string())
            .or_insert(serde_json::json!({}));
        if let Some(obj) = rec.as_object_mut() {
            obj.insert("path".to_string(), serde_json::json!(path));
            obj.entry("tags".to_string()).or_insert(serde_json::json!([]));
        }
        self.save_tags(&tags)?;
        Ok(true)
    }

    /// 批量设置目录归属（一次性多首歌移动），返回实际更新的数量
    pub fn set_songs_path(&mut self, songs: &[String], path: &str) -> Result<usize, String> {
        let mut tags = self.load_tags();
        if !tags.is_object() {
            tags = serde_json::json!({});
        }
        let map = tags
            .as_object_mut()
            .ok_or("tags.json 结构异常".to_string())?;
        let mut updated = 0usize;
        for song in songs {
            let rec = map
                .entry(song.clone())
                .or_insert(serde_json::json!({}));
            if let Some(obj) = rec.as_object_mut() {
                let cur = obj.get("path").and_then(|v| v.as_str()).unwrap_or("");
                if cur != path {
                    obj.insert("path".to_string(), serde_json::json!(path));
                    obj.entry("tags".to_string()).or_insert(serde_json::json!([]));
                    updated += 1;
                }
            }
        }
        if updated > 0 {
            self.save_tags(&tags)?;
        }
        Ok(updated)
    }

    /// 仅当记录尚无目录归属时设置（P2P 自动归类用：首帧记录为空目录 → 补「{用户}传输」）
    pub fn set_song_path_if_empty(&mut self, song: &str, default_path: &str) -> Result<bool, String> {
        let mut tags = self.load_tags();
        if !tags.is_object() {
            tags = serde_json::json!({});
        }
        let rec = tags
            .as_object_mut()
            .ok_or("tags.json 结构异常".to_string())?
            .entry(song.to_string())
            .or_insert(serde_json::json!({}));
        let obj = rec.as_object_mut().ok_or("记录结构异常".to_string())?;
        let cur = obj.get("path").and_then(|v| v.as_str()).unwrap_or("");
        if !cur.is_empty() {
            return Ok(false);
        }
        obj.insert("path".to_string(), serde_json::json!(default_path));
        obj.entry("tags".to_string()).or_insert(serde_json::json!([]));
        self.save_tags(&tags)?;
        Ok(true)
    }

    /// 设置单首歌曲的多值标签（整体替换）
    pub fn set_song_tags(&mut self, song: &str, tags_list: &[String]) -> Result<bool, String> {
        let mut tags = self.load_tags();
        if !tags.is_object() {
            tags = serde_json::json!({});
        }
        let rec = tags
            .as_object_mut()
            .ok_or("tags.json 结构异常".to_string())?
            .entry(song.to_string())
            .or_insert(serde_json::json!({}));
        if let Some(obj) = rec.as_object_mut() {
            obj.insert("tags".to_string(), serde_json::json!(tags_list));
        }
        self.save_tags(&tags)?;
        Ok(true)
    }

    /// 目录是否系统目录（不可改名/删除）：内置 / 下载 / 喜欢 / 以"传输"结尾（P2P 目录）
    pub fn is_system_dir(path: &str) -> bool {
        path == "内置" || path == "下载" || path == "喜欢" || path.ends_with("传输")
    }

    /// 重命名目录（仅一级）：旧路径前缀 → 新路径；含子目录一并迁移。返回更新的记录数。
    pub fn rename_dir(&mut self, old_path: &str, new_name: &str) -> Result<usize, String> {
        if old_path.is_empty() {
            return Err("「未分类」不是可操作的目录".to_string());
        }
        if Self::is_system_dir(old_path) {
            return Err("系统目录不可重命名".to_string());
        }
        let new_name = new_name.trim();
        if new_name.is_empty() {
            return Err("新名称不能为空".to_string());
        }
        if new_name.contains('/') {
            return Err("新名称不能包含 /（一次只重命名一级目录）".to_string());
        }
        let new_path = match old_path.rfind('/') {
            Some(i) => format!("{}/{}", &old_path[..i], new_name),
            None => new_name.to_string(),
        };
        let prefix = format!("{}/", old_path);

        let mut tags = self.load_tags();
        if !tags.is_object() {
            tags = serde_json::json!({});
        }
        let mut updated = 0usize;
        let map = tags
            .as_object_mut()
            .ok_or("tags.json 结构异常".to_string())?;
        for val in map.values_mut() {
            let Some(obj) = val.as_object_mut() else {
                continue;
            };
            let Some(cur) = obj.get("path").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
                continue;
            };
            if cur == old_path || cur.starts_with(&prefix) {
                let rest = if cur == old_path {
                    String::new()
                } else {
                    cur[old_path.len()..].to_string()
                };
                obj.insert("path".to_string(), serde_json::json!(format!("{}{}", new_path, rest)));
                updated += 1;
            }
        }
        if updated > 0 {
            self.save_tags(&tags)?;
        }
        Ok(updated)
    }

    /// 删除目录（仅清除归属字段，不删文件）：该目录及其子目录下的歌曲归入「未分类」。返回影响的记录数。
    pub fn delete_dir(&mut self, path: &str) -> Result<usize, String> {
        if path.is_empty() {
            return Err("「未分类」不是可删除的目录".to_string());
        }
        if Self::is_system_dir(path) {
            return Err("系统目录不可删除".to_string());
        }
        let prefix = format!("{}/", path);

        let mut tags = self.load_tags();
        if !tags.is_object() {
            tags = serde_json::json!({});
        }
        let mut updated = 0usize;
        let map = tags
            .as_object_mut()
            .ok_or("tags.json 结构异常".to_string())?;
        for val in map.values_mut() {
            let Some(obj) = val.as_object_mut() else {
                continue;
            };
            let Some(cur) = obj.get("path").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
                continue;
            };
            if cur == path || cur.starts_with(&prefix) {
                obj.insert("path".to_string(), serde_json::json!(""));
                updated += 1;
            }
        }
        if updated > 0 {
            self.save_tags(&tags)?;
        }
        Ok(updated)
    }

    // ===== 播放集合（Set 语义，用户自定义播放列表） =====

    /// 设置播放集合（去重保留推入序 = 顺序模式的迭代序），并重置播放历史
    pub fn set_play_list(&mut self, songs: Vec<String>) {
        let mut seen = std::collections::HashSet::new();
        let dedup: Vec<String> = songs
            .into_iter()
            .filter(|s| seen.insert(s.clone()))
            .collect();
        self.active_list = Some(dedup);
        self.play_history.clear();
        self.history_index = -1;
        if let Some(list) = &self.active_list {
            self.current_song_index = list
                .iter()
                .position(|s| s == &self.track_name)
                .map(|i| i as i32)
                .unwrap_or(0);
        }
        // v4.12：播放范围变了 → 旧预摇结果可能已不在范围内，重摇
        self.ensure_pre_roll();
    }

    /// 清空播放集合：Some(空) 标记已清空 → 自然结束后停止自动切歌（手动切歌回落全库）
    pub fn clear_play_list(&mut self) {
        self.active_list = Some(Vec::new());
        self.ensure_pre_roll(); // v4.12：范围变空 → 预摇结果作废
    }

    /// 集合是否已清空（停止自动切歌）
    pub fn active_list_cleared(&self) -> bool {
        matches!(&self.active_list, Some(l) if l.is_empty())
    }

    /// 当前播放集合快照（推入序；None 时为空）
    pub fn active_list_songs(&self) -> Vec<String> {
        self.active_list.clone().unwrap_or_default()
    }

    /// 是否启用了自定义播放集合（含已清空的空集合）
    pub fn has_active_list(&self) -> bool {
        self.active_list.is_some()
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
        self.mixer = None;

        let stream = OutputStreamBuilder::from_device(device.clone())
            .map_err(|e| format!("创建设备输出流失败: {}", e))?
            .open_stream_or_fallback()
            .map_err(|e| format!("创建设备输出流失败: {}", e))?;
        self.mixer = Some(stream.mixer().clone());
        self._stream = Some(stream);
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

/// 解析歌曲记录 JSON 为 (path, tags, source)，兼容旧版单标签结构：
/// - String（旧式）→ 该字符串作为唯一标签
/// - Object{name}（旧式）→ name 作为唯一标签
/// - Object{path,tags,source}（v2）→ 直接读取
pub(crate) fn parse_song_record(value: &serde_json::Value) -> (String, Vec<String>, String) {
    match value {
        serde_json::Value::String(s) => (String::new(), vec![s.clone()], String::new()),
        serde_json::Value::Object(m) => {
            let path = m
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let source = m
                .get("source")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let tags: Vec<String> = m
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|t| t.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .or_else(|| {
                    m.get("name")
                        .and_then(|v| v.as_str())
                        .map(|s| vec![s.to_string()])
                })
                .unwrap_or_default();
            (path, tags, source)
        }
        _ => (String::new(), Vec::new(), String::new()),
    }
}

/// 内置歌曲判定：文件名去掉扩展名后以「 - 番茄钟」结尾（与前端 displayName 一致）
pub(crate) fn is_builtin_song(name: &str) -> bool {
    let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name);
    stem.trim_end().ends_with(" - 番茄钟")
}

/// 播放列表歌曲（带标签/目录/来源）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSong {
    pub name: String,
    /// 兼容旧字段：首个标签（无标签时为 "自定义"）
    pub tag: String,
    pub tag_color: Option<String>,
    /// v2：多值标签
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// v2：目录归属路径（"" = 未分类）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// v2：来源（builtin / download / p2p / 空）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ensure_scan_records_builtin_upgrade_and_skip_unknown() {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        std::fs::write(dir.path().join("内置歌 - 番茄钟.mp3"), b"x").expect("写入失败");
        std::fs::write(dir.path().join("普通歌.mp3"), b"x").expect("写入失败");
        let mut player = AudioPlayer::new();
        player.set_music_dir(dir.path().to_path_buf());
        // 预置旧版字符串记录（模拟旧种子：内置歌只有字符串标签、无 path）
        let mut tags = player.load_tags();
        tags["内置歌 - 番茄钟.mp3"] = serde_json::json!("学习");
        player.save_tags(&tags).unwrap();
        // 扫描：内置歌升级补「内置」目录；普通歌不建纯默认记录
        player.refresh_playlist();
        let (path, tags_vec, source) = player.get_song_meta("内置歌 - 番茄钟.mp3");
        assert_eq!(path, "内置", "内置歌应补「内置」目录");
        assert_eq!(tags_vec, vec!["学习"], "旧标签应保留");
        assert_eq!(source, "builtin");
        let (p, t, _) = player.get_song_meta("普通歌.mp3");
        assert_eq!(p, "", "未知文件不落盘记录（缺省未分类）");
        assert_eq!(t, Vec::<String>::new());
    }

    // ===== v4.12 预摇下一首 + 纯 peek =====
    //
    // 注意：`get_next_song` 会先 `refresh_playlist()`，而它在目录为空时会**清空歌单**，
    // 所以这些测试必须放**真实文件**（用合成歌单会被 refresh 抹掉）。
    // 断言刻意写成**与文件扫描顺序无关** —— "peek === 实际切歌"这个不变量本身不依赖顺序。

    /// 造一个带真实音频文件的临时播放器（文件内容是占位字节，本组测试不解码音频）
    fn player_with_files(files: &[&str], mode: PlayMode) -> (tempfile::TempDir, AudioPlayer) {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        for f in files {
            std::fs::write(dir.path().join(f), b"x").expect("写入失败");
        }
        let mut p = AudioPlayer::new();
        p.set_music_dir(dir.path().to_path_buf());
        p.play_mode = mode;
        p.refresh_playlist();
        assert_eq!(p.playlist.len(), files.len(), "临时目录里的歌应被扫描到");
        (dir, p)
    }

    /// ★ 核心不变量：`peek_next_song` 必须是**纯函数** —— 不推进播放历史。
    ///
    /// 历史背景：`get_next_song` 会 `play_history.push(...)` + 改 `history_index`，
    /// 所以拿它"偷看下一首"会让"上一首"重播当前歌（历史被污染）。预取靠 peek，必须保证这点。
    #[test]
    fn test_peek_next_song_is_pure_and_does_not_touch_history() {
        let (_dir, mut p) = player_with_files(&["a.mp3", "b.mp3", "c.mp3"], PlayMode::Order);
        p.track_name = p.playlist[0].clone();
        let history_before = p.play_history.clone();
        let index_before = p.history_index;
        let cur_idx_before = p.current_song_index;

        let peeked = p.peek_next_song();
        assert!(peeked.is_some(), "顺序模式应能预知下一首");

        assert_eq!(p.play_history, history_before, "peek 不得改动 play_history");
        assert_eq!(p.history_index, index_before, "peek 不得改动 history_index");
        assert_eq!(p.current_song_index, cur_idx_before, "peek 不得改动 current_song_index");
        // 再 peek 一次结果必须稳定（纯函数、无副作用）
        assert_eq!(p.peek_next_song(), peeked, "重复 peek 结果应一致");
    }

    /// 顺序模式：peek 与实际 get_next_song 必须一致（预取才可能命中）
    #[test]
    fn test_peek_matches_actual_next_in_order_mode() {
        let (_dir, mut p) = player_with_files(&["a.mp3", "b.mp3", "c.mp3"], PlayMode::Order);
        p.track_name = p.playlist[0].clone();
        let peeked = p.peek_next_song();
        let actual = p.get_next_song(false);
        assert_eq!(peeked, actual, "顺序模式下 peek 应与实际切歌一致");
    }

    /// Shuffle：预摇之后 peek 与实际切歌**必然一致**（这正是预摇存在的意义）
    #[test]
    fn test_shuffle_pre_roll_makes_peek_exact() {
        let (_dir, mut p) = player_with_files(&["a.mp3", "b.mp3", "c.mp3", "d.mp3"], PlayMode::Shuffle);
        p.track_name = p.playlist[0].clone();
        p.ensure_pre_roll();
        let peeked = p.peek_next_song();
        assert!(peeked.is_some(), "预摇后应能给出下一首");
        assert_ne!(peeked.as_deref(), Some(p.track_name.as_str()), "不应预摇到当前歌");
        let actual = p.get_next_song(false);
        assert_eq!(peeked, actual, "预摇结果必须与实际切歌一致（否则预取会白费）");
    }

    /// 单曲循环：下一首就是当前歌（可精确预知；调用方会跳过预取）
    #[test]
    fn test_peek_loop_returns_current_song() {
        let (_dir, mut p) = player_with_files(&["a.mp3", "b.mp3"], PlayMode::Loop);
        p.track_name = p.playlist[1].clone();
        p.current_song_index = 1;
        assert_eq!(p.peek_next_song().as_deref(), Some(p.track_name.as_str()));
    }

    /// 预摇结果不在播放范围内 → peek 返回 None（宁可"不知道"也不要瞎猜浪费带宽）
    #[test]
    fn test_peek_returns_none_when_pre_roll_stale() {
        let (_dir, mut p) = player_with_files(&["a.mp3", "b.mp3"], PlayMode::Shuffle);
        p.track_name = p.playlist[0].clone();
        p.ensure_pre_roll();
        assert!(p.peek_next_song().is_some());
        // 直接塞一个不在歌单里的预摇结果（模拟歌单已变）
        p.pre_rolled_next = Some("已删除的歌.mp3".to_string());
        assert_eq!(p.peek_next_song(), None, "预摇结果不在范围内时应返回 None");
    }

    /// 切到顺序模式应清掉预摇（顺序模式靠推导，不靠预摇）
    #[test]
    fn test_ensure_pre_roll_cleared_outside_shuffle() {
        let (_dir, mut p) = player_with_files(&["a.mp3", "b.mp3"], PlayMode::Shuffle);
        p.track_name = p.playlist[0].clone();
        p.ensure_pre_roll();
        assert!(p.pre_rolled_next.is_some());
        p.set_play_mode(PlayMode::Order);
        assert!(p.pre_rolled_next.is_none(), "非 Shuffle 模式不应保留预摇结果");
    }

    /// 空歌单不应 panic，且返回 None
    #[test]
    fn test_peek_empty_playlist() {
        let mut p = AudioPlayer::new();
        assert_eq!(p.peek_next_song(), None);
    }
    // ===== PlayMode 转换 =====

    #[test]
    fn test_play_mode_from_str_order() {
        assert_eq!(PlayMode::from_str("order"), PlayMode::Order);
    }

    #[test]
    fn test_play_mode_from_str_loop() {
        assert_eq!(PlayMode::from_str("loop"), PlayMode::Loop);
    }

    #[test]
    fn test_play_mode_from_str_shuffle() {
        assert_eq!(PlayMode::from_str("shuffle"), PlayMode::Shuffle);
    }

    #[test]
    fn test_play_mode_from_str_unknown_falls_back_to_shuffle() {
        // 任意无法识别的字符串都应回退到 Shuffle（与旧版默认行为一致）
        assert_eq!(PlayMode::from_str("unknown"), PlayMode::Shuffle);
        assert_eq!(PlayMode::from_str(""), PlayMode::Shuffle);
        assert_eq!(PlayMode::from_str("ORDER"), PlayMode::Shuffle); // 大小写敏感
    }

    #[test]
    fn test_play_mode_as_str() {
        assert_eq!(PlayMode::Shuffle.as_str(), "shuffle");
        assert_eq!(PlayMode::Order.as_str(), "order");
        assert_eq!(PlayMode::Loop.as_str(), "loop");
    }

    #[test]
    fn test_play_mode_roundtrip() {
        for mode in [PlayMode::Shuffle, PlayMode::Order, PlayMode::Loop] {
            let s = mode.as_str();
            assert_eq!(PlayMode::from_str(s), mode, "roundtrip 应保持一致");
        }
    }

    // ===== preset_colors =====

    #[test]
    fn test_preset_colors_contains_three_tags() {
        let colors = preset_colors();
        assert_eq!(colors.len(), 3, "应有 3 个预设标签");
        assert!(colors.contains_key("学习"));
        assert!(colors.contains_key("运动"));
        assert!(colors.contains_key("休息"));
    }

    #[test]
    fn test_preset_colors_values_are_hex_colors() {
        let colors = preset_colors();
        for (_, v) in colors.iter() {
            assert!(
                v.starts_with('#'),
                "颜色值应以 # 开头，实际: {}",
                v
            );
            assert_eq!(
                v.len(),
                7,
                "颜色值应为 #xxxxxx 7 字符，实际: {}",
                v
            );
        }
    }

    // ===== AudioPlayer 基础状态 =====

    #[test]
    fn test_audio_player_new_default_state() {
        let player = AudioPlayer::new();
        assert!(!player.is_initialized(), "新建 player 应未初始化");
        assert!(!player.is_playing(), "新建 player 应不在播放");
        assert_eq!(player.current_track(), "", "新建 player 曲目应为空");
        assert_eq!(player.current_duration(), 0, "新建 player 时长应为 0");
        assert_eq!(player.volume(), 1.0, "新建 player 默认音量应为 1.0");
        assert_eq!(player.play_mode(), PlayMode::Shuffle, "默认播放模式应为 Shuffle");
        assert!(player.playlist().is_empty(), "新建 player 播放列表应为空");
        assert!(player.current_device().is_none(), "新建 player 不应有设备 ID");
    }

    #[test]
    fn test_set_volume_clamps_to_range() {
        let mut player = AudioPlayer::new();
        // 超出上限应截断到 1.0
        player.set_volume(2.0);
        assert_eq!(player.volume(), 1.0);
        // 负值应截断到 0.0
        player.set_volume(-0.5);
        assert_eq!(player.volume(), 0.0);
        // 边界值
        player.set_volume(0.0);
        assert_eq!(player.volume(), 0.0);
        player.set_volume(1.0);
        assert_eq!(player.volume(), 1.0);
        // 中间值
        player.set_volume(0.5);
        assert_eq!(player.volume(), 0.5);
    }

    #[test]
    fn test_set_play_mode_updates_mode() {
        let mut player = AudioPlayer::new();
        player.set_play_mode(PlayMode::Order);
        assert_eq!(player.play_mode(), PlayMode::Order);
        player.set_play_mode(PlayMode::Loop);
        assert_eq!(player.play_mode(), PlayMode::Loop);
        player.set_play_mode(PlayMode::Shuffle);
        assert_eq!(player.play_mode(), PlayMode::Shuffle);
    }

    #[test]
    fn test_set_play_mode_shuffle_clears_history() {
        let mut player = AudioPlayer::new();
        // 设置为 Order 模式不报错
        player.set_play_mode(PlayMode::Order);
        // 切换到 Shuffle 应清理历史
        player.set_play_mode(PlayMode::Shuffle);
        assert_eq!(player.play_mode(), PlayMode::Shuffle);
    }

    #[test]
    fn test_get_position_without_sink_returns_offset() {
        // 没有 sink 时，position 应等于 position_offset（默认 0）
        let player = AudioPlayer::new();
        assert_eq!(player.get_position(), 0);
    }

    #[test]
    fn test_is_song_ended_without_sink_returns_false() {
        // 没有 sink 时不应判定播放结束（避免 seek fallback 的 skip_duration
        // 惰性跳过窗口被误判"播完"自动切歌的回归）
        let player = AudioPlayer::new();
        assert!(!player.is_song_ended(), "无 sink 时不应判定播放结束");
    }

    #[test]
    fn test_snapshot_reflects_state() {
        let player = AudioPlayer::new();
        let snap = player.snapshot();
        assert!(!snap.playing, "新建 player 快照 playing=false");
        assert_eq!(snap.name, "");
        assert_eq!(snap.duration, 0);
        assert_eq!(snap.play_mode, "shuffle");
        assert!(snap.has_prev, "has_prev 应始终为 true（与前端兼容）");
        assert_eq!(snap.volume, 1.0, "新建 player 默认音量 1.0");
    }

    #[test]
    fn test_snapshot_volume_reflects_set_volume() {
        let mut player = AudioPlayer::new();
        player.set_volume(0.3);
        let snap = player.snapshot();
        assert!((snap.volume - 0.3).abs() < f32::EPSILON, "快照音量应反映 set_volume");
    }

    // ===== 歌曲记录 v2（path/tags/source 解析与迁移） =====

    #[test]
    fn test_parse_song_record_v2_object() {
        let v = serde_json::json!({ "path": "导入/周杰伦", "tags": ["学习", "白噪音"], "source": "download" });
        let (path, tags, source) = parse_song_record(&v);
        assert_eq!(path, "导入/周杰伦");
        assert_eq!(tags, vec!["学习", "白噪音"]);
        assert_eq!(source, "download");
    }

    #[test]
    fn test_parse_song_record_legacy_string() {
        // 旧版单标签：String → 该字符串为唯一标签
        let (path, tags, source) = parse_song_record(&serde_json::json!("学习"));
        assert_eq!(path, "");
        assert_eq!(tags, vec!["学习"]);
        assert_eq!(source, "");
    }

    #[test]
    fn test_parse_song_record_legacy_object_name() {
        // 旧版 object 只有 name/color → name 作为唯一标签
        let v = serde_json::json!({ "name": "运动", "color": "#ff6b6b" });
        let (path, tags, source) = parse_song_record(&v);
        assert_eq!(path, "");
        assert_eq!(tags, vec!["运动"]);
        assert_eq!(source, "");
    }

    #[test]
    fn test_is_builtin_song_detection() {
        assert!(is_builtin_song("Opening - 番茄钟.mp3"), "带 - 番茄钟 后缀应为内置");
        assert!(is_builtin_song("我最爱的歌 - 番茄钟.m4a"));
        assert!(!is_builtin_song("普通歌.mp3"));
        assert!(!is_builtin_song("literally - 番茄钟x.mp3"), "后缀需完整匹配");
        assert!(!is_builtin_song(""));
    }

    // ===== 记录写入与目录操作（字段模拟树） =====

    fn temp_player_with_files(names: &[&str]) -> (tempfile::TempDir, AudioPlayer) {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        for n in names {
            std::fs::write(dir.path().join(n), b"fake audio bytes").expect("写入测试文件失败");
        }
        let mut player = AudioPlayer::new();
        player.set_music_dir(dir.path().to_path_buf());
        player.refresh_playlist();
        (dir, player)
    }

    #[test]
    fn test_ensure_song_record_creates_once() {
        let dir = tempfile::TempDir::new().expect("创建临时目录失败");
        std::fs::write(dir.path().join("a.mp3"), b"fake").expect("写入测试文件失败");
        let mut player = AudioPlayer::new();
        player.set_music_dir(dir.path().to_path_buf());
        // 未扫描（无记录）→ 首次创建成功
        assert!(player.ensure_song_record("a.mp3", "下载", "download").unwrap(), "首次应创建");
        // 再次调用不覆盖（用户移动过/已有记录）
        assert!(!player.ensure_song_record("a.mp3", "内置", "builtin").unwrap());
        let (path, _, source) = player.get_song_meta("a.mp3");
        assert_eq!(path, "下载");
        assert_eq!(source, "download");
        // 扫描刷新不应覆盖用户已设的目录（自动归类只作用于首次创建）
        player.refresh_playlist();
        assert_eq!(player.get_song_meta("a.mp3").0, "下载", "扫描不得覆盖已有记录");
    }

    #[test]
    fn test_set_song_path_and_batch() {
        let (_dir, mut player) = temp_player_with_files(&["a.mp3", "b.mp3"]);
        player.set_song_path("a.mp3", "合集/白噪音").unwrap();
        assert_eq!(player.get_song_meta("a.mp3").0, "合集/白噪音");
        let updated = player.set_songs_path(&["a.mp3".to_string(), "b.mp3".to_string()], "喜欢").unwrap();
        assert_eq!(updated, 2, "两首都应更新");
        assert_eq!(player.get_song_meta("a.mp3").0, "喜欢");
        assert_eq!(player.get_song_meta("b.mp3").0, "喜欢");
    }

    #[test]
    fn test_set_song_path_if_empty_only_sets_empty() {
        let (_dir, mut player) = temp_player_with_files(&["a.mp3", "b.mp3"]);
        player.set_song_path("a.mp3", "喜欢").unwrap();
        // a 已有目录 → 不覆盖；b 无目录 → 设置
        assert!(!player.set_song_path_if_empty("a.mp3", "CC传输").unwrap());
        assert!(player.set_song_path_if_empty("b.mp3", "CC传输").unwrap());
        assert_eq!(player.get_song_meta("a.mp3").0, "喜欢");
        assert_eq!(player.get_song_meta("b.mp3").0, "CC传输");
    }

    #[test]
    fn test_rename_dir_moves_subtree_and_guards_system() {
        let (_dir, mut player) = temp_player_with_files(&["a.mp3", "b.mp3"]);
        player.set_song_path("a.mp3", "导入/周杰伦/范特西").unwrap();
        player.set_song_path("b.mp3", "导入/周杰伦/叶惠美").unwrap();
        let updated = player.rename_dir("导入/周杰伦", "依然范特西").unwrap();
        assert_eq!(updated, 2);
        assert_eq!(player.get_song_meta("a.mp3").0, "导入/依然范特西/范特西");
        assert_eq!(player.get_song_meta("b.mp3").0, "导入/依然范特西/叶惠美");
        // 系统目录守卫
        assert!(player.rename_dir("下载", "我的下载").is_err(), "系统目录不可重命名");
        assert!(player.rename_dir("喜欢", "其他").is_err());
    }

    #[test]
    fn test_delete_dir_moves_to_uncategorized_and_guards_system() {
        let (_dir, mut player) = temp_player_with_files(&["a.mp3", "b.mp3"]);
        player.set_song_path("a.mp3", "旧目录/子目录").unwrap();
        player.set_song_path("b.mp3", "旧目录/其他").unwrap();
        let updated = player.delete_dir("旧目录").unwrap();
        assert_eq!(updated, 2);
        assert_eq!(player.get_song_meta("a.mp3").0, "");
        assert_eq!(player.get_song_meta("b.mp3").0, "");
        // 系统目录守卫
        assert!(player.delete_dir("内置").is_err());
        assert!(player.delete_dir("喜欢").is_err());
        assert!(player.delete_dir("CC传输").is_err());
    }

    // ===== 播放集合（Set 语义） =====

    #[test]
    fn test_set_play_list_dedup_and_order_next() {
        let (_dir, mut player) = temp_player_with_files(&["a.mp3", "b.mp3", "c.mp3"]);
        player.set_play_mode(PlayMode::Order);
        // 去重保序：重复的 b 只保留一个
        player.set_play_list(vec!["b.mp3".to_string(), "c.mp3".to_string(), "b.mp3".to_string()]);
        player.track_name = "b.mp3".to_string();
        assert_eq!(player.get_next_song(false).unwrap(), "c.mp3");
        // 模拟切歌后 track_name 更新，再取下一首 → 列表循环回到开头
        player.track_name = "c.mp3".to_string();
        assert_eq!(player.get_next_song(false).unwrap(), "b.mp3", "列表循环回到开头");
        // 列表外歌曲不出现
        player.track_name = "b.mp3".to_string();
        assert_ne!(player.get_next_song(false).unwrap(), "a.mp3");
    }

    #[test]
    fn test_clear_play_list_stops_auto_next_but_manual_falls_back() {
        let (_dir, mut player) = temp_player_with_files(&["a.mp3", "b.mp3"]);
        player.set_play_mode(PlayMode::Order);
        player.set_play_list(vec!["a.mp3".to_string(), "b.mp3".to_string()]);
        assert!(!player.active_list_cleared());
        player.clear_play_list();
        assert!(player.active_list_cleared());
        assert!(player.has_active_list());
        // 自然结束（auto_play=true）→ 停止
        player.track_name = "a.mp3".to_string();
        assert!(player.get_next_song(true).is_none(), "清空集合后自然结束应停止");
        // 手动切歌（auto_play=false）→ 回落全库
        assert!(player.get_next_song(false).is_some());
    }

    #[test]
    fn test_active_list_songs_snapshot() {
        let (_dir, mut player) = temp_player_with_files(&["a.mp3", "b.mp3"]);
        player.set_play_list(vec!["a.mp3".to_string(), "b.mp3".to_string()]);
        assert_eq!(player.active_list_songs(), vec!["a.mp3", "b.mp3"]);
        assert!(player.has_active_list());
        player.clear_play_list();
        assert_eq!(player.active_list_songs(), Vec::<String>::new());
    }
}
