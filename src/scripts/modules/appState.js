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
    appMode: 'single',  // 'single' | 'plan' | 'stopwatch'
    focusModeEnabled: false,  // 单次/计划模式的专注模式开关
    // 正向计时模式没有专注模式，不需要单独的状态
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
   * 正向计时模式永远返回 false（没有专注模式）
   */
  function isFocusModeEnabled() {
    // 正向计时模式没有专注模式
    if (state.appMode === 'stopwatch') {
      return false
    }
    return state.focusModeEnabled
  }

  /**
   * 切换专注模式
   * 正向计时模式下不允许切换
   */
  function toggleFocusMode() {
    // 正向计时模式没有专注模式
    if (state.appMode === 'stopwatch') {
      return false
    }
    
    state.focusModeEnabled = !state.focusModeEnabled
    // 更新 UI 显示
    updateFocusModeUI()
    return state.focusModeEnabled
  }

  /**
   * 设置专注模式
   * 正向计时模式下不允许设置
   */
  function setFocusMode(enabled) {
    // 正向计时模式没有专注模式
    if (state.appMode === 'stopwatch') {
      return
    }
    
    state.focusModeEnabled = enabled
    updateFocusModeUI()
  }

  /**
   * 更新专注模式 UI
   * 正向计时模式下不更新（因为没有专注模式开关）
   */
  function updateFocusModeUI() {
    // 正向计时模式没有专注模式 UI
    if (state.appMode === 'stopwatch') {
      return
    }
    
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
    
    // 更新专注模式状态文字
    if (DOM.focusModeStatus) {
      DOM.focusModeStatus.textContent = state.focusModeEnabled ? '开启' : '关闭'
      DOM.focusModeStatus.classList.toggle('active', state.focusModeEnabled)
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
   * 注意：专注模式下仍然允许编辑备注，只是在运行时不允许
   */
  function updateNoteInputsDisabled() {
    // 移除专注模式对备注编辑的限制
    // 备注应该随时可以编辑，不受专注模式影响
    
    // 计划模式的备注输入框 - 始终可用
    const planNoteTitleInput = document.getElementById('plan-note-title-input')
    const planNoteDetailInput = document.getElementById('plan-note-detail-input')
    
    if (planNoteTitleInput) {
      planNoteTitleInput.disabled = false
      planNoteTitleInput.style.opacity = '1'
      planNoteTitleInput.style.cursor = 'text'
    }
    if (planNoteDetailInput) {
      planNoteDetailInput.disabled = false
      planNoteDetailInput.style.opacity = '1'
      planNoteDetailInput.style.cursor = 'text'
    }
    
    // 计时器上方的备注输入框 - 始终可用
    const timerNoteTitleInput = document.getElementById('timer-note-title-input')
    const timerNoteInput = document.getElementById('timer-note-input')
    const timerNoteDisplay = document.getElementById('timer-note-display')
    
    if (timerNoteTitleInput) {
      timerNoteTitleInput.disabled = false
      timerNoteTitleInput.style.opacity = '1'
      timerNoteTitleInput.style.cursor = 'text'
    }
    if (timerNoteInput) {
      timerNoteInput.style.opacity = '1'
      timerNoteInput.style.pointerEvents = 'auto'
    }
    if (timerNoteDisplay) {
      timerNoteDisplay.style.opacity = '1'
      timerNoteDisplay.style.pointerEvents = 'auto'
    }
  }

  // ============ 模式切换逻辑 ============
  
  /**
   * 切换应用模式（单次/计划/正向）
   * 只能在准备阶段切换，运行阶段和结束等待阶段都不允许切换
   */
  function switchAppMode(mode) {
    // 正向计时模式可以随时切换
    if (mode === 'stopwatch') {
      // 如果当前有计时器在运行，先停止
      if (window.Timer && window.Timer.getPhase() === window.Timer.PHASE.RUNNING) {
        window.Timer.reset()
      }
      state.appMode = mode
      switchToStopwatchMode()
      return
    }
    
    // 从正向计时切换到其他模式
    if (state.appMode === 'stopwatch') {
      // 停止正向计时器
      if (window.Stopwatch && window.Stopwatch.getIsRunning()) {
        window.Stopwatch.reset()
      }
      state.appMode = mode
      if (mode === 'single') {
        switchToSingleMode()
      } else if (mode === 'plan') {
        switchToPlanMode()
      }
      return
    }
    
    // 单次和计划模式之间切换：只能在准备阶段切换
    if (Timer.getPhase() !== Timer.PHASE.READY) return
    
    state.appMode = mode
    
    if (mode === 'single') {
      switchToSingleMode()
    } else if (mode === 'plan') {
      switchToPlanMode()
    }
  }

  function switchToSingleMode() {
    // 保存当前模式的备注
    const timerNoteText = document.getElementById('timer-note-text')
    const currentNote = timerNoteText ? timerNoteText.textContent.trim() : ''
    
    if (state.appMode === 'stopwatch') {
      // 从正向计时切换过来，保存正向计时的备注
      const data = DataStore.getData()
      data.stopwatchModeNote = currentNote
      DataStore.saveImmediate()
    } else if (state.appMode === 'plan') {
      // 从计划模式切换过来，不需要保存（计划模式不使用这个备注区域）
    }
    
    // 保存计划模式的计时器状态
    if (window.Timer) {
      window.Timer.saveState('plan')
      // 恢复单次模式的计时器状态
      window.Timer.restoreState('single')
    }
    
    // 移除正向计时模式的类
    DOM.container.classList.remove('stopwatch-mode')
    DOM.windowFrame.classList.remove('stopwatch-mode')
    
    // 恢复专注模式状态文字
    if (DOM.focusModeStatus) {
      DOM.focusModeStatus.textContent = AppState.focusModeEnabled ? '开启' : '关闭'
    }
    
    // 更新 UI
    updateModeSliderUI('single')
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
    // 保存当前模式的备注
    const timerNoteText = document.getElementById('timer-note-text')
    const currentNote = timerNoteText ? timerNoteText.textContent.trim() : ''
    
    if (state.appMode === 'stopwatch') {
      // 从正向计时切换过来，保存正向计时的备注
      const data = DataStore.getData()
      data.stopwatchModeNote = currentNote
      DataStore.saveImmediate()
    } else if (state.appMode === 'single') {
      // 从单次模式切换过来，保存单次模式的备注
      const data = DataStore.getData()
      data.singleModeNote = currentNote
      DataStore.saveImmediate()
    }
    
    // 保存单次模式的计时器状态
    if (window.Timer) {
      window.Timer.saveState('single')
    }
    
    // 隐藏单次模式的备注
    const timerNoteInput = document.getElementById('timer-note-input')
    const timerNoteDisplay = document.getElementById('timer-note-display')
    if (timerNoteInput) timerNoteInput.style.display = 'none'
    if (timerNoteDisplay) timerNoteDisplay.style.display = 'none'
    
    // 恢复专注模式状态文字
    if (DOM.focusModeStatus) {
      DOM.focusModeStatus.textContent = AppState.focusModeEnabled ? '开启' : '关闭'
    }
    
    // 更新 UI
    updateModeSliderUI('plan')
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

  function switchToStopwatchMode() {
    // 保存当前模式的备注
    const timerNoteText = document.getElementById('timer-note-text')
    const currentNote = timerNoteText ? timerNoteText.textContent.trim() : ''
    
    if (state.appMode === 'single') {
      // 从单次模式切换过来，保存单次模式的备注
      const data = DataStore.getData()
      data.singleModeNote = currentNote
      DataStore.saveImmediate()
    }
    // 计划模式不使用timer-note-text，所以不需要保存
    
    // 显示备注区域（正向计时也使用备注功能）
    const timerNoteInput = document.getElementById('timer-note-input')
    const timerNoteDisplay = document.getElementById('timer-note-display')
    
    // 显示备注显示区域
    if (timerNoteDisplay) {
      timerNoteDisplay.style.display = 'flex'
    }
    // 隐藏备注输入区域
    if (timerNoteInput) {
      timerNoteInput.style.display = 'none'
    }
    
    // 恢复正向计时的备注（从DataStore读取）
    if (timerNoteText) {
      const data = DataStore.getData()
      const stopwatchNote = data.stopwatchModeNote || ''
      timerNoteText.textContent = stopwatchNote
    }
    
    // 清空专注模式状态文字
    if (DOM.focusModeStatus) {
      DOM.focusModeStatus.textContent = ''
    }
    
    // 更新 UI
    updateModeSliderUI('stopwatch')
    updateContentVisibility('stopwatch')
    updateModeButtonsVisibility(false)
    
    // 移除工作/休息模式的颜色
    updateContainerColor(false)
    DOM.container.classList.add('stopwatch-mode')
    DOM.windowFrame.classList.add('stopwatch-mode')
    
    // 初始化正向计时器显示
    if (window.Stopwatch) {
      window.Stopwatch.init(
        {
          timeDisplay: DOM.timeDisplay,
          startBtn: DOM.startBtn,
          progressCircle: DOM.progressCircle
        },
        {
          onStart: () => {
            console.log('正向计时开始')
          },
          onReset: () => {
            console.log('正向计时重置')
          }
        }
      )
    }
    
    DOM.statusEl.textContent = '准备开始计时'
  }

  // ============ UI 更新辅助函数 ============
  
  function updateModeSliderUI(mode) {
    // 移除所有模式类
    DOM.modeSlider.classList.remove('plan-mode', 'stopwatch-mode')
    DOM.container.classList.remove('plan-mode', 'stopwatch-mode')
    DOM.windowFrame.classList.remove('plan-mode', 'stopwatch-mode')
    
    // 更新标签激活状态
    DOM.modeLabels.forEach(label => {
      label.classList.remove('active')
      if (label.dataset.mode === mode) {
        label.classList.add('active')
      }
    })
    
    // 添加对应模式的类
    if (mode === 'plan') {
      DOM.modeSlider.classList.add('plan-mode')
      DOM.container.classList.add('plan-mode')
      DOM.windowFrame.classList.add('plan-mode')
    } else if (mode === 'stopwatch') {
      DOM.modeSlider.classList.add('stopwatch-mode')
      DOM.container.classList.add('stopwatch-mode')
      DOM.windowFrame.classList.add('stopwatch-mode')
    }
  }

  function updateContentVisibility(mode) {
    const planNoteSection = document.getElementById('plan-note-section')
    const stopwatchModeContent = document.getElementById('stopwatch-mode-content')
    const wheelPickerContainer = document.querySelector('.wheel-picker-container')
    
    if (mode === 'single') {
      DOM.singleModeContent.style.display = 'block'
      DOM.planModeContent.style.display = 'none'
      if (stopwatchModeContent) stopwatchModeContent.style.display = 'none'
      DOM.addPresetBtn.style.display = 'flex'
      DOM.planAddButtons.style.display = 'none'
      if (planNoteSection) planNoteSection.style.display = 'none'
      if (wheelPickerContainer) wheelPickerContainer.style.display = 'flex'
    } else if (mode === 'plan') {
      DOM.singleModeContent.style.display = 'none'
      DOM.planModeContent.style.display = 'block'
      if (stopwatchModeContent) stopwatchModeContent.style.display = 'none'
      DOM.addPresetBtn.style.display = 'none'
      DOM.planAddButtons.style.display = 'flex'
      if (planNoteSection) planNoteSection.style.display = 'block'
      if (wheelPickerContainer) wheelPickerContainer.style.display = 'flex'
    } else if (mode === 'stopwatch') {
      DOM.singleModeContent.style.display = 'none'
      DOM.planModeContent.style.display = 'none'
      if (stopwatchModeContent) stopwatchModeContent.style.display = 'block'
      DOM.addPresetBtn.style.display = 'none'
      DOM.planAddButtons.style.display = 'none'
      if (planNoteSection) planNoteSection.style.display = 'none'
      if (wheelPickerContainer) wheelPickerContainer.style.display = 'none'
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
