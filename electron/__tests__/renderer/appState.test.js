/**
 * AppState 模块测试
 *
 * AppState 模块管理应用模式（single/plan/stopwatch）和专注模式。
 * 这里我们测试公共 API（getter、setFocusMode、toggleFocusMode、switchAppMode、updateContainerColor）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 加载 AppState 之前需要先准备好 DOM、Utils、DOM、Mode、Timer、Stopwatch、DataStore、PlanMode、WheelPicker、Presets
// 注意：setup.js 在每个测试前清空 DOM 并删除 window.Timer/Utils，因此必须在 beforeEach 中重新设置
beforeEach(() => {
  // 重置模块缓存，使 dom 和 appState IIFE 重新执行并缓存新的 DOM 元素 / 状态
  vi.resetModules()
  // 准备 DOM：包含 AppState 会用到的所有元素
  document.body.innerHTML = `
    <div class="container"></div>
    <div class="window-frame"></div>
    <div id="timer-display"></div>
    <button id="timer-start-btn">开始</button>
    <div id="timer-status"></div>
    <div id="timer-progress-circle"></div>
    <div id="timer-today-count"></div>
    <div id="timer-total-minutes"></div>
    <button class="mode-btn" data-mode="work">work</button>
    <button class="mode-btn" data-mode="break">break</button>
    <div id="preset-list"></div>
    <div id="ui-wheel-picker"></div>
    <div id="ui-wheel-column"></div>
    <button id="preset-add-btn">+</button>
    <div id="modeSlider"></div>
    <div id="modeSliderThumb"></div>
    <div class="mode-label" data-mode="single">single</div>
    <div class="mode-label" data-mode="plan">plan</div>
    <div class="mode-label" data-mode="stopwatch">stopwatch</div>
    <div id="ui-single-mode-content"></div>
    <div id="plan-mode-content"></div>
    <div id="plan-list"></div>
    <div id="plan-add-buttons"></div>
    <button id="plan-add-work-btn">work</button>
    <button id="plan-add-break-btn">break</button>
    <div id="ui-tutorial-btn"></div>
    <div id="ui-garden-btn"></div>
    <div id="tutorial-modal"></div>
    <div id="tutorial-close"></div>
    <div id="focus-mode-switch"></div>
    <div id="focus-mode-status"></div>
    <div id="plan-note-section"></div>
    <div id="stopwatch-mode-content"></div>
    <div class="wheel-picker-container"></div>
    <input id="plan-note-title-input" />
    <input id="plan-note-detail-input" />
    <input id="timer-note-title-input" />
    <input id="timer-note-input" />
    <div id="timer-note-display"></div>
    <div id="timer-note-text"></div>
  `

  // 清除 require 缓存，强制 IIFE 重新执行并缓存新的 DOM 元素 / 重置内部 state
  // vi.resetModules() 无法清除 Node 的 require.cache（被 setup.js 的 Module._load 覆盖绕过），
  // 因此需要手动删除缓存
  const domPath = require.resolve('../../src/scripts/modules/dom')
  const utilsPath = require.resolve('../../src/scripts/modules/utils')
  const appStatePath = require.resolve('../../src/scripts/modules/appState')
  delete require.cache[domPath]
  delete require.cache[utilsPath]
  delete require.cache[appStatePath]

  // 加载 Utils
  require('../../src/scripts/modules/utils')

  // 加载 DOM（IIFE 重新执行，缓存当前 DOM 元素到 window.DOM）
  require('../../src/scripts/modules/dom')

  // Mock Mode
  window.Mode = {
    MODE: { WORK: 'work', BREAK: 'break' },
    getMode: vi.fn().mockReturnValue('work'),
    setMode: vi.fn(),
    isWorkMode: vi.fn().mockReturnValue(true),
    isBreakMode: vi.fn().mockReturnValue(false),
    init: vi.fn()
  }

  // Mock Timer
  window.Timer = {
    PHASE: { READY: 'ready', RUNNING: 'running', FINISHED: 'finished' },
    getPhase: vi.fn().mockReturnValue('ready'),
    reset: vi.fn(),
    saveState: vi.fn(),
    restoreState: vi.fn(),
    getState: vi.fn().mockReturnValue(null),
    setTime: vi.fn()
  }

  // Mock Stopwatch
  window.Stopwatch = {
    getIsRunning: vi.fn().mockReturnValue(false),
    reset: vi.fn(),
    init: vi.fn()
  }

  // Mock DataStore
  window.DataStore = {
    getData: vi.fn().mockReturnValue({}),
    saveImmediate: vi.fn().mockResolvedValue(true),
    getStats: vi.fn().mockReturnValue({ todayCount: 0, totalMinutes: 0 })
  }

  // Mock PlanMode
  window.PlanMode = {
    render: vi.fn(),
    getFirstItem: vi.fn().mockReturnValue(null)
  }

  // Mock WheelPicker
  window.WheelPicker = {
    setValue: vi.fn()
  }

  // Mock Presets
  window.Presets = {
    reinitializeNoteDisplay: vi.fn()
  }

  require('../../src/scripts/modules/appState')
})

describe('AppState 默认状态', () => {
  it('appMode 默认为 single', () => {
    expect(window.AppState.appMode).toBe('single')
  })

  it('focusModeEnabled 默认为 false', () => {
    expect(window.AppState.focusModeEnabled).toBe(false)
  })

  it('defaultWorkTime 默认为 25', () => {
    expect(window.AppState.defaultWorkTime).toBe(25)
  })

  it('defaultBreakTime 默认为 5', () => {
    expect(window.AppState.defaultBreakTime).toBe(5)
  })

  it('getAppMode 应返回当前模式', () => {
    expect(window.AppState.getAppMode()).toBe('single')
  })

  it('getDefaultWorkTime / getDefaultBreakTime 返回默认值', () => {
    expect(window.AppState.getDefaultWorkTime()).toBe(25)
    expect(window.AppState.getDefaultBreakTime()).toBe(5)
  })
})

describe('AppState 专注模式', () => {
  it('isFocusModeEnabled 默认返回 false', () => {
    expect(window.AppState.isFocusModeEnabled()).toBe(false)
  })

  it('toggleFocusMode 切换到 true', () => {
    const result = window.AppState.toggleFocusMode()
    expect(result).toBe(true)
    expect(window.AppState.focusModeEnabled).toBe(true)
  })

  it('toggleFocusMode 再次切换到 false', () => {
    window.AppState.toggleFocusMode() // true
    const result = window.AppState.toggleFocusMode() // false
    expect(result).toBe(false)
    expect(window.AppState.focusModeEnabled).toBe(false)
  })

  it('setFocusMode 设置为 true', () => {
    window.AppState.setFocusMode(true)
    expect(window.AppState.focusModeEnabled).toBe(true)
  })

  it('setFocusMode 设置为 false', () => {
    window.AppState.setFocusMode(true)
    window.AppState.setFocusMode(false)
    expect(window.AppState.focusModeEnabled).toBe(false)
  })

  it('updateFocusModeUI 应给 focusModeSwitch 添加 active 类', () => {
    window.AppState.setFocusMode(true)
    const sw = document.getElementById('focus-mode-switch')
    expect(sw.classList.contains('active')).toBe(true)
    const status = document.getElementById('focus-mode-status')
    expect(status.textContent).toBe('开启')
    expect(status.classList.contains('active')).toBe(true)
  })

  it('updateFocusModeUI 关闭时应移除 active 类', () => {
    window.AppState.setFocusMode(true)
    window.AppState.setFocusMode(false)
    const sw = document.getElementById('focus-mode-switch')
    expect(sw.classList.contains('active')).toBe(false)
    const status = document.getElementById('focus-mode-status')
    expect(status.textContent).toBe('关闭')
    expect(status.classList.contains('active')).toBe(false)
  })

  it('updateFocusModeUI 应给 container 添加 focus-mode 类', () => {
    window.AppState.setFocusMode(true)
    const container = document.querySelector('.container')
    expect(container.classList.contains('focus-mode')).toBe(true)
    window.AppState.setFocusMode(false)
    expect(container.classList.contains('focus-mode')).toBe(false)
  })

  it('运行阶段（Timer.PHASE.RUNNING）+ 专注模式时，focusModeSwitch 应禁用', () => {
    window.Timer.getPhase.mockReturnValue('running')
    window.AppState.setFocusMode(true)
    const sw = document.getElementById('focus-mode-switch')
    expect(sw.style.pointerEvents).toBe('none')
    expect(sw.style.opacity).toBe('0.6')
    window.Timer.getPhase.mockReturnValue('ready')
  })

  it('非运行阶段时 focusModeSwitch 应启用', () => {
    window.Timer.getPhase.mockReturnValue('ready')
    window.AppState.setFocusMode(true)
    const sw = document.getElementById('focus-mode-switch')
    expect(sw.style.pointerEvents).toBe('auto')
    expect(sw.style.opacity).toBe('1')
  })

  it('updateNoteInputsDisabled 应保证输入框可用', () => {
    window.AppState.setFocusMode(true)
    const planTitle = document.getElementById('plan-note-title-input')
    const planDetail = document.getElementById('plan-note-detail-input')
    const timerTitle = document.getElementById('timer-note-title-input')
    const timerNote = document.getElementById('timer-note-input')
    expect(planTitle.disabled).toBe(false)
    expect(planTitle.style.opacity).toBe('1')
    expect(planDetail.disabled).toBe(false)
    expect(timerTitle.disabled).toBe(false)
    expect(timerNote.style.opacity).toBe('1')
    expect(timerNote.style.pointerEvents).toBe('auto')
  })
})

describe('AppState switchAppMode → stopwatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.Timer.getPhase.mockReturnValue('ready')
    window.Stopwatch.getIsRunning.mockReturnValue(false)
    window.AppState.setFocusMode(false)
  })

  it('切换到 stopwatch 应重置正在运行的 Timer', () => {
    window.Timer.getPhase.mockReturnValue('running')
    window.AppState.switchAppMode('stopwatch')
    expect(window.Timer.reset).toHaveBeenCalled()
    expect(window.AppState.appMode).toBe('stopwatch')
  })

  it('切换到 stopwatch 应调用 Stopwatch.init', () => {
    window.AppState.switchAppMode('stopwatch')
    expect(window.Stopwatch.init).toHaveBeenCalled()
  })

  it('切换到 stopwatch 后，isFocusModeEnabled 应返回 false', () => {
    window.AppState.switchAppMode('stopwatch')
    expect(window.AppState.isFocusModeEnabled()).toBe(false)
  })

  it('stopwatch 模式下 toggleFocusMode 应返回 false 且不修改状态', () => {
    window.AppState.switchAppMode('stopwatch')
    const result = window.AppState.toggleFocusMode()
    expect(result).toBe(false)
    expect(window.AppState.focusModeEnabled).toBe(false)
  })

  it('stopwatch 模式下 setFocusMode 不应改变状态', () => {
    window.AppState.switchAppMode('stopwatch')
    window.AppState.setFocusMode(true)
    expect(window.AppState.focusModeEnabled).toBe(false)
  })
})

describe('AppState switchAppMode 从 stopwatch 切回', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.Timer.getPhase.mockReturnValue('ready')
    window.Stopwatch.getIsRunning.mockReturnValue(false)
    window.AppState.setFocusMode(false)
  })

  it('从 stopwatch 切到 single 应停止 stopwatch（如果在运行）', () => {
    window.AppState.switchAppMode('stopwatch')
    window.Stopwatch.getIsRunning.mockReturnValue(true)
    window.AppState.switchAppMode('single')
    expect(window.Stopwatch.reset).toHaveBeenCalled()
    expect(window.AppState.appMode).toBe('single')
  })

  it('从 stopwatch 切到 single 应恢复 timer 状态', () => {
    window.AppState.switchAppMode('stopwatch')
    window.AppState.switchAppMode('single')
    expect(window.Timer.restoreState).toHaveBeenCalledWith('single')
    expect(window.Timer.saveState).toHaveBeenCalledWith('plan')
  })

  it('从 stopwatch 切到 plan', () => {
    window.AppState.switchAppMode('stopwatch')
    window.AppState.switchAppMode('plan')
    expect(window.AppState.appMode).toBe('plan')
  })
})

describe('AppState switchAppMode 在 single 和 plan 之间切换', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.Timer.getPhase.mockReturnValue('ready')
    window.AppState.setFocusMode(false)
    // 确保从 single 开始
    window.AppState.switchAppMode('single')
  })

  it('非 READY 阶段不应切换模式', () => {
    window.Timer.getPhase.mockReturnValue('running')
    window.AppState.switchAppMode('plan')
    expect(window.AppState.appMode).toBe('single')
  })

  it('READY 阶段切到 plan 应成功', () => {
    window.Timer.getPhase.mockReturnValue('ready')
    window.AppState.switchAppMode('plan')
    expect(window.AppState.appMode).toBe('plan')
  })

  it('从 plan 切回 single', () => {
    window.Timer.getPhase.mockReturnValue('ready')
    window.AppState.switchAppMode('plan')
    window.AppState.switchAppMode('single')
    expect(window.AppState.appMode).toBe('single')
  })

  it('切到 plan 时有 firstItem 应调用 Timer.setTime 和 WheelPicker.setValue', () => {
    window.Timer.getPhase.mockReturnValue('ready')
    window.Timer.getState.mockReturnValue(null) // 无保存状态
    window.PlanMode.getFirstItem.mockReturnValue({ minutes: 30, type: 'work' })
    window.AppState.switchAppMode('plan')
    expect(window.Timer.setTime).toHaveBeenCalledWith(30)
    expect(window.WheelPicker.setValue).toHaveBeenCalledWith(30)
  })

  it('切到 plan 时无 firstItem 应调用 Timer.setTime(25) 和 WheelPicker.setValue(25)', () => {
    window.Timer.getPhase.mockReturnValue('ready')
    window.Timer.getState.mockReturnValue(null)
    window.PlanMode.getFirstItem.mockReturnValue(null)
    window.AppState.switchAppMode('plan')
    expect(window.Timer.setTime).toHaveBeenCalledWith(25)
    expect(window.WheelPicker.setValue).toHaveBeenCalledWith(25)
  })

  it('切到 plan 时若有保存状态应恢复', () => {
    window.Timer.getPhase.mockReturnValue('ready')
    window.Timer.getState.mockReturnValue({ timeLeft: 100, totalTime: 1500 })
    window.AppState.switchAppMode('plan')
    expect(window.Timer.restoreState).toHaveBeenCalledWith('plan')
  })

  it('切到 plan 时若有保存状态但等于初始值应使用 firstItem', () => {
    window.Timer.getPhase.mockReturnValue('ready')
    window.Timer.getState.mockReturnValue({ timeLeft: 1500, totalTime: 1500 })
    window.PlanMode.getFirstItem.mockReturnValue({ minutes: 20, type: 'break' })
    window.AppState.switchAppMode('plan')
    expect(window.Timer.setTime).toHaveBeenCalledWith(20)
  })

  it('切到 single 应调用 Presets.reinitializeNoteDisplay', () => {
    window.Timer.getPhase.mockReturnValue('ready')
    window.AppState.switchAppMode('plan')
    window.AppState.switchAppMode('single')
    expect(window.Presets.reinitializeNoteDisplay).toHaveBeenCalled()
  })
})

describe('AppState updateContainerColor', () => {
  it('isBreak=true 应添加 break-mode 类', () => {
    window.AppState.updateContainerColor(true)
    const container = document.querySelector('.container')
    const frame = document.querySelector('.window-frame')
    expect(container.classList.contains('break-mode')).toBe(true)
    expect(frame.classList.contains('break-mode')).toBe(true)
  })

  it('isBreak=false 应移除 break-mode 类', () => {
    window.AppState.updateContainerColor(true)
    window.AppState.updateContainerColor(false)
    const container = document.querySelector('.container')
    const frame = document.querySelector('.window-frame')
    expect(container.classList.contains('break-mode')).toBe(false)
    expect(frame.classList.contains('break-mode')).toBe(false)
  })
})

describe('AppState stopwatch 模式备注保存', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.Timer.getPhase.mockReturnValue('ready')
    window.AppState.setFocusMode(false)
  })

  it('从 single 切到 stopwatch 时保存 singleModeNote', async () => {
    const noteText = document.getElementById('timer-note-text')
    noteText.textContent = '  my note  '
    window.AppState.switchAppMode('stopwatch')
    // 等待异步调用完成
    await Promise.resolve()
    expect(window.DataStore.getData).toHaveBeenCalled()
    expect(window.DataStore.saveImmediate).toHaveBeenCalled()
  })

  it('从 stopwatch 切到 plan 时保存 stopwatchModeNote', async () => {
    window.AppState.switchAppMode('stopwatch')
    window.DataStore.getData.mockClear()
    window.DataStore.saveImmediate.mockClear()
    const noteText = document.getElementById('timer-note-text')
    noteText.textContent = 'stopwatch note'
    window.AppState.switchAppMode('plan')
    await Promise.resolve()
    expect(window.DataStore.getData).toHaveBeenCalled()
  })
})
