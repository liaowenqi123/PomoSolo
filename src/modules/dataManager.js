/**
 * 数据管理模块 - 主进程
 * 处理本地数据文件的读写
 */

const fs = require('fs')
const path = require('path')
const { app } = require('electron')

let dataFilePath = null

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

module.exports = {
  getDataFilePath,
  ensureDataDir,
  createDefaultData,
  readData,
  writeData
}
