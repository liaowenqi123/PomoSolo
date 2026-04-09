# 子进程残留问题分析

本文档详细记录了 Electron 主进程崩溃后 Python 子进程残留的问题、分析过程及解决方案。

---

## 背景：项目架构

本项目是一个番茄钟桌面应用，采用 **Electron + Python 多进程架构**：

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron 主进程                           │
│  - 窗口管理、UI 渲染、用户交互                                │
│  - 通过 stdin/stdout 管道与子进程通信                         │
└───────────────┬─────────────────────────────────────┬───────┘
                │ stdin/stdout (JSON Lines)           │ stdin/stdout (JSON Lines)
                ▼                                     ▼
┌───────────────────────────┐         ┌───────────────────────────┐
│   music.exe (Python)      │         │ foreground_inspection.exe │
│   - 音频播放控制           │         │ - 前台窗口检测            │
│   - 全局快捷键监听         │         │ - AI 判断娱乐应用         │
└───────────────────────────┘         └───────────────────────────┘
```

**通信方式：**
- Electron 通过 `child_process.spawn()` 启动 Python 子进程
- 双向通信：Electron 写入 stdin 发送命令，Python 写入 stdout 返回事件
- Python 内部有一个 `stdin_reader` 线程专门读取命令

---

## 问题现象

### 触发条件

当 Electron 主进程被**强制终止**时（非正常退出），例如：
- 在终端按 Ctrl+C（发送 SIGINT 信号）
- 通过任务管理器结束进程
- 开发时 IDE 强制停止

### 现象1：子进程残留

期望：子进程应该跟随父进程一起退出
实际：`music.exe` 和 `foreground_inspection.exe` 仍然残留

**任务管理器观察：**
```
正常状态：
  music.exe    - 2 个线程（主线程 + stdin_reader线程）
  内存占用：~200MB（主线程） + ~0.9MB（stdin_reader）

异常状态（父进程被 kill 后）：
  music.exe    - 1 个线程（只剩主线程）
  内存占用：~200MB
  stdin_reader 线程消失了！
```

### 现象2：残留进程"半死不活"

更诡异的是，残留的主线程处于一种**僵尸状态**：
- ❌ 不能播放歌曲（音频不输出）
- ❌ 不能响应全局快捷键（快捷键无效）
- ✓ 进程还在运行（占用内存，CPU 可能有活动）
- ✓ 修改代码后能检测到 stdin 线程死亡并主动退出

**推理：** 主线程代码还在执行，但功能失效。

### 现象3：日志缺失

**正常退出时的日志：**
```
[MusicProcess] 使用 taskkill 终止进程: 160804
[MusicProcess] 进程已停止
[ForegroundInspection] 发送命令: { command: 'exit' }
stdin 已断开，线程结束
stdin_reader 线程已死亡，退出进程
前台检测程序已退出
```

**SIGINT 强制终止时的日志：**
```
[CloudAuth] 心跳发送成功: 2026-04-09T21:01:27.884Z
Terminate batch job (Y/N)? 
electron.exe exited with signal SIGINT
（几乎没有其他输出）
```

---

## 分析过程

### 初始假设：stdin 断开应该能检测到

`stdin_reader` 的核心代码：
```python
def stdin_reader():
    for line in sys.stdin:  # 这是一个阻塞循环
        line = line.strip()
        cmd = json.loads(line)
        process_command(cmd)
```

**理论分析：**
- `for line in sys.stdin:` 会阻塞等待输入
- 当父进程死亡，stdin 管道关闭，应该收到 EOF
- 收到 EOF 后，循环应该正常结束（不抛异常）
- 循环结束后线程结束

**问题：** 为什么主线程检测不到 stdin 线程已经死了？

### 尝试1：在线程结束时设置退出标志

```python
def stdin_reader():
    try:
        for line in sys.stdin:
            ...
    except Exception as e:
        pass
    # 循环结束后设置标志
    with state.lock:
        state.exit_program = True
```

**结果：** 无效。主线程仍然残留。

**分析：** 主线程可能卡在某个阻塞操作中，无法及时检查标志。

### 尝试2：直接调用 os._exit() 强制退出

```python
def stdin_reader():
    try:
        for line in sys.stdin:
            ...
    except Exception as e:
        pass
    # 直接退出整个进程
    os._exit(0)
```

**结果：** 无效。stdin_reader 线程"静默死亡"，根本没有执行到这里。

**关键发现：** stdin_reader 线程消失了，但没有执行任何退出代码。这意味着线程可能被操作系统直接终止了，而不是收到了 EOF。

### 尝试3：主线程定期检查 stdin 线程存活状态
```python
 def stdin_reader():
    """读取来自Electron的命令（守护线程）"""
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                process_command(cmd)
            except json.JSONDecodeError as e:
                print(f"JSON解析错误: {e}", file=sys.stderr)
    except Exception as e:
        # stdin 断开（父进程崩溃），立即退出
        print(f"stdin 断开，父进程已退出: {e}", file=sys.stderr)
        os._exit(1)

    print("stdin_reader 正常退出", file=sys.stderr)
