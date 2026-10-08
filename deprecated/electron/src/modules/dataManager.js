/**
 * 数据管理模块 - 主进程
 * 处理本地数据文件的读写
 */

const fs = require('fs')
const path = require('path')
const { app } = require('electron')

let dataFilePath = null
let gardenDataFilePath = null
let settingsFilePath = null
let settingsDataFilePath = null

// ============ 游戏配置（与 utils.js 保持同步） ============

const CROP_CONFIG = {
  carrot: { name: '胡萝卜', growTime: 25, icon: '🥕', seedType: 'carrot', rarity: 'common', value: 10, seedPrice: 8, sellPrice: 10 },
  tomato: { name: '番茄', growTime: 50, icon: '🍅', seedType: 'tomato', rarity: 'common', value: 20, seedPrice: 16, sellPrice: 20 },
  sunflower: { name: '向日葵', growTime: 90, icon: '🌻', seedType: 'sunflower', rarity: 'rare', value: 50, seedPrice: 40, sellPrice: 50 },
  rose: { name: '玫瑰', growTime: 120, icon: '🌹', seedType: 'rose', rarity: 'rare', value: 80, seedPrice: 64, sellPrice: 80 },
  osmanthus: { name: '金桂树', growTime: 180, icon: '🌳', seedType: 'osmanthus', rarity: 'legend', value: 150, seedPrice: 120, sellPrice: 150 }
}

const DAILY_REWARD = {
  seeds: { carrot: 1 },
  coins: 5
}

const CONTINUOUS_REWARDS = {
  3:  { seeds: { tomato: 1 }, coins: 0 },
  7:  { seeds: { sunflower: 1 }, coins: 0 },
  14: { seeds: { rose: 1 }, coins: 0 },
  30: { seeds: { osmanthus: 1 }, coins: 0 }
}

const WEEKLY_REWARDS = {
  1: { seeds: { carrot: 2 }, coins: 0 },
  2: { seeds: {}, coins: 10 },
  3: { seeds: { tomato: 1 }, coins: 0 },
  4: { seeds: {}, coins: 10 },
  5: { seeds: { sunflower: 1 }, coins: 0 },
  6: { seeds: {}, coins: 0, randomSeed: true },
  0: { seeds: {}, coins: 20 }
}

const PLOT_UNLOCK_CONFIG = {
  0: { type: 'default' },
  1: { type: 'default' },
  2: { type: 'default' },
  3: { type: 'default' },
  4: { type: 'default' },
  5: { type: 'default' },
  6: { type: 'coins', price: 100 },
  7: { type: 'coins', price: 150 },
  8: { type: 'achievement', achievementId: 'signin100', description: '连续签到100天' },
  9: { type: 'achievement', achievementId: 'coins5000', description: '累计获得5000金币' },
  10: { type: 'coins', price: 500 },
  11: { type: 'coins', price: 800 }
}

