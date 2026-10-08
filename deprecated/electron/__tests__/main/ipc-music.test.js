/**
 * main/ipc-music.js 测试
 *
 * 测试音乐播放器控制、标签、快捷键、榜单、下载等处理器。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

// Mock musicProcess
const mockMusicProcess = vi.hoisted(() => {
  const m = {
    togglePlay: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    getStatus: vi.fn(),
    getDevices: vi.fn(),
    setDevice: vi.fn(),
    setPlayMode: vi.fn(),
    getPlaylist: vi.fn(),
    playSong: vi.fn(),
    deleteSong: vi.fn(),
    updateTag: vi.fn(),
    getCustomTags: vi.fn(),
    addCustomTag: vi.fn(),
    deleteCustomTag: vi.fn(),
    getHotkeys: vi.fn(),
    setHotkeys: vi.fn(),
    startHotkeyRecording: vi.fn(),
    stopHotkeyRecording: vi.fn()
  }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/musicProcess', m)
  return m
})
vi.mock('../../src/modules/musicProcess', () => mockMusicProcess)

// Mock dataManager
const mockDataManager = vi.hoisted(() => {
  const m = { readData: vi.fn(), writeData: vi.fn() }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/dataManager', m)
  return m
})
vi.mock('../../src/modules/dataManager', () => mockDataManager)

// Mock chartsFetcher
const mockChartsFetcher = vi.hoisted(() => {
  const m = { fetchCharts: vi.fn() }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/chartsFetcher', m)
  return m
})
vi.mock('../../src/modules/chartsFetcher', () => mockChartsFetcher)

// Mock songDownloader
const mockSongDownloader = vi.hoisted(() => {
  const m = {
    setDownloaderPath: vi.fn(),
    getDownloaderPath: vi.fn(),
    setApiKey: vi.fn(),
    downloadSong: vi.fn(),
    getStatus: vi.fn()
  }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/songDownloader', m)
  return m
})
vi.mock('../../src/modules/songDownloader', () => mockSongDownloader)

const { app } = require('electron')
const ipcMain = __electronMock.ipcMain
const { register } = require('../../main/ipc-music')

function findHandler(channel) {
  const call = ipcMain.handle.mock.calls.find(c => c[0] === channel)
  return call ? call[1] : undefined
}

function findListener(channel) {
  const call = ipcMain.on.mock.calls.find(c => c[0] === channel)
  return call ? call[1] : undefined
}

describe('main/ipc-music', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    app.isPackaged = false
    register(ipcMain)
  })

  it('应注册所有处理器', () => {
    expect(ipcMain.on.mock.calls.length).toBeGreaterThanOrEqual(11)
    expect(ipcMain.handle.mock.calls.length).toBeGreaterThanOrEqual(13)
  })

  // ============ 播放器控制 (ipcMain.on) ============

  describe('播放控制 (on)', () => {
    it('music-toggle 应调用 musicProcess.togglePlay', () => {
      findListener('music-toggle')()
      expect(mockMusicProcess.togglePlay).toHaveBeenCalledTimes(1)
    })

    it('music-next 应调用 musicProcess.next', () => {
      findListener('music-next')()
      expect(mockMusicProcess.next).toHaveBeenCalledTimes(1)
    })

    it('music-prev 应调用 musicProcess.prev', () => {
      findListener('music-prev')()
      expect(mockMusicProcess.prev).toHaveBeenCalledTimes(1)
    })

    it('music-seek 应调用 musicProcess.seek 并传入 position', () => {
      findListener('music-seek')({}, 120)
      expect(mockMusicProcess.seek).toHaveBeenCalledWith(120)
    })

    it('music-set-volume 应调用 musicProcess.setVolume', () => {
      findListener('music-set-volume')({}, 0.8)
      expect(mockMusicProcess.setVolume).toHaveBeenCalledWith(0.8)
    })

    it('music-get-status 应调用 musicProcess.getStatus', () => {
      findListener('music-get-status')()
      expect(mockMusicProcess.getStatus).toHaveBeenCalledTimes(1)
    })

    it('music-get-devices 应调用 musicProcess.getDevices', () => {
      findListener('music-get-devices')()
      expect(mockMusicProcess.getDevices).toHaveBeenCalledTimes(1)
    })

    it('music-set-device 应调用 musicProcess.setDevice 并保存到 dataManager', () => {
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(true)
      findListener('music-set-device')({}, 'device-1')
      expect(mockMusicProcess.setDevice).toHaveBeenCalledWith('device-1')
      expect(mockDataManager.readData).toHaveBeenCalledTimes(1)
      expect(mockDataManager.writeData).toHaveBeenCalled()
    })

    it('music-set-play-mode 应调用 musicProcess.setPlayMode', () => {
      findListener('music-set-play-mode')({}, 'shuffle')
      expect(mockMusicProcess.setPlayMode).toHaveBeenCalledWith('shuffle')
    })

    it('music-get-playlist 应调用 musicProcess.getPlaylist', () => {
      findListener('music-get-playlist')()
      expect(mockMusicProcess.getPlaylist).toHaveBeenCalledTimes(1)
    })

    it('music-play-song 应调用 musicProcess.playSong', () => {
      findListener('music-play-song')({}, 'song.mp3')
      expect(mockMusicProcess.playSong).toHaveBeenCalledWith('song.mp3')
    })
  })

  // ============ 删除/标签 (ipcMain.handle, try/catch) ============

  describe('music-delete-song', () => {
    it('成功时应返回 { success: true }', async () => {
      mockMusicProcess.deleteSong.mockResolvedValue(undefined)
      const handler = findHandler('music-delete-song')
      const result = await handler({}, 'song.mp3')
      expect(mockMusicProcess.deleteSong).toHaveBeenCalledWith('song.mp3')
      expect(result).toEqual({ success: true })
    })

    it('失败时应返回 { success: false, error }', async () => {
      mockMusicProcess.deleteSong.mockRejectedValue(new Error('delete fail'))
      const handler = findHandler('music-delete-song')
      const result = await handler({}, 'song.mp3')
      expect(result).toEqual({ success: false, error: 'delete fail' })
    })
  })

  describe('music-update-tag', () => {
    it('成功时应返回 { success: true }', async () => {
      mockMusicProcess.updateTag.mockResolvedValue(undefined)
      const handler = findHandler('music-update-tag')
      const result = await handler({}, { name: 'song.mp3', tag: 'rock', color: 'red' })
      expect(mockMusicProcess.updateTag).toHaveBeenCalledWith('song.mp3', 'rock', 'red')
      expect(result).toEqual({ success: true })
    })

    it('失败时应返回 { success: false, error }', async () => {
      mockMusicProcess.updateTag.mockRejectedValue(new Error('tag fail'))
      const handler = findHandler('music-update-tag')
      const result = await handler({}, { name: 's', tag: 't', color: 'c' })
      expect(result).toEqual({ success: false, error: 'tag fail' })
    })
  })

  describe('music-get-custom-tags', () => {
    it('成功时应返回 tags 对象', async () => {
      const tags = { rock: 'red', pop: 'blue' }
      mockMusicProcess.getCustomTags.mockResolvedValue(tags)
      const handler = findHandler('music-get-custom-tags')
      const result = await handler({})
      expect(result).toBe(tags)
    })

    it('失败时应返回 { customTags: {} }', async () => {
      mockMusicProcess.getCustomTags.mockRejectedValue(new Error('fail'))
      const handler = findHandler('music-get-custom-tags')
      const result = await handler({})
      expect(result).toEqual({ customTags: {} })
    })
  })

  describe('music-add-custom-tag', () => {
    it('成功时应返回 { success: true }', async () => {
      mockMusicProcess.addCustomTag.mockResolvedValue(undefined)
      const handler = findHandler('music-add-custom-tag')
      const result = await handler({}, { name: 'jazz', color: 'green' })
      expect(mockMusicProcess.addCustomTag).toHaveBeenCalledWith('jazz', 'green')
      expect(result).toEqual({ success: true })
    })

    it('失败时应返回 { success: false, error }', async () => {
      mockMusicProcess.addCustomTag.mockRejectedValue(new Error('add fail'))
      const handler = findHandler('music-add-custom-tag')
      const result = await handler({}, { name: 'n', color: 'c' })
      expect(result).toEqual({ success: false, error: 'add fail' })
    })
  })

  describe('music-delete-custom-tag', () => {
    it('成功时应返回 { success: true }', async () => {
      mockMusicProcess.deleteCustomTag.mockResolvedValue(undefined)
      const handler = findHandler('music-delete-custom-tag')
      const result = await handler({}, 'jazz')
      expect(mockMusicProcess.deleteCustomTag).toHaveBeenCalledWith('jazz')
      expect(result).toEqual({ success: true })
    })

    it('失败时应返回 { success: false, error }', async () => {
      mockMusicProcess.deleteCustomTag.mockRejectedValue(new Error('del fail'))
      const handler = findHandler('music-delete-custom-tag')
      const result = await handler({}, 'jazz')
      expect(result).toEqual({ success: false, error: 'del fail' })
    })
  })

  // ============ 快捷键 (ipcMain.handle, try/catch) ============

  describe('music-get-hotkeys', () => {
    it('成功时应返回 hotkeys', async () => {
      const hotkeys = { play: 'Ctrl+P' }
      mockMusicProcess.getHotkeys.mockResolvedValue(hotkeys)
      const handler = findHandler('music-get-hotkeys')
      const result = await handler({})
      expect(result).toBe(hotkeys)
    })

    it('失败时应返回 { hotkeys: null }', async () => {
      mockMusicProcess.getHotkeys.mockRejectedValue(new Error('fail'))
      const handler = findHandler('music-get-hotkeys')
      const result = await handler({})
      expect(result).toEqual({ hotkeys: null })
    })
  })

  describe('music-set-hotkeys', () => {
    it('成功时应返回 musicProcess.setHotkeys 的结果', async () => {
      mockMusicProcess.setHotkeys.mockResolvedValue({ success: true })
      const handler = findHandler('music-set-hotkeys')
      const result = await handler({}, { play: 'Ctrl+P' })
      expect(mockMusicProcess.setHotkeys).toHaveBeenCalledWith({ play: 'Ctrl+P' })
      expect(result).toEqual({ success: true })
    })

    it('失败时应返回 { success: false, error }', async () => {
      mockMusicProcess.setHotkeys.mockRejectedValue(new Error('set fail'))
      const handler = findHandler('music-set-hotkeys')
      const result = await handler({}, {})
      expect(result).toEqual({ success: false, error: 'set fail' })
    })
  })

  describe('music-start-hotkey-recording', () => {
    it('成功时应返回 musicProcess.startHotkeyRecording 的结果', async () => {
      mockMusicProcess.startHotkeyRecording.mockResolvedValue({ success: true })
      const handler = findHandler('music-start-hotkey-recording')
      const result = await handler({})
      expect(result).toEqual({ success: true })
    })

    it('失败时应返回 { success: false }', async () => {
      mockMusicProcess.startHotkeyRecording.mockRejectedValue(new Error('fail'))
      const handler = findHandler('music-start-hotkey-recording')
      const result = await handler({})
      expect(result).toEqual({ success: false })
    })
  })

  describe('music-stop-hotkey-recording', () => {
    it('成功时应返回 musicProcess.stopHotkeyRecording 的结果', async () => {
      mockMusicProcess.stopHotkeyRecording.mockResolvedValue({ keys: ['Ctrl', 'P'] })
      const handler = findHandler('music-stop-hotkey-recording')
      const result = await handler({})
      expect(result).toEqual({ keys: ['Ctrl', 'P'] })
    })

    it('失败时应返回 { keys: [] }', async () => {
      mockMusicProcess.stopHotkeyRecording.mockRejectedValue(new Error('fail'))
      const handler = findHandler('music-stop-hotkey-recording')
      const result = await handler({})
      expect(result).toEqual({ keys: [] })
    })
  })

  // ============ 音乐榜单 ============

  describe('charts-fetch', () => {
    it('成功时应返回 { success: true, songs }', async () => {
      const songs = [{ title: 'song1', artist: 'artist1' }]
      mockChartsFetcher.fetchCharts.mockResolvedValue(songs)
      const handler = findHandler('charts-fetch')
      const result = await handler({}, 'netease')
      expect(mockChartsFetcher.fetchCharts).toHaveBeenCalledWith('netease')
      expect(result).toEqual({ success: true, songs })
    })

    it('失败时应返回 { success: false, error }', async () => {
      mockChartsFetcher.fetchCharts.mockRejectedValue(new Error('fetch fail'))
      const handler = findHandler('charts-fetch')
      const result = await handler({}, 'netease')
      expect(result).toEqual({ success: false, error: 'fetch fail' })
    })
  })

  // ============ 下载 ============

  describe('set-downloader-path', () => {
    it('应调用 songDownloader.setDownloaderPath', () => {
      findListener('set-downloader-path')({}, 'C:\\downloader.exe')
      expect(mockSongDownloader.setDownloaderPath).toHaveBeenCalledWith('C:\\downloader.exe')
    })
  })

  describe('set-download-api-key', () => {
    it('应调用 songDownloader.setApiKey', () => {
      findListener('set-download-api-key')({}, 'sk-test')
      expect(mockSongDownloader.setApiKey).toHaveBeenCalledWith('sk-test')
    })
  })

  describe('download-song', () => {
    it('已有 downloaderPath 时应直接下载', async () => {
      mockSongDownloader.getDownloaderPath.mockReturnValue('C:\\existing.exe')
      mockSongDownloader.downloadSong.mockResolvedValue({ success: true })
      const handler = findHandler('download-song')
      const result = await handler({}, 'title', 'artist')
      expect(mockSongDownloader.setDownloaderPath).not.toHaveBeenCalled()
      expect(mockSongDownloader.downloadSong).toHaveBeenCalledWith('title', 'artist')
      expect(result).toEqual({ success: true })
    })

    it('dev 模式无 downloaderPath 时应设置路径再下载', async () => {
      mockSongDownloader.getDownloaderPath.mockReturnValue(null)
      mockSongDownloader.downloadSong.mockResolvedValue({ success: true })
      app.isPackaged = false
      const handler = findHandler('download-song')
      await handler({}, 'title', 'artist')
      expect(mockSongDownloader.setDownloaderPath).toHaveBeenCalled()
      expect(mockSongDownloader.downloadSong).toHaveBeenCalledWith('title', 'artist')
    })

    it('打包模式无 downloaderPath 时应使用 resourcesPath', async () => {
      mockSongDownloader.getDownloaderPath.mockReturnValue(null)
      mockSongDownloader.downloadSong.mockResolvedValue({ success: true })
      app.isPackaged = true
      const origResourcesPath = process.resourcesPath
      process.resourcesPath = 'C:\\resources'
      const handler = findHandler('download-song')
      await handler({}, 'title', 'artist')
      expect(mockSongDownloader.setDownloaderPath).toHaveBeenCalled()
      process.resourcesPath = origResourcesPath
    })
  })

  describe('download-status', () => {
    it('应返回 songDownloader.getStatus()', async () => {
      mockSongDownloader.getStatus.mockReturnValue({ downloading: true, progress: 50 })
      const handler = findHandler('download-status')
      const result = await handler({})
      expect(result).toEqual({ downloading: true, progress: 50 })
    })
  })

  describe('get-version', () => {
    it('应返回 app.getVersion()', async () => {
      app.getVersion.mockReturnValue('3.2.4')
      const handler = findHandler('get-version')
      const result = await handler({})
      expect(result).toBe('3.2.4')
    })
  })
})
