"""
音乐播放器 - 带通讯功能
支持stdin/stdout与Electron通信，同时保留快捷键控制

状态模型：
- playing: 用户是否在播放会话中（True = 正在播放或暂停，False = 未开始）
- pause_program: 是否暂停（True = 暂停，False = 播放中）
- 准备阶段 = playing=True + pause_program=True（在歌曲开头暂停）

通信协议:
- Electron -> Python: JSON格式字符串，以换行符结束
  - {"command": "toggle"} - 暂停/播放切换
  - {"command": "next"} - 下一首
  - {"command": "prev"} - 上一首
  - {"command": "seek", "position": 30} - 跳转到指定位置(秒)
  - {"command": "set_volume", "volume": 0.8} - 设置音量(0-1)
  - {"command": "get_status"} - 获取当前状态
  - {"command": "get_devices"} - 获取输出设备列表
  - {"command": "set_device", "device_id": 5} - 设置输出设备
  - {"command": "set_play_mode", "mode": "shuffle"} - 设置播放模式
  - {"command": "get_play_mode"} - 获取播放模式
  
- Python -> Electron: JSON格式字符串，以换行符结束
  - {"event": "status", "data": {...}}
  - {"event": "track_change", "data": {"name": "song.mp3", "duration": 180}}
  - {"event": "play_state", "data": {"playing": true}}
  - {"event": "progress", "data": {"current": 30, "duration": 180}}
  - {"event": "devices", "data": {"devices": [...], "current": 5}}
  - {"event": "song_missing", "data": {"name": "song.mp3", "message": "原歌曲已消失"}}

快捷键:
- 右Ctrl + 右Shift: 暂停/继续
- 右Ctrl + 左/右方向键: 上一首/下一首
- 右Ctrl + 上/下方向键: 音量增/减
"""

import os
import sounddevice as sd
import soundfile as sf
import random
import threading
import time
import json
from pynput import keyboard
import sys

# 设置UTF-8编码
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')


# ============================================================================
# 全局状态类
# ============================================================================

class PlayerState:
    """播放器状态管理"""
    
    def __init__(self):
        # 播放状态
        self.playing = False          # 是否在播放会话中
        self.pause_program = True     # 是否暂停
        self.volume = 1.0
        self.current_time = 0
        self.duration = 0
        self.track_name = ""
        self.seek_position = None
        
        # 控制标志
        self.next_one = False
        self.prev_one = False
        self.exit_program = False
        self.device_changed = False
        
        # 播放列表
        self.directory_path = "music/"
        self.file_list = []           # 当前扫描到的文件列表
        self.order_playlist = []      # 顺序播放列表（按文件名排序）
        self.shuffled_playlist = []   # 随机播放列表
        self.playlist_index = -1      # 随机列表中的索引
        self.play_history = []        # 随机模式下的播放历史
        self.current_song_index = -1  # 当前歌曲在物理列表中的位置
        self.play_mode = 'shuffle'    # 'shuffle' | 'order'
        
        # 设备管理
        self.current_device_id = None
        
        # 预加载
        self.preloaded_data = None
        self.preloaded_fs = None
        self.preloaded_song = None
        
        # 初始化标志
        self.initialized = False
        
        # 线程锁
        self.lock = threading.Lock()
    
    # ========== 事件发送 ==========
    
    def send_event(self, event_type, data):
        """向stdout发送事件"""
        output = json.dumps({"event": event_type, "data": data}, ensure_ascii=False)
        sys.stdout.write(output + "\n")
        sys.stdout.flush()
    
    def send_status(self):
        """发送当前状态"""
        with self.lock:
            self.send_event("status", {
                "playing": self.playing and not self.pause_program,
                "name": self.track_name,
                "current": self.current_time,
                "duration": self.duration,
                "has_prev": len(self.play_history) > 1,
                "play_mode": self.play_mode
            })
    
    def send_devices(self):
        """发送设备列表"""
        devices = DeviceManager.get_output_devices()
        self.send_event("devices", {
            "devices": devices,
            "current": self.current_device_id
        })


# ============================================================================
# 设备管理模块
# ============================================================================

