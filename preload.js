/**
 * 预加载脚本 - 安全地暴露 IPC 通信给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron')

  // 通过 contextBridge 安全地暴露 API 给渲染进程
  contextBridge.exposeInMainWorld('electronAPI', {
  // 打开外部链接
  openExternal: (url) => ipcRenderer.send('open-external', url),
  
  // 关闭窗口
  closeWindow: () => ipcRenderer.send('close-window'),
  
  // 最小化窗口
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  
  // 显示通知
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),

  // ============ 数据存储 API ============
  
  // 读取数据
  readData: () => ipcRenderer.invoke('read-data'),
  
  // 写入数据
  writeData: (data) => ipcRenderer.invoke('write-data', data),

  // ============ 设置独立文件 API ============
  
  // 读取设置
  readSettings: () => ipcRenderer.invoke('read-settings'),
  
  // 写入设置
  writeSettings: (settings) => ipcRenderer.invoke('write-settings', settings),

  // ============ 菜园子原子操作 API ============
  
  // 读取菜园子数据
  gardenRead: () => ipcRenderer.invoke('garden-read'),
  
  // 种植作物
  gardenPlant: (plotIndex, cropKey) => ipcRenderer.invoke('garden-plant', plotIndex, cropKey),
  
  // 收获作物
  gardenHarvest: (plotIndex) => ipcRenderer.invoke('garden-harvest', plotIndex),
  
  // 购买种子
  gardenBuySeed: (cropKey) => ipcRenderer.invoke('garden-buy-seed', cropKey),
  
  // 出售作物
  gardenSellCrop: (cropKey) => ipcRenderer.invoke('garden-sell-crop', cropKey),
  
  // 一键出售所有作物
  gardenSellAll: () => ipcRenderer.invoke('garden-sell-all'),
  
  // 解锁土地
  gardenUnlockPlot: (plotIndex) => ipcRenderer.invoke('garden-unlock-plot', plotIndex),
  
  // 签到
  gardenSignIn: () => ipcRenderer.invoke('garden-signin'),
  
  // 更新专注时间成就
  gardenUpdateFocus: (minutes) => ipcRenderer.invoke('garden-update-focus', minutes),
  
  // 发送作物成长事件（由 timer 调用）
  gardenGrow: (minutes) => ipcRenderer.send('garden-grow', minutes),
  
  // 执行惩罚并返回结果（由 foregroundDetection 调用）
  gardenPunishment: () => ipcRenderer.invoke('garden-punishment'),
  
  // 监听菜园子刷新事件（由菜园子窗口监听）
  onGardenRefresh: (callback) => ipcRenderer.on('garden-refresh', callback),

  // ============ API Key 管理 API ============

  // 获取API Key
  getApiKey: () => ipcRenderer.invoke('get-api-key'),

  // 保存API Key
  saveApiKey: (apiKey) => ipcRenderer.invoke('save-api-key', apiKey),

  // 获取 API 模式 ('cloud' | 'local')
  getApiMode: () => ipcRenderer.invoke('get-api-mode'),

  // 设置 API 模式
  setApiMode: (mode) => ipcRenderer.invoke('set-api-mode', mode),

  // ============ 云端登录 API ============
  
  // 测试云端连接
  cloudTestConnection: () => ipcRenderer.invoke('cloud-test-connection'),
  
  // 获取当前会话
  cloudGetSession: () => ipcRenderer.invoke('cloud-get-session'),
  
  // 登录
  cloudLogin: (credentials) => ipcRenderer.invoke('cloud-login', credentials),
  
  // 注册
  cloudRegister: (userData) => ipcRenderer.invoke('cloud-register', userData),
  
  // 退出登录
  cloudLogout: () => ipcRenderer.invoke('cloud-logout'),

  // ============ 自习室 API ============
  
  // 获取我创建的自习室列表
  studyRoomGetMyRooms: () => ipcRenderer.invoke('study-room-get-my-rooms'),
  
  // 获取活跃的自习室列表
  studyRoomGetActive: (publicOnly = false) => ipcRenderer.invoke('study-room-get-active', { publicOnly }),
  
  // 根据ID获取自习室信息
  studyRoomGetById: (roomId) => ipcRenderer.invoke('study-room-get-by-id', { roomId }),
  
  // 创建自习室
  studyRoomCreate: (name, description, isPublic) => ipcRenderer.invoke('study-room-create', { name, description, isPublic }),
  
  // 加入自习室
  studyRoomJoin: (roomId) => ipcRenderer.invoke('study-room-join', { roomId }),
  
  // 离开自习室
  studyRoomLeave: (roomId) => ipcRenderer.invoke('study-room-leave', { roomId }),
  
  // 删除自习室
  studyRoomDelete: (roomId) => ipcRenderer.invoke('study-room-delete', { roomId }),
  
  // 上传今日统计数据
  studyRoomUploadStats: (roomId, todayMinutes, todayCount) => ipcRenderer.invoke('study-room-upload-stats', { roomId, todayMinutes, todayCount }),
  
  // 上传专注会话（已废弃）
  studyRoomUploadSession: (roomId, minutes, note) => ipcRenderer.invoke('study-room-upload-session', { roomId, minutes, note }),
  
  // 获取今日排名
  studyRoomGetRanking: (roomId) => ipcRenderer.invoke('study-room-get-ranking', { roomId }),
  
  // 获取自习室成员
  studyRoomGetMembers: (roomId) => ipcRenderer.invoke('study-room-get-members', { roomId }),
  
  // 更新在线状态
  studyRoomUpdateStatus: (roomId) => ipcRenderer.invoke('study-room-update-status', { roomId }),

  // ============ 凭据存储 API ============
  
  // 保存凭据
  saveCredentials: (credentials) => ipcRenderer.invoke('save-credentials', credentials),
  
  // 加载凭据
  loadCredentials: () => ipcRenderer.invoke('load-credentials'),
  
  // 清除凭据
  clearCredentials: () => ipcRenderer.invoke('clear-credentials'),

  // ============ 音乐播放器控制 ============
  
  // 音乐播放器控制命令
  musicTogglePlay: () => ipcRenderer.send('music-toggle'),
  musicNext: () => ipcRenderer.send('music-next'),
  musicPrev: () => ipcRenderer.send('music-prev'),
  musicSeek: (position) => ipcRenderer.send('music-seek', position),
  musicSetVolume: (volume) => ipcRenderer.send('music-set-volume', volume),
  musicGetStatus: () => ipcRenderer.send('music-get-status'),
  musicGetDevices: () => ipcRenderer.send('music-get-devices'),
  musicSetDevice: (deviceId) => ipcRenderer.send('music-set-device', deviceId),
  musicSetPlayMode: (mode) => ipcRenderer.send('music-set-play-mode', mode),
  musicGetPlaylist: () => ipcRenderer.send('music-get-playlist'),
  musicDeleteSong: (name) => ipcRenderer.invoke('music-delete-song', name),
  musicPlaySong: (name) => ipcRenderer.send('music-play-song', name),
  musicUpdateTag: (name, tag, color) => ipcRenderer.invoke('music-update-tag', { name, tag, color }),
  musicGetCustomTags: () => ipcRenderer.invoke('music-get-custom-tags'),
  musicAddCustomTag: (name, color) => ipcRenderer.invoke('music-add-custom-tag', { name, color }),
  musicDeleteCustomTag: (name) => ipcRenderer.invoke('music-delete-custom-tag', name),
  
  // 快捷键设置
  musicGetHotkeys: () => ipcRenderer.invoke('music-get-hotkeys'),
  musicSetHotkeys: (hotkeys) => ipcRenderer.invoke('music-set-hotkeys', hotkeys),
  musicStartHotkeyRecording: () => ipcRenderer.invoke('music-start-hotkey-recording'),
  musicStopHotkeyRecording: () => ipcRenderer.invoke('music-stop-hotkey-recording'),
  
  // 音乐播放器事件监听
  onMusicReady: (callback) => {
    ipcRenderer.on('music-ready', (event, data) => callback(data))
  },
  onMusicStatus: (callback) => {
    ipcRenderer.on('music-status', (event, data) => callback(data))
  },
  onMusicTrackChange: (callback) => {
    ipcRenderer.on('music-track-change', (event, data) => callback(data))
  },
  onMusicPlayState: (callback) => {
    ipcRenderer.on('music-play-state', (event, data) => callback(data))
  },
  onMusicProgress: (callback) => {
    ipcRenderer.on('music-progress', (event, data) => callback(data))
  },
  onMusicDevices: (callback) => {
    ipcRenderer.on('music-devices', (event, data) => callback(data))
  },
  onMusicNoMusic: (callback) => {
    ipcRenderer.on('music-no-music', (event, data) => callback(data))
  },
  onMusicPlayError: (callback) => {
    ipcRenderer.on('music-play-error', (event, data) => callback(data))
  },
  onMusicVolumeChange: (callback) => {
    ipcRenderer.on('music-volume-change', (event, data) => callback(data))
  },
  onMusicPlayMode: (callback) => {
    ipcRenderer.on('music-play-mode', (event, data) => callback(data))
  },
  onMusicPlaylist: (callback) => {
    ipcRenderer.on('music-playlist', (event, data) => callback(data))
  },
  onMusicSongMissing: (callback) => {
    ipcRenderer.on('music-song-missing', (event, data) => callback(data))
  },
  onMusicHotkeys: (callback) => {
    ipcRenderer.on('music-hotkeys', (event, data) => callback(data))
  },
  onMusicHotkeyKeyPressed: (callback) => {
    ipcRenderer.on('music-hotkey-key-pressed', (event, data) => callback(data))
  },
  onMusicHotkeyRecordingStopped: (callback) => {
    ipcRenderer.on('music-hotkey-recording-stopped', (event, data) => callback(data))
  },
  
  // 移除监听器
  removeMusicListeners: () => {
    ipcRenderer.removeAllListeners('music-ready')
    ipcRenderer.removeAllListeners('music-status')
    ipcRenderer.removeAllListeners('music-track-change')
    ipcRenderer.removeAllListeners('music-play-state')
    ipcRenderer.removeAllListeners('music-progress')
    ipcRenderer.removeAllListeners('music-devices')
    ipcRenderer.removeAllListeners('music-no-music')
    ipcRenderer.removeAllListeners('music-play-error')
    ipcRenderer.removeAllListeners('music-volume-change')
    ipcRenderer.removeAllListeners('music-play-mode')
    ipcRenderer.removeAllListeners('music-playlist')
    ipcRenderer.removeAllListeners('music-song-missing')
    ipcRenderer.removeAllListeners('music-hotkeys')
    ipcRenderer.removeAllListeners('music-hotkey-key-pressed')
    ipcRenderer.removeAllListeners('music-hotkey-recording-stopped')
  },

  // ============ 音乐榜单 API ============
  
  // 获取榜单
  chartsFetch: (source) => ipcRenderer.invoke('charts-fetch', source),
  
  // 下载歌曲
  downloadSong: (title, artist) => ipcRenderer.invoke('download-song', title, artist),
  getDownloadStatus: () => ipcRenderer.invoke('download-status'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  
  // 设置下载器路径
  setDownloaderPath: (exePath) => ipcRenderer.send('set-downloader-path', exePath),
  
  // 设置下载 API Key
  setDownloadApiKey: (apiKey) => ipcRenderer.send('set-download-api-key', apiKey),

  // ============ 菜园子窗口 API ============
  
  // 打开菜园子窗口
  openGarden: () => ipcRenderer.send('open-garden'),
  
  // 关闭菜园子窗口
  closeGarden: () => ipcRenderer.send('close-garden'),
  
  // 刷新菜园子窗口
  refreshGarden: () => ipcRenderer.send('refresh-garden'),

  // 更新专注模式状态（供主窗口调用）
  updateFocusMode: (enabled) => ipcRenderer.send('update-focus-mode', enabled),

  // 更新计时器状态（供主窗口调用）
  updateTimerStatus: (running, paused) => ipcRenderer.send('update-timer-status', running, paused),

  // 查询计时器状态（供菜园子窗口调用）
  getTimerState: () => ipcRenderer.invoke('get-timer-state'),

  // ============ AI助手 API ============
  
  // AI计划
  aiGeneratePlan: (userInput) => ipcRenderer.invoke('ai-generate-plan', userInput),
  
  // ============ 前台检测 API ============
  
  // 查询前台检测是否就绪
  foregroundIsReady: () => ipcRenderer.invoke('foreground-is-ready'),
  
  // 前台检测控制命令
  foregroundStart: () => ipcRenderer.send('foreground-start'),
  foregroundStop: () => ipcRenderer.send('foreground-stop'),
  foregroundGetStatus: () => ipcRenderer.send('foreground-get-status'),
  foregroundSetApiKey: (apiKey) => ipcRenderer.send('foreground-set-api-key', apiKey),
  foregroundAddWhitelist: (keyword) => ipcRenderer.send('foreground-add-whitelist', keyword),
  foregroundAddBlacklist: (keyword) => ipcRenderer.send('foreground-add-blacklist', keyword),
  foregroundMarkHistoryNot: (windowTitle) => ipcRenderer.send('foreground-mark-history-not', windowTitle),
  foregroundMoveBlacklistToWhitelist: (keyword) => ipcRenderer.send('foreground-move-blacklist-to-whitelist', keyword),
  
  // 前台检测事件监听
  onForegroundReady: (callback) => {
    ipcRenderer.on('foreground-ready', (event, data) => callback(data))
  },
  onForegroundApiKeyInvalid: (callback) => {
    ipcRenderer.on('foreground-api-key-invalid', (event, data) => callback(data))
  },
  onForegroundEntertainmentDetected: (callback) => {
    ipcRenderer.on('foreground-entertainment-detected', (event, data) => callback(data))
  },
  onForegroundStatus: (callback) => {
    ipcRenderer.on('foreground-status', (event, data) => callback(data))
  },
  onForegroundError: (callback) => {
    ipcRenderer.on('foreground-error', (event, data) => callback(data))
  },
  
  // 移除前台检测监听器
  removeForegroundListeners: () => {
    ipcRenderer.removeAllListeners('foreground-ready')
    ipcRenderer.removeAllListeners('foreground-entertainment-detected')
    ipcRenderer.removeAllListeners('foreground-status')
    ipcRenderer.removeAllListeners('foreground-error')
  },
  
  // ============ 窗口置顶 API ============
  
  setAlwaysOnTop: (onTop) => ipcRenderer.send('set-always-on-top', onTop),
  
  // 窗口抢占前台
  bringToFront: () => ipcRenderer.send('bring-to-front'),
  
  // 取消置顶
  cancelAlwaysOnTop: () => ipcRenderer.send('cancel-always-on-top'),
  
  // ============ 迷你模式 API ============
  
  // 进入迷你模式
  enterMiniMode: () => ipcRenderer.send('enter-mini-mode'),
  
  // 退出迷你模式
  exitMiniMode: () => ipcRenderer.send('exit-mini-mode'),
  
  // 更新迷你模式位置（用于持久化）
  updateMiniPosition: () => ipcRenderer.send('update-mini-position'),
  
  // 监听托盘退出迷你模式事件
  onExitMiniModeFromTray: (callback) => {
    ipcRenderer.on('exit-mini-mode-from-tray', () => callback())
  },
  
  // 监听托盘退出应用事件
  onQuitAppFromTray: (callback) => {
    ipcRenderer.on('quit-app-from-tray', () => callback())
  },
  
  // ============ 开机自启动 API ============
  
  // 设置开机自启动
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  
  // 获取开机自启动状态
  getAutoStart: () => ipcRenderer.invoke('get-auto-start')
})
