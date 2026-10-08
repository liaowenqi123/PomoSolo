/**
 * main/windows.js 测试
 *
 * 测试 showInstanceExistsDialog 和 createGardenWindow。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
const { BrowserWindow } = require('electron')
const state = require('../../main/state')
const { showInstanceExistsDialog, createGardenWindow } = require('../../main/windows')

describe('main/windows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.mainWindow = null
    state.gardenWindow = null
  })

  // ============ showInstanceExistsDialog ============

  describe('showInstanceExistsDialog', () => {
    it('应创建一个新的 BrowserWindow', () => {
      showInstanceExistsDialog()
      expect(BrowserWindow).toHaveBeenCalledTimes(1)
    })

    it('窗口应有正确的尺寸和属性', () => {
      showInstanceExistsDialog()
      const opts = BrowserWindow.mock.calls[0][0]
      expect(opts.width).toBe(360)
      expect(opts.height).toBe(180)
      expect(opts.frame).toBe(false)
      expect(opts.transparent).toBe(true)
      expect(opts.resizable).toBe(false)
      expect(opts.alwaysOnTop).toBe(true)
      expect(opts.skipTaskbar).toBe(true)
      expect(opts.modal).toBe(true)
    })

    it('应调用 loadURL 加载 HTML 内容', () => {
      showInstanceExistsDialog()
      const win = BrowserWindow.mock.results[0].value
      expect(win.loadURL).toHaveBeenCalledTimes(1)
      const url = win.loadURL.mock.calls[0][0]
      expect(url).toContain('data:text/html')
      // 内容应经过 encodeURIComponent 编码（包含百分号编码字符）
      expect(url).toContain('%20')
    })

    it('mainWindow 存在且最小化时应先 restore 再 focus', () => {
      const mockMain = {
        isMinimized: vi.fn().mockReturnValue(true),
        restore: vi.fn(),
        focus: vi.fn()
      }
      state.mainWindow = mockMain

      showInstanceExistsDialog()

      expect(mockMain.isMinimized).toHaveBeenCalled()
      expect(mockMain.restore).toHaveBeenCalled()
      expect(mockMain.focus).toHaveBeenCalled()
    })

    it('mainWindow 存在但未最小化时只 focus 不 restore', () => {
      const mockMain = {
        isMinimized: vi.fn().mockReturnValue(false),
        restore: vi.fn(),
        focus: vi.fn()
      }
      state.mainWindow = mockMain

      showInstanceExistsDialog()

      expect(mockMain.isMinimized).toHaveBeenCalled()
      expect(mockMain.restore).not.toHaveBeenCalled()
      expect(mockMain.focus).toHaveBeenCalled()
    })

    it('mainWindow 为 null 时不应报错', () => {
      state.mainWindow = null
      expect(() => showInstanceExistsDialog()).not.toThrow()
    })

    it('HTML 内容应包含警告文本', () => {
      showInstanceExistsDialog()
      const url = BrowserWindow.mock.results[0].value.loadURL.mock.calls[0][0]
      const decoded = decodeURIComponent(url.replace('data:text/html;charset=utf-8,', ''))
      expect(decoded).toContain('同一路径下只能启动一个实例')
      expect(decoded).toContain('🍅')
    })
  })

  // ============ createGardenWindow ============

  describe('createGardenWindow', () => {
    it('应创建一个新的 BrowserWindow 并赋值给 state.gardenWindow', () => {
      createGardenWindow()
      expect(BrowserWindow).toHaveBeenCalledTimes(1)
      expect(state.gardenWindow).toBeDefined()
      expect(state.gardenWindow).not.toBeNull()
    })

    it('窗口应有正确的尺寸和属性', () => {
      createGardenWindow()
      const opts = BrowserWindow.mock.calls[0][0]
      expect(opts.width).toBe(400)
      expect(opts.height).toBe(520)
      expect(opts.frame).toBe(false)
      expect(opts.transparent).toBe(true)
      expect(opts.resizable).toBe(false)
      expect(opts.icon).toBeDefined()
    })

    it('应调用 loadFile 加载 garden.html', () => {
      createGardenWindow()
      const win = state.gardenWindow
      expect(win.loadFile).toHaveBeenCalledTimes(1)
      const filePath = win.loadFile.mock.calls[0][0]
      expect(filePath).toContain('garden.html')
    })

    it('已存在 gardenWindow 时应 focus 而不创建新窗口', () => {
      const existingWin = {
        focus: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false)
      }
      state.gardenWindow = existingWin

      createGardenWindow()

      expect(existingWin.focus).toHaveBeenCalled()
      expect(BrowserWindow).not.toHaveBeenCalled()
    })

    it('closed 事件应将 state.gardenWindow 置为 null', () => {
      createGardenWindow()
      const win = state.gardenWindow

      // 找到 'closed' 事件回调并触发
      const closedCall = win.on.mock.calls.find(c => c[0] === 'closed')
      expect(closedCall).toBeDefined()
      closedCall[1]()

      expect(state.gardenWindow).toBeNull()
    })
  })
})
