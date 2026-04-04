/**
 * 番茄钟 - 应用状态管理
 * 职责：管理应用级别状态，协调模式切换
 */
;(function() {
  'use strict'

  // ============ 状态定义 ============
  const state = {
    defaultWorkTime: 25,
    defaultBreakTime: 5,
    appMode: 'single',  // 'single' | 'plan'
    focusModeEnabled: false  // 专注模式开关
  }

  // ============ 状态管理 API ============
  
  function getAppMode() {
    return state.appMode
  }

  function getDefaultWorkTime() {
    return state.defaultWorkTime
  }

  function getDefaultBreakTime() {
    return state.defaultBreakTime
  }

  /**
   * 获取专注模式状态
   */
  function isFocusModeEnabled() {
    return state.focusModeEnabled
  }

  /**
   * 切换专注模式
   */
  function toggleFocusMode() {
    state.focusModeEnabled = !state.focusModeEnabled
    // 更新 UI 显示
    updateFocusModeUI()
    return state.focusModeEnabled
  }

  /**
   * 设置专注模式
   */
  function setFocusMode(enabled) {
    state.focusModeEnabled = enabled
    updateFocusModeUI()
  }

  /**
   * 更新专注模式 UI
   */
  function updateFocusModeUI() {
    if (DOM.focusModeSwitch) {
      if (state.focusModeEnabled) {
        DOM.focusModeSwitch.classList.add('active')
      } else {
        DOM.focusModeSwitch.classList.remove('active')
      }
    }
    if (DOM.container) {
      if (state.focusModeEnabled) {
        DOM.container.classList.add('focus-mode')
      } else {
        DOM.container.classList.remove('focus-mode')
      }
    }
    // 专注模式拨杆在运行阶段不允许拨动（通过禁用点击事件实现）
    if (DOM.focusModeSwitch) {
      // 使用新的阶段系统：只有在 RUNNING 阶段才禁用
      const isRunning = window.Timer && window.Timer.getPhase() === window.Timer.PHASE.RUNNING
      if (state.focusModeEnabled && isRunning) {
        DOM.focusModeSwitch.style.pointerEvents = 'none'
        DOM.focusModeSwitch.style.opacity = '0.6'
      } else {
        DOM.focusModeSwitch.style.pointerEvents = 'auto'
        DOM.focusModeSwitch.style.opacity = '1'
      }
    }
    
    // 更新备注输入框的禁用状态
    updateNoteInputsDisabled()
  }
  
  /**
   * 更新备注输入框的禁用状态
   */
  function updateNoteInputsDisabled() {
    const disabled = state.focusModeEnabled
    
    // 计划模式的备注输入框
    const planNoteTitleInput = document.getElementById('plan-note-title-input')
    const planNoteDetailInput = document.getElementById('plan-note-detail-input')
    
    // 计时器上方的备注输入框
    const timerNoteTitleInput = document.getElementById('timer-note-title-input')
    const timerNoteInput = document.getElementById('timer-note-input')
    const timerNoteDisplay = document.getElementById('timer-note-display')
    
    if (planNoteTitleInput) {
      planNoteTitleInput.disabled = disabled
      planNoteTitleInput.style.opacity = disabled ? '0.5' : '1'
      planNoteTitleInput.style.cursor = disabled ? 'not-allowed' : 'text'
    }
    if (planNoteDetailInput) {
      planNoteDetailInput.disabled = disabled
      planNoteDetailInput.style.opacity = disabled ? '0.5' : '1'
      planNoteDetailInput.style.cursor = disabled ? 'not-allowed' : 'text'
    }
    if (timerNoteTitleInput) {
      timerNoteTitleInput.disabled = disabled
      timerNoteTitleInput.style.opacity = disabled ? '0.5' : '1'
      timerNoteTitleInput.style.cursor = disabled ? 'not-allowed' : 'text'
    }
    if (timerNoteInput) {
      timerNoteInput.style.opacity = disabled ? '0.5' : '1'
      timerNoteInput.style.pointerEvents = disabled ? 'none' : 'auto'
    }
    if (timerNoteDisplay) {
      timerNoteDisplay.style.opacity = disabled ? '0.5' : '1'
      timerNoteDisplay.style.pointerEvents = disabled ? 'none' : 'auto'
    }
  }

  // ============ 模式切换逻辑 ============
  
  /**
   * 切换应用模式（单次/计划）
   * 只能在准备阶段切换，运行阶段和结束等待阶段都不允许切换
   */
  function switchAppMode(mode) {
    // 只能在准备阶段切换
    if (Timer.getPhase() !== Timer.PHASE.READY) return
    
    state.appMode = mode
    
    if (mode === 'single') {
      switchToSingleMode()
    } else if (mode === 'plan') {
      switchToPlanMode()
    }
  }

  function switchToSingleMode() {
    // 保存计划模式的计时器状态
    if (window.Timer) {
      window.Timer.saveState('plan')
      // 恢复单次模式的计时器状态
      window.Timer.restoreState('single')
    }
    
    // 更新 UI
    updateModeSliderUI(false)
    updateContentVisibility('single')
    updateModeButtonsVisibility(true)
    
    // 根据当前工作/休息模式恢复颜色
    const currentMode = Mode.getMode()
    updateContainerColor(currentMode === 'break')
    
    // 恢复状态文字
    DOM.statusEl.textContent = currentMode === 'work' ? '准备开始专注工作' : '准备休息一下'
    
    // 重新初始化备注显示（确保显示当前模式的备注）
    if (window.Presets && window.Presets.reinitializeNoteDisplay) {
      window.Presets.reinitializeNoteDisplay()
    }
  }

  function switchToPlanMode() {
    // 保存单次模式的计时器状态
    if (window.Timer) {
      window.Timer.saveState('single')
    }
    
    // 隐藏单次模式的备注
    const timerNoteInput = document.getElementById('timer-note-input')
    const timerNoteDisplay = document.getElementById('timer-note-display')
    if (timerNoteInput) timerNoteInput.style.display = 'none'
    if (timerNoteDisplay) timerNoteDisplay.style.display = 'none'
    
    // 更新 UI
    updateModeSliderUI(true)
    updateContentVisibility('plan')
    updateModeButtonsVisibility(false)
    
    // 根据计划第一项设置时间
    PlanMode.render()
    const firstItem = PlanMode.getFirstItem()
    
    if (window.Timer) {
      // 检查计划模式是否有保存的状态
      const planState = window.Timer.getState('plan')
      
      if (planState && planState.timeLeft > 0 && planState.timeLeft !== planState.totalTime) {
        // 如果有保存的状态且不是初始状态，直接恢复
        window.Timer.restoreState('plan')
      } else {
        // 第一次进入计划模式或状态为初始值，根据第一项设置时间
        if (firstItem) {
          window.Timer.setTime(firstItem.minutes)
          updateContainerColor(firstItem.type === 'break')
        } else {
          window.Timer.setTime(25)
          updateContainerColor(false)
        }
      }
    }
    
    if (firstItem) {
      WheelPicker.setValue(firstItem.minutes)
      updateContainerColor(firstItem.type === 'break')
    } else {
      WheelPicker.setValue(25)
      updateContainerColor(false)
    }
    
    DOM.statusEl.textContent = '准备开始计划'
  }

  // ============ UI 更新辅助函数 ============
  
  function updateModeSliderUI(isPlanMode) {
    if (isPlanMode) {
      DOM.modeSlider.classList.add('plan-mode')
      DOM.modeLabels[0].classList.remove('active')
      DOM.modeLabels[1].classList.add('active')
      DOM.container.classList.add('plan-mode')
      DOM.windowFrame.classList.add('plan-mode')
    } else {
      DOM.modeSlider.classList.remove('plan-mode')
      DOM.modeLabels[0].classList.add('active')
      DOM.modeLabels[1].classList.remove('active')
      DOM.container.classList.remove('plan-mode')
      DOM.windowFrame.classList.remove('plan-mode')
    }
  }

  function updateContentVisibility(mode) {
    const planNoteSection = document.getElementById('plan-note-section')
    
    if (mode === 'single') {
      DOM.singleModeContent.style.display = 'block'
      DOM.planModeContent.style.display = 'none'
      DOM.addPresetBtn.style.display = 'flex'
      DOM.planAddButtons.style.display = 'none'
      if (planNoteSection) planNoteSection.style.display = 'none'
    } else {
      DOM.singleModeContent.style.display = 'none'
      DOM.planModeContent.style.display = 'block'
      DOM.addPresetBtn.style.display = 'none'
      DOM.planAddButtons.style.display = 'flex'
      if (planNoteSection) planNoteSection.style.display = 'block'
    }
  }

  function updateModeButtonsVisibility(visible) {
    DOM.modeBtns.forEach(btn => btn.style.display = visible ? 'flex' : 'none')
  }

  /**
   * 更新容器颜色
   */
  function updateContainerColor(isBreak) {
    if (isBreak) {
      DOM.container.classList.add('break-mode')
      DOM.windowFrame.classList.add('break-mode')
    } else {
      DOM.container.classList.remove('break-mode')
      DOM.windowFrame.classList.remove('break-mode')
    }
  }

  // 导出到全局
  window.AppState = {
    get appMode() { return state.appMode },
    get defaultWorkTime() { return state.defaultWorkTime },
    get defaultBreakTime() { return state.defaultBreakTime },
    get focusModeEnabled() { return state.focusModeEnabled },
    getAppMode,
    getDefaultWorkTime,
    getDefaultBreakTime,
    switchAppMode,
    updateContainerColor,
    isFocusModeEnabled,
    toggleFocusMode,
    setFocusMode,
    updateFocusModeUI
  }
})()
