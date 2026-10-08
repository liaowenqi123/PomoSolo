/**
 * MusicPlayer 模块测试
 *
 * 测试音乐播放器：初始化、播放/暂停、进度条、设备列表、音量、播放列表、模式切换
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(async () => {
  document.body.innerHTML = `
    <div id="music-player">
      <button id="music-play-btn">▶</button>
      <button id="music-next-btn">⏭</button>
      <button id="music-prev-btn">⏮</button>
      <button id="music-mode-btn">🔀</button>
      <div id="music-progress-bar">
        <div id="music-progress-fill"></div>
        <div id="music-progress-handle"></div>
      </div>
      <span id="music-track-name">未播放</span>
      <span id="music-current-time">0:00</span>
      <span id="music-duration">0:00</span>
      <button id="music-device-btn">🔊</button>
      <div id="music-device-list"></div>
      <button id="music-volume-btn">🔊</button>
      <div id="music-volume-slider">
        <input type="range" id="music-volume-range" min="0" max="100" value="100" />
      </div>
      <button id="music-collapse-btn">收起</button>
      <span id="music-collapsed-track">未播放</span>
      <div id="music-visualizer">
        <div class="visualizer-bar"></div>
        <div class="visualizer-bar"></div>
      </div>
      <button id="music-playlist-btn">列表</button>
      <div id="music-playlist-panel">
        <div id="music-playlist-items"></div>
        <button id="music-refresh-btn">刷新</button>
      </div>
    </div>
    <div id="music-toast"></div>
    <div id="tag-select-modal">
      <span id="tag-select-song-name"></span>
      <div id="tag-options"></div>
      <input id="tag-custom-input" />
      <div id="tag-color-picker"></div>
      <div id="tag-color-presets"></div>
      <button id="tag-add-btn">添加</button>
      <div id="tag-custom-color-picker">
        <input type="range" id="color-hue-slider" min="0" max="360" />
        <div id="color-picker-preview"></div>
      </div>
    </div>
    <div id="delete-song-modal">
      <p id="delete-song-message"></p>
      <button id="delete-song-cancel-btn">取消</button>
      <button id="delete-song-ok-btn">确定</button>
    </div>
  `

  window.electronAPI = {
    musicTogglePlay: vi.fn(),
    musicNext: vi.fn(),
    musicPrev: vi.fn(),
    musicSetPlayMode: vi.fn(),
    musicSeek: vi.fn(),
    musicGetDevices: vi.fn(),
    musicSetDevice: vi.fn(),
    musicSetVolume: vi.fn(),
    musicGetPlaylist: vi.fn(),
    musicGetStatus: vi.fn(),
    musicPlaySong: vi.fn(),
    musicUpdateTag: vi.fn().mockResolvedValue({ success: true }),
    musicDeleteSong: vi.fn().mockResolvedValue({ success: true }),
    musicAddCustomTag: vi.fn().mockResolvedValue({ success: true }),
    musicDeleteCustomTag: vi.fn().mockResolvedValue({ success: true }),
    musicGetCustomTags: vi.fn().mockResolvedValue({ customTags: {} }),
    onMusicReady: vi.fn(),
    onMusicStatus: vi.fn(),
    onMusicTrackChange: vi.fn(),
    onMusicPlayState: vi.fn(),
    onMusicProgress: vi.fn(),
    onMusicDevices: vi.fn(),
    onMusicNoMusic: vi.fn(),
    onMusicPlayError: vi.fn(),
    onMusicVolumeChange: vi.fn(),
    onMusicPlayMode: vi.fn(),
    onMusicPlaylist: vi.fn(),
    onMusicSongMissing: vi.fn(),
    readData: vi.fn().mockResolvedValue({ musicVolume: 0.8 }),
    writeData: vi.fn().mockResolvedValue(true)
  }

  window.DataStore = {
    getSettings: vi.fn().mockReturnValue({ advancedColorCustomization: false })
  }

  // Mock BaseModal
  window.BaseModal = vi.fn().mockImplementation(function({ element, showClass, closeOnBackground } = {}) {
    return {
      element,
      showClass,
      show: vi.fn(() => {
        if (element) element.classList.add(showClass || 'visible')
      }),
      hide: vi.fn(() => {
        if (element) element.classList.remove(showClass || 'visible')
      }),
      toggle: vi.fn()
    }
  })

  // 重置模块缓存，使 musicPlayer 重新执行并重置内部闭包状态
  vi.resetModules()
  delete require.cache[require.resolve('../../src/scripts/modules/utils')]
  delete require.cache[require.resolve('../../src/scripts/modules/musicPlayer')]
  require('../../src/scripts/modules/utils')
  // musicPlayer.js 使用 module.exports 而非 window.MusicPlayer，需要手动赋值
  window.MusicPlayer = require('../../src/scripts/modules/musicPlayer')

  await window.MusicPlayer.init({
    playBtn: document.getElementById('music-play-btn'),
    nextBtn: document.getElementById('music-next-btn'),
    prevBtn: document.getElementById('music-prev-btn'),
    modeBtn: document.getElementById('music-mode-btn'),
    progressBar: document.getElementById('music-progress-bar'),
    progressFill: document.getElementById('music-progress-fill'),
    progressHandle: document.getElementById('music-progress-handle'),
    trackNameEl: document.getElementById('music-track-name'),
    currentTimeEl: document.getElementById('music-current-time'),
    durationEl: document.getElementById('music-duration'),
    musicPlayer: document.getElementById('music-player'),
    deviceBtn: document.getElementById('music-device-btn'),
    deviceList: document.getElementById('music-device-list'),
    volumeBtn: document.getElementById('music-volume-btn'),
    volumeSlider: document.getElementById('music-volume-slider'),
    volumeRange: document.getElementById('music-volume-range'),
    collapseBtn: document.getElementById('music-collapse-btn'),
    collapsedTrack: document.getElementById('music-collapsed-track'),
    visualizerBars: document.querySelectorAll('.visualizer-bar'),
    playlistBtn: document.getElementById('music-playlist-btn'),
    playlistPanel: document.getElementById('music-playlist-panel'),
    playlistItems: document.getElementById('music-playlist-items'),
    refreshBtn: document.getElementById('music-refresh-btn')
  })
})

describe('MusicPlayer init', () => {
  it('init 应绑定事件并请求初始状态', () => {
    expect(window.electronAPI.musicGetStatus).toHaveBeenCalled()
    expect(window.electronAPI.musicGetDevices).toHaveBeenCalled()
    expect(window.electronAPI.musicGetCustomTags).toHaveBeenCalled()
  })

  it('init 应注册所有 IPC 监听器', () => {
    expect(window.electronAPI.onMusicReady).toHaveBeenCalled()
    expect(window.electronAPI.onMusicStatus).toHaveBeenCalled()
    expect(window.electronAPI.onMusicTrackChange).toHaveBeenCalled()
    expect(window.electronAPI.onMusicPlayState).toHaveBeenCalled()
    expect(window.electronAPI.onMusicProgress).toHaveBeenCalled()
    expect(window.electronAPI.onMusicDevices).toHaveBeenCalled()
    expect(window.electronAPI.onMusicNoMusic).toHaveBeenCalled()
    expect(window.electronAPI.onMusicPlayError).toHaveBeenCalled()
    expect(window.electronAPI.onMusicVolumeChange).toHaveBeenCalled()
    expect(window.electronAPI.onMusicPlayMode).toHaveBeenCalled()
    expect(window.electronAPI.onMusicPlaylist).toHaveBeenCalled()
    expect(window.electronAPI.onMusicSongMissing).toHaveBeenCalled()
  })
})

describe('MusicPlayer 公共 API', () => {
  it('getState 应返回当前状态副本', () => {
    const state = window.MusicPlayer.getState()
    expect(state).toHaveProperty('playing')
    expect(state).toHaveProperty('trackName')
    expect(state).toHaveProperty('volume')
    expect(state).toHaveProperty('playMode')
  })

  it('togglePlay 应调用 musicTogglePlay', () => {
    window.MusicPlayer.togglePlay()
    expect(window.electronAPI.musicTogglePlay).toHaveBeenCalled()
  })

  it('next 应调用 musicNext', () => {
    window.MusicPlayer.next()
    expect(window.electronAPI.musicNext).toHaveBeenCalled()
  })

  it('prev 应调用 musicPrev', () => {
    window.MusicPlayer.prev()
    expect(window.electronAPI.musicPrev).toHaveBeenCalled()
  })

  it('setAdvancedColorCustomization 应更新状态', () => {
    window.MusicPlayer.setAdvancedColorCustomization(true)
    const state = window.MusicPlayer.getState()
    expect(state.advancedColorCustomization).toBe(true)
  })
})

describe('MusicPlayer 按钮点击', () => {
  it('点击播放按钮应调用 musicTogglePlay', () => {
    document.getElementById('music-play-btn').click()
    expect(window.electronAPI.musicTogglePlay).toHaveBeenCalled()
  })

  it('点击下一首按钮应调用 musicNext', () => {
    document.getElementById('music-next-btn').click()
    expect(window.electronAPI.musicNext).toHaveBeenCalled()
  })

  it('点击上一首按钮应调用 musicPrev', () => {
    document.getElementById('music-prev-btn').click()
    expect(window.electronAPI.musicPrev).toHaveBeenCalled()
  })

  it('点击模式按钮（shuffle→order）应调用 musicSetPlayMode("order")', () => {
    // 默认 shuffle
    document.getElementById('music-mode-btn').click()
    expect(window.electronAPI.musicSetPlayMode).toHaveBeenCalledWith('order')
  })
})

describe('MusicPlayer 播放模式切换', () => {
  it('初始模式为 shuffle 应显示 🔀', () => {
    const state = window.MusicPlayer.getState()
    expect(state.playMode).toBe('shuffle')
    expect(document.getElementById('music-mode-btn').textContent).toBe('🔀')
  })
})

describe('MusicPlayer IPC 事件', () => {
  it('onMusicReady 事件应更新曲目名和时长', () => {
    const readyCallback = window.electronAPI.onMusicReady.mock.calls[0][0]
    readyCallback({ name: 'test.mp3', duration: 180, has_prev: true })

    expect(document.getElementById('music-track-name').textContent).toBe('test.mp3')
    expect(document.getElementById('music-duration').textContent).toBe('3:00')
  })

  it('onMusicStatus 事件应更新播放状态', () => {
    const statusCallback = window.electronAPI.onMusicStatus.mock.calls[0][0]
    statusCallback({ playing: true, name: 'song.mp3', current: 30, duration: 200, has_prev: true, play_mode: 'order' })

    expect(document.getElementById('music-play-btn').textContent).toBe('⏸')
    expect(document.getElementById('music-mode-btn').textContent).toBe('🔁')
  })

  it('onMusicNoMusic 事件应显示无音乐', () => {
    const noMusicCallback = window.electronAPI.onMusicNoMusic.mock.calls[0][0]
    noMusicCallback({})

    expect(document.getElementById('music-track-name').textContent).toBe('无音乐')
  })

  it('onMusicPlayError 事件应显示错误信息', () => {
    const errorCallback = window.electronAPI.onMusicPlayError.mock.calls[0][0]
    errorCallback({ message: '播放失败测试' })

    expect(document.getElementById('music-track-name').textContent).toBe('播放失败测试')
  })

  it('onMusicVolumeChange 事件应更新音量 UI', () => {
    const volCallback = window.electronAPI.onMusicVolumeChange.mock.calls[0][0]
    volCallback({ volume: 0.5 })

    expect(document.getElementById('music-volume-range').value).toBe('50')
  })

  it('onMusicPlayMode 事件应更新模式按钮', () => {
    const modeCallback = window.electronAPI.onMusicPlayMode.mock.calls[0][0]
    modeCallback({ mode: 'loop' })

    expect(document.getElementById('music-mode-btn').textContent).toBe('🔂')
  })

  it('onMusicPlaylist 事件（旧格式）应渲染播放列表', () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3', 'song2.mp3'], current_index: 0 })

    const items = document.querySelectorAll('.playlist-item')
    expect(items.length).toBe(2)
  })

  it('onMusicPlaylist 事件（新格式）应渲染带标签的播放列表', () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({
      songs: [
        { name: 'song1.mp3', tag: '学习', tagColor: '#ff6b6b' },
        { name: 'song2.mp3', tag: '自定义', tagColor: null }
      ],
      current_index: 0,
      current_song: 'song1.mp3'
    })

    const items = document.querySelectorAll('.playlist-item')
    expect(items.length).toBe(2)
    expect(items[0].classList.contains('current')).toBe(true)
  })

  it('onMusicDevices 事件应渲染设备列表', () => {
    const devicesCallback = window.electronAPI.onMusicDevices.mock.calls[0][0]
    devicesCallback({
      devices: [
        { id: 1, name: 'Speaker', hostapi: 'ALSA', is_default: true },
        { id: 2, name: 'Headset', hostapi: 'ALSA', is_default: false }
      ],
      current: 1
    })

    const items = document.querySelectorAll('.device-item')
    expect(items.length).toBe(2)
    expect(items[0].classList.contains('device-current')).toBe(true)
  })
})

describe('MusicPlayer 设备选择', () => {
  it('点击设备按钮应切换设备列表显示', () => {
    document.getElementById('music-device-btn').click()
    expect(document.getElementById('music-device-list').classList.contains('open')).toBe(true)
    expect(window.electronAPI.musicGetDevices).toHaveBeenCalled()
  })

  it('点击设备项应调用 musicSetDevice', () => {
    const devicesCallback = window.electronAPI.onMusicDevices.mock.calls[0][0]
    devicesCallback({
      devices: [
        { id: 1, name: 'Speaker', hostapi: 'ALSA', is_default: true },
        { id: 2, name: 'Headset', hostapi: 'ALSA', is_default: false }
      ],
      current: 1
    })

    document.getElementById('music-device-btn').click()
    const deviceItems = document.querySelectorAll('.device-item')
    deviceItems[1].click()

    expect(window.electronAPI.musicSetDevice).toHaveBeenCalledWith(2)
  })
})

describe('MusicPlayer 音量控制', () => {
  it('点击音量按钮应切换音量滑块显示', () => {
    document.getElementById('music-volume-btn').click()
    expect(document.getElementById('music-volume-slider').classList.contains('open')).toBe(true)
  })

  it('音量滑块 input 应调用 musicSetVolume（节流）', () => {
    const range = document.getElementById('music-volume-range')
    range.value = '50'
    range.dispatchEvent(new Event('input', { bubbles: true }))

    expect(window.electronAPI.musicSetVolume).toHaveBeenCalledWith(0.5)
  })

  it('音量=0 应显示 🔇', () => {
    const volCallback = window.electronAPI.onMusicVolumeChange.mock.calls[0][0]
    volCallback({ volume: 0 })
    expect(document.getElementById('music-volume-btn').textContent).toBe('🔇')
  })

  it('音量<0.3 应显示 🔈', () => {
    const volCallback = window.electronAPI.onMusicVolumeChange.mock.calls[0][0]
    volCallback({ volume: 0.2 })
    expect(document.getElementById('music-volume-btn').textContent).toBe('🔈')
  })

  it('音量<0.7 应显示 🔉', () => {
    const volCallback = window.electronAPI.onMusicVolumeChange.mock.calls[0][0]
    volCallback({ volume: 0.5 })
    expect(document.getElementById('music-volume-btn').textContent).toBe('🔉')
  })

  it('音量>=0.7 应显示 🔊', () => {
    const volCallback = window.electronAPI.onMusicVolumeChange.mock.calls[0][0]
    volCallback({ volume: 0.9 })
    expect(document.getElementById('music-volume-btn').textContent).toBe('🔊')
  })
})

describe('MusicPlayer 收起/展开', () => {
  it('点击收起按钮应切换 collapsed 类', () => {
    document.getElementById('music-collapse-btn').click()
    expect(document.getElementById('music-player').classList.contains('collapsed')).toBe(true)
  })

  it('再次点击应展开', () => {
    const btn = document.getElementById('music-collapse-btn')
    btn.click()
    btn.click()
    expect(document.getElementById('music-player').classList.contains('collapsed')).toBe(false)
  })
})

describe('MusicPlayer 播放列表', () => {
  it('点击播放列表按钮应切换面板显示', () => {
    document.getElementById('music-playlist-btn').click()
    expect(document.getElementById('music-playlist-panel').classList.contains('open')).toBe(true)
    expect(window.electronAPI.musicGetPlaylist).toHaveBeenCalled()
  })

  it('点击刷新按钮应请求播放列表并添加动画', () => {
    document.getElementById('music-refresh-btn').click()
    expect(window.electronAPI.musicGetPlaylist).toHaveBeenCalled()
    expect(document.getElementById('music-refresh-btn').classList.contains('refreshing')).toBe(true)
  })

  it('空播放列表应显示"暂无音乐"', () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: [], current_index: -1 })
    expect(document.getElementById('music-playlist-items').innerHTML).toContain('暂无音乐')
  })
})

describe('MusicPlayer 进度条交互', () => {
  it('播放状态下点击进度条应调用 musicSeek', () => {
    // 先设置有音乐和时长
    const statusCallback = window.electronAPI.onMusicStatus.mock.calls[0][0]
    statusCallback({ playing: true, name: 'song.mp3', current: 0, duration: 200, has_prev: true })

    const progressBar = document.getElementById('music-progress-bar')
    progressBar.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50 }))

    expect(window.electronAPI.musicSeek).toHaveBeenCalled()
  })

  it('duration<=0 时点击进度条不应调用 musicSeek', () => {
    window.electronAPI.musicSeek.mockClear()
    const progressBar = document.getElementById('music-progress-bar')
    progressBar.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50 }))
    expect(window.electronAPI.musicSeek).not.toHaveBeenCalled()
  })
})

describe('MusicPlayer 播放超时检测', () => {
  it('点击播放按钮（非播放状态）应启动超时计时器', () => {
    vi.useFakeTimers()
    window.electronAPI.musicTogglePlay.mockClear()
    document.getElementById('music-play-btn').click()
    expect(window.electronAPI.musicTogglePlay).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('超时后应设置错误状态', () => {
    vi.useFakeTimers()
    const statusCallback = window.electronAPI.onMusicStatus.mock.calls[0][0]
    statusCallback({ playing: false, name: '', current: 0, duration: 0 })

    document.getElementById('music-play-btn').click()
    vi.advanceTimersByTime(4000)

    expect(document.getElementById('music-track-name').textContent).toContain('播放无响应')
    vi.useRealTimers()
  })

  it('收到 ready 事件应清除超时', () => {
    vi.useFakeTimers()
    document.getElementById('music-play-btn').click()
    const readyCallback = window.electronAPI.onMusicReady.mock.calls[0][0]
    readyCallback({ name: 'test.mp3', duration: 180, has_prev: true })
    vi.advanceTimersByTime(4000)

    expect(document.getElementById('music-track-name').textContent).toBe('test.mp3')
    vi.useRealTimers()
  })
})

describe('MusicPlayer IPC 事件补充', () => {
  it('onMusicTrackChange 应更新曲目名和时长', () => {
    const cb = window.electronAPI.onMusicTrackChange.mock.calls[0][0]
    cb({ name: 'newsong.mp3', duration: 120, has_prev: true })
    expect(document.getElementById('music-track-name').textContent).toBe('newsong.mp3')
  })

  it('onMusicPlayState playing=true 应清除错误', () => {
    const errorCallback = window.electronAPI.onMusicPlayError.mock.calls[0][0]
    errorCallback({ message: 'error' })

    const cb = window.electronAPI.onMusicPlayState.mock.calls[0][0]
    cb({ playing: true })

    expect(document.getElementById('music-play-btn').textContent).toBe('⏸')
  })

  it('onMusicProgress 应更新进度（非拖拽状态）', () => {
    const statusCallback = window.electronAPI.onMusicStatus.mock.calls[0][0]
    statusCallback({ playing: true, name: 'song.mp3', current: 0, duration: 200, has_prev: true })

    const cb = window.electronAPI.onMusicProgress.mock.calls[0][0]
    cb({ current: 50, duration: 200 })

    expect(document.getElementById('music-current-time').textContent).toBe('0:50')
  })

  it('onMusicProgress 拖拽状态不应更新', () => {
    const statusCallback = window.electronAPI.onMusicStatus.mock.calls[0][0]
    statusCallback({ playing: true, name: 'song.mp3', current: 0, duration: 200, has_prev: true })

    // Start drag
    const handle = document.getElementById('music-progress-handle')
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    const cb = window.electronAPI.onMusicProgress.mock.calls[0][0]
    cb({ current: 100, duration: 200 })

    // Should not update because dragging
    expect(document.getElementById('music-current-time').textContent).not.toBe('1:40')
  })

  it('onMusicSongMissing 应显示警告', () => {
    const cb = window.electronAPI.onMusicSongMissing.mock.calls[0][0]
    cb({ message: '文件已消失' })
    expect(document.getElementById('music-track-name').textContent).toContain('文件已消失')
  })

  it('onMusicReady has_prev=false 应禁用上一首按钮', () => {
    const cb = window.electronAPI.onMusicReady.mock.calls[0][0]
    cb({ name: 'test.mp3', duration: 180, has_prev: false })
    expect(document.getElementById('music-prev-btn').classList.contains('disabled')).toBe(true)
  })

  it('onMusicStatus has_prev=true 应启用上一首按钮', () => {
    const cb = window.electronAPI.onMusicStatus.mock.calls[0][0]
    cb({ playing: true, name: 'song.mp3', current: 30, duration: 200, has_prev: true })
    expect(document.getElementById('music-prev-btn').classList.contains('disabled')).toBe(false)
  })
})

describe('MusicPlayer 进度条拖拽', () => {
  it('拖拽进度条应更新UI并发送seek', () => {
    const statusCallback = window.electronAPI.onMusicStatus.mock.calls[0][0]
    statusCallback({ playing: true, name: 'song.mp3', current: 0, duration: 200, has_prev: true })

    window.electronAPI.musicSeek.mockClear()
    const handle = document.getElementById('music-progress-handle')
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

    expect(window.electronAPI.musicSeek).toHaveBeenCalled()
  })
})

describe('MusicPlayer 播放列表交互', () => {
  it('点击播放列表按钮两次应关闭面板', () => {
    const btn = document.getElementById('music-playlist-btn')
    btn.click()
    btn.click()
    expect(document.getElementById('music-playlist-panel').classList.contains('open')).toBe(false)
  })

  it('点击歌曲项应调用 musicPlaySong', () => {
    window.electronAPI.musicPlaySong.mockClear()
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3', 'song2.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const items = document.querySelectorAll('.playlist-item')
    items[1].click()

    expect(window.electronAPI.musicPlaySong).toHaveBeenCalledWith('song2.mp3')
  })

  it('点击当前歌曲不应调用 musicPlaySong', () => {
    window.electronAPI.musicPlaySong.mockClear()
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const items = document.querySelectorAll('.playlist-item')
    items[0].click()

    expect(window.electronAPI.musicPlaySong).not.toHaveBeenCalled()
  })

  it('点击标签应打开标签选择器', () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    expect(document.getElementById('tag-select-modal').classList.contains('show')).toBe(true)
  })

  it('点击内置歌曲标签应显示提示', () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['test - 番茄钟.mp3'], current_index: 0, current_song: 'test - 番茄钟.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    expect(document.getElementById('music-toast').textContent).toContain('内置歌曲')
  })

  it('点击删除按钮（当前歌曲）应显示提示', () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const deleteBtn = document.querySelector('.playlist-item-delete')
    deleteBtn.click()

    expect(document.getElementById('music-toast').textContent).toContain('无法删除')
  })

  it('点击删除按钮（非当前歌曲）应显示确认弹窗', () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3', 'song2.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const deleteBtn = document.querySelectorAll('.playlist-item-delete')[1]
    deleteBtn.click()

    expect(document.getElementById('delete-song-modal').classList.contains('show')).toBe(true)
  })

  it('确认删除应调用 musicDeleteSong', async () => {
    window.electronAPI.musicDeleteSong.mockClear()
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3', 'song2.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const deleteBtn = document.querySelectorAll('.playlist-item-delete')[1]
    deleteBtn.click()

    const confirmBtn = document.getElementById('delete-song-ok-btn')
    confirmBtn.click()

    await new Promise(r => setTimeout(r, 10))
    expect(window.electronAPI.musicDeleteSong).toHaveBeenCalledWith('song2.mp3')
  })

  it('点击外部应关闭播放列表', () => {
    const btn = document.getElementById('music-playlist-btn')
    btn.click()
    expect(document.getElementById('music-playlist-panel').classList.contains('open')).toBe(true)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 999, clientY: 999 }))
    expect(document.getElementById('music-playlist-panel').classList.contains('open')).toBe(false)
  })

  it('刷新按钮应在500ms后移除动画', () => {
    vi.useFakeTimers()
    document.getElementById('music-refresh-btn').click()
    expect(document.getElementById('music-refresh-btn').classList.contains('refreshing')).toBe(true)
    vi.advanceTimersByTime(600)
    expect(document.getElementById('music-refresh-btn').classList.contains('refreshing')).toBe(false)
    vi.useRealTimers()
  })
})

describe('MusicPlayer 标签选择器', () => {
  it('选择预设标签应调用 musicUpdateTag', async () => {
    window.electronAPI.musicUpdateTag.mockClear()
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    const option = document.querySelector('.tag-option[data-tag="学习"]')
    option.click()

    await new Promise(r => setTimeout(r, 10))
    expect(window.electronAPI.musicUpdateTag).toHaveBeenCalled()
  })

  it('添加自定义标签（空名）应显示提示', async () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    document.getElementById('tag-add-btn').click()
    expect(document.getElementById('music-toast').textContent).toContain('请输入标签名称')
  })

  it('添加自定义标签（名称过长）应显示提示', async () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    document.getElementById('tag-custom-input').value = '超长标签名'
    document.getElementById('tag-add-btn').click()
    expect(document.getElementById('music-toast').textContent).toContain('不能超过3个字')
  })

  it('添加自定义标签（已存在）应显示提示', async () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    document.getElementById('tag-custom-input').value = '学习'
    document.getElementById('tag-add-btn').click()
    expect(document.getElementById('music-toast').textContent).toContain('标签已存在')
  })

  it('成功添加自定义标签应调用 musicAddCustomTag', async () => {
    window.electronAPI.musicAddCustomTag.mockClear()
    window.electronAPI.musicUpdateTag.mockClear()
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    document.getElementById('tag-custom-input').value = '新标签'
    document.getElementById('tag-add-btn').click()

    await new Promise(r => setTimeout(r, 10))
    expect(window.electronAPI.musicAddCustomTag).toHaveBeenCalledWith('新标签', expect.any(String))
  })
})

describe('MusicPlayer 设备列表', () => {
  it('设备列表为空时应显示加载中', () => {
    const cb = window.electronAPI.onMusicDevices.mock.calls[0][0]
    cb({ devices: [], current: null })
    expect(document.getElementById('music-device-list').innerHTML).toContain('加载中')
  })

  it('点击设备按钮两次应关闭列表', () => {
    const btn = document.getElementById('music-device-btn')
    btn.click()
    btn.click()
    expect(document.getElementById('music-device-list').classList.contains('open')).toBe(false)
  })

  it('点击当前设备应只切换列表', () => {
    const cb = window.electronAPI.onMusicDevices.mock.calls[0][0]
    cb({ devices: [{ id: 1, name: 'Spk', hostapi: 'ALSA', is_default: true }], current: 1 })

    document.getElementById('music-device-btn').click()
    window.electronAPI.musicSetDevice.mockClear()
    document.querySelector('.device-item').click()

    expect(window.electronAPI.musicSetDevice).not.toHaveBeenCalled()
  })

  it('点击外部应关闭设备列表', () => {
    const cb = window.electronAPI.onMusicDevices.mock.calls[0][0]
    cb({ devices: [{ id: 1, name: 'Spk', hostapi: 'ALSA', is_default: true }], current: 1 })

    document.getElementById('music-device-btn').click()
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 999, clientY: 999 }))
    expect(document.getElementById('music-device-list').classList.contains('open')).toBe(false)
  })
})

describe('MusicPlayer 音量控制补充', () => {
  it('点击音量按钮两次应关闭滑块', () => {
    const btn = document.getElementById('music-volume-btn')
    btn.click()
    btn.click()
    expect(document.getElementById('music-volume-slider').classList.contains('open')).toBe(false)
  })

  it('音量 change 事件应发送最终值', () => {
    window.electronAPI.musicSetVolume.mockClear()
    const range = document.getElementById('music-volume-range')
    range.value = '70'
    range.dispatchEvent(new Event('change', { bubbles: true }))
    expect(window.electronAPI.musicSetVolume).toHaveBeenCalledWith(0.7)
  })

  it('音量键盘方向键应被阻止', () => {
    const range = document.getElementById('music-volume-range')
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    range.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('点击外部应关闭音量滑块', () => {
    document.getElementById('music-volume-btn').click()
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 999, clientY: 999 }))
    expect(document.getElementById('music-volume-slider').classList.contains('open')).toBe(false)
  })

  it('saveVolumeToStorage 应调用 writeData', async () => {
    window.electronAPI.readData.mockResolvedValue({ musicVolume: 0.5 })
    window.electronAPI.writeData.mockClear()

    const range = document.getElementById('music-volume-range')
    range.value = '60'
    range.dispatchEvent(new Event('input', { bubbles: true }))

    await new Promise(r => setTimeout(r, 10))
    expect(window.electronAPI.writeData).toHaveBeenCalled()
  })
})

describe('MusicPlayer 收起和律动条', () => {
  it('收起状态下播放应启动律动条', () => {
    const statusCallback = window.electronAPI.onMusicStatus.mock.calls[0][0]
    statusCallback({ playing: true, name: 'song.mp3', current: 0, duration: 200, has_prev: true })

    document.getElementById('music-collapse-btn').click()
    const bars = document.querySelectorAll('.visualizer-bar')
    expect(bars[0].classList.contains('playing')).toBe(true)
  })

  it('展开状态应停止律动条', () => {
    const statusCallback = window.electronAPI.onMusicStatus.mock.calls[0][0]
    statusCallback({ playing: true, name: 'song.mp3', current: 0, duration: 200, has_prev: true })

    document.getElementById('music-collapse-btn').click()
    document.getElementById('music-collapse-btn').click()
    const bars = document.querySelectorAll('.visualizer-bar')
    expect(bars[0].classList.contains('playing')).toBe(false)
  })
})

describe('MusicPlayer 播放模式三态切换', () => {
  it('order -> loop 应调用 musicSetPlayMode("loop")', () => {
    const modeCallback = window.electronAPI.onMusicPlayMode.mock.calls[0][0]
    modeCallback({ mode: 'order' })
    window.electronAPI.musicSetPlayMode.mockClear()

    document.getElementById('music-mode-btn').click()
    expect(window.electronAPI.musicSetPlayMode).toHaveBeenCalledWith('loop')
  })

  it('loop -> shuffle 应调用 musicSetPlayMode("shuffle")', () => {
    const modeCallback = window.electronAPI.onMusicPlayMode.mock.calls[0][0]
    modeCallback({ mode: 'loop' })
    window.electronAPI.musicSetPlayMode.mockClear()

    document.getElementById('music-mode-btn').click()
    expect(window.electronAPI.musicSetPlayMode).toHaveBeenCalledWith('shuffle')
  })
})

describe('MusicPlayer 播放列表渲染', () => {
  it('带标签颜色的歌曲应渲染标签样式', () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({
      songs: [{ name: 'song1.mp3', tag: '学习', tagColor: '#ff6b6b' }],
      current_index: 0,
      current_song: 'song1.mp3'
    })

    const tagEl = document.querySelector('.playlist-item-tag')
    expect(tagEl.getAttribute('style')).toContain('background')
  })

  it('内置歌曲不应显示删除按钮', () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({
      songs: [{ name: 'test - 番茄钟.mp3', tag: '学习', tagColor: '#ff6b6b' }],
      current_index: 0,
      current_song: 'test - 番茄钟.mp3'
    })

    const deleteBtn = document.querySelector('.playlist-item-delete')
    expect(deleteBtn).toBeNull()
  })
})

describe('MusicPlayer 高级颜色自定义', () => {
  it('高级颜色模式下应显示调色盘按钮', () => {
    window.DataStore.getSettings = vi.fn().mockReturnValue({ advancedColorCustomization: true })
    window.MusicPlayer.setAdvancedColorCustomization(true)

    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    const advancedBtn = document.getElementById('tag-color-advanced-btn')
    expect(advancedBtn).not.toBeNull()
  })

  it('点击调色盘按钮应显示自定义颜色选择器', () => {
    window.DataStore.getSettings = vi.fn().mockReturnValue({ advancedColorCustomization: true })
    window.MusicPlayer.setAdvancedColorCustomization(true)

    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    const advancedBtn = document.getElementById('tag-color-advanced-btn')
    advancedBtn.click()

    const customPicker = document.getElementById('tag-custom-color-picker')
    expect(customPicker.style.display).toBe('block')
  })

  it('调色盘滑块 input 应更新颜色', () => {
    window.DataStore.getSettings = vi.fn().mockReturnValue({ advancedColorCustomization: true })
    window.MusicPlayer.setAdvancedColorCustomization(true)

    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    const advancedBtn = document.getElementById('tag-color-advanced-btn')
    advancedBtn.click()

    const slider = document.getElementById('color-hue-slider')
    slider.value = '180'
    slider.dispatchEvent(new Event('input', { bubbles: true }))

    const preview = document.getElementById('color-picker-preview')
    expect(preview.style.background).toBeTruthy()
  })

  it('点击预设颜色应隐藏自定义颜色选择器', () => {
    window.DataStore.getSettings = vi.fn().mockReturnValue({ advancedColorCustomization: true })
    window.MusicPlayer.setAdvancedColorCustomization(true)

    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    const presets = document.querySelectorAll('.tag-color-preset:not(.tag-color-advanced)')
    presets[0].click()

    const customPicker = document.getElementById('tag-custom-color-picker')
    expect(customPicker.style.display).toBe('none')
  })

  it('再次点击调色盘按钮应隐藏自定义颜色选择器', () => {
    window.DataStore.getSettings = vi.fn().mockReturnValue({ advancedColorCustomization: true })
    window.MusicPlayer.setAdvancedColorCustomization(true)

    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    const advancedBtn = document.getElementById('tag-color-advanced-btn')
    advancedBtn.click()
    advancedBtn.click()

    const customPicker = document.getElementById('tag-custom-color-picker')
    expect(customPicker.style.display).toBe('none')
  })
})

describe('MusicPlayer 标签操作成功路径', () => {
  it('updateSongTag 成功应更新状态和渲染', async () => {
    window.electronAPI.musicUpdateTag.mockClear()
    window.electronAPI.musicUpdateTag.mockResolvedValue({ success: true })

    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    const option = document.querySelector('.tag-option[data-tag="学习"]')
    option.click()

    await new Promise(r => setTimeout(r, 10))
    expect(window.electronAPI.musicUpdateTag).toHaveBeenCalled()
  })

  it('updateSongTag 失败应显示错误', async () => {
    window.electronAPI.musicUpdateTag.mockResolvedValue({ success: false, error: '更新失败' })

    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    const option = document.querySelector('.tag-option[data-tag="学习"]')
    option.click()

    await new Promise(r => setTimeout(r, 10))
    expect(document.getElementById('music-toast').textContent).toContain('更新失败')
  })

  it('deleteSong 成功应刷新列表', async () => {
    window.electronAPI.musicDeleteSong.mockClear()
    window.electronAPI.musicDeleteSong.mockResolvedValue({ success: true })
    window.electronAPI.musicGetPlaylist.mockClear()

    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3', 'song2.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const deleteBtn = document.querySelectorAll('.playlist-item-delete')[1]
    deleteBtn.click()

    document.getElementById('delete-song-ok-btn').click()

    await new Promise(r => setTimeout(r, 10))
    expect(window.electronAPI.musicGetPlaylist).toHaveBeenCalled()
  })

  it('deleteSong 失败应显示错误', async () => {
    window.electronAPI.musicDeleteSong.mockResolvedValue({ success: false, error: '删除失败' })

    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3', 'song2.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const deleteBtn = document.querySelectorAll('.playlist-item-delete')[1]
    deleteBtn.click()

    document.getElementById('delete-song-ok-btn').click()

    await new Promise(r => setTimeout(r, 10))
    expect(document.getElementById('music-toast').textContent).toContain('删除失败')
  })

  it('删除确认取消按钮应隐藏弹窗', () => {
    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3', 'song2.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const deleteBtn = document.querySelectorAll('.playlist-item-delete')[1]
    deleteBtn.click()

    document.getElementById('delete-song-cancel-btn').click()
    expect(document.getElementById('delete-song-modal').classList.contains('show')).toBe(false)
  })
})

describe('MusicPlayer 自定义标签删除', () => {
  it('删除自定义标签成功应刷新弹窗', async () => {
    window.electronAPI.musicGetCustomTags.mockResolvedValue({ customTags: { '自定义1': '#ff6b6b' } })
    vi.resetModules()
    delete require.cache[require.resolve('../../src/scripts/modules/utils')]
    delete require.cache[require.resolve('../../src/scripts/modules/musicPlayer')]
    require('../../src/scripts/modules/utils')
    window.MusicPlayer = require('../../src/scripts/modules/musicPlayer')
    await window.MusicPlayer.init({
      playBtn: document.getElementById('music-play-btn'),
      nextBtn: document.getElementById('music-next-btn'),
      prevBtn: document.getElementById('music-prev-btn'),
      modeBtn: document.getElementById('music-mode-btn'),
      progressBar: document.getElementById('music-progress-bar'),
      progressFill: document.getElementById('music-progress-fill'),
      progressHandle: document.getElementById('music-progress-handle'),
      trackNameEl: document.getElementById('music-track-name'),
      currentTimeEl: document.getElementById('music-current-time'),
      durationEl: document.getElementById('music-duration'),
      musicPlayer: document.getElementById('music-player'),
      deviceBtn: document.getElementById('music-device-btn'),
      deviceList: document.getElementById('music-device-list'),
      volumeBtn: document.getElementById('music-volume-btn'),
      volumeSlider: document.getElementById('music-volume-slider'),
      volumeRange: document.getElementById('music-volume-range'),
      collapseBtn: document.getElementById('music-collapse-btn'),
      collapsedTrack: document.getElementById('music-collapsed-track'),
      visualizerBars: document.querySelectorAll('.visualizer-bar'),
      playlistBtn: document.getElementById('music-playlist-btn'),
      playlistPanel: document.getElementById('music-playlist-panel'),
      playlistItems: document.getElementById('music-playlist-items'),
      refreshBtn: document.getElementById('music-refresh-btn')
    })

    window.electronAPI.musicDeleteCustomTag.mockClear()
    window.electronAPI.musicDeleteCustomTag.mockResolvedValue({ success: true })

    const playlistCallback = window.electronAPI.onMusicPlaylist.mock.calls[0][0]
    playlistCallback({ songs: ['song1.mp3'], current_index: 0, current_song: 'song1.mp3' })

    const tagEl = document.querySelector('.playlist-item-tag')
    tagEl.click()

    const deleteBtn = document.querySelector('.tag-delete-btn')
    if (deleteBtn) {
      deleteBtn.click()
      await new Promise(r => setTimeout(r, 10))
      expect(window.electronAPI.musicDeleteCustomTag).toHaveBeenCalled()
    }
  })
})

describe('MusicPlayer 初始化错误处理', () => {
  it('musicGetCustomTags 抛错应不崩溃', async () => {
    window.electronAPI.musicGetCustomTags.mockRejectedValue(new Error('fail'))
    vi.resetModules()
    delete require.cache[require.resolve('../../src/scripts/modules/utils')]
    delete require.cache[require.resolve('../../src/scripts/modules/musicPlayer')]
    require('../../src/scripts/modules/utils')
    window.MusicPlayer = require('../../src/scripts/modules/musicPlayer')

    await expect(window.MusicPlayer.init({
      playBtn: document.getElementById('music-play-btn'),
      nextBtn: document.getElementById('music-next-btn'),
      prevBtn: document.getElementById('music-prev-btn'),
      modeBtn: document.getElementById('music-mode-btn'),
      progressBar: document.getElementById('music-progress-bar'),
      progressFill: document.getElementById('music-progress-fill'),
      progressHandle: document.getElementById('music-progress-handle'),
      trackNameEl: document.getElementById('music-track-name'),
      currentTimeEl: document.getElementById('music-current-time'),
      durationEl: document.getElementById('music-duration'),
      musicPlayer: document.getElementById('music-player'),
      deviceBtn: document.getElementById('music-device-btn'),
      deviceList: document.getElementById('music-device-list'),
      volumeBtn: document.getElementById('music-volume-btn'),
      volumeSlider: document.getElementById('music-volume-slider'),
      volumeRange: document.getElementById('music-volume-range'),
      collapseBtn: document.getElementById('music-collapse-btn'),
      collapsedTrack: document.getElementById('music-collapsed-track'),
      visualizerBars: document.querySelectorAll('.visualizer-bar'),
      playlistBtn: document.getElementById('music-playlist-btn'),
      playlistPanel: document.getElementById('music-playlist-panel'),
      playlistItems: document.getElementById('music-playlist-items'),
      refreshBtn: document.getElementById('music-refresh-btn')
    })).resolves.toBeUndefined()
  })

  it('DataStore.getSettings 抛错应不崩溃', async () => {
    window.DataStore.getSettings = vi.fn().mockImplementation(() => { throw new Error('fail') })
    vi.resetModules()
    delete require.cache[require.resolve('../../src/scripts/modules/utils')]
    delete require.cache[require.resolve('../../src/scripts/modules/musicPlayer')]
    require('../../src/scripts/modules/utils')
    window.MusicPlayer = require('../../src/scripts/modules/musicPlayer')

    await expect(window.MusicPlayer.init({
      playBtn: document.getElementById('music-play-btn'),
      nextBtn: document.getElementById('music-next-btn'),
      prevBtn: document.getElementById('music-prev-btn'),
      modeBtn: document.getElementById('music-mode-btn'),
      progressBar: document.getElementById('music-progress-bar'),
      progressFill: document.getElementById('music-progress-fill'),
      progressHandle: document.getElementById('music-progress-handle'),
      trackNameEl: document.getElementById('music-track-name'),
      currentTimeEl: document.getElementById('music-current-time'),
      durationEl: document.getElementById('music-duration'),
      musicPlayer: document.getElementById('music-player'),
      deviceBtn: document.getElementById('music-device-btn'),
      deviceList: document.getElementById('music-device-list'),
      volumeBtn: document.getElementById('music-volume-btn'),
      volumeSlider: document.getElementById('music-volume-slider'),
      volumeRange: document.getElementById('music-volume-range'),
      collapseBtn: document.getElementById('music-collapse-btn'),
      collapsedTrack: document.getElementById('music-collapsed-track'),
      visualizerBars: document.querySelectorAll('.visualizer-bar'),
      playlistBtn: document.getElementById('music-playlist-btn'),
      playlistPanel: document.getElementById('music-playlist-panel'),
      playlistItems: document.getElementById('music-playlist-items'),
      refreshBtn: document.getElementById('music-refresh-btn')
    })).resolves.toBeUndefined()
  })
})

describe('MusicPlayer onMusicTrackChange 补充', () => {
  it('isPlaylistOpen 时应刷新播放列表', () => {
    window.electronAPI.musicGetPlaylist.mockClear()
    document.getElementById('music-playlist-btn').click()

    const cb = window.electronAPI.onMusicTrackChange.mock.calls[0][0]
    cb({ name: 'newsong.mp3', duration: 120, has_prev: true })

    expect(window.electronAPI.musicGetPlaylist).toHaveBeenCalled()
  })
})
