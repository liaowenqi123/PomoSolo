/**
 * 音乐播放器进程管理模块
 * 负责与music.exe通过stdin/stdout通信
 */

const { spawn } = require('child_process')
const path = require('path')
const readline = require('readline')

class MusicProcess {
  constructor() {
    this.process = null
    this.isRunning = false
    this.onReadyCallback = null
    this.onStatusCallback = null
    this.onTrackChangeCallback = null
    this.onPlayStateCallback = null
    this.onProgressCallback = null
    this.onDevicesCallback = null
    this.onNoMusicCallback = null
    this.onPlayErrorCallback = null
    this.onProcessDeadCallback = null  // 进程死亡回调
    this.onVolumeChangeCallback = null  // 音量变化回调
    this.onPlayModeCallback = null  // 播放模式变化回调
    this.onPlaylistCallback = null  // 播放列表回调
    this.onSongMissingCallback = null  // 歌曲消失回调
    this.onTagUpdatedCallback = null  // 标签更新回调
    this.onCustomTagsCallback = null  // 自定义标签回调
    this.onCustomTagAddedCallback = null  // 添加自定义标签回调
    this.onCustomTagDeletedCallback = null  // 删除自定义标签回调
  }

  /**
   * 启动音乐播放器进程
   * @param {string} exePath - music.exe的路径
   * @param {number} deviceId - 初始设备ID（可选）
   */
  start(exePath, deviceId) {
    if (this.process) {
      console.log('[MusicProcess] 进程已在运行')
      return
    }

    const fullPath = exePath || path.join(__dirname, '../../music.exe')
    const args = deviceId !== undefined && deviceId !== null ? [String(deviceId)] : []
    
    try {
      this.process = spawn(fullPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.dirname(fullPath),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      })

      this.isRunning = true
      console.log('[MusicProcess] 进程已启动:', fullPath)

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
        console.error('[MusicProcess] stderr:', data.toString())
      })

      // 处理进程退出
      this.process.on('close', (code) => {
        console.log('[MusicProcess] 进程已退出, code:', code)
        this.process = null
        this.isRunning = false
      })

      // 处理错误
      this.process.on('error', (err) => {
        console.error('[MusicProcess] 进程错误:', err)
        this.process = null
        this.isRunning = false
      })

    } catch (err) {
      console.error('[MusicProcess] 启动失败:', err)
      this.process = null
      this.isRunning = false
    }
  }

  /**
   * 停止音乐播放器进程
   */
  stop() {
    if (this.process) {
      const pid = this.process.pid
      
      // 在 Windows 上使用 taskkill 强制终止进程树
      if (process.platform === 'win32' && pid) {
        try {
          const { execSync } = require('child_process')
          execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' })
          console.log('[MusicProcess] 使用 taskkill 终止进程:', pid)
        } catch (e) {
          // 如果 taskkill 失败，尝试普通 kill
          this.process.kill('SIGKILL')
        }
      } else {
        this.process.kill('SIGKILL')
      }
      
      this.process = null
      this.isRunning = false
      console.log('[MusicProcess] 进程已停止')
    }
  }

  /**
   * 处理来自music.exe的消息
   * @param {string} line - JSON格式的消息
   */
  handleMessage(line) {
    try {
      const message = JSON.parse(line)
      const { event, data } = message

      console.log('[MusicProcess] 收到消息:', event, data)

      switch (event) {
        case 'ready':
          if (this.onReadyCallback) {
            this.onReadyCallback(data)
          }
          break
        case 'status':
          if (this.onStatusCallback) {
            this.onStatusCallback(data)
          }
          break
        case 'track_change':
          if (this.onTrackChangeCallback) {
            this.onTrackChangeCallback(data)
          }
          break
        case 'play_state':
          if (this.onPlayStateCallback) {
            this.onPlayStateCallback(data)
          }
          break
        case 'progress':
          if (this.onProgressCallback) {
            this.onProgressCallback(data)
          }
          break
        case 'devices':
          if (this.onDevicesCallback) {
            this.onDevicesCallback(data)
          }
          break
        case 'no_music':
          if (this.onNoMusicCallback) {
            this.onNoMusicCallback(data)
          }
          break
        case 'play_error':
          if (this.onPlayErrorCallback) {
            this.onPlayErrorCallback(data)
          }
          break
        case 'volume_change':
          if (this.onVolumeChangeCallback) {
            this.onVolumeChangeCallback(data)
          }
          break
        case 'play_mode':
          if (this.onPlayModeCallback) {
            this.onPlayModeCallback(data)
          }
          break
        case 'playlist':
          if (this.onPlaylistCallback) {
            this.onPlaylistCallback(data)
          }
          break
        case 'song_missing':
          if (this.onSongMissingCallback) {
            this.onSongMissingCallback(data)
          }
          break
        case 'tag_updated':
          if (this.onTagUpdatedCallback) {
            this.onTagUpdatedCallback(data)
          }
          break
        case 'custom_tags':
          if (this.onCustomTagsCallback) {
            this.onCustomTagsCallback(data)
          }
          break
        case 'custom_tag_added':
          if (this.onCustomTagAddedCallback) {
            this.onCustomTagAddedCallback(data)
          }
          break
        case 'custom_tag_deleted':
          if (this.onCustomTagDeletedCallback) {
            this.onCustomTagDeletedCallback(data)
          }
          break
        default:
          console.log('[MusicProcess] 未知事件:', event)
      }
    } catch (err) {
      console.error('[MusicProcess] 解析消息失败:', err, line)
    }
  }

  /**
   * 发送命令到music.exe
   * @param {object} command - 命令对象
   */
  sendCommand(command) {
    if (!this.process || !this.process.stdin.writable) {
      console.error('[MusicProcess] 进程未运行,无法发送命令')
      // 进程未运行时触发错误回调
      if (this.onPlayErrorCallback) {
        this.onPlayErrorCallback({ message: '播放进程未运行，请重启番茄钟' })
      }
      return false
    }

    try {
      const commandStr = JSON.stringify(command) + '\n'
      this.process.stdin.write(commandStr, 'utf8')
      console.log('[MusicProcess] 发送命令:', command)
      return true
    } catch (err) {
      console.error('[MusicProcess] 发送命令失败:', err)
      return false
    }
  }

  // ============ 控制命令 ============

  /**
   * 切换播放/暂停
   */
  togglePlay() {
    return this.sendCommand({ command: 'toggle' })
  }

  /**
   * 下一首
   */
  next() {
    return this.sendCommand({ command: 'next' })
  }

  /**
   * 上一首
   */
  prev() {
    return this.sendCommand({ command: 'prev' })
  }

  /**
   * 跳转到指定位置
   * @param {number} position - 位置(秒)
   */
  seek(position) {
    return this.sendCommand({ command: 'seek', position })
  }

  /**
   * 设置音量
   * @param {number} volume - 音量(0-1)
   */
  setVolume(volume) {
    return this.sendCommand({ command: 'set_volume', volume })
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return this.sendCommand({ command: 'get_status' })
  }

  /**
   * 获取输出设备列表
   */
  getDevices() {
    return this.sendCommand({ command: 'get_devices' })
  }

  /**
   * 设置输出设备
   * @param {number} deviceId - 设备ID
   */
  setDevice(deviceId) {
    return this.sendCommand({ command: 'set_device', device_id: deviceId })
  }

  /**
   * 设置播放模式
   * @param {string} mode - 'shuffle' 随机 | 'order' 顺序循环
   */
  setPlayMode(mode) {
    return this.sendCommand({ command: 'set_play_mode', mode })
  }

  /**
   * 获取播放列表
   */
  getPlaylist() {
    return this.sendCommand({ command: 'get_playlist' })
  }

  /**
   * 播放指定歌曲
   * @param {string} name - 歌曲文件名
   */
  playSong(name) {
    return this.sendCommand({ command: 'play_song', name })
  }

  /**
   * 删除指定歌曲
   * @param {string} name - 歌曲文件名
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteSong(name) {
    return new Promise((resolve) => {
      // 设置一次性回调来接收删除结果
      const originalCallback = this.onStatusCallback
      const timeoutId = setTimeout(() => {
        this.onStatusCallback = originalCallback
        resolve({ success: false, error: '删除超时' })
      }, 5000)

      this.onStatusCallback = (data) => {
        if (data && data.delete_result !== undefined) {
          clearTimeout(timeoutId)
          this.onStatusCallback = originalCallback
          if (data.delete_result === 'success') {
            resolve({ success: true })
          } else {
            resolve({ success: false, error: data.delete_error || '删除失败' })
          }
        } else if (originalCallback) {
          originalCallback(data)
        }
      }

      this.sendCommand({ command: 'delete_song', name })
    })
  }

  /**
   * 更新歌曲标签
   */
  async updateTag(name, tag, color) {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.onTagUpdatedCallback = null
        resolve({ success: false, error: '更新超时' })
      }, 5000)

      this.onTagUpdatedCallback = (data) => {
        clearTimeout(timeoutId)
        this.onTagUpdatedCallback = null
        resolve({ success: data.success, error: data.error })
      }

      this.sendCommand({ command: 'update_tag', name, tag, color })
    })
  }

  /**
   * 获取自定义标签配置
   */
  async getCustomTags() {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.onCustomTagsCallback = null
        resolve({ customTags: {} })
      }, 5000)

      this.onCustomTagsCallback = (data) => {
        clearTimeout(timeoutId)
        this.onCustomTagsCallback = null
        resolve({ customTags: data.customTags || {} })
      }

      this.sendCommand({ command: 'get_custom_tags' })
    })
  }

  /**
   * 添加自定义标签
   */
  async addCustomTag(name, color) {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.onCustomTagAddedCallback = null
        resolve({ success: false, error: '添加超时' })
      }, 5000)

      this.onCustomTagAddedCallback = (data) => {
        clearTimeout(timeoutId)
        this.onCustomTagAddedCallback = null
        resolve({ success: data.success, error: data.error })
      }

      this.sendCommand({ command: 'add_custom_tag', name, color })
    })
  }

  /**
   * 删除自定义标签
   */
  async deleteCustomTag(name) {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.onCustomTagDeletedCallback = null
        resolve({ success: false, error: '删除超时' })
      }, 5000)

      this.onCustomTagDeletedCallback = (data) => {
        clearTimeout(timeoutId)
        this.onCustomTagDeletedCallback = null
        resolve({ success: data.success, error: data.error })
      }

      this.sendCommand({ command: 'delete_custom_tag', name })
    })
  }

  // ============ 回调设置 ============

  onReady(callback) {
    this.onReadyCallback = callback
  }

  onStatus(callback) {
    this.onStatusCallback = callback
  }

  onTrackChange(callback) {
    this.onTrackChangeCallback = callback
  }

  onPlayState(callback) {
    this.onPlayStateCallback = callback
  }

  onProgress(callback) {
    this.onProgressCallback = callback
  }

  onDevices(callback) {
    this.onDevicesCallback = callback
  }

  onNoMusic(callback) {
    this.onNoMusicCallback = callback
  }

  onPlayError(callback) {
    this.onPlayErrorCallback = callback
  }

  onVolumeChange(callback) {
    this.onVolumeChangeCallback = callback
  }

  onPlayMode(callback) {
    this.onPlayModeCallback = callback
  }

  onPlaylist(callback) {
    this.onPlaylistCallback = callback
  }

  onSongMissing(callback) {
    this.onSongMissingCallback = callback
  }
}

// 导出单例
const musicProcess = new MusicProcess()
module.exports = musicProcess
