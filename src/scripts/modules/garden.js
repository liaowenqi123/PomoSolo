/**
 * 菜园子模块 - 管理菜园子的交互逻辑
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

  // 当前页面是否是菜园子页面（有菜园 DOM 结构）
  let isGardenPage = false
  
  // 当前数据（仅用于渲染，不缓存修改）
  let currentGardenData = null
  let selectedSeed = null
  let selectedPlotIndex = null
  
  // 弹窗实例
  let shopModal = null
  let signinModal = null
  let achievementModal = null

  // 作物配置
  const CROP_CONFIG = Utils.CROP_CONFIG
  
  // 成就配置
  const ACHIEVEMENT_CONFIG = Utils.ACHIEVEMENT_CONFIG
  const ACHIEVEMENT_CATEGORIES = Utils.ACHIEVEMENT_CATEGORIES
  
  // 土地解锁配置
  const PLOT_UNLOCK_CONFIG = Utils.PLOT_UNLOCK_CONFIG

  /**
   * 初始化菜园子
   */
  async function init() {
    // 检测当前页面是否是菜园子页面（garden.html 有 gardenGrid，index.html 没有）
    // 若不是菜园子页面则不执行任何初始化，避免在 index.html 上下文中操作不存在的 DOM
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
    
    // 初始化弹窗实例
    initModals()

    // 绑定关闭按钮事件
    elements.gardenCloseBtn.addEventListener('click', () => {
      // 添加关闭动画
      const gardenFrame = document.querySelector('.garden-frame')
      if (gardenFrame) {
        gardenFrame.classList.add('closing')
        // 等待动画完成后关闭窗口
        setTimeout(() => {
          window.electronAPI.closeGarden()
        }, 500)
      } else {
        window.electronAPI.closeGarden()
      }
    })

    // 监听刷新事件（当主页面更新作物数据时）
    if (window.electronAPI && window.electronAPI.onGardenRefresh) {
      window.electronAPI.onGardenRefresh(async () => {
        // 重新从持久化存储读取数据并渲染
        await loadAndRender()
      })
    }

    // 加载数据并渲染
    await loadAndRender()
    
    // 绑定商店事件
    initShopEvents()
    
    // 绑定签到事件
    initSigninEvents()
    
    // 绑定成就墙事件
    initAchievementEvents()
  }
  
  /**
   * 初始化弹窗实例
   */
  function initModals() {
    // 检查 BaseModal 是否存在（菜园子是独立页面，可能没有引入 modal.js）
    if (typeof BaseModal !== 'undefined') {
      shopModal = new BaseModal({
        element: elements.shopModal,
        showClass: 'show',
        expandSidebarOnShow: false
      })
      
      signinModal = new BaseModal({
        element: elements.signinModal,
        showClass: 'show',
        expandSidebarOnShow: false
      })
      
      achievementModal = new BaseModal({
        element: elements.achievementModal,
        showClass: 'show',
        expandSidebarOnShow: false
      })
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
    elements.gardenGrid.innerHTML = ''
    
    const plots = currentGardenData.plots || []
    
    plots.forEach((plot, index) => {
      const plotEl = document.createElement('div')
      plotEl.className = 'garden-plot'
      
      if (plot.locked) {
        plotEl.classList.add('locked')
        const unlockConfig = PLOT_UNLOCK_CONFIG[index]
        
        if (unlockConfig.type === 'coins') {
          const canAfford = (currentGardenData.coins || 0) >= unlockConfig.price
          plotEl.classList.add('locked-coins')
          plotEl.innerHTML = `
            <span class="lock-icon">🔒</span>
            <span class="lock-price">💰${unlockConfig.price}</span>
            <button class="unlock-btn ${canAfford ? '' : 'disabled'}">${canAfford ? '解锁' : '金币不足'}</button>
          `
          const btn = plotEl.querySelector('.unlock-btn')
          if (canAfford) {
            btn.addEventListener('click', (e) => {
              e.stopPropagation()
              unlockPlot(index)
            })
          }
        } else if (unlockConfig.type === 'achievement') {
          const achievement = ACHIEVEMENT_CONFIG[unlockConfig.achievementId]
          const isUnlocked = currentGardenData.achievements && 
                            currentGardenData.achievements[unlockConfig.achievementId] && 
                            currentGardenData.achievements[unlockConfig.achievementId].unlocked
          plotEl.classList.add('locked-achievement')
          if (isUnlocked) {
            plotEl.classList.add('can-unlock')
          }
          plotEl.innerHTML = `
            <span class="lock-icon">🔒</span>
            <span class="lock-condition">${unlockConfig.description}</span>
            <button class="unlock-btn ${isUnlocked ? '' : 'disabled'}">${isUnlocked ? '解锁' : '未达成'}</button>
          `
          const btn = plotEl.querySelector('.unlock-btn')
          if (isUnlocked) {
            btn.addEventListener('click', (e) => {
              e.stopPropagation()
              unlockPlot(index)
            })
          }
        }
      } else if (plot.crop) {
        const cropConfig = CROP_CONFIG[plot.crop]
        if (cropConfig) {
          const progress = Math.min(100, (plot.progress / cropConfig.growTime) * 100)
          const isMature = progress >= 100
          
          plotEl.classList.add('has-crop')
          if (isMature) {
            plotEl.classList.add('mature')
          }
          
          plotEl.innerHTML = `
            <span class="plot-crop-icon">${cropConfig.icon}</span>
            <div class="plot-progress">
              <div class="plot-progress-fill" style="width: ${progress}%"></div>
            </div>
            <span class="plot-progress-text">${plot.progress}/${cropConfig.growTime}分钟</span>
          `
        }
      } else {
        plotEl.classList.add('empty')
        plotEl.innerHTML = '<span style="opacity: 0.3; font-size: 24px;">+</span>'
      }
      
      if (selectedPlotIndex === index) {
        plotEl.classList.add('selected')
      }
      
      if (!plot.locked) {
        plotEl.addEventListener('click', () => handlePlotClick(index))
      }
      
      elements.gardenGrid.appendChild(plotEl)
    })
  }

  /**
   * 渲染种子背包
   */
  function renderSeeds() {
    elements.seedList.innerHTML = ''
    
    const seeds = currentGardenData.seeds || {}
    
    Object.keys(CROP_CONFIG).forEach(cropKey => {
      const crop = CROP_CONFIG[cropKey]
      const count = seeds[cropKey] || 0
      
      const seedEl = document.createElement('div')
      seedEl.className = `seed-item ${crop.rarity}`
      
      if (count === 0) {
        seedEl.classList.add('disabled')
      }
      
      if (selectedSeed === cropKey) {
        seedEl.classList.add('selected')
      }
      
      seedEl.innerHTML = `
        <span class="seed-icon seed-${crop.seedType}"></span>
        <div class="seed-info">
          <span class="seed-name">${crop.name}种子</span>
          <span class="seed-count">x${count}</span>
        </div>
      `
      
      if (count > 0) {
        seedEl.addEventListener('click', () => handleSeedSelect(cropKey))
      }
      
      elements.seedList.appendChild(seedEl)
    })
  }

  /**
   * 渲染作物背包
   */
  function renderCrops() {
    elements.cropList.innerHTML = ''
    
    const crops = currentGardenData.crops || {}
    const hasCrops = Object.values(crops).some(count => count > 0)
    
    if (!hasCrops) {
      elements.cropList.innerHTML = '<div class="crop-list-empty">暂无收获的作物</div>'
      return
    }
    
    Object.keys(CROP_CONFIG).forEach(cropKey => {
      const crop = CROP_CONFIG[cropKey]
      const count = crops[cropKey] || 0
      
      if (count === 0) return
      
      const cropEl = document.createElement('div')
      cropEl.className = `crop-item ${crop.rarity}`
      
      cropEl.innerHTML = `
        <span class="crop-icon">${crop.icon}</span>
        <div class="crop-info">
          <span class="crop-name">${crop.name}</span>
          <span class="crop-count">x${count}</span>
        </div>
      `
      
      elements.cropList.appendChild(cropEl)
    })
  }

  /**
   * 处理种子选择
   */
  function handleSeedSelect(cropKey) {
    if (selectedSeed === cropKey) {
      selectedSeed = null
      updateTip('点击种子，然后点击空格子种植')
    } else {
      selectedSeed = cropKey
      const crop = CROP_CONFIG[cropKey]
      updateTip(`已选择 ${crop.name}，点击空格子种植（需要 ${crop.growTime} 分钟）`)
    }
    renderSeeds()
  }

  /**
   * 处理格子点击
   */
  async function handlePlotClick(index) {
    const plot = currentGardenData.plots[index]
    
    // 如果已有作物且成熟，可以收获
    if (plot.crop) {
      const cropConfig = CROP_CONFIG[plot.crop]
      const progress = (plot.progress / cropConfig.growTime) * 100
      
      if (progress >= 100) {
        await harvestCrop(index)
        return
      } else {
        updateTip('作物还未成熟，无法收获')
        return
      }
    }
    
    // 如果选择了种子且格子为空，种植
    if (selectedSeed && !plot.crop) {
      await plantCrop(index, selectedSeed)
    } else if (!selectedSeed) {
      updateTip('请先选择一个种子')
    }
  }

  /**
   * 种植作物 - 原子操作
   */
  async function plantCrop(plotIndex, cropKey) {
    // 检查专注模式
    if (window.electronAPI && window.electronAPI.getTimerState) {
      try {
        const state = await window.electronAPI.getTimerState()
        if (state.focusModeEnabled && state.timerRunning) {
          updateTip('专注模式下无法种植作物，请先停止专注')
          return
        }
      } catch (e) {
        console.error('获取计时器状态失败:', e)
      }
    }

    // 调用原子操作
    const result = await window.electronAPI.gardenPlant(plotIndex, cropKey)
    
    if (result.success) {
      currentGardenData = result.garden
      
      // 检查种子是否还有剩余
      const remaining = currentGardenData.seeds[cropKey] || 0
      if (remaining <= 0) {
        selectedSeed = null
        updateTip('种植成功！种子已用完')
      } else {
        updateTip(`种植成功！还剩 ${remaining} 颗 ${CROP_CONFIG[cropKey].name}种子`)
      }
      
      // 显示成就解锁
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        updateTip(`🎉 恭喜解锁成就：${names}！`)
      }
      
      render()
    } else {
      updateTip(result.message)
    }
  }

  /**
   * 收获作物 - 原子操作
   */
  async function harvestCrop(plotIndex) {
    const result = await window.electronAPI.gardenHarvest(plotIndex)
    
    if (result.success) {
      currentGardenData = result.garden
      updateTip(result.message)
      
      // 显示成就解锁
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        updateTip(`🎉 恭喜解锁成就：${names}！`)
      }
      
      render()
    } else {
      updateTip(result.message)
    }
  }

  /**
   * 解锁土地 - 原子操作
   */
  async function unlockPlot(plotIndex) {
    const result = await window.electronAPI.gardenUnlockPlot(plotIndex)
    
    if (result.success) {
      currentGardenData = result.garden
      updateTip(result.message)
      render()
    } else {
      updateTip(result.message)
    }
  }

  /**
   * 更新成长进度（由外部调用，已废弃）
   */
  async function updateProgress() {
    console.log('[Garden] updateProgress 已废弃，timer 应直接发送 garden-grow 事件')
  }

  /**
   * 处理重置惩罚（由外部调用）
   */
  async function handleResetPunishment() {
    if (!window.electronAPI || !window.electronAPI.gardenPunishment) {
      return { hasLoss: false, losses: [], totalMinutes: 0 }
    }

    const result = await window.electronAPI.gardenPunishment()

    // 仅在菜园子页面刷新 UI，index.html 中无此 DOM，不执行
    if (result.hasLoss && isGardenPage) {
      await loadAndRender()
      updateTip('⚠️ 专注模式中断！所有正在生长的作物已枯萎')
    }

    return result
  }

  /**
   * 更新提示文字
   */
  function updateTip(message) {
    elements.gardenTip.textContent = message
  }

  // ============ 商店功能 ============

  /**
   * 初始化商店事件
   */
  function initShopEvents() {
    if (elements.shopBtn) {
      elements.shopBtn.addEventListener('click', openShop)
    }
    
    if (elements.shopCloseBtn) {
      elements.shopCloseBtn.addEventListener('click', closeShop)
    }
    
    if (elements.shopModal) {
      elements.shopModal.addEventListener('click', (e) => {
        if (e.target === elements.shopModal) {
          closeShop()
        }
      })
    }
    
    const tabs = document.querySelectorAll('.shop-tab')
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        
        const tabName = tab.dataset.tab
        document.querySelectorAll('.shop-panel').forEach(panel => {
          panel.classList.remove('active')
        })
        document.getElementById(tabName === 'buy' ? 'buyPanel' : 'sellPanel').classList.add('active')
      })
    })
    
    if (elements.sellAllBtn) {
      elements.sellAllBtn.addEventListener('click', sellAllCrops)
    }
  }

  /**
   * 打开商店
   */
  function openShop() {
    if (shopModal) {
      shopModal.show()
    } else if (elements.shopModal) {
      elements.shopModal.classList.add('show')
    }
    renderShopBuy()
    renderShopSell()
  }

  /**
   * 关闭商店
   */
  function closeShop() {
    if (shopModal) {
      shopModal.hide()
    } else if (elements.shopModal) {
      elements.shopModal.classList.remove('show')
    }
  }

  /**
   * 渲染购买种子列表
   */
  function renderShopBuy() {
    if (!elements.shopBuyGrid) return
    
    elements.shopBuyGrid.innerHTML = ''
    const coins = currentGardenData.coins || 0
    
    Object.keys(CROP_CONFIG).forEach(cropKey => {
      const crop = CROP_CONFIG[cropKey]
      const canBuy = coins >= crop.seedPrice
      
      const itemEl = document.createElement('div')
      itemEl.className = 'shop-item'
      itemEl.innerHTML = `
        <div class="shop-item-icon"><span class="seed-icon seed-${crop.seedType}"></span></div>
        <div class="shop-item-name">${crop.name}种子</div>
        <div class="shop-item-price">💰 ${crop.seedPrice}</div>
        <button class="shop-item-btn" ${canBuy ? '' : 'disabled'}>${canBuy ? '购买' : '金币不足'}</button>
      `
      
      if (canBuy) {
        const btn = itemEl.querySelector('.shop-item-btn')
        btn.addEventListener('click', () => buySeed(cropKey))
      }
      
      elements.shopBuyGrid.appendChild(itemEl)
    })
  }

  /**
   * 渲染出售作物列表
   */
  function renderShopSell() {
    if (!elements.shopSellGrid) return
    
    elements.shopSellGrid.innerHTML = ''
    const crops = currentGardenData.crops || {}
    const hasCrops = Object.values(crops).some(count => count > 0)
    
    if (!hasCrops) {
      elements.shopSellGrid.innerHTML = '<div class="shop-empty">暂无可出售的作物</div>'
      if (elements.sellAllBtn) {
        elements.sellAllBtn.disabled = true
      }
      return
    }
    
    if (elements.sellAllBtn) {
      elements.sellAllBtn.disabled = false
    }
    
    Object.keys(CROP_CONFIG).forEach(cropKey => {
      const crop = CROP_CONFIG[cropKey]
      const count = crops[cropKey] || 0
      
      if (count > 0) {
        const itemEl = document.createElement('div')
        itemEl.className = 'shop-item'
        itemEl.innerHTML = `
          <div class="shop-item-icon">${crop.icon}</div>
          <div class="shop-item-name">${crop.name}</div>
          <div class="shop-item-count">拥有: x${count}</div>
          <div class="shop-item-price">💰 ${crop.sellPrice}</div>
          <button class="shop-item-btn sell">出售</button>
        `
        
        const btn = itemEl.querySelector('.shop-item-btn')
        btn.addEventListener('click', () => sellCrop(cropKey))
        
        elements.shopSellGrid.appendChild(itemEl)
      }
    })
  }

  /**
   * 购买种子 - 原子操作
   */
  async function buySeed(cropKey) {
    const result = await window.electronAPI.gardenBuySeed(cropKey)
    
    if (result.success) {
      currentGardenData = result.garden
      updateTip(result.message)
      render()
      renderShopBuy()
    } else {
      updateTip(result.message)
    }
  }

  /**
   * 出售作物 - 原子操作
   */
  async function sellCrop(cropKey) {
    const result = await window.electronAPI.gardenSellCrop(cropKey)
    
    if (result.success) {
      currentGardenData = result.garden
      updateTip(result.message)
      
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        updateTip(`🎉 恭喜解锁成就：${names}！`)
      }
      
      render()
      renderShopSell()
    } else {
      updateTip(result.message)
    }
  }

  /**
   * 一键出售全部作物 - 原子操作
   */
  async function sellAllCrops() {
    const result = await window.electronAPI.gardenSellAll()
    
    if (result.success) {
      currentGardenData = result.garden
      updateTip(result.message)
      
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        updateTip(`🎉 恭喜解锁成就：${names}！`)
      }
      
      render()
      renderShopSell()
    } else {
      updateTip(result.message)
    }
  }

  // ============ 签到系统 ============

  /**
   * 初始化签到事件
   */
  function initSigninEvents() {
    if (elements.signinBtn) {
      elements.signinBtn.addEventListener('click', openSigninModal)
    }
    if (elements.signinCloseBtn) {
      elements.signinCloseBtn.addEventListener('click', closeSigninModal)
    }
    if (elements.signinModal) {
      elements.signinModal.addEventListener('click', (e) => {
        if (e.target === elements.signinModal) {
          closeSigninModal()
        }
      })
    }
    if (elements.signinConfirmBtn) {
      elements.signinConfirmBtn.addEventListener('click', handleSignIn)
    }
  }

  /**
   * 打开签到弹窗
   */
  function openSigninModal() {
    if (signinModal) {
      signinModal.show()
    } else if (elements.signinModal) {
      elements.signinModal.classList.add('show')
    }
    renderSigninModal()
  }

  /**
   * 关闭签到弹窗
   */
  function closeSigninModal() {
    if (signinModal) {
      signinModal.hide()
    } else if (elements.signinModal) {
      elements.signinModal.classList.remove('show')
    }
  }

  /**
   * 渲染签到弹窗
   */
  function renderSigninModal() {
    const signInData = currentGardenData.signIn || {
      lastDate: null,
      continuousDays: 0,
      totalDays: 0,
      weekRecords: [false, false, false, false, false, false, false]
    }
    
    elements.signinContinuous.textContent = signInData.continuousDays
    elements.signinTotal.textContent = signInData.totalDays
    
    const today = new Date().getDay()
    const dots = elements.signinWeekDots.querySelectorAll('.signin-dot')
    dots.forEach((dot, index) => {
      const dayIndex = index === 6 ? 0 : index + 1
      dot.classList.remove('signed', 'today')
      if (signInData.weekRecords[dayIndex]) {
        dot.classList.add('signed')
      }
      if (dayIndex === today) {
        dot.classList.add('today')
      }
    })
    
    renderSigninRewards()
    
    const canSign = canSignIn()
    elements.signinConfirmBtn.disabled = !canSign
    elements.signinConfirmBtn.textContent = canSign ? '✅ 立即签到' : '今日已签到'
  }

  /**
   * 渲染签到奖励
   */
  function renderSigninRewards() {
    const today = new Date().getDay()
    const signInData = currentGardenData.signIn || { continuousDays: 0 }
    
    let rewardsHtml = ''
    
    rewardsHtml += `<div class="signin-reward-item">
      <span class="signin-reward-icon">🥕</span>
      <span>胡萝卜种子 x${Utils.DAILY_REWARD.seeds.carrot}</span>
    </div>`
    rewardsHtml += `<div class="signin-reward-item">
      <span class="signin-reward-icon">💰</span>
      <span>金币 x${Utils.DAILY_REWARD.coins}</span>
    </div>`
    
    const weeklyReward = Utils.WEEKLY_REWARDS[today]
    if (weeklyReward) {
      if (weeklyReward.randomSeed) {
        rewardsHtml += `<div class="signin-reward-item extra">
          <span class="signin-reward-icon">🎁</span>
          <span>随机种子礼包 x1</span>
        </div>`
      } else if (Object.keys(weeklyReward.seeds).length > 0 || weeklyReward.coins > 0) {
        const seedEntries = Object.entries(weeklyReward.seeds)
        seedEntries.forEach(([seedKey, count]) => {
          const crop = CROP_CONFIG[seedKey]
          rewardsHtml += `<div class="signin-reward-item extra">
            <span class="signin-reward-icon">${crop.icon}</span>
            <span>${crop.name}种子 x${count}</span>
          </div>`
        })
        if (weeklyReward.coins > 0) {
          rewardsHtml += `<div class="signin-reward-item extra">
            <span class="signin-reward-icon">💰</span>
            <span>金币 x${weeklyReward.coins}</span>
          </div>`
        }
      }
    }
    
    const nextMilestone = getNextMilestone(signInData.continuousDays)
    if (nextMilestone) {
      const reward = Utils.CONTINUOUS_REWARDS[nextMilestone]
      const seedKey = Object.keys(reward.seeds)[0]
      const crop = CROP_CONFIG[seedKey]
      rewardsHtml += `<div class="signin-reward-item extra">
        <span class="signin-reward-icon">${crop.icon}</span>
        <span>连续${nextMilestone}天: ${crop.name}种子 x${reward.seeds[seedKey]}</span>
      </div>`
    }
    
    elements.signinRewardsList.innerHTML = rewardsHtml
  }

  /**
   * 检查是否可以签到
   */
  function canSignIn() {
    const signInData = currentGardenData.signIn || { lastDate: null }
    const today = new Date().toDateString()
    return signInData.lastDate !== today
  }

  /**
   * 获取下一个连续签到里程碑
   */
  function getNextMilestone(currentDays) {
    const milestones = Object.keys(Utils.CONTINUOUS_REWARDS).map(Number).sort((a, b) => a - b)
    for (const milestone of milestones) {
      if (currentDays < milestone) {
        return milestone
      }
    }
    return null
  }

  /**
   * 执行签到 - 原子操作
   */
  async function handleSignIn() {
    if (!canSignIn()) {
      updateTip('今日已签到')
      return
    }
    
    const result = await window.electronAPI.gardenSignIn()
    
    if (result.success) {
      currentGardenData = result.garden
      updateTip('签到成功！奖励已发放')
      
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        updateTip(`🎉 签到成功！解锁成就：${names}！`)
      }
      
      updateSigninBtnStatus()
      renderSigninModal()
      render()
    } else {
      updateTip(result.message)
    }
  }

  /**
   * 更新签到按钮状态
   */
  function updateSigninBtnStatus() {
    if (elements.signinBtn) {
      if (canSignIn()) {
        elements.signinBtn.classList.remove('signed')
      } else {
        elements.signinBtn.classList.add('signed')
      }
    }
  }

  // ============ 成就墙系统 ============

  /**
   * 初始化成就墙事件
   */
  function initAchievementEvents() {
    if (elements.achievementBtn) {
      elements.achievementBtn.addEventListener('click', openAchievementModal)
    }
    if (elements.achievementCloseBtn) {
      elements.achievementCloseBtn.addEventListener('click', closeAchievementModal)
    }
    if (elements.achievementModal) {
      elements.achievementModal.addEventListener('click', (e) => {
        if (e.target === elements.achievementModal) {
          closeAchievementModal()
        }
      })
    }
    if (elements.achievementTabs) {
      const tabs = elements.achievementTabs.querySelectorAll('.achievement-tab')
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'))
          tab.classList.add('active')
          renderAchievementList(tab.dataset.category)
        })
      })
    }
  }

  /**
   * 打开成就墙弹窗
   */
  async function openAchievementModal() {
    // 重新读取最新数据
    await loadAndRender()
    
    if (achievementModal) {
      achievementModal.show()
    } else if (elements.achievementModal) {
      elements.achievementModal.classList.add('show')
    }
    renderAchievementModal()
  }

  /**
   * 关闭成就墙弹窗
   */
  function closeAchievementModal() {
    if (achievementModal) {
      achievementModal.hide()
    } else if (elements.achievementModal) {
      elements.achievementModal.classList.remove('show')
    }
  }

  /**
   * 渲染成就墙弹窗
   */
  function renderAchievementModal() {
    const achievements = currentGardenData.achievements || {}
    const totalAchievements = Object.keys(ACHIEVEMENT_CONFIG).length
    const unlockedCount = Object.keys(achievements).filter(id => achievements[id] && achievements[id].unlocked).length
    
    elements.achievementUnlocked.textContent = unlockedCount
    elements.achievementTotal.textContent = totalAchievements
    
    renderAchievementList('all')
  }

  /**
   * 渲染成就列表
   */
  function renderAchievementList(category = 'all') {
    if (!elements.achievementList) return
    
    elements.achievementList.innerHTML = ''
    const achievements = currentGardenData.achievements || {}
    const stats = currentGardenData.achievementStats || {}
    
    Object.keys(ACHIEVEMENT_CONFIG).forEach(achievementId => {
      const config = ACHIEVEMENT_CONFIG[achievementId]
      
      if (category !== 'all' && config.category !== category) {
        return
      }
      
      const isUnlocked = achievements[achievementId] && achievements[achievementId].unlocked
      const progress = getAchievementProgress(config, stats)
      const progressPercent = Math.min(100, (progress / config.target) * 100)
      
      const itemEl = document.createElement('div')
      itemEl.className = `achievement-item ${isUnlocked ? 'unlocked' : ''} ${config.category}`
      
      itemEl.innerHTML = `
        <div class="achievement-icon">${config.icon}</div>
        <div class="achievement-info">
          <div class="achievement-name">${config.name}</div>
          <div class="achievement-desc">${config.description}</div>
          <div class="achievement-progress">
            <div class="achievement-progress-bar">
              <div class="achievement-progress-fill" style="width: ${progressPercent}%"></div>
            </div>
            <span class="achievement-progress-text">${progress}/${config.target}</span>
          </div>
          <div class="achievement-rewards">
            ${formatAchievementRewards(config.rewards)}
          </div>
        </div>
        ${isUnlocked ? '<div class="achievement-badge">✓</div>' : ''}
      `
      
      elements.achievementList.appendChild(itemEl)
    })
  }

  /**
   * 获取成就进度
   */
  function getAchievementProgress(config, stats) {
    stats = stats || currentGardenData.achievementStats || {}
    
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
        return (currentGardenData.signIn && currentGardenData.signIn.continuousDays) || 0
      default:
        return 0
    }
  }

  /**
   * 格式化成就奖励显示
   */
  function formatAchievementRewards(rewards) {
    let html = ''
    
    if (rewards.seeds) {
      Object.entries(rewards.seeds).forEach(([seedKey, count]) => {
        if (count > 0) {
          const crop = CROP_CONFIG[seedKey]
          html += `<span class="reward-item">${crop.icon} x${count}</span>`
        }
      })
    }
    if (rewards.coins > 0) {
      html += `<span class="reward-item">💰 x${rewards.coins}</span>`
    }
    
    return html
  }

  /**
   * 更新成就统计数据（供外部调用）
   */
  async function updateAchievementStats(type, value) {
    // 现在由主进程处理，这里只是接口兼容
    if (type === 'focus') {
      const result = await window.electronAPI.gardenUpdateFocus(value)
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        currentGardenData = result.garden
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        updateTip(`🎉 恭喜解锁成就：${names}！`)
      }
    }
  }

  /**
   * 检查并解锁成就（供外部调用，已由主进程处理）
   */
  async function checkAndUnlockAchievements() {
    // 现在由主进程在原子操作中自动处理
    // 这里保留接口兼容，但不需要做任何事
  }

  // 导出到全局
  window.Garden = {
    init: init,
    updateProgress: updateProgress,
    handleResetPunishment: handleResetPunishment,
    updateAchievementStats: updateAchievementStats,
    checkAndUnlockAchievements: checkAndUnlockAchievements
  }

  // 页面加载完成后自动初始化
  document.addEventListener('DOMContentLoaded', init)
})()