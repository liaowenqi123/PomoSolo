/**
 * 前台检测进程管理模块
 * 负责与 foreground_inspection.exe 通过 stdin/stdout 通信
 */

const { spawn } = require('child_process')
const path = require('path')
const readline = require('readline')

class ForegroundInspection {
  constructor() {
    this.process = null
    this.isRunning = false
    this.isDetecting = false  // 是否正在检测（区别于进程是否运行）
    this.onReadyCallback = null
    this.onApiKeyInvalidCallback = null
    this.onEntertainmentDetectedCallback = null
    this.onStatusCallback = null
    this.onErrorCallback = null
  }

  /**
   * 启动前台检测进程
   * @param {string} exePath - foreground_inspection.exe 的路径
   */
  start(exePath) {
    if (this.process) {
      console.log('[ForegroundInspection] 进程已在运行')
      return
    }

    const fullPath = exePath || path.join(__dirname, '../../foreground_inspection/foreground_inspection.exe')
    
    try {
      this.process = spawn(fullPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.dirname(fullPath),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      })

      this.isRunning = true
      console.log('[ForegroundInspection] 进程已启动:', fullPath)

      // 创建readline接口处理stdout，指定UTF-8编码
      const rl = readline.createInterface({
        input: this.process.stdout.setEncoding('utf8'),
        crlfDelay: Infinity
      })

      rl.on('line', (line) => {
        this.handleMessage(line)
      })

      // 处理stderr
      this.process.stderr.on('data', (data) => {
        console.error('[ForegroundInspection] stderr:', data.toString())
      })

      // 处理进程退出
      this.process.on('close', (code) => {
        console.log('[ForegroundInspection] 进程已退出, code:', code)
        this.process = null
        this.isRunning = false
        this.isDetecting = false
      })

      // 处理错误
      this.process.on('error', (err) => {
        console.error('[ForegroundInspection] 进程错误:', err)
        this.process = null
        this.isRunning = false
        this.isDetecting = false
        if (this.onErrorCallback) {
          this.onErrorCallback({ message: '前台检测进程启动失败' })
        }
      })

    } catch (err) {
      console.error('[ForegroundInspection] 启动失败:', err)
      this.process = null
      this.isRunning = false
      this.isDetecting = false
    }
  }

  /**
   * 停止前台检测进程
   */
  stop() {
    if (this.process) {
      // 先发送退出命令
      this.sendCommand({ command: 'exit' })
      
      // 等待一小段时间让进程正常退出
      setTimeout(() => {
        if (this.process) {
          const pid = this.process.pid
          
          // 在 Windows 上使用 taskkill 强制终止进程树
          if (process.platform === 'win32' && pid) {
            try {
              const { execSync } = require('child_process')
              execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' })
              console.log('[ForegroundInspection] 使用 taskkill 终止进程:', pid)
            } catch (e) {
              // 如果 taskkill 失败，尝试普通 kill
              this.process.kill('SIGKILL')
            }
          } else {
            this.process.kill('SIGKILL')
          }
          
          this.process = null
          this.isRunning = false
          this.isDetecting = false
          console.log('[ForegroundInspection] 进程已停止')
        }
      }, 500)
    }
  }

  /**
   * 处理来自 foreground_inspection.exe 的消息
   * @param {string} line - JSON格式的消息
   */
  handleMessage(line) {
    try {
      const message = JSON.parse(line)
      const { event, data } = message

      console.log('[ForegroundInspection] 收到消息:', event, data)

      switch (event) {
        case 'ready':
          if (this.onReadyCallback) {
            this.onReadyCallback(data)
          }
          break
        case 'api_key_invalid':
          if (this.onApiKeyInvalidCallback) {
            this.onApiKeyInvalidCallback(data)
          }
          break
        case 'entertainment_detected':
          if (this.onEntertainmentDetectedCallback) {
            this.onEntertainmentDetectedCallback(data)
          }
          break
        case 'status':
          if (data.running !== undefined) {
            this.isDetecting = data.running
          }
          if (this.onStatusCallback) {
            this.onStatusCallback(data)
          }
          break
        case 'error':
          if (this.onErrorCallback) {
            this.onErrorCallback(data)
          }
          break
        default:
          console.log('[ForegroundInspection] 未知事件:', event)
      }
    } catch (err) {
      console.error('[ForegroundInspection] 解析消息失败:', err, line)
    }
  }

  /**
   * 发送命令到 foreground_inspection.exe
   * @param {object} command - 命令对象
   */
  sendCommand(command) {
    if (!this.process || !this.process.stdin.writable) {
      console.error('[ForegroundInspection] 进程未运行,无法发送命令')
      return false
    }

    try {
      const commandStr = JSON.stringify(command) + '\n'
      this.process.stdin.write(commandStr, 'utf8')
      console.log('[ForegroundInspection] 发送命令:', command)
      return true
    } catch (err) {
      console.error('[ForegroundInspection] 发送命令失败:', err)
      return false
    }
  }

  // ============ 控制命令 ============

  /**
   * 开始检测
   */
  startDetection() {
    const result = this.sendCommand({ command: 'start' })
    if (result) {
      this.isDetecting = true
    }
    return result
  }

  /**
   * 停止检测
   */
  stopDetection() {
    const result = this.sendCommand({ command: 'stop' })
    if (result) {
      this.isDetecting = false
    }
    return result
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return this.sendCommand({ command: 'get_status' })
  }

  /**
   * 添加到白名单
   * @param {string} keyword - 关键字
   */
  addWhitelist(keyword) {
    return this.sendCommand({ command: 'add_whitelist', keyword })
  }

  /**
   * 添加到黑名单
   * @param {string} keyword - 关键字
   */
  addBlacklist(keyword) {
    return this.sendCommand({ command: 'add_blacklist', keyword })
  }

  /**
   * 将历史记录中的项标记为"不是"娱乐
   * @param {string} windowTitle - 窗口标题
   */
  markHistoryNot(windowTitle) {
    return this.sendCommand({ command: 'mark_history_not', window_title: windowTitle })
  }

  /**
   * 将黑名单中的关键字移到白名单
   * @param {string} keyword - 关键字
   */
  moveBlacklistToWhitelist(keyword) {
    return this.sendCommand({ command: 'move_blacklist_to_whitelist', keyword })
  }

  /**
   * 设置API Key（运行时通过 stdin 发送）
   * @param {string|null} apiKey - DeepSeek API Key，null 表示清除
   */
  setApiKey(apiKey) {
    if (!this.process || !this.process.stdin.writable) {
      // 进程未运行时静默返回（比如退出登录时进程可能已停止）
      console.log('[ForegroundInspection] 进程未运行，跳过设置 API Key')
      return false
    }
    return this.sendCommand({ command: 'set_api_key', api_key: apiKey || '' })
  }

  // ============ 回调设置 ============

  onReady(callback) {
    this.onReadyCallback = callback
  }

  onApiKeyInvalid(callback) {
    this.onApiKeyInvalidCallback = callback
  }

  onEntertainmentDetected(callback) {
    this.onEntertainmentDetectedCallback = callback
  }

  onStatus(callback) {
    this.onStatusCallback = callback
  }

  onError(callback) {
    this.onErrorCallback = callback
  }
}

// 导出单例
const foregroundInspection = new ForegroundInspection()
module.exports = foregroundInspection
