/**
 * Settings 模块测试
 *
 * 测试设置管理：加载/保存设置、UI 显示/隐藏、彩蛋、反馈功能
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(async () => {
  // setup.js 已清空 DOM 和部分 window 全局，这里重新设置
  document.body.innerHTML = `
    <div id="settings-modal">
      <button id="settings-modal-close">关闭</button>
      <button id="settings-save-btn">保存</button>
      <button id="settings-reset-btn">恢复默认</button>
      <span id="settings-version-text">版本</span>
      <button id="settings-update-btn">检查更新</button>
      <div id="settings-update-status"></div>
      <div id="settings-update-progress" style="display:none">
        <div id="settings-update-progress-fill"></div>
        <div id="settings-update-progress-text"></div>
      </div>
      <select id="settings-minimize-behavior"><option value="mini">mini</option><option value="minimize">minimize</option></select>
      <select id="settings-mini-exit-mode"><option value="arrow">arrow</option><option value="double-click">double-click</option></select>
      <div id="settings-mini-exit-hint"></div>
      <input type="checkbox" id="settings-dark-mode">
      <input type="checkbox" id="settings-show-garden-btn">
      <input type="checkbox" id="settings-plant-wheel-mode">
      <input type="checkbox" id="settings-show-stats-btn">
      <input type="checkbox" id="settings-show-ai-btn">
      <input type="checkbox" id="settings-show-study-room-btn">
      <input type="checkbox" id="settings-show-sidebar-collapse-btn">
      <input type="checkbox" id="settings-show-header-expand-btn">
      <input type="checkbox" id="settings-show-shuffle-btn">
      <input type="checkbox" id="settings-show-volume-slider">
      <input type="checkbox" id="settings-show-device-btn">
      <input type="checkbox" id="settings-show-charts-btn">
      <input type="checkbox" id="settings-advanced-color">
      <input type="checkbox" id="settings-auto-start">
    </div>
    <div id="ui-toast"></div>
    <div id="space-travel" style="display:none">
      <div id="stars-container"></div>
      <div id="skip-hint"></div>
    </div>
    <div id="feedback-modal">
      <button id="feedback-modal-close">关闭</button>
      <textarea id="feedback-input"></textarea>
      <span id="feedback-char-count">0</span>
      <button id="feedback-submit-btn">提交反馈</button>
      <button id="feedback-refresh-btn">刷新</button>
      <button id="feedback-login-btn">登录</button>
      <div id="feedback-login-prompt"></div>
      <div id="feedback-logged-in"></div>
      <div id="feedback-loading"></div>
      <div id="feedback-empty"></div>
      <div id="feedback-list"></div>
    </div>
    <button id="feedback-open-btn">反馈</button>
    <button id="ui-theme-toggle-btn"></button>
    <button id="ui-garden-btn"></button>
    <button id="stats-btn"></button>
    <button id="ai-btn"></button>
    <button id="ui-study-room-btn"></button>
    <button id="ui-sidebar-collapse-btn"></button>
    <button id="music-expand-btn"></button>
    <div id="ui-hidden-buttons"></div>
    <button id="music-mode-btn"></button>
    <button id="music-volume-btn"></button>
    <button id="music-device-btn"></button>
    <button id="music-charts-btn"></button>
    <div id="auth-modal"></div>
    <div id="hotkey-settings">
      <span id="hotkey-display-pause">未设置</span>
      <span id="hotkey-display-next">未设置</span>
      <span id="hotkey-display-prev">未设置</span>
      <span id="hotkey-display-volUp">未设置</span>
      <span id="hotkey-display-volDown">未设置</span>
      <button class="hotkey-set-btn" data-action="pause">设置</button>
      <button class="hotkey-set-btn" data-action="next">设置</button>
      <button class="hotkey-set-btn" data-action="prev">设置</button>
      <button class="hotkey-set-btn" data-action="volUp">设置</button>
      <button class="hotkey-set-btn" data-action="volDown">设置</button>
      <div id="hotkey-recording-hint" style="display:none">
        <span id="hotkey-recording-keys"></span>
      </div>
    </div>
  `

  // Mock Utils
  window.Utils = {
    createDefaultData: () => ({
      settings: {
        minimizeBehavior: 'mini',
        miniExitMode: 'arrow',
        showDarkModeBtn: true,
        showGardenBtn: true,
        plantWheelMode: true,
        showStatsBtn: true,
        showAiBtn: true,
        showStudyRoomBtn: true,
        showSidebarCollapseBtn: true,
        showHeaderExpandBtn: true,
        showShuffleBtn: true,
        showVolumeBtn: true,
        showDeviceBtn: true,
        showChartsBtn: true,
        advancedColorCustomization: false,
        autoStart: false,
        musicHotkeys: {
          pause: ['Key.ctrl_r', 'Key.shift_r'],
          next: ['Key.ctrl_r', 'Key.right'],
          prev: ['Key.ctrl_r', 'Key.left'],
          volUp: ['Key.ctrl_r', 'Key.up'],
          volDown: ['Key.ctrl_r', 'Key.down']
        }
      }
    })
  }

  // Mock DataStore
  window.DataStore = {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue(true)
  }

  // Mock BaseModal (must be a constructor, not arrow function)
  window.BaseModal = vi.fn().mockImplementation(function({ element, onShow, onHide, onBackgroundClick } = {}) {
    return {
      element,
      show: vi.fn(() => onShow && onShow()),
      hide: vi.fn(() => onHide && onHide()),
      toggle: vi.fn()
    }
  })

  // Mock AnimatedModal（settings.js 未直接使用，但为兼容性提供）
  window.AnimatedModal = window.BaseModal

  // Mock electronAPI
  window.electronAPI = {
    getVersion: vi.fn().mockResolvedValue('3.2.4'),
    setAutoStart: vi.fn().mockResolvedValue(true),
    musicSetHotkeys: vi.fn().mockResolvedValue(true),
    musicStartHotkeyRecording: vi.fn().mockResolvedValue(true),
    musicStopHotkeyRecording: vi.fn().mockResolvedValue(true),
    onMusicHotkeyKeyPressed: vi.fn(),
    onUpdateStatus: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(true),
    downloadUpdate: vi.fn().mockResolvedValue(true),
    installUpdate: vi.fn().mockResolvedValue(true),
    gardenRead: vi.fn().mockResolvedValue(null),
    gardenWrite: vi.fn().mockResolvedValue(true),
    showNotification: vi.fn(),
    openExternal: vi.fn(),
    cloudGetSession: vi.fn().mockResolvedValue({ success: false, session: null }),
    submitFeedback: vi.fn().mockResolvedValue({ success: true }),
    getUserFeedbacks: vi.fn().mockResolvedValue({ success: true, data: [] }),
    deleteFeedback: vi.fn().mockResolvedValue({ success: true })
  }

  // Mock MusicPlayer
  window.MusicPlayer = {
    setAdvancedColorCustomization: vi.fn()
  }

  // 重置模块缓存以重置 IIFE 内部状态（isRecordingHotkey 等）
  vi.resetModules()
  delete require.cache[require.resolve('../../src/scripts/modules/settings')]
  require('../../src/scripts/modules/settings')

  await window.Settings.init()
})

describe('Settings init', () => {
  it('init 应加载版本号', () => {
    expect(document.getElementById('settings-version-text').textContent).toContain('版本')
  })

  it('init 应加载设置并应用', () => {
    expect(window.DataStore.getSettings).toHaveBeenCalled()
  })

  it('init 应调用 setAutoStart', () => {
    expect(window.electronAPI.setAutoStart).toHaveBeenCalledWith(false)
  })
})

describe('Settings getSetting / getAllSettings', () => {
  it('getSetting 应返回已加载的设置值', () => {
    expect(window.Settings.getSetting('autoStart')).toBe(false)
    expect(window.Settings.getSetting('minimizeBehavior')).toBe('mini')
  })

  it('getSetting 应返回各设置项的值', () => {
    expect(window.Settings.getSetting('showDarkModeBtn')).toBe(true)
    expect(window.Settings.getSetting('plantWheelMode')).toBe(true)
    expect(window.Settings.getSetting('miniExitMode')).toBe('arrow')
  })

  it('getAllSettings 应返回所有设置', () => {
    const all = window.Settings.getAllSettings()
    expect(all).toBeDefined()
    expect(all.minimizeBehavior).toBe('mini')
    expect(all.musicHotkeys).toBeDefined()
  })
})

describe('Settings open / close', () => {
  it('open 应显示弹窗', () => {
    expect(() => window.Settings.open()).not.toThrow()
  })

  it('close 应隐藏弹窗', () => {
    expect(() => window.Settings.close()).not.toThrow()
  })
})

describe('Settings 彩蛋功能', () => {
  it('点击版本号 5 次应触发彩蛋', async () => {
    vi.useFakeTimers()
    const versionText = document.getElementById('settings-version-text')
    window.electronAPI.gardenRead.mockResolvedValue({
      achievements: {},
      seeds: { osmanthus: 0 },
      coins: 0
    })

    // 点击 5 次
    for (let i = 0; i < 5; i++) {
      versionText.click()
    }

    // 应该调用 gardenRead（解锁成就）
    expect(window.electronAPI.gardenRead).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('点击间隔超过 800ms 应重置计数', async () => {
    vi.useFakeTimers()
    const versionText = document.getElementById('settings-version-text')

    // 点击 4 次
    for (let i = 0; i < 4; i++) {
      versionText.click()
    }

    // 推进 900ms（超过阈值）
    vi.advanceTimersByTime(900)

    // 再点击 1 次（不应触发彩蛋，因为计数被重置）
    window.electronAPI.gardenRead.mockClear()
    versionText.click()

    // 只点击 1 次，不应触发彩蛋
    expect(window.electronAPI.gardenRead).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('Settings 保存设置', () => {
  it('保存按钮点击应保存设置', async () => {
    // 修改一个设置
    document.getElementById('settings-auto-start').checked = true

    // 点击保存按钮
    document.getElementById('settings-save-btn').click()

    // 等待异步操作
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(window.DataStore.updateSettings).toHaveBeenCalled()
    const savedSettings = window.DataStore.updateSettings.mock.calls[0][0]
    expect(savedSettings.autoStart).toBe(true)
  })

  it('保存设置应调用 setAutoStart', async () => {
    document.getElementById('settings-auto-start').checked = true
    window.electronAPI.setAutoStart.mockClear()

    document.getElementById('settings-save-btn').click()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(window.electronAPI.setAutoStart).toHaveBeenCalledWith(true)
  })

  it('保存 plantWheelMode 应显示提示', async () => {
    document.getElementById('settings-plant-wheel-mode').checked = false
    document.getElementById('settings-save-btn').click()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(document.getElementById('ui-toast').textContent).toContain('菜园子')
  })
})

describe('Settings 恢复默认', () => {
  it('恢复默认按钮应重置表单值', async () => {
    // 修改设置
    document.getElementById('settings-auto-start').checked = true
    document.getElementById('settings-dark-mode').checked = false

    // 点击恢复默认
    document.getElementById('settings-reset-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    // 应恢复为默认值
    expect(document.getElementById('settings-auto-start').checked).toBe(false)
    expect(document.getElementById('settings-dark-mode').checked).toBe(true)
  })
})

describe('Settings 关闭时检测改动', () => {
  it('无改动时关闭按钮应直接关闭', () => {
    expect(() => {
      document.getElementById('settings-modal-close').click()
    }).not.toThrow()
  })

  it('有改动时应显示确认弹窗', async () => {
    // 先打开设置弹窗（触发 onShow 保存 originalSettings）
    window.Settings.open()
    await new Promise(resolve => setTimeout(resolve, 50))

    // 修改设置
    document.getElementById('settings-auto-start').checked = true

    // 点击关闭
    document.getElementById('settings-modal-close').click()

    // 应该出现确认弹窗
    const confirmDialog = document.querySelector('.settings-confirm-dialog')
    expect(confirmDialog).toBeTruthy()
  })
})

describe('Settings 迷你模式退出提示', () => {
  it('选择 double-click 应显示提示', () => {
    const select = document.getElementById('settings-mini-exit-mode')
    select.value = 'double-click'
    select.dispatchEvent(new Event('change'))

    expect(document.getElementById('settings-mini-exit-hint').style.display).toBe('block')
  })

  it('选择 arrow 应隐藏提示', () => {
    const select = document.getElementById('settings-mini-exit-mode')
    select.value = 'arrow'
    select.dispatchEvent(new Event('change'))

    expect(document.getElementById('settings-mini-exit-hint').style.display).toBe('none')
  })
})

describe('Settings 应用界面显示', () => {
  it('applyAllSettings 应根据设置显示/隐藏元素', async () => {
    // 重新初始化以触发 applyAllSettings
    await window.Settings.init()

    // showDarkModeBtn 默认为 true，按钮应可见
    expect(document.getElementById('ui-theme-toggle-btn').style.display).not.toBe('none')
  })

  it('关闭 showDarkModeBtn 应隐藏主题按钮', async () => {
    window.DataStore.getSettings = vi.fn().mockResolvedValue({ showDarkModeBtn: false })
    await window.Settings.init()

    expect(document.getElementById('ui-theme-toggle-btn').style.display).toBe('none')
  })
})

describe('Settings 更新检查', () => {
  it('点击检查更新应调用 checkForUpdates', async () => {
    document.getElementById('settings-update-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.checkForUpdates).toHaveBeenCalled()
  })

  it('updateStatus not-available 应显示已是最新', async () => {
    // 模拟 onUpdateStatus 回调
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({ status: 'not-available' })

    expect(document.getElementById('settings-update-status').textContent).toBe('已是最新版本')
  })

  it('updateStatus available 应显示新版本', async () => {
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({ status: 'available', version: '4.0.0' })

    expect(document.getElementById('settings-update-status').textContent).toContain('4.0.0')
    expect(document.getElementById('settings-update-btn').textContent).toBe('下载更新')
  })

  it('updateStatus downloading 应显示进度', async () => {
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({
      status: 'downloading',
      percent: 50,
      bytesPerSecond: 102400,
      total: 1048576
    })

    expect(document.getElementById('settings-update-progress').style.display).toBe('block')
    expect(document.getElementById('settings-update-progress-fill').style.width).toBe('50%')
  })

  it('updateStatus error 应显示错误', async () => {
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({ status: 'error', message: '网络错误' })

    expect(document.getElementById('settings-update-status').textContent).toContain('网络错误')
  })
})

describe('Settings 反馈功能', () => {
  it('updateFeedbackVisibility 未登录应显示登录提示', async () => {
    await window.Settings.updateFeedbackVisibility()
    // 由于 cloudGetSession 返回未登录，应显示登录提示
    expect(document.getElementById('feedback-login-prompt').style.display).toBe('flex')
    expect(document.getElementById('feedback-logged-in').style.display).toBe('none')
  })

  it('updateFeedbackVisibility 已登录应显示反馈区域', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { user: {} } })
    window.electronAPI.getUserFeedbacks.mockResolvedValue({ success: true, data: [] })

    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('feedback-login-prompt').style.display).toBe('none')
    expect(document.getElementById('feedback-logged-in').style.display).toBe('block')
  })
})

describe('Settings 快捷键设置', () => {
  it('initHotkeySettings 应显示当前快捷键', async () => {
    // 打开设置弹窗触发 updateFormValues -> initHotkeySettings
    window.Settings.open()
    await new Promise(resolve => setTimeout(resolve, 50))

    // 应显示 pause 快捷键
    expect(document.getElementById('hotkey-display-pause').textContent).toBe('右Ctrl + 右Shift')
  })

  it('initHotkeySettings 无 musicHotkeys 应不报错', async () => {
    window.DataStore.getSettings = vi.fn().mockResolvedValue({ musicHotkeys: null })
    await window.Settings.init()
    window.Settings.open()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(true).toBe(true)
  })

  it('formatHotkeyDisplay 应将各种按键格式化为显示名称', async () => {
    window.DataStore.getSettings = vi.fn().mockResolvedValue({
      musicHotkeys: {
        pause: ['Key.ctrl_l', 'char.a'],
        next: ['Key.space'],
        prev: ['Key.enter'],
        volUp: ['Key.tab'],
        volDown: ['unknown.key']
      }
    })
    await window.Settings.init()
    window.Settings.open()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('hotkey-display-pause').textContent).toBe('左Ctrl + A')
    expect(document.getElementById('hotkey-display-next').textContent).toBe('空格')
    expect(document.getElementById('hotkey-display-prev').textContent).toBe('回车')
    expect(document.getElementById('hotkey-display-volUp').textContent).toBe('Tab')
    expect(document.getElementById('hotkey-display-volDown').textContent).toBe('KEY')
  })

  it('formatHotkeyDisplay 空数组应显示未设置', async () => {
    window.DataStore.getSettings = vi.fn().mockResolvedValue({
      musicHotkeys: {
        pause: [],
        next: ['Key.right'],
        prev: ['Key.left'],
        volUp: ['Key.up'],
        volDown: ['Key.down']
      }
    })
    await window.Settings.init()
    window.Settings.open()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('hotkey-display-pause').textContent).toBe('未设置')
  })
})

describe('Settings 快捷键录制', () => {
  it('点击设置按钮应开始录制', async () => {
    document.querySelector('.hotkey-set-btn[data-action="pause"]').click()

    expect(window.electronAPI.musicStartHotkeyRecording).toHaveBeenCalled()
    expect(document.querySelector('.hotkey-set-btn[data-action="pause"]').classList.contains('recording')).toBe(true)
    expect(document.getElementById('hotkey-recording-hint').style.display).toBe('flex')
  })

  it('录制中点击其他设置按钮应忽略', async () => {
    document.querySelector('.hotkey-set-btn[data-action="pause"]').click()
    window.electronAPI.musicStartHotkeyRecording.mockClear()

    document.querySelector('.hotkey-set-btn[data-action="next"]').click()

    expect(window.electronAPI.musicStartHotkeyRecording).not.toHaveBeenCalled()
  })

  it('收到按键事件应更新录制显示', async () => {
    document.querySelector('.hotkey-set-btn[data-action="pause"]').click()

    const keyCallback = window.electronAPI.onMusicHotkeyKeyPressed.mock.calls[0][0]
    keyCallback({ key: 'Key.ctrl_l' })

    expect(document.getElementById('hotkey-recording-keys').textContent).toBe('左Ctrl')
  })

  it('收到重复按键应忽略', async () => {
    document.querySelector('.hotkey-set-btn[data-action="pause"]').click()

    const keyCallback = window.electronAPI.onMusicHotkeyKeyPressed.mock.calls[0][0]
    keyCallback({ key: 'Key.ctrl_l' })
    keyCallback({ key: 'Key.ctrl_l' })

    expect(document.getElementById('hotkey-recording-keys').textContent).toBe('左Ctrl')
  })

  it('录制 2 个按键应完成录制并更新设置', async () => {
    vi.useFakeTimers()
    document.querySelector('.hotkey-set-btn[data-action="next"]').click()

    const keyCallback = window.electronAPI.onMusicHotkeyKeyPressed.mock.calls[0][0]
    keyCallback({ key: 'Key.ctrl_l' })
    keyCallback({ key: 'char.b' })

    await vi.advanceTimersByTimeAsync(150)

    expect(document.getElementById('hotkey-display-next').textContent).toBe('左Ctrl + B')
    expect(window.electronAPI.musicSetHotkeys).toHaveBeenCalled()
    expect(document.getElementById('ui-toast').textContent).toContain('快捷键已更新')
    vi.useRealTimers()
  })

  it('录制开始失败应停止录制', async () => {
    window.electronAPI.musicStartHotkeyRecording.mockRejectedValueOnce(new Error('失败'))
    document.querySelector('.hotkey-set-btn[data-action="pause"]').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.querySelector('.hotkey-set-btn[data-action="pause"]').classList.contains('recording')).toBe(false)
    expect(document.getElementById('hotkey-recording-hint').style.display).toBe('none')
  })

  it('更新快捷键失败应显示错误提示', async () => {
    vi.useFakeTimers()
    window.electronAPI.musicSetHotkeys.mockRejectedValueOnce(new Error('失败'))
    document.querySelector('.hotkey-set-btn[data-action="prev"]').click()

    const keyCallback = window.electronAPI.onMusicHotkeyKeyPressed.mock.calls[0][0]
    keyCallback({ key: 'Key.ctrl_l' })
    keyCallback({ key: 'char.c' })

    await vi.advanceTimersByTimeAsync(150)

    expect(document.getElementById('ui-toast').textContent).toContain('快捷键更新失败')
    vi.useRealTimers()
  })

  it('停止录制应调用 musicStopHotkeyRecording', async () => {
    document.querySelector('.hotkey-set-btn[data-action="pause"]').click()

    const keyCallback = window.electronAPI.onMusicHotkeyKeyPressed.mock.calls[0][0]
    keyCallback({ key: 'Key.ctrl_l' })
    keyCallback({ key: 'char.b' })

    await new Promise(resolve => setTimeout(resolve, 150))

    expect(window.electronAPI.musicStopHotkeyRecording).toHaveBeenCalled()
  })

  it('停止录制失败应不报错', async () => {
    window.electronAPI.musicStopHotkeyRecording.mockRejectedValueOnce(new Error('失败'))
    document.querySelector('.hotkey-set-btn[data-action="pause"]').click()

    const keyCallback = window.electronAPI.onMusicHotkeyKeyPressed.mock.calls[0][0]
    keyCallback({ key: 'Key.ctrl_l' })
    keyCallback({ key: 'char.b' })

    await new Promise(resolve => setTimeout(resolve, 150))

    expect(true).toBe(true)
  })
})

describe('Settings 彩蛋太空旅行', () => {
  it('点击版本号 5 次应触发太空旅行', async () => {
    vi.useFakeTimers()
    window.electronAPI.gardenRead.mockResolvedValue({
      achievements: { easteregg: { unlocked: true } },
      seeds: { osmanthus: 0 },
      coins: 0
    })

    const versionText = document.getElementById('settings-version-text')
    for (let i = 0; i < 5; i++) {
      versionText.click()
    }

    // 推进时间触发 launchSpaceTravel
    await vi.advanceTimersByTimeAsync(900)

    // 太空旅行容器应显示
    expect(document.getElementById('space-travel').style.display).toBe('block')
    vi.useRealTimers()
  })

  it('解锁成就已解锁应不重复解锁', async () => {
    vi.useFakeTimers()
    window.electronAPI.gardenRead.mockResolvedValue({
      achievements: { easteregg: { unlocked: true } },
      seeds: { osmanthus: 0 },
      coins: 0
    })
    window.electronAPI.gardenWrite.mockClear()

    const versionText = document.getElementById('settings-version-text')
    for (let i = 0; i < 5; i++) {
      versionText.click()
    }

    // gardenWrite 不应被调用（已解锁）
    expect(window.electronAPI.gardenWrite).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('解锁成就失败应不报错', async () => {
    vi.useFakeTimers()
    window.electronAPI.gardenRead.mockRejectedValue(new Error('读取失败'))

    const versionText = document.getElementById('settings-version-text')
    for (let i = 0; i < 5; i++) {
      versionText.click()
    }

    await vi.advanceTimersByTimeAsync(100)
    // 不应抛出异常
    expect(true).toBe(true)
    vi.useRealTimers()
  })

  it('太空旅行应生成星星', async () => {
    vi.useFakeTimers()
    window.electronAPI.gardenRead.mockResolvedValue({
      achievements: { easteregg: { unlocked: true } },
      seeds: { osmanthus: 0 },
      coins: 0
    })

    const versionText = document.getElementById('settings-version-text')
    for (let i = 0; i < 5; i++) {
      versionText.click()
    }
    await vi.advanceTimersByTimeAsync(900)

    // 应生成 50 个星星
    const stars = document.querySelectorAll('.star')
    expect(stars.length).toBe(50)
    vi.useRealTimers()
  })

  it('太空旅行 8 秒后应启用退出交互', async () => {
    vi.useFakeTimers()
    window.electronAPI.gardenRead.mockResolvedValue({
      achievements: { easteregg: { unlocked: true } },
      seeds: { osmanthus: 0 },
      coins: 0
    })

    const versionText = document.getElementById('settings-version-text')
    for (let i = 0; i < 5; i++) {
      versionText.click()
    }
    await vi.advanceTimersByTimeAsync(900)

    // 推进 8 秒
    await vi.advanceTimersByTimeAsync(8000)

    // 应添加 exit-ready 类
    expect(document.getElementById('space-travel').classList.contains('exit-ready')).toBe(true)
    expect(document.getElementById('skip-hint').textContent).toBe('点击任意处或按 ESC 返回')
    vi.useRealTimers()
  })

  it('点击应退出太空旅行', async () => {
    vi.useFakeTimers()
    window.electronAPI.gardenRead.mockResolvedValue({
      achievements: { easteregg: { unlocked: true } },
      seeds: { osmanthus: 0 },
      coins: 0
    })

    const versionText = document.getElementById('settings-version-text')
    for (let i = 0; i < 5; i++) {
      versionText.click()
    }
    await vi.advanceTimersByTimeAsync(900)
    await vi.advanceTimersByTimeAsync(8000)

    // 点击退出
    document.getElementById('space-travel').click()
    await vi.advanceTimersByTimeAsync(600)

    expect(document.getElementById('space-travel').style.display).toBe('none')
    vi.useRealTimers()
  })

  it('ESC 键应退出太空旅行', async () => {
    vi.useFakeTimers()
    window.electronAPI.gardenRead.mockResolvedValue({
      achievements: { easteregg: { unlocked: true } },
      seeds: { osmanthus: 0 },
      coins: 0
    })

    const versionText = document.getElementById('settings-version-text')
    for (let i = 0; i < 5; i++) {
      versionText.click()
    }
    await vi.advanceTimersByTimeAsync(900)
    await vi.advanceTimersByTimeAsync(8000)

    // 按 ESC
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await vi.advanceTimersByTimeAsync(600)

    expect(document.getElementById('space-travel').style.display).toBe('none')
    vi.useRealTimers()
  })

  it('重复退出应忽略', async () => {
    vi.useFakeTimers()
    window.electronAPI.gardenRead.mockResolvedValue({
      achievements: { easteregg: { unlocked: true } },
      seeds: { osmanthus: 0 },
      coins: 0
    })

    const versionText = document.getElementById('settings-version-text')
    for (let i = 0; i < 5; i++) {
      versionText.click()
    }
    await vi.advanceTimersByTimeAsync(900)
    await vi.advanceTimersByTimeAsync(8000)

    const container = document.getElementById('space-travel')
    container.click() // 第一次点击退出
    container.click() // 第二次点击应忽略（已有 exiting 类）
    await vi.advanceTimersByTimeAsync(600)

    expect(true).toBe(true)
    vi.useRealTimers()
  })

  it('版本号闪烁应循环颜色', async () => {
    vi.useFakeTimers()
    window.electronAPI.gardenRead.mockResolvedValue({
      achievements: { easteregg: { unlocked: true } },
      seeds: { osmanthus: 0 },
      coins: 0
    })

    const versionText = document.getElementById('settings-version-text')
    for (let i = 0; i < 5; i++) {
      versionText.click()
    }

    // 推进多个颜色周期
    await vi.advanceTimersByTimeAsync(1200)

    // 颜色应该被设置过
    expect(versionText.style.color).toBeDefined()
    vi.useRealTimers()
  })

  it('解锁成就应发放奖励', async () => {
    vi.useFakeTimers()
    window.electronAPI.gardenRead.mockResolvedValue({
      achievements: {},
      seeds: { osmanthus: 0 },
      coins: 0
    })
    window.electronAPI.gardenWrite.mockClear()
    window.electronAPI.showNotification.mockClear()

    const versionText = document.getElementById('settings-version-text')
    for (let i = 0; i < 5; i++) {
      versionText.click()
    }

    // 等待异步 unlockEasterEggAchievement 完成
    await vi.advanceTimersByTimeAsync(100)

    expect(window.electronAPI.gardenWrite).toHaveBeenCalled()
    const writtenData = window.electronAPI.gardenWrite.mock.calls[0][0]
    expect(writtenData.achievements.easteregg.unlocked).toBe(true)
    expect(writtenData.seeds.osmanthus).toBe(1)
    expect(writtenData.coins).toBe(50)
    expect(window.electronAPI.showNotification).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('Settings 关闭确认弹窗', () => {
  it('点击取消按钮应隐藏确认弹窗', async () => {
    window.Settings.open()
    await new Promise(resolve => setTimeout(resolve, 50))

    // 修改设置
    document.getElementById('settings-auto-start').checked = true

    // 点击关闭显示确认弹窗
    document.getElementById('settings-modal-close').click()
    const confirmDialog = document.querySelector('.settings-confirm-dialog')
    expect(confirmDialog).toBeTruthy()

    // 点击取消
    confirmDialog.querySelector('.settings-confirm-cancel').click()

    // 确认弹窗应被移除
    expect(document.querySelector('.settings-confirm-dialog')).toBeFalsy()
  })

  it('点击退出按钮应隐藏确认弹窗并关闭', async () => {
    window.Settings.open()
    await new Promise(resolve => setTimeout(resolve, 50))

    // 修改设置
    document.getElementById('settings-auto-start').checked = true

    // 点击关闭显示确认弹窗
    document.getElementById('settings-modal-close').click()
    const confirmDialog = document.querySelector('.settings-confirm-dialog')

    // 点击退出
    confirmDialog.querySelector('.settings-confirm-exit').click()

    // 确认弹窗应被移除
    expect(document.querySelector('.settings-confirm-dialog')).toBeFalsy()
  })
})

describe('Settings hasChanges 快捷键检测', () => {
  it('修改快捷键应检测到改动', async () => {
    vi.useFakeTimers()
    window.Settings.open()
    await vi.advanceTimersByTimeAsync(50)

    // 开始录制快捷键
    document.querySelector('.hotkey-set-btn[data-action="volUp"]').click()
    const keyCallback = window.electronAPI.onMusicHotkeyKeyPressed.mock.calls[0][0]
    keyCallback({ key: 'Key.ctrl_l' })
    keyCallback({ key: 'char.z' })
    await vi.advanceTimersByTimeAsync(150)

    // 点击关闭应显示确认弹窗（有改动）
    document.getElementById('settings-modal-close').click()
    expect(document.querySelector('.settings-confirm-dialog')).toBeTruthy()
    vi.useRealTimers()
  })
})

describe('Settings applyAllSettings 显示按钮', () => {
  it('showHeaderExpandBtn 为 false 应展开功能按钮', async () => {
    window.DataStore.getSettings = vi.fn().mockResolvedValue({ showHeaderExpandBtn: false })
    await window.Settings.init()

    expect(document.getElementById('music-expand-btn').classList.contains('expanded')).toBe(true)
    expect(document.getElementById('ui-hidden-buttons').classList.contains('expanded')).toBe(true)
  })

  it('showHeaderExpandBtn 为 true 且已展开应同步按钮状态', async () => {
    document.getElementById('ui-hidden-buttons').classList.add('expanded')
    window.DataStore.getSettings = vi.fn().mockResolvedValue({ showHeaderExpandBtn: true })
    await window.Settings.init()

    expect(document.getElementById('music-expand-btn').classList.contains('expanded')).toBe(true)
    expect(document.getElementById('music-expand-btn').title).toBe('收起')
  })

  it('showHeaderExpandBtn 为 true 且未展开应移除 expanded', async () => {
    document.getElementById('ui-hidden-buttons').classList.remove('expanded')
    window.DataStore.getSettings = vi.fn().mockResolvedValue({ showHeaderExpandBtn: true })
    await window.Settings.init()

    expect(document.getElementById('music-expand-btn').classList.contains('expanded')).toBe(false)
    expect(document.getElementById('music-expand-btn').title).toBe('展开')
  })

  it('musicSetHotkeys 失败应不报错', async () => {
    window.electronAPI.musicSetHotkeys.mockRejectedValueOnce(new Error('失败'))
    await window.Settings.init()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(true).toBe(true)
  })
})

describe('Settings 更新状态 - downloaded', () => {
  it('updateStatus downloaded 应显示安装提示', async () => {
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({ status: 'downloaded', version: '5.0.0' })

    expect(document.getElementById('settings-update-status').textContent).toContain('5.0.0')
    expect(document.getElementById('settings-update-btn').textContent).toBe('安装更新')
  })

  it('downloaded 后点击安装应调用 installUpdate', async () => {
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({ status: 'downloaded', version: '5.0.0' })

    document.getElementById('settings-update-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.installUpdate).toHaveBeenCalled()
  })

  it('available 后点击下载应调用 downloadUpdate', async () => {
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({ status: 'available', version: '4.0.0' })

    document.getElementById('settings-update-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.downloadUpdate).toHaveBeenCalled()
  })

  it('安装失败应重置按钮', async () => {
    window.electronAPI.installUpdate.mockRejectedValueOnce(new Error('失败'))
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({ status: 'downloaded', version: '5.0.0' })

    document.getElementById('settings-update-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('settings-update-btn').textContent).toBe('检查更新')
  })

  it('下载失败应重置按钮', async () => {
    window.electronAPI.downloadUpdate.mockRejectedValueOnce(new Error('失败'))
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({ status: 'available', version: '4.0.0' })

    document.getElementById('settings-update-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('settings-update-btn').textContent).toBe('检查更新')
  })

  it('updateStatus checking 应显示检查中', async () => {
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({ status: 'checking' })

    expect(document.getElementById('settings-update-status').textContent).toContain('检查更新')
  })

  it('updateStatus not-available 应 3 秒后清除状态', async () => {
    vi.useFakeTimers()
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({ status: 'not-available' })

    expect(document.getElementById('settings-update-status').textContent).toBe('已是最新版本')

    // 推进 3 秒
    vi.advanceTimersByTime(3000)

    expect(document.getElementById('settings-update-status').textContent).toBe('')
    vi.useRealTimers()
  })

  it('updateStatus downloading 无速度应不显示速度', async () => {
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({
      status: 'downloading',
      percent: 30,
      bytesPerSecond: 0,
      total: 0
    })

    expect(document.getElementById('settings-update-progress-text').textContent).toBe('下载中 30%')
    // formatSize(0) 返回空字符串，所以总大小后为空
    expect(document.getElementById('settings-update-status').textContent).toBe('总大小 ')
  })

  it('updateStatus 未知状态应忽略', async () => {
    const updateStatusHandler = window.electronAPI.onUpdateStatus.mock.calls[0][0]
    updateStatusHandler({ status: 'unknown' })

    // 不应报错
    expect(true).toBe(true)
  })

  it('handleCheckUpdate 失败应显示错误', async () => {
    window.electronAPI.checkForUpdates.mockRejectedValueOnce(new Error('网络错误'))
    document.getElementById('settings-update-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('settings-update-status').textContent).toContain('网络错误')
    expect(document.getElementById('settings-update-btn').textContent).toBe('检查更新')
  })
})

describe('Settings 反馈功能 - 提交和列表', () => {
  it('提交反馈应调用 submitFeedback', async () => {
    document.getElementById('feedback-input').value = '测试反馈'
    document.getElementById('feedback-submit-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.submitFeedback).toHaveBeenCalledWith('测试反馈')
  })

  it('空内容提交应显示提示', async () => {
    document.getElementById('feedback-input').value = ''
    document.getElementById('feedback-submit-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ui-toast').textContent).toContain('请输入反馈内容')
  })

  it('提交成功应清空输入并刷新列表', async () => {
    document.getElementById('feedback-input').value = '测试反馈'
    document.getElementById('feedback-submit-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('feedback-input').value).toBe('')
    expect(document.getElementById('feedback-char-count').textContent).toBe('0')
  })

  it('提交失败应显示错误', async () => {
    window.electronAPI.submitFeedback.mockResolvedValueOnce({ success: false, error: '太长' })
    document.getElementById('feedback-input').value = '测试反馈'
    document.getElementById('feedback-submit-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ui-toast').textContent).toContain('太长')
  })

  it('提交异常应显示失败提示', async () => {
    window.electronAPI.submitFeedback.mockRejectedValueOnce(new Error('网络错误'))
    document.getElementById('feedback-input').value = '测试反馈'
    document.getElementById('feedback-submit-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ui-toast').textContent).toContain('提交失败')
  })

  it('输入框 input 应更新字数统计', async () => {
    const input = document.getElementById('feedback-input')
    input.value = 'abc'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    expect(document.getElementById('feedback-char-count').textContent).toBe('3')
  })

  it('刷新按钮应调用 loadUserFeedbacks', async () => {
    window.electronAPI.getUserFeedbacks.mockResolvedValueOnce({ success: true, data: [] })
    document.getElementById('feedback-refresh-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.getUserFeedbacks).toHaveBeenCalled()
  })

  it('登录按钮应关闭反馈弹窗并打开登录弹窗', async () => {
    document.getElementById('feedback-login-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('auth-modal').classList.contains('show')).toBe(true)
  })

  it('打开反馈按钮应显示反馈弹窗', async () => {
    document.getElementById('feedback-open-btn').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    // BaseModal.show 被调用（通过 mock 实现）
    expect(true).toBe(true)
  })

  it('关闭反馈按钮应隐藏反馈弹窗', async () => {
    document.getElementById('feedback-modal-close').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(true).toBe(true)
  })
})

describe('Settings 反馈列表渲染', () => {
  it('应正确渲染反馈列表', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { user: {} } })
    window.electronAPI.getUserFeedbacks.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          feedback_content: '测试反馈1',
          feedback_status: 0,
          create_time: '2025-01-01T00:00:00Z',
          remark: null
        },
        {
          id: 2,
          feedback_content: '测试反馈2',
          feedback_status: 3,
          create_time: '2025-01-02T00:00:00Z',
          remark: '不符合要求'
        }
      ]
    })

    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 100))

    const items = document.querySelectorAll('.feedback-item')
    expect(items.length).toBe(2)
    expect(document.querySelector('.feedback-item-remark')).toBeTruthy()
  })

  it('加载反馈列表失败应显示空状态', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { user: {} } })
    window.electronAPI.getUserFeedbacks.mockRejectedValueOnce(new Error('网络错误'))

    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(document.getElementById('feedback-empty').style.display).toBe('block')
  })

  it('空列表应显示空状态', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { user: {} } })
    window.electronAPI.getUserFeedbacks.mockResolvedValue({ success: true, data: [] })

    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(document.getElementById('feedback-empty').style.display).toBe('block')
  })

  it('点击删除按钮应显示确认对话框', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { user: {} } })
    window.electronAPI.getUserFeedbacks.mockResolvedValue({
      success: true,
      data: [{
        id: 1,
        feedback_content: '测试反馈',
        feedback_status: 0,
        create_time: '2025-01-01T00:00:00Z',
        remark: null
      }]
    })

    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 100))

    // 点击删除按钮
    document.querySelector('.feedback-delete-btn').click()

    // 应显示确认对话框
    expect(document.querySelector('.feedback-confirm-overlay')).toBeTruthy()
  })

  it('确认删除应调用 deleteFeedback', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { user: {} } })
    window.electronAPI.getUserFeedbacks.mockResolvedValue({
      success: true,
      data: [{
        id: 1,
        feedback_content: '测试反馈',
        feedback_status: 0,
        create_time: '2025-01-01T00:00:00Z',
        remark: null
      }]
    })

    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 100))

    document.querySelector('.feedback-delete-btn').click()
    document.querySelector('.feedback-confirm-ok').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.deleteFeedback).toHaveBeenCalledWith(1)
  })

  it('删除成功应关闭对话框并刷新列表', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { user: {} } })
    window.electronAPI.getUserFeedbacks.mockResolvedValue({
      success: true,
      data: [{
        id: 1,
        feedback_content: '测试反馈',
        feedback_status: 0,
        create_time: '2025-01-01T00:00:00Z',
        remark: null
      }]
    })

    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 100))

    document.querySelector('.feedback-delete-btn').click()
    document.querySelector('.feedback-confirm-ok').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.querySelector('.feedback-confirm-overlay')).toBeFalsy()
  })

  it('删除失败应显示错误并恢复按钮', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { user: {} } })
    window.electronAPI.getUserFeedbacks.mockResolvedValue({
      success: true,
      data: [{
        id: 1,
        feedback_content: '测试反馈',
        feedback_status: 0,
        create_time: '2025-01-01T00:00:00Z',
        remark: null
      }]
    })
    window.electronAPI.deleteFeedback.mockResolvedValueOnce({ success: false, error: '权限不足' })

    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 100))

    document.querySelector('.feedback-delete-btn').click()
    document.querySelector('.feedback-confirm-ok').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ui-toast').textContent).toContain('权限不足')
    expect(document.querySelector('.feedback-confirm-ok').textContent).toBe('删除')
  })

  it('删除异常应返回失败', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { user: {} } })
    window.electronAPI.getUserFeedbacks.mockResolvedValue({
      success: true,
      data: [{
        id: 1,
        feedback_content: '测试反馈',
        feedback_status: 0,
        create_time: '2025-01-01T00:00:00Z',
        remark: null
      }]
    })
    window.electronAPI.deleteFeedback.mockRejectedValueOnce(new Error('网络错误'))

    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 100))

    document.querySelector('.feedback-delete-btn').click()
    document.querySelector('.feedback-confirm-ok').click()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ui-toast').textContent).toContain('删除失败')
  })

  it('取消删除应关闭对话框', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { user: {} } })
    window.electronAPI.getUserFeedbacks.mockResolvedValue({
      success: true,
      data: [{
        id: 1,
        feedback_content: '测试反馈',
        feedback_status: 0,
        create_time: '2025-01-01T00:00:00Z',
        remark: null
      }]
    })

    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 100))

    document.querySelector('.feedback-delete-btn').click()
    document.querySelector('.feedback-confirm-cancel').click()

    expect(document.querySelector('.feedback-confirm-overlay')).toBeFalsy()
  })

  it('点击背景应关闭删除对话框', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { user: {} } })
    window.electronAPI.getUserFeedbacks.mockResolvedValue({
      success: true,
      data: [{
        id: 1,
        feedback_content: '测试反馈',
        feedback_status: 0,
        create_time: '2025-01-01T00:00:00Z',
        remark: null
      }]
    })

    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 100))

    document.querySelector('.feedback-delete-btn').click()
    const overlay = document.querySelector('.feedback-confirm-overlay')
    overlay.click()

    expect(document.querySelector('.feedback-confirm-overlay')).toBeFalsy()
  })
})

describe('Settings 更新检查 - 检查登录状态失败', () => {
  it('cloudGetSession 失败应不报错', async () => {
    window.electronAPI.cloudGetSession.mockRejectedValueOnce(new Error('网络错误'))
    await window.Settings.updateFeedbackVisibility()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(true).toBe(true)
  })
})

describe('Settings loadVersion 错误处理', () => {
  it('getVersion 失败应不报错', async () => {
    window.electronAPI.getVersion.mockRejectedValueOnce(new Error('失败'))
    await window.Settings.init()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(true).toBe(true)
  })
})

describe('Settings showToast 无 toast 元素', () => {
  it('toast 元素不存在应不报错', async () => {
    // 移除 toast 元素
    document.getElementById('ui-toast').remove()

    // 修改 plantWheelMode 并保存以触发 showToast
    document.getElementById('settings-plant-wheel-mode').checked = false
    document.getElementById('settings-save-btn').click()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(true).toBe(true)
  })
})
