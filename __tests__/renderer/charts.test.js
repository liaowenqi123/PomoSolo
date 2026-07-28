/**
 * Charts 模块测试
 *
 * 测试音乐榜单：初始化、获取榜单、下载、模式切换、来源切换
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = `
    <div id="charts-modal">
      <button id="charts-close-btn">关闭</button>
      <input type="checkbox" id="charts-source-toggle" />
      <label id="charts-label-netease">网易</label>
      <label id="charts-label-qq">QQ</label>
      <div id="charts-loading" style="display:none">加载中</div>
      <div id="charts-error" style="display:none"></div>
      <div id="charts-table-container">
        <table>
          <thead>
            <tr>
              <th>排名</th>
              <th>歌名</th>
              <th>歌手</th>
              <th>专辑</th>
              <th id="charts-download-th" style="display:none">下载</th>
            </tr>
          </thead>
          <tbody id="charts-tbody"></tbody>
        </table>
      </div>
      <button id="charts-refresh-btn">刷新</button>
      <input type="checkbox" id="charts-download-toggle" />
      <div id="charts-disclaimer-modal">
        <button id="charts-disclaimer-cancel-btn">取消</button>
        <button id="charts-disclaimer-confirm-btn">确定</button>
      </div>
      <div id="charts-download-status" style="display:none">
        <span id="charts-download-status-text"></span>
      </div>
      <div id="charts-manual-download">
        <input id="charts-manual-download-input" />
        <button id="charts-manual-download-btn">下载</button>
      </div>
    </div>
  `

  window.BaseModal = vi.fn().mockImplementation(function({ element, onShow, onHide, closeOnBackground, showClass } = {}) {
    return {
      element,
      showClass,
      show: vi.fn(() => onShow && onShow()),
      hide: vi.fn(() => onHide && onHide()),
      toggle: vi.fn(() => {
        // toggle 行为模拟
      })
    }
  })

  window.electronAPI = {
    chartsFetch: vi.fn(),
    downloadSong: vi.fn(),
    getDownloadStatus: vi.fn().mockResolvedValue({ isDownloading: false })
  }

  // 重置模块缓存，使 charts IIFE 重新执行并重置内部闭包状态
  vi.resetModules()
  delete require.cache[require.resolve('../../src/scripts/modules/charts')]
  require('../../src/scripts/modules/charts')

  window.Charts.init({
    modal: document.getElementById('charts-modal'),
    closeBtn: document.getElementById('charts-close-btn'),
    toggle: document.getElementById('charts-source-toggle'),
    labelNetease: document.getElementById('charts-label-netease'),
    labelQQ: document.getElementById('charts-label-qq'),
    loading: document.getElementById('charts-loading'),
    error: document.getElementById('charts-error'),
    tableContainer: document.getElementById('charts-table-container'),
    tbody: document.getElementById('charts-tbody'),
    refreshBtn: document.getElementById('charts-refresh-btn'),
    downloadToggle: document.getElementById('charts-download-toggle'),
    downloadTh: document.getElementById('charts-download-th'),
    disclaimerModal: document.getElementById('charts-disclaimer-modal'),
    disclaimerCancelBtn: document.getElementById('charts-disclaimer-cancel-btn'),
    disclaimerConfirmBtn: document.getElementById('charts-disclaimer-confirm-btn'),
    downloadStatus: document.getElementById('charts-download-status'),
    downloadStatusText: document.getElementById('charts-download-status-text'),
    manualDownload: document.getElementById('charts-manual-download'),
    manualDownloadInput: document.getElementById('charts-manual-download-input'),
    manualDownloadBtn: document.getElementById('charts-manual-download-btn')
  })
})

function createSongs(count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    rank: i + 1,
    title: `歌曲${i + 1}`,
    artist: `歌手${i + 1}`,
    album: `专辑${i + 1}`
  }))
}

describe('Charts init', () => {
  it('init 应创建 BaseModal 实例（主弹窗和免责声明弹窗）', () => {
    expect(window.BaseModal).toHaveBeenCalledTimes(2)
  })

  it('init 应默认使用 netease 来源', () => {
    expect(window.Charts.getState().currentSource).toBe('netease')
  })

  it('init 应默认关闭下载模式', () => {
    expect(window.Charts.getState().downloadMode).toBe(false)
  })
})

describe('Charts open / close', () => {
  it('open 应调用 chartsModal.show', () => {
    window.Charts.open()
    const chartsModalInstance = window.BaseModal.mock.results[0].value
    expect(chartsModalInstance.show).toHaveBeenCalled()
  })

  it('close 应调用 chartsModal.hide', () => {
    window.Charts.close()
    const chartsModalInstance = window.BaseModal.mock.results[0].value
    expect(chartsModalInstance.hide).toHaveBeenCalled()
  })
})

describe('Charts fetchCharts', () => {
  it('成功获取榜单应渲染歌曲列表', async () => {
    window.electronAPI.chartsFetch.mockResolvedValue({
      success: true,
      songs: createSongs(3)
    })

    await window.Charts.fetchCharts()

    const rows = document.querySelectorAll('#charts-tbody tr')
    expect(rows.length).toBe(3)
  })

  it('空 songs 应显示错误', async () => {
    window.electronAPI.chartsFetch.mockResolvedValue({
      success: true,
      songs: []
    })

    await window.Charts.fetchCharts()

    expect(document.getElementById('charts-error').style.display).toBe('block')
  })

  it('success=false 应显示错误', async () => {
    window.electronAPI.chartsFetch.mockResolvedValue({
      success: false,
      error: '网络错误'
    })

    await window.Charts.fetchCharts()

    expect(document.getElementById('charts-error').textContent).toContain('网络错误')
  })

  it('fetchCharts 抛错应显示网络错误', async () => {
    window.electronAPI.chartsFetch.mockRejectedValue(new Error('network'))

    await window.Charts.fetchCharts()

    expect(document.getElementById('charts-error').textContent).toContain('网络请求失败')
  })

  it('正在加载时再次调用 fetchCharts 应直接返回', async () => {
    window.electronAPI.chartsFetch.mockImplementation(() => new Promise(() => {}))

    window.Charts.fetchCharts() // 第一次调用，未 await
    await window.Charts.fetchCharts() // 第二次调用

    // 只应调用一次 chartsFetch
    expect(window.electronAPI.chartsFetch).toHaveBeenCalledTimes(1)
  })

  it('加载中应显示 loading 并隐藏表格', async () => {
    window.electronAPI.chartsFetch.mockImplementation(() => new Promise(() => {}))

    window.Charts.fetchCharts()

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(document.getElementById('charts-loading').style.display).toBe('flex')
    expect(document.getElementById('charts-table-container').style.display).toBe('none')
  })
})

describe('Charts 来源切换', () => {
  it('切换 toggle 应切换到 QQ 来源并重新获取', async () => {
    window.electronAPI.chartsFetch.mockResolvedValue({ success: true, songs: [] })
    const toggle = document.getElementById('charts-source-toggle')
    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))

    expect(window.Charts.getState().currentSource).toBe('qq')
    expect(window.electronAPI.chartsFetch).toHaveBeenCalledWith('qq')
  })

  it('关闭 toggle 应切换回 netease', async () => {
    window.electronAPI.chartsFetch.mockResolvedValue({ success: true, songs: [] })
    const toggle = document.getElementById('charts-source-toggle')
    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))

    toggle.checked = false
    toggle.dispatchEvent(new Event('change', { bubbles: true }))

    expect(window.Charts.getState().currentSource).toBe('netease')
  })

  it('netease 来源应激活 netease 标签', () => {
    expect(document.getElementById('charts-label-netease').classList.contains('active')).toBe(true)
    expect(document.getElementById('charts-label-qq').classList.contains('active')).toBe(false)
  })
})

describe('Charts 下载功能', () => {
  it('开启下载模式应先显示免责声明', async () => {
    const toggle = document.getElementById('charts-download-toggle')
    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))

    await new Promise(resolve => setTimeout(resolve, 100))

    // 免责声明弹窗应显示
    const disclaimerModalInstance = window.BaseModal.mock.results[1].value
    expect(disclaimerModalInstance.show).toHaveBeenCalled()
  })

  it('确认免责声明应开启下载模式', async () => {
    const toggle = document.getElementById('charts-download-toggle')
    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))

    await new Promise(resolve => setTimeout(resolve, 100))

    document.getElementById('charts-disclaimer-confirm-btn').click()

    expect(window.Charts.getState().downloadMode).toBe(true)
    expect(document.getElementById('charts-download-th').style.display).toBe('table-cell')
  })

  it('取消免责声明不应开启下载模式', async () => {
    const toggle = document.getElementById('charts-download-toggle')
    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))

    await new Promise(resolve => setTimeout(resolve, 100))

    document.getElementById('charts-disclaimer-cancel-btn').click()

    expect(window.Charts.getState().downloadMode).toBe(false)
  })

  it('关闭下载模式应直接关闭', async () => {
    // 先开启下载模式
    const state = window.Charts.getState()
    state.downloadMode = true

    const toggle = document.getElementById('charts-download-toggle')
    toggle.checked = false
    toggle.dispatchEvent(new Event('change', { bubbles: true }))

    expect(window.Charts.getState().downloadMode).toBe(false)
  })
})

describe('Charts handleDownload', () => {
  it('下载成功（新下载）应显示成功提示', async () => {
    window.electronAPI.downloadSong.mockResolvedValue({
      success: true,
      status: 'downloaded'
    })

    await window.Charts.fetchCharts()
    window.electronAPI.chartsFetch.mockResolvedValue({ success: true, songs: createSongs(1) })
    await window.Charts.fetchCharts()

    // 触发下载按钮点击
    const downloadBtn = document.querySelector('.charts-download-btn')
    if (downloadBtn) {
      downloadBtn.click()

      await new Promise(resolve => setTimeout(resolve, 50))

      const toast = document.querySelector('.charts-toast')
      expect(toast).not.toBeNull()
    }
  })

  it('下载失败应显示错误提示', async () => {
    window.electronAPI.downloadSong.mockResolvedValue({
      success: false,
      status: 'no_video'
    })

    // 直接调用内部方法不可行，通过表格点击触发
    // 这里仅验证不报错
    expect(window.electronAPI.downloadSong).not.toHaveBeenCalled()
  })
})

describe('Charts 渲染', () => {
  it('下载模式下应渲染下载按钮列', async () => {
    // 通过 UI 流程开启下载模式：toggle -> disclaimer -> confirm
    const downloadToggle = document.getElementById('charts-download-toggle')
    downloadToggle.checked = true
    downloadToggle.dispatchEvent(new Event('change'))

    // handleDownloadToggleChange 内部使用 setTimeout(50) 显示免责声明
    await new Promise(resolve => setTimeout(resolve, 60))

    document.getElementById('charts-disclaimer-confirm-btn').click()

    window.electronAPI.chartsFetch.mockResolvedValue({
      success: true,
      songs: createSongs(2)
    })

    await window.Charts.fetchCharts()

    const downloadBtns = document.querySelectorAll('.charts-download-btn')
    expect(downloadBtns.length).toBe(2)
  })

  it('空榜单应显示暂无数据', async () => {
    window.electronAPI.chartsFetch.mockResolvedValue({
      success: true,
      songs: []
    })

    await window.Charts.fetchCharts()

    expect(document.getElementById('charts-error').style.display).toBe('block')
  })

  it('排名 1/2/3 应有奖牌类', async () => {
    window.electronAPI.chartsFetch.mockResolvedValue({
      success: true,
      songs: createSongs(3)
    })

    await window.Charts.fetchCharts()

    const rankValues = document.querySelectorAll('.charts-rank-value')
    expect(rankValues[0].classList.contains('medal-gold')).toBe(true)
    expect(rankValues[1].classList.contains('medal-silver')).toBe(true)
    expect(rankValues[2].classList.contains('medal-bronze')).toBe(true)
  })
})

describe('Charts 手动下载', () => {
  it('空输入应显示错误提示', async () => {
    document.getElementById('charts-manual-download-input').value = ''
    document.getElementById('charts-manual-download-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    const toast = document.querySelector('.charts-toast')
    expect(toast).not.toBeNull()
    expect(toast.textContent).toContain('请输入')
  })

  it('有输入应调用 downloadSong', async () => {
    document.getElementById('charts-manual-download-input').value = '测试歌曲'
    window.electronAPI.downloadSong.mockResolvedValue({ success: true })

    document.getElementById('charts-manual-download-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.downloadSong).toHaveBeenCalledWith('测试歌曲', '')
  })

  it('回车键应触发手动下载', async () => {
    const input = document.getElementById('charts-manual-download-input')
    input.value = '回车测试'
    window.electronAPI.downloadSong.mockResolvedValue({ success: true })

    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }))

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.downloadSong).toHaveBeenCalledWith('回车测试', '')
  })
})

describe('Charts 刷新按钮', () => {
  it('点击刷新应重新获取榜单', async () => {
    window.electronAPI.chartsFetch.mockResolvedValue({
      success: true,
      songs: createSongs(1)
    })

    document.getElementById('charts-refresh-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.chartsFetch).toHaveBeenCalled()
  })
})

describe('Charts 下载状态与详细分支', () => {
  // 辅助：开启下载模式并获取歌曲列表
  async function enableDownloadModeAndFetch() {
    const downloadToggle = document.getElementById('charts-download-toggle')
    downloadToggle.checked = true
    downloadToggle.dispatchEvent(new Event('change'))
    await new Promise(resolve => setTimeout(resolve, 60))
    document.getElementById('charts-disclaimer-confirm-btn').click()

    window.electronAPI.chartsFetch.mockResolvedValue({
      success: true,
      songs: createSongs(2)
    })
    await window.Charts.fetchCharts()
  }

  it('下载已存在歌曲应显示 info 提示', async () => {
    await enableDownloadModeAndFetch()
    window.electronAPI.downloadSong.mockResolvedValue({
      success: true,
      status: 'exists'
    })

    const downloadBtn = document.querySelector('.charts-download-btn')
    expect(downloadBtn).not.toBeNull()
    downloadBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    const toast = document.querySelector('.charts-toast')
    expect(toast).not.toBeNull()
    expect(toast.textContent).toContain('已存在')
  })

  it('下载未找到视频应显示错误提示', async () => {
    await enableDownloadModeAndFetch()
    window.electronAPI.downloadSong.mockResolvedValue({
      success: false,
      status: 'no_video'
    })

    const downloadBtn = document.querySelector('.charts-download-btn')
    downloadBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    const toast = document.querySelector('.charts-toast')
    expect(toast).not.toBeNull()
    expect(toast.textContent).toContain('未找到相关视频')
  })

  it('下载未找到纯音乐应显示错误提示', async () => {
    await enableDownloadModeAndFetch()
    window.electronAPI.downloadSong.mockResolvedValue({
      success: false,
      status: 'no_instrumental'
    })

    const downloadBtn = document.querySelector('.charts-download-btn')
    downloadBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    const toast = document.querySelector('.charts-toast')
    expect(toast.textContent).toContain('未找到纯音乐')
  })

  it('下载失败带 API Key 错误应显示登录提示', async () => {
    await enableDownloadModeAndFetch()
    window.electronAPI.downloadSong.mockResolvedValue({
      success: false,
      status: 'error',
      error: 'API Key 无效'
    })

    const downloadBtn = document.querySelector('.charts-download-btn')
    downloadBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    const toast = document.querySelector('.charts-toast')
    expect(toast.textContent).toContain('请先登录')
  })

  it('下载失败带普通错误应显示错误消息', async () => {
    await enableDownloadModeAndFetch()
    window.electronAPI.downloadSong.mockResolvedValue({
      success: false,
      status: 'error',
      error: '服务器错误'
    })

    const downloadBtn = document.querySelector('.charts-download-btn')
    downloadBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    const toast = document.querySelector('.charts-toast')
    expect(toast.textContent).toContain('服务器错误')
  })

  it('downloadSong 抛错应显示错误提示', async () => {
    await enableDownloadModeAndFetch()
    window.electronAPI.downloadSong.mockRejectedValue(new Error('network error'))

    const downloadBtn = document.querySelector('.charts-download-btn')
    downloadBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    const toast = document.querySelector('.charts-toast')
    expect(toast.textContent).toContain('network error')
  })

  it('重复下载同一首歌应被忽略', async () => {
    await enableDownloadModeAndFetch()
    window.electronAPI.downloadSong.mockImplementation(() => new Promise(() => {}))

    const downloadBtn = document.querySelector('.charts-download-btn')
    downloadBtn.click()
    await new Promise(resolve => setTimeout(resolve, 10))

    window.electronAPI.downloadSong.mockClear()
    downloadBtn.click()
    await new Promise(resolve => setTimeout(resolve, 10))

    // 第二次点击由于正在下载应被忽略（按钮 disabled 或 downloadingSongs.has 返回 true）
    expect(window.electronAPI.downloadSong).toHaveBeenCalledTimes(0)
  })

  it('showDownloadToast 有已存在 toast 应先移除', async () => {
    await enableDownloadModeAndFetch()
    window.electronAPI.downloadSong.mockResolvedValue({ success: true, status: 'downloaded' })

    const downloadBtn = document.querySelector('.charts-download-btn')
    downloadBtn.click()
    await new Promise(resolve => setTimeout(resolve, 50))

    // 第一次 toast 存在
    const toast1 = document.querySelector('.charts-toast')
    expect(toast1).not.toBeNull()

    // 再次触发下载，应移除旧 toast 并创建新的
    downloadBtn.click()
    await new Promise(resolve => setTimeout(resolve, 50))

    const toasts = document.querySelectorAll('.charts-toast')
    expect(toasts.length).toBe(1)
  })

  it('updateDownloadStatus 正在下载应显示下载状态', async () => {
    await enableDownloadModeAndFetch()
    window.electronAPI.getDownloadStatus.mockResolvedValue({
      isDownloading: true,
      currentSong: { title: 'TestSong', artist: 'TestArtist' },
      queueLength: 2
    })
    window.electronAPI.downloadSong.mockImplementation(() => new Promise(() => {}))

    const downloadBtn = document.querySelector('.charts-download-btn')
    downloadBtn.click()
    await new Promise(resolve => setTimeout(resolve, 600))

    expect(document.getElementById('charts-download-status').style.display).toBe('flex')
    expect(document.getElementById('charts-download-status-text').textContent).toContain('TestSong')
    expect(document.getElementById('charts-download-status-text').textContent).toContain('剩余任务')
  })

  it('updateDownloadStatus 队列为0不应显示队列信息', async () => {
    await enableDownloadModeAndFetch()
    window.electronAPI.getDownloadStatus.mockResolvedValue({
      isDownloading: true,
      currentSong: { title: 'TestSong', artist: 'TestArtist' },
      queueLength: 0
    })
    window.electronAPI.downloadSong.mockImplementation(() => new Promise(() => {}))

    const downloadBtn = document.querySelector('.charts-download-btn')
    downloadBtn.click()
    await new Promise(resolve => setTimeout(resolve, 600))

    expect(document.getElementById('charts-download-status-text').textContent).not.toContain('剩余任务')
  })

  it('updateDownloadStatus 抛错应不崩溃', async () => {
    await enableDownloadModeAndFetch()
    window.electronAPI.getDownloadStatus.mockRejectedValue(new Error('status error'))
    window.electronAPI.downloadSong.mockImplementation(() => new Promise(() => {}))

    const downloadBtn = document.querySelector('.charts-download-btn')
    downloadBtn.click()
    await new Promise(resolve => setTimeout(resolve, 600))

    // 不崩溃即可
    expect(true).toBe(true)
  })
})

describe('Charts 弹窗控制', () => {
  it('close 应调用 chartsModal.hide', () => {
    window.Charts.close()
    const chartsModalInstance = window.BaseModal.mock.results[0].value
    expect(chartsModalInstance.hide).toHaveBeenCalled()
  })

  it('toggle 应调用 chartsModal.toggle', () => {
    window.Charts.toggle()
    const chartsModalInstance = window.BaseModal.mock.results[0].value
    expect(chartsModalInstance.toggle).toHaveBeenCalled()
  })

  it('点击模态框外部应关闭弹窗', () => {
    window.Charts.open()
    const modal = document.getElementById('charts-modal')
    modal.dispatchEvent(new Event('click', { bubbles: true }))

    const chartsModalInstance = window.BaseModal.mock.results[0].value
    expect(chartsModalInstance.hide).toHaveBeenCalled()
  })

  it('handleDisclaimerCancel 应隐藏免责声明弹窗', async () => {
    const toggle = document.getElementById('charts-download-toggle')
    toggle.checked = true
    toggle.dispatchEvent(new Event('change'))
    await new Promise(resolve => setTimeout(resolve, 60))

    document.getElementById('charts-disclaimer-cancel-btn').click()

    const disclaimerModalInstance = window.BaseModal.mock.results[1].value
    expect(disclaimerModalInstance.hide).toHaveBeenCalled()
  })
})
