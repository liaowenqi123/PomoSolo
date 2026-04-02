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
   * 成就配置
   */
  const ACHIEVEMENT_CONFIG = {
    // 专注成就
    focus1h: { 
      id: 'focus1h',
      category: 'focus',
      name: '初心者', 
      description: '累计专注 1 小时',
      target: 60,  // 分钟
      icon: '⏱️',
      rewards: { seeds: { carrot: 3 }, coins: 10 }
    },
    focus5h: { 
      id: 'focus5h',
      category: 'focus',
      name: '专注新手', 
      description: '累计专注 5 小时',
      target: 300,
      icon: '⏱️',
      rewards: { seeds: { tomato: 2 }, coins: 20 }
    },
    focus25h: { 
      id: 'focus25h',
      category: 'focus',
      name: '专注达人', 
      description: '累计专注 25 小时',
      target: 1500,
      icon: '🎯',
      rewards: { seeds: { sunflower: 1 }, coins: 50 }
    },
    focus50h: { 
      id: 'focus50h',
      category: 'focus',
      name: '专注大师', 
      description: '累计专注 50 小时',
      target: 3000,
      icon: '🏆',
      rewards: { seeds: { rose: 1 }, coins: 100 }
    },
    focus100h: { 
      id: 'focus100h',
      category: 'focus',
      name: '专注传奇', 
      description: '累计专注 100 小时',
      target: 6000,
      icon: '👑',
      rewards: { seeds: { osmanthus: 1 }, coins: 200 }
    },
    
    // 收获成就
    harvest1: { 
      id: 'harvest1',
      category: 'harvest',
      name: '初次丰收', 
      description: '收获 1 个作物',
      target: 1,
      icon: '🌾',
      rewards: { seeds: {}, coins: 5 }
    },
    harvest10: { 
      id: 'harvest10',
      category: 'harvest',
      name: '小有收成', 
      description: '收获 10 个作物',
      target: 10,
      icon: '🌾',
      rewards: { seeds: { carrot: 2 }, coins: 15 }
    },
    harvest50: { 
      id: 'harvest50',
      category: 'harvest',
      name: '丰收达人', 
      description: '收获 50 个作物',
      target: 50,
      icon: '🌻',
      rewards: { seeds: { tomato: 2 }, coins: 30 }
    },
    harvest100: { 
      id: 'harvest100',
      category: 'harvest',
      name: '丰收大师', 
      description: '收获 100 个作物',
      target: 100,
      icon: '🏆',
      rewards: { seeds: { sunflower: 2 }, coins: 60 }
    },
    harvest500: { 
      id: 'harvest500',
      category: 'harvest',
      name: '丰收传奇', 
      description: '收获 500 个作物',
      target: 500,
      icon: '👑',
      rewards: { seeds: { osmanthus: 2 }, coins: 200 }
    },
    
    // 种植成就
    plant1: { 
      id: 'plant1',
      category: 'plant',
      name: '新手农夫', 
      description: '种植 1 次',
      target: 1,
      icon: '🌱',
      rewards: { seeds: { carrot: 1 }, coins: 0 }
    },
    plant10: { 
      id: 'plant10',
      category: 'plant',
      name: '勤劳农夫', 
      description: '种植 10 次',
      target: 10,
      icon: '🌱',
      rewards: { seeds: {}, coins: 10 }
    },
    plant50: { 
      id: 'plant50',
      category: 'plant',
      name: '种植达人', 
      description: '种植 50 次',
      target: 50,
      icon: '🌿',
      rewards: { seeds: { tomato: 2 }, coins: 20 }
    },
    plant100: { 
      id: 'plant100',
      category: 'plant',
      name: '种植大师', 
      description: '种植 100 次',
      target: 100,
      icon: '🏆',
      rewards: { seeds: { sunflower: 1 }, coins: 50 }
    },
    plant500: { 
      id: 'plant500',
      category: 'plant',
      name: '种植传奇', 
      description: '种植 500 次',
      target: 500,
      icon: '👑',
      rewards: { seeds: { rose: 1 }, coins: 100 }
    },
    
    // 收藏成就
    collect1: { 
      id: 'collect1',
      category: 'collect',
      name: '初次收藏', 
      description: '收获任意 1 种作物',
      target: 1,
      icon: '📦',
      rewards: { seeds: {}, coins: 5 }
    },
    collect3: { 
      id: 'collect3',
      category: 'collect',
      name: '多样收藏', 
      description: '收获 3 种不同作物',
      target: 3,
      icon: '🎁',
      rewards: { seeds: {}, coins: 30 }
    },
    collect5: { 
      id: 'collect5',
      category: 'collect',
      name: '全集收藏', 
      description: '收获全部 5 种作物',
      target: 5,
      icon: '👑',
      rewards: { seeds: { osmanthus: 1 }, coins: 100 }
    },
    
    // 财富成就
    coins100: { 
      id: 'coins100',
      category: 'wealth',
      name: '小富翁', 
      description: '累计获得 100 金币',
      target: 100,
      icon: '💰',
      rewards: { seeds: { carrot: 3 }, coins: 0 }
    },
    coins500: { 
      id: 'coins500',
      category: 'wealth',
      name: '中富翁', 
      description: '累计获得 500 金币',
      target: 500,
      icon: '💰',
      rewards: { seeds: { tomato: 2 }, coins: 0 }
    },
    coins1000: { 
      id: 'coins1000',
      category: 'wealth',
      name: '大富翁', 
      description: '累计获得 1000 金币',
      target: 1000,
      icon: '💎',
      rewards: { seeds: { rose: 1 }, coins: 0 }
    },
    coins5000: { 
      id: 'coins5000',
      category: 'wealth',
      name: '富豪', 
      description: '累计获得 5000 金币',
      target: 5000,
      icon: '👑',
      rewards: { seeds: { osmanthus: 2 }, coins: 0 }
    },
    
    // 坚持成就
    signin7: { 
      id: 'signin7',
      category: 'persist',
      name: '坚持一周', 
      description: '连续签到 7 天',
      target: 7,
      icon: '📅',
      rewards: { seeds: { sunflower: 1 }, coins: 0 }
    },
    signin30: { 
      id: 'signin30',
      category: 'persist',
      name: '坚持一月', 
      description: '连续签到 30 天',
      target: 30,
      icon: '📅',
      rewards: { seeds: { rose: 1 }, coins: 0 }
    },
    signin100: { 
      id: 'signin100',
      category: 'persist',
      name: '坚持百日', 
      description: '连续签到 100 天',
      target: 100,
      icon: '👑',
      rewards: { seeds: { osmanthus: 2 }, coins: 0 }
    }
  }

  // 成就分类配置
  const ACHIEVEMENT_CATEGORIES = {
    focus: { name: '专注', icon: '⏱️' },
    harvest: { name: '收获', icon: '🌾' },
    plant: { name: '种植', icon: '🌱' },
    collect: { name: '收藏', icon: '📦' },
    wealth: { name: '财富', icon: '💰' },
    persist: { name: '坚持', icon: '📅' }
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
        },
        // 成就系统
        achievements: {},  // 已解锁的成就 { achievementId: { unlocked: true, unlockedAt: '2024-01-01' } }
        achievementStats: {
          totalFocusMinutes: 0,     // 累计专注分钟数
          totalHarvestCount: 0,     // 累计收获次数
          totalPlantCount: 0,       // 累计种植次数
          totalCoinsEarned: 0,      // 累计获得的金币
          cropTypesCollected: []    // 已收集的作物类型 ['carrot', 'tomato', ...]
        }
      },
      theme: 'light',
      // 设置
      settings: {
        // 计时器设置
        minimizeBehavior: 'mini',  // 'mini' 迷你模式 | 'minimize' 最小化到任务栏
        // 界面显示
        showDarkModeBtn: true,     // 显示深色模式按钮
        showGardenBtn: true,       // 显示菜园子按钮
        showStatsBtn: true,        // 显示统计按钮
        showAiBtn: true,           // 显示AI助手按钮
        showSidebarCollapseBtn: true, // 显示侧边栏收起按钮
        showHeaderExpandBtn: true, // 显示功能按钮展开/收起按钮
        // 音乐播放器
        showShuffleBtn: true,      // 显示随机/顺序播放按钮
        showVolumeBtn: true,       // 显示音量调节按钮
        showDeviceBtn: true,       // 显示设备切换按钮
        showChartsBtn: true,       // 显示热榜歌单按钮
        // 系统
        autoStart: false           // 开机自启动
      }
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
    WEEKLY_REWARDS: WEEKLY_REWARDS,
    ACHIEVEMENT_CONFIG: ACHIEVEMENT_CONFIG,
    ACHIEVEMENT_CATEGORIES: ACHIEVEMENT_CATEGORIES
  }
})()
