/**
 * 音乐播放器模块 - 渲染进程
 * 负责音乐播放器的UI交互和状态管理
 */

const MusicPlayer = (function() {
  'use strict'

  // ============ 状态 ============
  let state = {
    playing: false,
    trackName: '',
    currentTime: 0,
    duration: 0,
    isDragging: false,
    lastSyncTime: 0,  // 上次同步的时间戳
    devices: [],
    currentDeviceId: null,
    isDeviceListOpen: false,
    hasMusic: true,  // 是否有音乐文件
    hasPrev: false,  // 是否有上一首歌
    playError: null,  // 播放错误信息
    playTimeout: null,  // 播放超时计时器
    volume: 1.0,  // 音量 0-1
    isVolumeSliderOpen: false,  // 音量滑块是否展开
    lastVolumeSendTime: 0,  // 上次发送音量的时间戳（节流用）
    isCollapsed: false,  // 是否收起
    playMode: 'shuffle',  // 播放模式：'shuffle' 随机 | 'order' 顺序循环
    playlist: [],  // 播放列表
    currentSongIndex: -1,  // 当前歌曲在列表中的索引
    isPlaylistOpen: false  // 播放列表弹窗是否打开
  }
  
  // 播放超时时间（毫秒）
  const PLAY_TIMEOUT_MS = 3000

  // ============ DOM 元素引用 ============
  let elements = {
    playBtn: null,
    nextBtn: null,
    prevBtn: null,
    modeBtn: null,
    progressBar: null,
    progressFill: null,
    progressHandle: null,
    trackNameEl: null,
    currentTimeEl: null,
    durationEl: null,
    musicPlayer: null,
    deviceBtn: null,
    deviceList: null,
    volumeBtn: null,
    volumeSlider: null,
    volumeRange: null,
    collapseBtn: null,
    collapsedTrack: null,
    visualizerBars: null,
    playlistBtn: null,
    playlistPanel: null,
    playlistItems: null
  }

  // ============ 工具函数 ============
  
  // 使用统一的格式化函数（不显示分钟前导零）
  const formatTime = (seconds) => Utils.formatTime(seconds, false)

  // ============ 播放超时检测 ============
  
  /**
   * 启动播放超时计时器
   * 如果 Python 端在指定时间内没有响应，自动进入错误状态
   */
  function startPlayTimeout() {
    clearPlayTimeout()
    state.playTimeout = setTimeout(() => {
      // 超时，进入错误状态
      state.playError = '播放无响应，请检查输出设备或重启番茄钟'
      state.playing = false
      updateProgressUI()
      updatePlayButton()
      console.log('[MusicPlayer] 播放超时，Python 端可能已死机')
    }, PLAY_TIMEOUT_MS)
  }
  
  /**
   * 清除播放超时计时器
   * 收到 Python 端响应时调用
   */
  function clearPlayTimeout() {
    if (state.playTimeout) {
      clearTimeout(state.playTimeout)
      state.playTimeout = null
    }
  }
  
  /**
   * Python 端响应处理
   * 清除超时计时器，表示 Python 端正常工作
   */
  function handlePythonResponse() {
    clearPlayTimeout()
  }

  function updateProgressUI() {
    // 显示播放错误
    if (state.playError) {
      if (elements.trackNameEl) {
        elements.trackNameEl.textContent = state.playError
        elements.trackNameEl.style.color = 'rgba(255, 150, 100, 0.95)'
      }
      if (elements.currentTimeEl) {
        elements.currentTimeEl.textContent = '--:--'
      }
      if (elements.durationEl) {
        elements.durationEl.textContent = '--:--'
      }
      if (elements.progressFill) {
        elements.progressFill.style.width = '0%'
      }
      if (elements.progressHandle) {
        elements.progressHandle.style.left = '0%'
      }
      return
    }
    
    // 没有音乐时显示提示
    if (!state.hasMusic) {
      if (elements.trackNameEl) {
        elements.trackNameEl.textContent = '无音乐'
        elements.trackNameEl.style.color = ''
      }
      if (elements.currentTimeEl) {
        elements.currentTimeEl.textContent = '--:--'
      }
      if (elements.durationEl) {
        elements.durationEl.textContent = '--:--'
      }
      if (elements.progressFill) {
        elements.progressFill.style.width = '0%'
      }
      if (elements.progressHandle) {
        elements.progressHandle.style.left = '0%'
      }
      return
    }
    
    // 恢复正常颜色
    if (elements.trackNameEl) {
      elements.trackNameEl.style.color = ''
    }
    
    if (state.duration <= 0) return
    
    const progress = (state.currentTime / state.duration) * 100
    if (elements.progressFill) {
      elements.progressFill.style.width = `${progress}%`
    }
    // 更新豆子位置
    if (elements.progressHandle) {
      elements.progressHandle.style.left = `${progress}%`
    }
    if (elements.currentTimeEl) {
      elements.currentTimeEl.textContent = formatTime(state.currentTime)
    }
    if (elements.durationEl) {
      elements.durationEl.textContent = formatTime(state.duration)
    }
    if (elements.trackNameEl) {
      elements.trackNameEl.textContent = state.trackName || '未播放'
    }
    // 更新收起状态下的曲目显示
    if (elements.collapsedTrack) {
      elements.collapsedTrack.textContent = state.trackName || '未播放'
    }
  }

  function updatePlayButton() {
    if (elements.playBtn) {
      elements.playBtn.textContent = state.playing ? '⏸' : '▶'
      elements.playBtn.setAttribute('data-playing', state.playing)
    }
    updateVisualizerState()
  }

  function updatePrevButton() {
    if (elements.prevBtn) {
      if (state.hasPrev) {
        elements.prevBtn.classList.remove('disabled')
        elements.prevBtn.disabled = false
      } else {
        elements.prevBtn.classList.add('disabled')
        elements.prevBtn.disabled = true
      }
    }
  }

  function updateModeButton() {
    if (elements.modeBtn) {
      if (state.playMode === 'shuffle') {
        elements.modeBtn.textContent = '🔀'
        elements.modeBtn.title = '随机播放（点击切换顺序播放）'
        elements.modeBtn.classList.add('active')
      } else {
        elements.modeBtn.textContent = '🔁'
        elements.modeBtn.title = '顺序播放（点击切换随机播放）'
        elements.modeBtn.classList.remove('active')
      }
    }
  }

  // ============ 播放列表 ============
  
  function togglePlaylist() {
    state.isPlaylistOpen = !state.isPlaylistOpen
    if (state.isPlaylistOpen) {
      elements.playlistPanel.classList.add('open')
      // 请求最新播放列表
      window.electronAPI.musicGetPlaylist()
    } else {
      elements.playlistPanel.classList.remove('open')
    }
  }
  
  function renderPlaylist() {
    if (!elements.playlistItems) return
    
    if (!state.playlist || state.playlist.length === 0) {
      elements.playlistItems.innerHTML = '<div class="playlist-empty">暂无音乐</div>'
      return
    }
    
    const html = state.playlist.map((song, index) => {
      const isCurrent = song === state.trackName
      const classes = ['playlist-item']
      if (isCurrent) classes.push('current')
      
      // 截取文件名（去掉扩展名）
      const displayName = song.replace(/\.[^/.]+$/, '')
      
      return `<div class="${classes.join(' ')}" data-song="${song}" data-index="${index}">
        <span class="playlist-item-name">${displayName}</span>
        ${isCurrent ? '<span class="playlist-item-playing">▶</span>' : ''}
      </div>`
    }).join('')
    
    elements.playlistItems.innerHTML = html
  }
  
  function handlePlaylistClick(e) {
    const item = e.target.closest('.playlist-item')
    if (!item) return
    
    const songName = item.dataset.song
    if (songName && songName !== state.trackName) {
      window.electronAPI.musicPlaySong(songName)
    }
  }
  
  function closePlaylistOnClickOutside(e) {
    if (state.isPlaylistOpen && elements.playlistBtn && elements.playlistPanel) {
      if (!elements.playlistBtn.contains(e.target) && !elements.playlistPanel.contains(e.target)) {
        state.isPlaylistOpen = false
        elements.playlistPanel.classList.remove('open')
      }
    }
  }

  // ============ 进度条交互 ============
  
  function handleProgressClick(e) {
    if (!elements.progressBar || state.duration <= 0) return
    
    const rect = elements.progressBar.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const progress = clickX / rect.width
    const newTime = Math.floor(progress * state.duration)
    
    window.electronAPI.musicSeek(newTime)
  }

  function handleProgressDragStart(e) {
    state.isDragging = true
    document.addEventListener('mousemove', handleProgressDrag)
    document.addEventListener('mouseup', handleProgressDragEnd)
  }

  function handleProgressDrag(e) {
    if (!state.isDragging || !elements.progressBar || state.duration <= 0) return
    
    const rect = elements.progressBar.getBoundingClientRect()
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const progress = clickX / rect.width
    const newTime = Math.floor(progress * state.duration)
    
    // 实时更新UI但不发送命令
    state.currentTime = newTime
    updateProgressUI()
  }

  function handleProgressDragEnd(e) {
    if (!state.isDragging) return
    
    state.isDragging = false
    document.removeEventListener('mousemove', handleProgressDrag)
    document.removeEventListener('mouseup', handleProgressDragEnd)
    
    // 拖拽结束时发送seek命令
    window.electronAPI.musicSeek(state.currentTime)
  }

  // ============ 设备选择器 ============
  
  function renderDeviceList() {
    if (!elements.deviceList) return
    
    if (state.devices.length === 0) {
      elements.deviceList.innerHTML = '<div class="device-item device-empty">加载中...</div>'
      return
    }
    
    const warningHtml = '<div class="device-warning">⚠️ 除非你真的知道你在做什么，请不要更改此设置</div>'
    
    const html = state.devices.map(device => {
      const isCurrent = device.id === state.currentDeviceId
      const isDefault = device.is_default
      const classes = ['device-item']
      if (isCurrent) classes.push('device-current')
      if (isDefault) classes.push('device-default')
      
      return `<div class="${classes.join(' ')}" data-device-id="${device.id}">
        <span class="device-name">${device.name}</span>
        <span class="device-api">${device.hostapi}</span>
        ${isCurrent ? '<span class="device-check">✓</span>' : ''}
      </div>`
    }).join('')
    
    elements.deviceList.innerHTML = warningHtml + html
  }
  
  function toggleDeviceList() {
    state.isDeviceListOpen = !state.isDeviceListOpen
    if (state.isDeviceListOpen) {
      elements.deviceList.classList.add('open')
      // 刷新设备列表
      window.electronAPI.musicGetDevices()
    } else {
      elements.deviceList.classList.remove('open')
    }
  }
  
  function handleDeviceClick(e) {
    const deviceItem = e.target.closest('.device-item')
    if (!deviceItem) return
    
    const deviceId = parseInt(deviceItem.dataset.deviceId, 10)
    if (deviceId === state.currentDeviceId) {
      toggleDeviceList()
      return
    }
    
    window.electronAPI.musicSetDevice(deviceId)
    state.currentDeviceId = deviceId
    toggleDeviceList()
  }
  
  function closeDeviceListOnClickOutside(e) {
    if (state.isDeviceListOpen && elements.deviceBtn && elements.deviceList) {
      if (!elements.deviceBtn.contains(e.target) && !elements.deviceList.contains(e.target)) {
        state.isDeviceListOpen = false
        elements.deviceList.classList.remove('open')
      }
    }
  }

  // ============ 音量控制 ============
  
  function toggleVolumeSlider() {
    state.isVolumeSliderOpen = !state.isVolumeSliderOpen
    if (state.isVolumeSliderOpen) {
      elements.volumeSlider.classList.add('open')
    } else {
      elements.volumeSlider.classList.remove('open')
    }
  }
  
  // 音量滑块变化 - 节流发送到Python（最多100ms一次）
  function handleVolumeInput(e) {
    const volume = parseInt(e.target.value, 10) / 100
    state.volume = volume
    updateVolumeIcon()
    
    // 节流：距离上次发送超过100ms才发送
    const now = Date.now()
    if (now - state.lastVolumeSendTime >= 100) {
      window.electronAPI.musicSetVolume(volume)
      state.lastVolumeSendTime = now
    }
  }
  
  // 从Python收到音量变化 - 更新滑块位置
  function updateVolumeUI() {
    if (elements.volumeRange) {
      elements.volumeRange.value = Math.round(state.volume * 100)
    }
    updateVolumeIcon()
  }
  
  function updateVolumeIcon() {
    if (elements.volumeBtn) {
      if (state.volume === 0) {
        elements.volumeBtn.textContent = '🔇'
      } else if (state.volume < 0.3) {
        elements.volumeBtn.textContent = '🔈'
      } else if (state.volume < 0.7) {
        elements.volumeBtn.textContent = '🔉'
      } else {
        elements.volumeBtn.textContent = '🔊'
      }
    }
  }
  
  function closeVolumeSliderOnClickOutside(e) {
    if (state.isVolumeSliderOpen && elements.volumeBtn && elements.volumeSlider) {
      if (!elements.volumeBtn.contains(e.target) && !elements.volumeSlider.contains(e.target)) {
        state.isVolumeSliderOpen = false
        elements.volumeSlider.classList.remove('open')
      }
    }
  }

  // ============ 收起/展开 ============

  function toggleCollapse() {
    state.isCollapsed = !state.isCollapsed
    if (elements.musicPlayer) {
      elements.musicPlayer.classList.toggle('collapsed', state.isCollapsed)
    }
    if (elements.collapseBtn) {
      elements.collapseBtn.title = state.isCollapsed ? '展开' : '收起'
    }
    // 收起状态变化时更新律动条
    updateVisualizerState()
  }

  // ============ 律动条动画 ============

  function startVisualizer() {
    if (!elements.visualizerBars || elements.visualizerBars.length === 0) return
    // 添加播放状态类，CSS animation 会自动启动
    elements.visualizerBars.forEach(bar => bar.classList.add('playing'))
  }

  function stopVisualizer() {
    if (elements.visualizerBars) {
      elements.visualizerBars.forEach(bar => {
        bar.classList.remove('playing')
        bar.style.height = '2px'
      })
    }
  }

  function updateVisualizerState() {
    if (state.playing && state.isCollapsed) {
      startVisualizer()
    } else {
      stopVisualizer()
    }
  }

  // ============ 事件监听器 ============
  
  function setupEventListeners() {
    // 播放/暂停按钮
    if (elements.playBtn) {
      elements.playBtn.addEventListener('click', () => {
        console.log('[MusicPlayer] playBtn clicked at', Date.now())
        // 如果当前没有播放（即将开始播放），启动超时检测
        if (!state.playing && !state.playError) {
          startPlayTimeout()
        }
        window.electronAPI.musicTogglePlay()
      })
    }

    // 下一首按钮
    if (elements.nextBtn) {
      elements.nextBtn.addEventListener('click', () => {
        window.electronAPI.musicNext()
      })
    }

    // 上一首按钮
    if (elements.prevBtn) {
      elements.prevBtn.addEventListener('click', () => {
        window.electronAPI.musicPrev()
      })
    }

    // 播放模式切换按钮
    if (elements.modeBtn) {
      elements.modeBtn.addEventListener('click', () => {
        const newMode = state.playMode === 'shuffle' ? 'order' : 'shuffle'
        window.electronAPI.musicSetPlayMode(newMode)
      })
    }

    // 进度条点击
    if (elements.progressBar) {
      elements.progressBar.addEventListener('click', handleProgressClick)
      
      // 进度条拖拽
      if (elements.progressHandle) {
        elements.progressHandle.addEventListener('mousedown', handleProgressDragStart)
      }
    }
    
    // 设备选择按钮
    if (elements.deviceBtn) {
      elements.deviceBtn.addEventListener('click', toggleDeviceList)
    }
    
    // 设备列表点击
    if (elements.deviceList) {
      elements.deviceList.addEventListener('click', handleDeviceClick)
    }
    
    // 音量按钮
    if (elements.volumeBtn) {
      elements.volumeBtn.addEventListener('click', toggleVolumeSlider)
    }
    
    // 音量滑块
    if (elements.volumeRange) {
                      elements.volumeRange.addEventListener('input', handleVolumeInput)
                      // 确保拖动结束时发送最终值
                      elements.volumeRange.addEventListener('change', (e) => {
                        const volume = parseInt(e.target.value, 10) / 100
                        window.electronAPI.musicSetVolume(volume)
                        state.lastVolumeSendTime = Date.now()
                      })
                      // 禁用滑块的键盘控制（方向键），避免和Python快捷键冲突
                      elements.volumeRange.addEventListener('keydown', (e) => {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                          e.preventDefault()
                        }
                      })
                    }    // 点击外部关闭设备列表、音量滑块和播放列表
    document.addEventListener('click', (e) => {
      closeDeviceListOnClickOutside(e)
      closeVolumeSliderOnClickOutside(e)
      closePlaylistOnClickOutside(e)
    })
    
    // 收起/展开按钮
    if (elements.collapseBtn) {
      elements.collapseBtn.addEventListener('click', toggleCollapse)
    }
    
    // 播放列表按钮
    if (elements.playlistBtn) {
      elements.playlistBtn.addEventListener('click', togglePlaylist)
    }
    
    // 播放列表点击
    if (elements.playlistItems) {
      elements.playlistItems.addEventListener('click', handlePlaylistClick)
    }
  }

  function setupIPCListeners() {
    // 监听准备就绪事件
    window.electronAPI.onMusicReady((data) => {
      handlePythonResponse()  // Python 端响应正常
      state.trackName = data.name
      state.duration = data.duration
      state.currentTime = 0
      state.playing = false
      state.hasPrev = data.has_prev || false
      updateProgressUI()
      updatePlayButton()
      updatePrevButton()
      console.log('[MusicPlayer] 收到 ready 事件:', data)
    })

    // 监听状态更新
    window.electronAPI.onMusicStatus((data) => {
      handlePythonResponse()  // Python 端响应正常
      state.playing = data.playing
      state.trackName = data.name
      state.currentTime = data.current
      state.duration = data.duration
      if (data.has_prev !== undefined) {
        state.hasPrev = data.has_prev
      }
      if (data.play_mode !== undefined) {
        state.playMode = data.play_mode
        updateModeButton()
      }
      updateProgressUI()
      updatePlayButton()
      updatePrevButton()
    })

    // 监听曲目切换
    window.electronAPI.onMusicTrackChange((data) => {
      handlePythonResponse()  // Python 端响应正常
      state.trackName = data.name
      state.duration = data.duration
      state.currentTime = 0
      if (data.has_prev !== undefined) {
        state.hasPrev = data.has_prev
      }
      updateProgressUI()
      updatePrevButton()
      // 更新播放列表高亮
      if (state.isPlaylistOpen) {
        window.electronAPI.musicGetPlaylist()
      }
    })

    // 监听播放状态
    window.electronAPI.onMusicPlayState((data) => {
      handlePythonResponse()  // Python 端响应正常
      state.playing = data.playing
      // 成功播放时清除错误状态
      if (data.playing && state.playError) {
        state.playError = null
        updateProgressUI()
      }
      updatePlayButton()
    })

    // 监听进度更新
    window.electronAPI.onMusicProgress((data) => {
      handlePythonResponse()  // Python 端响应正常
      if (!state.isDragging) {
        state.currentTime = data.current
        state.duration = data.duration
        updateProgressUI()
      }
    })
    
    // 监听设备列表更新
    window.electronAPI.onMusicDevices((data) => {
      state.devices = data.devices || []
      state.currentDeviceId = data.current
      renderDeviceList()
    })
    
    // 监听无音乐事件
    window.electronAPI.onMusicNoMusic((data) => {
      handlePythonResponse()  // Python 端响应正常
      state.hasMusic = false
      state.playing = false
      state.trackName = ''
      state.currentTime = 0
      state.duration = 0
      updateProgressUI()
      updatePlayButton()
      console.log('[MusicPlayer] 收到 no_music 事件:', data)
    })
    
    // 监听播放错误事件
    window.electronAPI.onMusicPlayError((data) => {
      handlePythonResponse()  // Python 端响应正常
      state.playing = false
      state.playError = data.message || '播放失败'
      updateProgressUI()
      updatePlayButton()
      console.log('[MusicPlayer] 收到 play_error 事件:', data)
    })
    
    // 监听音量变化事件（来自Python端快捷键）
    window.electronAPI.onMusicVolumeChange((data) => {
      state.volume = data.volume
      updateVolumeUI()
    })
    
    // 监听播放模式变化事件
    window.electronAPI.onMusicPlayMode((data) => {
      state.playMode = data.mode
      updateModeButton()
    })
    
    // 监听播放列表事件
    window.electronAPI.onMusicPlaylist((data) => {
      state.playlist = data.songs || []
      state.currentSongIndex = data.current_index !== undefined ? data.current_index : -1
      renderPlaylist()
    })
    
    // 监听歌曲消失事件
    window.electronAPI.onMusicSongMissing((data) => {
      console.log('[MusicPlayer] 歌曲消失:', data)
      // 可以在这里显示一个临时提示
      if (elements.trackNameEl) {
        const originalText = elements.trackNameEl.textContent
        elements.trackNameEl.textContent = `⚠️ ${data.message || '原歌曲已消失'}`
        elements.trackNameEl.style.color = 'rgba(255, 180, 100, 0.95)'
        setTimeout(() => {
          elements.trackNameEl.style.color = ''
        }, 3000)
      }
    })
    
  }

  // ============ 公共API ============
  
  return {
    /**
     * 初始化音乐播放器
     * @param {object} els - DOM元素引用
     */
    init(els) {
      elements = { ...elements, ...els }
      
      setupEventListeners()
      setupIPCListeners()
      
      // 请求初始状态
      window.electronAPI.musicGetStatus()
      // 请求设备列表
      window.electronAPI.musicGetDevices()
      
      // 初始化模式按钮
      updateModeButton()
      
      console.log('[MusicPlayer] 已初始化')
    },

    /**
     * 获取当前状态
     */
    getState() {
      return { ...state }
    },

    /**
     * 切换播放/暂停
     */
    togglePlay() {
      window.electronAPI.musicTogglePlay()
    },

    /**
     * 下一首
     */
    next() {
      window.electronAPI.musicNext()
    },

    /**
     * 上一首
     */
    prev() {
      window.electronAPI.musicPrev()
    }
  }
})()

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MusicPlayer
}