class DeviceManager:
    """音频输出设备管理"""
    
    EXCLUDED_HOST_APIS = ['WDM-KS', 'DirectSound']
    
    @staticmethod
    def get_output_devices():
        """获取所有可用输出设备"""
        devices = sd.query_devices()
        hostapis = sd.query_hostapis()
        output_devices = []
        
        for i, device in enumerate(devices):
            if device['max_output_channels'] > 0:
                hostapi_name = hostapis[device['hostapi']]['name']
                is_excluded = any(ex in hostapi_name for ex in DeviceManager.EXCLUDED_HOST_APIS)
                if not is_excluded:
                    output_devices.append({
                        "id": i,
                        "name": device['name'][:50],
                        "hostapi": hostapi_name,
                        "is_default": device.get('is_default', False)
                    })
        
        return output_devices
    
    @staticmethod
    def set_device(device_id):
        """设置输出设备"""
        try:
            devices = sd.query_devices()
            if 0 <= device_id < len(devices) and devices[device_id]['max_output_channels'] > 0:
                sd.default.device = device_id
                state.current_device_id = device_id
                print(f"已切换到设备: {devices[device_id]['name']}", file=sys.stderr)
                with state.lock:
                    state.device_changed = True
                return True
        except Exception as e:
            print(f"设置设备失败: {e}", file=sys.stderr)
        return False
    
    @staticmethod
    def select_initial_device(device_id=None):
        """选择初始输出设备"""
        devices = sd.query_devices()
        
        if device_id is not None:
            try:
                if 0 <= device_id < len(devices) and devices[device_id]['max_output_channels'] > 0:
                    sd.default.device = device_id
                    state.current_device_id = device_id
                    print(f"使用指定设备: {devices[device_id]['name']}", file=sys.stderr)
                    return
            except Exception as e:
                print(f"指定设备失败: {e}", file=sys.stderr)
        
        default_device = sd.query_devices(kind='output')
        state.current_device_id = default_device.get('index')
        print(f"使用默认输出设备: {default_device['name']}", file=sys.stderr)


# ============================================================================
# 播放列表管理模块
# ============================================================================

class PlaylistManager:
    """播放列表管理（支持热更新）"""
    
    SUPPORTED_FORMATS = ('.wav', '.mp3', '.flac', '.ogg', '.m4a')
    
    @staticmethod
    def scan_directory():
        """扫描音乐目录，返回文件列表"""
        files = []
        dir_path = state.directory_path
        if os.path.exists(dir_path) and os.path.isdir(dir_path):
            for filename in os.listdir(dir_path):
                filepath = os.path.join(dir_path, filename)
                if os.path.isfile(filepath) and filename.lower().endswith(PlaylistManager.SUPPORTED_FORMATS):
                    files.append(filename)
        return files
    
    @staticmethod
    def refresh_playlist():
        """
        热更新播放列表
        返回: (success, current_song_exists)
        """
        new_files = PlaylistManager.scan_directory()
        
        if not new_files:
            state.file_list = []
            state.order_playlist = []
            state.shuffled_playlist = []
            return False, False
        
        # 检查当前歌曲是否还存在
        current_song_exists = state.track_name in new_files if state.track_name else False
        
        # 更新文件列表
        state.file_list = new_files
        state.order_playlist = sorted(new_files)
        
        # 重建随机列表
        state.shuffled_playlist = new_files.copy()
        random.shuffle(state.shuffled_playlist)
        
        # 更新当前歌曲在物理列表中的索引
        if current_song_exists:
            state.current_song_index = state.order_playlist.index(state.track_name)
        else:
            state.current_song_index = -1
        
        return True, current_song_exists
    
    @staticmethod
    def init_playlist():
        """初始化播放列表"""
        state.file_list = PlaylistManager.scan_directory()
        
        if not state.file_list:
            state.order_playlist = []
            state.shuffled_playlist = []
            return False
        
        state.order_playlist = sorted(state.file_list)
        state.shuffled_playlist = state.file_list.copy()
        random.shuffle(state.shuffled_playlist)
        state.playlist_index = -1
        state.play_history = []
        state.current_song_index = -1
        
        return True
    
    @staticmethod
    def get_song_index(song_name):
        """获取歌曲在物理列表中的索引"""
        try:
            return state.order_playlist.index(song_name)
        except ValueError:
            return -1
    
    @staticmethod
    def song_exists(song_name):
        """检查歌曲文件是否存在"""
        if not song_name:
            return False
        filepath = os.path.join(state.directory_path, song_name)
        return os.path.exists(filepath)
    
    @staticmethod
    def get_random_song():
        """获取一首随机歌曲"""
        if not state.order_playlist:
            return None
        return random.choice(state.order_playlist)
    
    @staticmethod
    def get_next_song():
        """获取下一首歌（根据播放模式），支持热更新"""
        # 热更新检查
        PlaylistManager.refresh_playlist()
        
        if not state.order_playlist:
            return None, "no_music"
        
        if state.play_mode == 'shuffle':
            # 随机模式
            state.playlist_index += 1
            if state.playlist_index >= len(state.shuffled_playlist):
                random.shuffle(state.shuffled_playlist)
                state.playlist_index = 0
            state.play_history.append(state.playlist_index)
            song = state.shuffled_playlist[state.playlist_index]
            state.current_song_index = PlaylistManager.get_song_index(song)
            return song, None
        else:
            # 顺序模式
            if state.current_song_index < 0:
                state.current_song_index = 0
            else:
                state.current_song_index = (state.current_song_index + 1) % len(state.order_playlist)
            return state.order_playlist[state.current_song_index], None
    
    @staticmethod
    def get_prev_song():
        """获取上一首歌（根据播放模式），支持热更新"""
        # 热更新检查
        PlaylistManager.refresh_playlist()
        
        if not state.order_playlist:
            return None, "no_music"
        
        if state.play_mode == 'shuffle':
            # 随机模式
            if len(state.play_history) > 1:
                state.play_history.pop()
                state.playlist_index = state.play_history[-1]
            song = state.shuffled_playlist[state.playlist_index]
            state.current_song_index = PlaylistManager.get_song_index(song)
            return song, None
        else:
            # 顺序模式
            if state.current_song_index < 0:
                state.current_song_index = len(state.order_playlist) - 1
            else:
                state.current_song_index = (state.current_song_index - 1) % len(state.order_playlist)
            return state.order_playlist[state.current_song_index], None


