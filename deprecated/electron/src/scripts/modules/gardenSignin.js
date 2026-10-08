/**
 * 菜园子 - 签到模块
 * 处理签到弹窗、签到奖励发放
 */
;(function() {
  'use strict'

  // 从 Utils 获取配置
  const CROP_CONFIG = typeof Utils !== 'undefined' ? Utils.CROP_CONFIG : {}
  const UtilsRef = typeof Utils !== 'undefined' ? Utils : {}

  // DOM 元素引用
  let elements = {}

  // 弹窗实例
  let signinModal = null

  // 当前数据引用
  let currentData = null
  let updateTipCallback = null

  /**
   * 初始化签到模块
   * @param {Object} els - DOM 元素引用
   */
  function init(els) {
    elements = els || {}
    
    // 初始化弹窗实例
    if (typeof BaseModal !== 'undefined' && elements.signinModal) {
      signinModal = new BaseModal({
        element: elements.signinModal,
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
   * @param {Object} data - 当前菜园数据
   * @param {Function} updateTip - 更新提示回调
   */
  function openSigninModal(data, updateTip) {
    currentData = data
    updateTipCallback = updateTip
    
    if (signinModal) {
      signinModal.show()
    } else if (elements.signinModal) {
      elements.signinModal.classList.add('show')
    }
    renderSigninModal(data)
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
  function renderSigninModal(data) {
    const signInData = data.signIn || {
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
    
    renderSigninRewards(data)
    
    const canSign = canSignIn(data)
    elements.signinConfirmBtn.disabled = !canSign
    elements.signinConfirmBtn.textContent = canSign ? '✅ 立即签到' : '今日已签到'
  }

  /**
   * 渲染签到奖励
   */
  function renderSigninRewards(data) {
    const today = new Date().getDay()
    const signInData = data.signIn || { continuousDays: 0 }
    
    let rewardsHtml = ''
    
    // 每日基础奖励
    if (UtilsRef.DAILY_REWARD) {
      rewardsHtml += `<div class="signin-reward-item">
        <span class="signin-reward-icon">🥕</span>
        <span>胡萝卜种子 x${UtilsRef.DAILY_REWARD.seeds.carrot}</span>
      </div>`
      rewardsHtml += `<div class="signin-reward-item">
        <span class="signin-reward-icon">💰</span>
        <span>金币 x${UtilsRef.DAILY_REWARD.coins}</span>
      </div>`
    }
    
    // 每周特殊奖励
    const weeklyReward = UtilsRef.WEEKLY_REWARDS && UtilsRef.WEEKLY_REWARDS[today]
    if (weeklyReward) {
      if (weeklyReward.randomSeed) {
        rewardsHtml += `<div class="signin-reward-item extra">
          <span class="signin-reward-icon">🎁</span>
          <span>随机种子礼包 x1</span>
        </div>`
      } else if (Object.keys(weeklyReward.seeds || {}).length > 0 || weeklyReward.coins > 0) {
        const seedEntries = Object.entries(weeklyReward.seeds || {})
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
    
    // 连续签到里程碑奖励
    const nextMilestone = getNextMilestone(signInData.continuousDays)
    if (nextMilestone && UtilsRef.CONTINUOUS_REWARDS) {
      const reward = UtilsRef.CONTINUOUS_REWARDS[nextMilestone]
      const seedKey = Object.keys(reward.seeds || {})[0]
      if (seedKey) {
        const crop = CROP_CONFIG[seedKey]
        rewardsHtml += `<div class="signin-reward-item extra">
          <span class="signin-reward-icon">${crop.icon}</span>
          <span>连续${nextMilestone}天: ${crop.name}种子 x${reward.seeds[seedKey]}</span>
        </div>`
      }
    }
    
    elements.signinRewardsList.innerHTML = rewardsHtml
  }

  /**
   * 检查是否可以签到
   */
  function canSignIn(data) {
    const signInData = data.signIn || { lastDate: null }
    const today = new Date().toDateString()
    return signInData.lastDate !== today
  }

  /**
   * 获取下一个连续签到里程碑
   */
  function getNextMilestone(currentDays) {
    if (!UtilsRef.CONTINUOUS_REWARDS) return null
    const milestones = Object.keys(UtilsRef.CONTINUOUS_REWARDS).map(Number).sort((a, b) => a - b)
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
    if (!currentData || !canSignIn(currentData)) {
      updateTipCallback && updateTipCallback('今日已签到')
      return
    }
    
    const result = await window.electronAPI.gardenSignIn()
    
    if (result.success && window.Garden) {
      window.Garden.updateData(result.garden)
      updateTipCallback && updateTipCallback('签到成功！奖励已发放')
      
      if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
        const names = result.unlockedAchievements.map(a => a.name).join('、')
        updateTipCallback && updateTipCallback(`🎉 签到成功！解锁成就：${names}！`)
      }
      
      updateSigninBtnStatus(result.garden)
      renderSigninModal(result.garden)
      window.Garden.render()
    } else {
      updateTipCallback && updateTipCallback(result.message)
    }
  }

  /**
   * 更新签到按钮状态
   */
  function updateSigninBtnStatus(data) {
    if (elements.signinBtn) {
      if (canSignIn(data)) {
        elements.signinBtn.classList.remove('signed')
      } else {
        elements.signinBtn.classList.add('signed')
      }
    }
  }

  // 导出到全局
  window.GardenSignin = {
    init,
    openSigninModal,
    closeSigninModal,
    renderSigninModal,
    canSignIn,
    updateSigninBtnStatus
  }
})()
