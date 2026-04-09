/**
 * 菜园子模块 - 主入口
 * 协调各个子模块，管理全局状态
 * 
 * 架构说明：
 * - 不维护内存副本，每次操作都从持久化存储读取最新数据
 * - 所有修改操作通过原子 IPC 调用，主进程负责"读取-修改-写回"
 * - 收到 garden-refresh 事件时重新读取数据并渲染
 */
;(function() {
  'use strict'

  // DOM 元素
  let elements = {}

  // 当前页面是否是菜园子页面
  let isGardenPage = false
  
  // 当前数据（仅用于渲染，不缓存修改）
  let currentGardenData = null
  let selectedSeed = null
  
  /**
   * 初始化菜园子
   */
  async function init() {
    // 检测当前页面是否是菜园子页面
    if (!document.getElementById('gardenGrid')) {
      return
    }
    isGardenPage = true

    // 获取 DOM 元素
    elements = {
      coinCount: document.getElementById('coinCount'),
      gardenGrid: document.getElementById('gardenGrid'),
      seedList: document.getElementById('seedList'),
      cropList: document.getElementById('cropList'),
      gardenTip: document.getElementById('gardenTip'),
      gardenCloseBtn: document.getElementById('gardenCloseBtn'),
      bagsContainer: document.getElementById('bagsContainer'),
      seedBag: document.getElementById('garden-seed-bag'),
      cropBag: document.getElementById('garden-crop-bag'),
      // 商店相关
      shopBtn: document.getElementById('shopBtn'),
      shopModal: document.getElementById('shopModal'),
      shopCloseBtn: document.getElementById('shopCloseBtn'),
      shopBuyGrid: document.getElementById('shopBuyGrid'),
      shopSellGrid: document.getElementById('shopSellGrid'),
      sellAllBtn: document.getElementById('sellAllBtn'),
      // 签到相关
      signinBtn: document.getElementById('signinBtn'),
      signinModal: document.getElementById('signinModal'),
      signinCloseBtn: document.getElementById('signinCloseBtn'),
      signinContinuous: document.getElementById('signinContinuous'),
      signinTotal: document.getElementById('signinTotal'),
      signinWeekDots: document.getElementById('signinWeekDots'),
      signinRewardsList: document.getElementById('signinRewardsList'),
      signinConfirmBtn: document.getElementById('signinConfirmBtn'),
      // 成就墙相关
      achievementBtn: document.getElementById('achievementBtn'),
      achievementModal: document.getElementById('achievementModal'),
      achievementCloseBtn: document.getElementById('achievementCloseBtn'),
      achievementUnlocked: document.getElementById('achievementUnlocked'),
      achievementTotal: document.getElementById('achievementTotal'),
      achievementTabs: document.getElementById('achievementTabs'),
      achievementList: document.getElementById('achievementList')
    }
    
    // 初始化子模块
    initSubModules()

    // 绑定关闭按钮事件
    elements.gardenCloseBtn.addEventListener('click', () => {
      const gardenFrame = document.querySelector('.garden-frame')
      if (gardenFrame) {
        gardenFrame.classList.add('closing')
        setTimeout(() => {
          window.electronAPI.closeGarden()
        }, 500)
      } else {
        window.electronAPI.closeGarden()
      }
    })

    // 监听刷新事件
    if (window.electronAPI && window.electronAPI.onGardenRefresh) {
      window.electronAPI.onGardenRefresh(async () => {
        await loadAndRender()
      })
    }

    // 加载数据并渲染
    await loadAndRender()
  }
  
  /**
   * 初始化子模块
   */
  function initSubModules() {
    // 初始化背包
    if (window.GardenBag) {
      GardenBag.initBagEvents()
    }
    
    // 初始化商店
    if (window.GardenShop) {
      GardenShop.init({
        shopBtn: elements.shopBtn,
        shopModal: elements.shopModal,
        shopCloseBtn: elements.shopCloseBtn,
        shopBuyGrid: elements.shopBuyGrid,
        shopSellGrid: elements.shopSellGrid,
        sellAllBtn: elements.sellAllBtn
      })
      
      // 绑定商店按钮
      if (elements.shopBtn) {
        elements.shopBtn.addEventListener('click', () => {
          GardenShop.openShop(currentGardenData, updateTip)
        })
      }
    }
    
    // 初始化签到
    if (window.GardenSignin) {
      GardenSignin.init({
        signinBtn: elements.signinBtn,
        signinModal: elements.signinModal,
        signinCloseBtn: elements.signinCloseBtn,
        signinContinuous: elements.signinContinuous,
        signinTotal: elements.signinTotal,
        signinWeekDots: elements.signinWeekDots,
        signinRewardsList: elements.signinRewardsList,
        signinConfirmBtn: elements.signinConfirmBtn
      })
      
      // 绑定签到按钮
      if (elements.signinBtn) {
        elements.signinBtn.addEventListener('click', () => {
          GardenSignin.openSigninModal(currentGardenData, updateTip)
        })
      }
    }
    
    // 初始化成就墙
    if (window.GardenAchievement) {
      GardenAchievement.init({
        achievementBtn: elements.achievementBtn,
        achievementModal: elements.achievementModal,
        achievementCloseBtn: elements.achievementCloseBtn,
        achievementUnlocked: elements.achievementUnlocked,
        achievementTotal: elements.achievementTotal,
        achievementTabs: elements.achievementTabs,
        achievementList: elements.achievementList
      })
      
      // 绑定成就按钮
      if (elements.achievementBtn) {
        elements.achievementBtn.addEventListener('click', async () => {
          await loadAndRender()
          GardenAchievement.openAchievementModal(currentGardenData)
        })
      }
    }
  }

  /**
   * 从持久化存储读取数据并渲染
   */
  async function loadAndRender() {
    try {
      currentGardenData = await window.electronAPI.gardenRead()
      render()
    } catch (e) {
      console.error('加载菜园数据失败:', e)
      currentGardenData = Utils.createDefaultData().garden
      render()
    }
    
    // 数据加载完成后触发入场动画
    requestAnimationFrame(() => {
      const gardenFrame = document.querySelector('.garden-frame')
      if (gardenFrame && !gardenFrame.classList.contains('ready')) {
        gardenFrame.classList.add('ready')
      }
    })
  }

  /**
   * 渲染界面
   */
  function render() {
    if (!currentGardenData) return
    renderCoins()
    renderPlots()
    renderSeeds()
    renderCrops()
    updateSigninBtnStatus()
  }

  /**
   * 渲染金币
   */
  function renderCoins() {
    elements.coinCount.textContent = currentGardenData.coins || 0
  }

  /**
   * 渲染菜园格子
   */
  function renderPlots() {
    if (!window.GardenPlot) return
    
    GardenPlot.renderPlots(
      elements.gardenGrid,
      currentGardenData,
      null,
      handlePlotClick,
      handleUnlockPlot
    )
  }

  /**
   * 渲染种子背包
   */
  function renderSeeds() {
    if (!window.GardenBag) return
    GardenBag.renderSeeds(elements.seedList, currentGardenData, selectedSeed, handleSeedSelect)
  }

  /**
   * 渲染作物背包
   */
  function renderCrops() {
    if (!window.GardenBag) return
    GardenBag.renderCrops(elements.cropList, currentGardenData)
  }

  /**
   * 处理种子选择
   */
  function handleSeedSelect(cropKey) {
    selectedSeed = GardenBag.handleSeedSelect(cropKey, selectedSeed, updateTip)
    renderSeeds()
  }

  /**
   * 处理格子点击
   */
  async function handlePlotClick(index) {
    const plot = currentGardenData.plots[index]
    
    // 如果已有作物且成熟，收获
    if (plot.crop) {
      const cropConfig = GardenPlot.CROP_CONFIG[plot.crop]
      const progress = (plot.progress / cropConfig.growTime) * 100
      
      if (progress >= 100) {
        const result = await GardenPlot.harvestCrop(index, onDataUpdate, updateTip)
        if (result && result.success) {
          render()
        }
        return
      } else {
        updateTip('作物还未成熟，无法收获')
        return
      }
    }
    
    // 如果选择了种子且格子为空，种植
    if (selectedSeed && !plot.crop) {
      const result = await GardenPlot.plantCrop(index, selectedSeed, onDataUpdate, updateTip)
      if (result && result.success) {
        if (result.clearSeed) {
          selectedSeed = null
        }
        render()
      }
    } else if (!selectedSeed) {
      updateTip('请先选择一个种子')
    }
  }

  /**
   * 处理解锁土地
   */
  async function handleUnlockPlot(plotIndex) {
    const result = await GardenPlot.unlockPlot(plotIndex, onDataUpdate, updateTip)
    if (result && result.success) {
      render()
    }
  }

  /**
   * 数据更新回调
   */
  function onDataUpdate(newData) {
    currentGardenData = newData
  }

  /**
   * 更新提示文字
   */
  function updateTip(message) {
    if (elements.gardenTip) {
      elements.gardenTip.textContent = message
    }
  }

  /**
   * 更新签到按钮状态
   */
  function updateSigninBtnStatus() {
    if (window.GardenSignin) {
      GardenSignin.updateSigninBtnStatus(currentGardenData)
    }
  }

  /**
   * 更新成长进度（已废弃）
   */
  async function updateProgress() {
    console.log('[Garden] updateProgress 已废弃，timer 应直接发送 garden-grow 事件')
  }

  /**
   * 处理重置惩罚
   */
  async function handleResetPunishment() {
    if (!window.electronAPI || !window.electronAPI.gardenPunishment) {
      return { hasLoss: false, losses: [], totalMinutes: 0 }
    }

    const result = await window.electronAPI.gardenPunishment()

    if (result.hasLoss && isGardenPage) {
      await loadAndRender()
      updateTip('⚠️ 专注模式中断！所有正在生长的作物已枯萎')
    }

    return result
  }

  /**
   * 更新成就统计数据
   */
  async function updateAchievementStats(type, value) {
    if (window.GardenAchievement) {
      return await GardenAchievement.updateAchievementStats(type, value, updateTip)
    }
  }

  /**
   * 检查并解锁成就（已由主进程处理）
   */
  async function checkAndUnlockAchievements() {
    // 现在由主进程在原子操作中自动处理
  }

  // 导出到全局
  window.Garden = {
    init: init,
    updateProgress: updateProgress,
    handleResetPunishment: handleResetPunishment,
    updateAchievementStats: updateAchievementStats,
    checkAndUnlockAchievements: checkAndUnlockAchievements,
    // 新增：供子模块调用
    updateData: onDataUpdate,
    updateTip: updateTip,
    render: render
  }

  // 页面加载完成后自动初始化
  document.addEventListener('DOMContentLoaded', init)
})()