# ============================================================================
# 快捷键管理模块
# ============================================================================

class HotkeyManager:
    """全局快捷键管理"""
    
    PAUSE_KEYS = {keyboard.Key.ctrl_r, keyboard.Key.shift_r}
    NEXT_KEYS = {keyboard.Key.ctrl_r, keyboard.Key.right}
    PREV_KEYS = {keyboard.Key.ctrl_r, keyboard.Key.left}
    VOL_UP_KEYS = {keyboard.Key.ctrl_r, keyboard.Key.up}
    VOL_DOWN_KEYS = {keyboard.Key.ctrl_r, keyboard.Key.down}
    
    current_keys = set()
    listener = None
    
    @staticmethod
    def key_to_str(key):
        if isinstance(key, keyboard.Key):
            return str(key)
        elif isinstance(key, keyboard.KeyCode):
            return key.char if key.char else str(key)
        return str(key)
    
    @staticmethod
    def keys_pressed(required_keys):
        for k in required_keys:
            if not any(HotkeyManager.key_to_str(k) == HotkeyManager.key_to_str(ck) 
                      for ck in HotkeyManager.current_keys):
                return False
        return True
    
    @staticmethod
    def on_press(key):
        HotkeyManager.current_keys.add(key)
        
        if HotkeyManager.keys_pressed(HotkeyManager.PAUSE_KEYS):
            with state.lock:
                state.pause_program = not state.pause_program
                print("暂停" if state.pause_program else "继续", file=sys.stderr)
        
        if HotkeyManager.keys_pressed(HotkeyManager.NEXT_KEYS):
            print("下一曲（快捷键）", file=sys.stderr)
            with state.lock:
                state.next_one = True
        
        if HotkeyManager.keys_pressed(HotkeyManager.PREV_KEYS):
            print("上一曲（快捷键）", file=sys.stderr)
            with state.lock:
                state.prev_one = True
        
        if HotkeyManager.keys_pressed(HotkeyManager.VOL_UP_KEYS):
            with state.lock:
                state.volume = min(1.0, round(state.volume + 0.1, 2))
                print(f"音量: {state.volume:.2f}", file=sys.stderr)
                state.send_event("volume_change", {"volume": state.volume})
        
        if HotkeyManager.keys_pressed(HotkeyManager.VOL_DOWN_KEYS):
            with state.lock:
                state.volume = max(0, round(state.volume - 0.1, 2))
                print(f"音量: {state.volume:.2f}", file=sys.stderr)
                state.send_event("volume_change", {"volume": state.volume})
    
    @staticmethod
    def on_release(key):
        HotkeyManager.current_keys.discard(key)
    
    @staticmethod
    def start():
        HotkeyManager.listener = keyboard.Listener(
            on_press=HotkeyManager.on_press,
            on_release=HotkeyManager.on_release
        )
        HotkeyManager.listener.start()
    
    @staticmethod
    def stop():
        if HotkeyManager.listener:
            HotkeyManager.listener.stop()


