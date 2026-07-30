"""
音乐播放器 - 带通讯功能
支持stdin/stdout与Electron通信

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
"""

import os
import sounddevice as sd
import soundfile as sf
import random
import threading
import time
import json
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
        self.jump_to_song = None      # 跳转到指定歌曲（歌曲名）
        
        # 播放列表
        self.directory_path = "music/"
        self.file_list = []           # 当前扫描到的文件列表
        self.order_playlist = []      # 顺序播放列表（按文件名排序，用于顺序播放）
        
        # 播放历史表（双向可扩展）
        self.play_history = []        # 播放历史 [(song_name, source), ...]
        self.history_index = -1       # 当前在历史表中的位置 (-1 表示未开始)
        
        self.current_song_index = -1  # 当前歌曲在物理列表中的位置
        self.play_mode = 'shuffle'    # 'shuffle' | 'order' | 'loop'
        
        # 设备管理
        self.current_device_id = None
        
        # 预加载
        self.preloaded_data = None
        self.preloaded_fs = None
        self.preloaded_song = None
        
        # stdin 线程引用（用于检测父进程是否存活）
        self.stdin_thread = None
        
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
                "has_prev": True,  # 始终可用（新逻辑：历史表为空时生成新歌）
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
    def load_tags():
        """加载歌曲标签（返回完整数据，包括自定义标签）"""
        tags_path = os.path.join(state.directory_path, "tags.json")
        print(f"[DEBUG] 标签文件路径: {tags_path}, 存在: {os.path.exists(tags_path)}", file=sys.stderr)
        print(f"[DEBUG] 当前工作目录: {os.getcwd()}", file=sys.stderr)
        try:
            if os.path.exists(tags_path):
                with open(tags_path, 'r', encoding='utf-8') as f:
                    tags = json.load(f)
                    print(f"[DEBUG] 加载的标签: {tags}", file=sys.stderr)
                    return tags
        except Exception as e:
            print(f"加载标签失败: {e}", file=sys.stderr)
        return {}
    
    @staticmethod
    def get_song_tag(song_name):
        """获取歌曲标签（返回 {name, color} 格式）"""
        tags = PlaylistManager.load_tags()
        # 跳过 _customTags 字段
        if song_name.startswith('_'):
            return {"name": "自定义", "color": None}
        
        tag_data = tags.get(song_name)
        if tag_data is None:
            return {"name": "自定义", "color": None}
        
        # 兼容旧格式（纯字符串）
        if isinstance(tag_data, str):
            # 检查是否是自定义标签
            custom_tags = tags.get("_customTags", {})
            if tag_data in custom_tags:
                return {"name": tag_data, "color": custom_tags[tag_data]}
            # 预设标签使用默认颜色
            preset_colors = {
                "学习": "#64b4ff",
                "运动": "#ff9664",
                "休息": "#64e664"
            }
            return {"name": tag_data, "color": preset_colors.get(tag_data)}
        
        # 新格式（对象）
        return tag_data
    
    @staticmethod
    def get_custom_tags():
        """获取自定义标签配置"""
        tags = PlaylistManager.load_tags()
        return tags.get("_customTags", {})
    
    @staticmethod
    def add_custom_tag(tag_name, color):
        """添加自定义标签"""
        tags_path = os.path.join(state.directory_path, "tags.json")
        try:
            tags = PlaylistManager.load_tags()
            if "_customTags" not in tags:
                tags["_customTags"] = {}
            tags["_customTags"][tag_name] = color
            with open(tags_path, 'w', encoding='utf-8') as f:
                json.dump(tags, f, ensure_ascii=False, indent=2)
            print(f"[DEBUG] 自定义标签已添加: {tag_name} -> {color}", file=sys.stderr)
            return True, None
        except Exception as e:
            print(f"添加自定义标签失败: {e}", file=sys.stderr)
            return False, str(e)
    
    @staticmethod
    def delete_custom_tag(tag_name):
        """删除自定义标签"""
        tags_path = os.path.join(state.directory_path, "tags.json")
        try:
            tags = PlaylistManager.load_tags()
            if "_customTags" in tags and tag_name in tags["_customTags"]:
                del tags["_customTags"][tag_name]
                with open(tags_path, 'w', encoding='utf-8') as f:
                    json.dump(tags, f, ensure_ascii=False, indent=2)
                print(f"[DEBUG] 自定义标签已删除: {tag_name}", file=sys.stderr)
                return True, None
            return False, "标签不存在"
        except Exception as e:
            print(f"删除自定义标签失败: {e}", file=sys.stderr)
            return False, str(e)
    
    @staticmethod
    def update_song_tag(song_name, tag_name, tag_color=None):
        """更新歌曲标签（存储 {name, color} 格式）"""
        tags_path = os.path.join(state.directory_path, "tags.json")
        try:
            # 加载现有标签
            tags = PlaylistManager.load_tags()
            
            # 预设标签的默认颜色
            preset_colors = {
                "学习": "#64b4ff",
                "运动": "#ff9664",
                "休息": "#64e664"
            }
            
            # 确定颜色
            if tag_color is None:
                # 检查是否是自定义标签
                custom_tags = tags.get("_customTags", {})
                if tag_name in custom_tags:
                    tag_color = custom_tags[tag_name]
                else:
                    tag_color = preset_colors.get(tag_name)
            
            # 存储新格式
            tags[song_name] = {
                "name": tag_name,
                "color": tag_color
            }
            
            # 保存到文件
            with open(tags_path, 'w', encoding='utf-8') as f:
                json.dump(tags, f, ensure_ascii=False, indent=2)
            print(f"[DEBUG] 标签已更新: {song_name} -> {tag_name} ({tag_color})", file=sys.stderr)
            return True, None
        except Exception as e:
            print(f"更新标签失败: {e}", file=sys.stderr)
            return False, str(e)
    
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
            return False, False
        
        # 检查当前歌曲是否还存在
        current_song_exists = state.track_name in new_files if state.track_name else False
        
        # 更新文件列表和顺序播放列表
        state.file_list = new_files
        state.order_playlist = sorted(new_files)
        
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
            return False
        
        # 初始化顺序播放列表
        state.order_playlist = sorted(state.file_list)
        
        # 重置播放历史
        state.play_history = []
        state.history_index = -1
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
    def delete_song(song_name):
        """删除歌曲文件"""
        if not song_name:
            return {"delete_result": "failed", "delete_error": "歌曲名不能为空"}
        
        # 检查是否是当前已加载的歌曲（不管是否在播放）
        if state.track_name == song_name:
            return {"delete_result": "failed", "delete_error": "无法删除当前已加载的歌曲"}
        
        # 构建文件路径
        filepath = os.path.join(state.directory_path, song_name)
        
        # 检查文件是否存在
        if not os.path.exists(filepath):
            return {"delete_result": "failed", "delete_error": "歌曲文件不存在"}
        
        try:
            # 删除文件
            os.remove(filepath)
            print(f"已删除歌曲: {song_name}", file=sys.stderr)
            
            # 刷新播放列表
            PlaylistManager.refresh_playlist()
            
            return {"delete_result": "success"}
        except Exception as e:
            print(f"删除歌曲失败: {e}", file=sys.stderr)
            return {"delete_result": "failed", "delete_error": str(e)}
    
    @staticmethod
    def get_random_song():
        """获取一首随机歌曲（初始播放）"""
        if not state.order_playlist:
            return None
        return random.choice(state.order_playlist)
    
    @staticmethod
    def get_next_song(auto_play=False):
        """
        获取下一首歌（根据播放模式）
        Args:
            auto_play: 是否为自动播放（True）还是手动点击下一首（False）
        """
        # 热更新检查
        PlaylistManager.refresh_playlist()
        
        if not state.order_playlist:
            return None, "no_music"
        
        # ========== 单曲循环模式 ==========
        if state.play_mode == 'loop':
            if state.current_song_index < 0:
                state.current_song_index = 0
            # 无论手动还是自动，都返回当前歌曲（重复播放）
            return state.order_playlist[state.current_song_index], None
        
        # ========== 处理历史表 ==========
        current_song = None
        if state.history_index >= 0 and state.history_index < len(state.play_history):
            current_song = state.play_history[state.history_index][0]
        
        # 如果是自动播放，清理当前位置之后的历史
        if auto_play and state.history_index >= 0:
            # 删除当前位置之后的所有记录
            state.play_history = state.play_history[:state.history_index + 1]
        
        # 生成下一首歌
        next_song = None
        if state.play_mode == 'shuffle':
            # 随机模式：随机选择一首（避免与当前相同）
            if len(state.order_playlist) > 1:
                while True:
                    next_song = random.choice(state.order_playlist)
                    if next_song != current_song:
                        break
            else:
                next_song = state.order_playlist[0]
        else:
            # 顺序模式：按顺序下一首
            if state.current_song_index < 0:
                state.current_song_index = 0
            else:
                state.current_song_index = (state.current_song_index + 1) % len(state.order_playlist)
            next_song = state.order_playlist[state.current_song_index]
        
        # 添加到历史表末尾
        state.play_history.append((next_song, 'manual' if not auto_play else 'auto'))
        state.history_index = len(state.play_history) - 1
        
        # 更新物理索引
        state.current_song_index = PlaylistManager.get_song_index(next_song)
        
        return next_song, None
    
    @staticmethod
    def get_prev_song():
        """获取上一首歌（手动点击）"""
        # 热更新检查
        PlaylistManager.refresh_playlist()
        
        if not state.order_playlist:
            return None, "no_music"
        
        # ========== 单曲循环模式 ==========
        if state.play_mode == 'loop':
            if state.current_song_index < 0:
                state.current_song_index = 0
            # 单曲循环下，上一首也是重复当前
            return state.order_playlist[state.current_song_index], None
        
        # ========== 检查历史表 ==========
        if state.history_index > 0:
            # 历史表中还有前一首
            state.history_index -= 1
            prev_song = state.play_history[state.history_index][0]
            state.current_song_index = PlaylistManager.get_song_index(prev_song)
            return prev_song, None
        
        # ========== 历史表开头，生成新歌 ==========
        current_song = None
        if state.history_index >= 0 and state.history_index < len(state.play_history):
            current_song = state.play_history[state.history_index][0]
        
        new_song = None
        if state.play_mode == 'shuffle':
            # 随机模式：随机一首（避免与当前相同）
            if len(state.order_playlist) > 1:
                while True:
                    new_song = random.choice(state.order_playlist)
                    if new_song != current_song:
                        break
            else:
                new_song = state.order_playlist[0]
        else:
            # 顺序模式：按顺序上一首
            if state.current_song_index < 0:
                state.current_song_index = len(state.order_playlist) - 1
            else:
                state.current_song_index = (state.current_song_index - 1) % len(state.order_playlist)
            new_song = state.order_playlist[state.current_song_index]
        
        # 添加到历史表开头
        state.play_history.insert(0, (new_song, 'manual'))
        state.history_index = 0  # 保持在开头
        
        # 更新物理索引
        state.current_song_index = PlaylistManager.get_song_index(new_song)
        
        return new_song, None


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
                            "has_prev": True  # 始终可用
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
                # 检查 stdin_thread 是否存活（父进程崩溃时线程会死）
                if state.stdin_thread and not state.stdin_thread.is_alive():
                    print("stdin_thread 已死亡，退出播放", file=sys.stderr)
                    Player._close_stream(stream)
                    return "exit"
                
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
                        # 检查 stdin_thread 是否存活
                        if state.stdin_thread and not state.stdin_thread.is_alive():
                            print("stdin_thread 已死亡，退出暂停", file=sys.stderr)
                            return "exit"
                        
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
        # 通知前端音量变化（原由快捷键触发，现由命令直接发送）
        state.send_event("volume_change", {"volume": state.volume})
    
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
            if mode in ['shuffle', 'order', 'loop']:
                state.play_mode = mode
                if mode == 'shuffle':
                    # 重置播放历史
                    state.play_history = []
                    state.history_index = -1
        state.send_status()
    
    elif command == "get_play_mode":
        with state.lock:
            state.send_event("play_mode", {"mode": state.play_mode})
    
    elif command == "get_playlist":
        """获取播放列表"""
        PlaylistManager.refresh_playlist()
        with state.lock:
            # 加载标签
            tags = PlaylistManager.load_tags()
            # 预设标签的默认颜色
            preset_colors = {
                "学习": "#64b4ff",
                "运动": "#ff9664",
                "休息": "#64e664"
            }
            # 构建带标签的歌曲列表
            songs_with_tags = []
            for song in state.order_playlist:
                tag_data = tags.get(song)
                if tag_data is None:
                    songs_with_tags.append({
                        "name": song,
                        "tag": "自定义",
                        "tagColor": None
                    })
                elif isinstance(tag_data, str):
                    # 兼容旧格式
                    custom_tags = tags.get("_customTags", {})
                    color = custom_tags.get(tag_data, preset_colors.get(tag_data))
                    songs_with_tags.append({
                        "name": song,
                        "tag": tag_data,
                        "tagColor": color
                    })
                else:
                    # 新格式
                    songs_with_tags.append({
                        "name": song,
                        "tag": tag_data.get("name", "自定义"),
                        "tagColor": tag_data.get("color")
                    })
            state.send_event("playlist", {
                "songs": songs_with_tags,
                "current_song": state.track_name,
                "current_index": state.current_song_index
            })
    
    elif command == "play_song":
        """播放指定歌曲"""
        song_name = cmd_obj.get("name")
        if song_name:
            print(f"play_song命令: {song_name}", file=sys.stderr)
            with state.lock:
                # 设置跳转歌曲标志
                state.jump_to_song = song_name
                state.next_one = True  # 触发切歌
    
    elif command == "delete_song":
        """删除指定歌曲"""
        song_name = cmd_obj.get("name")
        if song_name:
            print(f"delete_song命令: {song_name}", file=sys.stderr)
            result = PlaylistManager.delete_song(song_name)
            state.send_event("status", result)
    
    elif command == "update_tag":
        """更新歌曲标签"""
        song_name = cmd_obj.get("name")
        tag_name = cmd_obj.get("tag")
        tag_color = cmd_obj.get("color")  # 可选的颜色参数
        if song_name and tag_name:
            print(f"update_tag命令: {song_name} -> {tag_name} ({tag_color})", file=sys.stderr)
            success, error = PlaylistManager.update_song_tag(song_name, tag_name, tag_color)
            state.send_event("tag_updated", {
                "success": success,
                "error": error,
                "name": song_name,
                "tag": tag_name,
                "color": tag_color
            })
    
    elif command == "get_custom_tags":
        """获取自定义标签配置"""
        custom_tags = PlaylistManager.get_custom_tags()
        state.send_event("custom_tags", {
            "customTags": custom_tags
        })
    
    elif command == "add_custom_tag":
        """添加自定义标签"""
        tag_name = cmd_obj.get("name")
        color = cmd_obj.get("color")
        if tag_name and color:
            print(f"add_custom_tag命令: {tag_name} -> {color}", file=sys.stderr)
            success, error = PlaylistManager.add_custom_tag(tag_name, color)
            state.send_event("custom_tag_added", {
                "success": success,
                "error": error,
                "name": tag_name,
                "color": color
            })
    
    elif command == "delete_custom_tag":
        """删除自定义标签"""
        tag_name = cmd_obj.get("name")
        if tag_name:
            print(f"delete_custom_tag命令: {tag_name}", file=sys.stderr)
            success, error = PlaylistManager.delete_custom_tag(tag_name)
            state.send_event("custom_tag_deleted", {
                "success": success,
                "error": error,
                "name": tag_name
            })