const ACHIEVEMENT_CONFIG = {
  // 专注成就
  focus1h: { id: 'focus1h', category: 'focus', name: '初心者', description: '累计专注 1 小时', target: 60, icon: '⏱️', rewards: { seeds: { carrot: 3 }, coins: 10 } },
  focus5h: { id: 'focus5h', category: 'focus', name: '专注新手', description: '累计专注 5 小时', target: 300, icon: '⏱️', rewards: { seeds: { tomato: 2 }, coins: 20 } },
  focus25h: { id: 'focus25h', category: 'focus', name: '专注达人', description: '累计专注 25 小时', target: 1500, icon: '🎯', rewards: { seeds: { sunflower: 1 }, coins: 50 } },
  focus50h: { id: 'focus50h', category: 'focus', name: '专注大师', description: '累计专注 50 小时', target: 3000, icon: '🏆', rewards: { seeds: { rose: 1 }, coins: 100 } },
  focus100h: { id: 'focus100h', category: 'focus', name: '专注传奇', description: '累计专注 100 小时', target: 6000, icon: '👑', rewards: { seeds: { osmanthus: 1 }, coins: 200 } },
  // 收获成就
  harvest1: { id: 'harvest1', category: 'harvest', name: '初次丰收', description: '收获 1 个作物', target: 1, icon: '🌾', rewards: { seeds: {}, coins: 5 } },
  harvest10: { id: 'harvest10', category: 'harvest', name: '小有收成', description: '收获 10 个作物', target: 10, icon: '🌾', rewards: { seeds: { carrot: 2 }, coins: 15 } },
  harvest50: { id: 'harvest50', category: 'harvest', name: '丰收达人', description: '收获 50 个作物', target: 50, icon: '🌻', rewards: { seeds: { tomato: 2 }, coins: 30 } },
  harvest100: { id: 'harvest100', category: 'harvest', name: '丰收大师', description: '收获 100 个作物', target: 100, icon: '🏆', rewards: { seeds: { sunflower: 2 }, coins: 60 } },
  harvest500: { id: 'harvest500', category: 'harvest', name: '丰收传奇', description: '收获 500 个作物', target: 500, icon: '👑', rewards: { seeds: { osmanthus: 2 }, coins: 200 } },
  // 种植成就
  plant1: { id: 'plant1', category: 'plant', name: '新手农夫', description: '种植 1 次', target: 1, icon: '🌱', rewards: { seeds: { carrot: 1 }, coins: 0 } },
  plant10: { id: 'plant10', category: 'plant', name: '勤劳农夫', description: '种植 10 次', target: 10, icon: '🌱', rewards: { seeds: {}, coins: 10 } },
  plant50: { id: 'plant50', category: 'plant', name: '种植达人', description: '种植 50 次', target: 50, icon: '🌿', rewards: { seeds: { tomato: 2 }, coins: 20 } },
  plant100: { id: 'plant100', category: 'plant', name: '种植大师', description: '种植 100 次', target: 100, icon: '🏆', rewards: { seeds: { sunflower: 1 }, coins: 50 } },
  plant500: { id: 'plant500', category: 'plant', name: '种植传奇', description: '种植 500 次', target: 500, icon: '👑', rewards: { seeds: { rose: 1 }, coins: 100 } },
  // 收藏成就
  collect1: { id: 'collect1', category: 'collect', name: '初次收藏', description: '收获任意 1 种作物', target: 1, icon: '📦', rewards: { seeds: {}, coins: 5 } },
  collect3: { id: 'collect3', category: 'collect', name: '多样收藏', description: '收获 3 种不同作物', target: 3, icon: '🎁', rewards: { seeds: {}, coins: 30 } },
  collect5: { id: 'collect5', category: 'collect', name: '全集收藏', description: '收获全部 5 种作物', target: 5, icon: '👑', rewards: { seeds: { osmanthus: 1 }, coins: 100 } },
  // 财富成就
  coins100: { id: 'coins100', category: 'wealth', name: '小富翁', description: '累计获得 100 金币', target: 100, icon: '💰', rewards: { seeds: { carrot: 3 }, coins: 0 } },
  coins500: { id: 'coins500', category: 'wealth', name: '中富翁', description: '累计获得 500 金币', target: 500, icon: '💰', rewards: { seeds: { tomato: 2 }, coins: 0 } },
  coins1000: { id: 'coins1000', category: 'wealth', name: '大富翁', description: '累计获得 1000 金币', target: 1000, icon: '💎', rewards: { seeds: { rose: 1 }, coins: 0 } },
  coins5000: { id: 'coins5000', category: 'wealth', name: '富豪', description: '累计获得 5000 金币', target: 5000, icon: '👑', rewards: { seeds: { osmanthus: 2 }, coins: 0 } },
  // 坚持成就
  signin7: { id: 'signin7', category: 'persist', name: '坚持一周', description: '连续签到 7 天', target: 7, icon: '📅', rewards: { seeds: { sunflower: 1 }, coins: 0 } },
  signin30: { id: 'signin30', category: 'persist', name: '坚持一月', description: '连续签到 30 天', target: 30, icon: '📅', rewards: { seeds: { rose: 1 }, coins: 0 } },
  signin100: { id: 'signin100', category: 'persist', name: '坚持百日', description: '连续签到 100 天', target: 100, icon: '👑', rewards: { seeds: { osmanthus: 2 }, coins: 0 } }
}

// ============ 互斥锁机制 ============
// 用于保护菜园子数据的并发访问

let gardenLock = {
  locked: false,
  queue: []
}

/**
 * 获取菜园子数据锁
 * @returns {Promise<void>}
 */
async function acquireGardenLock() {
  return new Promise((resolve) => {
    if (!gardenLock.locked) {
      gardenLock.locked = true
      resolve()
    } else {
      gardenLock.queue.push(resolve)
    }
  })
}

/**
 * 释放菜园子数据锁
 */
function releaseGardenLock() {
  if (gardenLock.queue.length > 0) {
    const next = gardenLock.queue.shift()
    next()
  } else {
    gardenLock.locked = false
  }
}

/**
 * 使用锁执行操作
 * @param {Function} fn - 要执行的异步函数
 * @returns {Promise<any>}
 */