# ============================================================================
# 播放器核心
# ============================================================================

class Player:
    """播放器核心逻辑"""
    
    @staticmethod
    def get_song_duration(name):
        """获取歌曲时长"""
        try:
            info = sf.info(state.directory_path + name)
            return int(info.duration)
        except Exception as e:
            print(f"获取歌曲信息失败: {e}", file=sys.stderr)
            return 0
    
    @staticmethod
    def preload_audio(song):
        """预加载音频数据"""
        if not song:
            return
        try:
            file_path = os.path.join(state.directory_path, song)
            with sf.SoundFile(file_path) as f:
                state.preloaded_data = f.read(always_2d=True).astype('float32')
                state.preloaded_fs = f.samplerate
                state.preloaded_song = song
        except Exception as e:
            print(f"预加载音频数据失败: {e}", file=sys.stderr)
    
    @staticmethod
    def play(name, start_position=0):
        """
        播放一首歌，返回结果状态
        返回值: "done" | "next" | "prev" | "exit" | "error" | "device_error" | "song_missing" | (tuple)
        """
        if name is None:
            return "error"
        
        # 检查歌曲是否存在
        if not PlaylistManager.song_exists(name):
            return "song_missing"
        
        try:
            # 尝试使用预加载数据
            if state.preloaded_song == name and state.preloaded_data is not None:
                data = state.preloaded_data
                fs = state.preloaded_fs
                state.preloaded_data = None
                state.preloaded_song = None
                state.preloaded_fs = None
            else:
                file_path = os.path.join(state.directory_path, name)
                with sf.SoundFile(file_path) as f:
                    fs = f.samplerate
                    data = f.read(always_2d=True).astype('float32')
            
            # 确保数据格式正确
            if len(data.shape) == 1:
                data = data.reshape(-1, 1)
            
            channels = data.shape[1]
            total_frames = len(data)
            duration = total_frames / fs
            
            # 更新状态
            with state.lock:
                state.track_name = name
                state.duration = int(duration)
                if start_position == 0:
                    state.current_time = 0
                    if state.initialized:
                        state.send_event("track_change", {
                            "name": name,
                            "duration": state.duration,
                            "has_prev": len(state.play_history) > 1
                        })
            
            # 播放参数
            current_frame = int(start_position * fs) if start_position > 0 else 0
            chunk_size = 4096
            last_progress_time = int(current_frame / fs)
            last_progress_timestamp = time.time()
            progress_error_count = 0
            stream = None
            
            # 主播放循环
            while current_frame < total_frames:
                # 检查控制命令
                with state.lock:
                    if state.exit_program:
                        Player._close_stream(stream)
                        return "exit"
                    
                    if state.device_changed:
                        state.device_changed = False
                        Player._close_stream(stream)
                        return ("device_change", current_frame / fs)
                    
                    if state.next_one:
                        state.next_one = False
                        Player._close_stream(stream)
                        return "next"
                    
                    if state.prev_one:
                        state.prev_one = False
                        Player._close_stream(stream)
                        return "prev"
                    
                    if state.seek_position is not None:
                        seek_frame = int(state.seek_position * fs)
                        current_frame = max(0, min(seek_frame, total_frames - chunk_size))
                        state.seek_position = None
                        state.current_time = int(current_frame / fs)
                
                # 暂停处理
                is_paused = False
                with state.lock:
                    is_paused = state.pause_program
                
                if is_paused:
                    Player._close_stream(stream)
                    stream = None
                    
                    if not state.initialized:
                        state.initialized = True
                    
                    is_initial = (current_frame == 0)
                    if state.initialized and not is_initial:
                        with state.lock:
                            state.send_event("play_state", {"playing": False})
                    print("已暂停", file=sys.stderr, flush=True)
                    
                    # 暂停等待循环
                    while True:
                        with state.lock:
                            if state.exit_program:
                                return "exit"
                            if state.device_changed:
                                state.device_changed = False
                                return ("device_change", current_frame / fs)
                            if state.next_one:
                                state.next_one = False
                                return "next"
                            if state.prev_one:
                                state.prev_one = False
                                return "prev"
                            if not state.pause_program:
                                if state.initialized:
                                    state.send_event("play_state", {"playing": True})
                                break
                        time.sleep(0.05)
                    
                    print("继续播放", file=sys.stderr)
                else:
                    with state.lock:
                        if stream is None:
                            state.send_event("play_state", {"playing": True})
                
                # 创建/使用音频流
                if stream is None:
                    stream = sd.OutputStream(samplerate=fs, channels=channels, dtype='float32')
                    stream.start()
                
                # 写入音频数据
                end_frame = min(current_frame + chunk_size, total_frames)
                chunk = (data[current_frame:end_frame] * state.volume).astype('float32')
                stream.write(chunk)
                current_frame = end_frame
                
                # 进度更新
                current_time = int(current_frame / fs)
                current_timestamp = time.time()
                
                if current_time != last_progress_time:
                    time_diff = current_timestamp - last_progress_timestamp
                    if time_diff < 0.3:
                        progress_error_count += 1
                        if progress_error_count >= 3:
                            Player._close_stream(stream)
                            return "device_error"
                    else:
                        progress_error_count = 0
                    
                    last_progress_time = current_time
                    last_progress_timestamp = current_timestamp
                    with state.lock:
                        state.current_time = current_time
                        state.send_event("progress", {
                            "current": current_time,
                            "duration": int(duration)
                        })
            
            # 播放完成
            Player._close_stream(stream)
            return "done"
        
        except Exception as e:
            print(f"播放错误: {e}", file=sys.stderr)
            return "error"
    
    @staticmethod
    def _close_stream(stream):
        """安全关闭音频流"""
        if stream:
            try:
                stream.stop()
                stream.close()
            except:
                pass


