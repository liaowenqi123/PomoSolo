/**
 * 计时器模块测试
 *
 * 测试 Timer 的三阶段状态机（READY → RUNNING → FINISHED）
 * 这是"按钮行为"的核心逻辑：点击开始/暂停/重置按钮时
 * 计时器的行为由这套状态机驱动。
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

// 预准备 DOM + Mock 环境
beforeAll(() => {
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

  // 加载 timer 模块（IIFE，设置 window.Timer）
  require('../src/scripts/modules/timer')

  // 初始化 Timer，传入 mock 元素
  window.Timer.init(
    {
      timeDisplay: document.getElementById('timer-display'),
      startBtn: document.getElementById('timer-start-btn'),
      progressCircle: document.getElementById('timer-progress-circle')
    },
    {
      onStart: vi.fn(),
      onComplete: vi.fn(),
      onPhaseChange: vi.fn(),
      onEnabledChange: vi.fn()
    }
  )
})

// 每个测试前都重置到已知状态
afterEach(() => {
  window.Timer.reset()
  window.AppState.focusModeEnabled = false
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
})
