/**
 * 音乐播放器 + 榜单 + 下载 IPC
 */
const musicProcess = require('../src/modules/musicProcess')
const dataManager = require('../src/modules/dataManager')

function register(ipcMain) {
  // ============ 音乐播放器控制 ============
  ipcMain.on('music-toggle', () => {
    musicProcess.togglePlay()
  })

  ipcMain.on('music-next', () => {
    musicProcess.next()
  })

  ipcMain.on('music-prev', () => {
    musicProcess.prev()
  })

  ipcMain.on('music-seek', (event, position) => {
    musicProcess.seek(position)
  })

  ipcMain.on('music-set-volume', (event, volume) => {
    musicProcess.setVolume(volume)
  })

  ipcMain.on('music-get-status', () => {
    musicProcess.getStatus()
  })

  ipcMain.on('music-get-devices', () => {
    musicProcess.getDevices()
  })

  ipcMain.on('music-set-device', (event, deviceId) => {
    musicProcess.setDevice(deviceId)
    const data = dataManager.readData()
    data.audioDevice = deviceId
    dataManager.writeData(data)
  })

  ipcMain.on('music-set-play-mode', (event, mode) => {
    musicProcess.setPlayMode(mode)
  })

  ipcMain.on('music-get-playlist', () => {
    musicProcess.getPlaylist()
  })

  ipcMain.on('music-play-song', (event, name) => {
    musicProcess.playSong(name)
  })

  ipcMain.handle('music-delete-song', async (event, name) => {
    try {
      await musicProcess.deleteSong(name)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('music-update-tag', async (event, { name, tag, color }) => {
    try {
      await musicProcess.updateTag(name, tag, color)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('music-get-custom-tags', async () => {
    try {
      return await musicProcess.getCustomTags()
    } catch (error) {
      return { customTags: {} }
    }
  })

  ipcMain.handle('music-add-custom-tag', async (event, { name, color }) => {
    try {
      await musicProcess.addCustomTag(name, color)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('music-delete-custom-tag', async (event, name) => {
    try {
      await musicProcess.deleteCustomTag(name)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ============ 快捷键设置 ============
  ipcMain.handle('music-get-hotkeys', async () => {
    try {
      return await musicProcess.getHotkeys()
    } catch (error) {
      return { hotkeys: null }
    }
  })

  ipcMain.handle('music-set-hotkeys', async (event, hotkeys) => {
    try {
      return await musicProcess.setHotkeys(hotkeys)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('music-start-hotkey-recording', async () => {
    try {
      return await musicProcess.startHotkeyRecording()
    } catch (error) {
      return { success: false }
    }
  })

  ipcMain.handle('music-stop-hotkey-recording', async () => {
    try {
      return await musicProcess.stopHotkeyRecording()
    } catch (error) {
      return { keys: [] }
    }
  })

  // ============ 音乐榜单 ============
  const chartsFetcher = require('../src/modules/chartsFetcher')
  const songDownloader = require('../src/modules/songDownloader')

  const { app } = require('electron')
  const path = require('path')

  ipcMain.handle('charts-fetch', async (event, source) => {
    try {
      const songs = await chartsFetcher.fetchCharts(source)
      return { success: true, songs }
    } catch (error) {
      console.error('[Charts] 抓取失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.on('set-downloader-path', (event, exePath) => {
    songDownloader.setDownloaderPath(exePath)
  })

  ipcMain.on('set-download-api-key', (event, apiKey) => {
    songDownloader.setApiKey(apiKey)
  })

  ipcMain.handle('download-song', async (event, title, artist) => {
    if (!songDownloader.getDownloaderPath?.()) {
      let downloaderPath
      if (app.isPackaged) {
        downloaderPath = path.join(process.resourcesPath, 'manual_downloader.exe')
      } else {
        downloaderPath = path.join(__dirname, '..', 'music-player', 'manual_downloader.exe')
      }
      songDownloader.setDownloaderPath(downloaderPath)
    }
    return await songDownloader.downloadSong(title, artist)
  })

  ipcMain.handle('download-status', () => {
    return songDownloader.getStatus()
  })

  ipcMain.handle('get-version', () => {
    return app.getVersion()
  })
}

module.exports = { register }
