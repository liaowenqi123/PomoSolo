"""
前台窗口检测程序 - Electron 集成版
通过 stdin/stdout 与 Electron 通信

通信协议:
- Electron -> Python: JSON格式字符串，以换行符结束
  - {"command": "start"} - 开始检测
  - {"command": "stop"} - 停止检测
  - {"command": "get_status"} - 获取当前状态
  - {"command": "set_api_key", "api_key": "xxx"} - 设置 API Key（运行时）
  - {"command": "add_whitelist", "keyword": "xxx"} - 添加到白名单
  - {"command": "add_blacklist", "keyword": "xxx"} - 添加到黑名单
  
- Python -> Electron: JSON格式字符串，以换行符结束
  - {"event": "ready", "data": {}}
  - {"event": "entertainment_detected", "data": {"window_title": "xxx"}}
  - {"event": "status", "data": {"running": true, "current_window": "xxx"}}
  - {"event": "error", "data": {"message": "xxx"}}
"""

import ctypes
import time
import json
import os
import sys
import threading
import requests

# 设置UTF-8编码（用于与Electron通信）
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# Windows API 函数
user32 = ctypes.windll.user32


def get_base_path():
    """获取基础路径，兼容 PyInstaller 打包"""
    if getattr(sys, 'frozen', False):
        # 打包后：使用 exe 所在目录
        return os.path.dirname(sys.executable)
    else:
        # 开发环境：使用脚本所在目录
        return os.path.dirname(os.path.abspath(__file__))


BASE_PATH = get_base_path()
MODEL_CONFIG_FILE = os.path.join(BASE_PATH, "model_config.json")
LIST_CONFIG_FILE = os.path.join(BASE_PATH, "list_config.json")


# ============ 默认配置 ============

DEFAULT_MODEL_CONFIG = {
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-chat"
}

DEFAULT_LIST_CONFIG = {
    "whitelist": [
        "文件资源管理器",
        "Visual Studio Code",
        "PowerShell",
        "PowerPoint",
        "演示文稿",
        "番茄钟"
    ],
    "blacklist": [
        "bilibili",
        "抖音",
        "快手",
        "斗鱼",
        "虎牙"
    ],
    "history": {}
}


# ============ 配置加载/保存 ============

def load_json_file(file_path, default_config):
    """加载 JSON 配置文件，不存在则创建默认配置"""
    if os.path.exists(file_path):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    # 文件不存在或读取失败，创建默认配置
    save_json_file(file_path, default_config)
    return default_config.copy()


def save_json_file(file_path, config):
    """保存 JSON 配置文件"""
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=4)


def load_model_config():
    """加载模型配置（base_url, model）"""
    return load_json_file(MODEL_CONFIG_FILE, DEFAULT_MODEL_CONFIG)


def load_list_config():
    """加载列表配置（黑白名单、历史记录）"""
    return load_json_file(LIST_CONFIG_FILE, DEFAULT_LIST_CONFIG)


def save_list_config(config):
    """保存列表配置"""
    save_json_file(LIST_CONFIG_FILE, config)


def validate_api_key(api_key, model_config):
    """
    验证 API key 是否有效
    返回: (is_valid, error_message)
    注意：无效时不报错，只是返回 False，让后续逻辑跳过 AI 验证
    """
    # 检查是否是空值
    if not api_key:
        return False, None
    
    # 尝试一次简单请求验证（用 requests 直接调用，避免 openai 包的巨大体积）
    try:
        base_url = model_config.get("base_url", "https://api.deepseek.com")
        model = model_config.get("model", "deepseek-chat")
        
        response = requests.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 5
            },
            timeout=10
        )
        response.raise_for_status()
        return True, None
    except Exception as e:
        # 验证失败，静默处理
        return False, None


# ============ 窗口检测 ============

def get_foreground_window_title():
    """获取前台窗口的标题"""
    hwnd = user32.GetForegroundWindow()
    if hwnd == 0:
        return None
    
    length = user32.GetWindowTextLengthW(hwnd)
    if length == 0:
        return ""
    
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def check_list(window_title, keyword_list):
    """检查窗口标题是否包含关键字列表中的任意关键字"""
    for keyword in keyword_list:
        if keyword in window_title:
            return True
    return False


