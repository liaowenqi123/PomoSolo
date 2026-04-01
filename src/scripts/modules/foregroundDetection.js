/**
 * 前台检测模块 - 渲染进程
 * 负责管理前台检测状态、警告弹窗和惩罚触发
 */
;(function() {
  'use strict'

  // ============ 状态 ============
  const state = {
    isReady: false,           // 前台检测进程是否就绪
    isDetecting: false,       // 是否正在检测
    warningCount: 0,          // 当前专注周期的警告次数
    maxWarnings: 3,           // 最大警告次数
    lastWindowTitle: '',      // 最后检测到的娱乐窗口标题
    lastSource: '',           // 最后检测的来源 (blacklist/history/ai)
    lastKeyword: '',          // 最后匹配的关键字
    warningModalVisible: false // 警告弹窗是否显示
  }

  // DOM 元素
  let elements = {}

  /**
   * 初始化模块
   */
  async function init() {
    // 获取 DOM 元素
    elements = {
      warningModal: document.getElementById('focus-warning-modal'),
      warningWindowTitle: document.getElementById('focus-warning-window-title'),
      warningCount: document.getElementById('focus-warning-count'),
      btnNotEntertainment: document.getElementById('focus-not-entertainment-btn'),
      btnDismissWarning: document.getElementById('focus-dismiss-warning-btn'),
      // API Key 错误弹窗
      apiKeyErrorModal: document.getElementById('error-api-key-modal'),
      apiKeyErrorMessage: document.getElementById('error-api-key-message'),
      apiKeyErrorPath: document.getElementById('error-api-key-path'),
      btnApiKeyErrorOk: document.getElementById('error-api-key-ok-btn')
    }

    // 绑定事件
    if (elements.btnNotEntertainment) {
      elements.btnNotEntertainment.addEventListener('click', handleNotEntertainment)
    }
    if (elements.btnDismissWarning) {
      elements.btnDismissWarning.addEventListener('click', handleDismissWarning)
    }
    if (elements.btnApiKeyErrorOk) {
      elements.btnApiKeyErrorOk.addEventListener('click', hideApiKeyErrorModal)
    }

    // 设置 Electron 事件监听
    setupElectronListeners()
    
    // 主动查询前台检测是否就绪（解决事件时序问题）
    await checkReady()
    
    // 预热：提前调用一次显示/隐藏流程，解决第一次警告弹窗不能正确置顶的问题
    warmUpBringToFront()
  }

  /**
   * 预热窗口置顶功能
   * 解决第一次警告弹窗不能正确置顶的问题
   */
  function warmUpBringToFront() {
    if (window.electronAPI && elements.warningModal) {
      // 快速执行一次显示/隐藏 + 置顶/取消置顶
      elements.warningModal.classList.add('visible')
      window.electronAPI.bringToFront()
      // 使用 requestAnimationFrame 确保渲染一帧后再隐藏
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          elements.warningModal.classList.remove('visible')
          window.electronAPI.cancelAlwaysOnTop()
          console.log('[ForegroundDetection] 预热完成')
        })
      })
    }
  }

  /**
   * 设置 Electron 事件监听
   */
  function setupElectronListeners() {
    if (!window.electronAPI) {
      console.error('[ForegroundDetection] electronAPI 不可用')
      return
    }

    // 监听前台检测就绪
    window.electronAPI.onForegroundReady((data) => {
      state.isReady = true
      console.log('[ForegroundDetection] 前台检测进程已就绪', data)
      
      // 检查 API key 是否有效
      if (data.api_key_valid === false) {
        console.warn('[ForegroundDetection] API key 无效')
      }
    })

    // 监听 API Key 无效事件
    window.electronAPI.onForegroundApiKeyInvalid((data) => {
      console.error('[ForegroundDetection] API Key 无效', data)
      showApiKeyErrorModal(data)
    })

    // 监听检测到娱乐前台
    window.electronAPI.onForegroundEntertainmentDetected((data) => {
      console.log('[ForegroundDetection] 检测到娱乐前台', data)
      handleEntertainmentDetected(data)
    })

    // 监听状态更新
    window.electronAPI.onForegroundStatus((data) => {
      // 收到状态响应说明前台检测进程已就绪
      if (!state.isReady) {
        state.isReady = true
        console.log('[ForegroundDetection] 前台检测进程已就绪（通过状态查询确认）')
      }
      state.isDetecting = data.running
      console.log('[ForegroundDetection] 状态更新', data)
    })

    // 监听错误
    window.electronAPI.onForegroundError((data) => {
      console.error('[ForegroundDetection] 错误', data)
    })
  }

  /**
   * 检查前台检测是否就绪（主动查询）
   */
  async function checkReady() {
    if (!window.electronAPI) return false
    
    try {
      const isReady = await window.electronAPI.foregroundIsReady()
      if (isReady) {
        state.isReady = true
        console.log('[ForegroundDetection] 前台检测进程已就绪（主动查询确认）')
        // 获取当前状态
        window.electronAPI.foregroundGetStatus()
      }
      return isReady
    } catch (err) {
      console.error('[ForegroundDetection] 查询就绪状态失败', err)
      return false
    }
  }

  /**
   * 开始检测（专注模式开启且计时器运行时调用）
   */
  function startDetection() {
    if (!state.isReady) {
      console.warn('[ForegroundDetection] 前台检测进程未就绪')
      return
    }
    
    // 重置警告计数
    state.warningCount = 0
    state.isDetecting = true
    
    // 在开始检测前，发送 API Key 给 Python
    if (window.CloudAuth && window.CloudAuth.hasApiKey()) {
      const apiKey = window.CloudAuth.getApiKey()
      if (window.electronAPI) {
        window.electronAPI.foregroundSetApiKey(apiKey)
        console.log('[ForegroundDetection] 已发送 API Key 到前台检测')
      }
    }
    
    if (window.electronAPI) {
      window.electronAPI.foregroundStart()
    }
    console.log('[ForegroundDetection] 开始检测')
  }

  /**
   * 停止检测
   */
  function stopDetection() {
    state.isDetecting = false
    state.warningCount = 0
    
    if (window.electronAPI) {
      window.electronAPI.foregroundStop()
    }
    console.log('[ForegroundDetection] 停止检测')
  }

  /**
   * 处理检测到娱乐前台
   */
  function handleEntertainmentDetected(data) {
    // 如果警告弹窗已经显示，不再重复显示
    if (state.warningModalVisible) {
      return
    }

    state.lastWindowTitle = data.window_title
    state.lastSource = data.source || 'ai'
    state.lastKeyword = data.keyword || data.window_title
    // 不在这里增加警告次数，等用户点击"知道了"后再增加

    // 更新警告弹窗内容（显示即将变成的次数）
    if (elements.warningWindowTitle) {
      elements.warningWindowTitle.textContent = data.window_title
    }
    if (elements.warningCount) {
      elements.warningCount.textContent = `警告次数：${state.warningCount + 1}/${state.maxWarnings}`
    }

    // 显示警告弹窗
    showWarningModal()
  }

  /**
   * 显示警告弹窗
   */
  function showWarningModal() {
    // 展开侧边栏（如果收起状态）
    if (window.expandSidebarIfNeeded) {
      window.expandSidebarIfNeeded()
    }
    
    // 如果处于迷你模式，先退出
    if (window.MiniMode && window.MiniMode.isActive()) {
      window.MiniMode.exit()
    }
    
    if (elements.warningModal) {
      elements.warningModal.classList.add('visible')
      state.warningModalVisible = true
      // 抢占前台
      if (window.electronAPI) {
        window.electronAPI.bringToFront()
      }
    }
  }

  /**
   * 隐藏警告弹窗
   */
  function hideWarningModal() {
    if (elements.warningModal) {
      elements.warningModal.classList.remove('visible')
      state.warningModalVisible = false
      // 取消置顶
      if (window.electronAPI) {
        window.electronAPI.cancelAlwaysOnTop()
      }
    }
  }

  /**
   * 显示 API Key 错误弹窗
   */
  function showApiKeyErrorModal(data) {
    // 展开侧边栏（如果收起状态）
    if (window.expandSidebarIfNeeded) {
      window.expandSidebarIfNeeded()
    }
    
    if (elements.apiKeyErrorModal) {
      // 设置错误信息
      if (elements.apiKeyErrorMessage) {
        elements.apiKeyErrorMessage.textContent = data.error || 'API key 未配置或无效'
      }
      if (elements.apiKeyErrorPath) {
        elements.apiKeyErrorPath.textContent = `配置文件路径: ${data.config_path || ''}`
      }
      // 显示弹窗
      elements.apiKeyErrorModal.classList.add('visible')
      // 抢占前台
      if (window.electronAPI) {
        window.electronAPI.bringToFront()
      }
    }
  }

  /**
   * 隐藏 API Key 错误弹窗
   */
  function hideApiKeyErrorModal() {
    if (elements.apiKeyErrorModal) {
      elements.apiKeyErrorModal.classList.remove('visible')
      // 取消置顶
      if (window.electronAPI) {
        window.electronAPI.cancelAlwaysOnTop()
      }
    }
  }

  /**
   * 处理"不是娱乐"按钮点击
   */
  function handleNotEntertainment() {
    // 当这次警告没发生过，不增加警告次数
    
    if (window.electronAPI) {
      // 根据来源采取不同的处理
      if (state.lastSource === 'blacklist') {
        // 来自黑名单：将关键字从黑名单移到白名单
        window.electronAPI.foregroundMoveBlacklistToWhitelist(state.lastKeyword)
        console.log(`[ForegroundDetection] 将 '${state.lastKeyword}' 从黑名单移到白名单`)
      } else if (state.lastSource === 'history' || state.lastSource === 'ai') {
        // 来自历史记录或AI判断：将历史记录中的该项标记为"不是"
        window.electronAPI.foregroundMarkHistoryNot(state.lastWindowTitle)
        console.log(`[ForegroundDetection] 将历史记录标记为非娱乐: ${state.lastWindowTitle}`)
      }
    }
    
    // 隐藏弹窗
    hideWarningModal()
  }

  /**
   * 处理"知道了"按钮点击
   */
  function handleDismissWarning() {
    // 增加警告次数
    state.warningCount++
    
    // 隐藏弹窗
    hideWarningModal()
    
    // 判断是否达到惩罚条件
    if (state.warningCount >= state.maxWarnings) {
      triggerPunishment()
    }
  }

  /**
   * 触发惩罚
   */
  function triggerPunishment() {
    console.log('[ForegroundDetection] 触发惩罚：警告次数已达上限')
    
    // 隐藏警告弹窗
    hideWarningModal()
    
    // 调用菜园子的惩罚函数
    if (window.Garden) {
      window.Garden.handleResetPunishment()
    }
    
    // 重置计时器（让植物枯萎）
    if (window.Timer) {
      window.Timer.reset()
    }
    
    // 关闭专注模式
    if (window.AppState) {
      window.AppState.setFocusMode(false)
      window.AppState.updateFocusModeUI()
    }
    
    // 停止检测
    stopDetection()

    // 显示通知
    if (window.electronAPI) {
      window.electronAPI.showNotification(
        '⚠️ 专注模式中断',
        '检测到多次切换到娱乐应用，作物已枯萎！'
      )
    }
  }

  /**
   * 获取当前检测状态
   */
  function getIsDetecting() {
    return state.isDetecting
  }

  /**
   * 获取是否就绪
   */
  function getIsReady() {
    return state.isReady
  }

  // 导出到全局
  window.ForegroundDetection = {
    init: init,
    startDetection: startDetection,
    stopDetection: stopDetection,
    getIsDetecting: getIsDetecting,
    getIsReady: getIsReady
  }
})()
