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
  
  // 弹窗实例
  let warningModal = null
  let apiKeyErrorModal = null
  let punishmentModal = null

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
      btnApiKeyErrorOk: document.getElementById('error-api-key-ok-btn'),
      // 惩罚弹窗
      punishmentModal: document.getElementById('punishment-modal'),
      punishmentLosses: document.getElementById('punishment-losses'),
      btnPunishmentOk: document.getElementById('punishment-ok-btn')
    }
    
    // 初始化弹窗实例
    initModals()

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
    if (elements.btnPunishmentOk) {
      elements.btnPunishmentOk.addEventListener('click', hidePunishmentModal)
    }

    // 设置 Electron 事件监听
    setupElectronListeners()
    
    // 主动查询前台检测是否就绪（解决事件时序问题）
    await checkReady()
    
    // 预热：提前调用一次显示/隐藏流程，解决第一次警告弹窗不能正确置顶的问题
    warmUpBringToFront()
  }
  
  /**
   * 初始化弹窗实例
   */
  function initModals() {
    // 警告弹窗（需要置顶、不能点击背景关闭）
    warningModal = new BaseModal({
      element: elements.warningModal,
      showClass: 'visible',
      closeOnBackground: false,
      onShow: () => {
        state.warningModalVisible = true
        // 退出迷你模式
        if (window.MiniMode && window.MiniMode.isActive()) {
          window.MiniMode.exit()
        }
        // 抢占前台
        if (window.electronAPI) {
          window.electronAPI.bringToFront()
        }
      },
      onHide: () => {
        state.warningModalVisible = false
        // 取消置顶
        if (window.electronAPI) {
          window.electronAPI.cancelAlwaysOnTop()
        }
      }
    })
    
    // API Key 错误弹窗
    apiKeyErrorModal = new BaseModal({
      element: elements.apiKeyErrorModal,
      showClass: 'visible',
      closeOnBackground: false,
      onShow: () => {
        // 抢占前台
        if (window.electronAPI) {
          window.electronAPI.bringToFront()
        }
      },
      onHide: () => {
        // 取消置顶
        if (window.electronAPI) {
          window.electronAPI.cancelAlwaysOnTop()
        }
      }
    })
    
    // 惩罚弹窗
    punishmentModal = new BaseModal({
      element: elements.punishmentModal,
      showClass: 'visible',
      closeOnBackground: false,
      onShow: () => {
        // 退出迷你模式
        if (window.MiniMode && window.MiniMode.isActive()) {
          window.MiniMode.exit()
        }
        // 抢占前台并置顶
        if (window.electronAPI) {
          window.electronAPI.bringToFront()
        }
        // 播放惩罚音效
        playPunishmentSound()
      },
      onHide: () => {
        // 取消置顶
        if (window.electronAPI) {
          window.electronAPI.cancelAlwaysOnTop()
        }
      }
    })
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
   * 注意：只有在计时器运行阶段才会处理警告
   */
  function handleEntertainmentDetected(data) {
    // 检查计时器是否仍在运行阶段
    // 如果不在运行阶段，忽略此次检测（可能是延迟到达的事件）
    if (!window.Timer || window.Timer.getPhase() !== window.Timer.PHASE.RUNNING) {
      console.log('[ForegroundDetection] 计时器不在运行阶段，忽略娱乐检测')
      return
    }
    
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
    warningModal?.show()
  }

  /**
   * 隐藏警告弹窗
   */
  function hideWarningModal() {
    warningModal?.hide()
  }

  /**
   * 显示 API Key 错误弹窗
   */
  function showApiKeyErrorModal(data) {
    // 设置错误信息
    if (elements.apiKeyErrorMessage) {
      elements.apiKeyErrorMessage.textContent = data.error || 'API key 未配置或无效'
    }
    if (elements.apiKeyErrorPath) {
      elements.apiKeyErrorPath.textContent = `配置文件路径: ${data.config_path || ''}`
    }
    apiKeyErrorModal?.show()
  }

  /**
   * 隐藏 API Key 错误弹窗
   */
  function hideApiKeyErrorModal() {
    apiKeyErrorModal?.hide()
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
   * 注意：只有在计时器运行阶段才会触发惩罚
   */
  async function triggerPunishment() {
    // 再次检查计时器是否仍在运行阶段
    // 防止在计时结束后（FINISHED阶段）仍然触发惩罚
    if (!window.Timer || window.Timer.getPhase() !== window.Timer.PHASE.RUNNING) {
      console.log('[ForegroundDetection] 计时器不在运行阶段，取消惩罚')
      // 重置警告计数
      state.warningCount = 0
      return
    }
    
    console.log('[ForegroundDetection] 触发惩罚：警告次数已达上限')
    
    // 隐藏警告弹窗
    hideWarningModal()
    
    // 获取损失详情
    let lossResult = { hasLoss: false, losses: [], totalMinutes: 0 }
    if (window.Garden) {
      lossResult = await window.Garden.handleResetPunishment()
    }
    
    // 重置计时器
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
    
    // 显示惩罚弹窗
    showPunishmentModal(lossResult)
  }

  /**
   * 显示惩罚弹窗
   * @param {Object} lossResult - 损失详情 { hasLoss, losses, totalMinutes }
   */
  function showPunishmentModal(lossResult) {
    if (!elements.punishmentLosses) return
    
    // 渲染损失列表
    if (lossResult.hasLoss && lossResult.losses.length > 0) {
      let lossesHtml = '<div class="punishment-losses-title">你的损失：</div>'
      
      lossResult.losses.forEach(loss => {
        lossesHtml += `
          <div class="punishment-loss-item">
            <span class="punishment-loss-icon">${loss.icon}</span>
            <div class="punishment-loss-info">
              <div class="punishment-loss-name">${loss.name}</div>
              <div class="punishment-loss-time">已生长 ${loss.progress}/${loss.growTime} 分钟</div>
            </div>
          </div>
        `
      })
      
      // 添加总时间
      lossesHtml += `
        <div class="punishment-total-time">
          <div class="total-label">共计损失</div>
          <div class="total-value">${lossResult.totalMinutes} 分钟心血</div>
        </div>
      `
      
      elements.punishmentLosses.innerHTML = lossesHtml
    } else {
      elements.punishmentLosses.innerHTML = '<div class="punishment-no-loss">幸好没有正在生长的作物</div>'
    }
    
    punishmentModal?.show()
  }

  /**
   * 隐藏惩罚弹窗
   */
  function hidePunishmentModal() {
    punishmentModal?.hide()
  }

  /**
   * 播放惩罚音效
   */
  function playPunishmentSound() {
    try {
      // 使用 Web Audio API 创建悲伤音效
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      
      // 创建低沉的音调
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      
      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      
      oscillator.frequency.setValueAtTime(200, audioContext.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.5)
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5)
      
      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.5)
      
      // 播放第二个音调
      setTimeout(() => {
        const osc2 = audioContext.createOscillator()
        const gain2 = audioContext.createGain()
        
        osc2.connect(gain2)
        gain2.connect(audioContext.destination)
        
        osc2.frequency.setValueAtTime(150, audioContext.currentTime)
        osc2.frequency.exponentialRampToValueAtTime(80, audioContext.currentTime + 0.8)
        
        gain2.gain.setValueAtTime(0.25, audioContext.currentTime)
        gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8)
        
        osc2.start(audioContext.currentTime)
        osc2.stop(audioContext.currentTime + 0.8)
      }, 300)
    } catch (e) {
      console.log('[ForegroundDetection] 无法播放音效:', e)
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
