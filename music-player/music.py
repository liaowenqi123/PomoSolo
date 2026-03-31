"""
音乐播放器 - 带通讯功能
支持stdin/stdout与Electron通信，同时保留快捷键控制

状态模型（简化）：
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
  
- Python -> Electron: JSON格式字符串，以换行符结束
  - {"event": "status", "data": {"playing": true, "name": "song.mp3", "current": 30, "duration": 180}}
  - {"event": "track_change", "data": {"name": "song.mp3", "duration": 180}}
  - {"event": "play_state", "data": {"playing": true}}
  - {"event": "progress", "data": {"current": 30, "duration": 180}}
  - {"event": "devices", "data": {"devices": [...], "current": 5}}

快捷键:
- 右Ctrl + 右Shift: 暂停/继续
- 右Ctrl + Q: 退出程序
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

# 设置UTF-8编码（用于与Electron通信）
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# ============ 全局状态 ============
class PlayerState:
    def __init__(self):
        self.playing = False          # 是否在播放会话中
        self.pause_program = True     # 是否暂停（初始为暂停状态）
        self.next_one = False
        self.prev_one = False
        self.exit_program = False
        self.volume = 1.0
        self.current_time = 0
        self.duration = 0
        self.track_name = ""
        self.seek_position = None
        self.play_history = []
        self.shuffled_playlist = []
        self.playlist_index = -1
        self.file_list = []
        self.directory_path = "music/"
        self.current_device_id = None
        self.device_changed = False
        self.lock = threading.Lock()
        
        # 播放模式：'shuffle' 随机 | 'order' 顺序循环
        self.play_mode = 'shuffle'
        self.order_playlist = []  # 顺序播放列表（不打乱，按文件名排序）
        self.current_song_index = -1  # 当前歌曲在物理列表(order_playlist)中的位置
        
        # 预加载的音频数据
        self.preloaded_data = None
        self.preloaded_fs = None
        self.preloaded_song = None
        
        # 初始化完成标志（用于避免在 ready 后发送初始化事件）
        self.initialized = False
        
    def send_event(self, event_type, data):
        """向stdout发送事件（给Electron）"""
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
        devices = get_output_devices()
        self.send_event("devices", {
            "devices": devices,
            "current": self.current_device_id
        })

state = PlayerState()

# ============ 输出设备管理 ============
EXCLUDED_HOST_APIS = [
    'WDM-KS',
    'DirectSound',
]

def get_output_devices():
    """获取所有输出设备列表"""
    devices = sd.query_devices()
    hostapis = sd.query_hostapis()
    output_devices = []
    
    for i, device in enumerate(devices):
        if device['max_output_channels'] > 0:
            hostapi_name = hostapis[device['hostapi']]['name']
            is_excluded = any(excluded in hostapi_name for excluded in EXCLUDED_HOST_APIS)
            if not is_excluded:
                output_devices.append({
                    "id": i,
                    "name": device['name'][:50],
                    "hostapi": hostapi_name,
                    "is_default": device.get('is_default', False)
                })
    
    return output_devices

def set_output_device(device_id):
    """设置输出设备"""
    try:
        devices = sd.query_devices()
        if 0 <= device_id < len(devices):
            if devices[device_id]['max_output_channels'] > 0:
                sd.default.device = device_id
                state.current_device_id = device_id
                print(f"已切换到设备: {devices[device_id]['name']}", file=sys.stderr)
                with state.lock:
                    state.device_changed = True
                return True
        return False
    except Exception as e:
        print(f"设置设备失败: {e}", file=sys.stderr)
        return False

def select_output_device(initial_device_id=None):
    """选择输出设备"""
    devices = sd.query_devices()
    
    if initial_device_id is not None:
        try:
            if 0 <= initial_device_id < len(devices):
                if devices[initial_device_id]['max_output_channels'] > 0:
                    sd.default.device = initial_device_id
                    state.current_device_id = initial_device_id
                    print(f"使用指定设备: {devices[initial_device_id]['name']}", file=sys.stderr)
                    return initial_device_id
        except Exception as e:
            print(f"指定设备失败: {e}", file=sys.stderr)
    
    default_device = sd.query_devices(kind='output')
    state.current_device_id = default_device['index'] if 'index' in default_device else None
    print(f"使用默认输出设备: {default_device['name']}", file=sys.stderr)
    return None

select_output_device()

# ============ 快捷键定义 ============
pause_key = {keyboard.Key.ctrl_r, keyboard.Key.shift_r}
next_key = {keyboard.Key.ctrl_r, keyboard.Key.right}
prev_key = {keyboard.Key.ctrl_r, keyboard.Key.left}
voice_up = {keyboard.Key.ctrl_r, keyboard.Key.up}
voice_down = {keyboard.Key.ctrl_r, keyboard.Key.down}

current_keys = set()
listener = None

def key_to_str(key):
    if isinstance(key, keyboard.Key):
        return str(key)
    elif isinstance(key, keyboard.KeyCode):
        return key.char if key.char else str(key)

def keys_pressed(required_keys):
    for k in required_keys:
        found = False
        for ck in current_keys:
            if key_to_str(k) == key_to_str(ck):
                found = True
                break
        if not found:
            return False
    return True

def on_key_press(key):
    current_keys.add(key)
    
    if keys_pressed(pause_key):
        with state.lock:
            state.pause_program = not state.pause_program
            print("暂停" if state.pause_program else "继续", file=sys.stderr)
    
    if keys_pressed(next_key):
        print("下一曲（快捷键）", file=sys.stderr)
        with state.lock:
            state.next_one = True
    
    if keys_pressed(prev_key):
        print("上一曲（快捷键）", file=sys.stderr)
        with state.lock:
            state.prev_one = True
    
    if keys_pressed(voice_up):
        with state.lock:
            state.volume = min(1.0, round(state.volume + 0.1, 2))
            print(f"音量: {state.volume:.2f}", file=sys.stderr)
            state.send_event("volume_change", {"volume": state.volume})
    
    if keys_pressed(voice_down):
        with state.lock:
            state.volume = max(0, round(state.volume - 0.1, 2))
            print(f"音量: {state.volume:.2f}", file=sys.stderr)
            state.send_event("volume_change", {"volume": state.volume})

def on_key_release(key):
    current_keys.discard(key)

def start_keyboard_listener():
    global listener
    listener = keyboard.Listener(on_press=on_key_press, on_release=on_key_release)
    listener.start()

start_keyboard_listener()

# ============ 文件列表管理 ============
def list_files_in_directory(directory_path):
    file_names = []
    if os.path.exists(directory_path) and os.path.isdir(directory_path):
        for filename in os.listdir(directory_path):
            if os.path.isfile(os.path.join(directory_path, filename)):
                if filename.lower().endswith(('.wav', '.mp3', '.flac', '.ogg', '.m4a')):
                    file_names.append(filename)
    return file_names

def init_shuffled_playlist():
    """初始化播放列表（随机和顺序）"""
    state.file_list = list_files_in_directory(state.directory_path)
    if not state.file_list:
        state.shuffled_playlist = []
        state.order_playlist = []
        return False
    
    # 随机播放列表
    state.shuffled_playlist = state.file_list.copy()
    random.shuffle(state.shuffled_playlist)
    state.playlist_index = -1
    state.play_history = []
    
    # 顺序播放列表（按文件名排序）
    state.order_playlist = sorted(state.file_list)
    state.order_index = -1
    
    return True

def get_song_index(song_name):
    """获取歌曲在物理列表中的索引"""
    try:
        return state.order_playlist.index(song_name)
    except ValueError:
        return -1

def get_next_song():
    """获取下一首歌（根据播放模式）"""
    if not state.shuffled_playlist:
        if not init_shuffled_playlist():
            return None
    
    if state.play_mode == 'shuffle':
        # 随机模式
        state.playlist_index += 1
        if state.playlist_index >= len(state.shuffled_playlist):
            random.shuffle(state.shuffled_playlist)
            state.playlist_index = 0
        state.play_history.append(state.playlist_index)
        song = state.shuffled_playlist[state.playlist_index]
        # 追踪当前歌曲在物理列表中的位置
        state.current_song_index = get_song_index(song)
        return song
    else:
        # 顺序模式：基于当前歌曲位置播放下一首
        if state.current_song_index < 0:
            state.current_song_index = 0
        else:
            state.current_song_index = (state.current_song_index + 1) % len(state.order_playlist)
        return state.order_playlist[state.current_song_index]

def get_prev_song():
    """获取上一首歌（根据播放模式）"""
    if not state.shuffled_playlist:
        if not init_shuffled_playlist():
            return None
    
    if state.play_mode == 'shuffle':
        # 随机模式
        if len(state.play_history) > 1:
            state.play_history.pop()
            state.playlist_index = state.play_history[-1]
        song = state.shuffled_playlist[state.playlist_index]
        # 追踪当前歌曲在物理列表中的位置
        state.current_song_index = get_song_index(song)
        return song
    else:
        # 顺序模式：基于当前歌曲位置播放上一首
        if state.current_song_index < 0:
            state.current_song_index = len(state.order_playlist) - 1
        else:
            state.current_song_index = (state.current_song_index - 1) % len(state.order_playlist)
        return state.order_playlist[state.current_song_index]

# ============ 播放函数 ============
def play_a_song(name, start_position=0):
    """播放一首歌，处理所有状态（暂停、切歌等）"""
    if name is None:
        return "error"
    
    try:
        # 检查是否有预加载的数据可以使用
        if state.preloaded_song == name and state.preloaded_data is not None:
            data = state.preloaded_data
            fs = state.preloaded_fs
            state.preloaded_data = None
            state.preloaded_song = None
            state.preloaded_fs = None
        else:
            file_path = state.directory_path + name
            with sf.SoundFile(file_path) as f:
                fs = f.samplerate
                data = f.read(always_2d=True).astype('float32')
        
        if len(data.shape) == 1:
            data = data.reshape(-1, 1)
        
        channels = data.shape[1]
        total_frames = len(data)
        duration = total_frames / fs
        
        with state.lock:
            state.track_name = name
            state.duration = int(duration)
            if start_position == 0:
                state.current_time = 0
                # 只有在已初始化后才发送 track_change（避免在 ready 后发送初始化事件）
                if state.initialized:
                    state.send_event("track_change", {
                        "name": name,
                        "duration": state.duration,
                        "has_prev": len(state.play_history) > 1
                    })
        
        current_frame = int(start_position * fs) if start_position > 0 else 0
        chunk_size = 4096
        last_progress_time = int(current_frame / fs)
        last_progress_timestamp = time.time()
        progress_error_count = 0
        
        # ========== 主播放循环（包含暂停处理）==========
        # 注意：stream 在需要时才创建，暂停状态下不创建
        stream = None
        
        while current_frame < total_frames:
            # 检查控制命令
            with state.lock:
                if state.exit_program:
                    if stream:
                        stream.stop()
                        stream.close()
                    return "exit"
                
                if state.device_changed:
                    state.device_changed = False
                    if stream:
                        stream.stop()
                        stream.close()
                    return ("device_change", current_frame / fs)
                
                if state.next_one:
                    state.next_one = False
                    if stream:
                        stream.stop()
                        stream.close()
                    return "next"
                
                if state.prev_one:
                    state.prev_one = False
                    if stream:
                        stream.stop()
                        stream.close()
                    return "prev"
                
                # 检查seek
                if state.seek_position is not None:
                    seek_frame = int(state.seek_position * fs)
                    current_frame = max(0, min(seek_frame, total_frames - chunk_size))
                    state.seek_position = None
                    state.current_time = int(current_frame / fs)
            
            # ========== 检查暂停 ==========
            pause_local = False
            with state.lock:
                pause_local = state.pause_program
            
            if pause_local:
                # 暂停状态：关闭stream，进入暂停循环
                if stream:
                    stream.stop()
                    stream.close()
                    stream = None
                
                # 第一次进入暂停时，标记初始化完成
                # 这样后续的用户操作会正常发送事件
                if not state.initialized:
                    state.initialized = True
                
                # 只有在非初始化暂停时才发送 play_state
                # 初始化暂停（current_frame == 0）不发送事件，前端通过 musicGetStatus 获取初始状态
                is_initial_pause = (current_frame == 0)
                if state.initialized and not is_initial_pause:
                    with state.lock:
                        state.send_event("play_state", {"playing": False})
                print("已暂停", file=sys.stderr, flush=True)
                
                # 暂停循环：等待恢复或其他命令
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
                            # 恢复播放
                            if state.initialized:
                                state.send_event("play_state", {"playing": True})
                            break
                    time.sleep(0.05)
                
                print("继续播放", file=sys.stderr)
                # 恢复播放后，会在下面的写入数据部分重新创建stream
            else:
                # 播放状态：发送play_state（如果是刚从暂停恢复）
                with state.lock:
                    if stream is None:
                        # 刚进入播放状态，发送事件
                        state.send_event("play_state", {"playing": True})
            
            # ========== 写入音频数据 ==========
            # 如果stream不存在，创建它
            if stream is None:
                stream = sd.OutputStream(
                    samplerate=fs,
                    channels=channels,
                    dtype='float32'
                )
                stream.start()
            
            # 写入数据
            end_frame = min(current_frame + chunk_size, total_frames)
            chunk = (data[current_frame:end_frame] * state.volume).astype('float32')
            stream.write(chunk)
            current_frame = end_frame
            
            # 更新进度（每秒发送一次）
            current_time = int(current_frame / fs)
            current_timestamp = time.time()
            
            if current_time != last_progress_time:
                time_diff = current_timestamp - last_progress_timestamp
                if time_diff < 0.3:
                    progress_error_count += 1
                    if progress_error_count >= 3:
                        if stream:
                            stream.stop()
                            stream.close()
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
        
        # 播放完毕
        if stream:
            stream.close()
        return "done"
            
    except Exception as e:
        print(f"播放错误: {e}", file=sys.stderr)
        return "error"

# ============ 命令处理 ============
def process_command(command_obj):
    """处理来自Electron的命令"""
    command = command_obj.get("command")
    
    if command == "toggle":
        with state.lock:
            if state.pause_program:
                # 当前暂停，恢复播放
                state.pause_program = False
                print("toggle: 恢复播放", file=sys.stderr)
            else:
                # 当前播放中，暂停
                state.pause_program = True
                print("toggle: 暂停", file=sys.stderr)
    
    elif command == "next":
        print("next命令", file=sys.stderr)
        with state.lock:
            state.next_one = True
    
    elif command == "prev":
        print("prev命令", file=sys.stderr)
        with state.lock:
            state.prev_one = True
    
    elif command == "seek":
        position = command_obj.get("position", 0)
        print(f"seek命令: {position}秒", file=sys.stderr)
        with state.lock:
            state.seek_position = position
    
    elif command == "set_volume":
        volume = command_obj.get("volume", 0.8)
        print(f"set_volume命令: {volume}", file=sys.stderr)
        with state.lock:
            state.volume = max(0, min(volume, 1))
    
    elif command == "get_status":
        state.send_status()
    
    elif command == "get_devices":
        state.send_devices()
    
    elif command == "set_device":
        device_id = command_obj.get("device_id")
        if device_id is not None:
            if set_output_device(device_id):
                state.send_devices()
    
    elif command == "set_play_mode":
        mode = command_obj.get("mode", "shuffle")
        print(f"set_play_mode命令: {mode}", file=sys.stderr)
        with state.lock:
            if mode in ['shuffle', 'order']:
                state.play_mode = mode
                # 切换到随机模式时重置随机列表（但保持 current_song_index）
                if mode == 'shuffle':
                    state.playlist_index = -1
                    state.play_history = []
                # 切换到顺序模式时，current_song_index 已经追踪了当前歌曲位置，无需重置
        # 发送状态更新
        state.send_status()
    
    elif command == "get_play_mode":
        with state.lock:
            state.send_event("play_mode", {"mode": state.play_mode})

def stdin_reader():
    """读取来自Electron的命令"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
            process_command(command)
        except json.JSONDecodeError as e:
            print(f"JSON解析错误: {e}", file=sys.stderr)

