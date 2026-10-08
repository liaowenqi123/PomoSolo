/**
 * main/ipc-update.js 测试
 *
 * 测试 check-for-updates/download-update/install-update 处理器
 * 是否正确委托给 auto-update 模块。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

// Mock auto-update module
const mockAutoUpdate = vi.hoisted(() => {
  const m = {
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn()
  }
  if (global.__registerRequireMock) global.__registerRequireMock('main/auto-update', m)
  return m
})
vi.mock('../../main/auto-update', () => mockAutoUpdate)

const ipcMain = __electronMock.ipcMain
const { register } = require('../../main/ipc-update')

function findHandler(channel) {
  const call = ipcMain.handle.mock.calls.find(c => c[0] === channel)
  return call ? call[1] : undefined
}

describe('main/ipc-update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    register(ipcMain)
  })

  it('应注册 3 个 handle 处理器', () => {
    expect(ipcMain.handle).toHaveBeenCalledTimes(3)
    const channels = ipcMain.handle.mock.calls.map(c => c[0])
    expect(channels).toContain('check-for-updates')
    expect(channels).toContain('download-update')
    expect(channels).toContain('install-update')
  })

  describe('check-for-updates', () => {
    it('应调用 autoUpdate.checkForUpdates 并返回 { success: true }', async () => {
      const handler = findHandler('check-for-updates')
      const result = await handler({})
      expect(mockAutoUpdate.checkForUpdates).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ success: true })
    })
  })

  describe('download-update', () => {
    it('应调用 autoUpdate.downloadUpdate 并返回 { success: true }', async () => {
      const handler = findHandler('download-update')
      const result = await handler({})
      expect(mockAutoUpdate.downloadUpdate).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ success: true })
    })
  })

  describe('install-update', () => {
    it('应调用 autoUpdate.quitAndInstall 并返回 { success: true }', async () => {
      const handler = findHandler('install-update')
      const result = await handler({})
      expect(mockAutoUpdate.quitAndInstall).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ success: true })
    })
  })
})
