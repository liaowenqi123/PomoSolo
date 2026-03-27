/**
 * 公共工具函数模块
 */
;(function() {
  'use strict'

  /**
   * 格式化时间为 MM:SS 格式
   * @param {number} seconds - 秒数
   * @param {boolean} showLeadingZero - 是否显示分钟前导零，默认 true
   * @returns {string} 格式化后的时间字符串
   */
  function formatTime(seconds, showLeadingZero = true) {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    if (showLeadingZero) {
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  /**
   * 默认预设配置
   */
  const DEFAULT_PRESETS = {
    work: [15, 25, 45, 60],
    break: [5, 10, 15]
  }

  /**
   * 作物配置
   */
  const CROP_CONFIG = {
    carrot: { name: '胡萝卜', growTime: 25, icon: '🥕', seedType: 'carrot', rarity: 'common', value: 10, seedPrice: 8, sellPrice: 10 },
    tomato: { name: '番茄', growTime: 50, icon: '🍅', seedType: 'tomato', rarity: 'common', value: 20, seedPrice: 16, sellPrice: 20 },
    sunflower: { name: '向日葵', growTime: 90, icon: '🌻', seedType: 'sunflower', rarity: 'rare', value: 50, seedPrice: 40, sellPrice: 50 },
    rose: { name: '玫瑰', growTime: 120, icon: '🌹', seedType: 'rose', rarity: 'rare', value: 80, seedPrice: 64, sellPrice: 80 },
    osmanthus: { name: '金桂树', growTime: 180, icon: '🌳', seedType: 'osmanthus', rarity: 'legend', value: 150, seedPrice: 120, sellPrice: 150 }
  }

  /**
   * 签到奖励配置
   */
  // 每日基础奖励
  const DAILY_REWARD = {
    seeds: { carrot: 1 },
    coins: 5
  }

  // 连续签到奖励（达到指定天数额外获得）
  const CONTINUOUS_REWARDS = {
    3:  { seeds: { tomato: 1 }, coins: 0, message: '连续签到3天！' },
    7:  { seeds: { sunflower: 1 }, coins: 0, message: '连续签到7天！' },
    14: { seeds: { rose: 1 }, coins: 0, message: '连续签到14天！' },
    30: { seeds: { osmanthus: 1 }, coins: 0, message: '连续签到30天！' }
  }

  // 每周循环奖励（0=周日, 1=周一...）
  const WEEKLY_REWARDS = {
    1: { seeds: { carrot: 2 }, coins: 0, message: '周一奖励' },
    2: { seeds: {}, coins: 10, message: '周二奖励' },
    3: { seeds: { tomato: 1 }, coins: 0, message: '周三奖励' },
    4: { seeds: {}, coins: 10, message: '周四奖励' },
    5: { seeds: { sunflower: 1 }, coins: 0, message: '周五奖励' },
    6: { seeds: {}, coins: 0, randomSeed: true, message: '周六随机奖励' },
    0: { seeds: {}, coins: 20, message: '周日奖励' }
  }

  /**
   * 创建默认数据结构
   * @returns {Object} 默认数据对象
   */
  function createDefaultData() {
    return {
      stats: {
        date: new Date().toDateString(),
        todayCount: 0,
        totalMinutes: 0
      },
      presets: { ...DEFAULT_PRESETS },
      planList: [],
      audioDevice: null,
      // 菜园子系统
      garden: {
        coins: 0,
        seeds: { carrot: 5, tomato: 2, sunflower: 0, rose: 0, osmanthus: 0 },
        crops: {}, // 作物背包：存储已收获的作物
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
        warehouse: [],
        // 签到系统
        signIn: {
          lastDate: null,           // 上次签到日期
          continuousDays: 0,        // 连续签到天数
          totalDays: 0,             // 累计签到天数
          weekRecords: [false, false, false, false, false, false, false]  // 本周签到记录
        }
      },
      theme: 'light'  
    }
  }

  // 导出到全局
  window.Utils = {
    formatTime: formatTime,
    DEFAULT_PRESETS: DEFAULT_PRESETS,
    createDefaultData: createDefaultData,
    CROP_CONFIG: CROP_CONFIG,
    DAILY_REWARD: DAILY_REWARD,
    CONTINUOUS_REWARDS: CONTINUOUS_REWARDS,
    WEEKLY_REWARDS: WEEKLY_REWARDS
  }
})()