def get_song_duration(name):
    """获取歌曲时长"""
    try:
        info = sf.info(state.directory_path + name)
        return int(info.duration)
    except Exception as e:
        print(f"获取歌曲信息失败: {e}", file=sys.stderr)
        return 0

def init_first_song():
    """初始化第一首歌（准备状态）"""
    song = get_next_song()
    if song:
        state.track_name = song
        state.duration = get_song_duration(song)
        state.current_time = 0
        state.playing = True      # 进入播放会话
        state.pause_program = True  # 但处于暂停状态
        return song
    return None

def preload_audio_data(song):
    """预加载音频数据"""
    if song:
        try:
            file_path = state.directory_path + song
            with sf.SoundFile(file_path) as f:
                data = f.read(always_2d=True)
                state.preloaded_data = data.astype('float32')
                state.preloaded_fs = f.samplerate
                state.preloaded_song = song
        except Exception as e:
            print(f"预加载音频数据失败: {e}", file=sys.stderr)

# ============ 主程序 ============
if __name__ == "__main__":
    # 读取命令行参数（设备ID）
    initial_device_id = None
    if len(sys.argv) > 1:
        try:
            initial_device_id = int(sys.argv[1])
        except ValueError:
            pass
    
    select_output_device(initial_device_id)
    
    # 启动stdin读取线程
    stdin_thread = threading.Thread(target=stdin_reader, daemon=True)
    stdin_thread.start()
    
    # 初始化播放列表
    has_music = init_shuffled_playlist()
    
    if not has_music:
        print("没有找到音乐文件", file=sys.stderr)
        # 先发送 ready 事件，让加载页面能正常结束
        state.send_event("ready", {
            "name": "", 
            "duration": 0,
            "has_prev": False
        })
        # 再发送 no_music 事件
        state.send_event("no_music", {"message": "music文件夹中没有音乐文件"})
        while True:
            with state.lock:
                if state.exit_program:
                    break
            time.sleep(0.1)
        if listener:
            listener.stop()
        print("程序已退出", file=sys.stderr)
        sys.exit(0)
    
    # 初始化第一首歌（准备状态 = 暂停状态）
    current_song = init_first_song()
    current_position = 0
    
    # 发送 ready 事件（触发 Electron 加载主页面）
    state.send_event("ready", {
        "name": state.track_name, 
        "duration": state.duration,
        "has_prev": len(state.play_history) > 1
    })
    
    # 预加载音频数据
    if current_song:
        preload_thread = threading.Thread(target=preload_audio_data, args=(current_song,), daemon=True)
        preload_thread.start()
    
    # ========== 主循环（简化）==========
    while True:
        with state.lock:
            if state.exit_program:
                break
        
        # 主循环只需要检查 playing 状态
        # play_a_song 内部会处理暂停
        playing_local = False
        with state.lock:
            playing_local = state.playing
        
        if not playing_local:
            time.sleep(0.05)
            continue
        
        if current_song is None:
            print("没有找到音乐文件", file=sys.stderr)
            time.sleep(1)
            continue
        
        # 播放当前歌曲
        result = play_a_song(current_song, current_position)
        
        if result == "exit":
            break
        elif result == "next":
            current_song = get_next_song()
            current_position = 0
        elif result == "prev":
            current_song = get_prev_song()
            current_position = 0
        elif isinstance(result, tuple) and result[0] == "device_change":
            current_position = result[1]
            state.send_event("track_change", {
                "name": current_song,
                "duration": state.duration,
                "has_prev": len(state.play_history) > 1
            })
        elif result == "done":
            current_song = get_next_song()
            current_position = 0
        elif result == "error":
            with state.lock:
                state.playing = False
            state.send_event("play_error", {"message": "播放失败，请切换输出设备后重启番茄钟"})
            print("播放失败，已停止", file=sys.stderr)
        elif result == "device_error":
            with state.lock:
                state.playing = False
            state.send_event("play_error", {"message": "输出设备异常，请切换输出设备后重试"})
            print("设备异常，已停止", file=sys.stderr)
    
    if listener:
        listener.stop()
    print("程序已退出", file=sys.stderr)