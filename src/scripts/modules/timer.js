/**
 * 计时器模块 - 三阶段架构
 * 
 * 计时器有三个明确的阶段：
 * 
 * 1. 准备阶段 (READY)：
 *    - 等待用户开始计时
 *    - 可以设置时间、选择预设
 *    - isRunning = false, isPaused = false
 *    - 重置按钮：无实际效果（因为还没开始）
 * 
 * 2. 运行阶段 (RUNNING)：
 *    - 计时进行中
 *    - 可以暂停（专注模式下禁止暂停）
 *    - isRunning = true, isPaused = false
 *    - 重置按钮：中断计时，进入准备阶段（专注模式下可能触发惩罚）
 * 
 * 3. 结束等待重置阶段 (FINISHED)：
 *    - 计时完成，时间归零
 *    - 等待用户点击重置或计划模式自动进入下一项
 *    - isRunning = false, isPaused = false
 *    - 重置按钮：确认完成，清除备注，进入准备阶段
 * 
 * 计划模式说明：
 *    - 计划模式下，当一项任务完成进入 FINISHED 阶段后，
 *      会立即检查是否有下一项任务
 *    - 如果有下一项，会在短暂延迟后自动开始下一项
 *      （FINISHED 阶段被快速掠过，但代码逻辑上仍然存在）
 *    - 如果没有下一项，会停留在 FINISHED 阶段
 * 
 * ============================================================================
 * 三阶段 UI 行为对照表
 * ============================================================================
 * 
 * | 功能                     | READY         | RUNNING       | FINISHED      |
 * |--------------------------|---------------|---------------|---------------|
 * | 预设选择                 | ✅ 启用       | ❌ 禁用       | ❌ 禁用       |
 * | 滚轮选择时间             | ✅ 启用       | ❌ 禁用       | ❌ 禁用       |
 * | 模式切换（工作/休息）    | ✅ 启用       | ❌ 禁用       | ❌ 禁用       |
 * | 应用模式切换（单次/计划）| ✅ 启用       | ❌ 禁用       | ❌ 禁用       |
 * | 添加预设按钮             | ✅ 启用       | ❌ 禁用       | ❌ 禁用       |
 * | 计划添加按钮             | ✅ 启用       | ❌ 禁用       | ❌ 禁用       |
 * | 开始按钮                 | 开始计时      | 暂停/继续     | ❌ 禁用       |
 * | 重置按钮                 | 无效果        | 中断(可能惩罚)| 确认完成      |
 * | 专注模式开关             | ✅ 可切换     | ❌ 禁止切换   | ❌ 禁止切换   |
 * | 前台检测                 | 停止          | 运行中        | 停止          |
 * | 菜园子作物生长           | 停止          | 生长中        | 停止          |
 * 
 * ============================================================================
 */
