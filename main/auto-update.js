/**
 * 自动更新模块
 *
 * 基于 electron-updater 实现 GitHub Releases 自动更新。
 * 仅在打包后（app.isPackaged）生效，npm start 下静默跳过。
 */
const { autoUpdater } = require('electron-updater')
const { backupUserData } = require('./userData-backup')

// autoUpdater.autoDownload = false  // 手动触发下载（用户点"更新"才下载）
autoUpdater.allowPrerelease = false   // 正式版发布，不推送预览版

let mainWindow = null
let statusCallback = null

/**
 * 初始化自动更新模块
 * @param {BrowserWindow} win - 主窗口引用，用于发送事件到渲染进程
 */
function init(win) {
  mainWindow = win

  // dev 模式下不启动更新检查，但注册事件监听以便后续手动调用
  if (!require('electron').app.isPackaged) {
    console.log('[AutoUpdate] 开发模式，自动更新已跳过')
  }

  // 注册事件监听
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdate] 正在检查更新...')
    sendToRenderer('update-status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdate] 发现新版本:', info.version)
    sendToRenderer('update-status', {
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdate] 已是最新版本')
    sendToRenderer('update-status', {
      status: 'not-available',
      version: info?.version
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdate] 更新出错:', err.message)
    sendToRenderer('update-status', {
      status: 'error',
      message: err.message
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdate] 更新已下载完成:', info.version)

    // 下载完成后，备份用户数据
    try {
      const resourcesPath = require('path').join(process.resourcesPath)
      backupUserData(resourcesPath)
    } catch (e) {
      console.error('[AutoUpdate] 备份用户数据失败:', e)
    }

    sendToRenderer('update-status', {
      status: 'downloaded',
      version: info.version
    })
  })
}

/**
 * 发送事件到渲染进程（窗口存在时）
 */
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

/**
 * 检查更新
 * 会被渲染进程的"检查更新"按钮触发
 */
function checkForUpdates() {
  autoUpdater.checkForUpdates()
}

/**
 * 下载更新（用户确认后触发）
 */
function downloadUpdate() {
  autoUpdater.downloadUpdate()
}

/**
 * 安装更新并重启
 */
function quitAndInstall() {
  autoUpdater.quitAndInstall()
}

module.exports = {
  init,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall
}