async function withGardenLock(fn) {
  await acquireGardenLock()
  try {
    return await fn()
  } finally {
    releaseGardenLock()
  }
}

// ============ 基础数据操作 ============

/**
 * 获取数据文件路径
 * @returns {string}
 */
function getDataFilePath() {
  if (dataFilePath) return dataFilePath
  
  // 数据存放在用户数据目录（可读写）
  // 开发环境和打包后都使用这个路径
  const userDataPath = app.getPath('userData')
  dataFilePath = path.join(userDataPath, 'data', 'data.json')
  return dataFilePath
}

/**
 * 获取菜园子数据文件路径
 * @returns {string}
 */
function getGardenDataFilePath() {
  if (gardenDataFilePath) return gardenDataFilePath
  const userDataPath = app.getPath('userData')
  gardenDataFilePath = path.join(userDataPath, 'data', 'garden_data.json')
  return gardenDataFilePath
}

/**
 * 获取设置数据文件路径
 * @returns {string}
 */
function getSettingsFilePath() {
  if (settingsFilePath) return settingsFilePath
  const userDataPath = app.getPath('userData')
  settingsFilePath = path.join(userDataPath, 'data', 'settings.json')
  return settingsFilePath
}

/**
 * 创建默认设置
 * @returns {object}
 */
function createDefaultSettings() {
  return {
    // 计时器设置
    minimizeBehavior: 'mini',
    miniExitMode: 'arrow',
    // 界面显示
    showDarkModeBtn: true,
    showGardenBtn: true,
    showStatsBtn: true,
    showAiBtn: true,
    showStudyRoomBtn: true,
    showSidebarCollapseBtn: true,
    showHeaderExpandBtn: true,
    // 音乐播放器
    showShuffleBtn: true,
    showVolumeBtn: true,
    showDeviceBtn: true,
    showChartsBtn: true,
    advancedColorCustomization: false,
    // 音乐播放器快捷键
    musicHotkeys: {
      pause: ['Key.ctrl_r', 'Key.shift_r'],
      next: ['Key.ctrl_r', 'Key.right'],
      prev: ['Key.ctrl_r', 'Key.left'],
      volUp: ['Key.ctrl_r', 'Key.up'],
      volDown: ['Key.ctrl_r', 'Key.down']
    },
    // 系统
    autoStart: false
  }
}

/**
 * 读取设置数据（独立文件）
 * @returns {object}
 */
function readSettings() {
  const filePath = getSettingsFilePath()
  
  // 如果文件不存在，尝试从 data.json 迁移
  if (!fs.existsSync(filePath)) {
    const data = readData()
    if (data && data.settings) {
      // 迁移设置到新文件
      ensureDataDir()
      const settings = { ...createDefaultSettings(), ...data.settings }
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8')
      console.log('[DataManager] 设置已从 data.json 迁移到 settings.json')
      return settings
    }
    // 没有旧数据，返回默认设置
    return createDefaultSettings()
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const settings = JSON.parse(content)
    // 合并默认值（处理新增设置项）
    return { ...createDefaultSettings(), ...settings }
  } catch (err) {
    console.error('[DataManager] 读取设置失败:', err)
    return createDefaultSettings()
  }
}

/**
 * 写入设置数据（独立文件）
 * @param {object} settings
 */
function writeSettings(settings) {
  const filePath = getSettingsFilePath()
  ensureDataDir()
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8')
}

/**
 * 确保数据目录存在
 */
