/**
 * 菜园子模块 - 管理菜园子的交互逻辑
 */
;(function() {
  'use strict'

  // DOM 元素
  let elements = {}
  
  // 状态
  let gardenData = null
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
        // 重新从数据库加载数据
        await loadGardenData()
        // 重新渲染界面
        render()
      })
    }

    // 加载数据
    await loadGardenData()
    
    // 渲染界面
    render()
    
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
        // 菜园子是独立窗口，没有主页面侧边栏，不应触发展开逻辑
        expandSidebarOnShow: false
      })
      
      signinModal = new BaseModal({
        element: elements.signinModal,
        showClass: 'show',
        // 菜园子是独立窗口，没有主页面侧边栏，不应触发展开逻辑
        expandSidebarOnShow: false
      })
      
      achievementModal = new BaseModal({
        element: elements.achievementModal,
        showClass: 'show',
        // 菜园子是独立窗口，没有主页面侧边栏，不应触发展开逻辑
        expandSidebarOnShow: false
      })
    }
    // 如果 BaseModal 不存在，使用原始方式（菜园子独立页面）
  }

  /**
   * 确保菜园数据已加载（供外部调用）
   */
  async function ensureGardenDataLoaded() {
    if (!gardenData) {
      await loadGardenData()
    }
    return gardenData
  }

  /**
   * 加载菜园数据
   * 优先使用带锁的 IPC 接口
   * @param {boolean} forceFromFile - 是否强制从文件读取（用于确保获取最新数据）
   */
  async function loadGardenData(forceFromFile = false) {
    try {
      // 使用带锁的 IPC 接口读取最新数据
      if (window.electronAPI && window.electronAPI.gardenRead) {
        gardenData = await window.electronAPI.gardenRead()
      } else if (forceFromFile || !window.DataStore) {
        const data = await window.electronAPI.readData()
        gardenData = data.garden || Utils.createDefaultData().garden
      } else {
        gardenData = window.DataStore.getGarden()
      }
    } catch (e) {
      console.error('加载菜园数据失败:', e)
      gardenData = Utils.createDefaultData().garden
    }
  }

  /**
   * 保存菜园数据
   * 使用带锁的 IPC 接口
   */
  async function saveGardenData() {
    try {
      // 使用带锁的 IPC 接口保存
      if (window.electronAPI && window.electronAPI.gardenUpdate) {
        gardenData = await window.electronAPI.gardenUpdate(gardenData)
      } else if (window.DataStore) {
        await window.DataStore.updateGarden(gardenData)
      } else {
        const data = await window.electronAPI.readData()
        data.garden = gardenData
        await window.electronAPI.writeData(data)
      }
    } catch (e) {
      console.error('保存菜园数据失败:', e)
    }
  }

  /**
   * 渲染界面
   */
  function render() {
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
    elements.coinCount.textContent = gardenData.coins || 0
  }

  /**
   * 渲染菜园格子
   */
  function renderPlots() {
    elements.gardenGrid.innerHTML = ''
    
    const plots = gardenData.plots || []
    
    plots.forEach((plot, index) => {
      const plotEl = document.createElement('div')
      plotEl.className = 'garden-plot'
      
      if (plot.locked) {
        plotEl.classList.add('locked')
        const unlockConfig = PLOT_UNLOCK_CONFIG[index]
        
        if (unlockConfig.type === 'coins') {
          // 金币解锁
          const canAfford = (gardenData.coins || 0) >= unlockConfig.price
          plotEl.classList.add('locked-coins')
          plotEl.innerHTML = `
            <span class="lock-icon">🔒</span>
            <span class="lock-price">💰${unlockConfig.price}</span>
            <button class="unlock-btn ${canAfford ? '' : 'disabled'}">${canAfford ? '解锁' : '金币不足'}</button>
          `
          // 解锁按钮点击事件
          const btn = plotEl.querySelector('.unlock-btn')
          if (canAfford) {
            btn.addEventListener('click', (e) => {
              e.stopPropagation()
              unlockPlotWithCoins(index, unlockConfig.price)
            })
          }
        } else if (unlockConfig.type === 'achievement') {
          // 成就解锁
          const achievement = ACHIEVEMENT_CONFIG[unlockConfig.achievementId]
          const isUnlocked = gardenData.achievements && 
                            gardenData.achievements[unlockConfig.achievementId] && 
                            gardenData.achievements[unlockConfig.achievementId].unlocked
          plotEl.classList.add('locked-achievement')
          if (isUnlocked) {
            plotEl.classList.add('can-unlock')
          }
          plotEl.innerHTML = `
            <span class="lock-icon">🔒</span>
            <span class="lock-condition">${unlockConfig.description}</span>
            <button class="unlock-btn ${isUnlocked ? '' : 'disabled'}">${isUnlocked ? '解锁' : '未达成'}</button>
          `
          // 解锁按钮点击事件
          const btn = plotEl.querySelector('.unlock-btn')
          if (isUnlocked) {
            btn.addEventListener('click', (e) => {
              e.stopPropagation()
              unlockPlotWithAchievement(index)
            })
          }
        }
      } else if (plot.crop) {
        // 有作物
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
        // 空格子
        plotEl.classList.add('empty')
        plotEl.innerHTML = '<span style="opacity: 0.3; font-size: 24px;">+</span>'
      }
      
      // 选中状态
      if (selectedPlotIndex === index) {
        plotEl.classList.add('selected')
      }
      
      // 点击事件（非锁定格子）
      if (!plot.locked) {
        plotEl.addEventListener('click', () => handlePlotClick(index))
      }
      
      elements.gardenGrid.appendChild(plotEl)
    })
  }

  /**
   * 使用金币解锁土地
   */
  async function unlockPlotWithCoins(index, price) {
    const coins = gardenData.coins || 0
    
    if (coins < price) {
      updateTip('金币不足')
      return
    }
    
    // 扣除金币
    gardenData.coins = coins - price
    
    // 解锁土地
    gardenData.plots[index] = {
      id: index,
      crop: null,
      progress: 0,
      plantedAt: null,
      locked: false
    }
    
    await saveGardenData()
    updateTip(`解锁成功！花费 💰${price}`)
    render()
  }

  /**
   * 使用成就解锁土地
   */
  async function unlockPlotWithAchievement(index) {
    const unlockConfig = PLOT_UNLOCK_CONFIG[index]
    
    // 再次验证成就是否已解锁
    if (!gardenData.achievements || 
        !gardenData.achievements[unlockConfig.achievementId] || 
        !gardenData.achievements[unlockConfig.achievementId].unlocked) {
      updateTip('成就未达成，无法解锁')
      return
    }
    
    // 解锁土地
    gardenData.plots[index] = {
      id: index,
      crop: null,
      progress: 0,
      plantedAt: null,
      locked: false
    }
    
    await saveGardenData()
    const achievement = ACHIEVEMENT_CONFIG[unlockConfig.achievementId]
    updateTip(`🎉 解锁成功！达成成就「${achievement.name}」`)
    render()
  }

  /**
   * 渲染种子背包
   */
  function renderSeeds() {
    elements.seedList.innerHTML = ''
    
    const seeds = gardenData.seeds || {}
    
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
      
      // 点击选择种子
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
    
    const crops = gardenData.crops || {}
    
    // 检查是否有作物
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
      // 取消选择
      selectedSeed = null
      updateTip('点击种子，然后点击空格子种植')
    } else {
      // 选择种子
      selectedSeed = cropKey
      const crop = CROP_CONFIG[cropKey]
      updateTip(`已选择 ${crop.name}，点击空格子种植（需要 ${crop.growTime} 分钟）`)
    }
    renderSeeds()
  }

  /**
   * 处理格子点击
   */
  function handlePlotClick(index) {
    const plot = gardenData.plots[index]
    
    // 如果已有作物且成熟，可以收获
    if (plot.crop) {
      const cropConfig = CROP_CONFIG[plot.crop]
      const progress = (plot.progress / cropConfig.growTime) * 100
      
      if (progress >= 100) {
        // 收获
        harvestCrop(index)
        return
      } else {
        updateTip('作物还未成熟，无法收获')
        return
      }
    }
    
    // 如果选择了种子且格子为空，种植
    if (selectedSeed && !plot.crop) {
      plantCrop(index, selectedSeed)
    } else if (!selectedSeed) {
      updateTip('请先选择一个种子')
    }
  }

  /**
   * 种植作物
   */
  async function plantCrop(plotIndex, cropKey) {
    // 通过 IPC 查询专注模式和计时器状态
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

    const seeds = gardenData.seeds || {}
    
    // 检查是否有种子
    if (!seeds[cropKey] || seeds[cropKey] <= 0) {
      updateTip('种子不足')
      return
    }
    
    // 消耗种子
    seeds[cropKey]--
    
    // 更新格子
    gardenData.plots[plotIndex] = {
      id: plotIndex,
      crop: cropKey,
      progress: 0,
      plantedAt: new Date().toISOString()
    }
    
    // 保存并渲染
    await saveGardenData()
    
    // 更新种植成就进度
    await updateAchievementStats('plant')
    
    // 检查种子是否还有剩余，如果没有则取消选中
    if (seeds[cropKey] <= 0) {
      selectedSeed = null
      updateTip('种植成功！种子已用完')
    } else {
      updateTip(`种植成功！还剩 ${seeds[cropKey]} 颗 ${CROP_CONFIG[cropKey].name}种子，继续点击空格子种植`)
    }
    render()
  }

  /**
   * 收获作物
   */
  async function harvestCrop(plotIndex) {
    const plot = gardenData.plots[plotIndex]
    const cropConfig = CROP_CONFIG[plot.crop]
    
    // 添加到作物背包
    gardenData.crops = gardenData.crops || {}
    gardenData.crops[plot.crop] = (gardenData.crops[plot.crop] || 0) + 1
    
    // 获得金币（作物价值的一半）
    const reward = Math.floor(cropConfig.value / 2)
    gardenData.coins = (gardenData.coins || 0) + reward
    
    // 清空格子
    gardenData.plots[plotIndex] = {
      id: plotIndex,
      crop: null,
      progress: 0,
      plantedAt: null
    }
    
    // 保存并渲染
    await saveGardenData()
    
    // 更新收获成就进度（传入作物类型）
    await updateAchievementStats('harvest', plot.crop)
    // 更新财富成就进度
    await updateAchievementStats('coins', reward)
    
    updateTip(`收获成功！${cropConfig.name} x1 已存入作物背包，金币 +${reward}`)
    render()
  }

  /**
   * 更新成长进度（由外部调用）
   * 注意：timer 现在直接发送 garden-grow 事件给主进程，此函数已废弃
   * 保留此函数仅为兼容性
   */
  async function updateProgress() {
    // timer 现在直接发送事件，这里不需要做任何事
    console.log('[Garden] updateProgress 已废弃，timer 应直接发送 garden-grow 事件')
  }

  /**
   * 处理重置惩罚（由外部调用）
   * 调用主进程处理惩罚，主进程会更新数据并通知刷新
   * @returns {Promise<Object>} 损失详情 { hasLoss, losses, totalMinutes }
   */
  async function handleResetPunishment() {
    if (window.electronAPI && window.electronAPI.gardenPunishment) {
      const result = await window.electronAPI.gardenPunishment()
      
      // 更新本地数据
      if (result.hasLoss && gardenData) {
        await loadGardenData(true)
      }
      
      // 显示提示（如果在菜园子页面）
      if (result.hasLoss && elements.gardenTip) {
        updateTip('⚠️ 专注模式中断！所有正在生长的作物已枯萎')
      }
      
      return result
    }
    
    return { hasLoss: false, losses: [], totalMinutes: 0 }
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
    // 打开商店
    if (elements.shopBtn) {
      elements.shopBtn.addEventListener('click', openShop)
    }
    
    // 关闭商店
    if (elements.shopCloseBtn) {
      elements.shopCloseBtn.addEventListener('click', closeShop)
    }
    
    // 点击遮罩关闭
    if (elements.shopModal) {
      elements.shopModal.addEventListener('click', (e) => {
        if (e.target === elements.shopModal) {
          closeShop()
        }
      })
    }
    
    // 标签页切换
    const tabs = document.querySelectorAll('.shop-tab')
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // 更新标签页状态
        tabs.forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        
        // 切换面板
        const tabName = tab.dataset.tab
        document.querySelectorAll('.shop-panel').forEach(panel => {
          panel.classList.remove('active')
        })
        document.getElementById(tabName === 'buy' ? 'buyPanel' : 'sellPanel').classList.add('active')
      })
    })
    
    // 一键出售
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
    const coins = gardenData.coins || 0
    
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
    const crops = gardenData.crops || {}
    
    // 检查是否有作物
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
   * 购买种子
   */
  async function buySeed(cropKey) {
    const crop = CROP_CONFIG[cropKey]
    const coins = gardenData.coins || 0
    
    if (coins < crop.seedPrice) {
      updateTip('金币不足')
      return
    }
    
    // 扣除金币
    gardenData.coins = coins - crop.seedPrice
    
    // 增加种子
    gardenData.seeds = gardenData.seeds || {}
    gardenData.seeds[cropKey] = (gardenData.seeds[cropKey] || 0) + 1
    
    // 保存并渲染
    await saveGardenData()
    updateTip(`购买成功！获得 ${crop.name}种子 x1`)
    render()
    renderShopBuy()
  }

  /**
   * 出售作物
   */
  async function sellCrop(cropKey) {
    const crop = CROP_CONFIG[cropKey]
    const crops = gardenData.crops || {}
    
    if (!crops[cropKey] || crops[cropKey] <= 0) {
      return
    }
    
    // 减少作物
    crops[cropKey]--
    
    // 增加金币
    gardenData.coins = (gardenData.coins || 0) + crop.sellPrice
    
    // 保存并渲染
    await saveGardenData()
    
    // 更新财富成就进度
    await updateAchievementStats('coins', crop.sellPrice)
    
    updateTip(`出售成功！获得 💰${crop.sellPrice}`)
    render()
    renderShopSell()
  }

  /**
   * 一键出售全部作物
   */
  async function sellAllCrops() {
    const crops = gardenData.crops || {}
    let totalCoins = 0
    let totalItems = 0
    
    Object.keys(crops).forEach(cropKey => {
      const count = crops[cropKey]
      if (count > 0) {
        const crop = CROP_CONFIG[cropKey]
        totalCoins += crop.sellPrice * count
        totalItems += count
        crops[cropKey] = 0
      }
    })
    
    if (totalItems === 0) {
      return
    }
    
    // 增加金币
    gardenData.coins = (gardenData.coins || 0) + totalCoins
    
    // 保存并渲染
    await saveGardenData()
    
    // 更新财富成就进度
    await updateAchievementStats('coins', totalCoins)
    
    updateTip(`出售成功！共出售 ${totalItems} 个作物，获得 💰${totalCoins}`)
    render()
    renderShopSell()
  }

  /* ============ 签到系统 ============ */

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
    const signInData = gardenData.signIn || {
      lastDate: null,
      continuousDays: 0,
      totalDays: 0,
      weekRecords: [false, false, false, false, false, false, false]
    }
    
    // 更新统计
    elements.signinContinuous.textContent = signInData.continuousDays
    elements.signinTotal.textContent = signInData.totalDays
    
    // 更新本周签到状态
    const today = new Date().getDay()
    const dots = elements.signinWeekDots.querySelectorAll('.signin-dot')
    dots.forEach((dot, index) => {
      const dayIndex = index === 6 ? 0 : index + 1  // 调整顺序：一到日
      dot.classList.remove('signed', 'today')
      if (signInData.weekRecords[dayIndex]) {
        dot.classList.add('signed')
      }
      if (dayIndex === today) {
        dot.classList.add('today')
      }
    })
    
    // 渲染奖励列表
    renderSigninRewards()
    
    // 更新签到按钮状态
    const canSign = canSignIn()
    elements.signinConfirmBtn.disabled = !canSign
    elements.signinConfirmBtn.textContent = canSign ? '✅ 立即签到' : '今日已签到'
  }

  /**
   * 渲染签到奖励
   */
  function renderSigninRewards() {
    const today = new Date().getDay()
    const signInData = gardenData.signIn || { continuousDays: 0 }
    
    let rewardsHtml = ''
    
    // 每日基础奖励
    rewardsHtml += `<div class="signin-reward-item">
      <span class="signin-reward-icon">🥕</span>
      <span>胡萝卜种子 x${Utils.DAILY_REWARD.seeds.carrot}</span>
    </div>`
    rewardsHtml += `<div class="signin-reward-item">
      <span class="signin-reward-icon">💰</span>
      <span>金币 x${Utils.DAILY_REWARD.coins}</span>
    </div>`
    
    // 每周奖励
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
    
    // 连续签到奖励预览
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
    const signInData = gardenData.signIn || { lastDate: null }
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
   * 执行签到
   */
  async function handleSignIn() {
    if (!canSignIn()) {
      updateTip('今日已签到')
      return
    }
    
    const signInData = gardenData.signIn || {
      lastDate: null,
      continuousDays: 0,
      totalDays: 0,
      weekRecords: [false, false, false, false, false, false, false]
    }
    
    // 计算连续签到天数
    const today = new Date()
    const todayStr = today.toDateString()
    
    if (signInData.lastDate) {
      const lastDate = new Date(signInData.lastDate)
      const diffTime = today - lastDate
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
      
      if (diffDays === 1) {
        // 连续签到
        signInData.continuousDays++
      } else if (diffDays > 1) {
        // 断签，重置
        signInData.continuousDays = 1
        // 重置本周记录（新的一周）
        signInData.weekRecords = [false, false, false, false, false, false, false]
      }
    } else {
      // 首次签到
      signInData.continuousDays = 1
    }
    
    // 更新签到数据
    signInData.lastDate = todayStr
    signInData.totalDays++
    
    // 更新本周签到记录
    const dayOfWeek = today.getDay()
    signInData.weekRecords[dayOfWeek] = true
    
    // 发放奖励
    await grantSigninRewards(signInData)
    
    // 保存数据
    gardenData.signIn = signInData
    await saveGardenData()
    
    // 更新按钮状态
    updateSigninBtnStatus()
    
    // 重新渲染弹窗
    renderSigninModal()
    
    // 更新界面
    render()
    
    // 检查坚持成就（连续签到）
    await checkAndUnlockAchievements()
    
    updateTip('签到成功！奖励已发放')
  }

  /**
   * 发放签到奖励
   */
  async function grantSigninRewards(signInData) {
    const today = new Date().getDay()
    let totalCoinsEarned = 0
    
    // 发放每日基础奖励
    Object.entries(Utils.DAILY_REWARD.seeds).forEach(([seedKey, count]) => {
      gardenData.seeds[seedKey] = (gardenData.seeds[seedKey] || 0) + count
    })
    totalCoinsEarned += Utils.DAILY_REWARD.coins
    
    // 发放每周奖励
    const weeklyReward = Utils.WEEKLY_REWARDS[today]
    if (weeklyReward) {
      if (weeklyReward.randomSeed) {
        // 随机种子
        const seedKeys = Object.keys(CROP_CONFIG)
        const randomKey = seedKeys[Math.floor(Math.random() * seedKeys.length)]
        gardenData.seeds[randomKey] = (gardenData.seeds[randomKey] || 0) + 1
      } else {
        Object.entries(weeklyReward.seeds).forEach(([seedKey, count]) => {
          gardenData.seeds[seedKey] = (gardenData.seeds[seedKey] || 0) + count
        })
        totalCoinsEarned += weeklyReward.coins
      }
    }
    
    // 发放连续签到奖励
    const continuousReward = Utils.CONTINUOUS_REWARDS[signInData.continuousDays]
    if (continuousReward) {
      Object.entries(continuousReward.seeds).forEach(([seedKey, count]) => {
        gardenData.seeds[seedKey] = (gardenData.seeds[seedKey] || 0) + count
      })
      totalCoinsEarned += continuousReward.coins
    }
    
    // 增加金币
    gardenData.coins = (gardenData.coins || 0) + totalCoinsEarned
    
    // 更新财富成就进度
    if (totalCoinsEarned > 0) {
      await updateAchievementStats('coins', totalCoinsEarned)
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

  /* ============ 成就墙系统 ============ */

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
    // 分类标签切换
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
    // 强制重新加载数据，确保显示最新进度
    await loadGardenData(true)
    
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
    const achievements = gardenData.achievements || {}
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
    const achievements = gardenData.achievements || {}
    const stats = gardenData.achievementStats || {}
    
    Object.keys(ACHIEVEMENT_CONFIG).forEach(achievementId => {
      const config = ACHIEVEMENT_CONFIG[achievementId]
      
      // 过滤分类
      if (category !== 'all' && config.category !== category) {
        return
      }
      
      const isUnlocked = achievements[achievementId] && achievements[achievementId].unlocked
      const progress = getAchievementProgress(achievementId, stats)
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
  function getAchievementProgress(achievementId, stats) {
    const config = ACHIEVEMENT_CONFIG[achievementId]
    stats = stats || gardenData.achievementStats || {}
    
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
        return (gardenData.signIn && gardenData.signIn.continuousDays) || 0
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
   * 检查并解锁成就
   */
  async function checkAndUnlockAchievements() {
    const achievements = gardenData.achievements || {}
    const stats = gardenData.achievementStats || {}
    let hasNewUnlock = false
    let unlockedAchievements = []
    
    Object.keys(ACHIEVEMENT_CONFIG).forEach(achievementId => {
      // 已解锁则跳过
      if (achievements[achievementId] && achievements[achievementId].unlocked) {
        return
      }
      
      const config = ACHIEVEMENT_CONFIG[achievementId]
      const progress = getAchievementProgress(achievementId, stats)
      
      // 达成条件
      if (progress >= config.target) {
        achievements[achievementId] = {
          unlocked: true,
          unlockedAt: new Date().toISOString()
        }
        hasNewUnlock = true
        unlockedAchievements.push(config)
      }
    })
    
    if (hasNewUnlock) {
      gardenData.achievements = achievements
      await saveGardenData()
      
      // 发放奖励
      for (const config of unlockedAchievements) {
        await grantAchievementReward(config)
      }
      
      // 显示解锁提示
      if (unlockedAchievements.length > 0) {
        const names = unlockedAchievements.map(a => a.name).join('、')
        updateTip(`🎉 恭喜解锁成就：${names}！`)
      }
    }
    
    return unlockedAchievements
  }

  /**
   * 发放成就奖励
   */
  async function grantAchievementReward(config) {
    const rewards = config.rewards
    
    if (rewards.seeds) {
      Object.entries(rewards.seeds).forEach(([seedKey, count]) => {
        gardenData.seeds[seedKey] = (gardenData.seeds[seedKey] || 0) + count
      })
    }
    if (rewards.coins > 0) {
      gardenData.coins = (gardenData.coins || 0) + rewards.coins
    }
    
    await saveGardenData()
  }

  /**
   * 更新成就统计数据（供外部调用）
   * @param {string} type - 更新类型: 'focus' | 'harvest' | 'plant' | 'coins' | 'cropType'
   * @param {number|string} value - 更新值
   */
  async function updateAchievementStats(type, value) {
    if (!gardenData.achievementStats) {
      gardenData.achievementStats = {
        totalFocusMinutes: 0,
        totalHarvestCount: 0,
        totalPlantCount: 0,
        totalCoinsEarned: 0,
        cropTypesCollected: []
      }
    }
    
    const stats = gardenData.achievementStats
    
    switch (type) {
      case 'focus':
        stats.totalFocusMinutes = (stats.totalFocusMinutes || 0) + value
        break
      case 'harvest':
        stats.totalHarvestCount = (stats.totalHarvestCount || 0) + 1
        // 同时更新作物类型收集
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
    
    await saveGardenData()
    await checkAndUnlockAchievements()
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
