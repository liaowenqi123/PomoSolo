/**
 * 番茄钟 - 回调函数定义
 * 适配三阶段计时器架构
 */
;(function() {
  'use strict'

  /**
   * 获取计时器回调
   */
  function getTimerCallbacks() {
    return {
      /**
       * 计时开始时触发
       * - 专注模式：启动前台检测
       * - 计划模式：初始化计划（如果未开始）
       * - 单次模式：确认备注输入
       */
      onStart: () => {
        // 计划模式下，只有在计划未开始时才初始化
        if (AppState.appMode === 'plan') {
          const status = PlanMode.getPlanStatus()
          if (!status.isRunning) {
            PlanMode.startPlan()
          }
        }
        
        // 专注模式开启且计时器开始时，启动前台检测
        // 注意：只在 WORK 模式下启动前台检测
        if (AppState.focusModeEnabled && window.ForegroundDetection) {
          const isWorkMode = AppState.appMode === 'plan' 
            ? (PlanMode.getCurrentItem()?.type === 'work')
            : Mode.isWorkMode()
          
          if (isWorkMode) {
            window.ForegroundDetection.startDetection()
          }
        }
        
        // 单次模式下，自动确认备注输入
        if (AppState.appMode === 'single') {
          const timerNoteInput = document.getElementById('timer-note-input')
          const timerNoteDisplay = document.getElementById('timer-note-display')
          const timerNoteTitleInput = document.getElementById('timer-note-title-input')
          const timerNoteText = document.getElementById('timer-note-text')
          
          if (timerNoteInput && timerNoteInput.style.display !== 'none' && timerNoteTitleInput) {
            const title = timerNoteTitleInput.value.trim()
            
            // 保存到独立的单次模式备注字段
            const data = DataStore.getData()
            data.singleModeNote = title
            DataStore.saveImmediate()
            
            // 切换到显示模式
            timerNoteInput.style.display = 'none'
            timerNoteDisplay.style.display = 'flex'
            timerNoteText.textContent = title
            
            // 根据字数调整位置
            const len = title.length
            if (len <= 2) {
              timerNoteDisplay.style.top = '40px'
            } else if (len <= 4) {
              timerNoteDisplay.style.top = '45px'
            } else {
              timerNoteDisplay.style.top = '50px'
            }
          }
        }
      },
      
      /**
       * 阶段变化时触发
       * @param {string} phase - 新阶段 ('ready' | 'running' | 'finished')
       * @param {boolean} isPaused - 仅在 running 阶段有意义，表示是否暂停
       */
      onPhaseChange: (phase, isPaused = false) => {
        const PHASE = Timer.PHASE
        
        // 通知主进程更新计时器状态
        if (window.electronAPI && window.electronAPI.updateTimerStatus) {
          const isRunning = phase === PHASE.RUNNING && !isPaused
          const isPausedState = phase === PHASE.RUNNING && isPaused
          window.electronAPI.updateTimerStatus(isRunning, isPausedState)
        }

        // 根据阶段更新 UI 状态
        if (phase === PHASE.READY) {
          // 进入准备阶段：启用预设和滚轮选择器
          Presets.setEnabled(true)
          WheelPicker.setEnabled(true)
          // 启用模式切换按钮
          DOM.modeBtns.forEach(btn => btn.style.pointerEvents = 'auto')
          // 启用计划模式添加按钮
          if (AppState.appMode === 'plan') {
            DOM.addWorkBtn.disabled = false
            DOM.addBreakBtn.disabled = false
          }
          
        } else if (phase === PHASE.RUNNING) {
          // 运行阶段
          if (isPaused) {
            // 暂停状态：禁用预设和滚轮
            Presets.setEnabled(false)
            WheelPicker.setEnabled(false)
            
            // 专注模式下暂停时，停止前台检测
            if (AppState.focusModeEnabled && window.ForegroundDetection) {
              window.ForegroundDetection.stopDetection()
            }
          } else {
            // 继续运行：如果是专注模式且在工作模式，重新启动前台检测
            if (AppState.focusModeEnabled && window.ForegroundDetection) {
              const isWorkMode = AppState.appMode === 'plan' 
                ? (PlanMode.getCurrentItem()?.type === 'work')
                : Mode.isWorkMode()
              
              if (isWorkMode) {
                window.ForegroundDetection.startDetection()
              }
            }
          }
          
          // 保存工作/休息模式状态
          if (AppState.appMode === 'single' && !isPaused) {
            const currentMode = Mode.getMode()
            window.Timer.saveWorkBreakState(currentMode)
          }
          
        } else if (phase === PHASE.FINISHED) {
          // 进入结束等待重置阶段
          // 重要：停止前台检测（这是修复 bug 的关键）
          if (window.ForegroundDetection) {
            window.ForegroundDetection.stopDetection()
          }
          
          // 禁用预设和滚轮选择器，防止用户修改时间导致数据问题
          // 用户需要先点击重置按钮，进入 READY 阶段后才能修改
          Presets.setEnabled(false)
          WheelPicker.setEnabled(false)
          
          // 禁用模式切换按钮
          DOM.modeBtns.forEach(btn => btn.style.pointerEvents = 'none')
          
          // 禁用计划模式添加按钮
          if (AppState.appMode === 'plan') {
            DOM.addWorkBtn.disabled = true
            DOM.addBreakBtn.disabled = true
          }
        }

        // 更新状态文字
        updateStatusText(phase, isPaused)
      },
      
      /**
       * 启用状态变化时触发
       * @param {boolean} enabled - 是否启用（可以操作预设和滚轮）
       */
      onEnabledChange: (enabled) => {
        Presets.setEnabled(enabled)
        WheelPicker.setEnabled(enabled)
        
        // 计划模式下禁用添加按钮
        if (AppState.appMode === 'plan') {
          DOM.addWorkBtn.disabled = !enabled
          DOM.addBreakBtn.disabled = !enabled
        }
        
        // 专注模式下，计时器运行时禁用开始按钮（显示"暂停"时）
        if (AppState.focusModeEnabled) {
          if (!enabled) {
            DOM.startBtn.classList.add('focus-mode-disabled')
          } else {
            DOM.startBtn.classList.remove('focus-mode-disabled')
          }
        }
      },
      
      /**
       * 计时完成时触发
       * - 单次模式：显示完成通知，更新统计
       * - 计划模式：进入下一项或完成计划
       */
      onComplete: () => {
        if (AppState.appMode === 'single') {
          handleSingleModeComplete()
        } else if (AppState.appMode === 'plan') {
          handlePlanModeComplete()
        }
      }
    }
  }

  /**
   * 更新状态文字
   */
  function updateStatusText(phase, isPaused) {
    const PHASE = Timer.PHASE
    
    if (AppState.appMode === 'single') {
      const mode = Mode.getMode()
      
      if (phase === PHASE.RUNNING) {
        if (isPaused) {
          DOM.statusEl.textContent = '已暂停'
        } else {
          DOM.statusEl.textContent = mode === 'work' ? '专注中...' : '休息中...'
        }
      } else if (phase === PHASE.FINISHED) {
        DOM.statusEl.textContent = mode === 'work' ? '🎉 完成！休息一下吧' : '⏰ 休息结束！继续加油'
      } else if (phase === PHASE.READY) {
        DOM.statusEl.textContent = mode === 'work' ? '准备开始专注工作' : '准备休息一下'
      }
      
    } else if (AppState.appMode === 'plan') {
      if (phase === PHASE.RUNNING) {
        if (isPaused) {
          DOM.statusEl.textContent = '已暂停'
        } else {
          const currentItem = PlanMode.getCurrentItem()
          if (currentItem) {
            DOM.statusEl.textContent = currentItem.type === 'work' ? '专注中...' : '休息中...'
          }
        }
      } else if (phase === PHASE.FINISHED) {
        // 计划模式的 FINISHED 状态文字会在 handlePlanModeComplete 中设置
      } else if (phase === PHASE.READY) {
        DOM.statusEl.textContent = '准备开始计划'
      }
    }
  }

  /**
   * 处理单次模式完成
   */
  async function handleSingleModeComplete() {
    const mode = Mode.getMode()
    
    if (mode === 'work') {
      DOM.statusEl.textContent = '🎉 完成！休息一下吧'
      window.electronAPI.showNotification('🍅 番茄钟完成', '恭喜！你完成了一个番茄时间，休息一下吧~')
      
      // 获取当前备注
      const timerNoteText = document.getElementById('timer-note-text')
      const currentNote = timerNoteText && timerNoteText.textContent ? timerNoteText.textContent.trim() : ''
      
      // 记录统计（等待完成）
      await Stats.increment(Math.round(Timer.getTotalTime() / 60), currentNote)
      
      // 如果在自习室中，上传专注会话
      if (window.StudyRoom && window.StudyRoom.isInRoom()) {
        const minutes = Math.floor(Timer.getTotalTime() / 60)
        console.log('[Callbacks] 上传专注会话到自习室:', minutes, '分钟, 备注:', currentNote)
        window.StudyRoom.uploadSession(minutes, currentNote)
      }
    } else {
      DOM.statusEl.textContent = '⏰ 休息结束！继续加油'
      window.electronAPI.showNotification('☕ 休息结束', '休息时间到，准备好继续工作了吗？')
    }
  }

  /**
   * 处理计划模式完成
   * 当前任务完成，检查是否有下一项
   */
  async function handlePlanModeComplete() {
    const currentItem = PlanMode.getCurrentItem()
    
    // 记录工作任务的统计
    if (currentItem && currentItem.type === 'work') {
      const planNote = window.NoteManager ? window.NoteManager.getNote() : { title: '', detail: '' }
      const noteText = planNote.title || planNote.detail || ''
      
      // 等待统计更新完成
      await Stats.increment(currentItem.minutes, noteText)
      
      // 如果在自习室中，上传专注会话
      if (window.StudyRoom && window.StudyRoom.isInRoom()) {
        console.log('[Callbacks] 计划模式：上传专注会话到自习室:', currentItem.minutes, '分钟, 备注:', noteText)
        window.StudyRoom.uploadSession(currentItem.minutes, noteText)
      }
    }
    
    // 进入下一项
    const nextItem = PlanMode.nextItem()
    
    if (nextItem) {
      // 还有下一项，短暂延迟后自动开始
      const typeText = nextItem.type === 'work' ? '工作' : '休息'
      window.electronAPI.showNotification(
        '⏰ 进入下一段',
        `${typeText} ${nextItem.minutes} 分钟`
      )
      
      // 设置下一项的时间和颜色
      Timer.setTime(nextItem.minutes)
      WheelPicker.setValue(nextItem.minutes)
      AppState.updateContainerColor(nextItem.type === 'break')
      
      // 延迟后自动开始下一段
      // 注意：这里有一个短暂的 FINISHED 阶段，然后自动进入下一个 READY -> RUNNING
      setTimeout(() => {
        Timer.start()
      }, 1000)
      
    } else {
      // 计划全部完成
      DOM.statusEl.textContent = '🎉 计划全部完成！'
      window.electronAPI.showNotification('🎉 计划完成', '恭喜！你完成了今天的所有计划！')
      PlanMode.stopPlan()
    }
  }

  /**
   * 获取模式切换回调
   */
  function getModeCallbacks() {
    return {
      onBeforeChange: () => {
        // 如果在运行阶段，不允许切换模式
        return Timer.getPhase() !== Timer.PHASE.RUNNING
      },
      onModeChange: (mode) => {
        // 恢复新模式的状态
        if (window.Timer) {
          window.Timer.restoreWorkBreakState(mode)
        }
        
        // 切换预设列表显示
        Presets.setMode(mode, true)
        
        // 重新初始化备注显示
        if (window.Presets && window.Presets.reinitializeNoteDisplay) {
          window.Presets.reinitializeNoteDisplay()
        }
      }
    }
  }

  /**
   * 获取预设选择回调
   */
  function getPresetCallbacks() {
    return {
      onSelect: (minutes) => {
        if (AppState.appMode === 'single') {
          Timer.setTime(minutes)
        }
      }
    }
  }

  /**
   * 获取计划模式回调
   */
  function getPlanModeCallbacks() {
    return {
      onFirstItemChange: (item) => {
        if (AppState.appMode === 'plan' && item) {
          AppState.updateContainerColor(item.type === 'break')
        }
      },
      onTimeUpdate: (minutes) => {
        if (AppState.appMode === 'plan') {
          Timer.setTime(minutes)
          WheelPicker.setValue(minutes)
        }
      }
    }
  }

  // 导出到全局
  window.Callbacks = {
    getTimerCallbacks,
    getModeCallbacks,
    getPresetCallbacks,
    getPlanModeCallbacks
  }
})()