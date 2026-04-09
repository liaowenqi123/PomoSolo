/**
 * 菜园子 - 成就墙模块
 * 处理成就墙弹窗、成就进度显示
 */
;(function() {
  'use strict'

  // 从 Utils 获取配置
  const CROP_CONFIG = typeof Utils !== 'undefined' ? Utils.CROP_CONFIG : {}
  const ACHIEVEMENT_CONFIG = typeof Utils !== 'undefined' ? Utils.ACHIEVEMENT_CONFIG : {}

  // DOM 元素引用
  let elements = {}

  // 弹窗实例
  let achievementModal = null

  // 当前数据引用
  let currentData = null

  /**
   * 初始化成就墙模块
   * @param {Object} els - DOM 元素引用
   */
  function init(els) {
    elements = els || {}
    
    // 初始化弹窗实例
    if (typeof BaseModal !== 'undefined' && elements.achievementModal) {
      achievementModal = new BaseModal({
        element: elements.achievementModal,
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
   * @param {Object} data - 当前菜园数据
   */
  async function openAchievementModal(data) {
    currentData = data
    
    if (achievementModal) {
      achievementModal.show()
    } else if (elements.achievementModal) {
      elements.achievementModal.classList.add('show')
    }
    renderAchievementModal(data)
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
  function renderAchievementModal(data) {
    const achievements = data.achievements || {}
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
    if (!elements.achievementList || !currentData) return
    
    elements.achievementList.innerHTML = ''
    const achievements = currentData.achievements || {}
    const stats = currentData.achievementStats || {}
    
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
    stats = stats || (currentData ? currentData.achievementStats : {}) || {}
    
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
        return (currentData && currentData.signIn && currentData.signIn.continuousDays) || 0
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
  async function updateAchievementStats(type, value, updateTip) {
    if (type === 'focus') {
      const result = await window.electronAPI.gardenUpdateFocus(value)
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        if (window.Garden) {
          window.Garden.updateData(result.garden)
        }
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        updateTip && updateTip(`🎉 恭喜解锁成就：${names}！`)
      }
      return result
    }
  }

  // 导出到全局
  window.GardenAchievement = {
    init,
    openAchievementModal,
    closeAchievementModal,
    renderAchievementModal,
    renderAchievementList,
    updateAchievementStats
  }
})()
