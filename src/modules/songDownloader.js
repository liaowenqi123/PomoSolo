/**
 * 歌曲下载模块
 * 调用 manual_downloader.exe 下载歌曲
 */

const { spawn } = require('child_process')
const path = require('path')

class SongDownloader {
  constructor() {
    this.downloaderPath = null
    this.apiKey = null
    
    // 下载队列，确保串行执行
    this.downloadQueue = []
    this.isDownloading = false
  }

  /**
   * 设置下载器路径
   * @param {string} exePath - manual_downloader.exe 路径
   */
  setDownloaderPath(exePath) {
    this.downloaderPath = exePath
  }

  /**
   * 获取下载器路径
   * @returns {string|null}
   */
  getDownloaderPath() {
    return this.downloaderPath
  }

  /**
   * 设置 API Key
   * @param {string} apiKey - DeepSeek API Key
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey
  }

  /**
   * 下载歌曲（加入队列，串行执行）
   * @param {string} title - 歌曲名称
   * @param {string} artist - 歌手
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<{success: boolean, status?: string, error?: string}>}
   */
  async downloadSong(title, artist, onProgress = null) {
    return new Promise((resolve) => {
      // 加入队列
      this.downloadQueue.push({ title, artist, onProgress, resolve })
      
      // 如果没有在下载，开始处理队列
      if (!this.isDownloading) {
        this._processQueue()
      }
    })
  }

  /**
   * 处理下载队列
   */
  async _processQueue() {
    if (this.downloadQueue.length === 0) {
      this.isDownloading = false
      return
    }

    this.isDownloading = true
    const { title, artist, onProgress, resolve } = this.downloadQueue.shift()

    try {
      const result = await this._doDownload(title, artist, onProgress)
      resolve(result)
    } catch (err) {
      resolve({ success: false, error: err.message })
    }

    // 处理下一个
    this._processQueue()
  }

  /**
   * 实际执行下载
   * @param {string} title - 歌曲名称
   * @param {string} artist - 歌手
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<{success: boolean, status?: string, error?: string}>}
   */
  async _doDownload(title, artist, onProgress) {
    if (!this.downloaderPath) {
      return { success: false, error: '下载器路径未配置' }
    }

    if (!this.apiKey) {
      return { success: false, error: '请先配置 DeepSeek API Key' }
    }

    const songName = `${title} - ${artist}`

    return new Promise((resolve) => {
      try {
        if (onProgress) onProgress('正在启动下载器...')
        
        const childProcess = spawn(this.downloaderPath, [
          '-s', songName,
          '-k', this.apiKey
        ], {
          cwd: path.dirname(this.downloaderPath),
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        })

        let output = ''
        let errorOutput = ''

        childProcess.stdout.on('data', (data) => {
          const text = data.toString('utf8')
          output += text
          console.log('[Downloader]', text.trim())
          
          // 解析进度信息
          if (onProgress) {
            if (text.includes('正在 B 站搜索')) {
              onProgress('正在搜索 B 站...')
            } else if (text.includes('DeepSeek 正在分析')) {
              onProgress('AI 正在分析视频...')
            } else if (text.includes('正在下载')) {
              onProgress('正在下载视频...')
            } else if (text.includes('提取音频')) {
              onProgress('正在提取音频...')
            }
          }
        })

        childProcess.stderr.on('data', (data) => {
          const text = data.toString('utf8')
          errorOutput += text
          console.error('[Downloader Error]', text.trim())
        })

        childProcess.on('close', (code) => {
          // 根据退出码判断结果
          switch (code) {
            case 0:
              resolve({ success: true, status: 'downloaded', message: '下载成功' })
              break
            case 2:
              resolve({ success: true, status: 'exists', message: '歌曲已存在，跳过下载' })
              break
            case 3:
              resolve({ success: false, status: 'no_video', error: '未找到相关视频' })
              break
            case 4:
              resolve({ success: false, status: 'no_instrumental', error: '未找到符合条件的纯音乐视频' })
              break
            case 1:
            default:
              resolve({ success: false, status: 'failed', error: '下载失败' })
              break
          }
        })

        childProcess.on('error', (err) => {
          resolve({ success: false, error: `启动下载器失败: ${err.message}` })
        })

        // 设置超时（5分钟）
        setTimeout(() => {
          try {
            childProcess.kill()
            resolve({ success: false, error: '下载超时' })
          } catch (e) {
            // 进程可能已结束
          }
        }, 5 * 60 * 1000)

      } catch (err) {
        resolve({ success: false, error: `下载异常: ${err.message}` })
      }
    })
  }

  /**
   * 检查是否有下载任务正在进行
   * @returns {boolean}
   */
  isBusy() {
    return this.isDownloading
  }

  /**
   * 获取队列长度
   * @returns {number}
   */
  getQueueLength() {
    return this.downloadQueue.length
  }
}

// 单例
const songDownloader = new SongDownloader()
module.exports = songDownloader