/**
 * Electron 主进程 mock
 *
 * 提供 app / BrowserWindow / ipcMain / shell / Notification 等核心 API
 * 通过 vi.mock('electron', ...) 在测试中注入
 *
 * 注意：依赖 vitest globals（vitest.config.js 中 globals: true）
 * 如果 vi 不可用（CommonJS 上下文），回退到本地 mockFn 实现。
 */
const mockFn = require('./mock-fn')
const vi = (typeof globalThis !== 'undefined' && globalThis.vi) ? globalThis.vi : { fn: mockFn }

// ============ BrowserWindow mock ============
const BrowserWindowMock = vi.fn().mockImplementation(function (opts = {}) {
  return {
    opts,
    webContents: {
      send: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn().mockReturnValue(''),
      isDevToolsOpened: vi.fn().mockReturnValue(false),
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
      reload: vi.fn(),
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined)
    },
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    loadFile: vi.fn().mockResolvedValue(undefined),
    loadURL: vi.fn().mockResolvedValue(undefined),
    isMinimized: vi.fn().mockReturnValue(false),
    isMaximized: vi.fn().mockReturnValue(false),
    isDestroyed: vi.fn().mockReturnValue(false),
    isAlwaysOnTop: vi.fn().mockReturnValue(false),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setBounds: vi.fn(),
    getBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 520, height: 560 }),
    setPosition: vi.fn(),
    getSize: vi.fn().mockReturnValue([520, 560]),
    getPosition: vi.fn().mockReturnValue([0, 0]),
    setSize: vi.fn(),
    setBackgroundColor: vi.fn(),
    setSkipTaskbar: vi.fn(),
    setHasShadow: vi.fn(),
    setShape: vi.fn(),
    setOpacity: vi.fn(),
    setResizable: vi.fn(),
    setMaximumSize: vi.fn(),
    setMinimumSize: vi.fn(),
    setFullScreen: vi.fn(),
    setKiosk: vi.fn(),
    setMenuBarVisibility: vi.fn(),
    setAutoHideMenuBar: vi.fn(),
    setProgressBar: vi.fn(),
    setOverlayIcon: vi.fn(),
    setThumbnailClip: vi.fn(),
    setThumbnailToolTip: vi.fn(),
    setAppDetails: vi.fn(),
    flashFrame: vi.fn(),
    restore: vi.fn(),
    moveTop: vi.fn(),
    center: vi.fn(),
    setTitle: vi.fn(),
    setMinimizable: vi.fn(),
    id: Math.floor(Math.random() * 100000)
  }
})
BrowserWindowMock.getAllWindows = vi.fn().mockReturnValue([])
BrowserWindowMock.getFocusedWindow = vi.fn().mockReturnValue(null)
BrowserWindowMock.fromId = vi.fn().mockReturnValue(null)
BrowserWindowMock.fromWebContents = vi.fn().mockReturnValue(null)

// ============ app mock ============
const appMock = {
  isPackaged: false,
  isReady: vi.fn().mockReturnValue(true),
  whenReady: vi.fn().mockResolvedValue(undefined),
  requestSingleInstanceLock: vi.fn().mockReturnValue(true),
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  quit: vi.fn(),
  exit: vi.fn(),
  relaunch: vi.fn(),
  getPath: vi.fn().mockImplementation((name) => {
    const paths = {
      userData: '/tmp/pomodoro-test/userData',
      temp: '/tmp',
      home: '/tmp/home',
      exe: '/tmp/pomodoro.exe',
      appPath: '/tmp/pomodoro',
      documents: '/tmp/documents',
      desktop: '/tmp/desktop',
      downloads: '/tmp/downloads'
    }
    return paths[name] || `/tmp/${name}`
  }),
  getAppPath: vi.fn().mockReturnValue('/tmp/pomodoro'),
  getVersion: vi.fn().mockReturnValue('3.2.4'),
  getName: vi.fn().mockReturnValue('pomodoro-timer'),
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn().mockReturnValue({ openAtLogin: false }),
  setAppUserModelId: vi.fn(),
  setAsDefaultProtocolClient: vi.fn(),
  removeAsDefaultProtocolClient: vi.fn(),
  isDefaultProtocolClient: vi.fn().mockReturnValue(false),
  getUserAgentFallback: vi.fn().mockReturnValue('test-agent'),
  setUserAgentFallback: vi.fn(),
  allowRendererProcessReuse: vi.fn()
}

// ============ ipcMain mock ============
const ipcMainMock = {
  handle: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  removeHandler: vi.fn(),
  removeAllListeners: vi.fn(),
  emit: vi.fn()
}

// ============ ipcRenderer mock ============
const ipcRendererMock = {
  send: vi.fn(),
  sendSync: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn(),
  emit: vi.fn(),
  postMessage: vi.fn()
}

// ============ contextBridge mock ============
const contextBridgeMock = {
  exposeInMainWorld: vi.fn()
}

// ============ Menu mock ============
const MenuMock = {
  buildFromTemplate: vi.fn().mockImplementation((template) => template),
  setApplicationMenu: vi.fn(),
  getApplicationMenu: vi.fn().mockReturnValue(null),
  popup: vi.fn(),
  closePopup: vi.fn(),
  append: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn()
}

// ============ Tray mock ============
const TrayMock = vi.fn().mockImplementation(function () {
  return {
    setToolTip: vi.fn(),
    setTitle: vi.fn(),
    setImage: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
    popUpContextMenu: vi.fn(),
    getBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 16, height: 16 })
  }
})

