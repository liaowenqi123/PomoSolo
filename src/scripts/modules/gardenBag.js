/**
 * 菜园子 - 背包模块
 * 处理背包的展开/收起、种子和作物列表渲染
 */
;(function() {
  'use strict'

  // 从 Utils 获取配置
  const CROP_CONFIG = typeof Utils !== 'undefined' ? Utils.CROP_CONFIG : {}

  // 背包展开状态
  let seedBagExpanded = false
  let cropBagExpanded = false

  /**
   * 初始化背包展开按钮事件
   */
  function initBagEvents() {
    const seedExpandBtn = document.getElementById('seed-expand-btn')
    const cropExpandBtn = document.getElementById('crop-expand-btn')
    
    // 设置初始状态
    seedBagExpanded = false
    cropBagExpanded = false
    
    // 种子背包按钮
    if (seedExpandBtn) {
      seedExpandBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleSeedBag()
      })
    }
    
    // 作物背包按钮
    if (cropExpandBtn) {
      cropExpandBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleCropBag()
      })
    }
  }

  /**
   * 切换种子背包
   */
  function toggleSeedBag() {
    const seedExpandBtn = document.getElementById('seed-expand-btn')
    const cropExpandBtn = document.getElementById('crop-expand-btn')
    const seedBag = document.getElementById('garden-seed-bag')
    const cropBag = document.getElementById('garden-crop-bag')
    
    if (seedBagExpanded) {
      // 收起种子背包
      if (seedExpandBtn) seedExpandBtn.classList.remove('active')
      if (seedBag) seedBag.classList.remove('expanded')
      seedBagExpanded = false
    } else {
      // 展开种子背包（收起作物背包）
      cropBagExpanded = false
      seedBagExpanded = true
      
      if (seedExpandBtn) seedExpandBtn.classList.add('active')
      if (cropExpandBtn) cropExpandBtn.classList.remove('active')
      if (seedBag) seedBag.classList.add('expanded')
      if (cropBag) cropBag.classList.remove('expanded')
    }
  }

  /**
   * 切换作物背包
   */
  function toggleCropBag() {
    const seedExpandBtn = document.getElementById('seed-expand-btn')
    const cropExpandBtn = document.getElementById('crop-expand-btn')
    const seedBag = document.getElementById('garden-seed-bag')
    const cropBag = document.getElementById('garden-crop-bag')
    
    if (cropBagExpanded) {
      // 收起作物背包
      if (cropExpandBtn) cropExpandBtn.classList.remove('active')
      if (cropBag) cropBag.classList.remove('expanded')
      cropBagExpanded = false
    } else {
      // 展开作物背包（收起种子背包）
      seedBagExpanded = false
      cropBagExpanded = true
      
      if (cropExpandBtn) cropExpandBtn.classList.add('active')
      if (seedExpandBtn) seedExpandBtn.classList.remove('active')
      if (cropBag) cropBag.classList.add('expanded')
      if (seedBag) seedBag.classList.remove('expanded')
    }
  }

  /**
   * 渲染种子背包
   */
  function renderSeeds(listEl, data, selectedSeed, onSeedSelect) {
    if (!listEl || !data) return
    
    listEl.innerHTML = ''
    const seeds = data.seeds || {}
    
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
        seedEl.addEventListener('click', () => onSeedSelect(cropKey))
      }
      
      listEl.appendChild(seedEl)
    })
  }

  /**
   * 渲染作物背包
   */
  function renderCrops(listEl, data) {
    if (!listEl || !data) return
    
    listEl.innerHTML = ''
    const crops = data.crops || {}
    const hasCrops = Object.values(crops).some(count => count > 0)
    
    if (!hasCrops) {
      listEl.innerHTML = '<div class="crop-list-empty">暂无收获的作物</div>'
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
      
      listEl.appendChild(cropEl)
    })
  }

  /**
   * 处理种子选择
   */
  function handleSeedSelect(cropKey, currentSelected, updateTip) {
    if (currentSelected === cropKey) {
      updateTip('点击种子，然后点击空格子种植')
      return null
    } else {
      const crop = CROP_CONFIG[cropKey]
      updateTip(`已选择 ${crop.name}，点击空格子种植（需要 ${crop.growTime} 分钟）`)
      return cropKey
    }
  }

  /**
   * 获取背包展开状态
   */
  function getBagState() {
    return { seedBagExpanded, cropBagExpanded }
  }

  // 导出到全局
  window.GardenBag = {
    initBagEvents,
    renderSeeds,
    renderCrops,
    handleSeedSelect,
    getBagState,
    toggleSeedBag,
    toggleCropBag
  }
})()