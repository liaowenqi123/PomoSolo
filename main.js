/**
 * 番茄钟 - 主进程
 *
 * 职责：
 * - 应用生命周期管理
 * - 窗口创建与配置
 * - 子进程启动（音乐播放器、前台检测）
 * - IPC 模块注册编排
 *
 * IPC 处理按领域拆分到 main/ 目录下各模块。
 */

const { app, ipcMain, BrowserWindow, Menu } = require('electron')
const path = require('path')
const state = require('./main/state')
const musicProcess = require('./src/modules/musicProcess')
const aiAssistant = require('./src/modules/aiAssistant')
const foregroundInspection = require('./src/modules/foregroundInspection')
const cloudAuth = require('./src/modules/cloudAuth')
const dataManager = require('./src/modules/dataManager')
const { showInstanceExistsDialog } = require('./main/windows')
const { loadMiniModePosition } = require('./main/ipc-window')
const { restoreUserData } = require('./main/userData-backup')

// ============ 单实例锁 ============
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showInstanceExistsDialog()
  })
}

// ============ 窗口创建 ============

function createWindow() {
  const iconPath = path.join(__dirname, 'src/tomato-page-1.ico')

  const win = new BrowserWindow({
    width: 520,
    height: 560,
    frame: false,
    transparent: true,
    resizable: false,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  state.mainWindow = win

  // 初始化自动更新模块
  const autoUpdate = require('./main/auto-update')
  autoUpdate.init(win)

  // F12 开发者工具快捷键
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools()
      } else {
        win.webContents.openDevTools()
      }
    }
  })

  // 开发模式右键菜单
  if (!app.isPackaged) {
    win.webContents.on('context-menu', (event, params) => {
      const menu = Menu.buildFromTemplate([
        {
          label: '打开开发者工具',
          click: () => win.webContents.openDevTools()
        },
        {
          label: '刷新',
          click: () => win.webContents.reload()
        }
      ])
      menu.popup()
    })
  }

  // 先显示加载页面
  win.loadFile('src/loading.html')

  // 追踪两个 Python 子进程的启动状态
  let musicReady = false
  let foregroundReady = false
  let mainPageLoaded = false

  // 等待队列：主页面加载后才发送的事件
  const pendingEvents = []

  function sendToRenderer(channel, data) {
    if (mainPageLoaded) {
      win.webContents.send(channel, data)
    } else {
      pendingEvents.push({ channel, data })
    }
  }

  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL()
    if (url.includes('index.html')) {
      mainPageLoaded = true
      pendingEvents.forEach(evt => {
        win.webContents.send(evt.channel, evt.data)
      })
      pendingEvents.length = 0
    }
  })

  function updateLoadingProgress() {
    const progress = (musicReady ? 50 : 0) + (foregroundReady ? 50 : 0)
    win.webContents.executeJavaScript(`
      document.getElementById('progressBar').style.width = '${progress}%';
      document.getElementById('status').textContent = '${musicReady && foregroundReady ? '启动完成' : '正在启动...'}';
    `)

    if (musicReady && foregroundReady) {
      setTimeout(() => {
        win.loadFile('src/index.html')
      }, 300)
    }
  }

  // ============ 启动音乐播放器进程 ============
  let musicExePath
  if (app.isPackaged) {
    musicExePath = path.join(process.resourcesPath, 'music.exe')
  } else {
    musicExePath = path.join(__dirname, 'music-player', 'music.exe')
  }

  const savedData = dataManager.readData()
  const savedDeviceId = savedData.audioDevice
  const savedVolume = savedData.musicVolume !== undefined ? savedData.musicVolume : 1.0

  musicProcess.start(musicExePath, savedDeviceId)

  // 音乐进程回调 → 转发渲染进程
  musicProcess.onReady((data) => {
    musicReady = true
    updateLoadingProgress()
    if (savedVolume !== 1.0) {
      musicProcess.setVolume(savedVolume)
    }
    win.webContents.send('music-ready', data)
  })
  musicProcess.onStatus((data) => win.webContents.send('music-status', data))
  musicProcess.onTrackChange((data) => win.webContents.send('music-track-change', data))
  musicProcess.onPlayState((data) => win.webContents.send('music-play-state', data))
  musicProcess.onProgress((data) => win.webContents.send('music-progress', data))
  musicProcess.onDevices((data) => win.webContents.send('music-devices', data))
  musicProcess.onNoMusic((data) => sendToRenderer('music-no-music', data))
  musicProcess.onPlayError((data) => win.webContents.send('music-play-error', data))
  musicProcess.onVolumeChange((data) => win.webContents.send('music-volume-change', data))
  musicProcess.onPlayMode((data) => win.webContents.send('music-play-mode', data))
  musicProcess.onPlaylist((data) => win.webContents.send('music-playlist', data))
  musicProcess.onSongMissing((data) => win.webContents.send('music-song-missing', data))
  musicProcess.onHotkeys((data) => win.webContents.send('music-hotkeys', data))
  musicProcess.onHotkeyKeyPressed((data) => win.webContents.send('music-hotkey-key-pressed', data))
  musicProcess.onHotkeyRecordingStopped((data) => win.webContents.send('music-hotkey-recording-stopped', data))

  // ============ 启动前台检测进程 ============
  let foregroundExePath
  if (app.isPackaged) {
    foregroundExePath = path.join(process.resourcesPath, 'foreground_inspection.exe')
  } else {
    foregroundExePath = path.join(__dirname, 'foreground_inspection', 'foreground_inspection.exe')
  }

  foregroundInspection.start(foregroundExePath, null)

  foregroundInspection.onReady((data) => {
    foregroundReady = true
    state.foregroundInspectionReady = true
    updateLoadingProgress()
    sendToRenderer('foreground-ready', data)
  })
  foregroundInspection.onApiKeyInvalid((data) => sendToRenderer('foreground-api-key-invalid', data))
  foregroundInspection.onEntertainmentDetected((data) => sendToRenderer('foreground-entertainment-detected', data))
  foregroundInspection.onStatus((data) => win.webContents.send('foreground-status', data))
  foregroundInspection.onError((data) => win.webContents.send('foreground-error', data))
}

