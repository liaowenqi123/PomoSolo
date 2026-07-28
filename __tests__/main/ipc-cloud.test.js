/**
 * main/ipc-cloud.js 测试
 *
 * 测试所有 cloud-* / study-room-* / feedback / api-key / auto-start 处理器。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

// Mock cloudAuth
const mockCloudAuth = vi.hoisted(() => {
  const m = {
    saveCredentials: vi.fn(),
    loadCredentials: vi.fn(),
    clearCredentials: vi.fn(),
    testConnection: vi.fn(),
    getSessionWithKey: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    submitFeedback: vi.fn(),
    getUserFeedbacks: vi.fn(),
    deleteFeedback: vi.fn(),
    getSession: vi.fn()
  }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/cloudAuth', m)
  return m
})
vi.mock('../../src/modules/cloudAuth', () => mockCloudAuth)

// Mock dataManager
const mockDataManager = vi.hoisted(() => {
  const m = { readData: vi.fn(), writeData: vi.fn() }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/dataManager', m)
  return m
})
vi.mock('../../src/modules/dataManager', () => mockDataManager)

// Mock studyRoomSync
const mockStudyRoomSync = vi.hoisted(() => {
  const m = {
    setCurrentUser: vi.fn(),
    getMyRooms: vi.fn(),
    getActiveRooms: vi.fn(),
    getRoomById: vi.fn(),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
    deleteRoom: vi.fn(),
    uploadTodayStats: vi.fn(),
    uploadFocusSession: vi.fn(),
    getTodayRanking: vi.fn(),
    getRoomMembers: vi.fn(),
    updateOnlineStatus: vi.fn(),
    checkRoomStatus: vi.fn()
  }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/studyRoomSync', m)
  return m
})
vi.mock('../../src/modules/studyRoomSync', () => mockStudyRoomSync)

// Mock aiAssistant (lazy required inside handlers)
const mockAiAssistant = vi.hoisted(() => {
  const m = { setApiKey: vi.fn(), generatePlan: vi.fn() }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/aiAssistant', m)
  return m
})
vi.mock('../../src/modules/aiAssistant', () => mockAiAssistant)

// Mock foregroundInspection (lazy required inside handlers)
const mockForegroundInspection = vi.hoisted(() => {
  const m = { setApiKey: vi.fn() }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/foregroundInspection', m)
  return m
})
vi.mock('../../src/modules/foregroundInspection', () => mockForegroundInspection)

// Mock songDownloader (lazy required inside handlers)
const mockSongDownloader = vi.hoisted(() => {
  const m = { setApiKey: vi.fn() }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/songDownloader', m)
  return m
})
vi.mock('../../src/modules/songDownloader', () => mockSongDownloader)

const { app } = require('electron')
const ipcMain = __electronMock.ipcMain
const { register } = require('../../main/ipc-cloud')

function findHandler(channel) {
  const call = ipcMain.handle.mock.calls.find(c => c[0] === channel)
  return call ? call[1] : undefined
}

describe('main/ipc-cloud', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    register(ipcMain)
  })

  // ============ 开机自启动 ============

  describe('auto-start', () => {
    it('set-auto-start 应调用 app.setLoginItemSettings 并返回 true', async () => {
      const handler = findHandler('set-auto-start')
      const result = await handler({}, true)
      expect(app.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: true,
        openAsHidden: false
      })
      expect(result).toBe(true)
    })

    it('set-auto-start false 时也应返回 true', async () => {
      const handler = findHandler('set-auto-start')
      const result = await handler({}, false)
      expect(app.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: false,
        openAsHidden: false
      })
      expect(result).toBe(true)
    })

    it('get-auto-start 应返回 openAtLogin 状态', async () => {
      app.getLoginItemSettings.mockReturnValue({ openAtLogin: true })
      const handler = findHandler('get-auto-start')
      const result = await handler({})
      expect(result).toBe(true)
    })

    it('get-auto-start openAtLogin 为 false 时应返回 false', async () => {
      app.getLoginItemSettings.mockReturnValue({ openAtLogin: false })
      const handler = findHandler('get-auto-start')
      const result = await handler({})
      expect(result).toBe(false)
    })
  })

  // ============ 凭据存储 ============

  describe('credentials', () => {
    it('save-credentials 应委托给 cloudAuth.saveCredentials', async () => {
      mockCloudAuth.saveCredentials.mockResolvedValue(true)
      const handler = findHandler('save-credentials')
      const result = await handler({}, { username: 'u', password: 'p' })
      expect(mockCloudAuth.saveCredentials).toHaveBeenCalledWith({ username: 'u', password: 'p' })
      expect(result).toBe(true)
    })

    it('load-credentials 应委托给 cloudAuth.loadCredentials', async () => {
      mockCloudAuth.loadCredentials.mockReturnValue({ username: 'u' })
      const handler = findHandler('load-credentials')
      const result = await handler({})
      expect(mockCloudAuth.loadCredentials).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ username: 'u' })
    })

    it('clear-credentials 应委托给 cloudAuth.clearCredentials', async () => {
      mockCloudAuth.clearCredentials.mockReturnValue(true)
      const handler = findHandler('clear-credentials')
      const result = await handler({})
      expect(mockCloudAuth.clearCredentials).toHaveBeenCalledTimes(1)
      expect(result).toBe(true)
    })
  })

  // ============ 云端登录 ============

  describe('cloud auth', () => {
    it('cloud-test-connection 应委托给 cloudAuth.testConnection', async () => {
      mockCloudAuth.testConnection.mockResolvedValue({ success: true })
      const handler = findHandler('cloud-test-connection')
      const result = await handler({})
      expect(mockCloudAuth.testConnection).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ success: true })
    })

    it('cloud-get-session 应委托给 cloudAuth.getSessionWithKey', async () => {
      mockCloudAuth.getSessionWithKey.mockResolvedValue({ user: { id: 1 } })
      const handler = findHandler('cloud-get-session')
      const result = await handler({})
      expect(mockCloudAuth.getSessionWithKey).toHaveBeenCalledWith(mockAiAssistant, mockSongDownloader, mockForegroundInspection)
      expect(result).toEqual({ user: { id: 1 } })
    })

    it('cloud-login 成功且有 user 时应设置 studyRoomSync 当前用户', async () => {
      const user = { id: 1, username: 'test' }
      mockCloudAuth.login.mockResolvedValue({ success: true, user })
      const handler = findHandler('cloud-login')
      const result = await handler({}, { username: 'test', password: '123' })
      expect(mockCloudAuth.login).toHaveBeenCalledWith('test', '123', mockAiAssistant, mockSongDownloader, mockForegroundInspection)
      expect(mockStudyRoomSync.setCurrentUser).toHaveBeenCalledWith(user)
      expect(result).toEqual({ success: true, user })
    })

    it('cloud-login 成功但无 user 时不应设置 studyRoomSync 当前用户', async () => {
      mockCloudAuth.login.mockResolvedValue({ success: true, user: null })
      const handler = findHandler('cloud-login')
      await handler({}, { username: 'test', password: '123' })
      expect(mockStudyRoomSync.setCurrentUser).not.toHaveBeenCalled()
    })

    it('cloud-login 失败时不应设置 studyRoomSync 当前用户', async () => {
      mockCloudAuth.login.mockResolvedValue({ success: false, error: '密码错误' })
      const handler = findHandler('cloud-login')
      await handler({}, { username: 'test', password: 'wrong' })
      expect(mockStudyRoomSync.setCurrentUser).not.toHaveBeenCalled()
    })

    it('cloud-register 应委托给 cloudAuth.register', async () => {
      mockCloudAuth.register.mockResolvedValue({ success: true })
      const handler = findHandler('cloud-register')
      const result = await handler({}, { username: 'new', password: '123' })
      expect(mockCloudAuth.register).toHaveBeenCalledWith('new', '123')
      expect(result).toEqual({ success: true })
    })

    it('cloud-logout 应委托给 cloudAuth.logout', async () => {
      mockCloudAuth.logout.mockResolvedValue({ success: true })
      const handler = findHandler('cloud-logout')
      const result = await handler({})
      expect(mockCloudAuth.logout).toHaveBeenCalledWith(mockAiAssistant, mockForegroundInspection, mockSongDownloader)
      expect(result).toEqual({ success: true })
    })
  })

  // ============ 意见反馈 ============

  describe('feedback', () => {
    it('submit-feedback 应委托给 cloudAuth.submitFeedback', async () => {
      mockCloudAuth.submitFeedback.mockResolvedValue({ success: true })
      const handler = findHandler('submit-feedback')
      const result = await handler({}, '这是一个建议')
      expect(mockCloudAuth.submitFeedback).toHaveBeenCalledWith('这是一个建议')
      expect(result).toEqual({ success: true })
    })

    it('get-user-feedbacks 应委托给 cloudAuth.getUserFeedbacks', async () => {
      mockCloudAuth.getUserFeedbacks.mockResolvedValue([{ id: 1, content: 'c' }])
      const handler = findHandler('get-user-feedbacks')
      const result = await handler({})
      expect(mockCloudAuth.getUserFeedbacks).toHaveBeenCalledTimes(1)
      expect(result).toEqual([{ id: 1, content: 'c' }])
    })

    it('delete-feedback 应委托给 cloudAuth.deleteFeedback', async () => {
      mockCloudAuth.deleteFeedback.mockResolvedValue({ success: true })
      const handler = findHandler('delete-feedback')
      const result = await handler({}, 42)
      expect(mockCloudAuth.deleteFeedback).toHaveBeenCalledWith(42)
      expect(result).toEqual({ success: true })
    })
  })

  // ============ 自习室 ============

  describe('study-room', () => {
    it('study-room-get-my-rooms 应委托给 studyRoomSync.getMyRooms', async () => {
      mockStudyRoomSync.getMyRooms.mockResolvedValue([{ id: 1 }])
      const handler = findHandler('study-room-get-my-rooms')
      const result = await handler({})
      expect(mockStudyRoomSync.getMyRooms).toHaveBeenCalledTimes(1)
      expect(result).toEqual([{ id: 1 }])
    })

    it('study-room-get-active 应委托给 studyRoomSync.getActiveRooms', async () => {
      mockStudyRoomSync.getActiveRooms.mockResolvedValue([])
      const handler = findHandler('study-room-get-active')
      await handler({}, { publicOnly: true })
      expect(mockStudyRoomSync.getActiveRooms).toHaveBeenCalledWith(true)
    })

    it('study-room-get-active 无参数时 publicOnly 应为 undefined', async () => {
      mockStudyRoomSync.getActiveRooms.mockResolvedValue([])
      const handler = findHandler('study-room-get-active')
      await handler({})
      expect(mockStudyRoomSync.getActiveRooms).toHaveBeenCalledWith(undefined)
    })

    it('study-room-get-by-id 应委托给 studyRoomSync.getRoomById', async () => {
      mockStudyRoomSync.getRoomById.mockResolvedValue({ id: 5 })
      const handler = findHandler('study-room-get-by-id')
      const result = await handler({}, { roomId: 5 })
      expect(mockStudyRoomSync.getRoomById).toHaveBeenCalledWith(5)
      expect(result).toEqual({ id: 5 })
    })

    it('study-room-create 应委托给 studyRoomSync.createRoom', async () => {
      mockStudyRoomSync.createRoom.mockResolvedValue({ success: true })
      const handler = findHandler('study-room-create')
      await handler({}, { name: 'room', description: 'desc', isPublic: true })
      expect(mockStudyRoomSync.createRoom).toHaveBeenCalledWith('room', 'desc', true)
    })

    it('study-room-join 应委托给 studyRoomSync.joinRoom', async () => {
      mockStudyRoomSync.joinRoom.mockResolvedValue({ success: true })
      const handler = findHandler('study-room-join')
      await handler({}, { roomId: 7 })
      expect(mockStudyRoomSync.joinRoom).toHaveBeenCalledWith(7)
    })

    it('study-room-leave 应委托给 studyRoomSync.leaveRoom', async () => {
      mockStudyRoomSync.leaveRoom.mockResolvedValue({ success: true })
      const handler = findHandler('study-room-leave')
      await handler({}, { roomId: 7 })
      expect(mockStudyRoomSync.leaveRoom).toHaveBeenCalledWith(7)
    })

    it('study-room-delete 应委托给 studyRoomSync.deleteRoom', async () => {
      mockStudyRoomSync.deleteRoom.mockResolvedValue({ success: true })
      const handler = findHandler('study-room-delete')
      await handler({}, { roomId: 7 })
      expect(mockStudyRoomSync.deleteRoom).toHaveBeenCalledWith(7)
    })

    it('study-room-upload-stats 应委托给 studyRoomSync.uploadTodayStats', async () => {
      mockStudyRoomSync.uploadTodayStats.mockResolvedValue({ success: true })
      const handler = findHandler('study-room-upload-stats')
      await handler({}, { roomId: 1, todayMinutes: 30, todayCount: 2 })
      expect(mockStudyRoomSync.uploadTodayStats).toHaveBeenCalledWith(1, 30, 2)
    })

    it('study-room-upload-session 应委托给 studyRoomSync.uploadFocusSession', async () => {
      mockStudyRoomSync.uploadFocusSession.mockResolvedValue({ success: true })
      const handler = findHandler('study-room-upload-session')
      await handler({}, { roomId: 1, minutes: 25, note: 'session' })
      expect(mockStudyRoomSync.uploadFocusSession).toHaveBeenCalledWith(1, 25, 'session')
    })

    it('study-room-get-ranking 应委托给 studyRoomSync.getTodayRanking', async () => {
      mockStudyRoomSync.getTodayRanking.mockResolvedValue([])
      const handler = findHandler('study-room-get-ranking')
      await handler({}, { roomId: 1 })
      expect(mockStudyRoomSync.getTodayRanking).toHaveBeenCalledWith(1)
    })

    it('study-room-get-members 应委托给 studyRoomSync.getRoomMembers', async () => {
      mockStudyRoomSync.getRoomMembers.mockResolvedValue([])
      const handler = findHandler('study-room-get-members')
      await handler({}, { roomId: 1 })
      expect(mockStudyRoomSync.getRoomMembers).toHaveBeenCalledWith(1)
    })

    it('study-room-update-status 应委托给 studyRoomSync.updateOnlineStatus', async () => {
      mockStudyRoomSync.updateOnlineStatus.mockResolvedValue({ success: true })
      const handler = findHandler('study-room-update-status')
      await handler({}, { roomId: 1 })
      expect(mockStudyRoomSync.updateOnlineStatus).toHaveBeenCalledWith(1)
    })

    it('study-room-check-status 应委托给 studyRoomSync.checkRoomStatus', async () => {
      mockStudyRoomSync.checkRoomStatus.mockResolvedValue({ active: true })
      const handler = findHandler('study-room-check-status')
      await handler({}, { roomId: 1 })
      expect(mockStudyRoomSync.checkRoomStatus).toHaveBeenCalledWith(1)
    })
  })

  // ============ API Key 管理 ============

  describe('api-key', () => {
    it('get-api-key 应返回 data.apiKey', async () => {
      mockDataManager.readData.mockReturnValue({ apiKey: 'sk-123' })
      const handler = findHandler('get-api-key')
      const result = await handler({})
      expect(result).toBe('sk-123')
    })

    it('get-api-key 无 apiKey 时应返回 null', async () => {
      mockDataManager.readData.mockReturnValue({})
      const handler = findHandler('get-api-key')
      const result = await handler({})
      expect(result).toBeNull()
    })

    it('save-api-key 成功时应设置所有模块的 apiKey', async () => {
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(true)
      const handler = findHandler('save-api-key')
      const result = await handler({}, 'sk-new')
      expect(mockDataManager.writeData).toHaveBeenCalled()
      expect(mockAiAssistant.setApiKey).toHaveBeenCalledWith('sk-new')
      expect(mockForegroundInspection.setApiKey).toHaveBeenCalledWith('sk-new')
      expect(mockSongDownloader.setApiKey).toHaveBeenCalledWith('sk-new')
      expect(result).toBe(true)
    })

    it('save-api-key 写入失败时不应设置 apiKey', async () => {
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(false)
      const handler = findHandler('save-api-key')
      const result = await handler({}, 'sk-new')
      expect(mockAiAssistant.setApiKey).not.toHaveBeenCalled()
      expect(mockForegroundInspection.setApiKey).not.toHaveBeenCalled()
      expect(mockSongDownloader.setApiKey).not.toHaveBeenCalled()
      expect(result).toBe(false)
    })

    it('get-api-mode 应返回 data.apiMode', async () => {
      mockDataManager.readData.mockReturnValue({ apiMode: 'local' })
      const handler = findHandler('get-api-mode')
      const result = await handler({})
      expect(result).toBe('local')
    })

    it('get-api-mode 无 apiMode 时应返回 cloud', async () => {
      mockDataManager.readData.mockReturnValue({})
      const handler = findHandler('get-api-mode')
      const result = await handler({})
      expect(result).toBe('cloud')
    })

    it('set-api-mode cloud 模式且非 admin 时应清除 apiKey', async () => {
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(true)
      mockCloudAuth.getSession.mockReturnValue(null)
      const handler = findHandler('set-api-mode')
      const result = await handler({}, 'cloud')
      expect(mockAiAssistant.setApiKey).toHaveBeenCalledWith(null)
      expect(mockForegroundInspection.setApiKey).toHaveBeenCalledWith(null)
      expect(result).toBe(true)
    })

    it('set-api-mode cloud 模式且 admin 时不应清除 apiKey', async () => {
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(true)
      mockCloudAuth.getSession.mockReturnValue({ admin: true })
      const handler = findHandler('set-api-mode')
      await handler({}, 'cloud')
      expect(mockAiAssistant.setApiKey).not.toHaveBeenCalled()
      expect(mockForegroundInspection.setApiKey).not.toHaveBeenCalled()
    })

    it('set-api-mode local 模式时不应清除 apiKey', async () => {
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(true)
      mockCloudAuth.getSession.mockReturnValue(null)
      const handler = findHandler('set-api-mode')
      await handler({}, 'local')
      expect(mockAiAssistant.setApiKey).not.toHaveBeenCalled()
      expect(mockForegroundInspection.setApiKey).not.toHaveBeenCalled()
    })

    it('set-api-mode 写入失败时不应清除 apiKey', async () => {
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(false)
      mockCloudAuth.getSession.mockReturnValue(null)
      const handler = findHandler('set-api-mode')
      await handler({}, 'cloud')
      expect(mockAiAssistant.setApiKey).not.toHaveBeenCalled()
    })
  })
})
