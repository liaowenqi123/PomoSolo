/**
 * Stats 模块测试
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/stats')
})

beforeEach(() => {
  // setup.js clears DOM and deletes window.electronAPI; re-setup
  document.body.innerHTML = `
    <div id="today-count">0</div>
    <div id="total-minutes">0</div>
  `
  window.electronAPI = {
    writeData: vi.fn().mockResolvedValue(true)
  }
  window.DataStore = {
    getStats: vi.fn().mockReturnValue({ date: new Date().toDateString(), todayCount: 0, totalMinutes: 0 }),
    getData: vi.fn().mockReturnValue({}),
    // updateStats 应更新 getStats 的返回值，模拟生产环境中缓存更新行为
    updateStats: vi.fn().mockImplementation(async (newStats) => {
      window.DataStore.getStats.mockReturnValue(newStats)
      return true
    })
  }
  window.Garden = {
    updateAchievementStats: vi.fn().mockResolvedValue(true)
  }
  // Re-init Stats with fresh elements
  window.Stats.init({
    todayCount: document.getElementById('today-count'),
    totalMinutes: document.getElementById('total-minutes')
  })
})

describe('Stats 模块', () => {
  it('init 应调用 updateDisplay', () => {
    expect(document.getElementById('today-count').textContent).toBe('0')
    expect(document.getElementById('total-minutes').textContent).toBe('0')
  })

  it('updateDisplay 应反映 DataStore.getStats 的值', () => {
    window.DataStore.getStats.mockReturnValue({ todayCount: 5, totalMinutes: 125 })
    window.Stats.updateDisplay()
    expect(document.getElementById('today-count').textContent).toBe('5')
    expect(document.getElementById('total-minutes').textContent).toBe('125')
  })

  it('updateDisplay 在元素不存在时不应报错', () => {
    window.Stats.init({})
    window.DataStore.getStats.mockReturnValue({ todayCount: 1, totalMinutes: 1 })
    expect(() => window.Stats.updateDisplay()).not.toThrow()
  })

  it('getTodayCount 应返回 todayCount', () => {
    window.DataStore.getStats.mockReturnValue({ todayCount: 7 })
    expect(window.Stats.getTodayCount()).toBe(7)
  })

  it('getTodayCount 默认返回 0', () => {
    window.DataStore.getStats.mockReturnValue({})
    expect(window.Stats.getTodayCount()).toBe(0)
  })

  it('getTotalMinutes 应返回 totalMinutes', () => {
    window.DataStore.getStats.mockReturnValue({ totalMinutes: 250 })
    expect(window.Stats.getTotalMinutes()).toBe(250)
  })

  it('getTotalMinutes 默认返回 0', () => {
    window.DataStore.getStats.mockReturnValue({})
    expect(window.Stats.getTotalMinutes()).toBe(0)
  })

  it('getTodayMinutes 无 history 时返回 0', () => {
    window.DataStore.getData.mockReturnValue({})
    expect(window.Stats.getTodayMinutes()).toBe(0)
  })

  it('getTodayMinutes 应只计算今日记录', () => {
    const today = new Date().toISOString().split('T')[0]
    window.DataStore.getData.mockReturnValue({
      statisticsHistory: [
        { date: today, minutes: 25 },
        { date: today, minutes: 15 },
        { date: '2020-01-01', minutes: 100 }
      ]
    })
    expect(window.Stats.getTodayMinutes()).toBe(40)
  })

  it('getTodayMinutes 应跳过无 minutes 字段的记录', () => {
    const today = new Date().toISOString().split('T')[0]
    window.DataStore.getData.mockReturnValue({
      statisticsHistory: [
        { date: today, minutes: 25 },
        { date: today },
        { date: today, minutes: 0 }
      ]
    })
    expect(window.Stats.getTodayMinutes()).toBe(25)
  })

  it('increment 应更新 todayCount 和 totalMinutes', async () => {
    window.DataStore.getStats.mockReturnValue({ todayCount: 3, totalMinutes: 75 })
    window.DataStore.getData.mockReturnValue({})
    await window.Stats.increment(25, '专注番茄')
    expect(window.DataStore.updateStats).toHaveBeenCalledWith(expect.objectContaining({
      todayCount: 4,
      totalMinutes: 100
    }))
  })

  it('increment 应向 statisticsHistory 推送记录', async () => {
    const data = { statisticsHistory: [] }
    window.DataStore.getData.mockReturnValue(data)
    await window.Stats.increment(25, '专注番茄')
    expect(data.statisticsHistory).toHaveLength(1)
    expect(data.statisticsHistory[0].minutes).toBe(25)
    expect(data.statisticsHistory[0].note).toBe('专注番茄')
    expect(data.statisticsHistory[0].partial).toBeUndefined()
  })

  it('increment 无备注时记录"无备注"', async () => {
    const data = { statisticsHistory: [] }
    window.DataStore.getData.mockReturnValue(data)
    await window.Stats.increment(25)
    expect(data.statisticsHistory[0].note).toBe('无备注')
  })

  it('increment 应调用 electronAPI.writeData', async () => {
    window.DataStore.getData.mockReturnValue({})
    await window.Stats.increment(25, 'note')
    expect(window.electronAPI.writeData).toHaveBeenCalled()
  })

  it('increment 应调用 Garden.updateAchievementStats', async () => {
    window.DataStore.getData.mockReturnValue({})
    await window.Stats.increment(25, 'note')
    expect(window.Garden.updateAchievementStats).toHaveBeenCalledWith('focus', 25)
  })

  it('increment 在无 Garden 时不应报错', async () => {
    delete window.Garden
    window.DataStore.getData.mockReturnValue({})
    await expect(window.Stats.increment(25, 'note')).resolves.toBeUndefined()
  })

  it('increment 应初始化 statisticsHistory（如不存在）', async () => {
    const data = {}
    window.DataStore.getData.mockReturnValue(data)
    await window.Stats.increment(25, 'note')
    expect(data.statisticsHistory).toBeDefined()
    expect(data.statisticsHistory).toHaveLength(1)
  })

  it('increment 应调用 updateDisplay', async () => {
    window.DataStore.getStats.mockReturnValue({ todayCount: 1, totalMinutes: 25 })
    window.DataStore.getData.mockReturnValue({})
    await window.Stats.increment(25, 'note')
    expect(document.getElementById('today-count').textContent).toBe('2')
    expect(document.getElementById('total-minutes').textContent).toBe('50')
  })

  it('recordPartialFocus seconds<=0 不应记录', async () => {
    await window.Stats.recordPartialFocus(0, '')
    expect(window.DataStore.updateStats).not.toHaveBeenCalled()
  })

  it('recordPartialFocus 分钟<1 不应记录', async () => {
    await window.Stats.recordPartialFocus(30, '')
    expect(window.DataStore.updateStats).not.toHaveBeenCalled()
  })

  it('recordPartialFocus 应记录 minutes 但不增加 todayCount', async () => {
    window.DataStore.getStats.mockReturnValue({ todayCount: 5, totalMinutes: 100 })
    const data = { statisticsHistory: [] }
    window.DataStore.getData.mockReturnValue(data)
    await window.Stats.recordPartialFocus(120, '部分完成')
    expect(window.DataStore.updateStats).toHaveBeenCalledWith(expect.objectContaining({
      todayCount: 5,
      totalMinutes: 102
    }))
  })

  it('recordPartialFocus 应添加 partial 标记', async () => {
    const data = { statisticsHistory: [] }
    window.DataStore.getData.mockReturnValue(data)
    window.DataStore.getStats.mockReturnValue({ todayCount: 5, totalMinutes: 100 })
    await window.Stats.recordPartialFocus(120, '部分完成')
    expect(data.statisticsHistory[0].partial).toBe(true)
    expect(data.statisticsHistory[0].originalSeconds).toBe(120)
    expect(data.statisticsHistory[0].note).toBe('部分完成')
  })

  it('recordPartialFocus 无备注时 note 为"部分完成"', async () => {
    const data = { statisticsHistory: [] }
    window.DataStore.getData.mockReturnValue(data)
    window.DataStore.getStats.mockReturnValue({ todayCount: 0, totalMinutes: 0 })
    await window.Stats.recordPartialFocus(60, '')
    expect(data.statisticsHistory[0].note).toBe('部分完成')
  })

  it('recordPartialFocus 应调用 electronAPI.writeData 和 Garden.updateAchievementStats', async () => {
    window.DataStore.getStats.mockReturnValue({ todayCount: 0, totalMinutes: 0 })
    window.DataStore.getData.mockReturnValue({})
    await window.Stats.recordPartialFocus(60, '部分')
    expect(window.electronAPI.writeData).toHaveBeenCalled()
    expect(window.Garden.updateAchievementStats).toHaveBeenCalledWith('focus', 1)
  })

  it('recordPartialFocus 应初始化 statisticsHistory（如不存在）', async () => {
    const data = {}
    window.DataStore.getData.mockReturnValue(data)
    window.DataStore.getStats.mockReturnValue({ todayCount: 0, totalMinutes: 0 })
    await window.Stats.recordPartialFocus(60, '')
    expect(data.statisticsHistory).toHaveLength(1)
  })

  it('recordPartialFocus 应调用 updateDisplay', async () => {
    window.DataStore.getStats.mockReturnValue({ todayCount: 2, totalMinutes: 50 })
    window.DataStore.getData.mockReturnValue({})
    await window.Stats.recordPartialFocus(60, '')
    expect(document.getElementById('total-minutes').textContent).toBe('51')
    expect(document.getElementById('today-count').textContent).toBe('2')
  })
})
