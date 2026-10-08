/**
 * 云端认证 + 自习室 + API Key 管理 IPC
 */
const cloudAuth = require('../src/modules/cloudAuth')
const dataManager = require('../src/modules/dataManager')
const studyRoomSync = require('../src/modules/studyRoomSync')

function register(ipcMain) {
  // ============ 开机自启动 ============
  const { app } = require('electron')

  ipcMain.handle('set-auto-start', (event, enabled) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: false
    })
    return true
  })

  ipcMain.handle('get-auto-start', () => {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  })

  // ============ 凭据存储 ============
  ipcMain.handle('save-credentials', (event, credentials) => {
    return cloudAuth.saveCredentials(credentials)
  })

  ipcMain.handle('load-credentials', () => {
    return cloudAuth.loadCredentials()
  })

  ipcMain.handle('clear-credentials', () => {
    return cloudAuth.clearCredentials()
  })

  // ============ 云端登录 ============
  ipcMain.handle('cloud-test-connection', async () => {
    return await cloudAuth.testConnection()
  })

  ipcMain.handle('cloud-get-session', async () => {
    const aiAssistant = require('../src/modules/aiAssistant')
    const songDownloader = require('../src/modules/songDownloader')
    const foregroundInspection = require('../src/modules/foregroundInspection')
    return await cloudAuth.getSessionWithKey(aiAssistant, songDownloader, foregroundInspection)
  })

  ipcMain.handle('cloud-login', async (event, { username, password }) => {
    const aiAssistant = require('../src/modules/aiAssistant')
    const songDownloader = require('../src/modules/songDownloader')
    const foregroundInspection = require('../src/modules/foregroundInspection')
    const result = await cloudAuth.login(username, password, aiAssistant, songDownloader, foregroundInspection)

    if (result.success && result.user) {
      studyRoomSync.setCurrentUser(result.user)
      console.log('[Main] 自习室模块已设置当前用户:', result.user.username)
    }

    return result
  })

  ipcMain.handle('cloud-register', async (event, { username, password }) => {
    return await cloudAuth.register(username, password)
  })

  ipcMain.handle('cloud-logout', async () => {
    const aiAssistant = require('../src/modules/aiAssistant')
    const foregroundInspection = require('../src/modules/foregroundInspection')
    const songDownloader = require('../src/modules/songDownloader')
    return await cloudAuth.logout(aiAssistant, foregroundInspection, songDownloader)
  })

  // ============ 意见反馈 ============
  ipcMain.handle('submit-feedback', async (event, content) => {
    return await cloudAuth.submitFeedback(content)
  })

  ipcMain.handle('get-user-feedbacks', async () => {
    return await cloudAuth.getUserFeedbacks()
  })

  ipcMain.handle('delete-feedback', async (event, feedbackId) => {
    return await cloudAuth.deleteFeedback(feedbackId)
  })

  // ============ 自习室 ============
  ipcMain.handle('study-room-get-my-rooms', async () => {
    return await studyRoomSync.getMyRooms()
  })

  ipcMain.handle('study-room-get-active', async (event, { publicOnly } = {}) => {
    return await studyRoomSync.getActiveRooms(publicOnly)
  })

  ipcMain.handle('study-room-get-by-id', async (event, { roomId }) => {
    return await studyRoomSync.getRoomById(roomId)
  })

  ipcMain.handle('study-room-create', async (event, { name, description, isPublic }) => {
    return await studyRoomSync.createRoom(name, description, isPublic)
  })

  ipcMain.handle('study-room-join', async (event, { roomId }) => {
    return await studyRoomSync.joinRoom(roomId)
  })

  ipcMain.handle('study-room-leave', async (event, { roomId }) => {
    return await studyRoomSync.leaveRoom(roomId)
  })

  ipcMain.handle('study-room-delete', async (event, { roomId }) => {
    return await studyRoomSync.deleteRoom(roomId)
  })

  ipcMain.handle('study-room-upload-stats', async (event, { roomId, todayMinutes, todayCount }) => {
    return await studyRoomSync.uploadTodayStats(roomId, todayMinutes, todayCount)
  })

  ipcMain.handle('study-room-upload-session', async (event, { roomId, minutes, note }) => {
    return await studyRoomSync.uploadFocusSession(roomId, minutes, note)
  })

  ipcMain.handle('study-room-get-ranking', async (event, { roomId }) => {
    return await studyRoomSync.getTodayRanking(roomId)
  })

  ipcMain.handle('study-room-get-members', async (event, { roomId }) => {
    return await studyRoomSync.getRoomMembers(roomId)
  })

  ipcMain.handle('study-room-update-status', async (event, { roomId }) => {
    return await studyRoomSync.updateOnlineStatus(roomId)
  })

  ipcMain.handle('study-room-check-status', async (event, { roomId }) => {
    return await studyRoomSync.checkRoomStatus(roomId)
  })

  // ============ API Key 管理 ============
  ipcMain.handle('get-api-key', () => {
    const data = dataManager.readData()
    return data.apiKey || null
  })

  ipcMain.handle('save-api-key', (event, apiKey) => {
    const aiAssistant = require('../src/modules/aiAssistant')
    const foregroundInspection = require('../src/modules/foregroundInspection')
    const songDownloader = require('../src/modules/songDownloader')
    const data = dataManager.readData()
    data.apiKey = apiKey
    const success = dataManager.writeData(data)

    if (success) {
      aiAssistant.setApiKey(apiKey)
      foregroundInspection.setApiKey(apiKey)
      songDownloader.setApiKey(apiKey)
    }

    return success
  })

  ipcMain.handle('get-api-mode', () => {
    const data = dataManager.readData()
    return data.apiMode || 'cloud'
  })

  ipcMain.handle('set-api-mode', (event, mode) => {
    const aiAssistant = require('../src/modules/aiAssistant')
    const foregroundInspection = require('../src/modules/foregroundInspection')
    const data = dataManager.readData()
    data.apiMode = mode
    const success = dataManager.writeData(data)

    if (success && mode === 'cloud') {
      const session = cloudAuth.getSession()
      if (!session || !session.admin) {
        aiAssistant.setApiKey(null)
        foregroundInspection.setApiKey(null)
      }
    }

    return success
  })
}

module.exports = { register }
