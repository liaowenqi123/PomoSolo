/**
 * 自动更新 IPC
 * 渲染进程通过此模块触发更新检查和安装
 */
const autoUpdate = require('./auto-update')

function register(ipcMain) {
  ipcMain.handle('check-for-updates', async () => {
    autoUpdate.checkForUpdates()
    return { success: true }
  })

  ipcMain.handle('download-update', async () => {
    autoUpdate.downloadUpdate()
    return { success: true }
  })

  ipcMain.handle('install-update', async () => {
    autoUpdate.quitAndInstall()
    return { success: true }
  })
}

module.exports = { register }
