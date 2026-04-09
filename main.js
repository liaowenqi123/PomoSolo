/**
 * 番茄钟 - 主进程
 */

const { app, BrowserWindow, ipcMain, Notification, Tray, nativeImage, Menu, shell } = require('electron')
const path = require('path')
const musicProcess = require('./src/modules/musicProcess')
const aiAssistant = require('./src/modules/aiAssistant')
const foregroundInspection = require('./src/modules/foregroundInspection')
const cloudAuth = require('./src/modules/cloudAuth')
const dataManager = require('./src/modules/dataManager')

// 专注模式和计时器状态（供菜园子窗口查询）
let focusModeEnabled = false
let timerRunning = false
let timerPaused = false

// 前台检测就绪状态（供渲染进程查询）
let foregroundInspectionReady = false

// 系统托盘
let tray = null

// 主窗口引用（用于单实例聚焦）
let mainWindow = null

// ============ 单实例锁 ============
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 已经有实例在运行，直接退出
  app.quit()
} else {
  // 当第二个实例尝试启动时，显示警告并聚焦到已有窗口
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    showInstanceExistsDialog()
  })
}

/**
 * 显示"实例已存在"警告弹窗（自定义样式）
 */
function showInstanceExistsDialog() {
  // 聚焦到主窗口
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
  
  // 创建自定义警告窗口
  const warningWindow = new BrowserWindow({
    width: 360,
    height: 180,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })
  
  // 自定义 HTML 内容（番茄钟风格，深色调对齐透明度效果）
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
          width: 100%; height: 100%;
          overflow: hidden;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(145deg, #c24a4a 0%, #8a3030 100%);
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .icon {
          font-size: 48px;
          margin-bottom: 16px;
          animation: shake 0.5s ease-in-out;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .message {
          color: white;
          font-size: 16px;
          font-weight: 500;
          text-align: center;
          margin-bottom: 20px;
          text-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .btn {
          background: white;
          color: #a04040;
          border: none;
          padding: 10px 32px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0,0,0,0.2);
        }
        .btn:active { transform: translateY(0); }
      </style>
    </head>
    <body>
      <div class="icon">🍅</div>
      <div class="message">同一路径下只能启动一个实例！</div>
      <button class="btn" id="closeBtn">知道了</button>
      <script>
        document.getElementById('closeBtn').addEventListener('click', () => {
          window.close();
        });
      </script>
    </body>
    </html>
  `
  
  warningWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent))
  
  // 点击外部关闭（可选）
  warningWindow.on('blur', () => {
    // 不自动关闭，让用户必须点击按钮
  })
}

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
  
  // 保存主窗口引用（用于单实例聚焦）
  mainWindow = win
  
  // 开发环境下自动打开开发者工具（可选）
  // 如果需要调试，取消下面的注释
  // if (!app.isPackaged) {
  //   win.webContents.openDevTools()
  // }
  
  // 添加快捷键：F12 打开/关闭开发者工具
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools()
      } else {
        win.webContents.openDevTools()
      }
    }
  })
  
  // 添加右键菜单（开发模式）
  if (!app.isPackaged) {
    win.webContents.on('context-menu', (event, params) => {
      const menu = Menu.buildFromTemplate([
        {
          label: '打开开发者工具',
          click: () => {
            win.webContents.openDevTools()
          }
        },
        {
          label: '刷新',
          click: () => {
            win.webContents.reload()
          }
        }
      ])
      menu.popup()
    })
  }
  
  // 先显示加载页面
  win.loadFile('src/loading.html')
  
  // 追踪两个 Python 进程的启动状态
  let musicReady = false
  let foregroundReady = false
  let mainPageLoaded = false  // 主页面是否已加载
  
  // 缓存需要在主页面加载后发送的事件
  const pendingEvents = []
  
  // 发送事件到渲染进程（主页面加载后立即发送，否则缓存）
  function sendToRenderer(channel, data) {
    if (mainPageLoaded) {
      win.webContents.send(channel, data)
    } else {
      pendingEvents.push({ channel, data })
    }
  }
  
  // 主页面加载完成后发送缓存的事件
  win.webContents.on('did-finish-load', () => {
    // 检查当前加载的是否是主页面
    const url = win.webContents.getURL()
    if (url.includes('index.html')) {
      mainPageLoaded = true
      // 发送缓存的事件
      pendingEvents.forEach(event => {
        win.webContents.send(event.channel, event.data)
      })
      pendingEvents.length = 0
    }
  })
  
  // 更新加载进度
  function updateLoadingProgress() {
    const progress = ((musicReady ? 50 : 0) + (foregroundReady ? 50 : 0))
    win.webContents.executeJavaScript(`
      document.getElementById('progressBar').style.width = '${progress}%';
      document.getElementById('status').textContent = '${musicReady && foregroundReady ? '启动完成' : '正在启动...'}';
    `)
    
    // 两个进程都 ready 后，加载主页面
    if (musicReady && foregroundReady) {
      setTimeout(() => {
        win.loadFile('src/index.html')
      }, 300)
    }
  }
  
  // 启动音乐播放器进程
  // 开发环境: __dirname/music-player/music.exe
  // 打包后: resources/music.exe (extraResource会复制到resources目录)
  let musicExePath
  if (app.isPackaged) {
    // 打包后：extraResource会把 music.exe 和 music 文件夹放到 resources 目录下
    musicExePath = path.join(process.resourcesPath, 'music.exe')
  } else {
    // 开发环境
    musicExePath = path.join(__dirname, 'music-player', 'music.exe')
  }
  
  // 读取保存的设备ID和音量
  const savedData = dataManager.readData()
  const savedDeviceId = savedData.audioDevice
  const savedVolume = savedData.musicVolume !== undefined ? savedData.musicVolume : 1.0
  
  // API Key 现在从云端获取，启动时不再自动加载
  // 用户需要先登录，admin 用户才能获取 API Key
  console.log('[Main] 等待用户登录...')
  
  musicProcess.start(musicExePath, savedDeviceId)
  
  // 设置音乐进程回调，转发到渲染进程
  musicProcess.onReady((data) => {
    musicReady = true
    updateLoadingProgress()
    
    // 恢复保存的音量
    if (savedVolume !== 1.0) {
      musicProcess.setVolume(savedVolume)
    }
    
    win.webContents.send('music-ready', data)
  })
  
  musicProcess.onStatus((data) => {
    win.webContents.send('music-status', data)
  })
  
  musicProcess.onTrackChange((data) => {
    win.webContents.send('music-track-change', data)
  })
  
  musicProcess.onPlayState((data) => {
    win.webContents.send('music-play-state', data)
  })
  
  musicProcess.onProgress((data) => {
    win.webContents.send('music-progress', data)
  })
  
  musicProcess.onDevices((data) => {
    win.webContents.send('music-devices', data)
  })
  
  musicProcess.onNoMusic((data) => {
    sendToRenderer('music-no-music', data)
  })
  
  musicProcess.onPlayError((data) => {
    win.webContents.send('music-play-error', data)
  })
  
  musicProcess.onVolumeChange((data) => {
    win.webContents.send('music-volume-change', data)
  })
  
  musicProcess.onPlayMode((data) => {
    win.webContents.send('music-play-mode', data)
  })
  
  musicProcess.onPlaylist((data) => {
    win.webContents.send('music-playlist', data)
  })
  
  musicProcess.onSongMissing((data) => {
    win.webContents.send('music-song-missing', data)
  })
  
  // 快捷键设置事件回调
  musicProcess.onHotkeys((data) => {
    win.webContents.send('music-hotkeys', data)
  })
  
  musicProcess.onHotkeyKeyPressed((data) => {
    win.webContents.send('music-hotkey-key-pressed', data)
  })
  
  musicProcess.onHotkeyRecordingStopped((data) => {
    win.webContents.send('music-hotkey-recording-stopped', data)
  })
  
  // 启动前台检测进程
  let foregroundExePath
  if (app.isPackaged) {
    foregroundExePath = path.join(process.resourcesPath, 'foreground_inspection.exe')
  } else {
    foregroundExePath = path.join(__dirname, 'foreground_inspection', 'foreground_inspection.exe')
  }
  
  // 启动前台检测，不传入 API Key（等待用户登录后设置）
  foregroundInspection.start(foregroundExePath, null)
  
  // 设置前台检测回调，转发到渲染进程
  foregroundInspection.onReady((data) => {
    foregroundReady = true
    foregroundInspectionReady = true  // 标记前台检测已就绪
    updateLoadingProgress()
    // 使用 sendToRenderer 而不是 win.webContents.send，确保事件被缓存
    sendToRenderer('foreground-ready', data)
  })
  
  foregroundInspection.onApiKeyInvalid((data) => {
    sendToRenderer('foreground-api-key-invalid', data)
  })
  
  foregroundInspection.onEntertainmentDetected((data) => {
    sendToRenderer('foreground-entertainment-detected', data)
  })
  
  foregroundInspection.onStatus((data) => {
    win.webContents.send('foreground-status', data)
  })
  
  foregroundInspection.onError((data) => {
    win.webContents.send('foreground-error', data)
  })
}

// 存储菜园子窗口引用
let gardenWindow = null

// 创建菜园子窗口
function createGardenWindow() {
  // 如果窗口已存在，聚焦它
  if (gardenWindow) {
    gardenWindow.focus()
    return
  }

  const iconPath = path.join(__dirname, 'src/tomato-page-1.ico')

  gardenWindow = new BrowserWindow({
    width: 400,
    height: 520,
    frame: false,
    transparent: true,
    resizable: false,
    icon: iconPath,
    parent: BrowserWindow.getFocusedWindow(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  gardenWindow.loadFile('src/garden.html')

  // 窗口关闭时清理引用
  gardenWindow.on('closed', () => {
    gardenWindow = null
  })
}

// ============ 基础窗口操作 IPC 处理 ============

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url)
})

ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    // 先停止音乐进程
    musicProcess.stop()
    win.close()
  }
})

ipcMain.on('minimize-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    win.minimize()
  }
})

ipcMain.on('show-notification', (event, data) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: data.title || '番茄钟',
      body: data.body || '',
      silent: false
    })
    notification.show()
  }
})

/**
 * 发送成就解锁通知
 * @param {Array} unlockedAchievements - 解锁的成就列表
 */
function sendAchievementNotifications(unlockedAchievements) {
  if (!unlockedAchievements || unlockedAchievements.length === 0) return
  
  unlockedAchievements.forEach(achievement => {
    if (Notification.isSupported()) {
      let body = achievement.description || ''
      if (achievement.rewards) {
        const rewardParts = []
        if (achievement.rewards.seeds) {
          Object.entries(achievement.rewards.seeds).forEach(([seedKey, count]) => {
            if (count > 0) rewardParts.push(`种子×${count}`)
          })
        }
        if (achievement.rewards.coins > 0) {
          rewardParts.push(`💰${achievement.rewards.coins}`)
        }
        if (rewardParts.length > 0) {
          body += ` - 获得 ${rewardParts.join('、')}`
        }
      }
      
      const notification = new Notification({
        title: `🏆 成就解锁：${achievement.name}`,
        body: body,
        silent: false
      })
      notification.show()
    }
  })
}

// ============ 菜园子窗口 IPC 处理 ============

ipcMain.on('open-garden', () => {
  createGardenWindow()
})

ipcMain.on('close-garden', () => {
  if (gardenWindow) {
    gardenWindow.close()
  }
})

// 刷新菜园子窗口（由外部调用）
ipcMain.on('refresh-garden', () => {
  if (gardenWindow && !gardenWindow.isDestroyed()) {
    gardenWindow.webContents.send('garden-refresh')
  }
})

// ============ 菜园子事件处理（由 timer 调用） ============

// 作物成长事件 - 由 timer 每60秒发送
ipcMain.on('garden-grow', async (event, minutes) => {
  try {
    // 更新数据（带锁）
    await dataManager.updateGardenProgress(minutes)
    // 通知菜园子窗口刷新
    if (gardenWindow && !gardenWindow.isDestroyed()) {
      gardenWindow.webContents.send('garden-refresh')
    }
  } catch (e) {
    console.error('[Garden] 成长更新失败:', e)
  }
})

// 惩罚事件 - 由 timer/foregroundDetection 调用（需要返回结果）
ipcMain.handle('garden-punishment', async () => {
  try {
    const result = await dataManager.handleGardenPunishment()
    if (gardenWindow && !gardenWindow.isDestroyed()) {
      gardenWindow.webContents.send('garden-refresh')
    }
    return result
  } catch (e) {
    console.error('[Garden] 惩罚处理失败:', e)
    return { hasLoss: false, losses: [], totalMinutes: 0 }
  }
})

ipcMain.on('update-focus-mode', (event, enabled) => {
  focusModeEnabled = enabled
})

ipcMain.on('update-timer-status', (event, running, paused) => {
  timerRunning = running
  timerPaused = paused
})

ipcMain.handle('get-timer-state', () => {
  return {
    focusModeEnabled: focusModeEnabled,
    timerRunning: timerRunning,
    timerPaused: timerPaused
  }
})

// ============ 数据存储 IPC 处理 ============

ipcMain.handle('read-data', () => {
  return dataManager.readData()
})

ipcMain.handle('write-data', (event, data) => {
  return dataManager.writeData(data)
})

// ============ 设置独立文件 IPC 处理 ============

ipcMain.handle('read-settings', () => {
  return dataManager.readSettings()
})

ipcMain.handle('write-settings', (event, settings) => {
  return dataManager.writeSettings(settings)
})

// ============ 菜园子原子操作 IPC 处理（带锁保护） ============

// 读取菜园子数据（强制从文件读取最新）
ipcMain.handle('garden-read', async () => {
  return await dataManager.readGardenData()
})

// 写入菜园子数据（用于成就等直接更新）
ipcMain.handle('garden-write', async (event, gardenData) => {
  dataManager.writeGardenFile(gardenData)
  // 通知菜园子窗口刷新
  if (gardenWindow && !gardenWindow.isDestroyed()) {
    gardenWindow.webContents.send('garden-refresh')
  }
  return true
})

// 种植作物
ipcMain.handle('garden-plant', async (event, plotIndex, cropKey) => {
  const result = await dataManager.gardenPlant(plotIndex, cropKey)
  // 通知菜园子窗口刷新
  if (gardenWindow && !gardenWindow.isDestroyed()) {
    gardenWindow.webContents.send('garden-refresh')
  }
  // 成就解锁通知
  sendAchievementNotifications(result.unlockedAchievements)
  return result
})

// 收获作物
ipcMain.handle('garden-harvest', async (event, plotIndex) => {
  const result = await dataManager.gardenHarvest(plotIndex)
  // 通知菜园子窗口刷新
  if (gardenWindow && !gardenWindow.isDestroyed()) {
    gardenWindow.webContents.send('garden-refresh')
  }
  // 成就解锁通知
  sendAchievementNotifications(result.unlockedAchievements)
  return result
})

// 购买种子
ipcMain.handle('garden-buy-seed', async (event, cropKey) => {
  const result = await dataManager.gardenBuySeed(cropKey)
  // 通知菜园子窗口刷新
  if (gardenWindow && !gardenWindow.isDestroyed()) {
    gardenWindow.webContents.send('garden-refresh')
  }
  // 成就解锁通知
  sendAchievementNotifications(result.unlockedAchievements)
  return result
})

// 出售作物
ipcMain.handle('garden-sell-crop', async (event, cropKey) => {
  const result = await dataManager.gardenSellCrop(cropKey)
  // 通知菜园子窗口刷新
  if (gardenWindow && !gardenWindow.isDestroyed()) {
    gardenWindow.webContents.send('garden-refresh')
  }
  // 成就解锁通知
  sendAchievementNotifications(result.unlockedAchievements)
  return result
})

// 一键出售所有作物
ipcMain.handle('garden-sell-all', async () => {
  const result = await dataManager.gardenSellAllCrops()
  // 通知菜园子窗口刷新
  if (gardenWindow && !gardenWindow.isDestroyed()) {
    gardenWindow.webContents.send('garden-refresh')
  }
  // 成就解锁通知
  sendAchievementNotifications(result.unlockedAchievements)
  return result
})

// 解锁土地
ipcMain.handle('garden-unlock-plot', async (event, plotIndex) => {
  const result = await dataManager.gardenUnlockPlot(plotIndex)
  // 通知菜园子窗口刷新
  if (gardenWindow && !gardenWindow.isDestroyed()) {
    gardenWindow.webContents.send('garden-refresh')
  }
  // 成就解锁通知
  sendAchievementNotifications(result.unlockedAchievements)
  return result
})

// 签到
ipcMain.handle('garden-signin', async () => {
  const result = await dataManager.gardenSignIn()
  // 通知菜园子窗口刷新
  if (gardenWindow && !gardenWindow.isDestroyed()) {
    gardenWindow.webContents.send('garden-refresh')
  }
  // 成就解锁通知
  sendAchievementNotifications(result.unlockedAchievements)
  return result
})

// 更新专注时间成就
ipcMain.handle('garden-update-focus', async (event, minutes) => {
  const result = await dataManager.gardenUpdateFocusMinutes(minutes)
  // 通知菜园子窗口刷新（如果有新成就解锁）
  if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
    if (gardenWindow && !gardenWindow.isDestroyed()) {
      gardenWindow.webContents.send('garden-refresh')
    }
    // 成就解锁通知
    sendAchievementNotifications(result.unlockedAchievements)
  }
  return result
})

// ============ 开机自启动 IPC 处理 ============

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

// ============ 凭据存储 IPC 处理 ============

ipcMain.handle('save-credentials', (event, credentials) => {
  return cloudAuth.saveCredentials(credentials)
})

ipcMain.handle('load-credentials', () => {
  return cloudAuth.loadCredentials()
})

ipcMain.handle('clear-credentials', () => {
  return cloudAuth.clearCredentials()
})

// ============ 云端登录 IPC 处理 ============

ipcMain.handle('cloud-test-connection', async () => {
  return await cloudAuth.testConnection()
})

ipcMain.handle('cloud-get-session', async () => {
  return await cloudAuth.getSessionWithKey(aiAssistant, songDownloader)
})

ipcMain.handle('cloud-login', async (event, { username, password }) => {
  const result = await cloudAuth.login(username, password, aiAssistant, songDownloader)
  
  // 登录成功后，设置自习室同步模块的当前用户
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
  return await cloudAuth.logout(aiAssistant, foregroundInspection, songDownloader)
})

// ============ 意见反馈 IPC 处理 ============

// 提交反馈
ipcMain.handle('submit-feedback', async (event, content) => {
  return await cloudAuth.submitFeedback(content)
})

// 获取用户反馈列表
ipcMain.handle('get-user-feedbacks', async () => {
  return await cloudAuth.getUserFeedbacks()
})

// 删除反馈
ipcMain.handle('delete-feedback', async (event, feedbackId) => {
  return await cloudAuth.deleteFeedback(feedbackId)
})

// ============ 自习室 IPC 处理 ============

const studyRoomSync = require('./src/modules/studyRoomSync')

// 获取我创建的自习室列表
ipcMain.handle('study-room-get-my-rooms', async () => {
  return await studyRoomSync.getMyRooms()
})

// 获取活跃的自习室列表
ipcMain.handle('study-room-get-active', async (event, { publicOnly } = {}) => {
  return await studyRoomSync.getActiveRooms(publicOnly)
})

// 根据ID获取自习室信息
ipcMain.handle('study-room-get-by-id', async (event, { roomId }) => {
  return await studyRoomSync.getRoomById(roomId)
})

// 创建自习室
ipcMain.handle('study-room-create', async (event, { name, description, isPublic }) => {
  return await studyRoomSync.createRoom(name, description, isPublic)
})

// 加入自习室
ipcMain.handle('study-room-join', async (event, { roomId }) => {
  return await studyRoomSync.joinRoom(roomId)
})

// 离开自习室
ipcMain.handle('study-room-leave', async (event, { roomId }) => {
  return await studyRoomSync.leaveRoom(roomId)
})

// 删除自习室
ipcMain.handle('study-room-delete', async (event, { roomId }) => {
  return await studyRoomSync.deleteRoom(roomId)
})

// 上传今日统计数据
ipcMain.handle('study-room-upload-stats', async (event, { roomId, todayMinutes, todayCount }) => {
  return await studyRoomSync.uploadTodayStats(roomId, todayMinutes, todayCount)
})

// 上传专注会话（已废弃，保留用于兼容）
ipcMain.handle('study-room-upload-session', async (event, { roomId, minutes, note }) => {
  return await studyRoomSync.uploadFocusSession(roomId, minutes, note)
})

// 获取今日排名
ipcMain.handle('study-room-get-ranking', async (event, { roomId }) => {
  return await studyRoomSync.getTodayRanking(roomId)
})

// 获取自习室成员
ipcMain.handle('study-room-get-members', async (event, { roomId }) => {
  return await studyRoomSync.getRoomMembers(roomId)
})

// 更新在线状态
ipcMain.handle('study-room-update-status', async (event, { roomId }) => {
  return await studyRoomSync.updateOnlineStatus(roomId)
})

ipcMain.handle('study-room-check-status', async (event, { roomId }) => {
  return await studyRoomSync.checkRoomStatus(roomId)
})

// ============ API Key 管理 IPC 处理（保留兼容） ============

ipcMain.handle('get-api-key', () => {
  const data = dataManager.readData()
  return data.apiKey || null
})

ipcMain.handle('save-api-key', (event, apiKey) => {
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
  const data = dataManager.readData()
  data.apiMode = mode
  const success = dataManager.writeData(data)
  
  // 如果切换到云端模式且没有登录，清除本地 API Key 的效果
  if (success && mode === 'cloud') {
    // 清除 AI 助手和前台检测的 API Key（需要重新登录获取）
    const session = cloudAuth.getSession()
    if (!session || !session.admin) {
      aiAssistant.setApiKey(null)
      foregroundInspection.setApiKey(null)
    }
  }
  
  return success
})

// ============ 音乐播放器 IPC 处理 ============

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
  // 保存设备ID到数据文件
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

ipcMain.handle('music-get-custom-tags', async (event) => {
  try {
    const result = await musicProcess.getCustomTags()
    return result
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

// ============ 快捷键设置 IPC 处理 ============

ipcMain.handle('music-get-hotkeys', async () => {
  try {
    const result = await musicProcess.getHotkeys()
    return result
  } catch (error) {
    return { hotkeys: null }
  }
})

ipcMain.handle('music-set-hotkeys', async (event, hotkeys) => {
  try {
    const result = await musicProcess.setHotkeys(hotkeys)
    return result
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('music-start-hotkey-recording', async () => {
  try {
    const result = await musicProcess.startHotkeyRecording()
    return result
  } catch (error) {
    return { success: false }
  }
})

ipcMain.handle('music-stop-hotkey-recording', async () => {
  try {
    const result = await musicProcess.stopHotkeyRecording()
    return result
  } catch (error) {
    return { keys: [] }
  }
})

// ============ 音乐榜单 IPC 处理 ============

const chartsFetcher = require('./src/modules/chartsFetcher')
const songDownloader = require('./src/modules/songDownloader')

ipcMain.handle('charts-fetch', async (event, source) => {
  try {
    const songs = await chartsFetcher.fetchCharts(source)
    return { success: true, songs }
  } catch (error) {
    console.error('[Charts] 抓取失败:', error)
    return { success: false, error: error.message }
  }
})

// 设置下载器路径
ipcMain.on('set-downloader-path', (event, exePath) => {
  songDownloader.setDownloaderPath(exePath)
})

// 设置 API Key
ipcMain.on('set-download-api-key', (event, apiKey) => {
  songDownloader.setApiKey(apiKey)
})

// 下载歌曲
ipcMain.handle('download-song', async (event, title, artist) => {
  // 确保下载器路径已设置
  if (!songDownloader.getDownloaderPath?.()) {
    // 根据是否打包设置路径
    let downloaderPath
    if (app.isPackaged) {
      downloaderPath = path.join(process.resourcesPath, 'manual_downloader.exe')
    } else {
      downloaderPath = path.join(__dirname, 'music-player', 'manual_downloader.exe')
    }
    songDownloader.setDownloaderPath(downloaderPath)
  }
  
  return await songDownloader.downloadSong(title, artist)
})

// 获取下载状态
ipcMain.handle('download-status', () => {
  return songDownloader.getStatus()
})

// 获取应用版本号
ipcMain.handle('get-version', () => {
  return app.getVersion()
})

// ============ AI助手 IPC 处理 ============

ipcMain.handle('ai-generate-plan', async (event, userInput) => {
  return await aiAssistant.generatePlan(userInput)
})

// ============ 前台检测 IPC 处理 ============

ipcMain.handle('foreground-is-ready', () => {
  return foregroundInspectionReady
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

// ============ 窗口置顶 IPC 处理 ============

ipcMain.on('set-always-on-top', (event, onTop) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    win.setAlwaysOnTop(onTop)
    win.setMinimizable(!onTop)  // 置顶时禁用最小化
  }
})

ipcMain.on('bring-to-front', (event) => {
  const windows = BrowserWindow.getAllWindows()
  const mainWindow = windows.find(w => !w.isDestroyed())
  
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(true)
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
    mainWindow.moveTop()
  }
})

ipcMain.on('cancel-always-on-top', (event) => {
  const windows = BrowserWindow.getAllWindows()
  const mainWindow = windows.find(w => !w.isDestroyed())
  
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(false)
  }
})

// ============ 迷你模式 IPC 处理 ============

// 存储两种模式的窗口位置
let normalModePosition = null  // 正常模式位置（临时）
let miniModePosition = null    // 迷你模式位置（持久化）

// 正常模式窗口尺寸
const NORMAL_WIDTH = 520
const NORMAL_HEIGHT = 560
const MINI_WIDTH = 180
const MINI_HEIGHT = 220

// 加载迷你模式位置
function loadMiniModePosition() {
  const data = dataManager.readData()
  if (data.miniModePosition) {
    miniModePosition = data.miniModePosition
  }
}

// 保存迷你模式位置
function saveMiniModePosition() {
  const data = dataManager.readData()
  data.miniModePosition = miniModePosition
  dataManager.writeData(data)
}

ipcMain.on('enter-mini-mode', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    // 保存当前正常模式位置
    normalModePosition = win.getPosition()
    
    // 设置迷你模式尺寸并置顶，禁止最小化，隐藏任务栏图标
    win.setSize(MINI_WIDTH, MINI_HEIGHT)
    win.setAlwaysOnTop(true)
    win.setMinimizable(false)
    win.setSkipTaskbar(true)
    
    // 创建系统托盘图标
    if (!tray) {
      const iconPath = path.join(__dirname, 'src/tomato-page-1.ico')
      const icon = nativeImage.createFromPath(iconPath)
      tray = new Tray(icon)
      tray.setToolTip('番茄钟 - 迷你模式')
      
      // 右键菜单
      const contextMenu = Menu.buildFromTemplate([
        {
          label: '展开窗口',
          click: () => {
            // 发送事件到渲染进程退出迷你模式
            win.webContents.send('exit-mini-mode-from-tray')
          }
        },
        { type: 'separator' },
        {
          label: '退出应用',
          click: () => {
            // 发送事件到渲染进程，让渲染进程处理确认弹窗和退出
            win.webContents.send('quit-app-from-tray')
          }
        }
      ])
      tray.setContextMenu(contextMenu)
      
      tray.on('click', () => {
        // 点击托盘图标显示窗口
        if (win.isMinimized()) {
          win.restore()
        }
        win.focus()
      })
    }
    
    // 如果有保存的迷你模式位置，恢复它
    if (miniModePosition) {
      win.setPosition(miniModePosition[0], miniModePosition[1])
    }
  }
})

ipcMain.on('exit-mini-mode', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    // 保存迷你模式位置（持久化）
    miniModePosition = win.getPosition()
    saveMiniModePosition()
    
    // 恢复正常模式尺寸，恢复可最小化，显示任务栏图标
    win.setSize(NORMAL_WIDTH, NORMAL_HEIGHT)
    win.setAlwaysOnTop(false)
    win.setMinimizable(true)
    win.setSkipTaskbar(false)
    
    // 销毁系统托盘图标
    if (tray) {
      tray.destroy()
      tray = null
    }
    
    // 恢复正常模式位置
    if (normalModePosition) {
      win.setPosition(normalModePosition[0], normalModePosition[1])
    }
  }
})

// 监听窗口移动，实时更新迷你模式位置
ipcMain.on('update-mini-position', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    miniModePosition = win.getPosition()
    saveMiniModePosition()
  }
})

// ============ 应用生命周期 ============

app.whenReady().then(() => {
  // 初始化云端认证
  cloudAuth.init()
  
  // 初始化自习室同步模块
  studyRoomSync.init()
  console.log('[Main] 自习室同步模块已初始化')
  
  // 检查本地 API Key 模式并初始化各模块
  const savedData = dataManager.readData()
  if (savedData.apiMode === 'local' && savedData.apiKey) {
    console.log('[Main] 检测到本地 API Key 模式，正在初始化...')
    aiAssistant.setApiKey(savedData.apiKey)
    foregroundInspection.setApiKey(savedData.apiKey)
    songDownloader.setApiKey(savedData.apiKey)
  }
  
  // 加载迷你模式位置
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

app.on('before-quit', () => {
  musicProcess.stop()
  foregroundInspection.stop()
  
  // 单点登录：停止心跳并标记离线
  cloudAuth.stopHeartbeat()
  const session = cloudAuth.getSession()
  console.log('[Main] before-quit, session:', session ? session.username : 'null')
  if (session) {
    // 异步标记离线，不等待结果（因为 app 即将退出）
    cloudAuth.markOffline(session.id).then(() => {
      console.log('[Main] markOffline 完成')
    }).catch((err) => {
      console.error('[Main] markOffline 失败:', err)
    })
  }
})