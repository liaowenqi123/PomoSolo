/**
 * main/auto-update.js 测试
 *
 * 测试 init/checkForUpdates/downloadUpdate/quitAndInstall。
 * 验证事件处理器向渲染进程发送正确的状态。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
const path = require('path')

// Mock userData-backup
const mockBackupUserData = vi.hoisted(() => {
  const fn = vi.fn()
  const m = { backupUserData: fn }
  if (global.__registerRequireMock) global.__registerRequireMock('main/userData-backup', m)
  return fn
})
vi.mock('../../main/userData-backup', () => ({ backupUserData: mockBackupUserData }))

const { autoUpdater } = require('electron-updater')
const { app } = require('electron')
const { init, checkForUpdates, downloadUpdate, quitAndInstall } = require('../../main/auto-update')

// 辅助：创建模拟主窗口
function createMockWindow(destroyed = false) {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn().mockReturnValue(destroyed)
  }
}

// 辅助：从 autoUpdater.on 调用中查找指定事件的回调
function findHandler(event) {
  const call = autoUpdater.on.mock.calls.find(c => c[0] === event)
  return call ? call[1] : undefined
}

describe('main/auto-update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    app.isPackaged = false
    // 保存和恢复 process.resourcesPath
    this._origResourcesPath = process.resourcesPath
  })

  // ============ init ============

  describe('init', () => {
    it('应注册 6 个事件监听器', () => {
      const win = createMockWindow()
      init(win)
      expect(autoUpdater.on).toHaveBeenCalledTimes(6)
      const events = autoUpdater.on.mock.calls.map(c => c[0])
      expect(events).toContain('checking-for-update')
      expect(events).toContain('update-available')
      expect(events).toContain('update-not-available')
      expect(events).toContain('error')
      expect(events).toContain('download-progress')
      expect(events).toContain('update-downloaded')
    })

    it('checking-for-update 事件应发送 checking 状态', () => {
      const win = createMockWindow()
      init(win)
      const handler = findHandler('checking-for-update')
      handler()
      expect(win.webContents.send).toHaveBeenCalledWith('update-status', { status: 'checking' })
    })

    it('update-available 事件应发送 available 状态和版本信息', () => {
      const win = createMockWindow()
      init(win)
      const handler = findHandler('update-available')
      handler({ version: '3.3.0', releaseDate: '2026-01-01' })
      expect(win.webContents.send).toHaveBeenCalledWith('update-status', {
        status: 'available',
        version: '3.3.0',
        releaseDate: '2026-01-01'
      })
    })

    it('update-not-available 事件应发送 not-available 状态', () => {
      const win = createMockWindow()
      init(win)
      const handler = findHandler('update-not-available')
      handler({ version: '3.2.4' })
      expect(win.webContents.send).toHaveBeenCalledWith('update-status', {
        status: 'not-available',
        version: '3.2.4'
      })
    })

    it('update-not-available 事件 info 为 null 时不应报错', () => {
      const win = createMockWindow()
      init(win)
      const handler = findHandler('update-not-available')
      expect(() => handler(null)).not.toThrow()
      expect(win.webContents.send).toHaveBeenCalledWith('update-status', {
        status: 'not-available',
        version: undefined
      })
    })

    it('error 事件应发送 error 状态和错误消息', () => {
      const win = createMockWindow()
      init(win)
      const handler = findHandler('error')
      handler(new Error('network failed'))
      expect(win.webContents.send).toHaveBeenCalledWith('update-status', {
        status: 'error',
        message: 'network failed'
      })
    })

    it('download-progress 事件应发送 downloading 状态和进度', () => {
      const win = createMockWindow()
      init(win)
      const handler = findHandler('download-progress')
      handler({ percent: 45.5, bytesPerSecond: 1000, transferred: 500, total: 1000 })
      expect(win.webContents.send).toHaveBeenCalledWith('update-status', {
        status: 'downloading',
        percent: 46, // Math.round(45.5)
        bytesPerSecond: 1000,
        transferred: 500,
        total: 1000
      })
    })

    it('update-downloaded 事件应备份用户数据并发送 downloaded 状态', () => {
      const origResourcesPath = process.resourcesPath
      process.resourcesPath = 'C:\\resources'
      const win = createMockWindow()
      init(win)
      const handler = findHandler('update-downloaded')
      handler({ version: '3.3.0' })

      expect(mockBackupUserData).toHaveBeenCalledWith(path.join('C:\\resources'))
      expect(win.webContents.send).toHaveBeenCalledWith('update-status', {
        status: 'downloaded',
        version: '3.3.0'
      })
      process.resourcesPath = origResourcesPath
    })

    it('update-downloaded 事件备份失败时不应抛出异常', () => {
      const origResourcesPath = process.resourcesPath
      delete process.resourcesPath
      const win = createMockWindow()
      init(win)
      const handler = findHandler('update-downloaded')
      expect(() => handler({ version: '3.3.0' })).not.toThrow()
      expect(win.webContents.send).toHaveBeenCalledWith('update-status', {
        status: 'downloaded',
        version: '3.3.0'
      })
      process.resourcesPath = origResourcesPath
    })

    it('allowPrerelease 应在模块加载时被设为 false', () => {
      // 模块加载时执行了 autoUpdater.allowPrerelease = false
      expect(autoUpdater.allowPrerelease).toBe(false)
    })
  })

  // ============ sendToRenderer (通过事件处理器间接测试) ============

  describe('sendToRenderer', () => {
    it('窗口已销毁时不应发送消息', () => {
      const win = createMockWindow(true) // destroyed = true
      init(win)
      const handler = findHandler('checking-for-update')
      handler()
      expect(win.webContents.send).not.toHaveBeenCalled()
    })

    it('窗口为 null 时不应发送消息', () => {
      init(null)
      const handler = findHandler('checking-for-update')
      expect(() => handler()).not.toThrow()
    })
  })

  // ============ checkForUpdates ============

  describe('checkForUpdates', () => {
    it('dev 模式应发送 not-available 状态并不调用 autoUpdater.checkForUpdates', () => {
      app.isPackaged = false
      const win = createMockWindow()
      init(win)
      vi.clearAllMocks()

      checkForUpdates()

      expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
      expect(win.webContents.send).toHaveBeenCalledWith('update-status', {
        status: 'not-available',
        version: app.getVersion()
      })
    })

    it('打包模式应调用 autoUpdater.checkForUpdates', () => {
      app.isPackaged = true
      const win = createMockWindow()
      init(win)
      vi.clearAllMocks()

      checkForUpdates()

      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    })
  })

  // ============ downloadUpdate ============

  describe('downloadUpdate', () => {
    it('应调用 autoUpdater.downloadUpdate', () => {
      downloadUpdate()
      expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    })
  })

  // ============ quitAndInstall ============

  describe('quitAndInstall', () => {
    it('应调用 autoUpdater.quitAndInstall', () => {
      quitAndInstall()
      expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
    })
  })
})
