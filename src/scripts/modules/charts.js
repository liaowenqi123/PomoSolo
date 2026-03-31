/**
 * 音乐榜单模块 - 渲染进程
 * 负责榜单弹窗的交互和显示
 */

const Charts = (function() {
  'use strict'

  // ============ 状态 ============
  let state = {
    isOpen: false,
    currentSource: 'netease', // 'netease' | 'qq'
    isLoading: false,
    songs: [],
    downloadMode: false, // 下载模式是否开启
    downloadingSongs: new Set() // 正在下载的歌曲
  }

  // ============ DOM 元素引用 ============
  let elements = {
    modal: null,
    closeBtn: null,
    toggle: null,
    labelNetease: null,
    labelQQ: null,
    loading: null,
    error: null,
    tableContainer: null,
    tbody: null,
    refreshBtn: null,
    downloadToggle: null,
    downloadTh: null,
    disclaimerModal: null,
    disclaimerCancelBtn: null,
    disclaimerConfirmBtn: null
  }

  // ============ 渲染函数 ============

  function renderSongs() {
    if (!elements.tbody) return

    if (!state.songs || state.songs.length === 0) {
      const colspan = state.downloadMode ? 5 : 4
      elements.tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">暂无数据</td></tr>`
      return
    }

    const medalClasses = {
      1: 'medal-gold',
      2: 'medal-silver',
      3: 'medal-bronze'
    }

    const html = state.songs.map(song => {
      const rankClass = medalClasses[song.rank] || ''
      const songKey = `${song.title} - ${song.artist}`
      const isDownloading = state.downloadingSongs.has(songKey)
      
      let downloadBtnHtml = ''
      if (state.downloadMode) {
        downloadBtnHtml = `
          <td class="charts-download-td">
            <button class="charts-download-btn ${isDownloading ? 'downloading' : ''}" 
                    data-title="${escapeHtml(song.title)}" 
                    data-artist="${escapeHtml(song.artist)}"
                    ${isDownloading ? 'disabled' : ''}>
              ${isDownloading ? '⏳' : '⬇'}
            </button>
          </td>
        `
      }
      
      return `
        <tr>
          <td class="charts-rank">
            <span class="charts-rank-value ${rankClass}">${song.rank}</span>
          </td>
          <td class="charts-title">
            <span class="charts-song-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</span>
          </td>
          <td class="charts-artist">
            <span class="charts-song-artist" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</span>
          </td>
          <td class="charts-album">
            <span class="charts-song-album" title="${escapeHtml(song.album)}">${escapeHtml(song.album)}</span>
          </td>
          ${downloadBtnHtml}
        </tr>
      `
    }).join('')

    elements.tbody.innerHTML = html
  }

  function escapeHtml(text) {
    if (!text) return ''
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  function updateLoadingState() {
    if (elements.loading) {
      elements.loading.style.display = state.isLoading ? 'flex' : 'none'
    }
    if (elements.tableContainer) {
      elements.tableContainer.style.display = state.isLoading ? 'none' : 'block'
    }
    if (elements.error) {
      elements.error.style.display = 'none'
    }
    if (elements.refreshBtn) {
      elements.refreshBtn.disabled = state.isLoading
    }
  }

  function showError(message) {
    if (elements.loading) {
      elements.loading.style.display = 'none'
    }
    if (elements.tableContainer) {
      elements.tableContainer.style.display = 'none'
    }
    if (elements.error) {
      elements.error.style.display = 'block'
      elements.error.textContent = message || '获取榜单失败，请稍后重试'
    }
  }

  function updateSourceLabels() {
    if (elements.labelNetease) {
      elements.labelNetease.classList.toggle('active', state.currentSource === 'netease')
    }
    if (elements.labelQQ) {
      elements.labelQQ.classList.toggle('active', state.currentSource === 'qq')
    }
    if (elements.toggle) {
      elements.toggle.checked = state.currentSource === 'qq'
    }
  }

  function updateDownloadUI() {
    // 更新下载列表头显示
    if (elements.downloadTh) {
      elements.downloadTh.style.display = state.downloadMode ? 'table-cell' : 'none'
    }
    // 更新拨杆状态
    if (elements.downloadToggle) {
      elements.downloadToggle.checked = state.downloadMode
    }
    // 重新渲染歌曲列表
    renderSongs()
  }

  // ============ 数据获取 ============

  async function fetchCharts() {
    if (state.isLoading) return

    state.isLoading = true
    updateLoadingState()

    try {
      const result = await window.electronAPI.chartsFetch(state.currentSource)
      
      if (result.success && result.songs && result.songs.length > 0) {
        state.songs = result.songs
        renderSongs()
        if (elements.error) {
          elements.error.style.display = 'none'
        }
      } else {
        state.songs = []
        showError(result.error || '获取榜单失败')
      }
    } catch (error) {
      console.error('[Charts] 获取榜单失败:', error)
      showError('网络请求失败，请检查网络连接')
    } finally {
      state.isLoading = false
      updateLoadingState()
    }
  }

  // ============ 下载功能 ============

  async function handleDownload(title, artist) {
    const songKey = `${title} - ${artist}`
    
    if (state.downloadingSongs.has(songKey)) return
    
    state.downloadingSongs.add(songKey)
    renderSongs()
    
    try {
      const result = await window.electronAPI.downloadSong(title, artist)
      
      if (result.success) {
        showDownloadToast(`✅ "${title}" 下载成功`, 'success')
      } else {
        // 根据错误类型显示不同提示
        let errorMsg = result.error || '下载失败'
        if (errorMsg.includes('API Key')) {
          errorMsg = '请先登录或配置 DeepSeek API Key'
        }
        showDownloadToast(`❌ ${errorMsg}`, 'error')
      }
    } catch (error) {
      console.error('[Charts] 下载失败:', error)
      showDownloadToast(`❌ 下载失败: ${error.message}`, 'error')
    } finally {
      state.downloadingSongs.delete(songKey)
      renderSongs()
    }
  }

  function showDownloadToast(message, type) {
    // 简单的提示，可以后续美化
    const existingToast = document.querySelector('.charts-toast')
    if (existingToast) {
      existingToast.remove()
    }
    
    const toast = document.createElement('div')
    toast.className = 'charts-toast'
    toast.textContent = message
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 10px 20px;
      background: ${type === 'success' ? 'rgba(76, 175, 80, 0.9)' : 'rgba(244, 67, 54, 0.9)'};
      color: white;
      border-radius: 8px;
      font-size: 13px;
      z-index: 4000;
      animation: fadeInUp 0.3s ease;
    `
    document.body.appendChild(toast)
    
    setTimeout(() => {
      toast.style.animation = 'fadeOutDown 0.3s ease'
      setTimeout(() => toast.remove(), 300)
    }, 3000)
  }

  // ============ 弹窗控制 ============

  function open() {
    state.isOpen = true
    if (elements.modal) {
      elements.modal.classList.add('open')
    }
    fetchCharts()
  }

  function close() {
    state.isOpen = false
    if (elements.modal) {
      elements.modal.classList.remove('open')
    }
  }

  function toggle() {
    if (state.isOpen) {
      close()
    } else {
      open()
    }
  }

  // ============ 免责声明弹窗 ============

  function showDisclaimer() {
    if (elements.disclaimerModal) {
      elements.disclaimerModal.classList.add('open')
    }
  }

  function hideDisclaimer() {
    if (elements.disclaimerModal) {
      elements.disclaimerModal.classList.remove('open')
    }
  }

  // ============ 事件处理 ============

  function handleToggleChange() {
    state.currentSource = elements.toggle?.checked ? 'qq' : 'netease'
    updateSourceLabels()
    fetchCharts()
  }

  function handleDownloadToggleChange() {
    const isChecked = elements.downloadToggle?.checked
    
    if (isChecked && !state.downloadMode) {
      // 尝试开启下载模式，先显示免责声明，但需要先把拨杆拨回去
      // 延迟显示免责声明，让用户看到拨杆动了
      setTimeout(() => {
        if (elements.downloadToggle) {
          elements.downloadToggle.checked = false
        }
        showDisclaimer()
      }, 50)
    } else if (!isChecked && state.downloadMode) {
      // 关闭下载模式
      state.downloadMode = false
      updateDownloadUI()
    }
  }

  function handleDisclaimerConfirm() {
    state.downloadMode = true
    hideDisclaimer()
    // 先更新拨杆状态
    if (elements.downloadToggle) {
      elements.downloadToggle.checked = true
    }
    // 更新表格头显示并重新渲染
    if (elements.downloadTh) {
      elements.downloadTh.style.display = 'table-cell'
    }
    renderSongs()
  }

  function handleDisclaimerCancel() {
    hideDisclaimer()
    // 拨杆已经在 handleDownloadToggleChange 中被拨回去了
  }

  function handleTableClick(e) {
    const downloadBtn = e.target.closest('.charts-download-btn')
    if (downloadBtn && !downloadBtn.disabled) {
      const title = downloadBtn.dataset.title
      const artist = downloadBtn.dataset.artist
      if (title && artist) {
        handleDownload(title, artist)
      }
    }
  }

  function handleClickOutside(e) {
    if (state.isOpen && elements.modal) {
      if (e.target === elements.modal) {
        close()
      }
    }
  }

  // ============ 初始化 ============

  function setupEventListeners() {
    // 关闭按钮
    if (elements.closeBtn) {
      elements.closeBtn.addEventListener('click', close)
    }

    // 来源切换
    if (elements.toggle) {
      elements.toggle.addEventListener('change', handleToggleChange)
    }

    // 刷新按钮
    if (elements.refreshBtn) {
      elements.refreshBtn.addEventListener('click', fetchCharts)
    }

    // 下载模式拨杆 - 使用 change 事件而非 click
    if (elements.downloadToggle) {
      elements.downloadToggle.addEventListener('change', handleDownloadToggleChange)
    }

    // 免责声明按钮
    if (elements.disclaimerCancelBtn) {
      elements.disclaimerCancelBtn.addEventListener('click', handleDisclaimerCancel)
    }
    if (elements.disclaimerConfirmBtn) {
      elements.disclaimerConfirmBtn.addEventListener('click', handleDisclaimerConfirm)
    }

    // 表格点击（下载按钮）
    if (elements.tbody) {
      elements.tbody.addEventListener('click', handleTableClick)
    }

    // 点击外部关闭
    document.addEventListener('click', handleClickOutside)
  }

  // ============ 公共API ============

  return {
    init(els) {
      elements = { ...elements, ...els }
      setupEventListeners()
      updateSourceLabels()
    },

    open,
    close,
    toggle,
    fetchCharts,

    getState() {
      return { ...state }
    }
  }
})()

window.Charts = Charts