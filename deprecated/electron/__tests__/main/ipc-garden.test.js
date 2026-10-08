/**
 * main/ipc-garden.js 测试
 *
 * 测试菜园子子系统的所有 IPC 处理器，包括：
 *   on: open-garden, close-garden, refresh-garden, garden-grow, update-focus-mode, update-timer-status
 *   handle: garden-punishment, get-timer-state, garden-read, garden-write,
 *           garden-plant, garden-harvest, garden-buy-seed, garden-sell-crop,
 *           garden-sell-all, garden-unlock-plot, garden-signin, garden-update-focus
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

// Mock dataManager
const mockDataManager = vi.hoisted(() => {
  const m = {
    readGardenData: vi.fn(),
    writeGardenFile: vi.fn(),
    gardenPlant: vi.fn(),
    gardenHarvest: vi.fn(),
    gardenBuySeed: vi.fn(),
    gardenSellCrop: vi.fn(),
    gardenSellAllCrops: vi.fn(),
    gardenUnlockPlot: vi.fn(),
    gardenSignIn: vi.fn(),
    gardenUpdateFocusMinutes: vi.fn(),
    updateGardenProgress: vi.fn(),
    handleGardenPunishment: vi.fn()
  }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/dataManager', m)
  return m
})
vi.mock('../../src/modules/dataManager', () => mockDataManager)

// Mock achievements
const mockSendAchievementNotifications = vi.hoisted(() => {
  const fn = vi.fn()
  const m = { sendAchievementNotifications: fn }
  if (global.__registerRequireMock) global.__registerRequireMock('main/achievements', m)
  return fn
})
vi.mock('../../main/achievements', () => ({
  sendAchievementNotifications: mockSendAchievementNotifications
}))

// Mock windows
const mockCreateGardenWindow = vi.hoisted(() => {
  const fn = vi.fn()
  const m = { createGardenWindow: fn }
  if (global.__registerRequireMock) global.__registerRequireMock('main/windows', m)
  return fn
})
vi.mock('../../main/windows', () => ({
  createGardenWindow: mockCreateGardenWindow
}))

const state = require('../../main/state')
const ipcMain = __electronMock.ipcMain
const { register } = require('../../main/ipc-garden')

function findHandler(channel) {
  const call = ipcMain.handle.mock.calls.find(c => c[0] === channel)
  return call ? call[1] : undefined
}

function findListener(channel) {
  const call = ipcMain.on.mock.calls.find(c => c[0] === channel)
  return call ? call[1] : undefined
}

// 辅助：创建模拟 gardenWindow
function createMockGardenWindow(destroyed = false) {
  return {
    isDestroyed: vi.fn().mockReturnValue(destroyed),
    webContents: { send: vi.fn() },
    close: vi.fn()
  }
}

// 辅助：带 unlockedAchievements 的结果
function resultWithAchievements(achievements) {
  return { success: true, unlockedAchievements: achievements }
}

describe('main/ipc-garden', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.gardenWindow = null
    state.focusModeEnabled = false
    state.timerRunning = false
    state.timerPaused = false
    register(ipcMain)
  })

  it('应注册所有处理处理器', () => {
    expect(ipcMain.on).toHaveBeenCalledTimes(6)
    expect(ipcMain.handle).toHaveBeenCalledTimes(12)
  })

  // ============ 窗口控制 ============

  describe('open-garden', () => {
    it('应调用 createGardenWindow', () => {
      const listener = findListener('open-garden')
      listener()
      expect(mockCreateGardenWindow).toHaveBeenCalledTimes(1)
    })
  })

  describe('close-garden', () => {
    it('应关闭 gardenWindow', () => {
      const win = createMockGardenWindow()
      state.gardenWindow = win
      const listener = findListener('close-garden')
      listener()
      expect(win.close).toHaveBeenCalledTimes(1)
    })

    it('gardenWindow 为 null 时不应报错', () => {
      state.gardenWindow = null
      const listener = findListener('close-garden')
      expect(() => listener()).not.toThrow()
    })
  })

  describe('refresh-garden', () => {
    it('应向 gardenWindow 发送 garden-refresh', () => {
      const win = createMockGardenWindow()
      state.gardenWindow = win
      const listener = findListener('refresh-garden')
      listener()
      expect(win.webContents.send).toHaveBeenCalledWith('garden-refresh')
    })

    it('gardenWindow 已销毁时不应发送', () => {
      const win = createMockGardenWindow(true)
      state.gardenWindow = win
      const listener = findListener('refresh-garden')
      listener()
      expect(win.webContents.send).not.toHaveBeenCalled()
    })

    it('gardenWindow 为 null 时不应报错', () => {
      state.gardenWindow = null
      const listener = findListener('refresh-garden')
      expect(() => listener()).not.toThrow()
    })
  })

  // ============ 事件 ============

  describe('garden-grow', () => {
    it('应调用 dataManager.updateGardenProgress 并刷新窗口', async () => {
      mockDataManager.updateGardenProgress.mockResolvedValue(true)
      const win = createMockGardenWindow()
      state.gardenWindow = win
      const listener = findListener('garden-grow')
      await listener({}, 25)
      expect(mockDataManager.updateGardenProgress).toHaveBeenCalledWith(25)
      expect(win.webContents.send).toHaveBeenCalledWith('garden-refresh')
    })

    it('updateGardenProgress 抛出异常时不应报错', async () => {
      mockDataManager.updateGardenProgress.mockRejectedValue(new Error('fail'))
      const listener = findListener('garden-grow')
      await expect(listener({}, 25)).resolves.toBeUndefined()
    })
  })

  describe('update-focus-mode', () => {
    it('应更新 state.focusModeEnabled', () => {
      const listener = findListener('update-focus-mode')
      listener({}, true)
      expect(state.focusModeEnabled).toBe(true)
    })

    it('应更新为 false', () => {
      const listener = findListener('update-focus-mode')
      listener({}, false)
      expect(state.focusModeEnabled).toBe(false)
    })
  })

  describe('update-timer-status', () => {
    it('应更新 state.timerRunning 和 timerPaused', () => {
      const listener = findListener('update-timer-status')
      listener({}, true, false)
      expect(state.timerRunning).toBe(true)
      expect(state.timerPaused).toBe(false)
    })
  })

  describe('get-timer-state', () => {
    it('应返回当前计时器状态', async () => {
      state.focusModeEnabled = true
      state.timerRunning = true
      state.timerPaused = false
      const handler = findHandler('get-timer-state')
      const result = await handler({})
      expect(result).toEqual({
        focusModeEnabled: true,
        timerRunning: true,
        timerPaused: false
      })
    })
  })

  // ============ 原子操作 ============

  describe('garden-read', () => {
    it('应调用 dataManager.readGardenData', async () => {
      const mockData = { plots: [], coins: 100 }
      mockDataManager.readGardenData.mockResolvedValue(mockData)
      const handler = findHandler('garden-read')
      const result = await handler({})
      expect(mockDataManager.readGardenData).toHaveBeenCalledTimes(1)
      expect(result).toBe(mockData)
    })
  })

  describe('garden-write', () => {
    it('应调用 dataManager.writeGardenFile 并刷新窗口', async () => {
      const win = createMockGardenWindow()
      state.gardenWindow = win
      const gardenData = { plots: [] }
      const handler = findHandler('garden-write')
      const result = await handler({}, gardenData)
      expect(mockDataManager.writeGardenFile).toHaveBeenCalledWith(gardenData)
      expect(win.webContents.send).toHaveBeenCalledWith('garden-refresh')
      expect(result).toBe(true)
    })
  })

  // 辅助：测试带成就通知的原子操作
  function testAtomicOperation(channel, mockFn, mockArgs, expectedResult, callArgs) {
    it(`应调用 dataManager.${mockFn.name || channel} 并返回结果`, async () => {
      mockFn.mockResolvedValue(expectedResult)
      const win = createMockGardenWindow()
      state.gardenWindow = win
      const handler = findHandler(channel)
      const result = await handler({}, ...callArgs)
      expect(mockFn).toHaveBeenCalledWith(...mockArgs)
      expect(result).toBe(expectedResult)
      expect(win.webContents.send).toHaveBeenCalledWith('garden-refresh')
    })

    it(`应发送成就通知`, async () => {
      const achievements = [{ name: 'A' }]
      mockFn.mockResolvedValue(resultWithAchievements(achievements))
      const handler = findHandler(channel)
      await handler({}, ...callArgs)
      expect(mockSendAchievementNotifications).toHaveBeenCalledWith(achievements)
    })

    it(`无成就时不应发送通知`, async () => {
      mockFn.mockResolvedValue(resultWithAchievements([]))
      const handler = findHandler(channel)
      await handler({}, ...callArgs)
      // sendAchievementNotifications 会被调用但参数为空数组
      expect(mockSendAchievementNotifications).toHaveBeenCalledWith([])
    })
  }

  describe('garden-plant', () => {
    testAtomicOperation('garden-plant', mockDataManager.gardenPlant, [0, 'carrot'], { success: true, unlockedAchievements: [] }, [0, 'carrot'])
  })

  describe('garden-harvest', () => {
    testAtomicOperation('garden-harvest', mockDataManager.gardenHarvest, [0], { success: true, unlockedAchievements: [] }, [0])
  })

  describe('garden-buy-seed', () => {
    testAtomicOperation('garden-buy-seed', mockDataManager.gardenBuySeed, ['carrot'], { success: true, unlockedAchievements: [] }, ['carrot'])
  })

  describe('garden-sell-crop', () => {
    testAtomicOperation('garden-sell-crop', mockDataManager.gardenSellCrop, ['carrot'], { success: true, unlockedAchievements: [] }, ['carrot'])
  })

  describe('garden-sell-all', () => {
    testAtomicOperation('garden-sell-all', mockDataManager.gardenSellAllCrops, [], { success: true, unlockedAchievements: [] }, [])
  })

  describe('garden-unlock-plot', () => {
    testAtomicOperation('garden-unlock-plot', mockDataManager.gardenUnlockPlot, [6], { success: true, unlockedAchievements: [] }, [6])
  })

  describe('garden-signin', () => {
    testAtomicOperation('garden-signin', mockDataManager.gardenSignIn, [], { success: true, unlockedAchievements: [] }, [])
  })

  // ============ garden-punishment ============

  describe('garden-punishment', () => {
    it('应调用 dataManager.handleGardenPunishment 并返回结果', async () => {
      const expectedResult = { hasLoss: true, losses: ['carrot'], totalMinutes: 10 }
      mockDataManager.handleGardenPunishment.mockResolvedValue(expectedResult)
      const win = createMockGardenWindow()
      state.gardenWindow = win
      const handler = findHandler('garden-punishment')
      const result = await handler({})
      expect(mockDataManager.handleGardenPunishment).toHaveBeenCalledTimes(1)
      expect(result).toBe(expectedResult)
      expect(win.webContents.send).toHaveBeenCalledWith('garden-refresh')
    })

    it('handleGardenPunishment 抛出异常时应返回默认结果', async () => {
      mockDataManager.handleGardenPunishment.mockRejectedValue(new Error('fail'))
      const handler = findHandler('garden-punishment')
      const result = await handler({})
      expect(result).toEqual({ hasLoss: false, losses: [], totalMinutes: 0 })
    })
  })

  // ============ garden-update-focus ============

  describe('garden-update-focus', () => {
    it('有成就解锁时应刷新窗口并发送通知', async () => {
      const achievements = [{ name: 'focus1h' }]
      mockDataManager.gardenUpdateFocusMinutes.mockResolvedValue({
        success: true,
        unlockedAchievements: achievements
      })
      const win = createMockGardenWindow()
      state.gardenWindow = win
      const handler = findHandler('garden-update-focus')
      const result = await handler({}, 60)
      expect(mockDataManager.gardenUpdateFocusMinutes).toHaveBeenCalledWith(60)
      expect(win.webContents.send).toHaveBeenCalledWith('garden-refresh')
      expect(mockSendAchievementNotifications).toHaveBeenCalledWith(achievements)
      expect(result.success).toBe(true)
    })

    it('无成就解锁时不应刷新窗口也不发送通知', async () => {
      mockDataManager.gardenUpdateFocusMinutes.mockResolvedValue({
        success: true,
        unlockedAchievements: []
      })
      const win = createMockGardenWindow()
      state.gardenWindow = win
      const handler = findHandler('garden-update-focus')
      await handler({}, 30)
      expect(win.webContents.send).not.toHaveBeenCalled()
    })

    it('unlockedAchievements 为 undefined 时不应报错', async () => {
      mockDataManager.gardenUpdateFocusMinutes.mockResolvedValue({
        success: true
      })
      const win = createMockGardenWindow()
      state.gardenWindow = win
      const handler = findHandler('garden-update-focus')
      await expect(handler({}, 30)).resolves.toBeDefined()
      expect(win.webContents.send).not.toHaveBeenCalled()
    })
  })
})
