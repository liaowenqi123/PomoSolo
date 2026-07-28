/**
 * main.js 测试
 *
 * main.js 是应用入口，在 require 时立即执行：
 * 1. 请求单实例锁
 * 2. 注册所有 IPC 模块
 * 3. 注册 app.whenReady / window-all-closed / before-quit 回调
 * 4. createWindow() 内部创建窗口、启动子进程、注册回调
 *
 * 关键点：
 * - vi.mock 在 forks pool 下不拦截 CJS require，必须用 __registerRequireMock
 * - app.whenReady() 返回 Promise，回调通过 .then() 注册，不在 app.on() 中
 * - 不能在 beforeEach 中 vi.clearAllMocks()，会清除 beforeAll 的调用记录
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

const electronMock = require('./__mocks__/electron-mock')

// ============ mock 对象定义 ============
const mockState = {
  mainWindow: null,
  gardenWindow: null,
  tray: null,
  focusModeEnabled: false,
  timerRunning: false,
  timerPaused: false,
  foregroundInspectionReady: false,
  normalModePosition: null,
  miniModePosition: null,
  isQuitting: false
}

const mockMusicProcess = {
  start: vi.fn(),
  stop: vi.fn(),
  setVolume: vi.fn(),
  onReady: vi.fn(),
  onStatus: vi.fn(),
  onTrackChange: vi.fn(),
  onPlayState: vi.fn(),
  onProgress: vi.fn(),
  onDevices: vi.fn(),
  onNoMusic: vi.fn(),
  onPlayError: vi.fn(),
  onVolumeChange: vi.fn(),
  onPlayMode: vi.fn(),
  onPlaylist: vi.fn(),
  onSongMissing: vi.fn(),
  onHotkeys: vi.fn(),
  onHotkeyKeyPressed: vi.fn(),
  onHotkeyRecordingStopped: vi.fn()
}

const mockForegroundInspection = {
  start: vi.fn(),
  stop: vi.fn(),
  setApiKey: vi.fn(),
  onReady: vi.fn(),
  onApiKeyInvalid: vi.fn(),
  onEntertainmentDetected: vi.fn(),
  onStatus: vi.fn(),
  onError: vi.fn()
}

const mockAiAssistant = { setApiKey: vi.fn() }
const mockCloudAuth = {
  init: vi.fn(),
  getSession: vi.fn().mockReturnValue(null),
  markOffline: vi.fn().mockResolvedValue(undefined),
  stopHeartbeat: vi.fn()
}
const mockSongDownloader = { setApiKey: vi.fn() }
const mockStudyRoomSync = { init: vi.fn() }
const mockWindows = { showInstanceExistsDialog: vi.fn() }
const mockIpcWindow = {
  loadMiniModePosition: vi.fn(),
  register: vi.fn()
}
const mockUserDataBackup = { restoreUserData: vi.fn().mockReturnValue(false) }
const mockAutoUpdate = { init: vi.fn() }

const mockIpcData = { register: vi.fn() }
const mockIpcGarden = { register: vi.fn() }
const mockIpcCloud = { register: vi.fn() }
const mockIpcMusic = { register: vi.fn() }
const mockIpcForeground = { register: vi.fn() }
const mockIpcAi = { register: vi.fn() }
const mockIpcUpdate = { register: vi.fn() }

const mockDataManager = {
  readData: vi.fn().mockReturnValue({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
}

// ============ 通过 __registerRequireMock 注册 CJS mock ============
// vi.mock 在 forks pool 下不拦截 CJS require，必须用 setup.js 提供的机制
// 这些注册在模块加载时立即执行（早于 beforeAll）
global.__registerRequireMock('./main/state', mockState)
global.__registerRequireMock('./main/ipc-data', mockIpcData)
global.__registerRequireMock('./main/ipc-garden', mockIpcGarden)
global.__registerRequireMock('./main/ipc-cloud', mockIpcCloud)
global.__registerRequireMock('./main/ipc-music', mockIpcMusic)
global.__registerRequireMock('./main/ipc-window', mockIpcWindow)
global.__registerRequireMock('./main/ipc-foreground', mockIpcForeground)
global.__registerRequireMock('./main/ipc-ai', mockIpcAi)
global.__registerRequireMock('./main/ipc-update', mockIpcUpdate)
global.__registerRequireMock('./main/windows', mockWindows)
global.__registerRequireMock('./main/userData-backup', mockUserDataBackup)
global.__registerRequireMock('./main/auto-update', mockAutoUpdate)
global.__registerRequireMock('./src/modules/musicProcess', mockMusicProcess)
global.__registerRequireMock('./src/modules/aiAssistant', mockAiAssistant)
global.__registerRequireMock('./src/modules/foregroundInspection', mockForegroundInspection)
global.__registerRequireMock('./src/modules/cloudAuth', mockCloudAuth)
global.__registerRequireMock('./src/modules/dataManager', mockDataManager)
global.__registerRequireMock('./src/modules/studyRoomSync', mockStudyRoomSync)
global.__registerRequireMock('./src/modules/songDownloader', mockSongDownloader)

// ============ 工具函数 ============
function latestWindow() {
  const instances = electronMock.BrowserWindow.mock.instances
  return instances[instances.length - 1]
}

describe('main.js 应用入口', () => {
  let whenReadyCallback = null
  let mainLoaded = false

  beforeAll(() => {
    // 重置 app 调用记录
    electronMock.app.on.mockClear()
    electronMock.app.requestSingleInstanceLock.mockClear()
    electronMock.app.quit.mockClear()
    electronMock.app.exit.mockClear()

    // 覆盖 app.whenReady 以捕获回调（不自动执行）
    // main.js 调用 app.whenReady().then(cb)，我们捕获 cb
    electronMock.app.whenReady = vi.fn().mockReturnValue({
      then: (cb) => { whenReadyCallback = cb; return this; }
    })

    require('../main')
    mainLoaded = true
  })

  beforeEach(() => {
    // 重置 state（每次测试前）
    mockState.isQuitting = false
    mockState.mainWindow = null
    mockState.foregroundInspectionReady = false
    electronMock.app.isPackaged = false
    electronMock.app.exit.mockClear()
  })

  describe('单实例锁', () => {
    it('应调用 requestSingleInstanceLock', () => {
      expect(electronMock.app.requestSingleInstanceLock).toHaveBeenCalled()
    })

    it('应注册 second-instance 事件回调', () => {
      const call = electronMock.app.on.mock.calls.find(c => c[0] === 'second-instance')
      expect(call).toBeDefined()
      mockWindows.showInstanceExistsDialog.mockClear()
      call[1]()
      expect(mockWindows.showInstanceExistsDialog).toHaveBeenCalled()
    })
  })

  describe('IPC 模块注册', () => {
    it('应注册所有 8 个 IPC 模块', () => {
      expect(mockIpcData.register).toHaveBeenCalled()
      expect(mockIpcGarden.register).toHaveBeenCalled()
      expect(mockIpcCloud.register).toHaveBeenCalled()
      expect(mockIpcMusic.register).toHaveBeenCalled()
      expect(mockIpcWindow.register).toHaveBeenCalled()
      expect(mockIpcForeground.register).toHaveBeenCalled()
      expect(mockIpcAi.register).toHaveBeenCalled()
      expect(mockIpcUpdate.register).toHaveBeenCalled()
    })

    it('应传入 ipcMain 对象', () => {
      expect(mockIpcData.register).toHaveBeenCalledWith(electronMock.ipcMain)
      expect(mockIpcGarden.register).toHaveBeenCalledWith(electronMock.ipcMain)
    })
  })

  describe('app.whenReady 回调', () => {
    it('应注册 whenReady 回调', () => {
      expect(whenReadyCallback).toBeTypeOf('function')
    })

    it('未打包时不应调用 restoreUserData', async () => {
      electronMock.app.isPackaged = false
      mockUserDataBackup.restoreUserData.mockClear()
      mockCloudAuth.init.mockClear()
      mockStudyRoomSync.init.mockClear()
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      expect(mockUserDataBackup.restoreUserData).not.toHaveBeenCalled()
      expect(mockCloudAuth.init).toHaveBeenCalled()
      expect(mockStudyRoomSync.init).toHaveBeenCalled()
    })

    it('打包时应调用 restoreUserData', async () => {
      electronMock.app.isPackaged = true
      const origResourcesPath = process.resourcesPath
      process.resourcesPath = '/fake/resources'
      mockUserDataBackup.restoreUserData.mockClear()
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      expect(mockUserDataBackup.restoreUserData).toHaveBeenCalled()
      process.resourcesPath = origResourcesPath
      electronMock.app.isPackaged = false
    })

    it('应初始化 cloudAuth 和 studyRoomSync', async () => {
      mockCloudAuth.init.mockClear()
      mockStudyRoomSync.init.mockClear()
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      expect(mockCloudAuth.init).toHaveBeenCalled()
      expect(mockStudyRoomSync.init).toHaveBeenCalled()
    })

    it('云模式不应设置本地 API Key', async () => {
      mockAiAssistant.setApiKey.mockClear()
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud' })
      await whenReadyCallback()
      expect(mockAiAssistant.setApiKey).not.toHaveBeenCalled()
    })

    it('本地模式且 apiKey 存在时应设置所有模块的 API Key', async () => {
      mockAiAssistant.setApiKey.mockClear()
      mockForegroundInspection.setApiKey.mockClear()
      mockSongDownloader.setApiKey.mockClear()
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'local', apiKey: 'sk-test' })
      await whenReadyCallback()
      expect(mockAiAssistant.setApiKey).toHaveBeenCalledWith('sk-test')
      expect(mockForegroundInspection.setApiKey).toHaveBeenCalledWith('sk-test')
      expect(mockSongDownloader.setApiKey).toHaveBeenCalledWith('sk-test')
    })

    it('应调用 loadMiniModePosition', async () => {
      mockIpcWindow.loadMiniModePosition.mockClear()
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      expect(mockIpcWindow.loadMiniModePosition).toHaveBeenCalled()
    })

    it('应注册 activate 事件', async () => {
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      const call = electronMock.app.on.mock.calls.find(c => c[0] === 'activate')
      expect(call).toBeDefined()
    })
  })

  describe('window-all-closed 回调', () => {
    let callback

    beforeAll(() => {
      const call = electronMock.app.on.mock.calls.find(c => c[0] === 'window-all-closed')
      expect(call).toBeDefined()
      callback = call[1]
    })

    it('应停止 music 和 foreground 子进程', () => {
      mockMusicProcess.stop.mockClear()
      mockForegroundInspection.stop.mockClear()
      callback()
      expect(mockMusicProcess.stop).toHaveBeenCalled()
      expect(mockForegroundInspection.stop).toHaveBeenCalled()
    })

    it('非 darwin 平台应调用 app.quit', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      electronMock.app.quit.mockClear()
      callback()
      expect(electronMock.app.quit).toHaveBeenCalled()
    })
  })

  describe('before-quit 回调 - 无会话', () => {
    let callback

    beforeAll(() => {
      const call = electronMock.app.on.mock.calls.find(c => c[0] === 'before-quit')
      expect(call).toBeDefined()
      callback = call[1]
    })

    it('无 session 时应停止子进程并直接返回（不阻止退出）', () => {
      mockCloudAuth.getSession.mockReturnValueOnce(null)
      mockMusicProcess.stop.mockClear()
      mockForegroundInspection.stop.mockClear()
      const event = { preventDefault: vi.fn() }
      callback(event)
      expect(mockMusicProcess.stop).toHaveBeenCalled()
      expect(mockForegroundInspection.stop).toHaveBeenCalled()
      expect(event.preventDefault).not.toHaveBeenCalled()
    })
  })

  describe('before-quit 回调 - 有会话', () => {
    let callback

    beforeAll(() => {
      const call = electronMock.app.on.mock.calls.find(c => c[0] === 'before-quit')
      callback = call[1]
    })

    it('有 session 时应 preventDefault 并隐藏窗口', () => {
      mockCloudAuth.getSession.mockReturnValueOnce({ id: 1, username: 'u' })
      mockCloudAuth.stopHeartbeat.mockClear()
      mockMusicProcess.stop.mockClear()
      mockForegroundInspection.stop.mockClear()
      mockCloudAuth.markOffline.mockClear()
      const event = { preventDefault: vi.fn() }
      callback(event)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(mockState.isQuitting).toBe(true)
      expect(mockCloudAuth.stopHeartbeat).toHaveBeenCalled()
      expect(mockMusicProcess.stop).toHaveBeenCalled()
      expect(mockForegroundInspection.stop).toHaveBeenCalled()
      expect(mockCloudAuth.markOffline).toHaveBeenCalledWith(1)
    })

    it('markOffline 成功后应调用 app.exit(0)', async () => {
      vi.useFakeTimers()
      mockCloudAuth.getSession.mockReturnValueOnce({ id: 1, username: 'u' })
      mockCloudAuth.markOffline.mockResolvedValueOnce(undefined)
      electronMock.app.exit.mockClear()
      const event = { preventDefault: vi.fn() }
      callback(event)
      await vi.runAllTimersAsync()
      expect(electronMock.app.exit).toHaveBeenCalledWith(0)
      vi.useRealTimers()
    })

    it('markOffline 失败后也应调用 app.exit(0)', async () => {
      vi.useFakeTimers()
      mockCloudAuth.getSession.mockReturnValueOnce({ id: 1, username: 'u' })
      mockCloudAuth.markOffline.mockRejectedValueOnce(new Error('network'))
      electronMock.app.exit.mockClear()
      const event = { preventDefault: vi.fn() }
      callback(event)
      await vi.runAllTimersAsync()
      expect(electronMock.app.exit).toHaveBeenCalledWith(0)
      vi.useRealTimers()
    })

    it('2 秒超时应强制退出', async () => {
      vi.useFakeTimers()
      mockCloudAuth.getSession.mockReturnValueOnce({ id: 1, username: 'u' })
      mockCloudAuth.markOffline.mockReturnValueOnce(new Promise(() => {}))
      electronMock.app.exit.mockClear()
      const event = { preventDefault: vi.fn() }
      callback(event)
      await vi.advanceTimersByTimeAsync(2100)
      expect(electronMock.app.exit).toHaveBeenCalledWith(0)
      vi.useRealTimers()
    })

    it('isQuitting=true 时应直接返回（防止重复触发）', () => {
      mockState.isQuitting = true
      mockCloudAuth.getSession.mockClear()
      const event = { preventDefault: vi.fn() }
      callback(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(mockCloudAuth.getSession).not.toHaveBeenCalled()
      mockState.isQuitting = false
    })
  })

  describe('createWindow 内部逻辑', () => {
    it('whenReady 触发后应创建 BrowserWindow 并启动子进程', async () => {
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      mockMusicProcess.start.mockClear()
      mockForegroundInspection.start.mockClear()
      mockAutoUpdate.init.mockClear()
      await whenReadyCallback()

      expect(electronMock.BrowserWindow).toHaveBeenCalled()
      expect(mockMusicProcess.start).toHaveBeenCalled()
      expect(mockForegroundInspection.start).toHaveBeenCalled()
      expect(mockAutoUpdate.init).toHaveBeenCalled()
    })

    it('应加载 loading.html', async () => {
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      const win = latestWindow()
      expect(win.loadFile).toHaveBeenCalledWith('src/loading.html')
    })

    it('应注册 F12 切换 DevTools 的 before-input-event 处理器', async () => {
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      const win = latestWindow()
      const call = win.webContents.on.mock.calls.find(c => c[0] === 'before-input-event')
      expect(call).toBeDefined()
      const handler = call[1]

      // handler 签名是 (event, input)
      win.webContents.openDevTools.mockClear()
      win.webContents.closeDevTools.mockClear()
      win.webContents.isDevToolsOpened.mockReturnValueOnce(false)
      handler({}, { type: 'keyDown', key: 'F12' })
      expect(win.webContents.openDevTools).toHaveBeenCalled()

      win.webContents.openDevTools.mockClear()
      win.webContents.closeDevTools.mockClear()
      win.webContents.isDevToolsOpened.mockReturnValueOnce(true)
      handler({}, { type: 'keyDown', key: 'F12' })
      expect(win.webContents.closeDevTools).toHaveBeenCalled()

      win.webContents.openDevTools.mockClear()
      win.webContents.closeDevTools.mockClear()
      handler({}, { type: 'keyDown', key: 'Enter' })
      expect(win.webContents.openDevTools).not.toHaveBeenCalled()
      expect(win.webContents.closeDevTools).not.toHaveBeenCalled()

      handler({}, { type: 'keyUp', key: 'F12' })
      expect(win.webContents.openDevTools).not.toHaveBeenCalled()
    })

    it('未打包时应注册右键菜单', async () => {
      electronMock.app.isPackaged = false
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      const win = latestWindow()
      const call = win.webContents.on.mock.calls.find(c => c[0] === 'context-menu')
      expect(call).toBeDefined()
    })

    it('music onReady 回调应更新加载进度并发送 music-ready', async () => {
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', musicVolume: 1.0 })
      await whenReadyCallback()
      const win = latestWindow()
      win.webContents.send.mockClear()

      const onReadyCall = mockMusicProcess.onReady.mock.calls[mockMusicProcess.onReady.mock.calls.length - 1]
      onReadyCall[0]({ status: 'ok' })
      expect(win.webContents.executeJavaScript).toHaveBeenCalled()
      expect(win.webContents.send).toHaveBeenCalledWith('music-ready', { status: 'ok' })
    })

    it('music onReady 当音量非 1.0 时应调用 setVolume', async () => {
      // readData 被调用两次：whenReady 中（API 模式检查）和 createWindow 中（音量）
      // 两次都需要返回 musicVolume: 0.5
      mockDataManager.readData.mockReset()
      mockDataManager.readData.mockReturnValue({ apiMode: 'cloud', audioDevice: null, musicVolume: 0.5 })
      await whenReadyCallback()
      mockMusicProcess.setVolume.mockClear()
      const onReadyCall = mockMusicProcess.onReady.mock.calls[mockMusicProcess.onReady.mock.calls.length - 1]
      onReadyCall[0]({})
      expect(mockMusicProcess.setVolume).toHaveBeenCalledWith(0.5)
      // 恢复默认 mock
      mockDataManager.readData.mockReset()
      mockDataManager.readData.mockReturnValue({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
    })

    it('foreground onReady 回调应更新状态并发送 foreground-ready', async () => {
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      mockState.foregroundInspectionReady = false
      const onReadyCall = mockForegroundInspection.onReady.mock.calls[mockForegroundInspection.onReady.mock.calls.length - 1]
      onReadyCall[0]({ ready: true })
      expect(mockState.foregroundInspectionReady).toBe(true)
    })

    it('did-finish-load 应在 index.html 加载完成后刷新 pending 事件', async () => {
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      const win = latestWindow()
      win.webContents.send.mockClear()
      win.webContents.getURL.mockReturnValueOnce('file:///src/index.html')

      const onNoMusicCall = mockMusicProcess.onNoMusic.mock.calls[mockMusicProcess.onNoMusic.mock.calls.length - 1]
      onNoMusicCall[0]({ msg: 'no music' })
      const didLoadCall = win.webContents.on.mock.calls.find(c => c[0] === 'did-finish-load')
      didLoadCall[1]()
      expect(win.webContents.send).toHaveBeenCalledWith('music-no-music', { msg: 'no music' })
    })

    it('did-finish-load 在非 index.html URL 不应刷新', async () => {
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      const win = latestWindow()
      win.webContents.getURL.mockReturnValueOnce('file:///src/loading.html')
      const didLoadCall = win.webContents.on.mock.calls.find(c => c[0] === 'did-finish-load')
      expect(() => didLoadCall[1]()).not.toThrow()
    })

    it('music 和 foreground 都 ready 后应延迟加载 index.html', async () => {
      vi.useFakeTimers()
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      const win = latestWindow()
      win.loadFile.mockClear()

      const musicOnReady = mockMusicProcess.onReady.mock.calls[mockMusicProcess.onReady.mock.calls.length - 1]
      musicOnReady[0]({})
      const fgOnReady = mockForegroundInspection.onReady.mock.calls[mockForegroundInspection.onReady.mock.calls.length - 1]
      fgOnReady[0]({})

      vi.advanceTimersByTime(400)
      expect(win.loadFile).toHaveBeenCalledWith('src/index.html')
      vi.useRealTimers()
    })

    it('打包时应使用 process.resourcesPath 作为子进程路径', async () => {
      electronMock.app.isPackaged = true
      const origResourcesPath = process.resourcesPath
      process.resourcesPath = '/fake/resources'
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      mockMusicProcess.start.mockClear()
      await whenReadyCallback()
      expect(mockMusicProcess.start).toHaveBeenCalledWith(
        expect.stringContaining('music.exe'),
        null
      )
      process.resourcesPath = origResourcesPath
      electronMock.app.isPackaged = false
    })

    it('应转发所有 music/foreground 事件到渲染进程', async () => {
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      const win = latestWindow()

      const events = [
        [mockMusicProcess.onStatus, 'music-status'],
        [mockMusicProcess.onTrackChange, 'music-track-change'],
        [mockMusicProcess.onPlayState, 'music-play-state'],
        [mockMusicProcess.onProgress, 'music-progress'],
        [mockMusicProcess.onDevices, 'music-devices'],
        [mockMusicProcess.onPlayError, 'music-play-error'],
        [mockMusicProcess.onVolumeChange, 'music-volume-change'],
        [mockMusicProcess.onPlayMode, 'music-play-mode'],
        [mockMusicProcess.onPlaylist, 'music-playlist'],
        [mockMusicProcess.onSongMissing, 'music-song-missing'],
        [mockMusicProcess.onHotkeys, 'music-hotkeys'],
        [mockMusicProcess.onHotkeyKeyPressed, 'music-hotkey-key-pressed'],
        [mockMusicProcess.onHotkeyRecordingStopped, 'music-hotkey-recording-stopped'],
        [mockForegroundInspection.onStatus, 'foreground-status'],
        [mockForegroundInspection.onError, 'foreground-error']
      ]
      events.forEach(([mockFn, channel]) => {
        const lastCall = mockFn.mock.calls[mockFn.mock.calls.length - 1]
        expect(lastCall).toBeDefined()
        win.webContents.send.mockClear()
        lastCall[0]({ test: channel })
        expect(win.webContents.send).toHaveBeenCalledWith(channel, { test: channel })
      })
    })

    it('foreground onApiKeyInvalid 和 onEntertainmentDetected 通过 sendToRenderer', async () => {
      mockDataManager.readData.mockReturnValueOnce({ apiMode: 'cloud', audioDevice: null, musicVolume: 1.0 })
      await whenReadyCallback()
      const win = latestWindow()

      // 触发 did-finish-load 使 mainPageLoaded=true
      win.webContents.getURL.mockReturnValueOnce('file:///src/index.html')
      const didLoadCall = win.webContents.on.mock.calls.find(c => c[0] === 'did-finish-load')
      didLoadCall[1]()

      win.webContents.send.mockClear()
      const onApiKeyInvalid = mockForegroundInspection.onApiKeyInvalid.mock.calls[mockForegroundInspection.onApiKeyInvalid.mock.calls.length - 1]
      onApiKeyInvalid[0]({ code: 401 })
      expect(win.webContents.send).toHaveBeenCalledWith('foreground-api-key-invalid', { code: 401 })

      win.webContents.send.mockClear()
      const onEntDetected = mockForegroundInspection.onEntertainmentDetected.mock.calls[mockForegroundInspection.onEntertainmentDetected.mock.calls.length - 1]
      onEntDetected[0]({ app: 'game' })
      expect(win.webContents.send).toHaveBeenCalledWith('foreground-entertainment-detected', { app: 'game' })
    })
  })
})