# ============================================================================
# 命令处理
# ============================================================================

def process_command(cmd_obj):
    """处理来自Electron的命令"""
    command = cmd_obj.get("command")
    
    if command == "toggle":
        with state.lock:
            state.pause_program = not state.pause_program
            print("toggle: " + ("暂停" if state.pause_program else "恢复播放"), file=sys.stderr)
    
    elif command == "next":
        print("next命令", file=sys.stderr)
        with state.lock:
            state.next_one = True
    
    elif command == "prev":
        print("prev命令", file=sys.stderr)
        with state.lock:
            state.prev_one = True
    
    elif command == "seek":
        position = cmd_obj.get("position", 0)
        print(f"seek命令: {position}秒", file=sys.stderr)
        with state.lock:
            state.seek_position = position
    
    elif command == "set_volume":
        volume = cmd_obj.get("volume", 0.8)
        print(f"set_volume命令: {volume}", file=sys.stderr)
        with state.lock:
            state.volume = max(0, min(volume, 1))
    
    elif command == "get_status":
        state.send_status()
    
    elif command == "get_devices":
        state.send_devices()
    
    elif command == "set_device":
        device_id = cmd_obj.get("device_id")
        if device_id is not None and DeviceManager.set_device(device_id):
            state.send_devices()
    
    elif command == "set_play_mode":
        mode = cmd_obj.get("mode", "shuffle")
        print(f"set_play_mode命令: {mode}", file=sys.stderr)
        with state.lock:
            if mode in ['shuffle', 'order']:
                state.play_mode = mode
                if mode == 'shuffle':
                    state.playlist_index = -1
                    state.play_history = []
        state.send_status()
    
    elif command == "get_play_mode":
        with state.lock:
            state.send_event("play_mode", {"mode": state.play_mode})


