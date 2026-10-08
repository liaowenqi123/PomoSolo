/**
 * 菜园子 - 土地格子模块
 * 处理格子的渲染、种植、收获、解锁等操作
 */
;(function() {
  'use strict'

  // 从 Utils 获取配置
  const CROP_CONFIG = typeof Utils !== 'undefined' ? Utils.CROP_CONFIG : {}
  const PLOT_UNLOCK_CONFIG = typeof Utils !== 'undefined' ? Utils.PLOT_UNLOCK_CONFIG : {}
  const ACHIEVEMENT_CONFIG = typeof Utils !== 'undefined' ? Utils.ACHIEVEMENT_CONFIG : {}

  /**
   * 渲染菜园格子
   * @param {HTMLElement} gridEl - 格子容器元素
   * @param {Object} data - 菜园数据
   * @param {number|null} selectedPlotIndex - 当前选中的格子索引
   * @param {Function} onPlotClick - 格子点击回调
   * @param {Function} onUnlock - 解锁回调
   */
  function renderPlots(gridEl, data, selectedPlotIndex, onPlotClick, onUnlock) {
    if (!gridEl || !data) return
    
    gridEl.innerHTML = ''
    const plots = data.plots || []
    
    plots.forEach((plot, index) => {
      const plotEl = document.createElement('div')
      plotEl.className = 'garden-plot'
      
      if (plot.locked) {
        renderLockedPlot(plotEl, data, index, onUnlock)
      } else if (plot.crop) {
        renderCropPlot(plotEl, plot)
      } else {
        renderEmptyPlot(plotEl)
      }
      
      if (selectedPlotIndex === index) {
        plotEl.classList.add('selected')
      }
      
      if (!plot.locked) {
        plotEl.addEventListener('click', (event) => onPlotClick(index, event))
      }
      
      gridEl.appendChild(plotEl)
    })
  }

  /**
   * 渲染锁定的格子
   */
  function renderLockedPlot(plotEl, data, index, onUnlock) {
    const unlockConfig = PLOT_UNLOCK_CONFIG[index]
    if (!unlockConfig) return
    
    plotEl.classList.add('locked')
    
    if (unlockConfig.type === 'coins') {
      const canAfford = (data.coins || 0) >= unlockConfig.price
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
          onUnlock(index)
        })
      }
    } else if (unlockConfig.type === 'achievement') {
      const achievement = ACHIEVEMENT_CONFIG[unlockConfig.achievementId]
      const isUnlocked = data.achievements && 
                        data.achievements[unlockConfig.achievementId] && 
                        data.achievements[unlockConfig.achievementId].unlocked
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
          onUnlock(index)
        })
      }
    }
  }

  /**
   * 渲染有作物的格子
   */
  function renderCropPlot(plotEl, plot) {
    const cropConfig = CROP_CONFIG[plot.crop]
    if (!cropConfig) return
    
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

  /**
   * 渲染空格子
   */
  function renderEmptyPlot(plotEl) {
    plotEl.classList.add('empty')
    plotEl.innerHTML = '<span style="opacity: 0.3; font-size: 24px;">+</span>'
  }

  /**
   * 处理格子点击
   * @param {number} index - 格子索引
   * @param {Object} plot - 格子数据
   * @param {string|null} selectedSeed - 当前选中的种子
   * @param {Function} onHarvest - 收获回调
   * @param {Function} onPlant - 种植回调
   * @param {Function} updateTip - 更新提示回调
   */
  function handlePlotClick(index, plot, selectedSeed, onHarvest, onPlant, updateTip) {
    // 如果已有作物且成熟，可以收获
    if (plot.crop) {
      const cropConfig = CROP_CONFIG[plot.crop]
      const progress = (plot.progress / cropConfig.growTime) * 100
      
      if (progress >= 100) {
        onHarvest(index)
        return
      } else {
        updateTip('作物还未成熟，无法收获')
        return
      }
    }
    
    // 如果选择了种子且格子为空，种植
    if (selectedSeed && !plot.crop) {
      onPlant(index, selectedSeed)
    } else if (!selectedSeed) {
      updateTip('请先选择一个种子')
    }
  }

  /**
   * 种植作物 - 原子操作
   * @param {number} plotIndex - 格子索引
   * @param {string} cropKey - 作物类型
   * @param {Function} onSuccess - 成功回调
   * @param {Function} updateTip - 更新提示回调
   */
  async function plantCrop(plotIndex, cropKey, onSuccess, updateTip) {
    // 检查专注模式
    if (window.electronAPI && window.electronAPI.getTimerState) {
      try {
        const state = await window.electronAPI.getTimerState()
        if (state.focusModeEnabled && state.timerRunning) {
          updateTip('专注模式下无法种植作物，请先停止专注')
          return { success: false }
        }
      } catch (e) {
        console.error('获取计时器状态失败:', e)
      }
    }

    const result = await window.electronAPI.gardenPlant(plotIndex, cropKey)
    
    if (result.success) {
      onSuccess(result.garden)
      
      // 检查种子是否还有剩余
      const remaining = result.garden.seeds[cropKey] || 0
      if (remaining <= 0) {
        updateTip('种植成功！种子已用完')
        return { success: true, clearSeed: true }
      } else {
        updateTip(`种植成功！还剩 ${remaining} 颗 ${CROP_CONFIG[cropKey].name}种子`)
      }
      
      // 显示成就解锁
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        updateTip(`🎉 恭喜解锁成就：${names}！`)
      }
    } else {
      updateTip(result.message)
    }
    
    return result
  }

  /**
   * 收获作物 - 原子操作
   */
  async function harvestCrop(plotIndex, onSuccess, updateTip) {
    const result = await window.electronAPI.gardenHarvest(plotIndex)
    
    if (result.success) {
      onSuccess(result.garden)
      updateTip(result.message)
      
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        updateTip(`🎉 恭喜解锁成就：${names}！`)
      }
    } else {
      updateTip(result.message)
    }
    
    return result
  }

  /**
   * 解锁土地 - 原子操作
   */
  async function unlockPlot(plotIndex, onSuccess, updateTip) {
    const result = await window.electronAPI.gardenUnlockPlot(plotIndex)
    
    if (result.success) {
      onSuccess(result.garden)
      updateTip(result.message)
    } else {
      updateTip(result.message)
    }
    
    return result
  }

  // 导出到全局
  window.GardenPlot = {
    renderPlots,
    handlePlotClick,
    plantCrop,
    harvestCrop,
    unlockPlot,
    CROP_CONFIG
  }
})()