function ensureDataDir() {
  const dataDir = path.dirname(getDataFilePath())
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

/**
 * 创建默认数据结构（与渲染进程 utils.js 保持一致）
 * 注意：garden 字段已独立到 garden_data.json，此处不再包含
 * @returns {object}
 */
function createDefaultData() {
  return {
    apiKey: null, // DeepSeek API Key（本地配置模式时使用）
    apiMode: 'cloud', // 'cloud' 云端登录模式 | 'local' 本地配置模式
    stats: {
      date: new Date().toDateString(),
      todayCount: 0,
      totalMinutes: 0
    },
    presets: {
      work: [15, 25, 45, 60],
      break: [5, 10, 15]
    },
    planList: [],
    audioDevice: null,
    musicVolume: 1.0  // 音乐音量 0-1
  }
}

/**
 * 创建默认菜园子数据结构
 * @returns {object}
 */
function createDefaultGardenData() {
  return {
    coins: 0,
    seeds: { carrot: 5, tomato: 2, sunflower: 0, rose: 0, osmanthus: 0 },
    plots: [
      { id: 0, crop: null, progress: 0, plantedAt: null },
      { id: 1, crop: null, progress: 0, plantedAt: null },
      { id: 2, crop: null, progress: 0, plantedAt: null },
      { id: 3, crop: null, progress: 0, plantedAt: null },
      { id: 4, crop: null, progress: 0, plantedAt: null },
      { id: 5, crop: null, progress: 0, plantedAt: null },
      { id: 6, crop: null, progress: 0, plantedAt: null, locked: true },
      { id: 7, crop: null, progress: 0, plantedAt: null, locked: true },
      { id: 8, crop: null, progress: 0, plantedAt: null, locked: true },
      { id: 9, crop: null, progress: 0, plantedAt: null, locked: true },
      { id: 10, crop: null, progress: 0, plantedAt: null, locked: true },
      { id: 11, crop: null, progress: 0, plantedAt: null, locked: true }
    ],
    warehouse: []
  }
}

/**
 * 读取数据
 * @returns {object}
 */
function readData() {
  ensureDataDir()
  const filePath = getDataFilePath()
  const defaultData = createDefaultData()
  
  // 如果文件不存在，创建默认数据
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf-8')
    return defaultData
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  } catch (e) {
    console.error('[DataManager] 读取数据文件失败:', e)
    return defaultData
  }
}

/**
 * 写入数据
 * @param {object} data - 数据对象
 * @returns {boolean}
 */
function writeData(data) {
  ensureDataDir()
  const filePath = getDataFilePath()
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error('[DataManager] 写入数据文件失败:', e)
    return false
  }
}

// ============ 菜园子独立文件读写 ============

// 缓存：避免重复读取文件
/**
 * 读取菜园子数据文件（garden_data.json）
 * 若文件不存在，自动从 data.json 迁移旧数据或使用默认值
 * @returns {object}
 */
function readGardenFile() {
  ensureDataDir()
  const filePath = getGardenDataFilePath()

  if (!fs.existsSync(filePath)) {
    // 尝试从旧 data.json 迁移 garden 字段
    const oldData = readData()
    const gardenData = (oldData && oldData.garden) ? oldData.garden : createDefaultGardenData()

    // 写入新文件完成迁移
    fs.writeFileSync(filePath, JSON.stringify(gardenData, null, 2), 'utf-8')
    console.log('[DataManager] 菜园子数据已从 data.json 迁移到 garden_data.json')

    // 将旧 data.json 中的 garden 字段清除，避免歧义
    if (oldData && oldData.garden) {
      delete oldData.garden
      writeData(oldData)
    }

    return gardenData
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  } catch (e) {
    console.error('[DataManager] 读取 garden_data.json 失败:', e)
    return createDefaultGardenData()
  }
}

/**
 * 写入菜园子数据文件（garden_data.json）
 * @param {object} gardenData - 菜园子数据对象
 * @returns {boolean}
 */
