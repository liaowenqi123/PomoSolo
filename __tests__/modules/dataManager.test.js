/**
 * dataManager.js 测试
 * 覆盖：默认数据生成、文件读写、设置迁移、菜园子文件迁移、
 * 菜园子原子操作（带锁）、成就系统、签到、惩罚等。
 *
 * fs 已在 setup.js 中通过 Module._load 拦截替换为 __fsMock。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const dataManager = require('../../src/modules/dataManager')

// 工具：写入 garden_data.json
function writeGarden(garden) {
  const path = dataManager.getGardenDataFilePath()
  __fsMock.__setFile(path, JSON.stringify(garden, null, 2))
}

function readGardenRaw() {
  const path = dataManager.getGardenDataFilePath()
  return JSON.parse(__fsMock.__getFile(path))
}

function writeData(data) {
  const path = dataManager.getDataFilePath()
  __fsMock.__setFile(path, JSON.stringify(data, null, 2))
}

function readDataRaw() {
  const path = dataManager.getDataFilePath()
  return JSON.parse(__fsMock.__getFile(path))
}

function writeSettingsRaw(settings) {
  const path = dataManager.getSettingsFilePath()
  __fsMock.__setFile(path, JSON.stringify(settings, null, 2))
}

function defaultGardenWithCoins(coins = 1000) {
  const g = dataManager.createDefaultGardenData()
  g.coins = coins
  return g
}

describe('dataManager - createDefaultData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('createDefaultData 返回正确结构', () => {
    const data = dataManager.createDefaultData()
    expect(data.apiKey).toBe(null)
    expect(data.apiMode).toBe('cloud')
    expect(data.stats).toBeDefined()
    expect(data.stats.todayCount).toBe(0)
    expect(data.stats.totalMinutes).toBe(0)
    expect(typeof data.stats.date).toBe('string')
    expect(data.presets).toEqual({ work: [15, 25, 45, 60], break: [5, 10, 15] })
    expect(data.planList).toEqual([])
    expect(data.audioDevice).toBe(null)
    expect(data.musicVolume).toBe(1.0)
  })

  it('createDefaultGardenData 返回 12 个 plots，6 个默认解锁', () => {
    const garden = dataManager.createDefaultGardenData()
    expect(garden.coins).toBe(0)
    expect(garden.seeds).toEqual({ carrot: 5, tomato: 2, sunflower: 0, rose: 0, osmanthus: 0 })
    expect(garden.plots).toHaveLength(12)
    for (let i = 0; i < 6; i++) {
      expect(garden.plots[i].locked).toBeUndefined()
      expect(garden.plots[i].crop).toBe(null)
    }
    for (let i = 6; i < 12; i++) {
      expect(garden.plots[i].locked).toBe(true)
    }
    expect(garden.warehouse).toEqual([])
  })

  it('createDefaultSettings 返回正确结构', () => {
    const settings = dataManager.createDefaultSettings()
    expect(settings.minimizeBehavior).toBe('mini')
    expect(settings.miniExitMode).toBe('arrow')
    expect(settings.showDarkModeBtn).toBe(true)
    expect(settings.showGardenBtn).toBe(true)
    expect(settings.showStatsBtn).toBe(true)
    expect(settings.showAiBtn).toBe(true)
    expect(settings.showStudyRoomBtn).toBe(true)
    expect(settings.showSidebarCollapseBtn).toBe(true)
    expect(settings.showHeaderExpandBtn).toBe(true)
    expect(settings.showShuffleBtn).toBe(true)
    expect(settings.showVolumeBtn).toBe(true)
    expect(settings.showDeviceBtn).toBe(true)
    expect(settings.showChartsBtn).toBe(true)
    expect(settings.advancedColorCustomization).toBe(false)
    expect(settings.musicHotkeys).toBeDefined()
    expect(settings.musicHotkeys.pause).toEqual(['Key.ctrl_r', 'Key.shift_r'])
    expect(settings.autoStart).toBe(false)
  })

  it('路径函数返回一致路径', () => {
    expect(dataManager.getDataFilePath()).toContain('data.json')
    expect(dataManager.getGardenDataFilePath()).toContain('garden_data.json')
    expect(dataManager.getSettingsFilePath()).toContain('settings.json')
  })

  it('ensureDataDir 不抛错', () => {
    expect(() => dataManager.ensureDataDir()).not.toThrow()
  })
})

describe('dataManager - readData/writeData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('readData 文件不存在时创建默认数据', () => {
    const data = dataManager.readData()
    expect(data.apiMode).toBe('cloud')
    expect(data.stats.todayCount).toBe(0)
    // 文件应被创建
    expect(__fsMock.__hasFile(dataManager.getDataFilePath())).toBe(true)
  })

  it('readData 文件存在时返回解析结果', () => {
    writeData({ apiKey: 'test-key', apiMode: 'local', stats: { date: 'x', todayCount: 5, totalMinutes: 100 }, presets: { work: [25], break: [5] }, planList: [], audioDevice: null, musicVolume: 0.5 })
    const data = dataManager.readData()
    expect(data.apiKey).toBe('test-key')
    expect(data.apiMode).toBe('local')
    expect(data.stats.todayCount).toBe(5)
    expect(data.musicVolume).toBe(0.5)
  })

  it('readData JSON 解析失败时返回默认', () => {
    __fsMock.__setFile(dataManager.getDataFilePath(), '{invalid json')
    const data = dataManager.readData()
    expect(data.apiMode).toBe('cloud')
    expect(data.stats.todayCount).toBe(0)
  })

  it('writeData 写入 JSON 文件', () => {
    const result = dataManager.writeData({ foo: 'bar' })
    expect(result).toBe(true)
    const raw = __fsMock.__getFile(dataManager.getDataFilePath())
    expect(JSON.parse(raw).foo).toBe('bar')
  })

  it('writeData 写入失败返回 false', () => {
    __fsMock.writeFileSync.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const result = dataManager.writeData({ foo: 'bar' })
    expect(result).toBe(false)
  })
})

describe('dataManager - readSettings/writeSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('readSettings 无文件无旧数据返回默认', () => {
    const settings = dataManager.readSettings()
    expect(settings.minimizeBehavior).toBe('mini')
    expect(settings.autoStart).toBe(false)
  })

  it('readSettings 文件存在返回合并默认值的结果', () => {
    writeSettingsRaw({ showDarkModeBtn: false, autoStart: true })
    const settings = dataManager.readSettings()
    expect(settings.showDarkModeBtn).toBe(false)
    expect(settings.autoStart).toBe(true)
    // 默认值仍合并
    expect(settings.showGardenBtn).toBe(true)
  })

  it('readSettings JSON 解析失败返回默认', () => {
    __fsMock.__setFile(dataManager.getSettingsFilePath(), 'not json')
    const settings = dataManager.readSettings()
    expect(settings.minimizeBehavior).toBe('mini')
  })

  it('readSettings 从 data.json 迁移设置', () => {
    // 写入 data.json 包含 settings 字段
    writeData({ settings: { showDarkModeBtn: false, autoStart: true } })
    // 不写 settings.json
    const settings = dataManager.readSettings()
    expect(settings.showDarkModeBtn).toBe(false)
    expect(settings.autoStart).toBe(true)
    // settings.json 应被创建
    expect(__fsMock.__hasFile(dataManager.getSettingsFilePath())).toBe(true)
  })

  it('readSettings 从 data.json 迁移但 data.json 没有 settings 字段时返回默认', () => {
    writeData({ apiKey: 'k' })
    const settings = dataManager.readSettings()
    expect(settings.minimizeBehavior).toBe('mini')
  })

  it('writeSettings 写入文件', () => {
    dataManager.writeSettings({ foo: 'bar' })
    const raw = __fsMock.__getFile(dataManager.getSettingsFilePath())
    expect(JSON.parse(raw).foo).toBe('bar')
  })
})

describe('dataManager - readGardenFile/writeGardenFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('readGardenFile 文件不存在且无旧数据时使用默认值并写入新文件', () => {
    // 没有 data.json 也没有 garden_data.json
    const garden = dataManager.readGardenFile()
    expect(garden.coins).toBe(0)
    expect(garden.seeds.carrot).toBe(5)
    // 新文件应被创建
    expect(__fsMock.__hasFile(dataManager.getGardenDataFilePath())).toBe(true)
  })

  it('readGardenFile 从 data.json 的 garden 字段迁移', () => {
    // 写入 data.json 包含 garden 字段
    writeData({ garden: { coins: 999, seeds: { carrot: 100 }, plots: [], warehouse: [] } })
    const garden = dataManager.readGardenFile()
    expect(garden.coins).toBe(999)
    expect(garden.seeds.carrot).toBe(100)
    // garden_data.json 应被创建
    expect(__fsMock.__hasFile(dataManager.getGardenDataFilePath())).toBe(true)
    // data.json 中 garden 字段应被清除
    const newData = readDataRaw()
    expect(newData.garden).toBeUndefined()
  })

  it('readGardenFile 文件存在返回解析结果', () => {
    writeGarden({ coins: 50, seeds: {}, plots: [], warehouse: [] })
    const garden = dataManager.readGardenFile()
    expect(garden.coins).toBe(50)
  })

  it('readGardenFile JSON 解析失败返回默认', () => {
    __fsMock.__setFile(dataManager.getGardenDataFilePath(), 'bad json')
    const garden = dataManager.readGardenFile()
    expect(garden.coins).toBe(0)
    expect(garden.seeds.carrot).toBe(5)
  })

  it('writeGardenFile 写入成功', () => {
    const result = dataManager.writeGardenFile({ coins: 7, seeds: {}, plots: [], warehouse: [] })
    expect(result).toBe(true)
    const raw = __fsMock.__getFile(dataManager.getGardenDataFilePath())
    expect(JSON.parse(raw).coins).toBe(7)
  })

  it('writeGardenFile 写入失败返回 false', () => {
    __fsMock.writeFileSync.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const result = dataManager.writeGardenFile({ coins: 7 })
    expect(result).toBe(false)
  })
})

describe('dataManager - gardenPlant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('种子不足时失败', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.seeds = { carrot: 0, tomato: 0, sunflower: 0, rose: 0, osmanthus: 0 }
    writeGarden(garden)
    const result = await dataManager.gardenPlant(0, 'carrot')
    expect(result.success).toBe(false)
    expect(result.message).toContain('种子不足')
  })

  it('土地未解锁时失败', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.seeds.carrot = 5
    writeGarden(garden)
    const result = await dataManager.gardenPlant(6, 'carrot') // plot 6 locked
    expect(result.success).toBe(false)
    expect(result.message).toContain('未解锁')
  })

  it('土地上已有作物时失败', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.seeds.carrot = 5
    garden.plots[0] = { id: 0, crop: 'tomato', progress: 0, plantedAt: 'x' }
    writeGarden(garden)
    const result = await dataManager.gardenPlant(0, 'carrot')
    expect(result.success).toBe(false)
    expect(result.message).toContain('已有作物')
  })

  it('plotIndex 越界时失败', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.seeds.carrot = 5
    writeGarden(garden)
    const result = await dataManager.gardenPlant(99, 'carrot')
    expect(result.success).toBe(false)
    expect(result.message).toContain('未解锁')
  })

  it('种植成功 - 扣种子、写入土地、写文件', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.seeds.carrot = 5
    writeGarden(garden)
    const result = await dataManager.gardenPlant(0, 'carrot')
    expect(result.success).toBe(true)
    expect(result.message).toContain('种植成功')
    const saved = readGardenRaw()
    // 种植消耗 1 颗种子 (5 -> 4)，但 plant1 成就解锁奖励 +1 carrot (4 -> 5)
    expect(saved.seeds.carrot).toBe(5)
    expect(saved.plots[0].crop).toBe('carrot')
    expect(saved.plots[0].plantedAt).not.toBe(null)
    // 成就统计应被更新（plant）
    expect(saved.achievementStats.totalPlantCount).toBe(1)
    // plant1 成就应已解锁
    expect(saved.achievements.plant1.unlocked).toBe(true)
  })
})

describe('dataManager - gardenHarvest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('土地没有作物时失败', async () => {
    writeGarden(defaultGardenWithCoins(100))
    const result = await dataManager.gardenHarvest(0)
    expect(result.success).toBe(false)
    expect(result.message).toContain('没有作物')
  })

  it('作物未成熟时失败', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.plots[0] = { id: 0, crop: 'carrot', progress: 10, plantedAt: 'x' } // 10/25 < 100%
    writeGarden(garden)
    const result = await dataManager.gardenHarvest(0)
    expect(result.success).toBe(false)
    expect(result.message).toContain('未成熟')
  })

  it('收获成功 - 获得金币、清空土地、更新统计', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.plots[0] = { id: 0, crop: 'carrot', progress: 25, plantedAt: 'x' } // 100%
    writeGarden(garden)
    const result = await dataManager.gardenHarvest(0)
    expect(result.success).toBe(true)
    expect(result.message).toContain('收获成功')
    const saved = readGardenRaw()
    expect(saved.plots[0].crop).toBe(null)
    expect(saved.crops.carrot).toBe(1)
    // carrot value=10, reward=floor(10/2)=5
    // 收获奖励 +5，harvest1 成就奖励 +5，collect1 成就奖励 +5 = 115
    expect(saved.coins).toBe(115)
    expect(saved.achievementStats.totalHarvestCount).toBe(1)
    expect(saved.achievementStats.cropTypesCollected).toContain('carrot')
    // totalCoinsEarned 只统计收获奖励，不含成就奖励
    expect(saved.achievementStats.totalCoinsEarned).toBe(5)
    // harvest1 和 collect1 成就应已解锁
    expect(saved.achievements.harvest1.unlocked).toBe(true)
    expect(saved.achievements.collect1.unlocked).toBe(true)
  })
})

describe('dataManager - gardenBuySeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('未知作物类型失败', async () => {
    writeGarden(defaultGardenWithCoins(100))
    const result = await dataManager.gardenBuySeed('unknown_crop')
    expect(result.success).toBe(false)
    expect(result.message).toContain('未知')
  })

  it('金币不足失败', async () => {
    const garden = defaultGardenWithCoins(5) // carrot seedPrice=8
    writeGarden(garden)
    const result = await dataManager.gardenBuySeed('carrot')
    expect(result.success).toBe(false)
    expect(result.message).toContain('金币不足')
  })

  it('购买成功 - 扣金币、加种子', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.seeds.carrot = 0
    writeGarden(garden)
    const result = await dataManager.gardenBuySeed('carrot')
    expect(result.success).toBe(true)
    expect(result.message).toContain('购买成功')
    const saved = readGardenRaw()
    expect(saved.coins).toBe(92) // 100 - 8
    expect(saved.seeds.carrot).toBe(1)
  })
})

describe('dataManager - gardenSellCrop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('没有该作物可出售失败', async () => {
    writeGarden(defaultGardenWithCoins(100))
    const result = await dataManager.gardenSellCrop('carrot')
    expect(result.success).toBe(false)
    expect(result.message).toContain('没有该作物')
  })

  it('出售成功 - 加金币、减作物、更新统计', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.crops = { carrot: 3 }
    writeGarden(garden)
    const result = await dataManager.gardenSellCrop('carrot')
    expect(result.success).toBe(true)
    expect(result.message).toContain('出售成功')
    const saved = readGardenRaw()
    expect(saved.crops.carrot).toBe(2)
    expect(saved.coins).toBe(110) // 100 + 10
    expect(saved.achievementStats.totalCoinsEarned).toBe(10)
  })
})

describe('dataManager - gardenSellAllCrops', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('没有作物可出售失败', async () => {
    writeGarden(defaultGardenWithCoins(100))
    const result = await dataManager.gardenSellAllCrops()
    expect(result.success).toBe(false)
    expect(result.message).toContain('没有作物可出售')
    expect(result.totalItems).toBe(0)
  })

  it('一键出售成功 - 汇总金币、清空作物', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.crops = { carrot: 2, tomato: 1 } // 2*10 + 1*20 = 40
    writeGarden(garden)
    const result = await dataManager.gardenSellAllCrops()
    expect(result.success).toBe(true)
    expect(result.totalCoins).toBe(40)
    expect(result.totalItems).toBe(3)
    const saved = readGardenRaw()
    expect(saved.coins).toBe(140)
    expect(saved.crops.carrot).toBe(0)
    expect(saved.crops.tomato).toBe(0)
  })
})

describe('dataManager - gardenUnlockPlot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('默认土地无需解锁', async () => {
    writeGarden(defaultGardenWithCoins(1000))
    const result = await dataManager.gardenUnlockPlot(0)
    expect(result.success).toBe(false)
    expect(result.message).toContain('无需解锁')
  })

  it('已解锁土地失败', async () => {
    const garden = defaultGardenWithCoins(1000)
    garden.plots[6] = { id: 6, crop: null, progress: 0, plantedAt: null, locked: false }
    writeGarden(garden)
    const result = await dataManager.gardenUnlockPlot(6)
    expect(result.success).toBe(false)
    expect(result.message).toContain('已解锁')
  })

  it('金币土地 - 金币不足失败', async () => {
    const garden = defaultGardenWithCoins(50) // plot 6 price=100
    writeGarden(garden)
    const result = await dataManager.gardenUnlockPlot(6)
    expect(result.success).toBe(false)
    expect(result.message).toContain('金币不足')
  })

  it('金币土地 - 解锁成功扣金币', async () => {
    const garden = defaultGardenWithCoins(200)
    writeGarden(garden)
    const result = await dataManager.gardenUnlockPlot(6)
    expect(result.success).toBe(true)
    expect(result.message).toContain('解锁成功')
    const saved = readGardenRaw()
    expect(saved.coins).toBe(100) // 200 - 100
    expect(saved.plots[6].locked).toBe(false)
  })

  it('成就土地 - 成就未达成失败', async () => {
    const garden = defaultGardenWithCoins(1000)
    // plot 8 需要 signin100 成就
    writeGarden(garden)
    const result = await dataManager.gardenUnlockPlot(8)
    expect(result.success).toBe(false)
    expect(result.message).toContain('成就未达成')
  })

  it('成就土地 - 成就已达成解锁成功', async () => {
    const garden = defaultGardenWithCoins(1000)
    garden.achievements = { signin100: { unlocked: true, unlockedAt: 'x' } }
    writeGarden(garden)
    const result = await dataManager.gardenUnlockPlot(8)
    expect(result.success).toBe(true)
    expect(result.message).toContain('解锁成功')
    const saved = readGardenRaw()
    expect(saved.plots[8].locked).toBe(false)
  })

  it('成就土地 - coins5000 成就达成解锁 plot 9', async () => {
    const garden = defaultGardenWithCoins(1000)
    garden.achievements = { coins5000: { unlocked: true, unlockedAt: 'x' } }
    writeGarden(garden)
    const result = await dataManager.gardenUnlockPlot(9)
    expect(result.success).toBe(true)
  })
})

describe('dataManager - gardenSignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('今日已签到失败', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.signIn = {
      lastDate: new Date().toDateString(),
      continuousDays: 1,
      totalDays: 1,
      weekRecords: [false, false, false, false, false, false, false]
    }
    writeGarden(garden)
    const result = await dataManager.gardenSignIn()
    expect(result.success).toBe(false)
    expect(result.message).toContain('已签到')
    expect(result.rewards).toBe(null)
  })

  it('首次签到 - continuousDays=1, totalDays=1', async () => {
    const garden = defaultGardenWithCoins(100)
    writeGarden(garden)
    const result = await dataManager.gardenSignIn()
    expect(result.success).toBe(true)
    expect(result.rewards).toBeDefined()
    const saved = readGardenRaw()
    expect(saved.signIn.continuousDays).toBe(1)
    expect(saved.signIn.totalDays).toBe(1)
    expect(saved.signIn.lastDate).toBe(new Date().toDateString())
  })

  it('连续签到 - 昨天+1天', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const garden = defaultGardenWithCoins(100)
    garden.signIn = {
      lastDate: yesterday.toDateString(),
      continuousDays: 2,
      totalDays: 2,
      weekRecords: [false, false, false, false, false, false, false]
    }
    writeGarden(garden)
    const result = await dataManager.gardenSignIn()
    expect(result.success).toBe(true)
    const saved = readGardenRaw()
    expect(saved.signIn.continuousDays).toBe(3)
    expect(saved.signIn.totalDays).toBe(3)
  })

  it('断签 - 超过 1 天重置为 1', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    const garden = defaultGardenWithCoins(100)
    garden.signIn = {
      lastDate: threeDaysAgo.toDateString(),
      continuousDays: 5,
      totalDays: 5,
      weekRecords: [true, true, true, true, true, true, true]
    }
    writeGarden(garden)
    const result = await dataManager.gardenSignIn()
    expect(result.success).toBe(true)
    const saved = readGardenRaw()
    expect(saved.signIn.continuousDays).toBe(1)
    expect(saved.signIn.weekRecords.every((v, i) => i === new Date().getDay() ? v : !v)).toBe(true)
  })

  it('签到获得基础奖励（种子+金币）', async () => {
    const garden = defaultGardenWithCoins(0)
    writeGarden(garden)
    const result = await dataManager.gardenSignIn()
    expect(result.success).toBe(true)
    expect(result.rewards.seeds.carrot).toBeGreaterThanOrEqual(1)
    expect(result.rewards.coins).toBeGreaterThanOrEqual(5)
  })

  it('连续签到 3 天触发额外奖励', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const garden = defaultGardenWithCoins(0)
    garden.signIn = {
      lastDate: yesterday.toDateString(),
      continuousDays: 2, // 下次签到=3天，触发 tomato 种子奖励
      totalDays: 2,
      weekRecords: [false, false, false, false, false, false, false]
    }
    writeGarden(garden)
    const result = await dataManager.gardenSignIn()
    expect(result.success).toBe(true)
    expect(result.rewards.seeds.tomato).toBeGreaterThanOrEqual(1)
  })
})

describe('dataManager - gardenUpdateFocusMinutes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('更新专注分钟数并写入文件', async () => {
    writeGarden(defaultGardenWithCoins(100))
    const result = await dataManager.gardenUpdateFocusMinutes(60)
    expect(result.garden.achievementStats.totalFocusMinutes).toBe(60)
    const saved = readGardenRaw()
    expect(saved.achievementStats.totalFocusMinutes).toBe(60)
  })

  it('达到 1 小时解锁 focus1h 成就', async () => {
    writeGarden(defaultGardenWithCoins(100))
    const result = await dataManager.gardenUpdateFocusMinutes(60)
    expect(result.unlockedAchievements.find(a => a.id === 'focus1h')).toBeDefined()
    const saved = readGardenRaw()
    expect(saved.achievements.focus1h.unlocked).toBe(true)
    // 奖励：3 carrot 种子 + 10 金币
    expect(saved.seeds.carrot).toBeGreaterThanOrEqual(3)
    expect(saved.coins).toBeGreaterThanOrEqual(110)
  })
})

describe('dataManager - updateGardenProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('为有作物的未锁定土地增加进度', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.plots[0] = { id: 0, crop: 'carrot', progress: 5, plantedAt: 'x' }
    garden.plots[1] = { id: 1, crop: 'tomato', progress: 10, plantedAt: 'x' }
    // plot 6 locked + has crop
    garden.plots[6] = { id: 6, crop: 'carrot', progress: 5, plantedAt: 'x', locked: true }
    writeGarden(garden)
    const plots = await dataManager.updateGardenProgress(2)
    const plot0 = plots.find(p => p.id === 0)
    const plot1 = plots.find(p => p.id === 1)
    const plot6 = plots.find(p => p.id === 6)
    expect(plot0.progress).toBe(7)
    expect(plot1.progress).toBe(12)
    expect(plot6.progress).toBe(5) // locked, no change
  })

  it('无作物时不更新', async () => {
    writeGarden(defaultGardenWithCoins(100))
    const plots = await dataManager.updateGardenProgress(2)
    expect(plots).toHaveLength(12)
    // 文件不应被修改（无变化）
    // 但 readGardenFile 会创建默认文件
  })

  it('使用默认参数 minutes=1', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.plots[0] = { id: 0, crop: 'carrot', progress: 5, plantedAt: 'x' }
    writeGarden(garden)
    const plots = await dataManager.updateGardenProgress()
    const plot0 = plots.find(p => p.id === 0)
    expect(plot0.progress).toBe(6)
  })
})

describe('dataManager - handleGardenPunishment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('未成熟作物被惩罚 - 清空且记录损失', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.plots[0] = { id: 0, crop: 'carrot', progress: 10, plantedAt: 'x' } // 10 < 25
    garden.plots[1] = { id: 1, crop: 'tomato', progress: 60, plantedAt: 'x' } // 60 > 50, 已成熟，不损失
    writeGarden(garden)
    const result = await dataManager.handleGardenPunishment()
    expect(result.hasLoss).toBe(true)
    expect(result.losses).toHaveLength(1)
    expect(result.losses[0].crop).toBe('carrot')
    expect(result.totalMinutes).toBe(10)
    const saved = readGardenRaw()
    expect(saved.plots[0].crop).toBe(null)
    expect(saved.plots[1].crop).toBe('tomato') // 成熟作物不被惩罚
  })

  it('无作物时不损失', async () => {
    writeGarden(defaultGardenWithCoins(100))
    const result = await dataManager.handleGardenPunishment()
    expect(result.hasLoss).toBe(false)
    expect(result.losses).toEqual([])
    expect(result.totalMinutes).toBe(0)
  })

  it('锁定土地上的作物不被惩罚', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.plots[6] = { id: 6, crop: 'carrot', progress: 10, plantedAt: 'x', locked: true }
    writeGarden(garden)
    const result = await dataManager.handleGardenPunishment()
    expect(result.hasLoss).toBe(false)
  })
})

describe('dataManager - withGardenLock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('串行化并发操作', async () => {
    const order = []
    const p1 = dataManager.withGardenLock(async () => {
      order.push('p1-start')
      await new Promise((r) => setTimeout(r, 50))
      order.push('p1-end')
      return 'p1'
    })
    const p2 = dataManager.withGardenLock(async () => {
      order.push('p2-start')
      await new Promise((r) => setTimeout(r, 10))
      order.push('p2-end')
      return 'p2'
    })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe('p1')
    expect(r2).toBe('p2')
    expect(order).toEqual(['p1-start', 'p1-end', 'p2-start', 'p2-end'])
  })

  it('异常时释放锁', async () => {
    await expect(
      dataManager.withGardenLock(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    // 锁应已释放，可再次获取
    const result = await dataManager.withGardenLock(async () => 'ok')
    expect(result).toBe('ok')
  })
})

describe('dataManager - 成就系统', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('收获成就 harvest1 - 收获 1 个作物解锁', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.plots[0] = { id: 0, crop: 'carrot', progress: 25, plantedAt: 'x' }
    writeGarden(garden)
    const result = await dataManager.gardenHarvest(0)
    expect(result.unlockedAchievements.find(a => a.id === 'harvest1')).toBeDefined()
    const saved = readGardenRaw()
    expect(saved.achievements.harvest1.unlocked).toBe(true)
  })

  it('种植成就 plant1 - 种植 1 次解锁', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.seeds.carrot = 5
    writeGarden(garden)
    const result = await dataManager.gardenPlant(0, 'carrot')
    expect(result.unlockedAchievements.find(a => a.id === 'plant1')).toBeDefined()
  })

  it('收藏成就 collect1 - 收获 1 种作物解锁', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.plots[0] = { id: 0, crop: 'carrot', progress: 25, plantedAt: 'x' }
    writeGarden(garden)
    await dataManager.gardenHarvest(0)
    const saved = readGardenRaw()
    expect(saved.achievements.collect1.unlocked).toBe(true)
  })

  it('财富成就 coins100 - 累计 100 金币解锁', async () => {
    const garden = defaultGardenWithCoins(0)
    garden.plots[0] = { id: 0, crop: 'carrot', progress: 25, plantedAt: 'x' }
    // 收获给 5 金币；出售 carrot 给 10 金币 = 15，需要更多
    // 改为直接预设状态后调用 gardenUpdateFocusMinutes(0) 触发检查
    garden.achievementStats = {
      totalFocusMinutes: 0,
      totalHarvestCount: 0,
      totalPlantCount: 0,
      totalCoinsEarned: 100,
      cropTypesCollected: []
    }
    writeGarden(garden)
    const result = await dataManager.gardenUpdateFocusMinutes(0)
    expect(result.unlockedAchievements.find(a => a.id === 'coins100')).toBeDefined()
  })

  it('坚持成就 signin7 - 连续签到 7 天解锁', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const garden = defaultGardenWithCoins(100)
    garden.signIn = {
      lastDate: yesterday.toDateString(), // 昨天签到，今天 diffDays=1，continuousDays 6 -> 7
      continuousDays: 6,
      totalDays: 6,
      weekRecords: [false, false, false, false, false, false, false]
    }
    writeGarden(garden)
    const result = await dataManager.gardenSignIn()
    expect(result.unlockedAchievements.find(a => a.id === 'signin7')).toBeDefined()
  })

  it('已解锁成就不重复解锁', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.achievements = { focus1h: { unlocked: true, unlockedAt: 'x' } }
    garden.achievementStats = {
      totalFocusMinutes: 60,
      totalHarvestCount: 0,
      totalPlantCount: 0,
      totalCoinsEarned: 0,
      cropTypesCollected: []
    }
    writeGarden(garden)
    const result = await dataManager.gardenUpdateFocusMinutes(0)
    expect(result.unlockedAchievements.find(a => a.id === 'focus1h')).toBeUndefined()
  })

  it('wealth 类别 - getAchievementProgress 通过 totalCoinsEarned', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.achievementStats = {
      totalFocusMinutes: 0,
      totalHarvestCount: 0,
      totalPlantCount: 0,
      totalCoinsEarned: 5000,
      cropTypesCollected: []
    }
    writeGarden(garden)
    const result = await dataManager.gardenUpdateFocusMinutes(0)
    expect(result.unlockedAchievements.find(a => a.id === 'coins5000')).toBeDefined()
  })

  it('collect 类别 - 收获 5 种不同作物解锁 collect5', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.achievementStats = {
      totalFocusMinutes: 0,
      totalHarvestCount: 5,
      totalPlantCount: 0,
      totalCoinsEarned: 0,
      cropTypesCollected: ['carrot', 'tomato', 'sunflower', 'rose', 'osmanthus']
    }
    writeGarden(garden)
    const result = await dataManager.gardenUpdateFocusMinutes(0)
    expect(result.unlockedAchievements.find(a => a.id === 'collect5')).toBeDefined()
  })

  it('harvest 类别 - 收获 100 个作物解锁 harvest100', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.achievementStats = {
      totalFocusMinutes: 0,
      totalHarvestCount: 100,
      totalPlantCount: 0,
      totalCoinsEarned: 0,
      cropTypesCollected: ['carrot']
    }
    writeGarden(garden)
    const result = await dataManager.gardenUpdateFocusMinutes(0)
    expect(result.unlockedAchievements.find(a => a.id === 'harvest100')).toBeDefined()
  })

  it('plant 类别 - 种植 100 次解锁 plant100', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.achievementStats = {
      totalFocusMinutes: 0,
      totalHarvestCount: 0,
      totalPlantCount: 100,
      totalCoinsEarned: 0,
      cropTypesCollected: []
    }
    writeGarden(garden)
    const result = await dataManager.gardenUpdateFocusMinutes(0)
    expect(result.unlockedAchievements.find(a => a.id === 'plant100')).toBeDefined()
  })

  it('成就解锁时发放种子奖励', async () => {
    const garden = defaultGardenWithCoins(100)
    garden.achievementStats = {
      totalFocusMinutes: 60,
      totalHarvestCount: 0,
      totalPlantCount: 0,
      totalCoinsEarned: 0,
      cropTypesCollected: []
    }
    writeGarden(garden)
    await dataManager.gardenUpdateFocusMinutes(0)
    const saved = readGardenRaw()
    // focus1h 奖励：3 carrot + 10 coins
    expect(saved.seeds.carrot).toBeGreaterThanOrEqual(3)
    expect(saved.coins).toBeGreaterThanOrEqual(110)
  })
})

describe('dataManager - readGardenData (locked)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __fsMock.__clear()
  })

  it('readGardenData 通过锁读取数据', async () => {
    writeGarden(defaultGardenWithCoins(123))
    const garden = await dataManager.readGardenData()
    expect(garden.coins).toBe(123)
  })
})
