/**
 * Utils 模块测试 - 完整覆盖所有导出
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

let Utils

beforeAll(() => {
  require('../../src/scripts/modules/utils')
  Utils = window.Utils
})

beforeEach(() => {
  // setup.js deletes window.Utils between tests; restore it
  window.Utils = Utils
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
    expect(window.Utils.formatTime(60, false)).toBe('1:00')
    expect(window.Utils.formatTime(3661, false)).toBe('61:01')
    expect(window.Utils.formatTime(0, false)).toBe('0:00')
  })

  it('应正确处理秒数取整（小数）', () => {
    expect(window.Utils.formatTime(90.7)).toBe('01:30')
    expect(window.Utils.formatTime(1.2)).toBe('00:01')
    expect(window.Utils.formatTime(125.99)).toBe('02:05')
  })
})

// ============ DEFAULT_PRESETS ============
describe('Utils.DEFAULT_PRESETS', () => {
  it('应包含 work 和 break 预设', () => {
    expect(window.Utils.DEFAULT_PRESETS).toHaveProperty('work')
    expect(window.Utils.DEFAULT_PRESETS).toHaveProperty('break')
    expect(Array.isArray(window.Utils.DEFAULT_PRESETS.work)).toBe(true)
    expect(Array.isArray(window.Utils.DEFAULT_PRESETS.break)).toBe(true)
  })

  it('默认值应正确', () => {
    expect(window.Utils.DEFAULT_PRESETS.work).toEqual([15, 25, 45, 60])
    expect(window.Utils.DEFAULT_PRESETS.break).toEqual([5, 10, 15])
  })
})

// ============ createDefaultData ============
describe('Utils.createDefaultData', () => {
  it('应返回完整的数据结构', () => {
    const data = window.Utils.createDefaultData()
    expect(data).toHaveProperty('stats')
    expect(data).toHaveProperty('presets')
    expect(data).toHaveProperty('planList')
    expect(data).toHaveProperty('audioDevice')
    expect(data).toHaveProperty('garden')
    expect(data).toHaveProperty('theme')
    expect(data).toHaveProperty('settings')
  })

  it('stats 应包含今日日期和默认计数', () => {
    const data = window.Utils.createDefaultData()
    expect(data.stats.date).toBe(new Date().toDateString())
    expect(data.stats.todayCount).toBe(0)
    expect(data.stats.totalMinutes).toBe(0)
  })

  it('presets 应与 DEFAULT_PRESETS 一致', () => {
    const data = window.Utils.createDefaultData()
    expect(data.presets).toEqual(window.Utils.DEFAULT_PRESETS)
  })

  it('planList 应为空数组', () => {
    const data = window.Utils.createDefaultData()
    expect(data.planList).toEqual([])
  })

  it('默认主题为 light', () => {
    const data = window.Utils.createDefaultData()
    expect(data.theme).toBe('light')
  })

  it('菜园子数据结构应完整', () => {
    const data = window.Utils.createDefaultData()
    const g = data.garden
    expect(g).toHaveProperty('coins')
    expect(g).toHaveProperty('seeds')
    expect(g).toHaveProperty('crops')
    expect(g).toHaveProperty('plots')
    expect(g).toHaveProperty('warehouse')
    expect(g).toHaveProperty('signIn')
    expect(g).toHaveProperty('achievements')
    expect(g).toHaveProperty('achievementStats')
    expect(g.coins).toBe(0)
  })

  it('应有 12 块地，前 6 块未锁定，后 6 块锁定', () => {
    const data = window.Utils.createDefaultData()
    expect(data.garden.plots).toHaveLength(12)
    for (let i = 0; i < 6; i++) {
      expect(data.garden.plots[i].locked).toBeFalsy()
      expect(data.garden.plots[i].id).toBe(i)
      expect(data.garden.plots[i].crop).toBeNull()
      expect(data.garden.plots[i].progress).toBe(0)
      expect(data.garden.plots[i].plantedAt).toBeNull()
    }
    for (let i = 6; i < 12; i++) {
      expect(data.garden.plots[i].locked).toBe(true)
      expect(data.garden.plots[i].id).toBe(i)
    }
  })

  it('默认种子库存应正确', () => {
    const data = window.Utils.createDefaultData()
    expect(data.garden.seeds.carrot).toBe(5)
    expect(data.garden.seeds.tomato).toBe(2)
    expect(data.garden.seeds.sunflower).toBe(0)
    expect(data.garden.seeds.rose).toBe(0)
    expect(data.garden.seeds.osmanthus).toBe(0)
  })

  it('签到数据应完整', () => {
    const data = window.Utils.createDefaultData()
    expect(data.garden.signIn.lastDate).toBeNull()
    expect(data.garden.signIn.continuousDays).toBe(0)
    expect(data.garden.signIn.totalDays).toBe(0)
    expect(data.garden.signIn.weekRecords).toHaveLength(7)
    expect(data.garden.signIn.weekRecords.every(v => v === false)).toBe(true)
  })

  it('成就统计应初始化为默认值', () => {
    const data = window.Utils.createDefaultData()
    expect(data.garden.achievements).toEqual({})
    const s = data.garden.achievementStats
    expect(s.totalFocusMinutes).toBe(0)
    expect(s.totalHarvestCount).toBe(0)
    expect(s.totalPlantCount).toBe(0)
    expect(s.totalCoinsEarned).toBe(0)
    expect(s.cropTypesCollected).toEqual([])
  })

  it('settings 应包含所有默认设置', () => {
    const data = window.Utils.createDefaultData()
    const s = data.settings
    expect(s.minimizeBehavior).toBe('mini')
    expect(s.miniExitMode).toBe('arrow')
    expect(s.showDarkModeBtn).toBe(true)
    expect(s.showGardenBtn).toBe(true)
    expect(s.plantWheelMode).toBe(true)
    expect(s.showStatsBtn).toBe(true)
    expect(s.showAiBtn).toBe(true)
    expect(s.showStudyRoomBtn).toBe(true)
    expect(s.showSidebarCollapseBtn).toBe(true)
    expect(s.showHeaderExpandBtn).toBe(true)
    expect(s.showShuffleBtn).toBe(true)
    expect(s.showVolumeBtn).toBe(true)
    expect(s.showDeviceBtn).toBe(true)
    expect(s.showChartsBtn).toBe(true)
    expect(s.advancedColorCustomization).toBe(false)
    expect(s.autoStart).toBe(false)
    expect(s.musicHotkeys).toBeDefined()
    expect(s.musicHotkeys.pause).toEqual(['Key.ctrl_r', 'Key.shift_r'])
    expect(s.musicHotkeys.next).toEqual(['Key.ctrl_r', 'Key.right'])
    expect(s.musicHotkeys.prev).toEqual(['Key.ctrl_r', 'Key.left'])
    expect(s.musicHotkeys.volUp).toEqual(['Key.ctrl_r', 'Key.up'])
    expect(s.musicHotkeys.volDown).toEqual(['Key.ctrl_r', 'Key.down'])
  })

  it('每次调用应返回独立副本（不共享引用）', () => {
    const a = window.Utils.createDefaultData()
    const b = window.Utils.createDefaultData()
    a.stats.todayCount = 99
    a.presets.work.push(999)
    expect(b.stats.todayCount).toBe(0)
    expect(b.presets.work).not.toContain(999)
  })
})

// ============ CROP_CONFIG ============
describe('Utils.CROP_CONFIG', () => {
  it('应定义所有 5 种作物', () => {
    const crops = window.Utils.CROP_CONFIG
    expect(Object.keys(crops)).toHaveLength(5)
    expect(crops.carrot).toBeDefined()
    expect(crops.tomato).toBeDefined()
    expect(crops.sunflower).toBeDefined()
    expect(crops.rose).toBeDefined()
    expect(crops.osmanthus).toBeDefined()
  })

  it('胡萝卜配置应正确', () => {
    const c = window.Utils.CROP_CONFIG.carrot
    expect(c.name).toBe('胡萝卜')
    expect(c.growTime).toBe(25)
    expect(c.icon).toBe('🥕')
    expect(c.seedType).toBe('carrot')
    expect(c.rarity).toBe('common')
    expect(c.value).toBe(10)
    expect(c.seedPrice).toBe(8)
    expect(c.sellPrice).toBe(10)
  })

  it('番茄配置应正确', () => {
    const c = window.Utils.CROP_CONFIG.tomato
    expect(c.name).toBe('番茄')
    expect(c.growTime).toBe(50)
    expect(c.icon).toBe('🍅')
    expect(c.rarity).toBe('common')
    expect(c.value).toBe(20)
    expect(c.seedPrice).toBe(16)
    expect(c.sellPrice).toBe(20)
  })

  it('向日葵配置应正确', () => {
    const c = window.Utils.CROP_CONFIG.sunflower
    expect(c.name).toBe('向日葵')
    expect(c.growTime).toBe(90)
    expect(c.rarity).toBe('rare')
    expect(c.value).toBe(50)
    expect(c.seedPrice).toBe(40)
    expect(c.sellPrice).toBe(50)
  })

  it('玫瑰配置应正确', () => {
    const c = window.Utils.CROP_CONFIG.rose
    expect(c.name).toBe('玫瑰')
    expect(c.growTime).toBe(120)
    expect(c.rarity).toBe('rare')
    expect(c.value).toBe(80)
    expect(c.seedPrice).toBe(64)
    expect(c.sellPrice).toBe(80)
  })

  it('金桂树配置应为 legend 稀有度', () => {
    const c = window.Utils.CROP_CONFIG.osmanthus
    expect(c.name).toBe('金桂树')
    expect(c.growTime).toBe(180)
    expect(c.rarity).toBe('legend')
    expect(c.value).toBe(150)
    expect(c.seedPrice).toBe(120)
    expect(c.sellPrice).toBe(150)
  })

  it('各作物 growTime/sellPrice 应为正数', () => {
    Object.values(window.Utils.CROP_CONFIG).forEach(crop => {
      expect(crop.growTime).toBeGreaterThan(0)
      expect(crop.sellPrice).toBeGreaterThan(0)
    })
  })
})

// ============ DAILY_REWARD / CONTINUOUS_REWARDS / WEEKLY_REWARDS ============
describe('Utils.DAILY_REWARD', () => {
  it('应包含每日基础奖励', () => {
    expect(window.Utils.DAILY_REWARD.seeds).toEqual({ carrot: 1 })
    expect(window.Utils.DAILY_REWARD.coins).toBe(5)
  })
})

describe('Utils.CONTINUOUS_REWARDS', () => {
  it('应包含 3/7/14/30 天档位', () => {
    const c = window.Utils.CONTINUOUS_REWARDS
    expect(Object.keys(c)).toHaveLength(4)
    expect(c[3]).toBeDefined()
    expect(c[7]).toBeDefined()
    expect(c[14]).toBeDefined()
    expect(c[30]).toBeDefined()
  })

  it('3 天奖励应为 tomato 种子', () => {
    expect(window.Utils.CONTINUOUS_REWARDS[3].seeds).toEqual({ tomato: 1 })
    expect(window.Utils.CONTINUOUS_REWARDS[3].coins).toBe(0)
    expect(window.Utils.CONTINUOUS_REWARDS[3].message).toBeTruthy()
  })

  it('7 天奖励应为 sunflower 种子', () => {
    expect(window.Utils.CONTINUOUS_REWARDS[7].seeds).toEqual({ sunflower: 1 })
  })

  it('14 天奖励应为 rose 种子', () => {
    expect(window.Utils.CONTINUOUS_REWARDS[14].seeds).toEqual({ rose: 1 })
  })

  it('30 天奖励应为 osmanthus 种子', () => {
    expect(window.Utils.CONTINUOUS_REWARDS[30].seeds).toEqual({ osmanthus: 1 })
  })
})

describe('Utils.WEEKLY_REWARDS', () => {
  it('应包含 0-6 全部 7 天', () => {
    const w = window.Utils.WEEKLY_REWARDS
    expect(Object.keys(w)).toHaveLength(7)
    for (let i = 0; i <= 6; i++) {
      expect(w[i]).toBeDefined()
      expect(w[i].message).toBeTruthy()
    }
  })

  it('周日（0）应给 20 金币', () => {
    expect(window.Utils.WEEKLY_REWARDS[0].coins).toBe(20)
  })

  it('周六（6）应包含 randomSeed 标记', () => {
    expect(window.Utils.WEEKLY_REWARDS[6].randomSeed).toBe(true)
  })

  it('周一（1）应给 carrot 种子', () => {
    expect(window.Utils.WEEKLY_REWARDS[1].seeds).toEqual({ carrot: 2 })
  })

  it('周二/周四应给 10 金币', () => {
    expect(window.Utils.WEEKLY_REWARDS[2].coins).toBe(10)
    expect(window.Utils.WEEKLY_REWARDS[4].coins).toBe(10)
  })
})

// ============ PLOT_UNLOCK_CONFIG ============
describe('Utils.PLOT_UNLOCK_CONFIG', () => {
  it('应包含 12 块地的解锁配置', () => {
    const c = window.Utils.PLOT_UNLOCK_CONFIG
    expect(Object.keys(c)).toHaveLength(12)
  })

  it('0-5 号地为 default 类型', () => {
    for (let i = 0; i <= 5; i++) {
      expect(window.Utils.PLOT_UNLOCK_CONFIG[i].type).toBe('default')
    }
  })

  it('6/7/10/11 号地为 coins 类型并有价格', () => {
    expect(window.Utils.PLOT_UNLOCK_CONFIG[6].type).toBe('coins')
    expect(window.Utils.PLOT_UNLOCK_CONFIG[6].price).toBe(100)
    expect(window.Utils.PLOT_UNLOCK_CONFIG[7].price).toBe(150)
    expect(window.Utils.PLOT_UNLOCK_CONFIG[10].price).toBe(500)
    expect(window.Utils.PLOT_UNLOCK_CONFIG[11].price).toBe(800)
  })

  it('8/9 号地为 achievement 类型并有 achievementId', () => {
    expect(window.Utils.PLOT_UNLOCK_CONFIG[8].type).toBe('achievement')
    expect(window.Utils.PLOT_UNLOCK_CONFIG[8].achievementId).toBe('signin100')
    expect(window.Utils.PLOT_UNLOCK_CONFIG[8].description).toBeTruthy()
    expect(window.Utils.PLOT_UNLOCK_CONFIG[9].type).toBe('achievement')
    expect(window.Utils.PLOT_UNLOCK_CONFIG[9].achievementId).toBe('coins5000')
    expect(window.Utils.PLOT_UNLOCK_CONFIG[9].description).toBeTruthy()
  })
})

// ============ ACHIEVEMENT_CONFIG ============
describe('Utils.ACHIEVEMENT_CONFIG', () => {
  it('应包含约 25 个成就', () => {
    const count = Object.keys(window.Utils.ACHIEVEMENT_CONFIG).length
    expect(count).toBeGreaterThanOrEqual(20)
    expect(count).toBeLessThanOrEqual(30)
  })

  it('每个成就应包含 id/category/name/description/target/icon/rewards', () => {
    Object.values(window.Utils.ACHIEVEMENT_CONFIG).forEach(a => {
      expect(a).toHaveProperty('id')
      expect(a).toHaveProperty('category')
      expect(a).toHaveProperty('name')
      expect(a).toHaveProperty('description')
      expect(a).toHaveProperty('target')
      expect(a).toHaveProperty('icon')
      expect(a).toHaveProperty('rewards')
      expect(a.rewards).toHaveProperty('seeds')
      expect(a.rewards).toHaveProperty('coins')
    })
  })

  it('应包含专注类成就 focus1h/5h/25h/50h/100h', () => {
    const a = window.Utils.ACHIEVEMENT_CONFIG
    expect(a.focus1h.target).toBe(60)
    expect(a.focus1h.category).toBe('focus')
    expect(a.focus5h.target).toBe(300)
    expect(a.focus25h.target).toBe(1500)
    expect(a.focus50h.target).toBe(3000)
    expect(a.focus100h.target).toBe(6000)
  })

  it('应包含收获类成就 harvest1/10/50/100/500', () => {
    const a = window.Utils.ACHIEVEMENT_CONFIG
    expect(a.harvest1.target).toBe(1)
    expect(a.harvest1.category).toBe('harvest')
    expect(a.harvest10.target).toBe(10)
    expect(a.harvest50.target).toBe(50)
    expect(a.harvest100.target).toBe(100)
    expect(a.harvest500.target).toBe(500)
  })

  it('应包含种植类成就 plant1/10/50/100/500', () => {
    const a = window.Utils.ACHIEVEMENT_CONFIG
    expect(a.plant1.target).toBe(1)
    expect(a.plant1.category).toBe('plant')
    expect(a.plant500.target).toBe(500)
  })

  it('应包含收藏类成就 collect1/3/5', () => {
    const a = window.Utils.ACHIEVEMENT_CONFIG
    expect(a.collect1.target).toBe(1)
    expect(a.collect1.category).toBe('collect')
    expect(a.collect3.target).toBe(3)
    expect(a.collect5.target).toBe(5)
  })

  it('应包含财富类成就 coins100/500/1000/5000', () => {
    const a = window.Utils.ACHIEVEMENT_CONFIG
    expect(a.coins100.target).toBe(100)
    expect(a.coins100.category).toBe('wealth')
    expect(a.coins500.target).toBe(500)
    expect(a.coins1000.target).toBe(1000)
    expect(a.coins5000.target).toBe(5000)
  })

  it('应包含坚持类成就 signin7/30/100', () => {
    const a = window.Utils.ACHIEVEMENT_CONFIG
    expect(a.signin7.target).toBe(7)
    expect(a.signin7.category).toBe('persist')
    expect(a.signin30.target).toBe(30)
    expect(a.signin100.target).toBe(100)
  })

  it('应包含隐藏成就 easteregg', () => {
    const a = window.Utils.ACHIEVEMENT_CONFIG.easteregg
    expect(a.category).toBe('hidden')
    expect(a.target).toBe(1)
    expect(a.icon).toBe('🥚')
  })

  it('所有成就的 category 应在 ACHIEVEMENT_CATEGORIES 中定义', () => {
    const cats = Object.keys(window.Utils.ACHIEVEMENT_CATEGORIES)
    Object.values(window.Utils.ACHIEVEMENT_CONFIG).forEach(a => {
      expect(cats).toContain(a.category)
    })
  })
})

// ============ ACHIEVEMENT_CATEGORIES ============
describe('Utils.ACHIEVEMENT_CATEGORIES', () => {
  it('应包含 6 个分类（focus/harvest/plant/collect/wealth/persist）+ hidden', () => {
    const c = window.Utils.ACHIEVEMENT_CATEGORIES
    expect(c.focus).toBeDefined()
    expect(c.harvest).toBeDefined()
    expect(c.plant).toBeDefined()
    expect(c.collect).toBeDefined()
    expect(c.wealth).toBeDefined()
    expect(c.persist).toBeDefined()
    expect(c.hidden).toBeDefined()
  })

  it('每个分类应包含 name 和 icon', () => {
    Object.values(window.Utils.ACHIEVEMENT_CATEGORIES).forEach(c => {
      expect(c.name).toBeTruthy()
      expect(c.icon).toBeTruthy()
    })
  })

  it('focus 分类应为"专注"', () => {
    expect(window.Utils.ACHIEVEMENT_CATEGORIES.focus.name).toBe('专注')
    expect(window.Utils.ACHIEVEMENT_CATEGORIES.focus.icon).toBe('⏱️')
  })

  it('persist 分类应为"坚持"', () => {
    expect(window.Utils.ACHIEVEMENT_CATEGORIES.persist.name).toBe('坚持')
  })
})
