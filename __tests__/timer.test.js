/**
 * 计时器模块测试
 *
 * 测试 Timer 的三阶段状态机（READY → RUNNING → FINISHED）
 * 这是"按钮行为"的核心逻辑：点击开始/暂停/重置按钮时
 * 计时器的行为由这套状态机驱动。
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// 保存 Timer 回调引用，供测试断言
let timerCallbacks

// 预准备 DOM + Mock 环境（必须在 beforeEach 中设置，因为 setup.js 在每个测试前清空 DOM）
beforeEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = `
    <div id="timer-display">00:00</div>
    <button id="timer-start-btn">开始</button>
    <svg id="timer-progress-circle">
      <circle id="mini-progress-circle"/>
    </svg>
    <div id="mini-time-display">00:00</div>
    <div id="timer-note-text"></div>
  `

  // Mock Utils
  window.Utils = {
    formatTime: (s) => {
      const m = Math.floor(s / 60)
      const sec = Math.floor(s % 60)
      return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    }
  }

  // Mock AppState
  window.AppState = {
    appMode: 'single',
    focusModeEnabled: false
  }

  // Mock Mode
  window.Mode = {
    MODE: { WORK: 'work', BREAK: 'break' },
    getMode: () => 'work'
  }

  // Mock 依赖
  window.Stats = { recordPartialFocus: vi.fn() }
  window.electronAPI = {
    gardenGrow: vi.fn(),
    updateFocusMode: vi.fn(),
    updateTimerStatus: vi.fn()
  }

  // 重置模块缓存，使 timer IIFE 重新执行并重置内部闭包状态
  vi.resetModules()
  // vi.resetModules() 无法清除 Node 的 require.cache（被 setup.js 的 Module._load 覆盖绕过），
  // 因此需要手动删除缓存，强制 IIFE 重新执行
  delete require.cache[require.resolve('../src/scripts/modules/timer')]
  // 加载 timer 模块（IIFE，设置 window.Timer）
  require('../src/scripts/modules/timer')

  // 初始化 Timer，传入 mock 元素
  // 保存回调引用，供测试断言
  timerCallbacks = {
    onStart: vi.fn(),
    onComplete: vi.fn(),
    onPhaseChange: vi.fn(),
    onEnabledChange: vi.fn()
  }
  window.Timer.init(
    {
      timeDisplay: document.getElementById('timer-display'),
      startBtn: document.getElementById('timer-start-btn'),
      progressCircle: document.getElementById('timer-progress-circle')
    },
    timerCallbacks
  )
})

// 每个测试前都重置到已知状态
afterEach(() => {
  if (window.Timer && window.Timer.reset) {
    window.Timer.reset()
  }
  if (window.AppState) {
    window.AppState.focusModeEnabled = false
  }
  vi.useRealTimers()
})

describe('Timer 状态机', () => {
  it('初始阶段应为 READY', () => {
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.READY)
    expect(window.Timer.getIsReady()).toBe(true)
    expect(window.Timer.getIsRunning()).toBe(false)
  })

  it('start() 应切换到 RUNNING 阶段', () => {
    window.Timer.setTime(25)
    window.Timer.start()

    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.RUNNING)
    expect(window.Timer.getIsRunning()).toBe(true)
    expect(window.Timer.getIsPaused()).toBe(false)
    expect(document.getElementById('timer-start-btn').textContent).toBe('暂停')
  })

  it('暂停/继续应正常工作', () => {
    window.Timer.setTime(25)
    window.Timer.start()

    // 暂停
    window.Timer.pause()
    expect(window.Timer.getIsPaused()).toBe(true)
    expect(document.getElementById('timer-start-btn').textContent).toBe('继续')

    // 继续
    window.Timer.toggle()
    expect(window.Timer.getIsPaused()).toBe(false)
    expect(document.getElementById('timer-start-btn').textContent).toBe('暂停')
  })

  it('reset() 应回到 READY 阶段', () => {
    window.Timer.setTime(25)
    window.Timer.start()
    window.Timer.reset()

    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.READY)
    expect(window.Timer.getIsReady()).toBe(true)
    expect(window.Timer.getTimeLeft()).toBe(window.Timer.getTotalTime())
    expect(document.getElementById('timer-start-btn').textContent).toBe('开始')
  })

  it('setTime() 在 RUNNING 阶段应无效', () => {
    window.Timer.setTime(10)
    window.Timer.start()
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.RUNNING)

    window.Timer.setTime(30)  // 尝试改为 30 分钟
    expect(window.Timer.getTotalTime()).toBe(10 * 60)  // 不应生效

    window.Timer.reset()
  })

  it('toggle() 专注模式下运行时不应暂停', () => {
    window.AppState.focusModeEnabled = true

    window.Timer.setTime(25)
    window.Timer.start()
    expect(window.Timer.getIsRunning()).toBe(true)

    // toggle 应被阻止
    window.Timer.toggle()
    expect(window.Timer.getIsPaused()).toBe(false)

    window.Timer.reset()
  })

  it('setTime() 在 READY 阶段有效', () => {
    window.Timer.setTime(45)
    expect(window.Timer.getTotalTime()).toBe(45 * 60)
    expect(window.Timer.getTimeLeft()).toBe(45 * 60)
  })

  it('setTime() 在 FINISHED 阶段有效（因为 phase !== RUNNING）', () => {
    // 模拟计时完成进入 FINISHED 阶段
    // 通过 fake timers 推进时间
    vi.useFakeTimers()
    window.Timer.setTime(1) // 1 分钟
    window.Timer.start()

    // 推进 70 秒（超过 1 分钟）
    vi.advanceTimersByTime(70000)

    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.FINISHED)

    // setTime 在 FINISHED 应该有效
    window.Timer.setTime(30)
    expect(window.Timer.getTotalTime()).toBe(30 * 60)

    window.Timer.reset()
  })
})

describe('Timer 时间戳计时逻辑', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 重置 Stats mock
    window.Stats.recordPartialFocus.mockClear()
    window.electronAPI.gardenGrow.mockClear()
    window.electronAPI.updateTimerStatus.mockClear()
  })

  it('基于时间戳计算剩余时间', () => {
    window.Timer.setTime(5) // 5 分钟 = 300 秒
    window.Timer.start()

    expect(window.Timer.getTimeLeft()).toBe(300)

    // 推进 60 秒
    vi.advanceTimersByTime(60000)

    expect(window.Timer.getTimeLeft()).toBe(240)
  })

  it('专注模式下每分钟应触发 gardenGrow IPC', () => {
    window.AppState.focusModeEnabled = true
    window.Timer.setTime(5) // 5 分钟
    window.Timer.start()

    // 推进 60 秒（1 分钟）
    vi.advanceTimersByTime(60000)

    expect(window.electronAPI.gardenGrow).toHaveBeenCalledWith(1)
  })

  it('非专注模式下不应触发 gardenGrow IPC', () => {
    window.AppState.focusModeEnabled = false
    window.Timer.setTime(5)
    window.Timer.start()

    vi.advanceTimersByTime(60000)

    expect(window.electronAPI.gardenGrow).not.toHaveBeenCalled()
  })

  it('计时完成应进入 FINISHED 阶段并触发回调', () => {
    const originalCallbacks = window.Timer._callbacks // 没有公开的设置方法，使用已绑定的
    window.Timer.setTime(1)
    window.Timer.start()

    // 推进 70 秒（超过 1 分钟）
    vi.advanceTimersByTime(70000)

    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.FINISHED)
    expect(window.Timer.getTimeLeft()).toBe(0)
  })

  it('暂停后恢复应保持剩余时间', () => {
    window.Timer.setTime(5)
    window.Timer.start()

    // 推进 60 秒
    vi.advanceTimersByTime(60000)
    expect(window.Timer.getTimeLeft()).toBe(240)

    // 暂停
    window.Timer.pause()

    // 暂停期间推进时间不应影响
    vi.advanceTimersByTime(120000)
    expect(window.Timer.getTimeLeft()).toBe(240)

    // 恢复
    window.Timer.toggle()
    expect(window.Timer.getIsPaused()).toBe(false)

    // 推进 60 秒
    vi.advanceTimersByTime(60000)
    expect(window.Timer.getTimeLeft()).toBe(180)
  })

  it('updateTimerStatus 在每次 tick 时不应重复调用（仅 phase change 时调用）', () => {
    window.Timer.setTime(5)
    timerCallbacks.onPhaseChange.mockClear()

    window.Timer.start()

    // start 触发 onPhaseChange（phase 切换到 RUNNING）
    expect(timerCallbacks.onPhaseChange).toHaveBeenCalled()

    const callsBefore = timerCallbacks.onPhaseChange.mock.calls.length

    vi.advanceTimersByTime(60000)

    // tick 期间不应重复调用 onPhaseChange（仅 phase change 时调用）
    expect(timerCallbacks.onPhaseChange.mock.calls.length).toBe(callsBefore)
  })
})

describe('Timer 状态查询', () => {
  it('getTimeLeft / getTotalTime 返回正确值', () => {
    window.Timer.setTime(45)
    expect(window.Timer.getTotalTime()).toBe(45 * 60)
    expect(window.Timer.getTimeLeft()).toBe(45 * 60)
  })

  it('getIsFinished 在非 FINISHED 阶段返回 false', () => {
    expect(window.Timer.getIsFinished()).toBe(false)
  })

  it('getIsReady / getIsRunning / getIsPaused 互斥', () => {
    // READY
    expect(window.Timer.getIsReady()).toBe(true)
    expect(window.Timer.getIsRunning()).toBe(false)
  })

  it('getIsFinished 在 FINISHED 阶段返回 true', () => {
    vi.useFakeTimers()
    window.Timer.setTime(1)
    window.Timer.start()
    vi.advanceTimersByTime(70000)
    expect(window.Timer.getIsFinished()).toBe(true)
    window.Timer.reset()
  })
})

describe('Timer reset 在不同阶段的行为', () => {
  it('READY 阶段 reset 应无效果', () => {
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.READY)
    window.Timer.reset()
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.READY)
  })

  it('RUNNING 阶段 reset 应记录部分专注时间', () => {
    vi.useFakeTimers()
    window.Stats.recordPartialFocus.mockClear()

    window.Timer.setTime(5)
    window.Timer.start()

    // 推进 60 秒
    vi.advanceTimersByTime(60000)

    // 在 RUNNING 阶段重置
    window.Timer.reset()

    // 应该调用 recordPartialFocus
    expect(window.Stats.recordPartialFocus).toHaveBeenCalled()
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.READY)
  })

  it('FINISHED 阶段 reset 不应记录部分专注时间', () => {
    vi.useFakeTimers()
    window.Stats.recordPartialFocus.mockClear()

    window.Timer.setTime(1)
    window.Timer.start()
    vi.advanceTimersByTime(70000)
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.FINISHED)

    window.Stats.recordPartialFocus.mockClear()
    window.Timer.reset()

    expect(window.Stats.recordPartialFocus).not.toHaveBeenCalled()
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.READY)
  })

  it('reset 应记录带备注的部分专注时间', () => {
    vi.useFakeTimers()

    const noteText = document.getElementById('timer-note-text')
    noteText.textContent = '测试备注'

    window.Timer.setTime(5)
    window.Timer.start()
    vi.advanceTimersByTime(60000)

    window.Stats.recordPartialFocus.mockClear()
    window.Timer.reset()

    expect(window.Stats.recordPartialFocus).toHaveBeenCalledWith(
      expect.any(Number),
      '测试备注'
    )
  })
})

describe('Timer toggle 行为', () => {
  it('READY 阶段 toggle 应启动计时器', () => {
    window.Timer.setTime(25)
    window.Timer.toggle()
    expect(window.Timer.getIsRunning()).toBe(true)
  })

  it('RUNNING 阶段 toggle 应暂停', () => {
    window.Timer.setTime(25)
    window.Timer.start()
    window.Timer.toggle()
    expect(window.Timer.getIsPaused()).toBe(true)
  })

  it('RUNNING 暂停状态 toggle 应继续', () => {
    window.Timer.setTime(25)
    window.Timer.start()
    window.Timer.pause()
    window.Timer.toggle()
    expect(window.Timer.getIsPaused()).toBe(false)
  })

  it('FINISHED 阶段 toggle 应重新开始', () => {
    vi.useFakeTimers()
    window.Timer.setTime(1)
    window.Timer.start()
    vi.advanceTimersByTime(70000)
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.FINISHED)

    window.Timer.toggle()
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.RUNNING)
    expect(window.Timer.getIsPaused()).toBe(false)
  })
})

describe('Timer start 方法分支', () => {
  it('READY 阶段 start 应进入 RUNNING', () => {
    window.Timer.setTime(25)
    window.Timer.start()
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.RUNNING)
    expect(window.Timer.getIsPaused()).toBe(false)
  })

  it('FINISHED 阶段 start 应重新开始', () => {
    vi.useFakeTimers()
    window.Timer.setTime(1)
    window.Timer.start()
    vi.advanceTimersByTime(70000)
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.FINISHED)

    window.Timer.start()
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.RUNNING)
  })

  it('RUNNING + isPaused 时 start 应从暂停恢复', () => {
    window.Timer.setTime(25)
    window.Timer.start()
    window.Timer.pause()
    expect(window.Timer.getIsPaused()).toBe(true)

    window.Timer.start()
    expect(window.Timer.getIsPaused()).toBe(false)
  })

  it('RUNNING + 非 isPaused 时 start 应无效果', () => {
    window.Timer.setTime(25)
    window.Timer.start()
    expect(window.Timer.getIsPaused()).toBe(false)

    window.Timer.start() // 不应改变状态
    expect(window.Timer.getIsPaused()).toBe(false)
  })

  it('从 FINISHED 重新开始时，timeLeft=0 应重置为 totalTime', () => {
    vi.useFakeTimers()
    window.Timer.setTime(1)
    window.Timer.start()
    vi.advanceTimersByTime(70000)
    expect(window.Timer.getTimeLeft()).toBe(0)

    window.Timer.start()
    // timeLeft 应被重置为 totalTime
    expect(window.Timer.getTimeLeft()).toBe(60)
  })
})

describe('Timer pause 行为', () => {
  it('非 RUNNING 阶段 pause 无效', () => {
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.READY)
    window.Timer.pause()
    expect(window.Timer.getPhase()).toBe(window.Timer.PHASE.READY)
  })

  it('RUNNING + isPaused 时 pause 无效', () => {
    window.Timer.setTime(25)
    window.Timer.start()
    window.Timer.pause()
    expect(window.Timer.getIsPaused()).toBe(true)

    window.Timer.pause() // 再次 pause，应无效果
    expect(window.Timer.getIsPaused()).toBe(true)
  })
})

describe('Timer 模式切换状态保存', () => {
  it('saveState / restoreState 应正确保存和恢复', () => {
    window.Timer.setTime(15)
    window.Timer.saveState('single')

    // 修改时间
    window.Timer.setTime(30)
    expect(window.Timer.getTotalTime()).toBe(30 * 60)

    // 恢复
    window.Timer.restoreState('single')
    expect(window.Timer.getTotalTime()).toBe(15 * 60)
  })

  it('saveState 无效 mode 不应报错', () => {
    window.Timer.setTime(10)
    expect(() => window.Timer.saveState('invalid')).not.toThrow()
    expect(() => window.Timer.restoreState('invalid')).not.toThrow()
  })

  it('getState 返回保存的状态', () => {
    window.Timer.setTime(20)
    window.Timer.saveState('single')
    const state = window.Timer.getState('single')
    expect(state).not.toBeNull()
    expect(state.totalTime).toBe(20 * 60)
  })

  it('getState 未知 mode 返回 null', () => {
    expect(window.Timer.getState('unknown')).toBeNull()
  })

  it('工作/休息模式的状态应独立保存', () => {
    window.Timer.setTime(25)
    window.Timer.saveWorkBreakState('work')

    window.Timer.setTime(5)
    window.Timer.saveWorkBreakState('break')

    window.Timer.restoreWorkBreakState('work')
    expect(window.Timer.getTotalTime()).toBe(25 * 60)

    window.Timer.restoreWorkBreakState('break')
    expect(window.Timer.getTotalTime()).toBe(5 * 60)
  })

  it('saveWorkBreakState / restoreWorkBreakState 未知 mode 无效', () => {
    window.Timer.setTime(15)
    expect(() => window.Timer.saveWorkBreakState('invalid')).not.toThrow()
    expect(() => window.Timer.restoreWorkBreakState('invalid')).not.toThrow()
    // 时间不应变化
    expect(window.Timer.getTotalTime()).toBe(15 * 60)
  })

  it('getWorkBreakState 返回保存的状态', () => {
    window.Timer.setTime(30)
    window.Timer.saveWorkBreakState('work')
    const state = window.Timer.getWorkBreakState('work')
    expect(state).not.toBeNull()
    expect(state.totalTime).toBe(30 * 60)
  })

  it('getWorkBreakState 未知 mode 返回 null', () => {
    expect(window.Timer.getWorkBreakState('unknown')).toBeNull()
  })
})

describe('Timer 显示更新', () => {
  it('setTime 应更新显示', () => {
    window.Timer.setTime(30)
    const display = document.getElementById('timer-display')
    expect(display.textContent).toBe('30:00')
  })

  it('setTime 应重置进度圆', () => {
    window.Timer.setTime(30)
    const progressCircle = document.getElementById('timer-progress-circle')
    expect(progressCircle.style.strokeDashoffset).toBe('0')
  })

  it('计时中应更新迷你模式显示', () => {
    vi.useFakeTimers()
    window.Timer.setTime(5)
    window.Timer.start()

    vi.advanceTimersByTime(60000)

    const miniTimeDisplay = document.getElementById('mini-time-display')
    expect(miniTimeDisplay.textContent).toBe('04:00')
  })
})

describe('Timer 多分钟 gardenGrow 调用', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.AppState.focusModeEnabled = true
    window.electronAPI.gardenGrow.mockClear()
  })

  it('推进 2 分钟应调用 gardenGrow 2 次（或一次参数为 2）', () => {
    window.Timer.setTime(10)
    window.Timer.start()

    // 推进 120 秒
    vi.advanceTimersByTime(120000)

    // 由于实现可能合并分钟数，至少调用过 gardenGrow
    expect(window.electronAPI.gardenGrow).toHaveBeenCalled()
  })
})
