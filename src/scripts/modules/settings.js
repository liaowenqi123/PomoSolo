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
    miniExitMode: 'settings-mini-exit-mode',
    // 界面显示
    showDarkModeBtn: 'settings-dark-mode',
    showGardenBtn: 'settings-show-garden-btn',
    showStatsBtn: 'settings-show-stats-btn',
    showAiBtn: 'settings-show-ai-btn',
    showStudyRoomBtn: 'settings-show-study-room-btn',
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

  // 下拉选择框设置项列表
  const SELECT_SETTINGS = ['minimizeBehavior', 'miniExitMode']

  // 开关设置项列表
  const TOGGLE_SETTINGS = [
    'showDarkModeBtn', 'showGardenBtn', 'showStatsBtn',
    'showAiBtn', 'showStudyRoomBtn', 'showSidebarCollapseBtn', 'showHeaderExpandBtn',
    'showShuffleBtn', 'showVolumeBtn', 'showDeviceBtn', 'showChartsBtn',
    'advancedColorCustomization', 'autoStart'
  ]

  /**
   * 初始化模块
   */
  async function init() {
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
      onShow: async () => {
        // 重新加载设置（确保最新）
        await loadSettings()
        
        // 保存原始设置快照（深拷贝快捷键配置）
        originalSettings = { 
          ...currentSettings,
          musicHotkeys: JSON.parse(JSON.stringify(currentSettings.musicHotkeys || {}))
        }
        
        // 更新表单值
        updateFormValues()
      },
      onHide: () => {
        hideConfirmDialog()
        originalSettings = null
      },
      onBackgroundClick: () => {
        // 点击背景时，使用和关闭按钮相同的逻辑
        handleCloseClick()
        // 返回 false 阻止默认关闭行为（由 handleCloseClick 决定是否关闭）
        return false
      }
    })

    // 加载设置
    await loadSettings()
    
    // 绑定事件
    bindEvents()
    
    // 应用设置到界面
    await applyAllSettings()
    
    // 加载版本号
    loadVersion()

    // 绑定版本号点击事件
    bindVersionClickHandler()

    // 初始化意见反馈功能
    initFeedback()
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
  async function loadSettings() {
    currentSettings = await DataStore.getSettings()
    
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
    
    // 保存按钮
    if (elements.saveBtn) {
      elements.saveBtn.addEventListener('click', saveSettings)
    }
    
    // 恢复默认按钮
    if (elements.resetBtn) {
      elements.resetBtn.addEventListener('click', resetToDefault)
    }
    
    // 迷你模式退出方式选择变化时显示/隐藏提示
    const miniExitModeSelect = document.getElementById(SETTING_MAP.miniExitMode)
    if (miniExitModeSelect) {
      miniExitModeSelect.addEventListener('change', updateMiniExitHint)
    }

    // 绑定快捷键设置按钮事件
    bindHotkeyEvents()
  }

  /**
   * 更新迷你模式退出方式提示
   */
  function updateMiniExitHint() {
    const select = document.getElementById(SETTING_MAP.miniExitMode)
    const hint = document.getElementById('settings-mini-exit-hint')
    if (select && hint) {
      hint.style.display = select.value === 'double-click' ? 'block' : 'none'
    }
  }

  /**
   * 恢复默认设置
   */
  async function resetToDefault() {
    const defaultSettings = Utils.createDefaultData().settings
    
    // 更新下拉选择框
    SELECT_SETTINGS.forEach(key => {
      const select = document.getElementById(SETTING_MAP[key])
      if (select) {
        select.value = defaultSettings[key] || select.options[0].value
      }
    })
    
    // 更新开关
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
    
    // 比较下拉选择框
    for (const key of SELECT_SETTINGS) {
      const select = document.getElementById(SETTING_MAP[key])
      if (select && select.value !== originalSettings[key]) {
        return true
      }
    }
    
    // 比较开关
    for (const key of TOGGLE_SETTINGS) {
      const checkbox = document.getElementById(SETTING_MAP[key])
      if (checkbox) {
        const originalValue = originalSettings[key] !== false
        if (checkbox.checked !== originalValue) {
          return true
        }
      }
    }
    
    // 比较快捷键设置
    if (currentSettings.musicHotkeys && originalSettings.musicHotkeys) {
      const current = currentSettings.musicHotkeys
      const original = originalSettings.musicHotkeys
      const actions = ['pause', 'next', 'prev', 'volUp', 'volDown']
      for (const action of actions) {
        const currentKeys = (current[action] || []).sort().join(',')
        const originalKeys = (original[action] || []).sort().join(',')
        if (currentKeys !== originalKeys) {
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
    
    // 添加到设置弹窗内部，而不是 body
    elements.modal.appendChild(confirmDialog)
    
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
    SELECT_SETTINGS.forEach(key => {
      const select = document.getElementById(SETTING_MAP[key])
      if (select) {
        select.value = currentSettings[key] || select.options[0].value
      }
    })
    
    // 开关
    TOGGLE_SETTINGS.forEach(key => {
      const checkbox = document.getElementById(SETTING_MAP[key])
      if (checkbox) {
        checkbox.checked = currentSettings[key] !== false
      }
    })
    
    // 更新迷你模式退出方式提示
    updateMiniExitHint()
    
    // 初始化快捷键设置显示
    initHotkeySettings()
  }

  /**
   * 保存设置
   */
  async function saveSettings() {
    // 读取表单值
    const newSettings = {}
    
    // 下拉选择框
    SELECT_SETTINGS.forEach(key => {
      const select = document.getElementById(SETTING_MAP[key])
      if (select) {
        newSettings[key] = select.value
      }
    })
    
    // 开关
    TOGGLE_SETTINGS.forEach(key => {
      const checkbox = document.getElementById(SETTING_MAP[key])
      if (checkbox) {
        newSettings[key] = checkbox.checked
      }
    })
    
    // 快捷键设置（从当前设置中读取，因为不是表单元素）
    if (currentSettings.musicHotkeys) {
      newSettings.musicHotkeys = currentSettings.musicHotkeys
    }
    
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
    applyVisibility('ui-study-room-btn', currentSettings.showStudyRoomBtn)
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

    // 发送快捷键配置给 Python
    if (currentSettings.musicHotkeys && window.electronAPI && window.electronAPI.musicSetHotkeys) {
      try {
        await window.electronAPI.musicSetHotkeys(currentSettings.musicHotkeys)
      } catch (err) {
        console.error('[Settings] 发送快捷键配置失败:', err)
      }
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

  // ============ 快捷键设置 ============

  // 快捷键录制状态
  let isRecordingHotkey = false
  let currentRecordingAction = null
  let recordedKeys = []

  // 快捷键名称映射
  const HOTKEY_NAMES = {
    'Key.ctrl_l': '左Ctrl',
    'Key.ctrl_r': '右Ctrl',
    'Key.shift_l': '左Shift',
    'Key.shift_r': '右Shift',
    'Key.alt_l': '左Alt',
    'Key.alt_r': '右Alt',
    'Key.left': '←',
    'Key.right': '→',
    'Key.up': '↑',
    'Key.down': '↓',
    'Key.space': '空格',
    'Key.enter': '回车',
    'Key.tab': 'Tab'
  }

  /**
   * 将快捷键字符串转换为显示名称
   */
  function formatHotkeyDisplay(keyStrs) {
    if (!keyStrs || keyStrs.length === 0) return '未设置'
    
    return keyStrs.map(key => {
      // 检查是否在映射表中
      if (HOTKEY_NAMES[key]) {
        return HOTKEY_NAMES[key]
      }
      // 检查是否是普通字符
      if (key.startsWith('char.')) {
        return key.substring(5).toUpperCase()
      }
      // 其他情况，提取最后部分
      const parts = key.split('.')
      return parts[parts.length - 1].toUpperCase()
    }).join(' + ')
  }

  /**
   * 初始化快捷键 UI
   */
  function initHotkeySettings() {
    if (!currentSettings || !currentSettings.musicHotkeys) return

    const hotkeys = currentSettings.musicHotkeys
    const actions = ['pause', 'next', 'prev', 'volUp', 'volDown']

    actions.forEach(action => {
      const displayEl = document.getElementById(`hotkey-display-${action}`)
      if (displayEl && hotkeys[action]) {
        displayEl.textContent = formatHotkeyDisplay(hotkeys[action])
      }
    })
  }

  /**
   * 绑定快捷键设置按钮事件
   */
  function bindHotkeyEvents() {
    const buttons = document.querySelectorAll('.hotkey-set-btn')
    buttons.forEach(btn => {
      btn.addEventListener('click', () => startHotkeyRecording(btn.dataset.action))
    })

    // 监听快捷键按键事件
    if (window.electronAPI && window.electronAPI.onMusicHotkeyKeyPressed) {
      window.electronAPI.onMusicHotkeyKeyPressed((data) => {
        if (isRecordingHotkey && data.key) {
          // 添加按键到录制列表
          if (!recordedKeys.includes(data.key)) {
            recordedKeys.push(data.key)
            updateRecordingDisplay()
            
            // 2 个按键就完成录制
            if (recordedKeys.length >= 2) {
              setTimeout(() => finishHotkeyRecording(), 100)
            }
          }
        }
      })
    }
  }

  /**
   * 开始录制快捷键
   */
  async function startHotkeyRecording(action) {
    if (isRecordingHotkey) return

    isRecordingHotkey = true
    currentRecordingAction = action
    recordedKeys = []

    // 更新按钮状态
    const btn = document.querySelector(`.hotkey-set-btn[data-action="${action}"]`)
    if (btn) {
      btn.classList.add('recording')
      btn.textContent = '录制中...'
    }

    // 显示录制提示
    const hint = document.getElementById('hotkey-recording-hint')
    const keysDisplay = document.getElementById('hotkey-recording-keys')
    if (hint) {
      hint.style.display = 'flex'
      if (keysDisplay) keysDisplay.textContent = ''
    }

    // 通知 Python 开始录制
    try {
      await window.electronAPI.musicStartHotkeyRecording()
    } catch (err) {
      console.error('[Settings] 开始录制快捷键失败:', err)
      stopHotkeyRecording()
    }
  }

  /**
   * 更新录制显示
   */
  function updateRecordingDisplay() {
    const keysDisplay = document.getElementById('hotkey-recording-keys')
    if (keysDisplay) {
      keysDisplay.textContent = formatHotkeyDisplay(recordedKeys)
    }
  }

  /**
   * 完成快捷键录制
   */
  async function finishHotkeyRecording() {
    if (!isRecordingHotkey) return

    const action = currentRecordingAction
    const keys = [...recordedKeys]

    // 停止录制
    await stopHotkeyRecording()

    // 如果录制到按键，更新设置
    if (keys.length > 0) {
      // 更新本地设置
      if (!currentSettings.musicHotkeys) {
        currentSettings.musicHotkeys = {}
      }
      currentSettings.musicHotkeys[action] = keys

      // 更新显示
      const displayEl = document.getElementById(`hotkey-display-${action}`)
      if (displayEl) {
        displayEl.textContent = formatHotkeyDisplay(keys)
      }

      // 通知 Python 更新快捷键
      try {
        await window.electronAPI.musicSetHotkeys(currentSettings.musicHotkeys)
        showToast('快捷键已更新')
      } catch (err) {
        console.error('[Settings] 更新快捷键失败:', err)
        showToast('快捷键更新失败')
      }
    }
  }

  /**
   * 停止快捷键录制
   */
  async function stopHotkeyRecording() {
    isRecordingHotkey = false

    // 更新按钮状态
    const btn = document.querySelector(`.hotkey-set-btn[data-action="${currentRecordingAction}"]`)
    if (btn) {
      btn.classList.remove('recording')
      btn.textContent = '设置'
    }

    // 隐藏录制提示
    const hint = document.getElementById('hotkey-recording-hint')
    if (hint) {
      hint.style.display = 'none'
    }

    // 通知 Python 停止录制
    try {
      await window.electronAPI.musicStopHotkeyRecording()
    } catch (err) {
      console.error('[Settings] 停止录制快捷键失败:', err)
    }

    currentRecordingAction = null
    recordedKeys = []
  }

  /**
   * 获取设置值
   */
  function getSetting(key) {
    if (!currentSettings) {
      // 如果还没加载，返回默认值
      return Utils.createDefaultData().settings[key]
    }
    return currentSettings[key]
  }

  
  /**
   * 获取所有设置
   */
  function getAllSettings() {
    if (!currentSettings) {
      return { ...Utils.createDefaultData().settings }
    }
    return { ...currentSettings }
  }

  // ============ 意见反馈功能 ============

  // 反馈状态映射
  const FEEDBACK_STATUS = {
    0: { text: '已收到', class: 'feedback-status-0' },
    1: { text: '已采纳(待更新)', class: 'feedback-status-1' },
    2: { text: '已采纳(已更新)', class: 'feedback-status-2' },
    3: { text: '已拒绝', class: 'feedback-status-3' }
  }

  // 反馈弹窗实例
  let feedbackModal = null

  /**
   * 初始化意见反馈功能
   */
  function initFeedback() {
    // 绑定打开反馈弹窗按钮
    const openBtn = document.getElementById('feedback-open-btn')
    if (openBtn) {
      openBtn.addEventListener('click', openFeedbackModal)
    }

    // 绑定弹窗关闭按钮
    const closeBtn = document.getElementById('feedback-modal-close')
    if (closeBtn) {
      closeBtn.addEventListener('click', closeFeedbackModal)
    }

    // 绑定输入框事件
    const feedbackInput = document.getElementById('feedback-input')
    const submitBtn = document.getElementById('feedback-submit-btn')
    const refreshBtn = document.getElementById('feedback-refresh-btn')
    const loginBtn = document.getElementById('feedback-login-btn')

    if (feedbackInput) {
      // 输入字数统计
      feedbackInput.addEventListener('input', () => {
        const count = feedbackInput.value.length
        const countEl = document.getElementById('feedback-char-count')
        if (countEl) {
          countEl.textContent = count
        }
      })
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', handleSubmitFeedback)
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadUserFeedbacks)
    }

    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        // 关闭反馈弹窗和设置弹窗，打开登录弹窗
        closeFeedbackModal()
        close()
        const modal = document.getElementById('auth-modal')
        if (modal) {
          modal.classList.add('show')
        }
      })
    }

    // 初始化弹窗实例
    const modalEl = document.getElementById('feedback-modal')
    if (modalEl) {
      feedbackModal = new BaseModal({
        element: modalEl,
        showClass: 'show',
        onShow: async () => {
          await updateFeedbackVisibility()
        }
      })
    }
  }

  /**
   * 打开反馈弹窗
   */
  function openFeedbackModal() {
    feedbackModal?.show()
  }

  /**
   * 关闭反馈弹窗
   */
  function closeFeedbackModal() {
    feedbackModal?.hide()
  }

  /**
   * 更新反馈区域的显示状态
   */
  async function updateFeedbackVisibility() {
    const loginPrompt = document.getElementById('feedback-login-prompt')
    const loggedInArea = document.getElementById('feedback-logged-in')

    // 检查登录状态
    let isLoggedIn = false
    try {
      const result = await window.electronAPI.cloudGetSession()
      isLoggedIn = result.success && result.session
    } catch (err) {
      console.error('[Settings] 检查登录状态失败:', err)
    }

    if (loginPrompt && loggedInArea) {
      if (isLoggedIn) {
        loginPrompt.style.display = 'none'
        loggedInArea.style.display = 'block'
        // 加载反馈列表
        loadUserFeedbacks()
      } else {
        loginPrompt.style.display = 'flex'
        loggedInArea.style.display = 'none'
      }
    }
  }

  /**
   * 提交反馈
   */
  async function handleSubmitFeedback() {
    const input = document.getElementById('feedback-input')
    const submitBtn = document.getElementById('feedback-submit-btn')

    if (!input || !submitBtn) return

    const content = input.value.trim()
    if (!content) {
      showToast('请输入反馈内容')
      return
    }

    // 禁用按钮
    submitBtn.disabled = true
    submitBtn.textContent = '提交中...'

    try {
      const result = await window.electronAPI.submitFeedback(content)
      
      if (result.success) {
        showToast('反馈提交成功')
        input.value = ''
        const countEl = document.getElementById('feedback-char-count')
        if (countEl) {
          countEl.textContent = '0'
        }
        // 刷新列表
        loadUserFeedbacks()
      } else {
        showToast(result.error || '提交失败')
      }
    } catch (err) {
      console.error('[Settings] 提交反馈失败:', err)
      showToast('提交失败')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = '提交反馈'
    }
  }

  /**
   * 加载用户反馈列表
   */
  async function loadUserFeedbacks() {
    const loadingEl = document.getElementById('feedback-loading')
    const emptyEl = document.getElementById('feedback-empty')
    const listEl = document.getElementById('feedback-list')

    if (!listEl) return

    // 显示加载状态
    if (loadingEl) loadingEl.style.display = 'block'
    if (emptyEl) emptyEl.style.display = 'none'
    listEl.innerHTML = ''

    try {
      const result = await window.electronAPI.getUserFeedbacks()
      
      if (loadingEl) loadingEl.style.display = 'none'

      if (result.success && result.data && result.data.length > 0) {
        renderFeedbackList(result.data)
      } else {
        if (emptyEl) emptyEl.style.display = 'block'
      }
    } catch (err) {
      console.error('[Settings] 加载反馈列表失败:', err)
      if (loadingEl) loadingEl.style.display = 'none'
      if (emptyEl) emptyEl.style.display = 'block'
    }
  }

  /**
   * 渲染反馈列表
   */
  function renderFeedbackList(feedbacks) {
    const listEl = document.getElementById('feedback-list')
    if (!listEl) return

    listEl.innerHTML = feedbacks.map(item => {
      const status = FEEDBACK_STATUS[item.feedback_status] || FEEDBACK_STATUS[0]
      const date = new Date(item.create_time).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })

      let remarkHtml = ''
      if (item.feedback_status === 3 && item.remark) {
        remarkHtml = `
          <div class="feedback-item-remark">
            <div class="feedback-item-remark-title">拒绝理由：</div>
            <div>${escapeHtml(item.remark)}</div>
          </div>
        `
      }

      return `
        <div class="feedback-item">
          <div class="feedback-item-header">
            <span class="feedback-item-date">${date}</span>
            <span class="feedback-item-status ${status.class}">${status.text}</span>
          </div>
          <div class="feedback-item-content">${escapeHtml(item.feedback_content)}</div>
          ${remarkHtml}
        </div>
      `
    }).join('')
  }

  /**
   * HTML 转义
   */
  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  // 导出到全局
  window.Settings = {
    init: init,
    open: open,
    close: close,
    getSetting: getSetting,
    getAllSettings: getAllSettings,
    updateFeedbackVisibility: updateFeedbackVisibility
  }
})()