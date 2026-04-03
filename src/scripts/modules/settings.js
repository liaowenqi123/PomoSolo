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
    // 系统
    autoStart: 'settings-auto-start'
  }

  // 开关设置项列表
  const TOGGLE_SETTINGS = [
    'showDarkModeBtn', 'showGardenBtn', 'showStatsBtn',
    'showAiBtn', 'showSidebarCollapseBtn', 'showHeaderExpandBtn',
    'showShuffleBtn', 'showVolumeBtn', 'showDeviceBtn', 'showChartsBtn', 'autoStart'
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

    // 加载设置
    loadSettings()
    
    // 绑定事件
    bindEvents()
    
    // 应用设置到界面
    applyAllSettings()
    
    // 加载版本号
    loadVersion()
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
    // 展开侧边栏（如果收起状态）
    if (window.expandSidebarIfNeeded) {
      window.expandSidebarIfNeeded()
    }
    
    // 重新加载设置（确保最新）
    loadSettings()
    
    // 保存原始设置快照
    originalSettings = { ...currentSettings }
    
    // 更新表单值
    updateFormValues()
    
    // 显示弹窗
    if (elements.modal) {
      elements.modal.classList.add('show')
    }
  }

  /**
   * 关闭设置弹窗
   */
  function close() {
    hideConfirmDialog()
    originalSettings = null
    if (elements.modal) {
      elements.modal.classList.remove('show')
    }
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