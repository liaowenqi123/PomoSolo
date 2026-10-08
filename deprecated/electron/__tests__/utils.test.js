/**
 * Utils 模块测试
 *
 * 测试 window.Utils 中的纯函数
 * utils.js 通过 IIFE 注册到 window.Utils，加载后会初始化全局变量
 */

import { beforeAll, describe, expect, it } from 'vitest'

// mock: Utils.createDefaultData 引用了 Date，确保时间一致
const MOCK_NOW = new Date('2026-05-26T12:00:00Z')

beforeAll(() => {
  // 加载 utils 模块前，确保 window 环境存在（jsdom 已提供）
  require('../src/scripts/modules/utils')
})

// ============ formatTime ============

describe('Utils.formatTime', () => {
  it('应格式化秒数为 MM:SS 格式（带前导零）', () => {
    expect(window.Utils.formatTime(0)).toBe('00:00')
    expect(window.Utils.formatTime(59)).toBe('00:59')
    expect(window.Utils.formatTime(60)).toBe('01:00')
    expect(window.Utils.formatTime(1500)).toBe('25:00')
    expect(window.Utils.formatTime(3661)).toBe('61:01')
  })

  it('showLeadingZero=false 时不显示分钟前导零', () => {
    expect(window.Utils.formatTime(59, false)).toBe('0:59')
    expect(window.Utils.formatTime(3661, false)).toBe('61:01')
  })

  it('应正确处理秒数取整', () => {
    expect(window.Utils.formatTime(90.7)).toBe('01:30')
    expect(window.Utils.formatTime(1.2)).toBe('00:01')
  })
})

// ============ createDefaultData ============

describe('Utils.createDefaultData', () => {
  it('应返回完整的数据结构', () => {
    const data = window.Utils.createDefaultData()

    expect(data).toHaveProperty('stats')
    expect(data).toHaveProperty('presets')
    expect(data).toHaveProperty('planList')
    expect(data).toHaveProperty('garden')
    expect(data).toHaveProperty('theme')
    expect(data).toHaveProperty('settings')

    // 默认主题为 light
    expect(data.theme).toBe('light')
  })

  it('统计数据应包含今日日期', () => {
    const data = window.Utils.createDefaultData()
    // 不校验具体日期，只校验格式
    expect(data.stats.date).toBeTruthy()
    expect(data.stats.todayCount).toBe(0)
    expect(data.stats.totalMinutes).toBe(0)
  })

  it('菜园子数据结构应完整', () => {
    const data = window.Utils.createDefaultData()
    expect(data.garden).toHaveProperty('coins')
    expect(data.garden).toHaveProperty('seeds')
    expect(data.garden).toHaveProperty('plots')
    expect(data.garden).toHaveProperty('signIn')
    expect(data.garden).toHaveProperty('achievements')
    expect(data.garden).toHaveProperty('achievementStats')

    // 默认有 12 块地
    expect(data.garden.plots).toHaveLength(12)
    // 前 6 块未锁定
    expect(data.garden.plots[0].locked).toBeFalsy()
    // 第 6 块起锁定
    expect(data.garden.plots[6].locked).toBe(true)
  })

  it('默认种子库存应正确', () => {
    const data = window.Utils.createDefaultData()
    expect(data.garden.seeds.carrot).toBe(5)
    expect(data.garden.seeds.tomato).toBe(2)
    expect(data.garden.seeds.osmanthus).toBe(0)
  })
})

// ============ 作物配置 ============

describe('Utils.CROP_CONFIG', () => {
  it('应定义所有 5 种作物', () => {
    const crops = window.Utils.CROP_CONFIG
    expect(Object.keys(crops)).toHaveLength(5)
    expect(crops.carrot.name).toBe('胡萝卜')
    expect(crops.tomato.name).toBe('番茄')
    expect(crops.osmanthus.rarity).toBe('legend')
  })

  it('各作物成长时间应合法', () => {
    const crops = window.Utils.CROP_CONFIG
    Object.values(crops).forEach(crop => {
      expect(crop.growTime).toBeGreaterThan(0)
      expect(crop.sellPrice).toBeGreaterThan(0)
    })
  })
})
