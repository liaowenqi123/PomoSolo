/**
 * 菜园子 - 商店模块
 * 处理商店弹窗、购买种子、出售作物
 */
;(function() {
  'use strict'

  // 从 Utils 获取配置
  const CROP_CONFIG = typeof Utils !== 'undefined' ? Utils.CROP_CONFIG : {}

  // DOM 元素引用
  let elements = {}

  // 弹窗实例
  let shopModal = null

  /**
   * 初始化商店模块
   * @param {Object} els - DOM 元素引用
   */
  function init(els) {
    elements = els || {}
    
    // 初始化弹窗实例
    if (typeof BaseModal !== 'undefined' && elements.shopModal) {
      shopModal = new BaseModal({
        element: elements.shopModal,
        showClass: 'show',
        expandSidebarOnShow: false
      })
    }
    
    bindEvents()
  }

  /**
   * 绑定事件
   */
  function bindEvents() {
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
   * @param {Object} data - 当前菜园数据
   * @param {Function} updateTip - 更新提示回调
   */
  function openShop(data, updateTip) {
    if (shopModal) {
      shopModal.show()
    } else if (elements.shopModal) {
      elements.shopModal.classList.add('show')
    }
    renderShopBuy(data, updateTip)
    renderShopSell(data, updateTip)
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
  function renderShopBuy(data, updateTip) {
    if (!elements.shopBuyGrid || !data) return
    
    elements.shopBuyGrid.innerHTML = ''
    const coins = data.coins || 0
    
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
        btn.addEventListener('click', () => buySeed(cropKey, updateTip))
      }
      
      elements.shopBuyGrid.appendChild(itemEl)
    })
  }

  /**
   * 渲染出售作物列表
   */
  function renderShopSell(data, updateTip) {
    if (!elements.shopSellGrid || !data) return
    
    elements.shopSellGrid.innerHTML = ''
    const crops = data.crops || {}
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
        btn.addEventListener('click', () => sellCrop(cropKey, updateTip))
        
        elements.shopSellGrid.appendChild(itemEl)
      }
    })
  }

  /**
   * 购买种子 - 原子操作
   */
  async function buySeed(cropKey, updateTip) {
    const result = await window.electronAPI.gardenBuySeed(cropKey)
    
    if (result.success && window.Garden) {
      window.Garden.updateData(result.garden)
      updateTip(result.message)
      window.Garden.render()
      // 重新渲染商店
      renderShopBuy(result.garden, updateTip)
    } else {
      updateTip(result.message)
    }
    
    return result
  }

  /**
   * 出售作物 - 原子操作
   */
  async function sellCrop(cropKey, updateTip) {
    const result = await window.electronAPI.gardenSellCrop(cropKey)
    
    if (result.success && window.Garden) {
      window.Garden.updateData(result.garden)
      updateTip(result.message)
      
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        updateTip(`🎉 恭喜解锁成就：${names}！`)
      }
      
      window.Garden.render()
      renderShopSell(result.garden, updateTip)
    } else {
      updateTip(result.message)
    }
    
    return result
  }

  /**
   * 一键出售全部作物 - 原子操作
   */
  async function sellAllCrops() {
    const result = await window.electronAPI.gardenSellAll()
    
    if (result.success && window.Garden) {
      window.Garden.updateData(result.garden)
      window.Garden.updateTip(result.message)
      
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        window.Garden.updateTip(`🎉 恭喜解锁成就：${names}！`)
      }
      
      window.Garden.render()
      renderShopSell(result.garden, window.Garden.updateTip)
    } else {
      window.Garden.updateTip(result.message)
    }
    
    return result
  }

  // 导出到全局
  window.GardenShop = {
    init,
    openShop,
    closeShop,
    renderShopBuy,
    renderShopSell,
    buySeed,
    sellCrop,
    sellAllCrops
  }
})()
