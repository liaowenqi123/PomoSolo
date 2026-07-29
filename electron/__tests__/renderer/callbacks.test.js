/**
 * Callbacks 模块测试
 *
 * 测试回调函数：计时器回调、模式切换回调、预设选择回调、计划模式回调
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/callbacks')
})

beforeEach(() => {
  document.body.innerHTML = `
    <div id="timer-note-input" style="display:none"></div>
    <div id="timer-note-display" style="display:none">
      <span id="timer-note-text"></span>
    </div>
    <input id="timer-note-title-input" />
    <button id="start-btn"></button>
    <div id="status-text"></div>
  `

  // Mock AppState
  window.AppState = {
    appMode: 'single',
    focusModeEnabled: false,
    updateContainerColor: vi.fn(),
    setFocusMode: vi.fn(),
    updateFocusModeUI: vi.fn()
  }

  // Mock Timer
  window.Timer = {
    PHASE: { READY: 'ready', RUNNING: 'running', FINISHED: 'finished' },
    getPhase: vi.fn().mockReturnValue('ready'),
    getTotalTime: vi.fn().mockReturnValue(1500),
    setTime: vi.fn(),
    start: vi.fn(),
    reset: vi.fn(),
    saveWorkBreakState: vi.fn(),
    restoreWorkBreakState: vi.fn()
  }

  // Mock Mode
  window.Mode = {
    MODE: { WORK: 'work', BREAK: 'break' },
    getMode: vi.fn().mockReturnValue('work'),
    isWorkMode: vi.fn().mockReturnValue(true)
  }

  // Mock Presets
  window.Presets = {
    setEnabled: vi.fn(),
    setMode: vi.fn(),
    reinitializeNoteDisplay: vi.fn()
  }

  // Mock WheelPicker
  window.WheelPicker = {
    setEnabled: vi.fn(),
    setValue: vi.fn()
  }

  // Mock PlanMode
  window.PlanMode = {
    getPlanStatus: vi.fn().mockReturnValue({ isRunning: false, currentIndex: -1 }),
    startPlan: vi.fn(),
    nextItem: vi.fn().mockReturnValue(null),
    getCurrentItem: vi.fn().mockReturnValue(null),
    stopPlan: vi.fn()
  }

  // Mock Stats
  window.Stats = {
    increment: vi.fn().mockResolvedValue(true)
  }

  // Mock DOM
  window.DOM = {
    statusEl: document.getElementById('status-text'),
    startBtn: document.getElementById('start-btn'),
    modeBtns: [document.createElement('button'), document.createElement('button')],
    addWorkBtn: document.createElement('button'),
    addBreakBtn: document.createElement('button')
  }

  // Mock DataStore
  window.DataStore = {
    getData: vi.fn().mockReturnValue({}),
    saveImmediate: vi.fn().mockResolvedValue(true)
  }

  // Mock NoteManager
  window.NoteManager = {
    getNote: vi.fn().mockReturnValue({ title: '', detail: '' })
  }

  // Mock StudyRoom
  window.StudyRoom = {
    isInRoom: vi.fn().mockReturnValue(false),
    uploadSession: vi.fn()
  }

  // Mock ForegroundDetection
  window.ForegroundDetection = {
    startDetection: vi.fn(),
    stopDetection: vi.fn()
  }

  // Mock electronAPI
  window.electronAPI = {
    updateTimerStatus: vi.fn(),
    showNotification: vi.fn()
  }
})

describe('Callbacks getTimerCallbacks', () => {
  it('应返回包含所有回调的对象', () => {
    const callbacks = window.Callbacks.getTimerCallbacks()
    expect(callbacks.onStart).toBeDefined()
    expect(callbacks.onPhaseChange).toBeDefined()
    expect(callbacks.onEnabledChange).toBeDefined()
    expect(callbacks.onComplete).toBeDefined()
  })

  it('onStart 在 single 模式应确认备注输入', () => {
    window.AppState.appMode = 'single'
    const noteInput = document.getElementById('timer-note-input')
    const noteDisplay = document.getElementById('timer-note-display')
    const noteTitleInput = document.getElementById('timer-note-title-input')
    const noteText = document.getElementById('timer-note-text')

    noteInput.style.display = 'flex'
    noteTitleInput.value = '学习英语'

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onStart()

    expect(noteInput.style.display).toBe('none')
    expect(noteDisplay.style.display).toBe('flex')
    expect(noteText.textContent).toBe('学习英语')
  })

  it('onStart 在 single 模式短备注应设置 top 40px', () => {
    window.AppState.appMode = 'single'
    const noteInput = document.getElementById('timer-note-input')
    const noteTitleInput = document.getElementById('timer-note-title-input')
    const noteDisplay = document.getElementById('timer-note-display')

    noteInput.style.display = 'flex'
    noteTitleInput.value = 'ab'

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onStart()

    expect(noteDisplay.style.top).toBe('40px')
  })

  it('onStart 在 single 模式中长备注应设置 top 50px', () => {
    window.AppState.appMode = 'single'
    const noteInput = document.getElementById('timer-note-input')
    const noteTitleInput = document.getElementById('timer-note-title-input')
    const noteDisplay = document.getElementById('timer-note-display')

    noteInput.style.display = 'flex'
    noteTitleInput.value = '这是一个很长的备注内容'

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onStart()

    expect(noteDisplay.style.top).toBe('50px')
  })

  it('onStart 在 plan 模式应初始化计划', () => {
    window.AppState.appMode = 'plan'
    window.PlanMode.getPlanStatus.mockReturnValue({ isRunning: false })

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onStart()

    expect(window.PlanMode.startPlan).toHaveBeenCalled()
  })

  it('onStart 在 plan 模式计划已运行不应重新初始化', () => {
    window.AppState.appMode = 'plan'
    window.PlanMode.getPlanStatus.mockReturnValue({ isRunning: true })

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onStart()

    expect(window.PlanMode.startPlan).not.toHaveBeenCalled()
  })

  it('onStart 专注模式工作模式应启动前台检测', () => {
    window.AppState.focusModeEnabled = true
    window.AppState.appMode = 'single'
    window.Mode.isWorkMode.mockReturnValue(true)

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onStart()

    expect(window.ForegroundDetection.startDetection).toHaveBeenCalled()
  })

  it('onStart 专注模式休息模式不应启动前台检测', () => {
    window.AppState.focusModeEnabled = true
    window.AppState.appMode = 'single'
    window.Mode.isWorkMode.mockReturnValue(false)

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onStart()

    expect(window.ForegroundDetection.startDetection).not.toHaveBeenCalled()
  })
})

describe('Callbacks onPhaseChange', () => {
  it('READY 阶段应启用预设和滚轮', () => {
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('ready')

    expect(window.Presets.setEnabled).toHaveBeenCalledWith(true)
    expect(window.WheelPicker.setEnabled).toHaveBeenCalledWith(true)
  })

  it('RUNNING 阶段非暂停应保存工作休息状态', () => {
    window.AppState.appMode = 'single'
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('running', false)

    expect(window.Timer.saveWorkBreakState).toHaveBeenCalledWith('work')
    expect(window.electronAPI.updateTimerStatus).toHaveBeenCalledWith(true, false)
  })

  it('RUNNING 阶段暂停应停止前台检测', () => {
    window.AppState.focusModeEnabled = true
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('running', true)

    expect(window.ForegroundDetection.stopDetection).toHaveBeenCalled()
    expect(window.electronAPI.updateTimerStatus).toHaveBeenCalledWith(false, true)
  })

  it('FINISHED 阶段应停止前台检测并禁用预设', () => {
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('finished')

    expect(window.ForegroundDetection.stopDetection).toHaveBeenCalled()
    expect(window.Presets.setEnabled).toHaveBeenCalledWith(false)
    expect(window.WheelPicker.setEnabled).toHaveBeenCalledWith(false)
  })

  it('READY 阶段 single 模式应更新状态文字', () => {
    window.AppState.appMode = 'single'
    window.Mode.getMode.mockReturnValue('work')
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('ready')

    expect(window.DOM.statusEl.textContent).toBe('准备开始专注工作')
  })

  it('RUNNING 阶段 single 模式工作应显示专注中', () => {
    window.AppState.appMode = 'single'
    window.Mode.getMode.mockReturnValue('work')
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('running', false)

    expect(window.DOM.statusEl.textContent).toBe('专注中...')
  })

  it('RUNNING 阶段暂停应显示已暂停', () => {
    window.AppState.appMode = 'single'
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('running', true)

    expect(window.DOM.statusEl.textContent).toBe('已暂停')
  })

  it('FINISHED 阶段 single 模式工作应显示完成', () => {
    window.AppState.appMode = 'single'
    window.Mode.getMode.mockReturnValue('work')
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('finished')

    expect(window.DOM.statusEl.textContent).toContain('完成')
  })

  it('plan 模式 RUNNING 应根据当前项显示状态', () => {
    window.AppState.appMode = 'plan'
    window.PlanMode.getCurrentItem.mockReturnValue({ type: 'work', minutes: 25 })
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('running', false)

    expect(window.DOM.statusEl.textContent).toBe('专注中...')
  })
})

describe('Callbacks onEnabledChange', () => {
  it('enabled=true 应启用预设和滚轮', () => {
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onEnabledChange(true)

    expect(window.Presets.setEnabled).toHaveBeenCalledWith(true)
    expect(window.WheelPicker.setEnabled).toHaveBeenCalledWith(true)
  })

  it('enabled=false 在 plan 模式应禁用添加按钮', () => {
    window.AppState.appMode = 'plan'
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onEnabledChange(false)

    expect(window.DOM.addWorkBtn.disabled).toBe(true)
    expect(window.DOM.addBreakBtn.disabled).toBe(true)
  })

  it('专注模式下 enabled=false 应添加 disabled 类', () => {
    window.AppState.focusModeEnabled = true
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onEnabledChange(false)

    expect(window.DOM.startBtn.classList.contains('focus-mode-disabled')).toBe(true)
  })

  it('专注模式下 enabled=true 应移除 disabled 类', () => {
    window.AppState.focusModeEnabled = true
    window.DOM.startBtn.classList.add('focus-mode-disabled')
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onEnabledChange(true)

    expect(window.DOM.startBtn.classList.contains('focus-mode-disabled')).toBe(false)
  })
})

describe('Callbacks onComplete', () => {
  it('single 模式工作完成应显示通知和记录统计', async () => {
    window.AppState.appMode = 'single'
    window.Mode.getMode.mockReturnValue('work')
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onComplete()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.showNotification).toHaveBeenCalled()
    expect(window.Stats.increment).toHaveBeenCalled()
  })

  it('single 模式休息完成应显示通知', async () => {
    window.AppState.appMode = 'single'
    window.Mode.getMode.mockReturnValue('break')
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onComplete()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.showNotification).toHaveBeenCalledWith('☕ 休息结束', expect.any(String))
  })

  it('single 模式工作完成在自习室应上传会话', async () => {
    window.AppState.appMode = 'single'
    window.Mode.getMode.mockReturnValue('work')
    window.StudyRoom.isInRoom.mockReturnValue(true)
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onComplete()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.StudyRoom.uploadSession).toHaveBeenCalled()
  })

  it('plan 模式完成工作任务应记录统计', async () => {
    window.AppState.appMode = 'plan'
    window.PlanMode.getCurrentItem.mockReturnValue({ type: 'work', minutes: 25 })
    window.PlanMode.nextItem.mockReturnValue(null)
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onComplete()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.Stats.increment).toHaveBeenCalledWith(25, expect.any(String))
  })

  it('plan 模式完成休息任务不应记录统计', async () => {
    window.AppState.appMode = 'plan'
    window.PlanMode.getCurrentItem.mockReturnValue({ type: 'break', minutes: 5 })
    window.PlanMode.nextItem.mockReturnValue(null)
    window.Stats.increment.mockClear()
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onComplete()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.Stats.increment).not.toHaveBeenCalled()
  })

  it('plan 模式有下一项应设置下一项时间', async () => {
    window.AppState.appMode = 'plan'
    window.PlanMode.getCurrentItem.mockReturnValue({ type: 'work', minutes: 25 })
    window.PlanMode.nextItem.mockReturnValue({ type: 'break', minutes: 5 })
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onComplete()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.Timer.setTime).toHaveBeenCalledWith(5)
    expect(window.WheelPicker.setValue).toHaveBeenCalledWith(5)
  })

  it('plan 模式无下一项应停止计划', async () => {
    window.AppState.appMode = 'plan'
    window.PlanMode.getCurrentItem.mockReturnValue({ type: 'work', minutes: 25 })
    window.PlanMode.nextItem.mockReturnValue(null)
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onComplete()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.PlanMode.stopPlan).toHaveBeenCalled()
  })
})

describe('Callbacks getModeCallbacks', () => {
  it('onBeforeChange 在 READY 阶段应允许切换', () => {
    window.Timer.getPhase.mockReturnValue('ready')
    const callbacks = window.Callbacks.getModeCallbacks()
    expect(callbacks.onBeforeChange()).toBe(true)
  })

  it('onBeforeChange 在 RUNNING 阶段应禁止切换', () => {
    window.Timer.getPhase.mockReturnValue('running')
    const callbacks = window.Callbacks.getModeCallbacks()
    expect(callbacks.onBeforeChange()).toBe(false)
  })

  it('onModeChange 应恢复状态并切换预设', () => {
    const callbacks = window.Callbacks.getModeCallbacks()
    callbacks.onModeChange('work')

    expect(window.Timer.restoreWorkBreakState).toHaveBeenCalledWith('work')
    expect(window.Presets.setMode).toHaveBeenCalledWith('work', true)
  })
})

describe('Callbacks getPresetCallbacks', () => {
  it('onSelect 在 single 模式应设置计时器时间', () => {
    window.AppState.appMode = 'single'
    const callbacks = window.Callbacks.getPresetCallbacks()
    callbacks.onSelect(25)

    expect(window.Timer.setTime).toHaveBeenCalledWith(25)
  })

  it('onSelect 在 plan 模式不应设置计时器时间', () => {
    window.AppState.appMode = 'plan'
    window.Timer.setTime.mockClear()
    const callbacks = window.Callbacks.getPresetCallbacks()
    callbacks.onSelect(25)

    expect(window.Timer.setTime).not.toHaveBeenCalled()
  })
})

describe('Callbacks getPlanModeCallbacks', () => {
  it('onFirstItemChange 在 plan 模式应更新颜色', () => {
    window.AppState.appMode = 'plan'
    const callbacks = window.Callbacks.getPlanModeCallbacks()
    callbacks.onFirstItemChange({ type: 'break' })

    expect(window.AppState.updateContainerColor).toHaveBeenCalledWith(true)
  })

  it('onFirstItemChange 无 item 不应更新颜色', () => {
    window.AppState.appMode = 'plan'
    window.AppState.updateContainerColor.mockClear()
    const callbacks = window.Callbacks.getPlanModeCallbacks()
    callbacks.onFirstItemChange(null)

    expect(window.AppState.updateContainerColor).not.toHaveBeenCalled()
  })

  it('onTimeUpdate 在 plan 模式应设置时间和滚轮', () => {
    window.AppState.appMode = 'plan'
    const callbacks = window.Callbacks.getPlanModeCallbacks()
    callbacks.onTimeUpdate(30)

    expect(window.Timer.setTime).toHaveBeenCalledWith(30)
    expect(window.WheelPicker.setValue).toHaveBeenCalledWith(30)
  })

  it('onTimeUpdate 非 plan 模式不应设置时间', () => {
    window.AppState.appMode = 'single'
    window.Timer.setTime.mockClear()
    const callbacks = window.Callbacks.getPlanModeCallbacks()
    callbacks.onTimeUpdate(30)

    expect(window.Timer.setTime).not.toHaveBeenCalled()
  })
})

describe('Callbacks 未覆盖分支补充', () => {
  it('onStart 在 plan 模式专注模式工作任务应启动前台检测', () => {
    window.AppState.appMode = 'plan'
    window.AppState.focusModeEnabled = true
    window.PlanMode.getPlanStatus.mockReturnValue({ isRunning: true })
    window.PlanMode.getCurrentItem.mockReturnValue({ type: 'work', minutes: 25 })

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onStart()

    expect(window.ForegroundDetection.startDetection).toHaveBeenCalled()
  })

  it('onStart 在 plan 模式专注模式休息任务不应启动前台检测', () => {
    window.ForegroundDetection.startDetection.mockClear()
    window.AppState.appMode = 'plan'
    window.AppState.focusModeEnabled = true
    window.PlanMode.getPlanStatus.mockReturnValue({ isRunning: true })
    window.PlanMode.getCurrentItem.mockReturnValue({ type: 'break', minutes: 5 })

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onStart()

    expect(window.ForegroundDetection.startDetection).not.toHaveBeenCalled()
  })

  it('onStart 在 single 模式中长备注(3-4字)应设置 top 45px', () => {
    window.AppState.appMode = 'single'
    const noteInput = document.getElementById('timer-note-input')
    const noteTitleInput = document.getElementById('timer-note-title-input')
    const noteDisplay = document.getElementById('timer-note-display')

    noteInput.style.display = 'flex'
    noteTitleInput.value = 'abcd'

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onStart()

    expect(noteDisplay.style.top).toBe('45px')
  })

  it('onPhaseChange READY 阶段 plan 模式应启用添加按钮', () => {
    window.AppState.appMode = 'plan'
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('ready')

    expect(window.DOM.addWorkBtn.disabled).toBe(false)
    expect(window.DOM.addBreakBtn.disabled).toBe(false)
  })

  it('onPhaseChange RUNNING 阶段非暂停 + 专注模式 + 工作模式应重启前台检测', () => {
    window.AppState.focusModeEnabled = true
    window.AppState.appMode = 'single'
    window.Mode.isWorkMode.mockReturnValue(true)
    window.ForegroundDetection.startDetection.mockClear()

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('running', false)

    expect(window.ForegroundDetection.startDetection).toHaveBeenCalled()
  })

  it('onPhaseChange RUNNING 阶段非暂停 + 专注模式 + 休息模式不应重启前台检测', () => {
    window.AppState.focusModeEnabled = true
    window.AppState.appMode = 'single'
    window.Mode.isWorkMode.mockReturnValue(false)
    window.ForegroundDetection.startDetection.mockClear()

    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('running', false)

    expect(window.ForegroundDetection.startDetection).not.toHaveBeenCalled()
  })

  it('onPhaseChange FINISHED 阶段应禁用模式按钮', () => {
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('finished')

    expect(window.DOM.modeBtns[0].style.pointerEvents).toBe('none')
  })

  it('onPhaseChange FINISHED 阶段 plan 模式应禁用添加按钮', () => {
    window.AppState.appMode = 'plan'
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('finished')

    expect(window.DOM.addWorkBtn.disabled).toBe(true)
    expect(window.DOM.addBreakBtn.disabled).toBe(true)
  })

  it('onPhaseChange READY 阶段应启用模式按钮', () => {
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('ready')

    expect(window.DOM.modeBtns[0].style.pointerEvents).toBe('auto')
  })

  it('updateStatusText single 模式休息 RUNNING 应显示休息中', () => {
    window.AppState.appMode = 'single'
    window.Mode.getMode.mockReturnValue('break')
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('running', false)

    expect(window.DOM.statusEl.textContent).toBe('休息中...')
  })

  it('updateStatusText single 模式休息 READY 应显示准备休息', () => {
    window.AppState.appMode = 'single'
    window.Mode.getMode.mockReturnValue('break')
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('ready')

    expect(window.DOM.statusEl.textContent).toBe('准备休息一下')
  })

  it('updateStatusText plan 模式 RUNNING 暂停应显示已暂停', () => {
    window.AppState.appMode = 'plan'
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('running', true)

    expect(window.DOM.statusEl.textContent).toBe('已暂停')
  })

  it('updateStatusText plan 模式 RUNNING 休息任务应显示休息中', () => {
    window.AppState.appMode = 'plan'
    window.PlanMode.getCurrentItem.mockReturnValue({ type: 'break', minutes: 5 })
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('running', false)

    expect(window.DOM.statusEl.textContent).toBe('休息中...')
  })

  it('updateStatusText plan 模式 READY 应显示准备开始计划', () => {
    window.AppState.appMode = 'plan'
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onPhaseChange('ready')

    expect(window.DOM.statusEl.textContent).toBe('准备开始计划')
  })

  it('handlePlanModeComplete 工作任务在自习室应上传会话', async () => {
    window.AppState.appMode = 'plan'
    window.PlanMode.getCurrentItem.mockReturnValue({ type: 'work', minutes: 25 })
    window.PlanMode.nextItem.mockReturnValue(null)
    window.StudyRoom.isInRoom.mockReturnValue(true)
    window.NoteManager.getNote.mockReturnValue({ title: '学习', detail: '' })
    const callbacks = window.Callbacks.getTimerCallbacks()
    callbacks.onComplete()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.StudyRoom.uploadSession).toHaveBeenCalledWith(25, '学习')
  })

  it('handlePlanModeComplete 有下一项应延迟自动开始', async () => {
    vi.useFakeTimers()
    window.AppState.appMode = 'plan'
    window.PlanMode.getCurrentItem.mockReturnValue({ type: 'work', minutes: 25 })
    window.PlanMode.nextItem.mockReturnValue({ type: 'break', minutes: 5 })
    const callbacks = window.Callbacks.getTimerCallbacks()
    const promise = callbacks.onComplete()

    // 等待微任务（await Stats.increment）完成
    await promise

    // 触发 setTimeout
    vi.advanceTimersByTime(1100)

    expect(window.Timer.start).toHaveBeenCalled()
    expect(window.AppState.updateContainerColor).toHaveBeenCalledWith(true)
    vi.useRealTimers()
  })

  it('onModeChange 应重新初始化备注显示', () => {
    const callbacks = window.Callbacks.getModeCallbacks()
    callbacks.onModeChange('work')

    expect(window.Presets.reinitializeNoteDisplay).toHaveBeenCalled()
  })
})
