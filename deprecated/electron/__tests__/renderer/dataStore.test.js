/**
 * DataStore 模块测试
 *
 * 注意：
 * 1. dataStore.js 的 cachedData / cachedSettings 在 IIFE 闭包中持久化，无法直接重置。
 *    每个测试通过调用 load() 来重置 cachedData 为 defaultData（readData 返回 null 时）。
 * 2. dataStore.js 在运行时引用全局 Utils（getSettings/getGarden/getAchievements 的 fallback 路径）。
 *    setup.js 会在每个测试间删除 window.Utils，因此这里在 beforeAll 捕获 Utils 引用，
 *    在 beforeEach 中恢复。
 * 3. cachedSettings 一旦设置就无法重置。settings 测试组中需要 cachedSettings=null 的测试
 *    必须排在其他 settings 测试之前（Vitest 在 describe 内按定义顺序执行）。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let utilsRef

beforeAll(() => {
  // 先加载 utils（IIFE 挂载 window.Utils 并返回引用）
  require('../../src/scripts/modules/utils')
  utilsRef = window.Utils
  // 再加载 dataStore（IIFE 使用 Utils.createDefaultData() 创建 defaultData）
  require('../../src/scripts/modules/dataStore')
})

beforeEach(() => {
  // setup.js 删除了 window.Utils，这里恢复
  window.Utils = utilsRef

  // 重置 electronAPI（setup.js 删除了它）
  window.electronAPI = {
    readData: vi.fn().mockResolvedValue(null),
    writeData: vi.fn().mockResolvedValue(true),
    readSettings: vi.fn().mockResolvedValue(null),
    writeSettings: vi.fn().mockResolvedValue(true)
  }
})

describe('DataStore.load', () => {
  it('readData 返回 null 时应使用 defaultData', async () => {
    window.electronAPI.readData.mockResolvedValue(null)
    const data = await window.DataStore.load()
    expect(data).toBeDefined()
    expect(data.theme).toBe('light')
  })

  it('readData 返回数据时应使用该数据', async () => {
    window.electronAPI.readData.mockResolvedValue({
      stats: { todayCount: 5, totalMinutes: 100, date: new Date().toDateString() },
      presets: { work: [30] }
    })
    const data = await window.DataStore.load()
    expect(data.stats.todayCount).toBe(5)
    expect(data.presets.work).toEqual([30])
  })

  it('readData 返回 null 时不应抛出', async () => {
    window.electronAPI.readData.mockResolvedValue(null)
    await expect(window.DataStore.load()).resolves.toBeDefined()
  })

  it('非今日数据应重置 todayCount 为 0', async () => {
    window.electronAPI.readData.mockResolvedValue({
      stats: { date: 'Mon Jan 01 2020', todayCount: 99, totalMinutes: 500 }
    })
    const data = await window.DataStore.load()
    expect(data.stats.todayCount).toBe(0)
    expect(data.stats.date).toBe(new Date().toDateString())
  })

  it('今日数据应保留 todayCount', async () => {
    const today = new Date().toDateString()
    window.electronAPI.readData.mockResolvedValue({
      stats: { date: today, todayCount: 99, totalMinutes: 500 }
    })
    const data = await window.DataStore.load()
    expect(data.stats.todayCount).toBe(99)
  })

  it('非今日数据应触发立即保存', async () => {
    window.electronAPI.readData.mockResolvedValue({
      stats: { date: 'old', todayCount: 1, totalMinutes: 1 }
    })
    window.electronAPI.writeData.mockClear()
    await window.DataStore.load()
    // 等待防抖 save（300ms）
    await new Promise(r => setTimeout(r, 350))
    expect(window.electronAPI.writeData).toHaveBeenCalled()
  })

  it('readData 抛出错误时应回退到 defaultData', async () => {
    window.electronAPI.readData.mockRejectedValue(new Error('read fail'))
    const data = await window.DataStore.load()
    expect(data).toBeDefined()
    expect(data.theme).toBe('light')
  })
})

describe('DataStore.save / saveImmediate', () => {
  it('save 应使用防抖（300ms 后写入）', async () => {
    await window.DataStore.load()
    window.electronAPI.writeData.mockClear()
    const p = window.DataStore.save()
    await new Promise(r => setTimeout(r, 100))
    expect(window.electronAPI.writeData).not.toHaveBeenCalled()
    await new Promise(r => setTimeout(r, 250))
    expect(window.electronAPI.writeData).toHaveBeenCalled()
    await p
  })

  it('save 多次调用应去抖（只写入一次）', async () => {
    await window.DataStore.load()
    window.electronAPI.writeData.mockClear()
    window.DataStore.save()
    window.DataStore.save()
    window.DataStore.save()
    await new Promise(r => setTimeout(r, 350))
    expect(window.electronAPI.writeData).toHaveBeenCalledTimes(1)
  })

  it('saveImmediate 应立即写入（无防抖）', async () => {
    await window.DataStore.load()
    window.electronAPI.writeData.mockClear()
    await window.DataStore.saveImmediate()
    expect(window.electronAPI.writeData).toHaveBeenCalledTimes(1)
  })

  it('saveImmediate 应先 syncFromFile 再写入', async () => {
    await window.DataStore.load()
    window.electronAPI.readData.mockResolvedValue({
      garden: { coins: 999 },
      stats: { todayCount: 1 },
      presets: { work: [10] },
      planList: [{ x: 1 }]
    })
    window.electronAPI.writeData.mockClear()
    await window.DataStore.saveImmediate()
    expect(window.electronAPI.readData).toHaveBeenCalled()
    expect(window.electronAPI.writeData).toHaveBeenCalled()
  })

  it('saveImmediate writeData 抛出错误应返回 false', async () => {
    await window.DataStore.load()
    window.electronAPI.writeData.mockRejectedValue(new Error('write fail'))
    const result = await window.DataStore.saveImmediate()
    expect(result).toBe(false)
  })
})

describe('DataStore.getStats / updateStats', () => {
  it('getStats load 后返回默认 stats', async () => {
    await window.DataStore.load()
    const stats = window.DataStore.getStats()
    expect(stats).toBeDefined()
    expect(stats.todayCount).toBe(0)
  })

  it('updateStats 应合并 stats', async () => {
    await window.DataStore.load()
    const result = await window.DataStore.updateStats({ todayCount: 5, totalMinutes: 100 })
    expect(result).toBe(true)
    expect(window.DataStore.getStats().todayCount).toBe(5)
    expect(window.DataStore.getStats().totalMinutes).toBe(100)
  })

  it('updateStats 应合并保留未指定字段', async () => {
    await window.DataStore.load()
    await window.DataStore.updateStats({ todayCount: 3 })
    await window.DataStore.updateStats({ totalMinutes: 50 })
    expect(window.DataStore.getStats().todayCount).toBe(3)
    expect(window.DataStore.getStats().totalMinutes).toBe(50)
  })
})

describe('DataStore.getPresets / updatePresets', () => {
  it('getPresets 应返回默认值', async () => {
    await window.DataStore.load()
    const presets = window.DataStore.getPresets()
    expect(presets).toBeDefined()
    expect(presets.work).toBeDefined()
  })

  it('updatePresets 应合并 presets', async () => {
    await window.DataStore.load()
    await window.DataStore.updatePresets({ work: [99, 88] })
    expect(window.DataStore.getPresets().work).toEqual([99, 88])
  })
})

describe('DataStore.getData / getPlanList / updatePlanList', () => {
  it('getData 应返回数据', async () => {
    await window.DataStore.load()
    const data = window.DataStore.getData()
    expect(data).toBeDefined()
    expect(data.theme).toBe('light')
  })

  it('getPlanList load 后返回 planList', async () => {
    window.electronAPI.readData.mockResolvedValue({ planList: [{ id: 1 }], stats: { date: new Date().toDateString() } })
    await window.DataStore.load()
    expect(window.DataStore.getPlanList()).toEqual([{ id: 1 }])
  })

  it('getPlanList planList 未定义时返回空数组', async () => {
    window.electronAPI.readData.mockResolvedValue({ stats: { date: new Date().toDateString() } })
    await window.DataStore.load()
    expect(window.DataStore.getPlanList()).toEqual([])
  })

  it('updatePlanList 应更新 planList', async () => {
    await window.DataStore.load()
    const newPlan = [{ id: 1, minutes: 25 }]
    await window.DataStore.updatePlanList(newPlan)
    expect(window.DataStore.getPlanList()).toEqual(newPlan)
  })
})

describe('DataStore.getGarden / updateGarden', () => {
  it('getGarden 返回 garden 数据', async () => {
    // 使用 Utils.createDefaultData() 提供全新副本，避免 defaultData 被先前测试的
    // syncFromFile 合并污染（syncFromFile 会替换 cachedData.garden 引用）
    window.electronAPI.readData.mockResolvedValue(window.Utils.createDefaultData())
    await window.DataStore.load()
    const garden = window.DataStore.getGarden()
    expect(garden).toBeDefined()
    expect(garden.coins).toBe(0)
  })

  it('updateGarden 应合并 garden', async () => {
    await window.DataStore.load()
    await window.DataStore.updateGarden({ coins: 100 })
    expect(window.DataStore.getGarden().coins).toBe(100)
  })
})

describe('DataStore.getAchievements / updateAchievements / updateAchievementStats', () => {
  it('getAchievements 返回默认值', async () => {
    await window.DataStore.load()
    const a = window.DataStore.getAchievements()
    expect(a.achievements).toEqual({})
    expect(a.achievementStats).toBeDefined()
    expect(a.achievementStats.totalFocusMinutes).toBe(0)
  })

  it('updateAchievements 应更新 achievements 和 achievementStats', async () => {
    await window.DataStore.load()
    const ach = { test: { unlocked: true } }
    const stats = { totalFocusMinutes: 100 }
    await window.DataStore.updateAchievements(ach, stats)
    const result = window.DataStore.getAchievements()
    expect(result.achievements).toEqual(ach)
    expect(result.achievementStats.totalFocusMinutes).toBe(100)
  })

  it('updateAchievements 只传 achievements 应只更新 achievements', async () => {
    await window.DataStore.load()
    const originalStats = window.DataStore.getAchievements().achievementStats
    await window.DataStore.updateAchievements({ x: { unlocked: true } })
    expect(window.DataStore.getAchievements().achievementStats).toEqual(originalStats)
  })

  it('updateAchievements 只传 achievementStats 应只更新 achievementStats', async () => {
    await window.DataStore.load()
    const originalAch = window.DataStore.getAchievements().achievements
    await window.DataStore.updateAchievements(null, { totalFocusMinutes: 200 })
    expect(window.DataStore.getAchievements().achievements).toEqual(originalAch)
    expect(window.DataStore.getAchievements().achievementStats.totalFocusMinutes).toBe(200)
  })

  it('updateAchievementStats 应增量更新', async () => {
    await window.DataStore.load()
    await window.DataStore.updateAchievementStats({ totalFocusMinutes: 100 })
    await window.DataStore.updateAchievementStats({ totalHarvestCount: 5 })
    const result = window.DataStore.getAchievements().achievementStats
    expect(result.totalFocusMinutes).toBe(100)
    expect(result.totalHarvestCount).toBe(5)
  })
})

describe('DataStore.getSettings / updateSettings / initSettings', () => {
  // 注意：cachedSettings 一旦设置无法重置。
  // 以下需要 cachedSettings=null 的测试必须排在设置 cachedSettings 的测试之前。

  it('getSettings readSettings 返回 null 时应使用默认值', async () => {
    window.electronAPI.readSettings.mockResolvedValue(null)
    const settings = await window.DataStore.getSettings()
    expect(settings).toBeDefined()
    expect(settings.minimizeBehavior).toBe('mini')
  })

  it('getSettings 抛出错误时应返回默认值', async () => {
    window.electronAPI.readSettings.mockRejectedValue(new Error('fail'))
    const settings = await window.DataStore.getSettings()
    expect(settings).toBeDefined()
  })

  it('getSettings 缓存：第二次调用不再 readSettings', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ autoStart: true })
    await window.DataStore.getSettings()
    window.electronAPI.readSettings.mockClear()
    const settings = await window.DataStore.getSettings()
    expect(window.electronAPI.readSettings).not.toHaveBeenCalled()
    expect(settings.autoStart).toBe(true)
  })

  it('updateSettings 应合并设置并调用 writeSettings', async () => {
    await window.DataStore.getSettings()
    window.electronAPI.writeSettings.mockClear()
    await window.DataStore.updateSettings({ autoStart: true })
    expect(window.electronAPI.writeSettings).toHaveBeenCalled()
  })

  it('updateSettings writeSettings 抛出错误应返回 false', async () => {
    await window.DataStore.getSettings()
    window.electronAPI.writeSettings.mockRejectedValue(new Error('fail'))
    const result = await window.DataStore.updateSettings({ autoStart: true })
    expect(result).toBe(false)
  })

  it('initSettings 应初始化设置缓存', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ autoStart: true })
    const result = await window.DataStore.initSettings()
    expect(result).toBeDefined()
  })
})

describe('DataStore.getTheme / updateTheme', () => {
  it('getTheme load 后返回保存的主题', async () => {
    window.electronAPI.readData.mockResolvedValue({ theme: 'dark', stats: { date: new Date().toDateString() } })
    await window.DataStore.load()
    expect(window.DataStore.getTheme()).toBe('dark')
  })

  it('updateTheme 应更新主题并保存', async () => {
    await window.DataStore.load()
    await window.DataStore.updateTheme('dark')
    expect(window.DataStore.getTheme()).toBe('dark')
    expect(window.electronAPI.writeData).toHaveBeenCalled()
  })

  it('getTheme 默认返回 light', async () => {
    // 使用 Utils.createDefaultData() 提供全新副本，避免 defaultData.theme 被先前测试污染
    window.electronAPI.readData.mockResolvedValue(window.Utils.createDefaultData())
    await window.DataStore.load()
    expect(window.DataStore.getTheme()).toBe('light')
  })
})
