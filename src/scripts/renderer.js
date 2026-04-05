/**
 * 番茄钟 - 渲染进程主入口
 * 负责初始化和协调各模块
 */
;(async function() {
  'use strict'

  // ============ 暴露全局函数（必须在模块初始化前定义） ============
  window.isSidebarCollapsed = false
  window.expandSidebarIfNeeded = function() {
    if (window.isSidebarCollapsed && DOM.container) {
      window.isSidebarCollapsed = false
      DOM.container.classList.remove('sidebar-collapsed')
      const btn = document.getElementById('ui-sidebar-collapse-btn')
      if (btn) btn.title = '收起侧边栏'
    }
  }

  // ============ 加载数据 ============
  await DataStore.load()

  // ============ 初始化备注模块 ============
  if (window.NoteManager) {
    NoteManager.init()
  }

  // ============ 初始化统计模块 ============
  Stats.init({
    todayCount: DOM.todayCountEl,
    totalMinutes: DOM.totalMinutesEl
  })

  // ============ 初始化滚轮选择器 ============
  WheelPicker.init(DOM.wheelPickerEl, DOM.wheelColumn, null)
  
  // ============初始化主题模块============
  if (window.Theme) {
    Theme.init({
      themeToggleBtn: document.getElementById('ui-theme-toggle-btn')
    });
  }
  
  // ============ 初始化设置模块 ============
  if (window.Settings) {
    Settings.init()
  }
  
  // ============ 初始化自习室模块 ============
  if (window.StudyRoom) {
    StudyRoom.init()
  }
  
  // ============ 初始化预设模块 ============
  await Presets.init(
    {
      presetList: DOM.presetList,
      wheelPickerEl: DOM.wheelPickerEl,
      addPresetBtn: DOM.addPresetBtn
    },
    Callbacks.getPresetCallbacks()
  )

  // ============ 初始化计划模式模块 ============
  PlanMode.init(
    { planList: DOM.planList },
    Callbacks.getPlanModeCallbacks()
  )

  // ============ 初始化计时器 ============
    // 获取原有回调（如果存在）
  const originalTimerCallbacks = Callbacks.getTimerCallbacks ? Callbacks.getTimerCallbacks() : {}
  const timerCallbacks = {
    ...originalTimerCallbacks,
    onStart: function() {
      // 计时开始时的处理
      if (originalTimerCallbacks.onStart) originalTimerCallbacks.onStart()
    },
    onComplete: function() {
      // 计时完成时，保留原有逻辑
      if (originalTimerCallbacks.onComplete) originalTimerCallbacks.onComplete()
      // 备注不清除，等待用户重置
    }
  }

  Timer.init(
    {
      timeDisplay: DOM.timeDisplay,
      startBtn: DOM.startBtn,
      progressCircle: DOM.progressCircle
    },
    timerCallbacks
  )

  // ============ 初始化模式模块 ============
  Mode.init(
    {
      container: DOM.container,
      modeBtns: DOM.modeBtns
    },
    Callbacks.getModeCallbacks()
  )

  // ============ 初始化教程弹窗 ============
  Tutorial.init()

  // ============ 初始化AI助手 ============
  AIHelper.init({
    aiBtn: DOM.aiBtn,
    aiModal: DOM.aiModal,
    aiModalClose: DOM.aiModalClose,
    aiInput: DOM.aiInput,
    aiGenerateBtn: DOM.aiGenerateBtn,
    aiResult: DOM.aiResult,
    aiApplyBtn: DOM.aiApplyBtn
  })

  // ============ 初始化统计功能 ============
  Statistics.init({
    statsBtn: DOM.statsBtn,
    statsModal: document.getElementById('stats-modal'),
    statsModalClose: document.getElementById('stats-modal-close'),
    statsChart: document.getElementById('stats-chart'),
    statsChartContainer: document.getElementById('stats-chart-container'),
    statsTotalSessions: document.getElementById('stats-total-sessions'),
    statsTotalMinutes: document.getElementById('stats-total-minutes'),
    statsAvgMinutes: document.getElementById('stats-avg-minutes'),
    statsTableBody: document.getElementById('stats-table-body')
  })

  // ============ 初始化云端登录模块 ============
  if (window.CloudAuth) {
    CloudAuth.init()
    
    // 登录成功后的回调
    CloudAuth.onLogin((user, deepseekKey) => {
      if (user) {
        console.log('用户已登录:', user.username)
      } else {
        console.log('本地配置模式已激活')
      }
      if (deepseekKey) {
        console.log('DeepSeek API Key 已获取')
      }
    })
  }

  // ============ 初始化音乐播放器 ============
  MusicPlayer.init({
    playBtn: DOM.playBtn,
    nextBtn: DOM.nextBtn,
    prevBtn: DOM.prevBtn,
    modeBtn: DOM.modeBtn,
    progressBar: DOM.progressBar,
    progressFill: DOM.progressFill,
    progressHandle: DOM.progressHandle,
    trackNameEl: DOM.trackNameEl,
    currentTimeEl: DOM.currentTimeEl,
    durationEl: DOM.durationEl,
    musicPlayer: DOM.musicPlayer,
    deviceBtn: DOM.deviceBtn,
    deviceList: DOM.deviceList,
    volumeBtn: DOM.volumeBtn,
    volumeSlider: DOM.volumeSlider,
    volumeRange: DOM.volumeRange,
    collapseBtn: DOM.collapseBtn,
    collapsedTrack: DOM.collapsedTrack,
    visualizerBars: DOM.visualizerBars,
    playlistBtn: DOM.playlistBtn,
    playlistPanel: DOM.playlistPanel,
    playlistItems: DOM.playlistItems,
    refreshBtn: DOM.refreshBtn
  })

  // ============ 初始化前台检测模块 ============
  if (window.ForegroundDetection) {
    await window.ForegroundDetection.init()
  }

  // ============ 初始化音乐榜单模块 ============
  if (window.Charts) {
    Charts.init({
      modal: DOM.chartsModal,
      closeBtn: DOM.chartsModalClose,
      toggle: DOM.chartsSourceToggle,
      labelNetease: DOM.chartsSourceLabelNetease,
      labelQQ: DOM.chartsSourceLabelQQ,
      loading: DOM.chartsLoading,
      error: DOM.chartsError,
      tableContainer: DOM.chartsTableContainer,
      tbody: DOM.chartsTbody,
      refreshBtn: DOM.chartsRefreshBtn,
      downloadToggle: DOM.chartsDownloadToggle,
      downloadTh: DOM.chartsDownloadTh,
      disclaimerModal: DOM.disclaimerModal,
      disclaimerCancelBtn: DOM.disclaimerCancelBtn,
      disclaimerConfirmBtn: DOM.disclaimerConfirmBtn,
      downloadStatus: DOM.chartsDownloadStatus,
      downloadStatusText: DOM.chartsDownloadStatusText,
      manualDownload: DOM.chartsManualDownload,
      manualDownloadInput: DOM.chartsManualDownloadInput,
      manualDownloadBtn: DOM.chartsManualDownloadBtn
    })
  }

  // ============ 事件绑定 ============

  DOM.startBtn.removeEventListener('click', Timer.toggle);
  
  // 定义新的开始按钮处理函数
  // 根据当前阶段执行不同操作：
  // - READY 阶段：开始计时
  // - RUNNING 阶段：暂停/继续（专注模式下禁止暂停）
  // - FINISHED 阶段：不允许点击，需要先重置
  const newStartHandler = function() {
    const phase = Timer.getPhase()

    if (phase === Timer.PHASE.FINISHED) {
      // FINISHED 阶段不允许点击开始按钮，需要先点击重置
      return
    }

    if (phase === Timer.PHASE.RUNNING) {
      // 运行阶段 -> 暂停/继续（专注模式下禁用，Timer.toggle 内部已处理）
      Timer.toggle()
      return
    }

    // READY 阶段 -> 开始计时
    // 正向计时模式
    if (AppState.appMode === 'stopwatch') {
      if (window.Stopwatch) {
        window.Stopwatch.toggle()
      }
      return
    }
    
    // 如果是计划模式且计划列表为空，则不允许开始
    if (AppState.appMode === 'plan' && !PlanMode.hasPlan()) {
      alert('请先添加计划任务')
      return
    }

    // 开始计时
    if (AppState.appMode === 'plan') {
      // 计划模式：启动计划，获取第一个任务
      const firstItem = PlanMode.startPlan()
      if (firstItem) {
        Timer.setTime(firstItem.minutes)
        Timer.start()
      }
    } else {
      // 单次模式：直接开始
      Timer.start()
    }
  }

  // 绑定新的事件
  DOM.startBtn.addEventListener('click', newStartHandler)
  // 滚轮选择器回调
  WheelPicker.setChangeCallback((value) => {
    // 滚轮值变化时的处理
  })

  // 专注模式开关事件
  // 只有在 READY 阶段才能切换
  if (DOM.focusModeSwitch) {
    DOM.focusModeSwitch.addEventListener('click', () => {
      const phase = Timer.getPhase()
      
      // 只有在准备阶段才能切换专注模式
      if (phase !== Timer.PHASE.READY) {
        return
      }
      
      AppState.toggleFocusMode()
      
      // 更新状态文字（正向计时模式没有专注模式，不显示状态）
      if (DOM.focusModeStatus) {
        if (AppState.appMode === 'stopwatch') {
          DOM.focusModeStatus.textContent = ''
        } else {
          DOM.focusModeStatus.textContent = AppState.focusModeEnabled ? '开启' : '关闭'
          DOM.focusModeStatus.classList.toggle('active', AppState.focusModeEnabled)
        }
      }
      
      // 通知主进程更新专注模式状态
      window.electronAPI.updateFocusMode(AppState.focusModeEnabled)
      
      // 更新菜园子按钮状态
      updateGardenButtonState()
      
      // 专注模式关闭时，停止前台检测
      if (!AppState.focusModeEnabled && window.ForegroundDetection) {
        window.ForegroundDetection.stopDetection()
      }
    })
  }

  // 更新菜园子按钮状态（始终可用，种植限制在菜园子内部判断）
  function updateGardenButtonState() {
    if (DOM.gardenBtn) {
      // 始终保持可用状态
      DOM.gardenBtn.disabled = false
      DOM.gardenBtn.style.opacity = '1'
      DOM.gardenBtn.style.cursor = 'pointer'
      DOM.gardenBtn.title = '菜园子'
    }
  }

  // 添加预设按钮
  DOM.addPresetBtn.addEventListener('click', async () => {
    if (AppState.appMode === 'single') {
      const minutes = WheelPicker.getValue()
      
      // 不再需要从NoteManager获取备注，备注将在选择预设后输入
      await Presets.addPreset(minutes, null)
    }
  })

  // 计划模式添加按钮
  DOM.addWorkBtn.addEventListener('click', async () => {
    const minutes = WheelPicker.getValue()
    const note = NoteManager.getNote()
    const finalNote = (note.title || note.detail) ? note : null
    await PlanMode.addItem(minutes, 'work', finalNote)
    NoteManager.clearNote()
  })

  DOM.addBreakBtn.addEventListener('click', async () => {
    const minutes = WheelPicker.getValue()
    const note = NoteManager.getNote()
    const finalNote = (note.title || note.detail) ? note : null
    await PlanMode.addItem(minutes, 'break', finalNote)
    NoteManager.clearNote()
  })

  // 应用模式切换滑块
  DOM.modeSlider.addEventListener('click', () => {
    // 正向计时运行时不允许切换
    if (AppState.appMode === 'stopwatch' && window.Stopwatch && window.Stopwatch.getIsRunning()) {
      return
    }
    
    const modes = ['single', 'plan', 'stopwatch']
    const currentIndex = modes.indexOf(AppState.appMode)
    const nextIndex = (currentIndex + 1) % modes.length
    AppState.switchAppMode(modes[nextIndex])
  })

  DOM.modeLabels.forEach(label => {
    label.addEventListener('click', () => {
      // 正向计时运行时不允许切换
      if (AppState.appMode === 'stopwatch' && window.Stopwatch && window.Stopwatch.getIsRunning()) {
        return
      }
      
      const mode = label.dataset.mode
      if (mode === 'single') {
        AppState.switchAppMode('single')
      } else if (mode === 'plan') {
        AppState.switchAppMode('plan')
      } else if (mode === 'stopwatch') {
        AppState.switchAppMode('stopwatch')
      }
    })
  })

  // 重置按钮
  // 根据当前阶段执行不同操作：
  // - READY 阶段：无效果
  // - RUNNING 阶段：中断计时，可能触发惩罚
  // - FINISHED 阶段：确认完成，进入下一轮准备
  DOM.btnReset.addEventListener('click', async () => {
    // 正向计时模式
    if (AppState.appMode === 'stopwatch') {
      if (window.Stopwatch) {
        window.Stopwatch.reset()
      }
      return
    }
    
    const phase = Timer.getPhase()
    const PHASE = Timer.PHASE
    
    // READY 阶段不执行任何操作
    if (phase === PHASE.READY) {
      return
    }
    
    // RUNNING 阶段（专注模式下）需要确认并触发惩罚
    if (phase === PHASE.RUNNING && AppState.focusModeEnabled) {
      const confirmed = await window.showConfirmModal('确定要中断专注吗？所有正在生长的作物将会枯萎！')
      if (!confirmed) {
        return // 用户取消
      }
      
      // 使用统一的惩罚函数（不检查阶段，因为已经确认过了）
      if (window.ForegroundDetection && window.ForegroundDetection.executePunishment) {
        try {
          await window.ForegroundDetection.executePunishment({ checkPhase: false })
        } catch (e) {
          console.error('[Renderer] executePunishment 出错:', e)
          // 确保即使出错也重置计时器和关闭专注模式
          Timer.reset()
          AppState.setFocusMode(false)
          AppState.updateFocusModeUI()
        }
      } else {
        // 回退处理：如果 executePunishment 不存在
        console.warn('[Renderer] executePunishment 不存在，使用回退处理')
        // 调用 Garden 惩罚
        if (window.Garden && window.Garden.handleResetPunishment) {
          await window.Garden.handleResetPunishment()
        }
        Timer.reset()
        AppState.setFocusMode(false)
        AppState.updateFocusModeUI()
      }
      
      // 清理状态
      NoteManager.clearNote()
      if (AppState.appMode === 'plan') {
        PlanMode.stopPlan()
        DOM.statusEl.textContent = '准备开始计划'
        const firstItem = PlanMode.getFirstItem()
        if (firstItem) {
          Timer.setTime(firstItem.minutes)
          WheelPicker.setValue(firstItem.minutes)
          AppState.updateContainerColor(firstItem.type === 'break')
        }
      }
      return
    }
    
    // 非专注模式下的 RUNNING 阶段或 FINISHED 阶段：停止前台检测
    if (window.ForegroundDetection) {
      window.ForegroundDetection.stopDetection()
    }
    
    // FINISHED 阶段：正常重置，无需确认
    // 执行重置（进入 READY 阶段）
    Timer.reset()
    
    NoteManager.clearNote()

    if (AppState.appMode === 'plan') {
      // 计划模式下，重置 = 停止整个计划，恢复到第一个计划
      PlanMode.stopPlan()
      DOM.statusEl.textContent = '准备开始计划'
      
      // 恢复到第一个计划的时间和颜色
      const firstItem = PlanMode.getFirstItem()
      if (firstItem) {
        Timer.setTime(firstItem.minutes)
        WheelPicker.setValue(firstItem.minutes)
        AppState.updateContainerColor(firstItem.type === 'break')
      }
    }
  })

  // 关闭窗口按钮
  // 专注模式下运行阶段需要确认
  DOM.btnClose.addEventListener('click', async () => {
    const phase = Timer.getPhase()
    
    // 专注模式下，如果在运行阶段，需要确认
    if (AppState.focusModeEnabled && phase === Timer.PHASE.RUNNING) {
      const confirmed = await window.showConfirmModal('确定要关闭吗？所有正在生长的作物将会枯萎！')
      if (!confirmed) {
        return // 用户取消
      }
      // 执行惩罚（不显示弹窗，直接关闭窗口）
      if (window.ForegroundDetection && window.ForegroundDetection.executePunishment) {
        await window.ForegroundDetection.executePunishment({ checkPhase: false, showPopup: false })
      }
    }
    window.electronAPI.closeWindow()
  })

  // 菜园子按钮事件
  if (DOM.gardenBtn) {
    DOM.gardenBtn.addEventListener('click', () => {
      // 正向计时模式下禁用菜园子
      if (AppState.appMode === 'stopwatch') {
        showGardenUnavailableModal()
        return
      }
      window.electronAPI.openGarden()
    })
  }

  // 显示菜园子不可用提示弹窗
  function showGardenUnavailableModal() {
    // 展开侧边栏（如果已收起）
    if (window.expandSidebarIfNeeded) {
      window.expandSidebarIfNeeded()
    }
    
    const modal = document.getElementById('garden-unavailable-modal')
    const okBtn = document.getElementById('garden-unavailable-ok-btn')
    
    if (modal) {
      modal.classList.add('show')
      
      // 点击确定按钮关闭
      const closeModal = () => {
        modal.classList.remove('show')
        okBtn.removeEventListener('click', closeModal)
        modal.removeEventListener('click', handleBackdropClick)
      }
      
      // 点击背景关闭
      const handleBackdropClick = (e) => {
        if (e.target === modal) {
          closeModal()
        }
      }
      
      okBtn.addEventListener('click', closeModal)
      modal.addEventListener('click', handleBackdropClick)
    }
  }

  // 榜单按钮事件
  if (DOM.chartsBtn) {
    DOM.chartsBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      Charts.toggle()
    })
  }

  // 设置按钮事件
  const settingsBtn = document.getElementById('ui-settings-btn')
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      if (window.Settings) {
        Settings.open()
      }
    })
  }

  // 最小化窗口按钮
  // 根据设置决定运行时的行为
  DOM.btnMinimize.addEventListener('click', () => {
    const phase = Timer.getPhase()
    if (phase === Timer.PHASE.RUNNING) {
      // 检查设置：是进入迷你模式还是直接最小化
      const minimizeBehavior = window.Settings ? Settings.getSetting('minimizeBehavior') : 'mini'
      if (minimizeBehavior === 'mini') {
        enterMiniMode()
      } else {
        window.electronAPI.minimizeWindow()
      }
    } else {
      window.electronAPI.minimizeWindow()
    }
  })

  // 图钉置顶按钮
  let isPinned = false
  if (DOM.btnPin) {
    DOM.btnPin.addEventListener('click', () => {
      isPinned = !isPinned
      DOM.btnPin.classList.toggle('active', isPinned)
      window.electronAPI.setAlwaysOnTop(isPinned)
    })
  }

  // ============ 迷你模式功能 ============
  let isMiniMode = false

  function enterMiniMode() {
    isMiniMode = true
    // 隐藏主容器，显示迷你模式
    document.querySelector('.container').style.display = 'none'
    document.getElementById('mini-mode').style.display = 'flex'
    // 调整窗口大小并置顶
    window.electronAPI.enterMiniMode()
  }

  function exitMiniMode() {
    if (!isMiniMode) return
    isMiniMode = false
    // 显示主容器，隐藏迷你模式
    document.querySelector('.container').style.display = 'flex'
    document.getElementById('mini-mode').style.display = 'none'
    // 恢复窗口大小
    window.electronAPI.exitMiniMode()
  }

  // 暴露到全局
  window.MiniMode = {
    isActive: () => isMiniMode,
    exit: exitMiniMode
  }

  // 监听托盘右键菜单退出迷你模式事件
  if (window.electronAPI && window.electronAPI.onExitMiniModeFromTray) {
    window.electronAPI.onExitMiniModeFromTray(() => {
      exitMiniMode()
    })
  }

  // 监听托盘右键菜单退出应用事件
  if (window.electronAPI && window.electronAPI.onQuitAppFromTray) {
    window.electronAPI.onQuitAppFromTray(async () => {
      // 先退出迷你模式
      if (isMiniMode) {
        exitMiniMode()
      }
      // 然后触发关闭逻辑（包括确认弹窗）
      DOM.btnClose.click()
    })
  }

  // 迷你模式展开按钮事件
  const expandMiniBtn = document.getElementById('mini-expand-btn')
  if (expandMiniBtn) {
    expandMiniBtn.addEventListener('click', () => {
      if (isMiniMode) {
        exitMiniMode()
      }
    })
  }

  // 监听迷你模式的拖动结束事件，保存位置
  const miniDraggable = document.querySelector('.mini-draggable')
  if (miniDraggable) {
    miniDraggable.addEventListener('mouseleave', () => {
      if (isMiniMode) {
        window.electronAPI.updateMiniPosition()
      }
    })
  }

  // ============ 初始化显示 ============
  Timer.setTime(AppState.defaultWorkTime)
  WheelPicker.setValue(AppState.defaultWorkTime)
  
  // 自动选择默认预设（25分钟）并显示其备注
  const currentMode = Mode.getMode()
  const presets = DataStore.getPresets()
  const defaultIndex = presets[currentMode].findIndex(preset => {
    const presetMinutes = typeof preset === 'number' ? preset : preset.minutes
    return presetMinutes === 25
  })
  
  if (defaultIndex >= 0) {
    const defaultPreset = presets[currentMode][defaultIndex]
    const defaultNote = typeof defaultPreset === 'object' ? defaultPreset.note : null
    Presets.selectPreset(25, defaultNote, defaultIndex)
  } else if (presets[currentMode].length > 0) {
    // 如果没有25分钟预设，选择第一个预设
    const firstPreset = presets[currentMode][0]
    const firstMinutes = typeof firstPreset === 'number' ? firstPreset : firstPreset.minutes
    const firstNote = typeof firstPreset === 'object' ? firstPreset.note : null
    Presets.selectPreset(firstMinutes, firstNote, 0)
  } else {
    // 如果没有任何预设，显示00:00
    Timer.setTime(0)
  }
  
  // 初始化笔emoji的点击事件
  if (window.Presets && window.Presets.initializeNoteEditButton) {
    window.Presets.initializeNoteEditButton()
  }

  // ============ 顶部按钮展开/收起功能 ============
  const expandBtn = document.getElementById('music-expand-btn')
  const hiddenButtons = document.getElementById('ui-hidden-buttons')
  let isExpanded = false

  if (expandBtn && hiddenButtons) {
    expandBtn.addEventListener('click', () => {
      // 从 DOM 读取实际状态，而不是依赖变量（避免与设置模块不同步）
      const actualExpanded = hiddenButtons.classList.contains('expanded')
      isExpanded = !actualExpanded
      
      if (isExpanded) {
        // 展开：箭头旋转，容器展开露出按钮
        expandBtn.classList.add('expanded')
        hiddenButtons.classList.add('expanded')
        expandBtn.title = '收起'
      } else {
        // 收起：箭头恢复，容器收起隐藏按钮
        expandBtn.classList.remove('expanded')
        hiddenButtons.classList.remove('expanded')
        expandBtn.title = '展开'
      }
    })
  }

  // ============ 侧边栏收起/展开功能 ============
  
  // ============ 计划模式备注区域展开/收起功能 ============
  const planNoteCollapseBtn = document.getElementById('plan-note-collapse-btn')
  const planNoteSection = document.getElementById('plan-note-section')
  const planModeContent = document.getElementById('plan-mode-content')
  let isPlanNoteCollapsed = false

  if (planNoteCollapseBtn && planNoteSection) {
    planNoteCollapseBtn.addEventListener('click', () => {
      isPlanNoteCollapsed = !isPlanNoteCollapsed
      
      if (isPlanNoteCollapsed) {
        planNoteSection.classList.add('collapsed')
        planModeContent.classList.add('note-collapsed')
        planNoteCollapseBtn.title = '展开'
      } else {
        planNoteSection.classList.remove('collapsed')
        planModeContent.classList.remove('note-collapsed')
        planNoteCollapseBtn.title = '收起'
      }
    })
  }
  
  // ============ 侧边栏收起/展开功能 ============
  const sidebarCollapseBtn = document.getElementById('ui-sidebar-collapse-btn')
  
  // 暴露到全局，供其他模块访问
  window.isSidebarCollapsed = false
  
  // 侧边栏收起/展开按钮事件
  if (sidebarCollapseBtn && DOM.container) {
    sidebarCollapseBtn.addEventListener('click', () => {
      window.isSidebarCollapsed = !window.isSidebarCollapsed
      
      if (window.isSidebarCollapsed) {
        DOM.container.classList.add('sidebar-collapsed')
        sidebarCollapseBtn.title = '展开侧边栏'
      } else {
        DOM.container.classList.remove('sidebar-collapsed')
        sidebarCollapseBtn.title = '收起侧边栏'
      }
    })
  }

  // ============ 滚轮调整时间功能 ============
  // 仅在单次模式下、准备阶段时，滚动时间区域可调整分钟数
  const timerContainer = document.querySelector('.timer-section .timer-container')
  if (timerContainer) {
    timerContainer.addEventListener('wheel', (e) => {
      // 判断条件：单次模式 + 准备阶段
      if (AppState.appMode !== 'single') return
      if (Timer.getPhase() !== Timer.PHASE.READY) return
      
      e.preventDefault()
      
      // 获取当前时间（分钟）
      const currentMinutes = Math.floor(Timer.getTotalTime() / 60)
      
      // 根据滚动方向调整（向上滚动增加，向下滚动减少）
      const delta = e.deltaY < 0 ? 1 : -1
      let newMinutes = currentMinutes + delta
      
      // 限制范围 1-120 分钟
      newMinutes = Math.max(1, Math.min(120, newMinutes))
      
      // 设置新时间
      Timer.setTime(newMinutes)
    }, { passive: false })
  }

  // ============ 自定义确认弹窗 ============
  const confirmInterruptElement = document.getElementById('confirm-interrupt-modal')
  const confirmInterruptMessage = confirmInterruptElement?.querySelector('.confirm-message')
  const confirmInterruptCancelBtn = document.getElementById('confirm-interrupt-cancel-btn')
  const confirmInterruptOkBtn = document.getElementById('confirm-interrupt-ok-btn')
  const confirmInterruptModal = confirmInterruptElement ? new BaseModal({
    element: confirmInterruptElement,
    showClass: 'show',
    closeOnBackground: true
  }) : null

  window.showConfirmModal = function(message) {
    return new Promise((resolve) => {
      if (!confirmInterruptModal || !confirmInterruptMessage) {
        resolve(false)
        return
      }

      confirmInterruptMessage.textContent = message

      const cleanup = () => {
        confirmInterruptCancelBtn?.removeEventListener('click', handleCancel)
        confirmInterruptOkBtn?.removeEventListener('click', handleOk)
        document.removeEventListener('keydown', handleEsc)
      }

      const handleCancel = () => {
        cleanup()
        confirmInterruptModal.hide()
        resolve(false)
      }

      const handleOk = () => {
        cleanup()
        confirmInterruptModal.hide()
        resolve(true)
      }

      const handleEsc = (e) => {
        if (e.key === 'Escape' && (!window.modalManager || window.modalManager.isTopModal(confirmInterruptModal))) {
          handleCancel()
        }
      }

      confirmInterruptCancelBtn?.addEventListener('click', handleCancel)
      confirmInterruptOkBtn?.addEventListener('click', handleOk)
      document.addEventListener('keydown', handleEsc)

      confirmInterruptModal.show()
    })
  }

  console.log('[App] 初始化完成')
})()
