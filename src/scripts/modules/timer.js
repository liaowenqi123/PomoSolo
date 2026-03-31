/**
 * 计时器模块
 */
;(function() {
  'use strict'

  let elements = {}
  let callbacks = {}
  let totalTime = 25 * 60
  let timeLeft = totalTime
  let timerId = null
  let isRunning = false
  let isPaused = false  // 跟踪暂停状态
  let minuteCounter = 0  // 用于跟踪分钟数

  // 时间戳相关变量 - 用于修复后台计时器节流问题
  let timerStartTime = 0  // 计时开始时的时间戳
  let pausedElapsedTime = 0  // 暂停时已经过的时间（秒）
  let gardenSecondCounter = 0  // 菜园子秒数累积器

  // 模式状态保存 - 用于在单次和计划模式间切换时保持状态
  let modeStates = {
    single: {
      totalTime: 25 * 60,
      timeLeft: 25 * 60,
      isPaused: false,
      pausedElapsedTime: 0,
      timerStartTime: 0,
      gardenSecondCounter: 0,
      minuteCounter: 0
    },
    plan: {
      totalTime: 25 * 60,
      timeLeft: 25 * 60,
      isPaused: false,
      pausedElapsedTime: 0,
      timerStartTime: 0,
      gardenSecondCounter: 0,
      minuteCounter: 0
    }
  }

  // 工作/休息模式的倒计时状态保存
  let workBreakStates = {
    work: {
      totalTime: 25 * 60,
      timeLeft: 25 * 60,
      isPaused: false,
      pausedElapsedTime: 0,
      timerStartTime: 0,
      gardenSecondCounter: 0,
      minuteCounter: 0
    },
    break: {
      totalTime: 5 * 60,
      timeLeft: 5 * 60,
      isPaused: false,
      pausedElapsedTime: 0,
      timerStartTime: 0,
      gardenSecondCounter: 0,
      minuteCounter: 0
    }
  }

  const radius = 116
  const circumference = 2 * Math.PI * radius

  // 迷你模式的圆形半径和周长（viewBox="0 0 130 130", circle r=62）
  const miniRadius = 62
  const miniCircumference = 2 * Math.PI * miniRadius

  // 使用统一的格式化函数
  const formatTime = Utils.formatTime

  function updateDisplay() {
    elements.timeDisplay.textContent = formatTime(timeLeft)
    const progress = (totalTime - timeLeft) / totalTime
    elements.progressCircle.style.strokeDashoffset = circumference * (1 - progress)
    
    // 同步更新迷你模式显示
    const miniTimeDisplay = document.getElementById('mini-time-display')
    const miniProgressCircle = document.getElementById('mini-progress-circle')
    if (miniTimeDisplay && miniProgressCircle) {
      miniTimeDisplay.textContent = formatTime(timeLeft)
      miniProgressCircle.style.strokeDashoffset = miniCircumference * (1 - progress)
    }
  }

  function start() {
    if (timeLeft === 0) timeLeft = totalTime
    isRunning = true
    isPaused = false
    elements.startBtn.textContent = '暂停'
    
    // 设置计时开始时间戳
    // 如果是从暂停恢复，需要考虑之前已经过的时间
    timerStartTime = Date.now() - pausedElapsedTime * 1000
    gardenSecondCounter = pausedElapsedTime  // 恢复已累积的秒数
    pausedElapsedTime = 0
    
    if (callbacks.onStart) {
      callbacks.onStart()
    }
    
    if (callbacks.onStatusChange) {
      callbacks.onStatusChange('running')
    }
    
    if (callbacks.onEnabledChange) {
      callbacks.onEnabledChange(false)
    }
    
    // 使用时间戳计算真实剩余时间，避免后台节流问题
    timerId = setInterval(() => {
      // 计算从开始到现在经过的真实秒数
      const elapsedSeconds = Math.floor((Date.now() - timerStartTime) / 1000)
      const newTimeLeft = totalTime - elapsedSeconds
      
      // 更新剩余时间
      timeLeft = Math.max(0, newTimeLeft)
      updateDisplay()
      
      // 计算本次间隔的秒数（用于菜园子更新）
      const intervalSeconds = elapsedSeconds - gardenSecondCounter
      gardenSecondCounter = elapsedSeconds
      
      // 每60秒更新一次菜园子
      minuteCounter += intervalSeconds
      if (minuteCounter >= 60 && window.Garden) {
        const minutesToUpdate = Math.floor(minuteCounter / 60)
        for (let i = 0; i < minutesToUpdate; i++) {
          window.Garden.updateProgress()
        }
        minuteCounter = minuteCounter % 60
      }
      
      if (timeLeft === 0) {
        clearInterval(timerId)
        isRunning = false
        minuteCounter = 0
        elements.startBtn.textContent = '开始'
        
        if (callbacks.onComplete) {
          callbacks.onComplete()
        }
        
        // 倒计时完成后，状态变为ready，启用预设
        if (callbacks.onStatusChange) {
          callbacks.onStatusChange('ready')
        }
      }
    }, 200)  // 更频繁地检查（200ms），确保显示更流畅
  }

  function pause() {
    isRunning = false
    isPaused = true
    clearInterval(timerId)
    elements.startBtn.textContent = '继续'
    
    // 保存暂停时已经过的时间和秒数累积器
    pausedElapsedTime = Math.floor((Date.now() - timerStartTime) / 1000)
    
    if (callbacks.onStatusChange) {
      callbacks.onStatusChange('paused')
    }
  }

  function reset() {
    clearInterval(timerId)
    isRunning = false
    isPaused = false
    timeLeft = totalTime
    pausedElapsedTime = 0
    timerStartTime = 0
    gardenSecondCounter = 0
    minuteCounter = 0
    updateDisplay()
    elements.startBtn.textContent = '开始'
    elements.progressCircle.style.strokeDashoffset = 0
    
    // 重置后保存当前模式的状态
    if (AppState && AppState.appMode === 'single') {
      const currentMode = Mode.getMode()
      saveWorkBreakState(currentMode)
    }
    
    if (callbacks.onStatusChange) {
      callbacks.onStatusChange('ready')
    }
    
    if (callbacks.onEnabledChange) {
      callbacks.onEnabledChange(true)
    }
  }

  function toggle() {
    // 专注模式下禁止暂停，只能通过重置按钮中断
    if (isRunning && AppState && AppState.focusModeEnabled) {
      return // 专注模式下运行中时点击无效
    }
    isRunning ? pause() : start()
  }

  function setTime(minutes) {
    if (isRunning) return
    totalTime = minutes * 60
    timeLeft = totalTime
    updateDisplay()
    elements.progressCircle.style.strokeDashoffset = 0
  }

  function getTimeLeft() {
    return timeLeft
  }

  function getTotalTime() {
    return totalTime
  }

  function getIsRunning() {
    return isRunning
  }

  function getIsPaused() {
    return isPaused
  }

  // 保存当前模式的计时器状态
  function saveState(mode) {
    if (!modeStates[mode]) return
    modeStates[mode] = {
      totalTime: totalTime,
      timeLeft: timeLeft,
      isPaused: isPaused,
      pausedElapsedTime: pausedElapsedTime,
      timerStartTime: timerStartTime,
      gardenSecondCounter: gardenSecondCounter,
      minuteCounter: minuteCounter
    }
  }

  // 恢复指定模式的计时器状态
  function restoreState(mode) {
    if (!modeStates[mode]) return
    const state = modeStates[mode]
    totalTime = state.totalTime
    timeLeft = state.timeLeft
    isPaused = state.isPaused
    pausedElapsedTime = state.pausedElapsedTime
    timerStartTime = state.timerStartTime
    gardenSecondCounter = state.gardenSecondCounter
    minuteCounter = state.minuteCounter
    updateDisplay()
  }

  // 获取指定模式的保存状态
  function getState(mode) {
    return modeStates[mode] || null
  }

  // 保存工作/休息模式的计时器状态
  function saveWorkBreakState(mode) {
    if (!workBreakStates[mode]) return
    workBreakStates[mode] = {
      totalTime: totalTime,
      timeLeft: timeLeft,
      isPaused: isPaused,
      pausedElapsedTime: pausedElapsedTime,
      timerStartTime: timerStartTime,
      gardenSecondCounter: gardenSecondCounter,
      minuteCounter: minuteCounter
    }
  }

  // 恢复工作/休息模式的计时器状态
  function restoreWorkBreakState(mode) {
    if (!workBreakStates[mode]) return
    const state = workBreakStates[mode]
    totalTime = state.totalTime
    timeLeft = state.timeLeft
    isPaused = state.isPaused
    pausedElapsedTime = state.pausedElapsedTime
    timerStartTime = state.timerStartTime
    gardenSecondCounter = state.gardenSecondCounter
    minuteCounter = state.minuteCounter
    updateDisplay()
  }

  // 获取工作/休息模式的保存状态
  function getWorkBreakState(mode) {
    return workBreakStates[mode] || null
  }

  function init(els, cbs) {
    elements = els
    callbacks = cbs || {}
    
    elements.progressCircle.style.strokeDasharray = circumference
    elements.progressCircle.style.strokeDashoffset = 0
    
    // 初始化迷你模式的进度圆
    const miniProgressCircle = document.getElementById('mini-progress-circle')
    if (miniProgressCircle) {
      miniProgressCircle.style.strokeDasharray = miniCircumference
      miniProgressCircle.style.strokeDashoffset = 0
    }
    
    elements.startBtn.addEventListener('click', toggle)
    
    updateDisplay()
  }

  // 导出到全局
  window.Timer = {
    init: init,
    start: start,
    pause: pause,
    reset: reset,
    toggle: toggle,
    setTime: setTime,
    getTimeLeft: getTimeLeft,
    getTotalTime: getTotalTime,
    getIsRunning: getIsRunning,
    getIsPaused: getIsPaused,
    saveState: saveState,
    restoreState: restoreState,
    getState: getState,
    saveWorkBreakState: saveWorkBreakState,
    restoreWorkBreakState: restoreWorkBreakState,
    getWorkBreakState: getWorkBreakState
  }
})()