def stdin_reader():
    """读取来自Electron的命令（守护线程）"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            process_command(cmd)
        except json.JSONDecodeError as e:
            print(f"JSON解析错误: {e}", file=sys.stderr)


# ============================================================================
# 主程序
# ============================================================================

def handle_song_missing(song_name):
    """处理歌曲消失的情况"""
    print(f"歌曲消失: {song_name}", file=sys.stderr)
    state.send_event("song_missing", {
        "name": song_name,
        "message": "原歌曲已消失"
    })
    time.sleep(3)  # 等待3秒
    return PlaylistManager.get_random_song()


def main():
    """主程序入口"""
    # 解析命令行参数
    initial_device_id = None
    if len(sys.argv) > 1:
        try:
            initial_device_id = int(sys.argv[1])
        except ValueError:
            pass
    
    # 初始化设备
    DeviceManager.select_initial_device(initial_device_id)
    
    # 启动快捷键监听
    HotkeyManager.start()
    
    # 启动命令读取线程
    stdin_thread = threading.Thread(target=stdin_reader, daemon=True)
    stdin_thread.start()
    
    # 初始化播放列表
    if not PlaylistManager.init_playlist():
        print("没有找到音乐文件", file=sys.stderr)
        state.send_event("ready", {"name": "", "duration": 0, "has_prev": False})
        state.send_event("no_music", {"message": "music文件夹中没有音乐文件"})
        while True:
            with state.lock:
                if state.exit_program:
                    break
            time.sleep(0.1)
        HotkeyManager.stop()
        print("程序已退出", file=sys.stderr)
        sys.exit(0)
    
    # 初始化第一首歌
    song, _ = PlaylistManager.get_next_song()
    if song:
        state.track_name = song
        state.duration = Player.get_song_duration(song)
        state.current_time = 0
        state.playing = True
        state.pause_program = True
    
    # 发送 ready 事件
    state.send_event("ready", {
        "name": state.track_name,
        "duration": state.duration,
        "has_prev": len(state.play_history) > 1
    })
    
    # 预加载
    if song:
        threading.Thread(target=Player.preload_audio, args=(song,), daemon=True).start()
    
    # 主循环
    current_song = song
    current_position = 0
    
    while True:
        with state.lock:
            if state.exit_program:
                break
        
        if not state.playing or current_song is None:
            time.sleep(0.05)
            continue
        
        # 播放
        result = Player.play(current_song, current_position)
        
        if result == "exit":
            break
        
        elif result == "next":
            current_song, error = PlaylistManager.get_next_song()
            current_position = 0
            if error == "no_music":
                state.send_event("no_music", {"message": "没有可播放的音乐"})
                state.playing = False
        
        elif result == "prev":
            current_song, error = PlaylistManager.get_prev_song()
            current_position = 0
            if error == "no_music":
                state.send_event("no_music", {"message": "没有可播放的音乐"})
                state.playing = False
        
        elif result == "done":
            current_song, error = PlaylistManager.get_next_song()
            current_position = 0
            if error == "no_music":
                state.send_event("no_music", {"message": "没有可播放的音乐"})
                state.playing = False
        
        elif result == "song_missing":
            # 歌曲消失，提示并3秒后随机跳转
            current_song = handle_song_missing(current_song)
            current_position = 0
            if current_song:
                state.duration = Player.get_song_duration(current_song)
                state.track_name = current_song
                state.send_event("track_change", {
                    "name": current_song,
                    "duration": state.duration,
                    "has_prev": len(state.play_history) > 1
                })
            else:
                state.send_event("no_music", {"message": "没有可播放的音乐"})
                state.playing = False
        
        elif result == "error":
            with state.lock:
                state.playing = False
            state.send_event("play_error", {"message": "播放失败，请切换输出设备后重启番茄钟"})
        
        elif result == "device_error":
            with state.lock:
                state.playing = False
            state.send_event("play_error", {"message": "输出设备异常，请切换输出设备后重试"})
        
        elif isinstance(result, tuple) and result[0] == "device_change":
            current_position = result[1]
            state.send_event("track_change", {
                "name": current_song,
                "duration": state.duration,
                "has_prev": len(state.play_history) > 1
            })
    
    HotkeyManager.stop()
    print("程序已退出", file=sys.stderr)


# 全局状态实例
state = PlayerState()

if __name__ == "__main__":
    main()
