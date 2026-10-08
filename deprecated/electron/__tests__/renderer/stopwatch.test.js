/**
 * Stopwatch 模块测试
 *
 * 注意：setup.js 在每个测试前清空 DOM，因此 DOM 和模块必须在 beforeEach 中重新设置。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()

  document.body.innerHTML = `
    <div id="timer-display">0:00</div>
    <button id="timer-start-btn">开始</button>
    <svg id="timer-progress-circle"></svg>
    <div id="timer-status">准备开始计时</div>
    <div id="timer-note-text"></div>
  `
  // 重置模块缓存，使 dom IIFE 重新执行并缓存新的 DOM 元素
  vi.resetModules()
  // Mock DOM
  require('../../src/scripts/modules/dom')
  // 确保 DOM.statusEl 指向当前 DOM 元素（vi.resetModules 后 IIFE 重新执行，但保险起见手动更新）
  if (window.DOM) {
    window.DOM.statusEl = document.getElementById('timer-status')
    window.DOM.startBtn = document.getElementById('timer-start-btn')
    window.DOM.timeDisplay = document.getElementById('timer-display')
  }
  // Mock DataStore
  window.DataStore = {
    getData: vi.fn().mockReturnValue({}),
    saveImmediate: vi.fn().mockResolvedValue(true)
  }
  // Mock Stats
  window.Stats = {
    increment: vi.fn().mockResolvedValue(true)
  }
  // Mock StudyRoom
  window.StudyRoom = {
    isInRoom: vi.fn().mockReturnValue(false),
    uploadSession: vi.fn()
  }
  require('../../src/scripts/modules/stopwatch')
  window.Stopwatch.init(
    {
      timeDisplay: document.getElementById('timer-display'),
      startBtn: document.getElementById('timer-start-btn'),
      progressCircle: document.getElementById('timer-progress-circle')
    },
    {
      onStart: vi.fn(),
      onReset: vi.fn()
    }
  )
  // 确保 stopwatch 处于初始状态
  window.StudyRoom.isInRoom.mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Stopwatch 模块', () => {
  it('init 后 isRunning 应为 false', () => {
    expect(window.Stopwatch.getIsRunning()).toBe(false)
  })

  it('init 后 elapsedSeconds 应为 0', () => {
    expect(window.Stopwatch.getElapsedSeconds()).toBe(0)
  })

  it('init 后按钮文字应为"开始"', () => {
    expect(document.getElementById('timer-start-btn').textContent).toBe('开始')
  })

  it('init 后状态文字应为"准备开始计时"', () => {
    expect(document.getElementById('timer-status').textContent).toBe('准备开始计时')
  })

  it('init 应更新显示', () => {
    document.getElementById('timer-display').textContent = 'old'
    window.Stopwatch.init(
      {
        timeDisplay: document.getElementById('timer-display'),
        startBtn: document.getElementById('timer-start-btn'),
        progressCircle: document.getElementById('timer-progress-circle')
      },
      {}
    )
    expect(document.getElementById('timer-display').textContent).toBe('0:00')
  })

  it('display 为空时不应报错', () => {
    expect(() => window.Stopwatch.init({}, {})).not.toThrow()
  })

  it('start 应切换到运行状态', () => {
    window.Stopwatch.start()
    expect(window.Stopwatch.getIsRunning()).toBe(true)
    expect(document.getElementById('timer-start-btn').textContent).toBe('暂停')
    expect(document.getElementById('timer-status').textContent).toBe('正在计时...')
  })

  it('start 在运行中再次调用应无效果', () => {
    window.Stopwatch.start()
    const id1 = window.Stopwatch.getIsRunning()
    window.Stopwatch.start()
    expect(id1).toBe(true)
  })

  it('pause 应暂停计时', () => {
    window.Stopwatch.start()
    window.Stopwatch.pause()
    expect(window.Stopwatch.getIsRunning()).toBe(false)
    expect(document.getElementById('timer-start-btn').textContent).toBe('继续')
    expect(document.getElementById('timer-status').textContent).toBe('已暂停')
  })

  it('pause 在未运行时调用应无效果', () => {
    window.Stopwatch.pause()
    expect(window.Stopwatch.getIsRunning()).toBe(false)
  })

  it('toggle 在未运行时应开始', () => {
    window.Stopwatch.toggle()
    expect(window.Stopwatch.getIsRunning()).toBe(true)
  })

  it('toggle 在运行时应暂停', () => {
    window.Stopwatch.start()
    window.Stopwatch.toggle()
    expect(window.Stopwatch.getIsRunning()).toBe(false)
  })

  it('reset 应重置状态', () => {
    window.Stopwatch.start()
    window.Stopwatch.reset()
    expect(window.Stopwatch.getIsRunning()).toBe(false)
    expect(window.Stopwatch.getElapsedSeconds()).toBe(0)
    expect(document.getElementById('timer-start-btn').textContent).toBe('开始')
    expect(document.getElementById('timer-status').textContent).toBe('准备开始计时')
  })

  it('reset 应触发 onReset 回调', () => {
    const onReset = vi.fn()
    window.Stopwatch.init(
      {
        timeDisplay: document.getElementById('timer-display'),
        startBtn: document.getElementById('timer-start-btn'),
        progressCircle: document.getElementById('timer-progress-circle')
      },
      { onReset }
    )
    window.Stopwatch.reset()
    expect(onReset).toHaveBeenCalled()
  })

  it('reset 应清空 timer-note-text', () => {
    document.getElementById('timer-note-text').textContent = 'some note'
    window.Stopwatch.reset()
    expect(document.getElementById('timer-note-text').textContent).toBe('')
  })

  it('reset 应清空 DataStore 中的 stopwatchModeNote', () => {
    const data = { stopwatchModeNote: 'old note' }
    window.DataStore.getData.mockReturnValue(data)
    window.Stopwatch.reset()
    expect(data.stopwatchModeNote).toBe('')
    expect(window.DataStore.saveImmediate).toHaveBeenCalled()
  })

  it('reset 时 elapsed 大于 1 分钟应记录统计', () => {
    vi.useFakeTimers()
    window.Stopwatch.start()
    // 推进 65 秒（65000ms）
    vi.advanceTimersByTime(65000)
    // 这时 elapsedSeconds 应大于 60
    expect(window.Stopwatch.getElapsedSeconds()).toBeGreaterThanOrEqual(60)
    // reset 应触发 Stats.increment
    window.Stopwatch.reset()
    expect(window.Stats.increment).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(String),
      false
    )
    vi.useRealTimers()
  })

  it('reset 时 elapsed 小于 1 分钟不应记录统计', () => {
    vi.useFakeTimers()
    window.Stopwatch.start()
    vi.advanceTimersByTime(30000)  // 30 秒
    window.Stopwatch.reset()
    expect(window.Stats.increment).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('reset 时应使用 timer-note-text 中的备注', () => {
    vi.useFakeTimers()
    document.getElementById('timer-note-text').textContent = '专注记录'
    window.Stopwatch.start()
    vi.advanceTimersByTime(65000)
    window.Stopwatch.reset()
    expect(window.Stats.increment).toHaveBeenCalledWith(
      expect.any(Number),
      '专注记录',
      false
    )
    vi.useRealTimers()
  })

  it('reset 时无备注应使用 setNote 的值', () => {
    vi.useFakeTimers()
    document.getElementById('timer-note-text').textContent = ''
    window.Stopwatch.setNote('我的备注')
    window.Stopwatch.start()
    vi.advanceTimersByTime(65000)
    window.Stopwatch.reset()
    expect(window.Stats.increment).toHaveBeenCalledWith(
      expect.any(Number),
      '我的备注',
      false
    )
    vi.useRealTimers()
  })

  it('reset 时无备注无 setNote 应使用"正向计时"', () => {
    vi.useFakeTimers()
    document.getElementById('timer-note-text').textContent = ''
    window.Stopwatch.setNote('')
    window.Stopwatch.start()
    vi.advanceTimersByTime(65000)
    window.Stopwatch.reset()
    expect(window.Stats.increment).toHaveBeenCalledWith(
      expect.any(Number),
      '正向计时',
      false
    )
    vi.useRealTimers()
  })

  it('reset 时如在自习室中应上传会话', () => {
    vi.useFakeTimers()
    window.StudyRoom.isInRoom.mockReturnValue(true)
    window.Stopwatch.start()
    vi.advanceTimersByTime(65000)
    window.Stopwatch.reset()
    expect(window.StudyRoom.uploadSession).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('start 后 elapsedSeconds 应随时间增加', () => {
    vi.useFakeTimers()
    window.Stopwatch.start()
    expect(window.Stopwatch.getElapsedSeconds()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(window.Stopwatch.getElapsedSeconds()).toBeGreaterThanOrEqual(1)
    vi.advanceTimersByTime(4000)
    expect(window.Stopwatch.getElapsedSeconds()).toBeGreaterThanOrEqual(5)
    window.Stopwatch.reset()
    vi.useRealTimers()
  })

  it('pause + start 应从原 elapsed 继续', () => {
    vi.useFakeTimers()
    window.Stopwatch.start()
    vi.advanceTimersByTime(3000)
    const elapsed1 = window.Stopwatch.getElapsedSeconds()
    window.Stopwatch.pause()
    vi.advanceTimersByTime(5000)
    // 仍然保持原来的 elapsed
    expect(window.Stopwatch.getElapsedSeconds()).toBe(elapsed1)
    window.Stopwatch.start()
    vi.advanceTimersByTime(2000)
    expect(window.Stopwatch.getElapsedSeconds()).toBeGreaterThanOrEqual(elapsed1 + 2)
    window.Stopwatch.reset()
    vi.useRealTimers()
  })

  it('setNote / getNote 应正确读写', () => {
    window.Stopwatch.setNote('test note')
    expect(window.Stopwatch.getNote()).toBe('test note')
  })

  it('display 应正确格式化为 M:SS', () => {
    vi.useFakeTimers()
    window.Stopwatch.start()
    vi.advanceTimersByTime(65000)  // 65 秒 = 1:05
    expect(document.getElementById('timer-display').textContent).toBe('1:05')
    window.Stopwatch.reset()
    vi.useRealTimers()
  })

  it('display 超过 1 小时应使用 H:MM:SS 格式', () => {
    vi.useFakeTimers()
    window.Stopwatch.start()
    vi.advanceTimersByTime(3600 * 1000 + 5000)  // 1 小时 5 秒
    expect(document.getElementById('timer-display').textContent).toBe('1:00:05')
    window.Stopwatch.reset()
    vi.useRealTimers()
  })

  it('progressCircle 应在 start 时设置 strokeDasharray', () => {
    window.Stopwatch.start()
    const circle = document.getElementById('timer-progress-circle')
    expect(circle.style.strokeDasharray).toBe('728')
    window.Stopwatch.reset()
  })

  it('progressCircle 在 start 且 elapsedTime=0 时应归零', () => {
    window.Stopwatch.start()
    const circle = document.getElementById('timer-progress-circle')
    expect(circle.style.strokeDashoffset).toBe('728')
    window.Stopwatch.reset()
  })

  it('reset 后 progressCircle 应被 updateDisplay 覆盖为空圈（elapsed=0）', () => {
    window.Stopwatch.start()
    window.Stopwatch.reset()
    const circle = document.getElementById('timer-progress-circle')
    // reset 先设 '0'（满圈），但随后 updateDisplay() 以 elapsed=0 覆盖为 '728'（空圈）
    expect(circle.style.strokeDashoffset).toBe('728')
  })

  it('progressCircle 随时间填充', () => {
    vi.useFakeTimers()
    window.Stopwatch.start()
    vi.advanceTimersByTime(1800 * 1000)  // 30 分钟 = 半圈
    const circle = document.getElementById('timer-progress-circle')
    const offset = parseFloat(circle.style.strokeDashoffset)
    // 30 分钟 = 50% 进度，offset 应为 728 * (1 - 0.5) = 364
    expect(offset).toBeLessThan(728)
    expect(offset).toBeGreaterThan(0)
    window.Stopwatch.reset()
    vi.useRealTimers()
  })

  it('progressCircle 超过 60 分钟应限制为满圈', () => {
    vi.useFakeTimers()
    window.Stopwatch.start()
    vi.advanceTimersByTime(3700 * 1000)  // >60 分钟
    const circle = document.getElementById('timer-progress-circle')
    const offset = parseFloat(circle.style.strokeDashoffset)
    expect(offset).toBe(0)  // 满圈
    window.Stopwatch.reset()
    vi.useRealTimers()
  })
})