// ============ Notification mock ============
const NotificationMock = vi.fn().mockImplementation(function (opts = {}) {
  return {
    opts,
    show: vi.fn(),
    on: vi.fn(),
    close: vi.fn()
  }
})
NotificationMock.isSupported = vi.fn().mockReturnValue(true)

// ============ shell mock ============
const shellMock = {
  openExternal: vi.fn().mockResolvedValue(undefined),
  openPath: vi.fn().mockResolvedValue(undefined),
  showItemInFolder: vi.fn(),
  trashItem: vi.fn().mockResolvedValue(undefined),
  beep: vi.fn(),
  moveItemToTrash: vi.fn(),
  writeShortcutLink: vi.fn(),
  readShortcutLink: vi.fn()
}

// ============ safeStorage mock ============
const safeStorageMock = {
  encryptString: vi.fn().mockImplementation((s) => Buffer.from(`ENC:${s}`)),
  decryptString: vi.fn().mockImplementation((buf) => {
    const s = buf.toString()
    return s.startsWith('ENC:') ? s.slice(4) : s
  }),
  isEncryptionAvailable: vi.fn().mockReturnValue(true)
}

// ============ session mock ============
const sessionMock = {
  defaultSession: {
    on: vi.fn(),
    off: vi.fn(),
    webRequest: {
      onBeforeSendHeaders: vi.fn(),
      onHeadersReceived: vi.fn(),
      filter: vi.fn()
    },
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setUserAgent: vi.fn(),
    closeAllConnections: vi.fn()
  },
  fromPartition: vi.fn().mockReturnValue({
    on: vi.fn(),
    webRequest: { onBeforeSendHeaders: vi.fn() }
  })
}

// ============ systemPreferences mock ============
const systemPreferencesMock = {
  getUserDefault: vi.fn().mockReturnValue(''),
  subscribeNotification: vi.fn(),
  unsubscribeNotification: vi.fn(),
  isDarkMode: vi.fn().mockReturnValue(false),
  on: vi.fn()
}

// ============ powerMonitor mock ============
const powerMonitorMock = {
  on: vi.fn(),
  off: vi.fn(),
  getSystemIdleTime: vi.fn().mockReturnValue(0),
  getSystemIdleState: vi.fn().mockReturnValue('active'),
  getCurrentThermalState: vi.fn().mockReturnValue('unknown')
}

// ============ screen mock ============
const screenMock = {
  getPrimaryDisplay: vi.fn().mockReturnValue({
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    workAreaSize: { width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1
  }),
  getAllDisplays: vi.fn().mockReturnValue([]),
  on: vi.fn(),
  off: vi.fn()
}

// ============ nativeImage mock ============
const nativeImageMock = {
  createFromPath: vi.fn().mockReturnValue({ isEmpty: vi.fn().mockReturnValue(false) }),
  createFromBuffer: vi.fn().mockReturnValue({ isEmpty: vi.fn().mockReturnValue(false) }),
  createEmpty: vi.fn().mockReturnValue({ isEmpty: vi.fn().mockReturnValue(true) })
}

// ============ globalShortcut mock ============
const globalShortcutMock = {
  register: vi.fn().mockReturnValue(true),
  unregister: vi.fn(),
  isRegistered: vi.fn().mockReturnValue(false),
  unregisterAll: vi.fn()
}

// ============ clipboard mock ============
const clipboardMock = {
  readText: vi.fn().mockReturnValue(''),
  writeText: vi.fn(),
  readImage: vi.fn(),
  writeImage: vi.fn(),
  clear: vi.fn(),
  availableFormats: vi.fn().mockReturnValue([])
}

// ============ dialog mock ============
const dialogMock = {
  showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
  showMessageBoxSync: vi.fn().mockReturnValue(0),
  showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
  showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: undefined }),
  showErrorBox: vi.fn()
}

// ============ webContents mock（独立导出） ============
const webContentsMock = {
  send: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  executeJavaScript: vi.fn().mockResolvedValue(undefined),
  getURL: vi.fn().mockReturnValue(''),
  isDevToolsOpened: vi.fn().mockReturnValue(false),
  openDevTools: vi.fn(),
  closeDevTools: vi.fn(),
  reload: vi.fn(),
  loadFile: vi.fn().mockResolvedValue(undefined),
  loadURL: vi.fn().mockResolvedValue(undefined)
}

module.exports = {
  app: appMock,
  BrowserWindow: BrowserWindowMock,
  ipcMain: ipcMainMock,
  ipcRenderer: ipcRendererMock,
  contextBridge: contextBridgeMock,
  Menu: MenuMock,
  Tray: TrayMock,
  Notification: NotificationMock,
  shell: shellMock,
  safeStorage: safeStorageMock,
  session: sessionMock,
  systemPreferences: systemPreferencesMock,
  powerMonitor: powerMonitorMock,
  screen: screenMock,
  nativeImage: nativeImageMock,
  globalShortcut: globalShortcutMock,
  clipboard: clipboardMock,
  dialog: dialogMock,
  webContents: webContentsMock,
  // 用于测试中重置所有 mock
  __resetAllMocks: function() {
    Object.values(module.exports).forEach((v) => {
      if (v && typeof v === 'object') {
        Object.values(v).forEach((fn) => {
          if (typeof fn === 'function' && fn.mockReset) {
            fn.mockReset()
          }
        })
      } else if (typeof v === 'function' && v.mockReset) {
        v.mockReset()
      }
    })
  }
}