;(function() {
  'use strict'

  // ============ 阶段定义 ============
  const PHASE = {
    READY: 'ready',       // 准备阶段 - 等待开始
    RUNNING: 'running',   // 运行阶段 - 计时中
    FINISHED: 'finished'  // 结束等待重置阶段 - 计时完成
  }

  // ============ 状态变量 ============
  let elements = {}
  let callbacks = {}
  
  // 核心状态
  let phase = PHASE.READY    // 当前阶段，初始为准备阶段
  let isPaused = false       // 暂停状态（仅在 RUNNING 阶段有意义）
  
  // 时间相关
  let totalTime = 25 * 60    // 总时长（秒）
  let timeLeft = totalTime   // 剩余时间（秒）
  let timerId = null         // setInterval ID
  
  // 时间戳相关 - 用于修复后台计时器节流问题
  let timerStartTime = 0           // 计时开始时的时间戳
  let pausedElapsedTime = 0        // 暂停时已经过的时间（秒）
  
  // 菜园子相关
  let gardenSecondCounter = 0      // 菜园子秒数累积器
  let minuteCounter = 0            // 分钟计数器

  // ============ 状态保存 - 用于模式切换 ============
  // 单次/计划模式切换时的状态保存
  let modeStates = {
    single: {
      totalTime: 25 * 60,
      timeLeft: 25 * 60,
      phase: PHASE.READY,
      isPaused: false,
      pausedElapsedTime: 0,
      timerStartTime: 0,
      gardenSecondCounter: 0,
      minuteCounter: 0
    },
    plan: {
      totalTime: 25 * 60,
      timeLeft: 25 * 60,
      phase: PHASE.READY,
      isPaused: false,
      pausedElapsedTime: 0,
      timerStartTime: 0,
      gardenSecondCounter: 0,
      minuteCounter: 0
    }
  }

  // 工作/休息模式切换时的状态保存
  let workBreakStates = {
    work: {
      totalTime: 25 * 60,
      timeLeft: 25 * 60,
      phase: PHASE.READY,
      isPaused: false,
      pausedElapsedTime: 0,
      timerStartTime: 0,
      gardenSecondCounter: 0,
      minuteCounter: 0
    },
    break: {
      totalTime: 5 * 60,
      timeLeft: 5 * 60,
      phase: PHASE.READY,
      isPaused: false,
      pausedElapsedTime: 0,
      timerStartTime: 0,
      gardenSecondCounter: 0,
      minuteCounter: 0
    }
  }

  // ============ 常量 ============
  const radius = 116
  const circumference = 2 * Math.PI * radius
  const miniRadius = 62
  const miniCircumference = 2 * Math.PI * miniRadius
  const formatTime = Utils.formatTime

  // ============ 内部函数 ============

  /**
   * 更新显示（时间文字和进度圆）
   */
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

  /**
   * 进入运行阶段（开始计时）
   * 从 READY 或 FINISHED 阶段进入 RUNNING 阶段
   */
  function enterRunningPhase() {
    // 如果时间已归零，重置为总时长
    if (timeLeft === 0) {
      timeLeft = totalTime
    }
    
    // 更新阶段状态
    phase = PHASE.RUNNING
    isPaused = false
    
    // 更新按钮文字
    elements.startBtn.textContent = '暂停'
    
    // 设置计时开始时间戳
    // 如果是从暂停恢复，需要考虑之前已经过的时间
    timerStartTime = Date.now() - pausedElapsedTime * 1000
    gardenSecondCounter = pausedElapsedTime  // 恢复已累积的秒数
    pausedElapsedTime = 0
    
    // 触发回调
    if (callbacks.onStart) {
      callbacks.onStart()
    }
    
    if (callbacks.onPhaseChange) {
      callbacks.onPhaseChange(PHASE.RUNNING)
    }
    
    if (callbacks.onEnabledChange) {
      callbacks.onEnabledChange(false)
    }
    
    // 使用时间戳计算真实剩余时间，避免后台节流问题
    timerId = setInterval(tick, 200)
  }

  /**
   * 计时器 tick 函数（每200ms执行一次）
   */
  function tick() {
    // 计算从开始到现在经过的真实秒数
    const elapsedSeconds = Math.floor((Date.now() - timerStartTime) / 1000)
    const newTimeLeft = totalTime - elapsedSeconds
    
    // 更新剩余时间
    timeLeft = Math.max(0, newTimeLeft)
    updateDisplay()
    
    // 计算本次间隔的秒数（用于菜园子更新）
    const intervalSeconds = elapsedSeconds - gardenSecondCounter
    gardenSecondCounter = elapsedSeconds
    
    // 每60秒更新一次菜园子（仅在专注模式下）
    minuteCounter += intervalSeconds
    if (minuteCounter >= 60 && window.Garden && AppState && AppState.focusModeEnabled) {
      const minutesToUpdate = Math.floor(minuteCounter / 60)
      for (let i = 0; i < minutesToUpdate; i++) {
        window.Garden.updateProgress()
      }
      minuteCounter = minuteCounter % 60
    } else if (minuteCounter >= 60) {
      // 非专注模式下只重置计数器，不更新菜园子
      minuteCounter = minuteCounter % 60
    }
    
    // 检查是否计时完成
    if (timeLeft === 0) {
      enterFinishedPhase()
    }
  }

  /**
   * 暂停计时
   * 仅在 RUNNING 阶段有效
   */
  function pause() {
    if (phase !== PHASE.RUNNING) return
    
    isPaused = true
    clearInterval(timerId)
    timerId = null
    elements.startBtn.textContent = '继续'
    
    // 保存暂停时已经过的时间
    pausedElapsedTime = Math.floor((Date.now() - timerStartTime) / 1000)
    
    if (callbacks.onPhaseChange) {
      callbacks.onPhaseChange(PHASE.RUNNING, true)  // 第二个参数表示暂停
    }
  }

  /**
   * 继续计时（从暂停恢复）
   * 仅在 RUNNING 阶段且暂停状态下有效
   */
  function resume() {
    if (phase !== PHASE.RUNNING || !isPaused) return
    
    isPaused = false
    elements.startBtn.textContent = '暂停'
    
    // 恢复计时开始时间戳
    timerStartTime = Date.now() - pausedElapsedTime * 1000
    gardenSecondCounter = pausedElapsedTime
    pausedElapsedTime = 0
    
    timerId = setInterval(tick, 200)
    
    if (callbacks.onPhaseChange) {
      callbacks.onPhaseChange(PHASE.RUNNING, false)  // 第二个参数表示恢复
    }
  }

  /**
   * 进入结束等待重置阶段
   * 从 RUNNING 阶段进入 FINISHED 阶段
   */
  function enterFinishedPhase() {
    // 停止计时器
    clearInterval(timerId)
    timerId = null
    
    // 更新阶段状态
    phase = PHASE.FINISHED
    isPaused = false
    minuteCounter = 0
    pausedElapsedTime = 0  // 重置暂停时间
    gardenSecondCounter = 0  // 重置菜园子计数器
    
    // 更新按钮文字
    elements.startBtn.textContent = '开始'
    
    // 触发完成回调
    if (callbacks.onComplete) {
      callbacks.onComplete()
    }
    
    // 触发阶段变化回调
    if (callbacks.onPhaseChange) {
      callbacks.onPhaseChange(PHASE.FINISHED)
    }
  }

  /**
   * 进入准备阶段（重置）
   * 从 RUNNING 或 FINISHED 阶段进入 READY 阶段
   * 
   * @param {boolean} recordPartial - 是否记录部分完成的专注时间
   * @returns {boolean} 是否触发了惩罚（用于判断是否需要显示惩罚提示）
   */
  function enterReadyPhase(recordPartial = true) {
    let punishmentTriggered = false
    
    // 在重置前检查是否有已流逝的时间需要记录
    if (recordPartial) {
      const elapsedSeconds = totalTime - timeLeft
      if (elapsedSeconds > 0 && window.Stats && window.Stats.recordPartialFocus) {
        // 获取当前备注
        let note = ''
        const noteTextEl = document.getElementById('timer-note-text')
        if (noteTextEl) {
          note = noteTextEl.textContent || ''
        }
        // 记录部分完成的专注时间
        window.Stats.recordPartialFocus(elapsedSeconds, note)
      }
    }
    
    // 停止计时器（如果正在运行）
    if (timerId) {
      clearInterval(timerId)
      timerId = null
    }
    
    // 更新阶段状态
    phase = PHASE.READY
    isPaused = false
    timeLeft = totalTime
    pausedElapsedTime = 0
    timerStartTime = 0
    gardenSecondCounter = 0
    minuteCounter = 0
    
    // 更新显示
    updateDisplay()
    elements.startBtn.textContent = '开始'
    elements.progressCircle.style.strokeDashoffset = 0
    
    // 重置后保存当前模式的状态
    if (AppState && AppState.appMode === 'single') {
      const currentMode = Mode.getMode()
      saveWorkBreakState(currentMode)
    }
    
    // 触发回调
    if (callbacks.onPhaseChange) {
      callbacks.onPhaseChange(PHASE.READY)
    }
    
    if (callbacks.onEnabledChange) {
      callbacks.onEnabledChange(true)
    }
    
    return punishmentTriggered
  }

  // ============ 公开 API ============

  /**
   * 开始计时
   * - 如果是 READY 或 FINISHED 阶段：开始新计时
   * - 如果是 RUNNING 阶段且已暂停：继续计时
   */
  function start() {
    if (phase === PHASE.RUNNING && isPaused) {
      // 从暂停恢复
      resume()
    } else if (phase === PHASE.READY || phase === PHASE.FINISHED) {
      // 开始新计时
      enterRunningPhase()
    }
  }

  /**
   * 暂停计时
   * 仅在 RUNNING 阶段有效
   */
  function pauseTimer() {
    if (phase === PHASE.RUNNING && !isPaused) {
      pause()
    }
  }

  /**
   * 重置计时器
   * - RUNNING 阶段：中断计时，可能触发惩罚
   * - FINISHED 阶段：确认完成，进入下一轮准备
   * - READY 阶段：无效果
   */
  function reset() {
    if (phase === PHASE.READY) return
    
    // 判断是否需要记录部分时间（仅在 RUNNING 阶段中断时记录）
    const recordPartial = (phase === PHASE.RUNNING)
    enterReadyPhase(recordPartial)
  }

  /**
   * 切换开始/暂停
   * 专注模式下运行时不允许暂停
   */
  function toggle() {
    // 专注模式下运行中时点击无效（禁止暂停）
    if (phase === PHASE.RUNNING && !isPaused && AppState && AppState.focusModeEnabled) {
      return
    }
    
    if (phase === PHASE.RUNNING) {
      if (isPaused) {
        resume()
      } else {
        pause()
      }
    } else {
      start()
    }
  }

  /**
   * 设置计时时长
   * 仅在 READY 阶段有效
   */
  function setTime(minutes) {
    if (phase === PHASE.RUNNING) return
    totalTime = minutes * 60
    timeLeft = totalTime
    updateDisplay()
    elements.progressCircle.style.strokeDashoffset = 0
  }

  // ============ 状态查询 API ============

  /**
   * 获取当前阶段
   */
  function getPhase() {
    return phase
  }

  /**
   * 是否处于运行阶段
   * 注意：仅在 RUNNING 阶段返回 true，暂停时也是 RUNNING 阶段
   */
  function getIsRunning() {
    return phase === PHASE.RUNNING
  }

  /**
   * 是否处于暂停状态
   * 仅在 RUNNING 阶段时有意义
   */
  function getIsPaused() {
    return isPaused
  }

  /**
   * 是否处于准备阶段
   */
  function getIsReady() {
    return phase === PHASE.READY
  }

  /**
   * 是否处于结束等待重置阶段
   */
  function getIsFinished() {
    return phase === PHASE.FINISHED
  }

  /**
   * 获取剩余时间（秒）
   */
  function getTimeLeft() {
    return timeLeft
  }

  /**
   * 获取总时长（秒）
   */
  function getTotalTime() {
    return totalTime
  }

  // ============ 状态保存/恢复 API ============

  /**
   * 保存当前模式的计时器状态
   * @param {string} mode - 'single' 或 'plan'
   */
  function saveState(mode) {
    if (!modeStates[mode]) return
    modeStates[mode] = {
      totalTime: totalTime,
      timeLeft: timeLeft,
      phase: phase,
      isPaused: isPaused,
      pausedElapsedTime: pausedElapsedTime,
      timerStartTime: timerStartTime,
      gardenSecondCounter: gardenSecondCounter,
      minuteCounter: minuteCounter
    }
  }

  /**
   * 恢复指定模式的计时器状态
   * @param {string} mode - 'single' 或 'plan'
   */
  function restoreState(mode) {
    if (!modeStates[mode]) return
    const state = modeStates[mode]
    totalTime = state.totalTime
    timeLeft = state.timeLeft
    phase = state.phase
    isPaused = state.isPaused
    pausedElapsedTime = state.pausedElapsedTime
    timerStartTime = state.timerStartTime
    gardenSecondCounter = state.gardenSecondCounter
    minuteCounter = state.minuteCounter
    updateDisplay()
  }

  /**
   * 获取指定模式的保存状态
   */
  function getState(mode) {
    return modeStates[mode] || null
  }

  /**
   * 保存工作/休息模式的计时器状态
   * @param {string} mode - 'work' 或 'break'
   */
  function saveWorkBreakState(mode) {
    if (!workBreakStates[mode]) return
    workBreakStates[mode] = {
      totalTime: totalTime,
      timeLeft: timeLeft,
      phase: phase,
      isPaused: isPaused,
      pausedElapsedTime: pausedElapsedTime,
      timerStartTime: timerStartTime,
      gardenSecondCounter: gardenSecondCounter,
      minuteCounter: minuteCounter
    }
  }

  /**
   * 恢复工作/休息模式的计时器状态
   * @param {string} mode - 'work' 或 'break'
   */
  function restoreWorkBreakState(mode) {
    if (!workBreakStates[mode]) return
    const state = workBreakStates[mode]
    totalTime = state.totalTime
    timeLeft = state.timeLeft
    phase = state.phase
    isPaused = state.isPaused
    pausedElapsedTime = state.pausedElapsedTime
    timerStartTime = state.timerStartTime
    gardenSecondCounter = state.gardenSecondCounter
    minuteCounter = state.minuteCounter
    updateDisplay()
  }

  /**
   * 获取工作/休息模式的保存状态
   */
  function getWorkBreakState(mode) {
    return workBreakStates[mode] || null
  }

  // ============ 初始化 ============

  /**
   * 初始化计时器模块
   */
  function init(els, cbs) {
    elements = els
    callbacks = cbs || {}
    
    // 设置进度圆样式
    elements.progressCircle.style.strokeDasharray = circumference
    elements.progressCircle.style.strokeDashoffset = 0
    
    // 初始化迷你模式的进度圆
    const miniProgressCircle = document.getElementById('mini-progress-circle')
    if (miniProgressCircle) {
      miniProgressCircle.style.strokeDasharray = miniCircumference
      miniProgressCircle.style.strokeDashoffset = 0
    }
    
    // 绑定开始按钮事件
    elements.startBtn.addEventListener('click', toggle)
    
    // 初始显示
    updateDisplay()
  }

  // ============ 导出到全局 ============
  window.Timer = {
    // 阶段常量
    PHASE: PHASE,
    
    // 核心 API
    init: init,
    start: start,
    pause: pauseTimer,
    reset: reset,
    toggle: toggle,
    setTime: setTime,
    
    // 状态查询
    getPhase: getPhase,
    getIsRunning: getIsRunning,
    getIsPaused: getIsPaused,
    getIsReady: getIsReady,
    getIsFinished: getIsFinished,
    getTimeLeft: getTimeLeft,
    getTotalTime: getTotalTime,
    
    // 状态保存/恢复
    saveState: saveState,
    restoreState: restoreState,
    getState: getState,
    saveWorkBreakState: saveWorkBreakState,
    restoreWorkBreakState: restoreWorkBreakState,
    getWorkBreakState: getWorkBreakState
  }
})()