```
**结果：** 无效。stdin_reader 线程"静默死亡"，os._exit(1)。

**关键发现：** 意味着实际上sys.stdin并没有报错。

### 尝试4：主线程定期检查 stdin 线程存活状态

```python
# 在主循环中
while True:
    if not stdin_thread.is_alive():
        print("stdin_reader 线程已死亡，退出进程")
        break
    ...
```

**结果：** 有效！子进程能正常退出。

**推理：**
1. stdin_reader 线程确实死了（`is_alive()` 返回 False）
2. 主线程还在运行（能执行检查代码）
3. 问题是主线程之前没有检查，所以不知道 stdin 线程死了

---

## 深入分析

### 为什么 stdin_reader 线程"静默死亡"？

**可能原因1：EOF 触发，但日志没输出**

```
父进程死亡时，OS 同时关闭三个管道：
  stdin  ──► EOF（stdin_reader 收到，循环结束）
  stdout ──► 关闭（无法输出）
  stderr ──► 关闭（无法输出日志）
```

如果 stdout/stderr 关闭了，`print(..., file=sys.stderr)` 就写不进去了，所以看不到日志。

**验证方法：** 写文件日志而不是 stderr
```python
with open("stdin_death.log", "w") as f:
    f.write("stdin 已断开\n")
```

**可能原因2：Windows 进程树机制**

SIGINT 在 Windows 上的行为可能与 Linux 不同。Ctrl+C 可能：
- 只发送给控制台进程组的主进程
- 子进程可能收到某种信号导致线程终止
- 具体行为取决于进程如何被启动

### 为什么残留进程"半死不活"？

这是最诡异的部分。主线程活着，但不能播放、不能响应快捷键。

**猜测1：stdout 关闭导致阻塞**

```python
def send_event(self, event_type, data):
    output = json.dumps({"event": event_type, "data": data})
    sys.stdout.write(output + "\n")  # 如果 stdout 关闭，这里会阻塞吗？
    sys.stdout.flush()
```

如果 stdout 管道关闭，`sys.stdout.write()` 的行为取决于缓冲区和系统实现。可能会：
- 抛出异常（但没看到）
- 阻塞等待（可能！）
- 静默失败

**猜测2：音频流依赖被破坏**

`sounddevice` 的 `OutputStream` 可能依赖某些系统资源。父进程死后：
- 音频设备可能被释放
- 但 `stream.write()` 不报错，只是"空转"
- 循环在跑，但没有实际音频输出

**猜测3：pynput 快捷键监听线程也死了**

`pynput.keyboard.Listener` 是独立线程。如果它也死了：
- 快捷键回调不会触发
- 但主线程不知道

---

## 最终解决方案

### 代码修改

**1. PlayerState 添加 stdin_thread 引用**
```python
class PlayerState:
    def __init__(self):
        ...
        self.stdin_thread = None  # stdin 线程引用
```

**2. 启动时保存引用**
```python
stdin_thread = threading.Thread(target=stdin_reader, daemon=True)
stdin_thread.start()
state.stdin_thread = stdin_thread
```

**3. 主循环定期检查**
```python
while True:
    if state.stdin_thread and not state.stdin_thread.is_alive():
        print("stdin_reader 线程已死亡，退出进程", file=sys.stderr)
        break
    ...
```

**4. 播放循环也检查**
```python
# Player.play() 内的主播放循环
while current_frame < total_frames:
    if state.stdin_thread and not state.stdin_thread.is_alive():
        return "exit"
    ...

# 暂停等待循环
while True:
    if state.stdin_thread and not state.stdin_thread.is_alive():
        return "exit"
    ...
```

### 其他修改

**前台检测模块：**
- 用 `requests` 替换 `openai` 包，避免 PyInstaller 打包体积过大（从 1GB+ 降至 ~12MB）
- 同样添加 stdin 线程存活检查

---

## 未解之谜

1. **stdin_reader 到底是怎么死的？**
   - EOF 触发？那为什么 stderr 看不到日志？
   - 被操作系统杀死？那为什么没有异常？

2. **为什么残留进程不能播放和响应快捷键？**
   - stdout 阻塞？
   - 音频设备问题？
   - pynput 线程也死了？

3. **SIGINT 和 taskkill 的行为差异**
   - SIGINT：为什么日志那么少？
   - taskkill：为什么能正常清理？

---

## 相关文件

- `music-player/music.py` - 音乐播放器 Python 进程
- `foreground_inspection/foreground_inspection.py` - 前台检测 Python 进程
- `src/modules/musicProcess.js` - Electron 音乐进程管理
- `src/modules/foregroundInspection.js` - Electron 前台检测进程管理
- `docs/BUGFIX_RECORDS.md` - Bug 修复记录