// ============ 注册所有 IPC 模块 ============

function registerAllIPC() {
  require('./main/ipc-data').register(ipcMain)
  require('./main/ipc-garden').register(ipcMain)
  require('./main/ipc-cloud').register(ipcMain)
  require('./main/ipc-music').register(ipcMain)
  require('./main/ipc-window').register(ipcMain)
  require('./main/ipc-foreground').register(ipcMain)
  require('./main/ipc-ai').register(ipcMain)
  require('./main/ipc-update').register(ipcMain)
}

// ============ 应用生命周期 ============

// 预注册 IPC（确保在窗口加载前所有 handler 就绪）
registerAllIPC()

app.whenReady().then(() => {
  // 还原用户数据（如果有更新备份）
  if (app.isPackaged) {
    const resourcesPath = path.join(process.resourcesPath)
    const restored = restoreUserData(resourcesPath)
    if (restored) {
      console.log('[Main] 用户数据已从备份还原')
    }
  }

  cloudAuth.init()

  const studyRoomSync = require('./src/modules/studyRoomSync')
  studyRoomSync.init()
  console.log('[Main] 自习室同步模块已初始化')

  // 检查本地 API Key 模式
  const savedData = dataManager.readData()
  if (savedData.apiMode === 'local' && savedData.apiKey) {
    console.log('[Main] 检测到本地 API Key 模式，正在初始化...')
    aiAssistant.setApiKey(savedData.apiKey)
    foregroundInspection.setApiKey(savedData.apiKey)
    const songDownloader = require('./src/modules/songDownloader')
    songDownloader.setApiKey(savedData.apiKey)
  }

  loadMiniModePosition()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  musicProcess.stop()
  foregroundInspection.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (e) => {
  if (state.isQuitting) return

  const session = cloudAuth.getSession()
  console.log('[Main] before-quit, session:', session ? session.username : 'null')

  if (!session) {
    musicProcess.stop()
    foregroundInspection.stop()
    return
  }

  // 有登录会话：先隐藏窗口（用户感觉已关闭），后台处理离线标记
  e.preventDefault()
  state.isQuitting = true

  let exitCompleted = false

  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.hide()
  })

  cloudAuth.stopHeartbeat()
  musicProcess.stop()
  foregroundInspection.stop()

  const timeout = setTimeout(() => {
    if (!exitCompleted) {
      exitCompleted = true
      console.log('[Main] markOffline 超时，强制退出')
      app.exit(0)
    }
  }, 2000)

  cloudAuth.markOffline(session.id).then(() => {
    if (!exitCompleted) {
      exitCompleted = true
      clearTimeout(timeout)
      console.log('[Main] markOffline 完成，退出应用')
      app.exit(0)
    }
  }).catch((err) => {
    if (!exitCompleted) {
      exitCompleted = true
      console.error('[Main] markOffline 失败:', err)
      clearTimeout(timeout)
      app.exit(0)
    }
  })
})
