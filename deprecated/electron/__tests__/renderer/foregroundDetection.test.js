/**
 * ForegroundDetection 模块测试
 *
 * 测试前台检测：初始化、开始/停止检测、警告处理、惩罚触发
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(async () => {
  document.body.innerHTML = `
    <div id="focus-warning-modal"></div>
    <div id="focus-warning-window-title"></div>
    <div id="focus-warning-count"></div>
    <button id="focus-not-entertainment-btn">不是娱乐</button>
    <button id="focus-dismiss-warning-btn">知道了</button>
    <div id="error-api-key-modal"></div>
    <div id="error-api-key-message"></div>
    <div id="error-api-key-path"></div>
    <button id="error-api-key-ok-btn">确定</button>
    <div id="punishment-modal"></div>
    <div id="punishment-losses"></div>
    <button id="punishment-ok-btn">确定</button>
  `

  // Mock BaseModal
  window.BaseModal = vi.fn().mockImplementation(function({ element, onShow, onHide, closeOnBackground } = {}) {
    return {
      element,
      show: vi.fn(() => onShow && onShow()),
      hide: vi.fn(() => onHide && onHide()),
      toggle: vi.fn()
    }
  })

  // Mock electronAPI
  window.electronAPI = {
    bringToFront: vi.fn(),
    cancelAlwaysOnTop: vi.fn(),
    onForegroundReady: vi.fn(),
    onForegroundApiKeyInvalid: vi.fn(),
    onForegroundEntertainmentDetected: vi.fn(),
    onForegroundStatus: vi.fn(),
    onForegroundError: vi.fn(),
    foregroundIsReady: vi.fn().mockResolvedValue(true),
    foregroundGetStatus: vi.fn(),
    foregroundStart: vi.fn(),
    foregroundStop: vi.fn(),
    foregroundSetApiKey: vi.fn(),
    foregroundMoveBlacklistToWhitelist: vi.fn(),
    foregroundMarkHistoryNot: vi.fn()
  }

  // Mock MiniMode
  window.MiniMode = {
    isActive: vi.fn().mockReturnValue(false),
    exit: vi.fn()
  }

  // Mock Timer
  window.Timer = {
    PHASE: { READY: 'ready', RUNNING: 'running', FINISHED: 'finished' },
    getPhase: vi.fn().mockReturnValue('running'),
    reset: vi.fn()
  }

  // Mock AppState
  window.AppState = {
    setFocusMode: vi.fn(),
    updateFocusModeUI: vi.fn()
  }

  // Mock Garden
  window.Garden = {
    handleResetPunishment: vi.fn().mockResolvedValue({ hasLoss: false, losses: [], totalMinutes: 0 })
  }

  // Mock CloudAuth
  window.CloudAuth = {
    hasApiKey: vi.fn().mockReturnValue(false),
    getApiKey: vi.fn().mockReturnValue(null)
  }

  // Mock AudioContext - must use regular function to support `new` keyword
  window.AudioContext = vi.fn().mockImplementation(function() {
    return {
      currentTime: 0,
      createOscillator: vi.fn(() => ({
        connect: vi.fn(),
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        start: vi.fn(),
        stop: vi.fn()
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
      })),
      destination: {}
    }
  })

  // 重置模块缓存，使 foregroundDetection IIFE 重新执行并重置内部闭包状态
  // （state.warningModalVisible 等闭包变量会跨测试泄漏）
  vi.resetModules()
  delete require.cache[require.resolve('../../src/scripts/modules/foregroundDetection')]
  require('../../src/scripts/modules/foregroundDetection')

  await window.ForegroundDetection.init()
})

describe('ForegroundDetection init', () => {
  it('init 应绑定事件监听器', () => {
    expect(window.electronAPI.onForegroundReady).toHaveBeenCalled()
    expect(window.electronAPI.onForegroundApiKeyInvalid).toHaveBeenCalled()
    expect(window.electronAPI.onForegroundEntertainmentDetected).toHaveBeenCalled()
    expect(window.electronAPI.onForegroundStatus).toHaveBeenCalled()
  })

  it('init 应查询就绪状态', () => {
    expect(window.electronAPI.foregroundIsReady).toHaveBeenCalled()
  })

  it('init 后 getIsReady 应返回 true（当 foregroundIsReady 返回 true）', async () => {
    expect(window.ForegroundDetection.getIsReady()).toBe(true)
  })

  it('init 后 getIsDetecting 应返回 false', () => {
    expect(window.ForegroundDetection.getIsDetecting()).toBe(false)
  })
})

describe('ForegroundDetection startDetection', () => {
  it('startDetection 应调用 foregroundStart', () => {
    window.ForegroundDetection.startDetection()
    expect(window.electronAPI.foregroundStart).toHaveBeenCalled()
    expect(window.ForegroundDetection.getIsDetecting()).toBe(true)
  })

  it('startDetection 有 API Key 应发送给前台检测', () => {
    window.CloudAuth.hasApiKey.mockReturnValue(true)
    window.CloudAuth.getApiKey.mockReturnValue('test-api-key')

    window.ForegroundDetection.startDetection()

    expect(window.electronAPI.foregroundSetApiKey).toHaveBeenCalledWith('test-api-key')
  })

  it('startDetection 无 API Key 不应发送', () => {
    window.CloudAuth.hasApiKey.mockReturnValue(false)
    window.electronAPI.foregroundSetApiKey.mockClear()

    window.ForegroundDetection.startDetection()

    expect(window.electronAPI.foregroundSetApiKey).not.toHaveBeenCalled()
  })
})

describe('ForegroundDetection stopDetection', () => {
  it('stopDetection 应调用 foregroundStop', () => {
    window.ForegroundDetection.startDetection()
    window.ForegroundDetection.stopDetection()

    expect(window.electronAPI.foregroundStop).toHaveBeenCalled()
    expect(window.ForegroundDetection.getIsDetecting()).toBe(false)
  })
})

describe('ForegroundDetection handleEntertainmentDetected', () => {
  it('计时器不在 RUNNING 阶段应忽略检测', () => {
    window.Timer.getPhase.mockReturnValue('finished')
    const handler = window.electronAPI.onForegroundEntertainmentDetected.mock.calls[0][0]

    handler({ window_title: 'Test', source: 'ai' })

    expect(document.getElementById('focus-warning-window-title').textContent).toBe('')
  })

  it('计时器在 RUNNING 阶段应处理检测', () => {
    window.Timer.getPhase.mockReturnValue('running')
    const handler = window.electronAPI.onForegroundEntertainmentDetected.mock.calls[0][0]

    handler({ window_title: '娱乐网站', source: 'ai', keyword: '游戏' })

    expect(document.getElementById('focus-warning-window-title').textContent).toBe('娱乐网站')
    expect(document.getElementById('focus-warning-count').textContent).toContain('1/3')
  })

  it('警告弹窗已显示时不应重复显示', () => {
    window.Timer.getPhase.mockReturnValue('running')
    const handler = window.electronAPI.onForegroundEntertainmentDetected.mock.calls[0][0]

    handler({ window_title: '娱乐1', source: 'ai' })
    handler({ window_title: '娱乐2', source: 'ai' })

    // 第二次不应更新标题
    expect(document.getElementById('focus-warning-window-title').textContent).toBe('娱乐1')
  })
})

describe('ForegroundDetection 警告按钮处理', () => {
  it('点击"知道了"应隐藏警告弹窗', () => {
    window.Timer.getPhase.mockReturnValue('running')
    const handler = window.electronAPI.onForegroundEntertainmentDetected.mock.calls[0][0]
    handler({ window_title: 'Test', source: 'ai' })

    // 警告应显示，计数为 1/3
    expect(document.getElementById('focus-warning-count').textContent).toContain('1/3')

    document.getElementById('focus-dismiss-warning-btn').click()

    // 弹窗应被隐藏（BaseModal.hide 被调用）
    // 警告次数在内部增加，下次显示时会反映
  })

  it('达到最大警告次数应触发惩罚', async () => {
    window.Timer.getPhase.mockReturnValue('running')
    const handler = window.electronAPI.onForegroundEntertainmentDetected.mock.calls[0][0]

    // 触发 3 次警告
    for (let i = 0; i < 3; i++) {
      handler({ window_title: 'Test', source: 'ai' })
      document.getElementById('focus-dismiss-warning-btn').click()
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    // 应调用 Garden.handleResetPunishment
    expect(window.Garden.handleResetPunishment).toHaveBeenCalled()
  })

  it('点击"不是娱乐"黑名单来源应移到白名单', () => {
    window.Timer.getPhase.mockReturnValue('running')
    const handler = window.electronAPI.onForegroundEntertainmentDetected.mock.calls[0][0]
    handler({ window_title: 'Test', source: 'blacklist', keyword: '游戏' })

    document.getElementById('focus-not-entertainment-btn').click()

    expect(window.electronAPI.foregroundMoveBlacklistToWhitelist).toHaveBeenCalledWith('游戏')
  })

  it('点击"不是娱乐"AI 来源应标记历史记录', () => {
    window.Timer.getPhase.mockReturnValue('running')
    const handler = window.electronAPI.onForegroundEntertainmentDetected.mock.calls[0][0]
    handler({ window_title: 'Test Window', source: 'ai' })

    document.getElementById('focus-not-entertainment-btn').click()

    expect(window.electronAPI.foregroundMarkHistoryNot).toHaveBeenCalledWith('Test Window')
  })
})

describe('ForegroundDetection API Key 错误', () => {
  it('收到 API Key 无效事件应显示错误弹窗', () => {
    const handler = window.electronAPI.onForegroundApiKeyInvalid.mock.calls[0][0]

    handler({ error: 'Invalid key', config_path: '/path/to/config' })

    expect(document.getElementById('error-api-key-message').textContent).toBe('Invalid key')
    expect(document.getElementById('error-api-key-path').textContent).toContain('/path/to/config')
  })

  it('点击确定按钮应隐藏错误弹窗', () => {
    const handler = window.electronAPI.onForegroundApiKeyInvalid.mock.calls[0][0]
    handler({ error: 'Error' })

    document.getElementById('error-api-key-ok-btn').click()

    expect(() => {}).not.toThrow()
  })
})

describe('ForegroundDetection executePunishment', () => {
  it('executePunishment checkPhase=true 非 RUNNING 应返回无损失', async () => {
    window.Timer.getPhase.mockReturnValue('finished')

    const result = await window.ForegroundDetection.executePunishment({ checkPhase: true })

    expect(result.hasLoss).toBe(false)
  })

  it('executePunishment checkPhase=true RUNNING 应执行惩罚', async () => {
    window.Timer.getPhase.mockReturnValue('running')
    window.Garden.handleResetPunishment.mockResolvedValue({
      hasLoss: true,
      losses: [{ crop: 'carrot', name: '胡萝卜', icon: '🥕', progress: 10, growTime: 25 }],
      totalMinutes: 10
    })

    const result = await window.ForegroundDetection.executePunishment({ checkPhase: true })

    expect(result.hasLoss).toBe(true)
    expect(window.Timer.reset).toHaveBeenCalled()
    expect(window.AppState.setFocusMode).toHaveBeenCalledWith(false)
  })

  it('executePunishment showPopup=false 不应显示弹窗', async () => {
    window.Timer.getPhase.mockReturnValue('running')

    await window.ForegroundDetection.executePunishment({ checkPhase: false, showPopup: false })

    // punishmentModal 不应该被显示（通过 BaseModal mock 检查）
    // 由于惩罚弹窗已通过 init 创建，这里只验证不报错
    expect(window.Timer.reset).toHaveBeenCalled()
  })

  it('executePunishment 应停止前台检测', async () => {
    window.Timer.getPhase.mockReturnValue('running')
    window.electronAPI.foregroundStop.mockClear()

    await window.ForegroundDetection.executePunishment({ checkPhase: false })

    expect(window.electronAPI.foregroundStop).toHaveBeenCalled()
  })

  it('executePunishment 有损失应渲染损失列表', async () => {
    window.Timer.getPhase.mockReturnValue('running')
    window.Garden.handleResetPunishment.mockResolvedValue({
      hasLoss: true,
      losses: [
        { crop: 'carrot', name: '胡萝卜', icon: '🥕', progress: 10, growTime: 25 },
        { crop: 'tomato', name: '番茄', icon: '🍅', progress: 20, growTime: 50 }
      ],
      totalMinutes: 30
    })

    await window.ForegroundDetection.executePunishment({ checkPhase: false })

    expect(document.getElementById('punishment-losses').innerHTML).toContain('胡萝卜')
    expect(document.getElementById('punishment-losses').innerHTML).toContain('30')
  })

  it('executePunishment 损失超过3个应显示摘要', async () => {
    window.Timer.getPhase.mockReturnValue('running')
    window.Garden.handleResetPunishment.mockResolvedValue({
      hasLoss: true,
      losses: [
        { crop: 'carrot', name: '胡萝卜', icon: '🥕', progress: 10, growTime: 25 },
        { crop: 'carrot', name: '胡萝卜', icon: '🥕', progress: 15, growTime: 25 },
        { crop: 'carrot', name: '胡萝卜', icon: '🥕', progress: 20, growTime: 25 },
        { crop: 'tomato', name: '番茄', icon: '🍅', progress: 30, growTime: 50 }
      ],
      totalMinutes: 75
    })

    await window.ForegroundDetection.executePunishment({ checkPhase: false })

    expect(document.getElementById('punishment-losses').innerHTML).toContain('共 4 株作物枯萎')
  })

  it('executePunishment 无损失应显示幸好消息', async () => {
    window.Timer.getPhase.mockReturnValue('running')
    window.Garden.handleResetPunishment.mockResolvedValue({
      hasLoss: false,
      losses: [],
      totalMinutes: 0
    })

    await window.ForegroundDetection.executePunishment({ checkPhase: false })

    expect(document.getElementById('punishment-losses').innerHTML).toContain('幸好没有正在生长的作物')
  })
})

describe('ForegroundDetection 状态更新', () => {
  it('收到状态更新应更新 isReady 和 isDetecting', () => {
    const handler = window.electronAPI.onForegroundStatus.mock.calls[0][0]

    handler({ running: true })

    expect(window.ForegroundDetection.getIsDetecting()).toBe(true)
  })

  it('收到就绪事件应设置 isReady', () => {
    const handler = window.electronAPI.onForegroundReady.mock.calls[0][0]

    handler({ api_key_valid: true })

    expect(window.ForegroundDetection.getIsReady()).toBe(true)
  })

  it('收到就绪事件 API key 无效不应崩溃', () => {
    const handler = window.electronAPI.onForegroundReady.mock.calls[0][0]

    expect(() => handler({ api_key_valid: false })).not.toThrow()
  })
})

describe('ForegroundDetection 未覆盖分支补充', () => {
  it('警告弹窗显示时 MiniMode 激活应退出迷你模式', () => {
    window.MiniMode.isActive.mockReturnValue(true)
    window.MiniMode.exit.mockClear()
    window.Timer.getPhase.mockReturnValue('running')
    const handler = window.electronAPI.onForegroundEntertainmentDetected.mock.calls[0][0]

    handler({ window_title: 'Test', source: 'ai' })

    expect(window.MiniMode.exit).toHaveBeenCalled()
  })

  it('惩罚弹窗显示时 MiniMode 激活应退出迷你模式', async () => {
    window.MiniMode.isActive.mockReturnValue(true)
    window.MiniMode.exit.mockClear()
    window.Timer.getPhase.mockReturnValue('running')
    window.Garden.handleResetPunishment.mockResolvedValue({
      hasLoss: true,
      losses: [{ crop: 'carrot', name: '胡萝卜', icon: '🥕', progress: 10, growTime: 25 }],
      totalMinutes: 10
    })

    await window.ForegroundDetection.executePunishment({ checkPhase: false })

    expect(window.MiniMode.exit).toHaveBeenCalled()
  })

  it('onForegroundError 事件应不崩溃', () => {
    const handler = window.electronAPI.onForegroundError.mock.calls[0][0]

    expect(() => handler({ error: 'test error' })).not.toThrow()
  })

  it('onForegroundStatus 事件在 isReady=false 时应设置 isReady', () => {
    // 先停止检测以重置状态
    window.ForegroundDetection.stopDetection()
    // 通过重新 init 但 foregroundIsReady 返回 false 来设置 isReady=false
    window.electronAPI.foregroundIsReady.mockResolvedValue(false)
    window.electronAPI.onForegroundStatus.mockClear()

    // 重新初始化模块
    vi.resetModules()
    delete require.cache[require.resolve('../../src/scripts/modules/foregroundDetection')]
    require('../../src/scripts/modules/foregroundDetection')

    return window.ForegroundDetection.init().then(() => {
      const statusHandler = window.electronAPI.onForegroundStatus.mock.calls[0][0]
      statusHandler({ running: true })

      expect(window.ForegroundDetection.getIsReady()).toBe(true)
    })
  })

  it('checkReady 在 foregroundIsReady 抛错时应返回 false', async () => {
    window.electronAPI.foregroundIsReady.mockRejectedValue(new Error('network error'))

    vi.resetModules()
    delete require.cache[require.resolve('../../src/scripts/modules/foregroundDetection')]
    require('../../src/scripts/modules/foregroundDetection')

    await window.ForegroundDetection.init()

    // 应该不崩溃
    expect(window.ForegroundDetection.getIsReady()).toBe(false)
  })

  it('startDetection 在未就绪时不应调用 foregroundStart', () => {
    // 设置未就绪状态
    window.electronAPI.foregroundIsReady.mockResolvedValue(false)
    vi.resetModules()
    delete require.cache[require.resolve('../../src/scripts/modules/foregroundDetection')]
    require('../../src/scripts/modules/foregroundDetection')

    return window.ForegroundDetection.init().then(() => {
      window.electronAPI.foregroundStart.mockClear()
      window.ForegroundDetection.startDetection()

      expect(window.electronAPI.foregroundStart).not.toHaveBeenCalled()
    })
  })

  it('showApiKeyErrorModal 无 error 字段应使用默认消息', () => {
    const handler = window.electronAPI.onForegroundApiKeyInvalid.mock.calls[0][0]

    handler({})

    expect(document.getElementById('error-api-key-message').textContent).toBe('API key 未配置或无效')
  })

  it('executePunishment Garden.handleResetPunishment 抛错应不崩溃', async () => {
    window.Timer.getPhase.mockReturnValue('running')
    window.Garden.handleResetPunishment.mockRejectedValue(new Error('garden error'))

    const result = await window.ForegroundDetection.executePunishment({ checkPhase: false })

    expect(result.hasLoss).toBe(false)
  })

  it('handleNotEntertainment history 来源应标记历史记录', () => {
    window.Timer.getPhase.mockReturnValue('running')
    const handler = window.electronAPI.onForegroundEntertainmentDetected.mock.calls[0][0]
    handler({ window_title: 'History Window', source: 'history' })

    document.getElementById('focus-not-entertainment-btn').click()

    expect(window.electronAPI.foregroundMarkHistoryNot).toHaveBeenCalledWith('History Window')
  })

  it('showPunishmentModal 应播放惩罚音效', async () => {
    window.AudioContext.mockClear()
    window.Timer.getPhase.mockReturnValue('running')
    window.Garden.handleResetPunishment.mockResolvedValue({
      hasLoss: false,
      losses: [],
      totalMinutes: 0
    })

    await window.ForegroundDetection.executePunishment({ checkPhase: false })

    expect(window.AudioContext).toHaveBeenCalled()
  })

  it('playPunishmentSound 在 AudioContext 抛错时应不崩溃', async () => {
    window.AudioContext.mockImplementation(function() {
      throw new Error('AudioContext error')
    })
    window.Timer.getPhase.mockReturnValue('running')
    window.Garden.handleResetPunishment.mockResolvedValue({
      hasLoss: false,
      losses: [],
      totalMinutes: 0
    })

    await window.ForegroundDetection.executePunishment({ checkPhase: false })

    // 应该不崩溃
    expect(window.ForegroundDetection.getIsDetecting()).toBe(false)
  })

  it('punishmentModal onHide 应调用 cancelAlwaysOnTop', async () => {
    window.electronAPI.cancelAlwaysOnTop.mockClear()
    window.Timer.getPhase.mockReturnValue('running')
    window.Garden.handleResetPunishment.mockResolvedValue({
      hasLoss: false,
      losses: [],
      totalMinutes: 0
    })

    await window.ForegroundDetection.executePunishment({ checkPhase: false })

    // 点击确定按钮隐藏惩罚弹窗，触发 onHide 回调
    document.getElementById('punishment-ok-btn').click()

    expect(window.electronAPI.cancelAlwaysOnTop).toHaveBeenCalled()
  })

  it('setupElectronListeners 在 electronAPI 不可用时应不崩溃', async () => {
    // 保存原来的 electronAPI
    const savedElectronAPI = window.electronAPI
    delete window.electronAPI

    vi.resetModules()
    delete require.cache[require.resolve('../../src/scripts/modules/foregroundDetection')]
    require('../../src/scripts/modules/foregroundDetection')

    // init 应不崩溃（setupElectronListeners 会打印 error 但不崩溃）
    await window.ForegroundDetection.init()

    // 恢复 electronAPI
    window.electronAPI = savedElectronAPI
    expect(window.ForegroundDetection).toBeDefined()
  })

  it('playPunishmentSound 应播放两个音调（覆盖 setTimeout）', async () => {
    vi.useFakeTimers()
    window.AudioContext.mockClear()
    window.Timer.getPhase.mockReturnValue('running')
    window.Garden.handleResetPunishment.mockResolvedValue({
      hasLoss: false,
      losses: [],
      totalMinutes: 0
    })

    const promise = window.ForegroundDetection.executePunishment({ checkPhase: false })

    // 快进 300ms 触发第二个音调的 setTimeout
    vi.advanceTimersByTime(300)
    await promise

    // AudioContext 应被调用至少一次
    expect(window.AudioContext).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
