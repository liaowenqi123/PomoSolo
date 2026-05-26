/**
 * 菜园子系统 IPC
 */
const dataManager = require('../src/modules/dataManager')
const state = require('./state')
const { sendAchievementNotifications } = require('./achievements')
const { createGardenWindow } = require('./windows')

/**
 * 通知菜园子窗口刷新
 */
function notifyGardenRefresh() {
  if (state.gardenWindow && !state.gardenWindow.isDestroyed()) {
    state.gardenWindow.webContents.send('garden-refresh')
  }
}

function register(ipcMain) {
  // ============ 菜园子窗口控制 ============
  ipcMain.on('open-garden', () => {
    createGardenWindow()
  })

  ipcMain.on('close-garden', () => {
    if (state.gardenWindow) {
      state.gardenWindow.close()
    }
  })

  ipcMain.on('refresh-garden', () => {
    if (state.gardenWindow && !state.gardenWindow.isDestroyed()) {
      state.gardenWindow.webContents.send('garden-refresh')
    }
  })

  // ============ 菜园子事件 ============
  ipcMain.on('garden-grow', async (event, minutes) => {
    try {
      await dataManager.updateGardenProgress(minutes)
      notifyGardenRefresh()
    } catch (e) {
      console.error('[Garden] 成长更新失败:', e)
    }
  })

  ipcMain.handle('garden-punishment', async () => {
    try {
      const result = await dataManager.handleGardenPunishment()
      notifyGardenRefresh()
      return result
    } catch (e) {
      console.error('[Garden] 惩罚处理失败:', e)
      return { hasLoss: false, losses: [], totalMinutes: 0 }
    }
  })

  ipcMain.on('update-focus-mode', (event, enabled) => {
    state.focusModeEnabled = enabled
  })

  ipcMain.on('update-timer-status', (event, running, paused) => {
    state.timerRunning = running
    state.timerPaused = paused
  })

  ipcMain.handle('get-timer-state', () => {
    return {
      focusModeEnabled: state.focusModeEnabled,
      timerRunning: state.timerRunning,
      timerPaused: state.timerPaused
    }
  })

  // ============ 菜园子原子操作 ============
  ipcMain.handle('garden-read', async () => {
    return await dataManager.readGardenData()
  })

  ipcMain.handle('garden-write', async (event, gardenData) => {
    dataManager.writeGardenFile(gardenData)
    notifyGardenRefresh()
    return true
  })

  ipcMain.handle('garden-plant', async (event, plotIndex, cropKey) => {
    const result = await dataManager.gardenPlant(plotIndex, cropKey)
    notifyGardenRefresh()
    sendAchievementNotifications(result.unlockedAchievements)
    return result
  })

  ipcMain.handle('garden-harvest', async (event, plotIndex) => {
    const result = await dataManager.gardenHarvest(plotIndex)
    notifyGardenRefresh()
    sendAchievementNotifications(result.unlockedAchievements)
    return result
  })

  ipcMain.handle('garden-buy-seed', async (event, cropKey) => {
    const result = await dataManager.gardenBuySeed(cropKey)
    notifyGardenRefresh()
    sendAchievementNotifications(result.unlockedAchievements)
    return result
  })

  ipcMain.handle('garden-sell-crop', async (event, cropKey) => {
    const result = await dataManager.gardenSellCrop(cropKey)
    notifyGardenRefresh()
    sendAchievementNotifications(result.unlockedAchievements)
    return result
  })

  ipcMain.handle('garden-sell-all', async () => {
    const result = await dataManager.gardenSellAllCrops()
    notifyGardenRefresh()
    sendAchievementNotifications(result.unlockedAchievements)
    return result
  })

  ipcMain.handle('garden-unlock-plot', async (event, plotIndex) => {
    const result = await dataManager.gardenUnlockPlot(plotIndex)
    notifyGardenRefresh()
    sendAchievementNotifications(result.unlockedAchievements)
    return result
  })

  ipcMain.handle('garden-signin', async () => {
    const result = await dataManager.gardenSignIn()
    notifyGardenRefresh()
    sendAchievementNotifications(result.unlockedAchievements)
    return result
  })

  ipcMain.handle('garden-update-focus', async (event, minutes) => {
    const result = await dataManager.gardenUpdateFocusMinutes(minutes)
    if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
      notifyGardenRefresh()
      sendAchievementNotifications(result.unlockedAchievements)
    }
    return result
  })
}

module.exports = { register }
