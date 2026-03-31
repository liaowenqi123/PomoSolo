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
   * 下载歌曲
   * @param {string} title - 歌曲名称
   * @param {string} artist - 歌手
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async downloadSong(title, artist) {
    if (!this.downloaderPath) {
      return { success: false, error: '下载器路径未配置' }
    }

    if (!this.apiKey) {
      return { success: false, error: '请先配置 DeepSeek API Key' }
    }

    const songName = `${title} - ${artist}`

    return new Promise((resolve) => {
      try {
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
          // 实时输出下载进度
          console.log('[Downloader]', text.trim())
        })

        childProcess.stderr.on('data', (data) => {
          const text = data.toString('utf8')
          errorOutput += text
          console.error('[Downloader Error]', text.trim())
        })

        childProcess.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true, output })
          } else {
            // 解析错误信息
            let errorMsg = '下载失败'
            if (errorOutput.includes('歌曲已存在')) {
              errorMsg = '歌曲已存在'
            } else if (errorOutput.includes('未找到')) {
              errorMsg = '未找到相关视频'
            } else if (errorOutput.includes('API')) {
              errorMsg = 'API 调用失败'
            }
            resolve({ success: false, error: errorMsg, output, errorOutput })
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
}

// 单例
const songDownloader = new SongDownloader()
module.exports = songDownloader
