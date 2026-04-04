/**
 * 数据管理模块 - 主进程
 * 处理本地数据文件的读写
 */

const fs = require('fs')
const path = require('path')
const { app } = require('electron')

let dataFilePath = null

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
    musicVolume: 1.0,  // 音乐音量 0-1
    // 菜园子系统
    garden: {
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

// ============ 菜园子专用接口（带锁保护） ============

/**
 * 读取菜园子数据（带锁）
 * 强制从文件读取最新数据
 * @returns {Promise<object>}
 */
async function readGardenData() {
  return withGardenLock(() => {
    const data = readData()
    return data.garden || createDefaultData().garden
  })
}

/**
 * 更新菜园子数据（带锁）
 * 先从文件读取最新数据，合并修改后写回
 * @param {object} gardenUpdate - 菜园子数据更新
 * @returns {Promise<object>} - 更新后的完整菜园子数据
 */
async function updateGardenData(gardenUpdate) {
  return withGardenLock(() => {
    const data = readData()
    
    // 智能合并 plots：保留 progress 更大的版本
    const mergedPlots = mergePlots(data.garden?.plots, gardenUpdate.plots)
    
    // 深度合并，保留原有数据
    data.garden = {
      ...data.garden,
      ...gardenUpdate,
      // 确保嵌套对象也被正确合并
      seeds: { ...data.garden?.seeds, ...gardenUpdate.seeds },
      crops: { ...data.garden?.crops, ...gardenUpdate.crops },
      plots: mergedPlots,
      achievements: { ...data.garden?.achievements, ...gardenUpdate.achievements },
      achievementStats: { ...data.garden?.achievementStats, ...gardenUpdate.achievementStats },
      signIn: { ...data.garden?.signIn, ...gardenUpdate.signIn }
    }
    writeData(data)
    return data.garden
  })
}

/**
 * 智能合并两个 plots 数组
 * 规则：按 id 匹配，保留 progress 更大的版本
 * @param {Array} existingPlots - 文件中已有的 plots
 * @param {Array} newPlots - 更新传入的 plots
 * @returns {Array} - 合并后的 plots
 */
function mergePlots(existingPlots = [], newPlots) {
  if (!newPlots) return existingPlots
  
  const existingMap = new Map()
  for (const plot of (existingPlots || [])) {
    if (plot && plot.id !== undefined) {
      existingMap.set(plot.id, plot)
    }
  }
  
  const result = []
  const allIds = new Set([
    ...(existingPlots || []).map(p => p?.id).filter(id => id !== undefined),
    ...newPlots.map(p => p?.id).filter(id => id !== undefined)
  ])
  
  for (const id of allIds) {
    const existing = existingMap.get(id)
    const newPlot = newPlots.find(p => p?.id === id)
    
    if (existing && newPlot) {
      // 都存在：保留 progress 更大的
      // 但如果 newPlot 是收割后清空的（crop 为 null），以 newPlot 为准
      if (newPlot.crop === null) {
        result.push({ ...newPlot })
      } else if (existing.crop === null && newPlot.crop) {
        // 原来是空的，新种了作物
        result.push({ ...newPlot })
      } else if ((newPlot.progress || 0) >= (existing.progress || 0)) {
        result.push({ ...newPlot })
      } else {
        result.push({ ...existing })
      }
    } else if (newPlot) {
      result.push({ ...newPlot })
    } else if (existing) {
      result.push({ ...existing })
    }
  }
  
  return result.sort((a, b) => (a.id || 0) - (b.id || 0))
}

/**
 * 更新作物进度（带锁）
 * 专用于 timer.js 的 updateProgress 调用
 * @param {number} minutes - 增加的分钟数
 * @returns {Promise<object>} - 更新后的 plots 数组
 */
async function updateGardenProgress(minutes = 1) {
  return withGardenLock(() => {
    const data = readData()
    if (!data.garden) {
      data.garden = createDefaultData().garden
    }
    
    const plots = data.garden.plots || []
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
      data.garden.plots = plots
      writeData(data)
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
    const data = readData()
    if (!data.garden) {
      return { hasLoss: false, losses: [], totalMinutes: 0 }
    }
    
    const plots = data.garden.plots || []
    const CROP_CONFIG = {
      carrot: { name: '胡萝卜', icon: '🥕', growTime: 25, value: 10 },
      tomato: { name: '番茄', icon: '🍅', growTime: 50, value: 20 },
      sunflower: { name: '向日葵', icon: '🌻', growTime: 90, value: 50 },
      rose: { name: '玫瑰', icon: '🌹', growTime: 120, value: 80 },
      osmanthus: { name: '金桂树', icon: '🌳', growTime: 180, value: 150 }
    }
    
    const losses = []
    let totalMinutes = 0
    
    for (let i = 0; i < plots.length; i++) {
      const plot = plots[i]
      if (!plot.locked && plot.crop && plot.progress !== null) {
        const cropConfig = CROP_CONFIG[plot.crop]
        if (cropConfig) {
          const progress = plot.progress
          const totalTime = cropConfig.growTime
          // 如果未成熟，作物枯萎
          if (progress < totalTime) {
            losses.push({
              crop: plot.crop,
              name: cropConfig.name,
              icon: cropConfig.icon,
              progress: progress,
              growTime: totalTime
            })
            totalMinutes += progress
            
            // 清空格子
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
      data.garden.plots = plots
      writeData(data)
    }
    
    return { hasLoss, losses, totalMinutes }
  })
}

module.exports = {
  getDataFilePath,
  ensureDataDir,
  createDefaultData,
  readData,
  writeData,
  // 菜园子专用接口（带锁）
  readGardenData,
  updateGardenData,
  updateGardenProgress,
  handleGardenPunishment,
  withGardenLock
}