function writeGardenFile(gardenData) {
  ensureDataDir()
  const filePath = getGardenDataFilePath()
  try {
    fs.writeFileSync(filePath, JSON.stringify(gardenData, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error('[DataManager] 写入 garden_data.json 失败:', e)
    return false
  }
}

// ============ 菜园子原子操作接口（带锁保护） ============
// 所有操作都是原子性的：读取 -> 修改 -> 写回
// 读写均使用独立的 garden_data.json，与 data.json 完全隔离
// 返回最新的菜园子数据，确保数据一致性

/**
 * 读取菜园子数据（带锁）
 * 强制从文件读取最新数据
 * @returns {Promise<object>}
 */
async function readGardenData() {
  return withGardenLock(() => {
    return readGardenFile()
  })
}

/**
 * 种植作物
 * @param {number} plotIndex - 土地索引
 * @param {string} cropKey - 作物类型
 * @returns {Promise<{success: boolean, message: string, garden: object}>}
 */
async function gardenPlant(plotIndex, cropKey) {
  return withGardenLock(() => {
    const garden = readGardenFile()
    
    // 检查种子数量
    const seeds = garden.seeds || {}
    if (!seeds[cropKey] || seeds[cropKey] <= 0) {
      return { success: false, message: '种子不足', garden }
    }
    
    // 检查土地状态
    const plots = garden.plots || []
    const plot = plots[plotIndex]
    if (!plot || plot.locked) {
      return { success: false, message: '土地未解锁', garden }
    }
    if (plot.crop) {
      return { success: false, message: '土地上已有作物', garden }
    }
    
    // 执行种植
    seeds[cropKey]--
    garden.seeds = seeds
    garden.plots[plotIndex] = {
      id: plotIndex,
      crop: cropKey,
      progress: 0,
      plantedAt: new Date().toISOString()
    }
    
    // 更新成就统计
    updateAchievementStatsInPlace(garden, 'plant', null)
    
    // 检查成就
    const unlockedAchievements = checkAndUnlockAchievementsInPlace(garden)
    
    writeGardenFile(garden)
    
    return { 
      success: true, 
      message: `种植成功！${CROP_CONFIG[cropKey].name}`, 
      garden,
      unlockedAchievements
    }
  })
}

/**
 * 收获作物
 * @param {number} plotIndex - 土地索引
 * @returns {Promise<{success: boolean, message: string, garden: object}>}
 */
async function gardenHarvest(plotIndex) {
  return withGardenLock(() => {
    const garden = readGardenFile()
    
    const plots = garden.plots || []
    const plot = plots[plotIndex]
    
    if (!plot || !plot.crop) {
      return { success: false, message: '该土地没有作物', garden }
    }
    
    const cropConfig = CROP_CONFIG[plot.crop]
    const progress = (plot.progress / cropConfig.growTime) * 100
    
    if (progress < 100) {
      return { success: false, message: '作物还未成熟', garden }
    }
    
    // 执行收获
    garden.crops = garden.crops || {}
    garden.crops[plot.crop] = (garden.crops[plot.crop] || 0) + 1
    
    // 获得金币（作物价值的一半）
    const reward = Math.floor(cropConfig.value / 2)
    garden.coins = (garden.coins || 0) + reward
    
    // 清空土地
    garden.plots[plotIndex] = {
      id: plotIndex,
      crop: null,
      progress: 0,
      plantedAt: null
    }
    
    // 更新成就统计
    updateAchievementStatsInPlace(garden, 'harvest', plot.crop)
    updateAchievementStatsInPlace(garden, 'coins', reward)
    
    // 检查成就
    const unlockedAchievements = checkAndUnlockAchievementsInPlace(garden)
    
    writeGardenFile(garden)
    
    return { 
      success: true, 
      message: `收获成功！${cropConfig.name} x1，金币 +${reward}`, 
      garden,
      unlockedAchievements
    }
  })
}

/**
 * 购买种子
 * @param {string} cropKey - 作物类型
 * @returns {Promise<{success: boolean, message: string, garden: object}>}
 */
async function gardenBuySeed(cropKey) {
  return withGardenLock(() => {
    const garden = readGardenFile()
    const cropConfig = CROP_CONFIG[cropKey]
    
    if (!cropConfig) {
      return { success: false, message: '未知的作物类型', garden }
    }
    
    const coins = garden.coins || 0
    if (coins < cropConfig.seedPrice) {
      return { success: false, message: '金币不足', garden }
    }
    
    // 执行购买
    garden.coins = coins - cropConfig.seedPrice
    garden.seeds = garden.seeds || {}
    garden.seeds[cropKey] = (garden.seeds[cropKey] || 0) + 1
    
    writeGardenFile(garden)
    
    return { success: true, message: `购买成功！${cropConfig.name}种子 x1`, garden }
  })
}

/**
 * 出售作物
 * @param {string} cropKey - 作物类型
 * @returns {Promise<{success: boolean, message: string, garden: object}>}
 */
async function gardenSellCrop(cropKey) {
  return withGardenLock(() => {
    const garden = readGardenFile()
    const cropConfig = CROP_CONFIG[cropKey]
    
    const crops = garden.crops || {}
    if (!crops[cropKey] || crops[cropKey] <= 0) {
      return { success: false, message: '没有该作物可出售', garden }
    }
    
    // 执行出售
    crops[cropKey]--
    garden.coins = (garden.coins || 0) + cropConfig.sellPrice
    
    // 更新成就统计
    updateAchievementStatsInPlace(garden, 'coins', cropConfig.sellPrice)
    
    // 检查成就
    const unlockedAchievements = checkAndUnlockAchievementsInPlace(garden)
    
    writeGardenFile(garden)
    
    return { 
      success: true, 
      message: `出售成功！获得 💰${cropConfig.sellPrice}`, 
      garden,
      unlockedAchievements
    }
  })
}

/**
 * 一键出售所有作物
 * @returns {Promise<{success: boolean, message: string, garden: object, totalCoins: number, totalItems: number}>}
 */
async function gardenSellAllCrops() {
  return withGardenLock(() => {
    const garden = readGardenFile()
    const crops = garden.crops || {}
    
    let totalCoins = 0
    let totalItems = 0
    
    Object.keys(crops).forEach(cropKey => {
      const count = crops[cropKey]
      if (count > 0) {
        const crop = CROP_CONFIG[cropKey]
        if (crop) {
          totalCoins += crop.sellPrice * count
          totalItems += count
        }
        crops[cropKey] = 0
      }
    })
    
    if (totalItems === 0) {
      return { success: false, message: '没有作物可出售', garden, totalCoins: 0, totalItems: 0 }
    }
    
    garden.coins = (garden.coins || 0) + totalCoins
    
    // 更新成就统计
    updateAchievementStatsInPlace(garden, 'coins', totalCoins)
    
    // 检查成就
    const unlockedAchievements = checkAndUnlockAchievementsInPlace(garden)
    
    writeGardenFile(garden)
    
    return { 
      success: true, 
      message: `出售成功！共 ${totalItems} 个作物，获得 💰${totalCoins}`, 
      garden, 
      totalCoins, 
      totalItems,
      unlockedAchievements
    }
  })
}

/**
 * 解锁土地（金币）
 * @param {number} plotIndex - 土地索引
 * @returns {Promise<{success: boolean, message: string, garden: object}>}
 */
async function gardenUnlockPlot(plotIndex) {
  return withGardenLock(() => {
    const garden = readGardenFile()
    const unlockConfig = PLOT_UNLOCK_CONFIG[plotIndex]
    
    if (!unlockConfig || unlockConfig.type === 'default') {
      return { success: false, message: '该土地无需解锁', garden }
    }
    
    const plot = garden.plots[plotIndex]
    if (!plot || !plot.locked) {
      return { success: false, message: '该土地已解锁', garden }
    }
    
    if (unlockConfig.type === 'coins') {
      const coins = garden.coins || 0
      if (coins < unlockConfig.price) {
        return { success: false, message: '金币不足', garden }
      }
      
      garden.coins = coins - unlockConfig.price
      garden.plots[plotIndex] = {
        id: plotIndex,
        crop: null,
        progress: 0,
        plantedAt: null,
        locked: false
      }
      
      writeGardenFile(garden)
      
      return { success: true, message: `解锁成功！花费 💰${unlockConfig.price}`, garden }
      
    } else if (unlockConfig.type === 'achievement') {
      const achievements = garden.achievements || {}
      const achievement = achievements[unlockConfig.achievementId]
      
      if (!achievement || !achievement.unlocked) {
        return { success: false, message: `成就未达成：${unlockConfig.description}`, garden }
      }
      
      garden.plots[plotIndex] = {
        id: plotIndex,
        crop: null,
        progress: 0,
        plantedAt: null,
        locked: false
      }
      
      writeGardenFile(garden)
      
      return { success: true, message: `解锁成功！达成成就「${unlockConfig.description}」`, garden }
    }
    
    return { success: false, message: '未知的解锁方式', garden }
  })
}

/**
 * 签到
 * @returns {Promise<{success: boolean, message: string, garden: object, rewards: object}>}
 */
async function gardenSignIn() {
  return withGardenLock(() => {
    const garden = readGardenFile()
    
    const today = new Date()
    const todayStr = today.toDateString()
    
    const signIn = garden.signIn || {
      lastDate: null,
      continuousDays: 0,
      totalDays: 0,
      weekRecords: [false, false, false, false, false, false, false]
    }
    
    // 检查是否已签到
    if (signIn.lastDate === todayStr) {
      return { success: false, message: '今日已签到', garden, rewards: null }
    }
    
    // 计算连续签到
    if (signIn.lastDate) {
      const lastDate = new Date(signIn.lastDate)
      const diffTime = today - lastDate
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
      
      if (diffDays === 1) {
        signIn.continuousDays++
      } else if (diffDays > 1) {
        signIn.continuousDays = 1
        signIn.weekRecords = [false, false, false, false, false, false, false]
      }
    } else {
      signIn.continuousDays = 1
    }
    
    signIn.lastDate = todayStr
    signIn.totalDays++
    
    const dayOfWeek = today.getDay()
    signIn.weekRecords[dayOfWeek] = true
    
    // 发放奖励
    const rewards = { seeds: {}, coins: 0 }
    let totalCoinsEarned = 0
    
    // 每日基础奖励
    Object.entries(DAILY_REWARD.seeds).forEach(([seedKey, count]) => {
      garden.seeds[seedKey] = (garden.seeds[seedKey] || 0) + count
      rewards.seeds[seedKey] = (rewards.seeds[seedKey] || 0) + count
    })
    totalCoinsEarned += DAILY_REWARD.coins
    rewards.coins += DAILY_REWARD.coins
    
    // 每周奖励
    const weeklyReward = WEEKLY_REWARDS[dayOfWeek]
    if (weeklyReward) {
      if (weeklyReward.randomSeed) {
        const seedKeys = Object.keys(CROP_CONFIG)
        const randomKey = seedKeys[Math.floor(Math.random() * seedKeys.length)]
        garden.seeds[randomKey] = (garden.seeds[randomKey] || 0) + 1
        rewards.seeds[randomKey] = (rewards.seeds[randomKey] || 0) + 1
      } else {
        Object.entries(weeklyReward.seeds).forEach(([seedKey, count]) => {
          garden.seeds[seedKey] = (garden.seeds[seedKey] || 0) + count
          rewards.seeds[seedKey] = (rewards.seeds[seedKey] || 0) + count
        })
        totalCoinsEarned += weeklyReward.coins
        rewards.coins += weeklyReward.coins
      }
    }
    
    // 连续签到奖励
    const continuousReward = CONTINUOUS_REWARDS[signIn.continuousDays]
    if (continuousReward) {
      Object.entries(continuousReward.seeds).forEach(([seedKey, count]) => {
        garden.seeds[seedKey] = (garden.seeds[seedKey] || 0) + count
        rewards.seeds[seedKey] = (rewards.seeds[seedKey] || 0) + count
      })
      totalCoinsEarned += continuousReward.coins
      rewards.coins += continuousReward.coins
    }
    
    garden.coins = (garden.coins || 0) + totalCoinsEarned
    garden.signIn = signIn
    
    // 更新成就统计
    if (totalCoinsEarned > 0) {
      updateAchievementStatsInPlace(garden, 'coins', totalCoinsEarned)
    }
    
    // 检查成就
    const unlockedAchievements = checkAndUnlockAchievementsInPlace(garden)
    
    writeGardenFile(garden)
    
    return { 
      success: true, 
      message: '签到成功！', 
      garden, 
      rewards,
      unlockedAchievements
    }
  })
}

/**
 * 更新成就进度（专注时间）
 * @param {number} minutes - 专注分钟数
 * @returns {Promise<{garden: object, unlockedAchievements: array}>}
 */
async function gardenUpdateFocusMinutes(minutes) {
  return withGardenLock(() => {
    const garden = readGardenFile()
    
    updateAchievementStatsInPlace(garden, 'focus', minutes)
    const unlockedAchievements = checkAndUnlockAchievementsInPlace(garden)
    
    writeGardenFile(garden)
    
    return { garden, unlockedAchievements }
  })
}

/**
 * 更新作物进度（带锁）
 * 专用于 timer.js 的 updateProgress 调用
 * @param {number} minutes - 增加的分钟数
 * @returns {Promise<object>} - 更新后的 plots 数组
 */
async function updateGardenProgress(minutes = 1) {
  return withGardenLock(() => {
    const garden = readGardenFile()
    
    const plots = garden.plots || []
    let hasChanges = false
    
    for (let i = 0; i < plots.length; i++) {
      const plot = plots[i]
      // 只有未锁定且有作物的格子才生长
      if (!plot.locked && plot.crop && plot.progress !== null) {
        plot.progress += minutes
        hasChanges = true
      }
    }
    
    if (hasChanges) {
      garden.plots = plots
      writeGardenFile(garden)
    }
    
    return plots
  })
}

/**
 * 处理重置惩罚（带锁）
 * 专注模式下重置计时器时调用
 * @returns {Promise<object>} - { hasLoss, losses, totalMinutes }
 */
async function handleGardenPunishment() {
  return withGardenLock(() => {
    const garden = readGardenFile()
    
    const plots = garden.plots || []
    const losses = []
    let totalMinutes = 0
    
    for (let i = 0; i < plots.length; i++) {
      const plot = plots[i]
      if (!plot.locked && plot.crop && plot.progress !== null) {
        const cropConfig = CROP_CONFIG[plot.crop]
        if (cropConfig) {
          const progress = plot.progress
          const totalTime = cropConfig.growTime
          if (progress < totalTime) {
            losses.push({
              crop: plot.crop,
              name: cropConfig.name,
              icon: cropConfig.icon,
              progress: progress,
              growTime: totalTime
            })
            totalMinutes += progress
            
            plots[i] = {
              id: i,
              crop: null,
              progress: 0,
              plantedAt: null
            }
          }
        }
      }
    }
    
    const hasLoss = losses.length > 0
    
    if (hasLoss) {
      garden.plots = plots
      writeGardenFile(garden)
    }
    
    return { hasLoss, losses, totalMinutes }
  })
}

// ============ 成就系统辅助函数 ============

/**
 * 更新成就统计（原地修改 garden 对象）
 * @param {object} garden - 菜园子数据对象
 * @param {string} type - 更新类型: 'focus' | 'harvest' | 'plant' | 'coins'
 * @param {any} value - 更新值
 */
function updateAchievementStatsInPlace(garden, type, value) {
  if (!garden.achievementStats) {
    garden.achievementStats = {
      totalFocusMinutes: 0,
      totalHarvestCount: 0,
      totalPlantCount: 0,
      totalCoinsEarned: 0,
      cropTypesCollected: []
    }
  }
  
  const stats = garden.achievementStats
  
  switch (type) {
    case 'focus':
      stats.totalFocusMinutes = (stats.totalFocusMinutes || 0) + value
      break
    case 'harvest':
      stats.totalHarvestCount = (stats.totalHarvestCount || 0) + 1
      if (value && !stats.cropTypesCollected.includes(value)) {
        stats.cropTypesCollected.push(value)
      }
      break
    case 'plant':
      stats.totalPlantCount = (stats.totalPlantCount || 0) + 1
      break
    case 'coins':
      stats.totalCoinsEarned = (stats.totalCoinsEarned || 0) + value
      break
  }
}

/**
 * 检查并解锁成就（原地修改 garden 对象）
 * @param {object} garden - 菜园子数据对象
 * @returns {array} - 新解锁的成就列表
 */
function checkAndUnlockAchievementsInPlace(garden) {
  const achievements = garden.achievements || {}
  const stats = garden.achievementStats || {}
  const unlockedAchievements = []
  
  Object.keys(ACHIEVEMENT_CONFIG).forEach(achievementId => {
    // 已解锁则跳过
    if (achievements[achievementId] && achievements[achievementId].unlocked) {
      return
    }
    
    const config = ACHIEVEMENT_CONFIG[achievementId]
    const progress = getAchievementProgress(config, stats, garden)
    
    // 达成条件
    if (progress >= config.target) {
      achievements[achievementId] = {
        unlocked: true,
        unlockedAt: new Date().toISOString()
      }
      unlockedAchievements.push(config)
      
      // 发放奖励
      if (config.rewards) {
        if (config.rewards.seeds) {
          garden.seeds = garden.seeds || {}
          Object.entries(config.rewards.seeds).forEach(([seedKey, count]) => {
            garden.seeds[seedKey] = (garden.seeds[seedKey] || 0) + count
          })
        }
        if (config.rewards.coins > 0) {
          garden.coins = (garden.coins || 0) + config.rewards.coins
        }
      }
    }
  })
  
  garden.achievements = achievements
  return unlockedAchievements
}

/**
 * 获取成就进度
 * @param {object} config - 成就配置
 * @param {object} stats - 成就统计数据
 * @param {object} garden - 菜园子数据
 * @returns {number}
 */
function getAchievementProgress(config, stats, garden) {
  switch (config.category) {
    case 'focus':
      return stats.totalFocusMinutes || 0
    case 'harvest':
      return stats.totalHarvestCount || 0
    case 'plant':
      return stats.totalPlantCount || 0
    case 'collect':
      return (stats.cropTypesCollected || []).length
    case 'wealth':
      return stats.totalCoinsEarned || 0
    case 'persist':
      return (garden.signIn && garden.signIn.continuousDays) || 0
    default:
      return 0
  }
}

module.exports = {
  getDataFilePath,
  getGardenDataFilePath,
  getSettingsFilePath,
  ensureDataDir,
  createDefaultData,
  createDefaultGardenData,
  createDefaultSettings,
  readData,
  writeData,
  // 菜园子独立文件读写（直接操作 garden_data.json）
  readGardenFile,
  writeGardenFile,
  // 菜园子原子操作接口（带锁）
  readGardenData,
  gardenPlant,
  gardenHarvest,
  gardenBuySeed,
  gardenSellCrop,
  gardenSellAllCrops,
  gardenUnlockPlot,
  gardenSignIn,
  gardenUpdateFocusMinutes,
  // Timer 调用的接口
  updateGardenProgress,
  handleGardenPunishment,
  withGardenLock,
  // 设置独立文件读写
  readSettings,
  writeSettings
}
