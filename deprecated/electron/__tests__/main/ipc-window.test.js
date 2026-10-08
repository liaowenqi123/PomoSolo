/**
 * main/ipc-window.js 测试
 *
 * 测试窗口操作、迷你模式、系统托盘等处理器。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

// Mock dataManager
const mockDataManager = vi.hoisted(() => {
  const m = { readData: vi.fn(), writeData: vi.fn() }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/dataManager', m)
  return m
})
vi.mock('../../src/modules/dataManager', () => mockDataManager)

const { BrowserWindow, Tray, Menu, nativeImage, shell, Notification, app } = require('electron')
const state = require('../../main/state')
const ipcMain = __electronMock.ipcMain
const { register, loadMiniModePosition } = require('../../main/ipc-window')

function findListener(channel) {
  const call = ipcMain.on.mock.calls.find(c => c[0] === channel)
  return call ? call[1] : undefined
}

// 辅助：创建模拟窗口
function createMockWin(opts = {}) {
  return {
    webContents: { send: vi.fn() },
    hide: vi.fn(),
    minimize: vi.fn(),
    isMinimized: vi.fn().mockReturnValue(false),
    isDestroyed: vi.fn().mockReturnValue(false),
    setAlwaysOnTop: vi.fn(),
    setMinimizable: vi.fn(),
    setSkipTaskbar: vi.fn(),
    setSize: vi.fn(),
    setPosition: vi.fn(),
    getPosition: vi.fn().mockReturnValue([100, 200]),
    getBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 520, height: 560 }),
    restore: vi.fn(),
    focus: vi.fn(),
    moveTop: vi.fn()
  }
}

// 辅助：创建模拟事件
function createMockEvent(win) {
  return { sender: win ? win.webContents : {} }
}

describe('main/ipc-window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.tray = null
    state.normalModePosition = null
    state.miniModePosition = null
    BrowserWindow.fromWebContents.mockReturnValue(null)
    BrowserWindow.getAllWindows.mockReturnValue([])
    register(ipcMain)
  })

  it('应注册所有 on 处理器', () => {
    expect(ipcMain.on).toHaveBeenCalledTimes(10)
    const channels = ipcMain.on.mock.calls.map(c => c[0])
    expect(channels).toContain('open-external')
    expect(channels).toContain('close-window')
    expect(channels).toContain('minimize-window')
    expect(channels).toContain('show-notification')
    expect(channels).toContain('set-always-on-top')
    expect(channels).toContain('bring-to-front')
    expect(channels).toContain('cancel-always-on-top')
    expect(channels).toContain('enter-mini-mode')
    expect(channels).toContain('exit-mini-mode')
    expect(channels).toContain('update-mini-position')
  })

  // ============ 基础窗口操作 ============

  describe('open-external', () => {
    it('应调用 shell.openExternal', () => {
      findListener('open-external')({}, 'https://example.com')
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
    })
  })

  describe('close-window', () => {
    it('应隐藏窗口并退出应用', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)
      findListener('close-window')(createMockEvent(win))
      expect(win.hide).toHaveBeenCalledTimes(1)
      expect(app.quit).toHaveBeenCalledTimes(1)
    })

    it('win 为 null 时不应报错', () => {
      BrowserWindow.fromWebContents.mockReturnValue(null)
      expect(() => findListener('close-window')(createMockEvent(null))).not.toThrow()
    })
  })

  describe('minimize-window', () => {
    it('应最小化窗口', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)
      findListener('minimize-window')(createMockEvent(win))
      expect(win.minimize).toHaveBeenCalledTimes(1)
    })

    it('win 为 null 时不应报错', () => {
      BrowserWindow.fromWebContents.mockReturnValue(null)
      expect(() => findListener('minimize-window')(createMockEvent(null))).not.toThrow()
    })
  })

  describe('show-notification', () => {
    it('应创建并显示通知', () => {
      findListener('show-notification')({}, { title: '提醒', body: '时间到' })
      expect(Notification).toHaveBeenCalledTimes(1)
      const opts = Notification.mock.calls[0][0]
      expect(opts.title).toBe('提醒')
      expect(opts.body).toBe('时间到')
    })

    it('无 title 时应使用默认值', () => {
      findListener('show-notification')({}, { body: 'test' })
      const opts = Notification.mock.calls[0][0]
      expect(opts.title).toBe('番茄钟')
    })

    it('无 body 时应使用空字符串', () => {
      findListener('show-notification')({}, { title: 'T' })
      const opts = Notification.mock.calls[0][0]
      expect(opts.body).toBe('')
    })
  })

  // ============ 窗口置顶 ============

  describe('set-always-on-top', () => {
    it('应设置窗口置顶并禁用最小化', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)
      findListener('set-always-on-top')(createMockEvent(win), true)
      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true)
      expect(win.setMinimizable).toHaveBeenCalledWith(false)
    })

    it('onTop=false 时应取消置顶并启用最小化', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)
      findListener('set-always-on-top')(createMockEvent(win), false)
      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(false)
      expect(win.setMinimizable).toHaveBeenCalledWith(true)
    })

    it('win 为 null 时不应报错', () => {
      BrowserWindow.fromWebContents.mockReturnValue(null)
      expect(() => findListener('set-always-on-top')(createMockEvent(null), true)).not.toThrow()
    })
  })

  describe('bring-to-front', () => {
    it('应将窗口置顶并聚焦', () => {
      const win = createMockWin()
      BrowserWindow.getAllWindows.mockReturnValue([win])
      findListener('bring-to-front')()
      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true)
      expect(win.focus).toHaveBeenCalledTimes(1)
      expect(win.moveTop).toHaveBeenCalledTimes(1)
    })

    it('窗口最小化时应先 restore', () => {
      const win = createMockWin()
      win.isMinimized.mockReturnValue(true)
      BrowserWindow.getAllWindows.mockReturnValue([win])
      findListener('bring-to-front')()
      expect(win.restore).toHaveBeenCalledTimes(1)
    })

    it('无窗口时不应报错', () => {
      BrowserWindow.getAllWindows.mockReturnValue([])
      expect(() => findListener('bring-to-front')()).not.toThrow()
    })

    it('应跳过已销毁的窗口', () => {
      const destroyedWin = createMockWin()
      destroyedWin.isDestroyed.mockReturnValue(true)
      const goodWin = createMockWin()
      BrowserWindow.getAllWindows.mockReturnValue([destroyedWin, goodWin])
      findListener('bring-to-front')()
      expect(goodWin.focus).toHaveBeenCalledTimes(1)
    })
  })

  describe('cancel-always-on-top', () => {
    it('应取消窗口置顶', () => {
      const win = createMockWin()
      BrowserWindow.getAllWindows.mockReturnValue([win])
      findListener('cancel-always-on-top')()
      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(false)
    })

    it('无窗口时不应报错', () => {
      BrowserWindow.getAllWindows.mockReturnValue([])
      expect(() => findListener('cancel-always-on-top')()).not.toThrow()
    })
  })

  // ============ 迷你模式 ============

  describe('enter-mini-mode', () => {
    it('应调整窗口尺寸并创建托盘', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)

      findListener('enter-mini-mode')(createMockEvent(win))

      expect(win.setSize).toHaveBeenCalledWith(180, 220)
      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true)
      expect(win.setMinimizable).toHaveBeenCalledWith(false)
      expect(win.setSkipTaskbar).toHaveBeenCalledWith(true)
      expect(state.tray).not.toBeNull()
      expect(state.normalModePosition).toEqual([100, 200])
    })

    it('应配置托盘 tooltip 和上下文菜单', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)

      findListener('enter-mini-mode')(createMockEvent(win))

      expect(state.tray.setToolTip).toHaveBeenCalledWith('番茄钟 - 迷你模式')
      expect(Menu.buildFromTemplate).toHaveBeenCalled()
      expect(state.tray.setContextMenu).toHaveBeenCalled()
    })

    it('上下文菜单应包含展开窗口和退出应用选项', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)

      findListener('enter-mini-mode')(createMockEvent(win))

      const template = Menu.buildFromTemplate.mock.calls[0][0]
      expect(template).toHaveLength(3)
      expect(template[0].label).toBe('展开窗口')
      expect(template[1].type).toBe('separator')
      expect(template[2].label).toBe('退出应用')
    })

    it('点击"展开窗口"菜单项应发送 exit-mini-mode-from-tray', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)

      findListener('enter-mini-mode')(createMockEvent(win))

      const template = Menu.buildFromTemplate.mock.calls[0][0]
      template[0].click()
      expect(win.webContents.send).toHaveBeenCalledWith('exit-mini-mode-from-tray')
    })

    it('点击"退出应用"菜单项应发送 quit-app-from-tray', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)

      findListener('enter-mini-mode')(createMockEvent(win))

      const template = Menu.buildFromTemplate.mock.calls[0][0]
      template[2].click()
      expect(win.webContents.send).toHaveBeenCalledWith('quit-app-from-tray')
    })

    it('托盘 click 事件应聚焦窗口', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)

      findListener('enter-mini-mode')(createMockEvent(win))

      const trayOnClick = state.tray.on.mock.calls.find(c => c[0] === 'click')
      expect(trayOnClick).toBeDefined()
      trayOnClick[1]()
      expect(win.focus).toHaveBeenCalledTimes(1)
    })

    it('托盘 click 事件窗口最小化时应先 restore', () => {
      const win = createMockWin()
      win.isMinimized.mockReturnValue(true)
      BrowserWindow.fromWebContents.mockReturnValue(win)

      findListener('enter-mini-mode')(createMockEvent(win))

      const trayOnClick = state.tray.on.mock.calls.find(c => c[0] === 'click')
      trayOnClick[1]()
      expect(win.restore).toHaveBeenCalledTimes(1)
      expect(win.focus).toHaveBeenCalledTimes(1)
    })

    it('已有托盘时不应创建新托盘', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)
      const existingTray = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() }
      state.tray = existingTray

      findListener('enter-mini-mode')(createMockEvent(win))

      expect(state.tray).toBe(existingTray)
      // 不应调用新托盘的 setToolTip
      expect(existingTray.setToolTip).not.toHaveBeenCalled()
    })

    it('有 miniModePosition 时应恢复位置', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)
      state.miniModePosition = [50, 60]

      findListener('enter-mini-mode')(createMockEvent(win))

      expect(win.setPosition).toHaveBeenCalledWith(50, 60)
    })

    it('win 为 null 时应直接返回', () => {
      BrowserWindow.fromWebContents.mockReturnValue(null)
      expect(() => findListener('enter-mini-mode')(createMockEvent(null))).not.toThrow()
    })
  })

  describe('exit-mini-mode', () => {
    it('应恢复窗口尺寸并销毁托盘', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(true)
      state.tray = { destroy: vi.fn() }

      findListener('exit-mini-mode')(createMockEvent(win))

      expect(win.setSize).toHaveBeenCalledWith(520, 560)
      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(false)
      expect(win.setMinimizable).toHaveBeenCalledWith(true)
      expect(win.setSkipTaskbar).toHaveBeenCalledWith(false)
      expect(state.tray).toBeNull()
    })

    it('应保存迷你模式位置', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(true)

      findListener('exit-mini-mode')(createMockEvent(win))

      expect(mockDataManager.writeData).toHaveBeenCalled()
      expect(state.miniModePosition).toEqual([100, 200])
    })

    it('有 normalModePosition 时应恢复位置', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(true)
      state.normalModePosition = [200, 300]

      findListener('exit-mini-mode')(createMockEvent(win))

      expect(win.setPosition).toHaveBeenCalledWith(200, 300)
    })

    it('无托盘时不应报错', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(true)
      state.tray = null

      expect(() => findListener('exit-mini-mode')(createMockEvent(win))).not.toThrow()
    })

    it('win 为 null 时应直接返回', () => {
      BrowserWindow.fromWebContents.mockReturnValue(null)
      expect(() => findListener('exit-mini-mode')(createMockEvent(null))).not.toThrow()
    })
  })

  describe('update-mini-position', () => {
    it('应保存当前位置到 state 和 dataManager', () => {
      const win = createMockWin()
      BrowserWindow.fromWebContents.mockReturnValue(win)
      mockDataManager.readData.mockReturnValue({})
      mockDataManager.writeData.mockReturnValue(true)

      findListener('update-mini-position')(createMockEvent(win))

      expect(state.miniModePosition).toEqual([100, 200])
      expect(mockDataManager.writeData).toHaveBeenCalled()
    })

    it('win 为 null 时不应报错', () => {
      BrowserWindow.fromWebContents.mockReturnValue(null)
      expect(() => findListener('update-mini-position')(createMockEvent(null))).not.toThrow()
    })
  })

  // ============ loadMiniModePosition ============

  describe('loadMiniModePosition', () => {
    it('有 miniModePosition 时应加载到 state', () => {
      mockDataManager.readData.mockReturnValue({ miniModePosition: [30, 40] })
      loadMiniModePosition()
      expect(state.miniModePosition).toEqual([30, 40])
    })

    it('无 miniModePosition 时不应修改 state', () => {
      state.miniModePosition = null
      mockDataManager.readData.mockReturnValue({})
      loadMiniModePosition()
      expect(state.miniModePosition).toBeNull()
    })
  })
})
