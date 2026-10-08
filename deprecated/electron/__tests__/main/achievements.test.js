/**
 * main/achievements.js 测试
 *
 * 验证 sendAchievementNotifications 在不同奖励形状下生成正确的通知 body。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
const { Notification } = require('electron')
const { sendAchievementNotifications } = require('../../main/achievements')

describe('main/achievements - sendAchievementNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('空数组时应直接返回不创建通知', () => {
    sendAchievementNotifications([])
    expect(Notification).not.toHaveBeenCalled()
  })

  it('null 时应直接返回不创建通知', () => {
    sendAchievementNotifications(null)
    expect(Notification).not.toHaveBeenCalled()
  })

  it('undefined 时应直接返回不创建通知', () => {
    sendAchievementNotifications(undefined)
    expect(Notification).not.toHaveBeenCalled()
  })

  it('只有种子奖励时应包含种子信息', () => {
    const achievements = [{
      name: '新手',
      description: '首次种植',
      rewards: { seeds: { carrot: 3, tomato: 2 } }
    }]
    sendAchievementNotifications(achievements)
    expect(Notification).toHaveBeenCalledTimes(1)
    const opts = Notification.mock.calls[0][0]
    expect(opts.title).toBe('🏆 成就解锁：新手')
    expect(opts.body).toContain('种子×3')
    expect(opts.body).toContain('种子×2')
    expect(opts.body).toContain('首次种植')
    expect(opts.silent).toBe(false)
  })

  it('只有金币奖励时应包含金币信息', () => {
    const achievements = [{
      name: '丰收',
      description: '收获10个',
      rewards: { coins: 50 }
    }]
    sendAchievementNotifications(achievements)
    expect(Notification).toHaveBeenCalledTimes(1)
    const opts = Notification.mock.calls[0][0]
    expect(opts.title).toBe('🏆 成就解锁：丰收')
    expect(opts.body).toContain('💰50')
  })

  it('种子和金币都有时应同时包含', () => {
    const achievements = [{
      name: '大师',
      description: '专注5小时',
      rewards: { seeds: { sunflower: 1 }, coins: 20 }
    }]
    sendAchievementNotifications(achievements)
    expect(Notification).toHaveBeenCalledTimes(1)
    const opts = Notification.mock.calls[0][0]
    expect(opts.body).toContain('种子×1')
    expect(opts.body).toContain('💰20')
  })

  it('rewards 为空对象时 body 只有 description', () => {
    const achievements = [{
      name: '空奖励',
      description: '描述文本',
      rewards: {}
    }]
    sendAchievementNotifications(achievements)
    expect(Notification).toHaveBeenCalledTimes(1)
    const opts = Notification.mock.calls[0][0]
    expect(opts.body).toBe('描述文本')
  })

  it('rewards 为 undefined 时 body 只有 description', () => {
    const achievements = [{
      name: '无奖励',
      description: '只有描述'
    }]
    sendAchievementNotifications(achievements)
    expect(Notification).toHaveBeenCalledTimes(1)
    const opts = Notification.mock.calls[0][0]
    expect(opts.body).toBe('只有描述')
  })

  it('seeds 中 count 为 0 时不显示该种子', () => {
    const achievements = [{
      name: '零种子',
      description: 'desc',
      rewards: { seeds: { carrot: 0, tomato: 0 }, coins: 0 }
    }]
    sendAchievementNotifications(achievements)
    expect(Notification).toHaveBeenCalledTimes(1)
    const opts = Notification.mock.calls[0][0]
    expect(opts.body).toBe('desc')
  })

  it('多个成就时应创建多个通知', () => {
    const achievements = [
      { name: 'A', description: 'descA', rewards: { coins: 5 } },
      { name: 'B', description: 'descB', rewards: { seeds: { carrot: 1 } } }
    ]
    sendAchievementNotifications(achievements)
    expect(Notification).toHaveBeenCalledTimes(2)
  })

  it('description 为空时 body 以奖励部分开始', () => {
    const achievements = [{
      name: '无描述',
      description: '',
      rewards: { coins: 10 }
    }]
    sendAchievementNotifications(achievements)
    const opts = Notification.mock.calls[0][0]
    expect(opts.body).toContain('💰10')
  })

  it('通知实例应调用 show()', () => {
    const achievements = [{
      name: '测试',
      description: 'desc',
      rewards: { coins: 1 }
    }]
    sendAchievementNotifications(achievements)
    expect(Notification).toHaveBeenCalledTimes(1)
    const instance = Notification.mock.results[0].value
    expect(instance.show).toHaveBeenCalledTimes(1)
  })
})
