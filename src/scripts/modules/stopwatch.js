/**
 * 正向计时器模块
 * 从0开始累计时间，适合不确定时长的任务
 */
;(function() {
  'use strict'

  let elements = {}
  let callbacks = {}
  
  // 计时器状态
  let isRunning = false
  let startTime = 0
  let elapsedTime = 0  // 已累计的时间（毫秒）
  let timerId = null
  let note = ''  // 备注

  /**
   * 初始化正向计时器
   */
  function init(els, cbs) {
    elements = els
    callbacks = cbs || {}
    
    // 初始化显示
    updateDisplay()
  }

  /**
   * 更新显示
   */
  function updateDisplay() {
    const totalSeconds = Math.floor(elapsedTime / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    let timeStr
    if (hours > 0) {
      timeStr = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    } else {
      timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`
    }

    if (elements.timeDisplay) {
      elements.timeDisplay.textContent = timeStr
    }

    // 正向计时不需要进度圈动画
    if (elements.progressCircle) {
      elements.progressCircle.style.animation = 'none'
      elements.progressCircle.style.strokeDashoffset = '0'
    }
  }

  /**
   * 开始计时
   */
  function start() {
    if (isRunning) return

    isRunning = true
    startTime = Date.now() - elapsedTime

    // 更新按钮文字
    if (elements.startBtn) {
      elements.startBtn.textContent = '暂停'
    }

    // 启动计时器
    timerId = setInterval(() => {
      elapsedTime = Date.now() - startTime
      updateDisplay()
    }, 100)  // 每100ms更新一次

    // 触发开始回调
    if (callbacks.onStart) {
      callbacks.onStart()
    }

    // 更新状态文字
    if (DOM.statusEl) {
      DOM.statusEl.textContent = '正在计时...'
    }
  }

  /**
   * 暂停计时
   */
  function pause() {
    if (!isRunning) return

    isRunning = false
    clearInterval(timerId)
    timerId = null

    // 更新按钮文字
    if (elements.startBtn) {
      elements.startBtn.textContent = '继续'
    }

    // 更新状态文字
    if (DOM.statusEl) {
      DOM.statusEl.textContent = '已暂停'
    }
  }

  /**
   * 重置计时器
   */
  function reset() {
    // 如果正在运行且时间超过1分钟，记录统计
    if (elapsedTime > 0) {
      const totalSeconds = Math.floor(elapsedTime / 1000)
      const minutes = Math.floor(totalSeconds / 60)
      
      if (minutes >= 1) {
        // 获取备注文字（从计时器上方的备注显示区域）
        const timerNoteText = document.getElementById('timer-note-text')
        const noteText = timerNoteText ? timerNoteText.textContent.trim() : ''
        const finalNote = noteText || note || '正向计时'
        
        // 记录统计（向下取整）- 不更新菜园子成就（传递false）
        if (window.Stats && window.Stats.increment) {
          window.Stats.increment(minutes, finalNote, false)
        }
        
        // 清空备注显示
        if (timerNoteText) {
          timerNoteText.textContent = ''
        }
      }
    }

    // 停止计时
    if (isRunning) {
      clearInterval(timerId)
      timerId = null
    }

    // 重置状态
    isRunning = false
    startTime = 0
    elapsedTime = 0
    note = ''

    // 更新显示
    updateDisplay()

    // 更新按钮文字
    if (elements.startBtn) {
      elements.startBtn.textContent = '开始'
    }

    // 更新状态文字
    if (DOM.statusEl) {
      DOM.statusEl.textContent = '准备开始计时'
    }

    // 触发重置回调
    if (callbacks.onReset) {
      callbacks.onReset()
    }
  }

  /**
   * 切换开始/暂停
   */
  function toggle() {
    if (isRunning) {
      pause()
    } else {
      start()
    }
  }

  /**
   * 获取当前状态
   */
  function getIsRunning() {
    return isRunning
  }

  /**
   * 获取已累计时间（秒）
   */
  function getElapsedSeconds() {
    return Math.floor(elapsedTime / 1000)
  }

  /**
   * 设置备注
   */
  function setNote(newNote) {
    note = newNote
  }

  /**
   * 获取备注
   */
  function getNote() {
    return note
  }

  // 导出到全局
  window.Stopwatch = {
    init,
    start,
    pause,
    reset,
    toggle,
    getIsRunning,
    getElapsedSeconds,
    setNote,
    getNote
  }
})()