def stdin_reader():
    """读取来自Electron的命令（守护线程）"""
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
                process_command(cmd)
            except json.JSONDecodeError as e:
                print(f"JSON解析错误: {e}", file=sys.stderr)
    except Exception as e:
        print(f"stdin 异常: {e}", file=sys.stderr)
    
    print("stdin 已断开，线程结束", file=sys.stderr)


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
    
    # 启动命令读取线程
    stdin_thread = threading.Thread(target=stdin_reader, daemon=True)
    stdin_thread.start()
    state.stdin_thread = stdin_thread  # 保存引用供播放循环检查
    
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
        print("程序已退出", file=sys.stderr)
        sys.exit(0)
    
    # 初始化第一首歌（不加入历史表）
    if state.order_playlist:
        song = random.choice(state.order_playlist) if state.play_mode == 'shuffle' else state.order_playlist[0]
        state.track_name = song
        state.duration = Player.get_song_duration(song)
        state.current_time = 0
        state.playing = True
        state.pause_program = True
        state.current_song_index = PlaylistManager.get_song_index(song)
    
    # 发送 ready 事件
    state.send_event("ready", {
        "name": state.track_name,
        "duration": state.duration,
        "has_prev": True  # 始终可用
    })
    
    # 预加载
    if song:
        threading.Thread(target=Player.preload_audio, args=(song,), daemon=True).start()
    
    # 主循环
    current_song = song
    current_position = 0
    
    while True:
        # 检查 stdin_reader 线程是否存活（父进程崩溃时线程会死）
        if not stdin_thread.is_alive():
            print("stdin_reader 线程已死亡，退出进程", file=sys.stderr)
            break
        
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
            # 检查是否需要跳转到指定歌曲
            jump_song = None
            with state.lock:
                if state.jump_to_song:
                    jump_song = state.jump_to_song
                    state.jump_to_song = None
            
            if jump_song:
                # 跳转到指定歌曲
                PlaylistManager.refresh_playlist()
                if jump_song in state.order_playlist:
                    current_song = jump_song
                    state.current_song_index = state.order_playlist.index(jump_song)
                else:
                    # 歌曲不存在，随机选一首
                    current_song = PlaylistManager.get_random_song()
            else:
                current_song, error = PlaylistManager.get_next_song()
                if error == "no_music":
                    state.send_event("no_music", {"message": "没有可播放的音乐"})
                    state.playing = False
            current_position = 0
        
        elif result == "prev":
            current_song, error = PlaylistManager.get_prev_song()
            current_position = 0
            if error == "no_music":
                state.send_event("no_music", {"message": "没有可播放的音乐"})
                state.playing = False
        
        elif result == "done":
            # 自动播放下一首
            current_song, error = PlaylistManager.get_next_song(auto_play=True)
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
                    "has_prev": True  # 始终可用
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
                "has_prev": True  # 始终可用
            })

    print("程序已退出", file=sys.stderr)


# 全局状态实例
state = PlayerState()

if __name__ == "__main__":
    main()
