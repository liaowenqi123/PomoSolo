use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::modules::audio_player::AudioPlayer;
use crate::modules::cloud_auth::Session;
use crate::modules::foreground_inspection::DetectionState;

/// 音乐播放器状态
pub struct MusicState {
    pub player: tokio::sync::Mutex<AudioPlayer>,
    pub initialized: std::sync::atomic::AtomicBool,
}

impl MusicState {
    pub fn new() -> Self {
        Self {
            player: tokio::sync::Mutex::new(AudioPlayer::new()),
            initialized: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

/// 当前正在下载的歌曲
#[derive(Debug, Clone)]
pub struct CurrentSong {
    pub title: String,
    pub artist: String,
}

/// 音乐榜单/下载状态（对应 Electron songDownloader 单例）
pub struct ChartsState {
    /// 内部可变状态（包含下载器路径、API Key、队列等）
    pub inner: tokio::sync::Mutex<ChartsInner>,
}

pub struct ChartsInner {
    /// manual_downloader.exe 路径
    pub downloader_path: Option<PathBuf>,
    /// DeepSeek API Key
    pub api_key: Option<String>,
    /// 是否正在下载
    pub is_downloading: bool,
    /// 当前正在下载的歌曲
    pub current_song: Option<CurrentSong>,
    /// 下载队列
    pub queue: VecDeque<crate::commands::charts::DownloadTask>,
}

impl ChartsState {
    pub fn new() -> Self {
        Self {
            inner: tokio::sync::Mutex::new(ChartsInner {
                downloader_path: None,
                api_key: None,
                is_downloading: false,
                current_song: None,
                queue: VecDeque::new(),
            }),
        }
    }
}

/// 应用全局状态（替代 Electron main/state.js）
pub struct AppState {
    /// 计时器是否运行中
    pub timer_running: Mutex<bool>,
    /// 专注模式是否开启
    pub focus_mode_enabled: Mutex<bool>,
    /// 前台检测是否就绪
    pub foreground_ready: Mutex<bool>,
    /// 云端会话
    pub cloud_session: Mutex<Option<Session>>,
    /// 前台检测状态
    pub detection_state: Arc<DetectionState>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            timer_running: Mutex::new(false),
            focus_mode_enabled: Mutex::new(false),
            foreground_ready: Mutex::new(false),
            cloud_session: Mutex::new(None),
            detection_state: Arc::new(DetectionState::default()),
        }
    }
}
