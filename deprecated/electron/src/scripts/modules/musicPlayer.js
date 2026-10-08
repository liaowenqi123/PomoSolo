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
    playMode: 'shuffle',  // 播放模式：'shuffle' 随机 | 'order' 顺序 | 'loop' 单曲循环
    playlist: [],  // 播放列表
    playlistTags: {},  // 歌曲标签映射 { songName: tag }
    customTags: {},  // 自定义标签配置 { tagName: color }
    currentSongIndex: -1,  // 当前歌曲在列表中的索引
    isPlaylistOpen: false  // 播放列表弹窗是否打开
  }
  
  // 弹窗实例
  let tagSelectModal = null
  let deleteSongModal = null
  
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
    playlistItems: null,
    refreshBtn: null
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
        elements.modeBtn.title = '随机播放（点击切换顺序）'
        elements.modeBtn.classList.add('active')
      } else if (state.playMode === 'order') {
        elements.modeBtn.textContent = '🔁'
        elements.modeBtn.title = '顺序播放（点击切换单曲循环）'
        elements.modeBtn.classList.remove('active')
      } else {
        // loop 模式 - 使用不同的图标
        elements.modeBtn.textContent = '🔂'
        elements.modeBtn.title = '单曲循环（点击切换随机播放）'
        elements.modeBtn.classList.add('active')
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
  
  function refreshPlaylist() {
    if (!elements.refreshBtn) return
    
    // 添加旋转动画
    elements.refreshBtn.classList.add('refreshing')
    
    // 请求刷新播放列表
    window.electronAPI.musicGetPlaylist()
    
    // 500ms后移除动画
    setTimeout(() => {
      if (elements.refreshBtn) {
        elements.refreshBtn.classList.remove('refreshing')
      }
    }, 500)
  }
  
  /**
   * HEX 转 RGBA
   */
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  
  /**
   * 颜色变亮
   */
  function lightenColor(hex, amount) {
    const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + Math.round(255 * amount))
    const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + Math.round(255 * amount))
    const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + Math.round(255 * amount))
    return `rgb(${r}, ${g}, ${b})`
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
      
      // 判断是否是番茄钟内置歌曲（不允许删除）
      const isBuiltIn = displayName.endsWith(' - 番茄钟')
      
      // 获取标签数据 {name, color}
      const tagData = state.playlistTags[song] || { name: '自定义', color: null }
      const tagName = tagData.name || '自定义'
      const tagColor = tagData.color
      
      // 检查是否是自定义标签
      const isCustomTag = state.customTags[tagName]
      
      let tagStyle = ''
      if (tagColor) {
        // 使用存储的颜色
        tagStyle = `style="background: ${hexToRgba(tagColor, 0.3)}; color: ${lightenColor(tagColor, 0.3)};"`
      } else if (isCustomTag) {
        // 自定义标签使用定义的颜色
        const color = state.customTags[tagName]
        tagStyle = `style="background: ${hexToRgba(color, 0.3)}; color: ${lightenColor(color, 0.3)};"`
      }
      
      // 垃圾桶 SVG 图标
      const trashIcon = `<svg class="trash-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>`
      
      return `<div class="${classes.join(' ')}" data-song="${song}" data-index="${index}">
        <span class="playlist-item-tag" data-tag="${tagName}" data-song="${song}" ${tagStyle}>${tagName}</span>
        <span class="playlist-item-name">${displayName}</span>
        <div class="playlist-item-actions">
          ${isCurrent ? '<span class="playlist-item-playing">▶</span>' : ''}
          ${!isBuiltIn ? `<button class="playlist-item-delete" data-song="${song}" title="删除">${trashIcon}</button>` : ''}
        </div>
      </div>`
    }).join('')
    
    elements.playlistItems.innerHTML = html
  }
  
  function handlePlaylistClick(e) {
    // 检查是否点击标签
    const tagEl = e.target.closest('.playlist-item-tag')
    if (tagEl) {
      e.stopPropagation()
      const songName = tagEl.dataset.song
      
      // 检查是否是内置歌曲（不允许更改标签）
      const displayName = songName.replace(/\.[^/.]+$/, '')
      if (displayName.endsWith(' - 番茄钟')) {
        showToast('内置歌曲标签不可更改')
        return
      }
      
      const currentTag = tagEl.dataset.tag
      showTagSelector(songName, currentTag)
      return
    }
    
    // 检查是否点击删除按钮
    const deleteBtn = e.target.closest('.playlist-item-delete')
    if (deleteBtn) {
      e.stopPropagation()
      const songName = deleteBtn.dataset.song
      
      // 检查是否是当前已加载的歌曲（不管是否在播放）
      if (songName === state.trackName) {
        showToast('无法删除当前已加载的歌曲')
        return
      }
      
      // 显示确认弹窗
      showDeleteConfirm(songName)
      return
    }
    
    // 点击歌曲项，切换播放
    const item = e.target.closest('.playlist-item')
    if (!item) return
    
    const songName = item.dataset.song
    if (songName && songName !== state.trackName) {
      window.electronAPI.musicPlaySong(songName)
    }
  }
  
  // 预设标签列表
  const PRESET_TAGS = ['学习', '运动', '休息']
  
  // 预设颜色列表（9个标准颜色）
  const PRESET_COLORS = [
    '#ff6b6b', // 红色
    '#ff9f43', // 橙色
    '#feca57', // 黄色
    '#5cd85c', // 绿色
    '#48dbfb', // 青色
    '#5f9df7', // 蓝色
    '#a55eea', // 紫色
    '#ff6b9d', // 粉色
    '#8c8c8c'  // 灰色
  ]
  
  // 当前选中的预设颜色
  let selectedColor = PRESET_COLORS[0]
  
  /**
   * HSL 转 HEX
   */
  function hslToHex(h, s, l) {
    s /= 100
    l /= 100
    const a = s * Math.min(l, 1 - l)
    const f = n => {
      const k = (n + h / 30) % 12
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
      return Math.round(255 * color).toString(16).padStart(2, '0')
    }
    return `#${f(0)}${f(8)}${f(4)}`
  }
  
  /**
   * HEX 转 HSL
   */
  function hexToHsl(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255
    let g = parseInt(hex.slice(3, 5), 16) / 255
    let b = parseInt(hex.slice(5, 7), 16) / 255
    
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    let h, s, l = (max + min) / 2

    if (max === min) {
      h = s = 0
    } else {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
        case g: h = ((b - r) / d + 2) / 6; break
        case b: h = ((r - g) / d + 4) / 6; break
      }
    }
    
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
  }
  
  /**
   * 显示标签选择弹窗
   */
  function showTagSelector(songName, currentTag) {
    const modal = document.getElementById('tag-select-modal')
    const songNameEl = document.getElementById('tag-select-song-name')
    const optionsEl = document.getElementById('tag-options')
    const customInput = document.getElementById('tag-custom-input')
    const colorPicker = document.getElementById('tag-color-picker')
    const colorPresetsEl = document.getElementById('tag-color-presets')
    const addBtn = document.getElementById('tag-add-btn')
    const customColorPicker = document.getElementById('tag-custom-color-picker')
    const colorHueSlider = document.getElementById('color-hue-slider')
    const colorPreview = document.getElementById('color-picker-preview')
    
    if (!modal || !songNameEl || !optionsEl) return
    
    // 创建弹窗实例（如果还没有）
    if (!tagSelectModal) {
      tagSelectModal = new BaseModal({
        element: modal,
        showClass: 'show',
        closeOnBackground: true
      })
    }
    
    // 显示歌曲名
    const displayName = songName.replace(/\.[^/.]+$/, '')
    songNameEl.textContent = displayName
    
    // 获取当前标签数据
    const currentTagData = state.playlistTags[songName] || { name: '自定义', color: null }
    const currentTagName = currentTagData.name || (typeof currentTagData === 'string' ? currentTagData : '自定义')
    
    // 合并预设标签和自定义标签
    const allTags = [...PRESET_TAGS, ...Object.keys(state.customTags)]
    
    // 生成标签选项
    optionsEl.innerHTML = allTags.map(tag => {
      const isCustom = state.customTags[tag]
      const isActive = tag === currentTagName
      let style = ''
      let deleteBtn = ''
      if (isCustom) {
        // 自定义标签使用存储的颜色
        const color = state.customTags[tag]
        style = `style="background: ${hexToRgba(color, 0.4)}; color: ${lightenColor(color, 0.3)};"`
        // 自定义标签添加删除按钮
        deleteBtn = `<span class="tag-delete-btn" data-tag="${tag}">×</span>`
      }
      return `<button class="tag-option ${isActive ? 'active' : ''}" data-tag="${tag}" ${style}>${tag}${deleteBtn}</button>`
    }).join('')
    
    // 绑定删除按钮事件
    optionsEl.querySelectorAll('.tag-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const tagToDelete = btn.dataset.tag
        await deleteCustomTag(tagToDelete, songName, currentTagName)
      })
    })
    
    // 生成预设颜色按钮
    if (colorPresetsEl) {
      // 从 DataStore 读取最新的高级颜色自定义设置（确保立即生效）
      const settings = window.DataStore ? window.DataStore.getSettings() : {}
      const advancedColorEnabled = settings.advancedColorCustomization || false
      
      // 始终显示颜色按钮区域
      colorPresetsEl.style.display = 'flex'
      
      // 生成预设颜色按钮
      let colorButtons = PRESET_COLORS.map((color, index) => 
        `<div class="tag-color-preset ${color === selectedColor ? 'active' : ''}" 
             data-color="${color}" 
             style="background: ${color};">
         </div>`
      ).join('')
      
      // 高级模式：添加第10个颜色按钮（调色盘图标）
      if (advancedColorEnabled) {
        colorButtons += `<div class="tag-color-preset tag-color-advanced" 
             id="tag-color-advanced-btn" 
             style="background: ${selectedColor};">
           <span class="tag-color-picker-icon">🎨</span>
         </div>`
      }
      
      colorPresetsEl.innerHTML = colorButtons
      
      // 绑定预设颜色选择事件
      colorPresetsEl.querySelectorAll('.tag-color-preset:not(.tag-color-advanced)').forEach(preset => {
        preset.addEventListener('click', () => {
          colorPresetsEl.querySelectorAll('.tag-color-preset').forEach(p => p.classList.remove('active'))
          preset.classList.add('active')
          selectedColor = preset.dataset.color
          // 隐藏自定义颜色选择器
          if (customColorPicker) customColorPicker.style.display = 'none'
        })
      })
      
      // 高级模式：绑定调色盘按钮事件
      if (advancedColorEnabled) {
        const advancedBtn = document.getElementById('tag-color-advanced-btn')
        if (advancedBtn && customColorPicker) {
          advancedBtn.addEventListener('click', () => {
            // 切换自定义颜色选择器的显示
            const isVisible = customColorPicker.style.display !== 'none'
            if (isVisible) {
              customColorPicker.style.display = 'none'
            } else {
              // 计算调色盘按钮的位置，让调色盘显示在按钮右边
              const btnRect = advancedBtn.getBoundingClientRect()
              customColorPicker.style.position = 'fixed'
              customColorPicker.style.top = `${btnRect.top + btnRect.height / 2 - 40}px`
              customColorPicker.style.left = `${btnRect.right + 8}px`
              customColorPicker.style.transform = 'none'
              customColorPicker.style.display = 'block'
              // 选中调色盘按钮
              colorPresetsEl.querySelectorAll('.tag-color-preset').forEach(p => p.classList.remove('active'))
              advancedBtn.classList.add('active')
              // 初始化滑块和预览（确保颜色正确显示）
              const hsl = hexToHsl(selectedColor)
              if (colorHueSlider) {
                colorHueSlider.value = hsl.h
                // 根据滑块位置重新计算颜色，确保预览和滑块同步
                const color = hslToHex(parseInt(colorHueSlider.value), 80, 55)
                if (colorPreview) colorPreview.style.background = color
                selectedColor = color
              }
            }
          })
        }
      }
    }
    
    // 自定义颜色选择器事件
    if (colorHueSlider && colorPreview) {
      colorHueSlider.addEventListener('input', () => {
        const hue = parseInt(colorHueSlider.value)
        const color = hslToHex(hue, 80, 55)
        colorPreview.style.background = color
        selectedColor = color
        
        // 更新高级按钮的背景色
        const advancedBtn = document.getElementById('tag-color-advanced-btn')
        if (advancedBtn) advancedBtn.style.background = color
        
        // 更新选中状态
        colorPresetsEl.querySelectorAll('.tag-color-preset').forEach(p => p.classList.remove('active'))
        if (advancedBtn) advancedBtn.classList.add('active')
      })
    }
    
    // 隐藏自定义颜色选择器
    if (customColorPicker) customColorPicker.style.display = 'none'
    
    // 清空输入框
    if (customInput) customInput.value = ''
    
    // 点击标签选项
    optionsEl.querySelectorAll('.tag-option').forEach(opt => {
      opt.addEventListener('click', async (e) => {
        // 检查是否点击删除按钮
        if (e.target.classList.contains('tag-delete-btn')) return
        
        const newTag = opt.dataset.tag
        if (newTag !== currentTagName) {
          // 确定颜色：自定义标签用自定义颜色，预设标签用选中颜色
          let color = null
          if (state.customTags[newTag]) {
            color = state.customTags[newTag]
          } else if (!PRESET_TAGS.includes(newTag)) {
            // 新添加的自定义标签使用选中的颜色
            color = selectedColor
          }
          await updateSongTag(songName, newTag, color)
        }
        tagSelectModal.hide()
      })
    })
    
    // 添加自定义标签
    if (addBtn && customInput) {
      // 移除旧的事件监听器
      const newAddBtn = addBtn.cloneNode(true)
      addBtn.parentNode.replaceChild(newAddBtn, addBtn)
      
      newAddBtn.addEventListener('click', async () => {
        const tagName = customInput.value.trim()
        // 从 DataStore 读取最新的高级颜色自定义设置
        const settings = window.DataStore ? window.DataStore.getSettings() : {}
        const advancedColorEnabled = settings.advancedColorCustomization || false
        const color = selectedColor
        
        if (!tagName) {
          showToast('请输入标签名称')
          return
        }
        
        if (tagName.length > 3) {
          showToast('标签名称不能超过3个字')
          return
        }
        
        // 检查是否已存在
        if (PRESET_TAGS.includes(tagName) || state.customTags[tagName]) {
          showToast('标签已存在')
          return
        }
        
        // 添加自定义标签
        const result = await window.electronAPI.musicAddCustomTag(tagName, color)
        if (result.success) {
          state.customTags[tagName] = color
          // 直接选中新添加的标签（使用自定义标签的颜色）
          await updateSongTag(songName, tagName, color)
          tagSelectModal.hide()
        } else {
          showToast(result.error || '添加失败')
        }
      })
    }
    
    // 显示弹窗
    tagSelectModal.show()
  }
  
  /**
   * 删除自定义标签
   */
  async function deleteCustomTag(tagName, songName, currentTag) {
    try {
      const result = await window.electronAPI.musicDeleteCustomTag(tagName)
      if (result.success) {
        delete state.customTags[tagName]
        // 刷新弹窗
        showTagSelector(songName, currentTag)
        showToast('标签已删除')
      } else {
        showToast(result.error || '删除失败')
      }
    } catch (err) {
      showToast('删除失败')
    }
  }
  
  /**
   * 更新歌曲标签
   */
  async function updateSongTag(songName, newTag, color) {
    try {
      const result = await window.electronAPI.musicUpdateTag(songName, newTag, color)
      if (result.success) {
        state.playlistTags[songName] = { name: newTag, color: color }
        renderPlaylist()
        showToast('标签已更新')
      } else {
        showToast(result.error || '更新失败')
      }
    } catch (err) {
      showToast('更新失败')
    }
  }
  
  /**
   * 删除歌曲
   */
  async function deleteSong(songName) {
    try {
      const result = await window.electronAPI.musicDeleteSong(songName)
      if (result.success) {
        showToast('已删除')
        // 刷新列表
        window.electronAPI.musicGetPlaylist()
      } else {
        showToast(result.error || '删除失败')
      }
    } catch (err) {
      showToast('删除失败')
    }
  }
  
  /**
   * 显示提示
   */
  function showToast(message) {
    const toast = document.getElementById('music-toast')
    if (!toast) return
    
    toast.textContent = message
    toast.classList.add('show')
    
    setTimeout(() => {
      toast.classList.remove('show')
    }, 1500)
  }
  
  /**
   * 显示删除确认弹窗
   */
  function showDeleteConfirm(songName) {
    const modal = document.getElementById('delete-song-modal')
    const message = document.getElementById('delete-song-message')
    const cancelBtn = document.getElementById('delete-song-cancel-btn')
    const confirmBtn = document.getElementById('delete-song-ok-btn')
    
    if (!modal || !message || !cancelBtn || !confirmBtn) return
    
    // 创建弹窗实例（如果还没有）
    if (!deleteSongModal) {
      deleteSongModal = new BaseModal({
        element: modal,
        showClass: 'show',
        closeOnBackground: true
      })
    }
    
    // 显示歌曲名
    const displayName = songName.replace(/\.[^/.]+$/, '')
    message.textContent = `确定要删除「${displayName}」吗？`
    
    // 移除旧的事件监听器（通过克隆节点）
    const newCancelBtn = cancelBtn.cloneNode(true)
    const newConfirmBtn = confirmBtn.cloneNode(true)
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn)
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn)
    
    // 取消按钮
    newCancelBtn.addEventListener('click', () => {
      deleteSongModal.hide()
    })
    
    // 确认按钮
    newConfirmBtn.addEventListener('click', () => {
      deleteSongModal.hide()
      deleteSong(songName)
    })
    
    // 显示弹窗
    deleteSongModal.show()
  }
  
  function closePlaylistOnClickOutside(e) {
    if (state.isPlaylistOpen && elements.playlistBtn && elements.playlistPanel) {
      // 检查标签弹窗是否打开，如果打开则不关闭播放列表
      const tagModal = document.getElementById('tag-select-modal')
      if (tagModal && tagModal.classList.contains('show')) {
        return
      }
      
      // 检查删除确认弹窗是否打开
      const deleteModal = document.getElementById('delete-song-modal')
      if (deleteModal && deleteModal.classList.contains('show')) {
        return
      }
      
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
      
      // 保存音量到本地存储
      saveVolumeToStorage(volume)
    }
  }
  
  /**
   * 保存音量到本地存储
   */
  async function saveVolumeToStorage(volume) {
    try {
      const data = await window.electronAPI.readData()
      if (data && data.musicVolume !== volume) {
        data.musicVolume = volume
        await window.electronAPI.writeData(data)
      }
    } catch (err) {
      console.error('[MusicPlayer] 保存音量失败:', err)
    }
  }
  
  /**
   * 加载保存的音量
   */
  async function loadSavedVolume() {
    try {
      const data = await window.electronAPI.readData()
      if (data && data.musicVolume !== undefined) {
        state.volume = data.musicVolume
        updateVolumeUI()
        
        // 同步到 Python
        window.electronAPI.musicSetVolume(state.volume)
      }
    } catch (err) {
      console.error('[MusicPlayer] 加载音量失败:', err)
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
  
  async function setupEventListeners() {
    // 加载保存的音量
    await loadSavedVolume()
    
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
        // 循环切换：shuffle -> order -> loop -> shuffle
        let newMode
        if (state.playMode === 'shuffle') {
          newMode = 'order'
        } else if (state.playMode === 'order') {
          newMode = 'loop'
        } else {
          newMode = 'shuffle'
        }
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
    
    // 刷新按钮
    if (elements.refreshBtn) {
      elements.refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        refreshPlaylist()
      })
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
      // 新格式：[{name, tag, tagColor}]
      if (data.songs && data.songs.length > 0 && typeof data.songs[0] === 'object') {
        state.playlist = data.songs.map(s => s.name)
        state.playlistTags = {}
        data.songs.forEach(s => {
          if (s.name) {
            state.playlistTags[s.name] = {
              name: s.tag || '自定义',
              color: s.tagColor || null
            }
          }
        })
      } else {
        state.playlist = data.songs || []
      }
      state.currentSongIndex = data.current_index !== undefined ? data.current_index : -1
      // 同步当前歌曲名（用于高亮）
      if (data.current_song !== undefined) {
        state.trackName = data.current_song
      }
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
    async init(els) {
      elements = { ...elements, ...els }
      
      await setupEventListeners()
      setupIPCListeners()
      
      // 请求初始状态
      window.electronAPI.musicGetStatus()
      // 请求设备列表
      window.electronAPI.musicGetDevices()
      
      // 加载自定义标签配置
      try {
        const result = await window.electronAPI.musicGetCustomTags()
        if (result.customTags) {
          state.customTags = result.customTags
        }
      } catch (e) {
        console.log('[MusicPlayer] 加载自定义标签失败:', e)
      }
      
      // 读取高级颜色自定义设置
      try {
        const settings = DataStore.getSettings()
        state.advancedColorCustomization = settings.advancedColorCustomization || false
      } catch (e) {
        state.advancedColorCustomization = false
      }
      
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
    },
    
    /**
     * 更新高级颜色自定义设置
     */
    setAdvancedColorCustomization(enabled) {
      state.advancedColorCustomization = enabled
    }
  }
})()

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MusicPlayer
}
