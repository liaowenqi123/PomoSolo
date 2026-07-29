/**
 * 数据存储 IPC
 */
const dataManager = require('../src/modules/dataManager')

function register(ipcMain) {
  ipcMain.handle('read-data', () => {
    return dataManager.readData()
  })

  ipcMain.handle('write-data', (event, data) => {
    return dataManager.writeData(data)
  })

  // 设置独立文件
  ipcMain.handle('read-settings', () => {
    return dataManager.readSettings()
  })

  ipcMain.handle('write-settings', (event, settings) => {
    return dataManager.writeSettings(settings)
  })
}

module.exports = { register }