def check_is_entertainment(window_title, api_key, model_config, list_config, api_key_valid=True):
    """
    检查窗口是否为娱乐类应用
    优先级：白名单 -> 黑名单 -> 历史记录 -> AI API
    
    返回: (结果, 来源, 关键字, list_config)
    - 结果: "是" / "不是" / "查询失败"
    - 来源: "whitelist" / "blacklist" / "history" / "ai" / "no_api"
    - 关键字: 匹配到的关键字（黑名单时为匹配的关键字，history时为完整窗口标题）
    """
    # 1. 先查白名单（优先级最高）
    whitelist = list_config.get("whitelist", [])
    for keyword in whitelist:
        if keyword in window_title:
            return "不是", "whitelist", keyword, list_config
    
    # 2. 再查黑名单
    blacklist = list_config.get("blacklist", [])
    for keyword in blacklist:
        if keyword in window_title:
            return "是", "blacklist", keyword, list_config
    
    # 3. 查历史记录
    history = list_config.get("history", {})
    if window_title in history:
        return history[window_title], "history", window_title, list_config
    
    # 4. API Key 无效时，跳过 AI 验证，默认返回"不是"
    if not api_key_valid:
        return "不是", "no_api", window_title, list_config
    
    # 5. 调用 AI API（用 requests 直接调用，避免 openai 包的巨大体积）
    try:
        base_url = model_config.get("base_url", "https://api.deepseek.com")
        model = model_config.get("model", "deepseek-chat")
        
        system_prompt = """你是一个窗口分类助手。根据用户提供的窗口名称，判断该应用是否属于娱乐类（如游戏、视频、音乐、直播、社交媒体等）。

请仅输出 JSON 格式：
{
    "is_entertainment": "是" 或 "不是"
}

不确定时回答"不是"。"""

        user_prompt = f"窗口名称：{window_title}"

        response = requests.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "response_format": {"type": "json_object"}
            },
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        result = json.loads(data["choices"][0]["message"]["content"])
        is_entertainment = result.get("is_entertainment", "不是")
        
        # 保存到历史记录
        list_config["history"][window_title] = is_entertainment
        save_list_config(list_config)
        
        return is_entertainment, "ai", window_title, list_config
    except Exception as e:
        print(f"AI查询失败: {e}", file=sys.stderr)
        return "查询失败", "ai", window_title, list_config


# ============ 状态管理 ============

class DetectionState:
    def __init__(self):
        self.running = False  # 是否正在检测
        self.should_exit = False  # 是否应该退出
        self.current_window = ""  # 当前窗口标题
        self.last_title = None  # 上次检测的窗口标题
        self.lock = threading.Lock()
        
        # 配置
        self.api_key = None  # API Key（运行时设置，内存中）
        self.model_config = None
        self.list_config = None
        self.api_key_valid = False  # API Key 是否有效
    
    def send_event(self, event_type, data):
        """向stdout发送事件（给Electron）"""
        output = json.dumps({"event": event_type, "data": data}, ensure_ascii=False)
        sys.stdout.write(output + "\n")
        sys.stdout.flush()
    
    def send_status(self):
        """发送当前状态"""
        with self.lock:
            self.send_event("status", {
                "running": self.running,
                "current_window": self.current_window
            })


state = DetectionState()


# ============ 命令处理 ============

def process_command(command_obj):
    """处理来自Electron的命令"""
    command = command_obj.get("command")
    
    if command == "start":
        with state.lock:
            if not state.running:
                state.running = True
                print("检测已启动", file=sys.stderr)
                state.send_event("status", {"running": True, "current_window": ""})
    
    elif command == "stop":
        with state.lock:
            if state.running:
                state.running = False
                state.current_window = ""
                state.last_title = None
                print("检测已停止", file=sys.stderr)
                state.send_event("status", {"running": False, "current_window": ""})
    
    elif command == "get_status":
        state.send_status()
    
    elif command == "set_api_key":
        # 运行时设置 API Key
        api_key = command_obj.get("api_key")
        with state.lock:
            state.api_key = api_key
            # 验证新的 API Key
            if api_key:
                is_valid, _ = validate_api_key(api_key, state.model_config)
                state.api_key_valid = is_valid
                if is_valid:
                    print("API key 设置成功，AI 识别功能可用", file=sys.stderr)
                else:
                    print("API key 无效，AI 识别功能不可用", file=sys.stderr)
            else:
                state.api_key_valid = False
                print("API key 已清除", file=sys.stderr)
            state.send_event("api_key_updated", {"valid": state.api_key_valid})
    
    elif command == "add_whitelist":
        keyword = command_obj.get("keyword")
        if keyword:
            with state.lock:
                if keyword not in state.list_config["whitelist"]:
                    state.list_config["whitelist"].append(keyword)
                    save_list_config(state.list_config)
                    print(f"已添加到白名单: {keyword}", file=sys.stderr)
                    state.send_event("whitelist_updated", {"keyword": keyword})
    
    elif command == "add_blacklist":
        keyword = command_obj.get("keyword")
        if keyword:
            with state.lock:
                if keyword not in state.list_config["blacklist"]:
                    state.list_config["blacklist"].append(keyword)
                    save_list_config(state.list_config)
                    print(f"已添加到黑名单: {keyword}", file=sys.stderr)
                    state.send_event("blacklist_updated", {"keyword": keyword})
    
    elif command == "mark_history_not":
        # 将历史记录中的某项标记为"不是"娱乐
        window_title = command_obj.get("window_title")
        if window_title and window_title in state.list_config.get("history", {}):
            with state.lock:
                state.list_config["history"][window_title] = "不是"
                save_list_config(state.list_config)
                print(f"已将历史记录标记为非娱乐: {window_title}", file=sys.stderr)
                state.send_event("history_updated", {"window_title": window_title, "result": "不是"})
    
    elif command == "move_blacklist_to_whitelist":
        # 将黑名单中的关键字移到白名单
        keyword = command_obj.get("keyword")
        if keyword:
            with state.lock:
                # 从黑名单移除
                if keyword in state.list_config.get("blacklist", []):
                    state.list_config["blacklist"].remove(keyword)
                # 添加到白名单（避免重复）
                if keyword not in state.list_config.get("whitelist", []):
                    state.list_config["whitelist"].append(keyword)
                save_list_config(state.list_config)
                print(f"已将 '{keyword}' 从黑名单移到白名单", file=sys.stderr)
                state.send_event("moved_to_whitelist", {"keyword": keyword})
    
    elif command == "exit":
        with state.lock:
            state.should_exit = True
            state.running = False
        print("收到退出命令", file=sys.stderr)


