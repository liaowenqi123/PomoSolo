/**
 * preload.js 测试
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

const electronMock = require('./__mocks__/electron-mock')

describe('preload.js', () => {
  let api

  beforeAll(() => {
    electronMock.contextBridge.exposeInMainWorld.mockClear()
    electronMock.ipcRenderer.send.mockClear()
    electronMock.ipcRenderer.invoke.mockClear()
    electronMock.ipcRenderer.on.mockClear()
    electronMock.ipcRenderer.removeAllListeners.mockClear()

    require('../preload')

    expect(electronMock.contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1)
    const call = electronMock.contextBridge.exposeInMainWorld.mock.calls[0]
    expect(call[0]).toBe('electronAPI')
    api = call[1]
    expect(typeof api).toBe('object')
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('基础窗口/通知 API', () => {
    it('openExternal', () => {
      api.openExternal('https://example.com')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('open-external', 'https://example.com')
    })
    it('closeWindow', () => {
      api.closeWindow()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('close-window')
    })
    it('minimizeWindow', () => {
      api.minimizeWindow()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('minimize-window')
    })
    it('showNotification 应包装 title/body 为对象', () => {
      api.showNotification('标题', '正文')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('show-notification', { title: '标题', body: '正文' })
    })
  })

  describe('数据存储 API', () => {
    it('readData', () => {
      api.readData()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('read-data')
    })
    it('writeData', () => {
      api.writeData({ foo: 'bar' })
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('write-data', { foo: 'bar' })
    })
  })

  describe('设置 API', () => {
    it('readSettings', () => {
      api.readSettings()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('read-settings')
    })
    it('writeSettings', () => {
      api.writeSettings({ key: 1 })
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('write-settings', { key: 1 })
    })
  })

  describe('菜园子 API', () => {
    it('gardenRead', () => {
      api.gardenRead()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('garden-read')
    })
    it('gardenWrite', () => {
      api.gardenWrite({ plots: [] })
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('garden-write', { plots: [] })
    })
    it('gardenPlant', () => {
      api.gardenPlant(2, 'tomato')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('garden-plant', 2, 'tomato')
    })
    it('gardenHarvest', () => {
      api.gardenHarvest(3)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('garden-harvest', 3)
    })
    it('gardenBuySeed', () => {
      api.gardenBuySeed('carrot')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('garden-buy-seed', 'carrot')
    })
    it('gardenSellCrop', () => {
      api.gardenSellCrop('rose')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('garden-sell-crop', 'rose')
    })
    it('gardenSellAll', () => {
      api.gardenSellAll()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('garden-sell-all')
    })
    it('gardenUnlockPlot', () => {
      api.gardenUnlockPlot(6)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('garden-unlock-plot', 6)
    })
    it('gardenSignIn', () => {
      api.gardenSignIn()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('garden-signin')
    })
    it('gardenUpdateFocus', () => {
      api.gardenUpdateFocus(25)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('garden-update-focus', 25)
    })
    it('gardenGrow 通过 send', () => {
      api.gardenGrow(10)
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('garden-grow', 10)
    })
    it('gardenPunishment', () => {
      api.gardenPunishment()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('garden-punishment')
    })
    it('onGardenRefresh 直接传递 callback（不包装）', () => {
      const cb = vi.fn()
      api.onGardenRefresh(cb)
      expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith('garden-refresh', cb)
    })
  })

  describe('API Key 管理', () => {
    it('getApiKey', () => {
      api.getApiKey()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('get-api-key')
    })
    it('saveApiKey', () => {
      api.saveApiKey('sk-xxx')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('save-api-key', 'sk-xxx')
    })
    it('getApiMode', () => {
      api.getApiMode()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('get-api-mode')
    })
    it('setApiMode', () => {
      api.setApiMode('local')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('set-api-mode', 'local')
    })
  })

  describe('云端登录 API', () => {
    it('cloudTestConnection', () => {
      api.cloudTestConnection()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('cloud-test-connection')
    })
    it('cloudGetSession', () => {
      api.cloudGetSession()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('cloud-get-session')
    })
    it('cloudLogin', () => {
      const c = { username: 'u', password: 'p' }
      api.cloudLogin(c)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('cloud-login', c)
    })
    it('cloudRegister', () => {
      const u = { username: 'u', password: 'p' }
      api.cloudRegister(u)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('cloud-register', u)
    })
    it('cloudLogout', () => {
      api.cloudLogout()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('cloud-logout')
    })
  })

  describe('自习室 API', () => {
    it('studyRoomGetMyRooms', () => {
      api.studyRoomGetMyRooms()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-get-my-rooms')
    })
    it('studyRoomGetActive', () => {
      api.studyRoomGetActive(true)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-get-active', { publicOnly: true })
    })
    it('studyRoomGetActive 默认 publicOnly=false', () => {
      api.studyRoomGetActive()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-get-active', { publicOnly: false })
    })
    it('studyRoomGetById', () => {
      api.studyRoomGetById('r1')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-get-by-id', { roomId: 'r1' })
    })
    it('studyRoomCreate', () => {
      api.studyRoomCreate('room', 'desc', true)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-create', { name: 'room', description: 'desc', isPublic: true })
    })
    it('studyRoomJoin', () => {
      api.studyRoomJoin('r1')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-join', { roomId: 'r1' })
    })
    it('studyRoomLeave', () => {
      api.studyRoomLeave('r1')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-leave', { roomId: 'r1' })
    })
    it('studyRoomDelete', () => {
      api.studyRoomDelete('r1')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-delete', { roomId: 'r1' })
    })
    it('studyRoomUploadStats', () => {
      api.studyRoomUploadStats('r1', 30, 2)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-upload-stats', { roomId: 'r1', todayMinutes: 30, todayCount: 2 })
    })
    it('studyRoomUploadSession', () => {
      api.studyRoomUploadSession('r1', 25, 'note')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-upload-session', { roomId: 'r1', minutes: 25, note: 'note' })
    })
    it('studyRoomGetRanking', () => {
      api.studyRoomGetRanking('r1')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-get-ranking', { roomId: 'r1' })
    })
    it('studyRoomGetMembers', () => {
      api.studyRoomGetMembers('r1')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-get-members', { roomId: 'r1' })
    })
    it('studyRoomUpdateStatus', () => {
      api.studyRoomUpdateStatus('r1')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-update-status', { roomId: 'r1' })
    })
    it('studyRoomCheckStatus', () => {
      api.studyRoomCheckStatus('r1')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('study-room-check-status', { roomId: 'r1' })
    })
  })

  describe('凭据存储', () => {
    it('saveCredentials', () => {
      const c = { username: 'u', password: 'p' }
      api.saveCredentials(c)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('save-credentials', c)
    })
    it('loadCredentials', () => {
      api.loadCredentials()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('load-credentials')
    })
    it('clearCredentials', () => {
      api.clearCredentials()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('clear-credentials')
    })
  })

  describe('音乐播放器控制', () => {
    it('musicTogglePlay', () => {
      api.musicTogglePlay()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('music-toggle')
    })
    it('musicNext', () => {
      api.musicNext()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('music-next')
    })
    it('musicPrev', () => {
      api.musicPrev()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('music-prev')
    })
    it('musicSeek', () => {
      api.musicSeek(120)
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('music-seek', 120)
    })
    it('musicSetVolume', () => {
      api.musicSetVolume(0.5)
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('music-set-volume', 0.5)
    })
    it('musicGetStatus', () => {
      api.musicGetStatus()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('music-get-status')
    })
    it('musicGetDevices', () => {
      api.musicGetDevices()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('music-get-devices')
    })
    it('musicSetDevice', () => {
      api.musicSetDevice('dev1')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('music-set-device', 'dev1')
    })
    it('musicSetPlayMode', () => {
      api.musicSetPlayMode('shuffle')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('music-set-play-mode', 'shuffle')
    })
    it('musicGetPlaylist', () => {
      api.musicGetPlaylist()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('music-get-playlist')
    })
    it('musicDeleteSong', () => {
      api.musicDeleteSong('song.mp3')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('music-delete-song', 'song.mp3')
    })
    it('musicPlaySong', () => {
      api.musicPlaySong('song.mp3')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('music-play-song', 'song.mp3')
    })
    it('musicUpdateTag', () => {
      api.musicUpdateTag('song.mp3', 'genre', '#fff')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('music-update-tag', { name: 'song.mp3', tag: 'genre', color: '#fff' })
    })
    it('musicGetCustomTags', () => {
      api.musicGetCustomTags()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('music-get-custom-tags')
    })
    it('musicAddCustomTag', () => {
      api.musicAddCustomTag('genre2', '#000')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('music-add-custom-tag', { name: 'genre2', color: '#000' })
    })
    it('musicDeleteCustomTag', () => {
      api.musicDeleteCustomTag('genre2')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('music-delete-custom-tag', 'genre2')
    })
  })

  describe('音乐快捷键', () => {
    it('musicGetHotkeys', () => {
      api.musicGetHotkeys()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('music-get-hotkeys')
    })
    it('musicSetHotkeys', () => {
      const h = { pause: ['Ctrl'] }
      api.musicSetHotkeys(h)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('music-set-hotkeys', h)
    })
    it('musicStartHotkeyRecording', () => {
      api.musicStartHotkeyRecording()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('music-start-hotkey-recording')
    })
    it('musicStopHotkeyRecording', () => {
      api.musicStopHotkeyRecording()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('music-stop-hotkey-recording')
    })
  })

  describe('音乐事件监听器（包装回调）', () => {
    const events = [
      ['onMusicReady', 'music-ready'],
      ['onMusicStatus', 'music-status'],
      ['onMusicTrackChange', 'music-track-change'],
      ['onMusicPlayState', 'music-play-state'],
      ['onMusicProgress', 'music-progress'],
      ['onMusicDevices', 'music-devices'],
      ['onMusicNoMusic', 'music-no-music'],
      ['onMusicPlayError', 'music-play-error'],
      ['onMusicVolumeChange', 'music-volume-change'],
      ['onMusicPlayMode', 'music-play-mode'],
      ['onMusicPlaylist', 'music-playlist'],
      ['onMusicSongMissing', 'music-song-missing'],
      ['onMusicHotkeys', 'music-hotkeys'],
      ['onMusicHotkeyKeyPressed', 'music-hotkey-key-pressed'],
      ['onMusicHotkeyRecordingStopped', 'music-hotkey-recording-stopped']
    ]

    events.forEach(([methodName, channel]) => {
      it(`${methodName} 注册 ${channel} 并包装 callback 为 (data)`, () => {
        const cb = vi.fn()
        api[methodName](cb)
        expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(channel, expect.any(Function))
        const call = electronMock.ipcRenderer.on.mock.calls.find(c => c[0] === channel)
        // 包装后的 callback 只把第二个参数（data）传给用户
        call[1]({}, { foo: 'bar' })
        expect(cb).toHaveBeenCalledWith({ foo: 'bar' })
      })
    })

    it('removeMusicListeners 应清理所有 15 个音乐频道', () => {
      api.removeMusicListeners()
      const expected = [
        'music-ready', 'music-status', 'music-track-change', 'music-play-state',
        'music-progress', 'music-devices', 'music-no-music', 'music-play-error',
        'music-volume-change', 'music-play-mode', 'music-playlist', 'music-song-missing',
        'music-hotkeys', 'music-hotkey-key-pressed', 'music-hotkey-recording-stopped'
      ]
      expect(electronMock.ipcRenderer.removeAllListeners).toHaveBeenCalledTimes(expected.length)
      expected.forEach(ch => {
        expect(electronMock.ipcRenderer.removeAllListeners).toHaveBeenCalledWith(ch)
      })
    })
  })

  describe('音乐榜单 API', () => {
    it('chartsFetch', () => {
      api.chartsFetch('netease')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('charts-fetch', 'netease')
    })
    it('downloadSong', () => {
      api.downloadSong('Title', 'Artist')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('download-song', 'Title', 'Artist')
    })
    it('getDownloadStatus', () => {
      api.getDownloadStatus()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('download-status')
    })
    it('getVersion', () => {
      api.getVersion()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('get-version')
    })
    it('setDownloaderPath', () => {
      api.setDownloaderPath('C:\\path')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('set-downloader-path', 'C:\\path')
    })
    it('setDownloadApiKey', () => {
      api.setDownloadApiKey('key')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('set-download-api-key', 'key')
    })
  })

  describe('菜园子窗口 API', () => {
    it('openGarden', () => {
      api.openGarden()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('open-garden')
    })
    it('closeGarden', () => {
      api.closeGarden()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('close-garden')
    })
    it('refreshGarden', () => {
      api.refreshGarden()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('refresh-garden')
    })
    it('updateFocusMode', () => {
      api.updateFocusMode(true)
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('update-focus-mode', true)
    })
    it('updateTimerStatus', () => {
      api.updateTimerStatus(true, false)
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('update-timer-status', true, false)
    })
    it('getTimerState', () => {
      api.getTimerState()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('get-timer-state')
    })
  })

  describe('AI 助手', () => {
    it('aiGeneratePlan', () => {
      api.aiGeneratePlan('写一份周计划')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('ai-generate-plan', '写一份周计划')
    })
  })

  describe('前台检测 API', () => {
    it('foregroundIsReady', () => {
      api.foregroundIsReady()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('foreground-is-ready')
    })
    it('foregroundStart', () => {
      api.foregroundStart()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('foreground-start')
    })
    it('foregroundStop', () => {
      api.foregroundStop()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('foreground-stop')
    })
    it('foregroundGetStatus', () => {
      api.foregroundGetStatus()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('foreground-get-status')
    })
    it('foregroundSetApiKey', () => {
      api.foregroundSetApiKey('key')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('foreground-set-api-key', 'key')
    })
    it('foregroundAddWhitelist', () => {
      api.foregroundAddWhitelist('chrome')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('foreground-add-whitelist', 'chrome')
    })
    it('foregroundAddBlacklist', () => {
      api.foregroundAddBlacklist('game')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('foreground-add-blacklist', 'game')
    })
    it('foregroundMarkHistoryNot', () => {
      api.foregroundMarkHistoryNot('B站')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('foreground-mark-history-not', 'B站')
    })
    it('foregroundMoveBlacklistToWhitelist', () => {
      api.foregroundMoveBlacklistToWhitelist('game')
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('foreground-move-blacklist-to-whitelist', 'game')
    })
  })

  describe('前台检测事件监听器（包装回调）', () => {
    const events = [
      ['onForegroundReady', 'foreground-ready'],
      ['onForegroundApiKeyInvalid', 'foreground-api-key-invalid'],
      ['onForegroundEntertainmentDetected', 'foreground-entertainment-detected'],
      ['onForegroundStatus', 'foreground-status'],
      ['onForegroundError', 'foreground-error']
    ]

    events.forEach(([methodName, channel]) => {
      it(`${methodName} 注册 ${channel} 并包装 callback 为 (data)`, () => {
        const cb = vi.fn()
        api[methodName](cb)
        expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(channel, expect.any(Function))
        const call = electronMock.ipcRenderer.on.mock.calls.find(c => c[0] === channel)
        call[1]({}, { x: 1 })
        expect(cb).toHaveBeenCalledWith({ x: 1 })
      })
    })

    it('removeForegroundListeners 应清理 4 个频道', () => {
      api.removeForegroundListeners()
      const expected = [
        'foreground-ready',
        'foreground-entertainment-detected',
        'foreground-status',
        'foreground-error'
      ]
      expect(electronMock.ipcRenderer.removeAllListeners).toHaveBeenCalledTimes(expected.length)
      expected.forEach(ch => {
        expect(electronMock.ipcRenderer.removeAllListeners).toHaveBeenCalledWith(ch)
      })
    })
  })

  describe('窗口置顶 API', () => {
    it('setAlwaysOnTop', () => {
      api.setAlwaysOnTop(true)
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('set-always-on-top', true)
    })
    it('bringToFront', () => {
      api.bringToFront()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('bring-to-front')
    })
    it('cancelAlwaysOnTop', () => {
      api.cancelAlwaysOnTop()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('cancel-always-on-top')
    })
  })

  describe('迷你模式 API', () => {
    it('enterMiniMode', () => {
      api.enterMiniMode()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('enter-mini-mode')
    })
    it('exitMiniMode', () => {
      api.exitMiniMode()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('exit-mini-mode')
    })
    it('updateMiniPosition', () => {
      api.updateMiniPosition()
      expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('update-mini-position')
    })
    it('onExitMiniModeFromTray 注册监听器（无参数包装）', () => {
      const cb = vi.fn()
      api.onExitMiniModeFromTray(cb)
      expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith('exit-mini-mode-from-tray', expect.any(Function))
      const call = electronMock.ipcRenderer.on.mock.calls.find(c => c[0] === 'exit-mini-mode-from-tray')
      call[1]()
      expect(cb).toHaveBeenCalled()
    })
    it('onQuitAppFromTray 注册监听器（无参数包装）', () => {
      const cb = vi.fn()
      api.onQuitAppFromTray(cb)
      expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith('quit-app-from-tray', expect.any(Function))
      const call = electronMock.ipcRenderer.on.mock.calls.find(c => c[0] === 'quit-app-from-tray')
      call[1]()
      expect(cb).toHaveBeenCalled()
    })
  })

  describe('开机自启动', () => {
    it('setAutoStart', () => {
      api.setAutoStart(true)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('set-auto-start', true)
    })
    it('getAutoStart', () => {
      api.getAutoStart()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('get-auto-start')
    })
  })

  describe('意见反馈', () => {
    it('submitFeedback', () => {
      api.submitFeedback('问题反馈')
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('submit-feedback', '问题反馈')
    })
    it('getUserFeedbacks', () => {
      api.getUserFeedbacks()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('get-user-feedbacks')
    })
    it('deleteFeedback', () => {
      api.deleteFeedback(42)
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('delete-feedback', 42)
    })
  })

  describe('自动更新', () => {
    it('checkForUpdates', () => {
      api.checkForUpdates()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('check-for-updates')
    })
    it('downloadUpdate', () => {
      api.downloadUpdate()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('download-update')
    })
    it('installUpdate', () => {
      api.installUpdate()
      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('install-update')
    })
    it('onUpdateStatus 注册监听器并包装 callback 为 (data)', () => {
      const cb = vi.fn()
      api.onUpdateStatus(cb)
      expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith('update-status', expect.any(Function))
      const call = electronMock.ipcRenderer.on.mock.calls.find(c => c[0] === 'update-status')
      call[1]({}, { status: 'checking' })
      expect(cb).toHaveBeenCalledWith({ status: 'checking' })
    })
    it('removeUpdateListeners 清理 update-status', () => {
      api.removeUpdateListeners()
      expect(electronMock.ipcRenderer.removeAllListeners).toHaveBeenCalledWith('update-status')
    })
  })

  describe('API 完整性', () => {
    it('应暴露所有预期方法', () => {
      const expected = [
        'openExternal', 'closeWindow', 'minimizeWindow', 'showNotification',
        'readData', 'writeData', 'readSettings', 'writeSettings',
        'gardenRead', 'gardenWrite', 'gardenPlant', 'gardenHarvest', 'gardenBuySeed',
        'gardenSellCrop', 'gardenSellAll', 'gardenUnlockPlot', 'gardenSignIn',
        'gardenUpdateFocus', 'gardenGrow', 'gardenPunishment', 'onGardenRefresh',
        'getApiKey', 'saveApiKey', 'getApiMode', 'setApiMode',
        'cloudTestConnection', 'cloudGetSession', 'cloudLogin', 'cloudRegister', 'cloudLogout',
        'studyRoomGetMyRooms', 'studyRoomGetActive', 'studyRoomGetById', 'studyRoomCreate',
        'studyRoomJoin', 'studyRoomLeave', 'studyRoomDelete', 'studyRoomUploadStats',
        'studyRoomUploadSession', 'studyRoomGetRanking', 'studyRoomGetMembers',
        'studyRoomUpdateStatus', 'studyRoomCheckStatus',
        'saveCredentials', 'loadCredentials', 'clearCredentials',
        'musicTogglePlay', 'musicNext', 'musicPrev', 'musicSeek', 'musicSetVolume',
        'musicGetStatus', 'musicGetDevices', 'musicSetDevice', 'musicSetPlayMode',
        'musicGetPlaylist', 'musicDeleteSong', 'musicPlaySong', 'musicUpdateTag',
        'musicGetCustomTags', 'musicAddCustomTag', 'musicDeleteCustomTag',
        'musicGetHotkeys', 'musicSetHotkeys', 'musicStartHotkeyRecording', 'musicStopHotkeyRecording',
        'onMusicReady', 'onMusicStatus', 'onMusicTrackChange', 'onMusicPlayState',
        'onMusicProgress', 'onMusicDevices', 'onMusicNoMusic', 'onMusicPlayError',
        'onMusicVolumeChange', 'onMusicPlayMode', 'onMusicPlaylist', 'onMusicSongMissing',
        'onMusicHotkeys', 'onMusicHotkeyKeyPressed', 'onMusicHotkeyRecordingStopped',
        'removeMusicListeners',
        'chartsFetch', 'downloadSong', 'getDownloadStatus', 'getVersion',
        'setDownloaderPath', 'setDownloadApiKey',
        'openGarden', 'closeGarden', 'refreshGarden', 'updateFocusMode',
        'updateTimerStatus', 'getTimerState',
        'aiGeneratePlan',
        'foregroundIsReady', 'foregroundStart', 'foregroundStop', 'foregroundGetStatus',
        'foregroundSetApiKey', 'foregroundAddWhitelist', 'foregroundAddBlacklist',
        'foregroundMarkHistoryNot', 'foregroundMoveBlacklistToWhitelist',
        'onForegroundReady', 'onForegroundApiKeyInvalid', 'onForegroundEntertainmentDetected',
        'onForegroundStatus', 'onForegroundError', 'removeForegroundListeners',
        'setAlwaysOnTop', 'bringToFront', 'cancelAlwaysOnTop',
        'enterMiniMode', 'exitMiniMode', 'updateMiniPosition',
        'onExitMiniModeFromTray', 'onQuitAppFromTray',
        'setAutoStart', 'getAutoStart',
        'submitFeedback', 'getUserFeedbacks', 'deleteFeedback',
        'checkForUpdates', 'downloadUpdate', 'installUpdate',
        'onUpdateStatus', 'removeUpdateListeners'
      ]
      expected.forEach(m => {
        expect(api[m]).toBeDefined()
        expect(typeof api[m]).toBe('function')
      })
    })
  })
})
