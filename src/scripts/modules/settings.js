/**
 * 设置模块
 * 管理应用设置，包括界面显示、功能开关等
 */
;(function() {
  'use strict'

  // DOM 元素
  let elements = {}
  
  // 当前设置
  let currentSettings = null
  
  // 打开时的设置快照（用于检测改动）
  let originalSettings = null
  
  // 确认弹窗元素
  let confirmDialog = null
  
  // 弹窗实例
  let settingsModal = null

  // 彩蛋相关状态
  let easterEggClickCount = 0
  let easterEggLastClickTime = 0
  const EASTER_EGG_CLICK_INTERVAL = 800 // 两次点击最大间隔（毫秒）
  const EASTER_EGG_REQUIRED_CLICKS = 5  // 需要的点击次数

  // 设置项与 DOM ID 映射
  const SETTING_MAP = {
    // 计时器
    minimizeBehavior: 'settings-minimize-behavior',
    // 界面显示
    showDarkModeBtn: 'settings-dark-mode',
    showGardenBtn: 'settings-show-garden-btn',
    showStatsBtn: 'settings-show-stats-btn',
    showAiBtn: 'settings-show-ai-btn',
    showSidebarCollapseBtn: 'settings-show-sidebar-collapse-btn',
    showHeaderExpandBtn: 'settings-show-header-expand-btn',
    // 音乐播放器
    showShuffleBtn: 'settings-show-shuffle-btn',
    showVolumeBtn: 'settings-show-volume-slider',
    showDeviceBtn: 'settings-show-device-btn',
    showChartsBtn: 'settings-show-charts-btn',
    advancedColorCustomization: 'settings-advanced-color',
    // 系统
    autoStart: 'settings-auto-start'
  }

  // 开关设置项列表
  const TOGGLE_SETTINGS = [
    'showDarkModeBtn', 'showGardenBtn', 'showStatsBtn',
    'showAiBtn', 'showSidebarCollapseBtn', 'showHeaderExpandBtn',
    'showShuffleBtn', 'showVolumeBtn', 'showDeviceBtn', 'showChartsBtn',
    'advancedColorCustomization', 'autoStart'
  ]

  /**
   * 初始化模块
   */
  function init() {
    // 获取 DOM 元素
    elements = {
      modal: document.getElementById('settings-modal'),
      closeBtn: document.getElementById('settings-modal-close'),
      saveBtn: document.getElementById('settings-save-btn'),
      resetBtn: document.getElementById('settings-reset-btn'),
      versionText: document.getElementById('settings-version-text')
    }
    
    // 创建弹窗实例
    settingsModal = new BaseModal({
      element: elements.modal,
      showClass: 'show',
      onShow: () => {
        // 重新加载设置（确保最新）
        loadSettings()
        
        // 保存原始设置快照
        originalSettings = { ...currentSettings }
        
        // 更新表单值
        updateFormValues()
      },
      onHide: () => {
        hideConfirmDialog()
        originalSettings = null
      }
    })

    // 加载设置
    loadSettings()
    
    // 绑定事件
    bindEvents()
    
    // 应用设置到界面
    applyAllSettings()
    
    // 加载版本号
    loadVersion()

    // 绑定版本号点击事件
    bindVersionClickHandler()
  }

  /**
   * 加载版本号
   */
  async function loadVersion() {
    try {
      const version = await window.electronAPI.getVersion()
      if (elements.versionText) {
        elements.versionText.textContent = `版本 ${version}`
      }
    } catch (err) {
      console.error('[Settings] 获取版本号失败:', err)
    }
  }

  /**
   * 绑定版本号点击处理器
   */
  function bindVersionClickHandler() {
    if (!elements.versionText) return

    elements.versionText.addEventListener('click', handleVersionClick)
  }

  /**
   * 处理版本号点击
   */
  function handleVersionClick(e) {
    const now = Date.now()
    const timeSinceLastClick = now - easterEggLastClickTime

    // 如果距离上次点击超过阈值，重置计数
    if (timeSinceLastClick > EASTER_EGG_CLICK_INTERVAL && easterEggLastClickTime !== 0) {
      easterEggClickCount = 0
    }

    easterEggLastClickTime = now
    easterEggClickCount++

    // 添加视觉反馈 - 轻微缩放动画
    elements.versionText.style.transition = 'transform 0.1s ease'
    elements.versionText.style.transform = 'scale(1.15)'

    setTimeout(() => {
      elements.versionText.style.transform = 'scale(1)'
    }, 100)

    // 达到5次点击，触发彩蛋
    if (easterEggClickCount >= EASTER_EGG_REQUIRED_CLICKS) {
      triggerEasterEgg()
      easterEggClickCount = 0
      easterEggLastClickTime = 0
    }
  }

  /**
   * 触发彩蛋视觉效果
   */
  function triggerEasterEgg() {
    // 创建彩色粒子效果
    createParticleEffect()

    // 版本号文字闪烁
    flashVersionText()

    // 控制台输出神秘信息
    console.log('%c🎉 你发现了隐藏彩蛋！', 'font-size: 20px; color: #ff6b6b; font-weight: bold;')
    console.log('%c✨ 更多精彩内容等待探索...', 'font-size: 14px; color: #4ecdc4;')

    // 解锁隐藏成就
    unlockEasterEggAchievement()

    // 延迟启动太空旅行（让粒子效果先播放）
    setTimeout(() => {
      launchSpaceTravel()
    }, 800)
  }

  /**
   * 解锁隐藏成就
   */
  async function unlockEasterEggAchievement() {
    try {
      // 直接调用 garden.js 的成就解锁函数
      if (window.Garden && window.Garden.checkAndUnlockAchievements) {
        // 手动设置成就数据
        const data = await window.electronAPI.readData()
        if (data.garden && data.garden.achievements) {
          // 检查是否已解锁
          if (data.garden.achievements.easteregg && data.garden.achievements.easteregg.unlocked) {
            return // 已解锁，不重复
          }
          
          // 解锁成就
          data.garden.achievements.easteregg = {
            unlocked: true,
            unlockedAt: new Date().toISOString()
          }
          
          // 发放奖励
          if (data.garden.seeds) {
            data.garden.seeds.osmanthus = (data.garden.seeds.osmanthus || 0) + 1
          }
          data.garden.coins = (data.garden.coins || 0) + 50
          
          await window.electronAPI.writeData(data)
          
          // 显示提示
          console.log('%c🏆 成就解锁：发现彩蛋！', 'font-size: 16px; color: #FFD700; font-weight: bold;')
        }
      }
    } catch (e) {
      console.error('[Settings] 解锁成就失败:', e)
    }
  }

  /**
   * 启动番茄太空旅行
   */
  function launchSpaceTravel() {
    const spaceContainer = document.getElementById('space-travel')
    if (!spaceContainer) return

    // 关闭设置弹窗
    close()

    // 显示太空旅行容器
    spaceContainer.style.display = 'block'
    spaceContainer.classList.remove('exiting')

    // 生成随机星星
    createStars()

    // 等待感谢信息显示后才允许退出（8秒后）
    setTimeout(() => {
      enableExitInteraction(spaceContainer)
    }, 8000)
  }

  /**
   * 启用退出交互（感谢信息显示后）
   */
  function enableExitInteraction(container) {
    // 绑定退出事件
    bindSpaceTravelExit(container)

    // 添加可退出的鼠标样式
    container.classList.add('exit-ready')

    // 更新跳过提示文字（与感谢信息同时出现）
    const skipHint = document.getElementById('skip-hint')
    if (skipHint) {
      skipHint.textContent = '点击任意处或按 ESC 返回'
    }
  }

  /**
   * 创建随机星星
   */
  function createStars() {
    const starsContainer = document.getElementById('stars-container')
    if (!starsContainer) return

    // 清空之前的星星
    starsContainer.innerHTML = ''

    // 生成50个随机星星
    for (let i = 0; i < 50; i++) {
      const star = document.createElement('div')
      star.className = 'star'
      star.style.left = Math.random() * 100 + '%'
      star.style.top = Math.random() * 100 + '%'
      star.style.animationDelay = Math.random() * 2 + 's'
      star.style.animationDuration = (1.5 + Math.random() * 1.5) + 's'
      starsContainer.appendChild(star)
    }
  }

  /**
   * 绑定太空旅行退出事件
   */
  function bindSpaceTravelExit(container) {
    // 点击退出
    const handleClick = () => {
      exitSpaceTravel(container)
    }

    // ESC 键退出
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        exitSpaceTravel(container)
      }
    }

    container.addEventListener('click', handleClick, { once: true })
    document.addEventListener('keydown', handleEsc, { once: true })

    // 保存清理函数
    container._cleanupHandlers = () => {
      container.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }

  /**
   * 退出太空旅行
   */
  function exitSpaceTravel(container) {
    if (!container || container.classList.contains('exiting')) return

    // 添加退出动画类
    container.classList.add('exiting')
    container.classList.remove('exit-ready')

    // 清理事件监听
    if (container._cleanupHandlers) {
      container._cleanupHandlers()
    }

    // 动画结束后隐藏
    setTimeout(() => {
      container.style.display = 'none'
      container.classList.remove('exiting')
    }, 500)
  }

  /**
   * 创建粒子效果
   */
  function createParticleEffect() {
    const rect = elements.versionText.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    // 创建20个粒子
    for (let i = 0; i < 20; i++) {
      createParticle(centerX, centerY, i)
    }
  }

  /**
   * 创建单个粒子
   */
  function createParticle(x, y, index) {
    const particle = document.createElement('div')
    particle.className = 'easter-egg-particle'
    particle.style.cssText = `
      position: fixed;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      pointer-events: none;
      z-index: 9999;
      left: ${x}px;
      top: ${y}px;
      background: hsl(${index * 18}, 70%, 60%);
      transition: all 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      opacity: 1;
    `

    document.body.appendChild(particle)

    // 计算扩散方向
    const angle = (index / 20) * Math.PI * 2
    const distance = 60 + Math.random() * 40
    const destX = Math.cos(angle) * distance
    const destY = Math.sin(angle) * distance

    // 延迟一帧后触发动画
    requestAnimationFrame(() => {
      particle.style.transform = `translate(${destX}px, ${destY}px) scale(0)`
      particle.style.opacity = '0'
    })

    // 动画结束后移除
    setTimeout(() => {
      particle.remove()
    }, 600)
  }

  /**
   * 版本号文字闪烁效果
   */
  function flashVersionText() {
    const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a8e6cf', '#ff8b94']
    let step = 0

    const interval = setInterval(() => {
      elements.versionText.style.color = colors[step % colors.length]
      step++

      if (step >= colors.length * 2) {
        clearInterval(interval)
        // 恢复原色
        setTimeout(() => {
          elements.versionText.style.color = ''
        }, 200)
      }
    }, 100)
  }

  /**
   * 加载设置
   */
  function loadSettings() {
    currentSettings = DataStore.getSettings()
    
    // 确保所有设置项都有默认值
    const defaultSettings = Utils.createDefaultData().settings
    currentSettings = { ...defaultSettings, ...currentSettings }
  }

  /**
   * 绑定事件
   */
  function bindEvents() {
    // 关闭按钮
    if (elements.closeBtn) {
      elements.closeBtn.addEventListener('click', handleCloseClick)
    }
    
    // 点击遮罩关闭
    if (elements.modal) {
      elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) {
          handleCloseClick()
        }
      })
    }
    
    // 保存按钮
    if (elements.saveBtn) {
      elements.saveBtn.addEventListener('click', saveSettings)
    }
    
    // 恢复默认按钮
    if (elements.resetBtn) {
      elements.resetBtn.addEventListener('click', resetToDefault)
    }
  }

  /**
   * 恢复默认设置
   */
  async function resetToDefault() {
    const defaultSettings = Utils.createDefaultData().settings
    
    // 更新表单值
    const minimizeSelect = document.getElementById(SETTING_MAP.minimizeBehavior)
    if (minimizeSelect) {
      minimizeSelect.value = defaultSettings.minimizeBehavior || 'mini'
    }
    
    TOGGLE_SETTINGS.forEach(key => {
      const checkbox = document.getElementById(SETTING_MAP[key])
      if (checkbox) {
        checkbox.checked = defaultSettings[key] !== false
      }
    })
    // 不更新 originalSettings，保持打开时的快照，这样 hasChanges() 能检测到改动
  }

  /**
   * 处理关闭点击
   */
  function handleCloseClick() {
    if (hasChanges()) {
      showConfirmDialog()
    } else {
      close()
    }
  }

  /**
   * 检查是否有改动
   */
  function hasChanges() {
    if (!originalSettings) return false
    
    // 比较当前表单值与原始值
    const minimizeSelect = document.getElementById(SETTING_MAP.minimizeBehavior)
    if (minimizeSelect && minimizeSelect.value !== originalSettings.minimizeBehavior) {
      return true
    }
    
    for (const key of TOGGLE_SETTINGS) {
      const checkbox = document.getElementById(SETTING_MAP[key])
      if (checkbox) {
        const originalValue = originalSettings[key] !== false
        if (checkbox.checked !== originalValue) {
          return true
        }
      }
    }
    
    return false
  }

  /**
   * 显示确认弹窗
   */
  function showConfirmDialog() {
    // 移除已有的确认弹窗
    hideConfirmDialog()
    
    // 创建确认弹窗
    confirmDialog = document.createElement('div')
    confirmDialog.className = 'settings-confirm-dialog'
    confirmDialog.innerHTML = `
      <div class="settings-confirm-content">
        <div class="settings-confirm-title">设置未保存，确定要退出吗？</div>
        <div class="settings-confirm-buttons">
          <button class="settings-confirm-btn settings-confirm-cancel">取消</button>
          <button class="settings-confirm-btn settings-confirm-exit">退出</button>
        </div>
      </div>
    `
    
    document.body.appendChild(confirmDialog)
    
    // 绑定按钮事件
    const cancelBtn = confirmDialog.querySelector('.settings-confirm-cancel')
    const exitBtn = confirmDialog.querySelector('.settings-confirm-exit')
    
    cancelBtn.addEventListener('click', () => {
      hideConfirmDialog()
    })
    
    exitBtn.addEventListener('click', () => {
      hideConfirmDialog()
      close()
    })
  }

  /**
   * 隐藏确认弹窗
   */
  function hideConfirmDialog() {
    if (confirmDialog) {
      confirmDialog.remove()
      confirmDialog = null
    }
  }

  /**
   * 打开设置弹窗
   */
  function open() {
    settingsModal?.show()
  }

  /**
   * 关闭设置弹窗
   */
  function close() {
    settingsModal?.hide()
  }

  /**
   * 更新表单值
   */
  function updateFormValues() {
    // 下拉选择框
    const minimizeSelect = document.getElementById(SETTING_MAP.minimizeBehavior)
    if (minimizeSelect) {
      minimizeSelect.value = currentSettings.minimizeBehavior || 'mini'
    }
    
    // 开关
    TOGGLE_SETTINGS.forEach(key => {
      const checkbox = document.getElementById(SETTING_MAP[key])
      if (checkbox) {
        checkbox.checked = currentSettings[key] !== false
      }
    })
  }

  /**
   * 保存设置
   */
  async function saveSettings() {
    // 读取表单值
    const newSettings = {}
    
    // 下拉选择框
    const minimizeSelect = document.getElementById(SETTING_MAP.minimizeBehavior)
    if (minimizeSelect) {
      newSettings.minimizeBehavior = minimizeSelect.value
    }
    
    // 开关
    TOGGLE_SETTINGS.forEach(key => {
      const checkbox = document.getElementById(SETTING_MAP[key])
      if (checkbox) {
        newSettings[key] = checkbox.checked
      }
    })
    
    // 保存到存储
    await DataStore.updateSettings(newSettings)
    
    // 更新当前设置
    currentSettings = { ...currentSettings, ...newSettings }
    
    // 更新原始设置（已保存，不再提示）
    originalSettings = { ...currentSettings }
    
    // 应用设置
    await applyAllSettings()
    
    // 关闭弹窗
    close()
  }

  /**
   * 应用所有设置
   */
  async function applyAllSettings() {
    // 界面元素显示/隐藏
    applyVisibility('ui-theme-toggle-btn', currentSettings.showDarkModeBtn)
    applyVisibility('ui-garden-btn', currentSettings.showGardenBtn)
    applyVisibility('stats-btn', currentSettings.showStatsBtn)
    applyVisibility('ai-btn', currentSettings.showAiBtn)
    applyVisibility('ui-sidebar-collapse-btn', currentSettings.showSidebarCollapseBtn)
    
    // 功能按钮展开/收起按钮
    const expandBtn = document.getElementById('music-expand-btn')
    const hiddenButtons = document.getElementById('ui-hidden-buttons')
    
    if (!currentSettings.showHeaderExpandBtn) {
      // 隐藏前先展开功能按钮区域
      if (expandBtn && hiddenButtons) {
        expandBtn.classList.add('expanded')
        hiddenButtons.classList.add('expanded')
      }
    } else {
      // 显示时同步按钮状态（检查功能区域是否已展开）
      if (expandBtn && hiddenButtons) {
        const isExpanded = hiddenButtons.classList.contains('expanded')
        if (isExpanded) {
          expandBtn.classList.add('expanded')
          expandBtn.title = '收起'
        } else {
          expandBtn.classList.remove('expanded')
          expandBtn.title = '展开'
        }
      }
    }
    applyVisibility('music-expand-btn', currentSettings.showHeaderExpandBtn)
    
    // 音乐播放器元素
    applyVisibility('music-mode-btn', currentSettings.showShuffleBtn)
    applyVisibility('music-volume-btn', currentSettings.showVolumeBtn)
    applyVisibility('music-device-btn', currentSettings.showDeviceBtn)
    applyVisibility('music-charts-btn', currentSettings.showChartsBtn)
    
    // 高级颜色自定义设置
    if (window.MusicPlayer && window.MusicPlayer.setAdvancedColorCustomization) {
      window.MusicPlayer.setAdvancedColorCustomization(currentSettings.advancedColorCustomization || false)
    }
    
    // 通知主进程开机自启动设置
    if (window.electronAPI && window.electronAPI.setAutoStart) {
      await window.electronAPI.setAutoStart(currentSettings.autoStart)
    }
  }

  /**
   * 应用元素显示/隐藏
   */
  function applyVisibility(elementId, visible) {
    const element = document.getElementById(elementId)
    if (element) {
      element.style.display = visible ? '' : 'none'
    }
  }

  /**
   * 显示提示信息
   */
  function showToast(message) {
    const toast = document.getElementById('ui-toast')
    if (!toast) return
    
    toast.textContent = message
    toast.classList.add('show')
    
    setTimeout(() => {
      toast.classList.remove('show')
    }, 700)
  }

  /**
   * 获取设置值
   */
  function getSetting(key) {
    if (!currentSettings) {
      loadSettings()
    }
    return currentSettings[key]
  }

  /**
   * 获取所有设置
   */
  function getAllSettings() {
    if (!currentSettings) {
      loadSettings()
    }
    return { ...currentSettings }
  }

  // 导出到全局
  window.Settings = {
    init: init,
    open: open,
    close: close,
    getSetting: getSetting,
    getAllSettings: getAllSettings
  }
})()