/**
 * main/ipc-foreground.js 测试
 *
 * 测试前台检测的 ipcMain.on（非 handle）处理器。
 * foreground-is-ready 是 handle，其余是 on。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

// Mock foregroundInspection
const mockForegroundInspection = vi.hoisted(() => {
  const m = {
    startDetection: vi.fn(),
    stopDetection: vi.fn(),
    getStatus: vi.fn(),
    setApiKey: vi.fn(),
    addWhitelist: vi.fn(),
    addBlacklist: vi.fn(),
    markHistoryNot: vi.fn(),
    moveBlacklistToWhitelist: vi.fn()
  }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/foregroundInspection', m)
  return m
})
vi.mock('../../src/modules/foregroundInspection', () => mockForegroundInspection)

const state = require('../../main/state')
const ipcMain = __electronMock.ipcMain
const { register } = require('../../main/ipc-foreground')

function findHandler(channel) {
  const call = ipcMain.handle.mock.calls.find(c => c[0] === channel)
  return call ? call[1] : undefined
}

function findListener(channel) {
  const call = ipcMain.on.mock.calls.find(c => c[0] === channel)
  return call ? call[1] : undefined
}

describe('main/ipc-foreground', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.foregroundInspectionReady = false
    register(ipcMain)
  })

  it('应注册 1 个 handle 和 8 个 on 处理器', () => {
    expect(ipcMain.handle).toHaveBeenCalledTimes(1)
    expect(ipcMain.on).toHaveBeenCalledTimes(8)
    const handleChannels = ipcMain.handle.mock.calls.map(c => c[0])
    expect(handleChannels).toContain('foreground-is-ready')
    const onChannels = ipcMain.on.mock.calls.map(c => c[0])
    expect(onChannels).toContain('foreground-start')
    expect(onChannels).toContain('foreground-stop')
    expect(onChannels).toContain('foreground-get-status')
    expect(onChannels).toContain('foreground-set-api-key')
    expect(onChannels).toContain('foreground-add-whitelist')
    expect(onChannels).toContain('foreground-add-blacklist')
    expect(onChannels).toContain('foreground-mark-history-not')
    expect(onChannels).toContain('foreground-move-blacklist-to-whitelist')
  })

  describe('foreground-is-ready', () => {
    it('应返回 state.foregroundInspectionReady', async () => {
      const handler = findHandler('foreground-is-ready')
      let result = await handler({})
      expect(result).toBe(false)

      state.foregroundInspectionReady = true
      result = await handler({})
      expect(result).toBe(true)
    })
  })

  describe('foreground-start', () => {
    it('应调用 foregroundInspection.startDetection', () => {
      const listener = findListener('foreground-start')
      listener()
      expect(mockForegroundInspection.startDetection).toHaveBeenCalledTimes(1)
    })
  })

  describe('foreground-stop', () => {
    it('应调用 foregroundInspection.stopDetection', () => {
      const listener = findListener('foreground-stop')
      listener()
      expect(mockForegroundInspection.stopDetection).toHaveBeenCalledTimes(1)
    })
  })

  describe('foreground-get-status', () => {
    it('应调用 foregroundInspection.getStatus', () => {
      const listener = findListener('foreground-get-status')
      listener()
      expect(mockForegroundInspection.getStatus).toHaveBeenCalledTimes(1)
    })
  })

  describe('foreground-set-api-key', () => {
    it('应调用 foregroundInspection.setApiKey 并传入 apiKey', () => {
      const listener = findListener('foreground-set-api-key')
      listener({}, 'sk-test-123')
      expect(mockForegroundInspection.setApiKey).toHaveBeenCalledWith('sk-test-123')
    })
  })

  describe('foreground-add-whitelist', () => {
    it('应调用 foregroundInspection.addWhitelist 并传入 keyword', () => {
      const listener = findListener('foreground-add-whitelist')
      listener({}, 'notepad')
      expect(mockForegroundInspection.addWhitelist).toHaveBeenCalledWith('notepad')
    })
  })

  describe('foreground-add-blacklist', () => {
    it('应调用 foregroundInspection.addBlacklist 并传入 keyword', () => {
      const listener = findListener('foreground-add-blacklist')
      listener({}, 'game')
      expect(mockForegroundInspection.addBlacklist).toHaveBeenCalledWith('game')
    })
  })

  describe('foreground-mark-history-not', () => {
    it('应调用 foregroundInspection.markHistoryNot 并传入 windowTitle', () => {
      const listener = findListener('foreground-mark-history-not')
      listener({}, '某窗口标题')
      expect(mockForegroundInspection.markHistoryNot).toHaveBeenCalledWith('某窗口标题')
    })
  })

  describe('foreground-move-blacklist-to-whitelist', () => {
    it('应调用 foregroundInspection.moveBlacklistToWhitelist', () => {
      const listener = findListener('foreground-move-blacklist-to-whitelist')
      listener({}, 'keyword')
      expect(mockForegroundInspection.moveBlacklistToWhitelist).toHaveBeenCalledWith('keyword')
    })
  })
})
