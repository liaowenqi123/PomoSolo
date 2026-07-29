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

    // 正向计时：进度圈随时间增长而填充（60分钟填满一圈）
    if (elements.progressCircle) {
      elements.progressCircle.style.animation = 'none'
      
      // 计算进度：以60分钟为一个周期
      const maxSeconds = 60 * 60  // 60分钟 = 3600秒
      const progress = Math.min(totalSeconds / maxSeconds, 1)  // 限制在0-1之间
      
      // SVG圆圈周长：2 * π * r，这里r=116，周长约728
      const circumference = 728
      const offset = circumference * (1 - progress)  // 进度越大，offset越小，显示越多
      
      elements.progressCircle.style.strokeDasharray = circumference
      elements.progressCircle.style.strokeDashoffset = offset
    }
  }

  /**
   * 开始计时
   */
  function start() {
    if (isRunning) return

    isRunning = true
    startTime = Date.now() - elapsedTime

    // 如果是从0开始，先将进度圈归零
    if (elapsedTime === 0 && elements.progressCircle) {
      elements.progressCircle.style.strokeDashoffset = '728'  // 归零（空圈）
    }

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
        
        // 如果在自习室中，上传专注会话
        if (window.StudyRoom && window.StudyRoom.isInRoom()) {
          console.log('[Stopwatch] 上传专注会话到自习室:', minutes, '分钟, 备注:', finalNote)
          window.StudyRoom.uploadSession(minutes, finalNote)
        }
      }
    }

    // 清空备注显示和保存的备注
    const timerNoteText = document.getElementById('timer-note-text')
    if (timerNoteText) {
      timerNoteText.textContent = ''
    }
    
    // 清空保存在DataStore中的正向计时备注
    if (window.DataStore) {
      const data = window.DataStore.getData()
      data.stopwatchModeNote = ''
      window.DataStore.saveImmediate()
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

    // 重置进度圈为满圈（准备状态）
    if (elements.progressCircle) {
      elements.progressCircle.style.strokeDashoffset = '0'
    }

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