def stdin_reader():
    """读取来自Electron的命令（后台线程）"""
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                command = json.loads(line)
                process_command(command)
            except json.JSONDecodeError as e:
                print(f"JSON解析错误: {e}", file=sys.stderr)
            
            # 检查是否应该退出
            with state.lock:
                if state.should_exit:
                    break
    except Exception as e:
        print(f"stdin 异常: {e}", file=sys.stderr)
    
    print("stdin 已断开，线程结束", file=sys.stderr)


# ============ 检测循环 ============

def detection_loop(stdin_thread):
    """检测循环（主线程）"""
    print("前台检测程序已启动，等待命令...", file=sys.stderr)
    
    # 发送准备就绪事件（API Key 需要运行时设置）
    state.send_event("ready", {
        "whitelist_count": len(state.list_config.get("whitelist", [])),
        "blacklist_count": len(state.list_config.get("blacklist", [])),
        "api_key_valid": False  # 初始时没有 API Key
    })
    
    last_check_time = 0
    check_interval = 1.0  # 检测间隔（秒）
    
    while True:
        # 检查 stdin_reader 线程是否存活（父进程崩溃时线程会死）
        if not stdin_thread.is_alive():
            print("stdin_reader 线程已死亡，退出进程", file=sys.stderr)
            break
        
        # 检查是否应该退出
        with state.lock:
            if state.should_exit:
                break
        
        current_time = time.time()
        
        # 检查是否正在检测
        is_running = False
        with state.lock:
            is_running = state.running
        
        if is_running and (current_time - last_check_time >= check_interval):
            last_check_time = current_time
            
            # 获取前台窗口标题
            current_title = get_foreground_window_title()
            
            if current_title is not None and current_title != state.last_title:
                if current_title:  # 非空标题才查询
                    # 判断是否为娱乐应用
                    is_entertainment, source, keyword, state.list_config = check_is_entertainment(
                        current_title, state.api_key, state.model_config, state.list_config, state.api_key_valid
                    )
                    
                    with state.lock:
                        state.current_window = current_title
                        state.last_title = current_title
                    
                    # 如果是娱乐应用，发送事件
                    if is_entertainment == "是":
                        timestamp = time.strftime("%H:%M:%S", time.localtime())
                        print(f"[{timestamp}] 检测到娱乐前台: {current_title} (来源: {source}, 关键字: {keyword})", file=sys.stderr)
                        state.send_event("entertainment_detected", {
                            "window_title": current_title,
                            "source": source,
                            "keyword": keyword,
                            "timestamp": timestamp
                        })
                    else:
                        timestamp = time.strftime("%H:%M:%S", time.localtime())
                        print(f"[{timestamp}] 当前前台: {current_title} ({is_entertainment})", file=sys.stderr)
        
        time.sleep(0.1)  # 短暂休眠，避免占用CPU
    
    print("前台检测程序已退出", file=sys.stderr)


# ============ 主程序 ============

if __name__ == "__main__":
    # 加载配置（不再加载 API 配置文件）
    state.model_config = load_model_config()
    state.list_config = load_list_config()
    
    print(f"API 地址: {state.model_config.get('base_url')} | 模型: {state.model_config.get('model')}", file=sys.stderr)
    print("等待 Electron 发送 API Key...", file=sys.stderr)
    
    # 启动stdin读取线程
    stdin_thread = threading.Thread(target=stdin_reader, daemon=True)
    stdin_thread.start()
    
    # 主线程运行检测循环
    detection_loop(stdin_thread)
