/**
 * 前台检测 IPC
 */
const foregroundInspection = require('../src/modules/foregroundInspection')
const state = require('./state')

function register(ipcMain) {
  ipcMain.handle('foreground-is-ready', () => {
    return state.foregroundInspectionReady
  })

  ipcMain.on('foreground-start', () => {
    foregroundInspection.startDetection()
  })

  ipcMain.on('foreground-stop', () => {
    foregroundInspection.stopDetection()
  })

  ipcMain.on('foreground-get-status', () => {
    foregroundInspection.getStatus()
  })

  ipcMain.on('foreground-set-api-key', (event, apiKey) => {
    foregroundInspection.setApiKey(apiKey)
  })

  ipcMain.on('foreground-add-whitelist', (event, keyword) => {
    foregroundInspection.addWhitelist(keyword)
  })

  ipcMain.on('foreground-add-blacklist', (event, keyword) => {
    foregroundInspection.addBlacklist(keyword)
  })

  ipcMain.on('foreground-mark-history-not', (event, windowTitle) => {
    foregroundInspection.markHistoryNot(windowTitle)
  })

  ipcMain.on('foreground-move-blacklist-to-whitelist', (event, keyword) => {
    foregroundInspection.moveBlacklistToWhitelist(keyword)
  })
}

module.exports = { register }
