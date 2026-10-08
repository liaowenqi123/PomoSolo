/**
 * DOM 模块测试 - 验证 DOM 元素引用被正确缓存
 *
 * 注意：setup.js 在每个测试前清空 DOM，因此 DOM 必须在 beforeEach 中重新设置。
 * dom.js 是纯 IIFE 模块，通过 _refresh() 重新查询 DOM 元素以更新缓存。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/dom')
})

beforeEach(() => {
  // 准备 DOM：包含 dom.js 引用的所有元素
  document.body.innerHTML = `
    <div class="container"></div>
    <div class="window-frame"></div>
    <div id="timer-display"></div>
    <button id="timer-start-btn">开始</button>
    <div id="timer-status"></div>
    <div id="timer-progress-circle"></div>
    <div id="timer-today-count"></div>
    <div id="timer-total-minutes"></div>
    <button class="mode-btn" data-mode="work">work</button>
    <button class="mode-btn" data-mode="break">break</button>
    <div id="preset-list"></div>
    <div id="ui-wheel-picker"></div>
    <div id="ui-wheel-column"></div>
    <button id="preset-add-btn">+</button>
    <div id="modeSlider"></div>
    <div id="modeSliderThumb"></div>
    <div class="mode-label" data-mode="single">single</div>
    <div class="mode-label" data-mode="plan">plan</div>
    <div id="ui-single-mode-content"></div>
    <div id="plan-mode-content"></div>
    <div id="plan-list"></div>
    <div id="plan-add-buttons"></div>
    <button id="plan-add-work-btn">work</button>
    <button id="plan-add-break-btn">break</button>
    <div id="ui-tutorial-btn"></div>
    <div id="ui-garden-btn"></div>
    <div id="tutorial-modal"></div>
    <div id="tutorial-close"></div>
    <div id="ai-btn"></div>
    <div id="ai-modal"></div>
    <div id="ai-modal-close"></div>
    <div id="ai-input"></div>
    <div id="ai-generate-btn"></div>
    <div id="ai-result"></div>
    <div id="ai-apply-btn"></div>
    <div id="stats-btn"></div>
    <div id="focus-mode-switch"></div>
    <div id="focus-mode-status"></div>
    <button id="music-play-btn"></button>
    <button id="music-next-btn"></button>
    <button id="music-prev-btn"></button>
    <div id="music-mode-btn"></div>
    <div id="music-progress-bar"></div>
    <div id="music-progress-fill"></div>
    <div id="music-progress-handle"></div>
    <div id="music-track-name"></div>
    <div id="music-current-time"></div>
    <div id="music-duration"></div>
    <div id="music-player"></div>
    <div id="music-device-btn"></div>
    <div id="music-device-list"></div>
    <div id="music-volume-btn"></div>
    <div id="music-volume-slider"></div>
    <div id="music-volume-range"></div>
    <div id="music-collapse-btn"></div>
    <div id="music-collapsed-track"></div>
    <div class="visualizer-bar"></div>
    <div class="visualizer-bar"></div>
    <div id="music-playlist-btn"></div>
    <div id="music-playlist-panel"></div>
    <div id="music-playlist-items"></div>
    <div id="music-refresh-btn"></div>
    <div id="music-charts-btn"></div>
    <div id="charts-modal"></div>
    <div id="charts-modal-close"></div>
    <div id="charts-source-toggle"></div>
    <div id="charts-source-label-netease"></div>
    <div id="charts-source-label-qq"></div>
    <div id="charts-loading"></div>
    <div id="charts-error"></div>
    <div id="charts-table-container"></div>
    <div id="charts-tbody"></div>
    <div id="charts-refresh-btn"></div>
    <div id="charts-download-toggle"></div>
    <div id="charts-download-th"></div>
    <div id="disclaimer-modal"></div>
    <div id="disclaimer-cancel-btn"></div>
    <div id="disclaimer-confirm-btn"></div>
    <div id="charts-download-status"></div>
    <div id="download-status-text"></div>
    <div id="charts-manual-download"></div>
    <div id="charts-download-input"></div>
    <div id="charts-manual-download-btn"></div>
    <button class="btn-close">x</button>
    <button class="btn-minimize">-</button>
    <button class="btn-reset">reset</button>
    <button id="focus-pin-btn">pin</button>
  `

  // 重新查询 DOM 元素以更新缓存
  window.DOM._refresh()
})

describe('DOM 模块缓存', () => {
  it('应缓存 container 元素', () => {
    expect(window.DOM.container).toBe(document.querySelector('.container'))
  })

  it('应缓存 windowFrame 元素', () => {
    expect(window.DOM.windowFrame).toBe(document.querySelector('.window-frame'))
  })

  it('应缓存计时器相关元素', () => {
    expect(window.DOM.timeDisplay).toBe(document.getElementById('timer-display'))
    expect(window.DOM.startBtn).toBe(document.getElementById('timer-start-btn'))
    expect(window.DOM.statusEl).toBe(document.getElementById('timer-status'))
    expect(window.DOM.progressCircle).toBe(document.getElementById('timer-progress-circle'))
  })

  it('应缓存统计元素', () => {
    expect(window.DOM.todayCountEl).toBe(document.getElementById('timer-today-count'))
    expect(window.DOM.totalMinutesEl).toBe(document.getElementById('timer-total-minutes'))
  })

  it('应缓存 modeBtns NodeList', () => {
    expect(window.DOM.modeBtns).toBeInstanceOf(NodeList)
    expect(window.DOM.modeBtns.length).toBe(2)
  })

  it('应缓存预设列表元素', () => {
    expect(window.DOM.presetList).toBe(document.getElementById('preset-list'))
    expect(window.DOM.wheelPickerEl).toBe(document.getElementById('ui-wheel-picker'))
    expect(window.DOM.wheelColumn).toBe(document.getElementById('ui-wheel-column'))
    expect(window.DOM.addPresetBtn).toBe(document.getElementById('preset-add-btn'))
  })

  it('应缓存模式切换滑块元素', () => {
    expect(window.DOM.modeSlider).toBe(document.getElementById('modeSlider'))
    expect(window.DOM.modeSliderThumb).toBe(document.getElementById('modeSliderThumb'))
    expect(window.DOM.modeLabels).toBeInstanceOf(NodeList)
  })

  it('应缓存单次/计划模式内容元素', () => {
    expect(window.DOM.singleModeContent).toBe(document.getElementById('ui-single-mode-content'))
    expect(window.DOM.planModeContent).toBe(document.getElementById('plan-mode-content'))
    expect(window.DOM.planList).toBe(document.getElementById('plan-list'))
    expect(window.DOM.planAddButtons).toBe(document.getElementById('plan-add-buttons'))
    expect(window.DOM.addWorkBtn).toBe(document.getElementById('plan-add-work-btn'))
    expect(window.DOM.addBreakBtn).toBe(document.getElementById('plan-add-break-btn'))
  })

  it('应缓存教程弹窗元素', () => {
    expect(window.DOM.tutorialBtn).toBe(document.getElementById('ui-tutorial-btn'))
    expect(window.DOM.gardenBtn).toBe(document.getElementById('ui-garden-btn'))
    expect(window.DOM.tutorialModal).toBe(document.getElementById('tutorial-modal'))
    expect(window.DOM.tutorialClose).toBe(document.getElementById('tutorial-close'))
  })

  it('应缓存 AI 助手元素', () => {
    expect(window.DOM.aiBtn).toBe(document.getElementById('ai-btn'))
    expect(window.DOM.aiModal).toBe(document.getElementById('ai-modal'))
    expect(window.DOM.aiModalClose).toBe(document.getElementById('ai-modal-close'))
    expect(window.DOM.aiInput).toBe(document.getElementById('ai-input'))
    expect(window.DOM.aiGenerateBtn).toBe(document.getElementById('ai-generate-btn'))
    expect(window.DOM.aiResult).toBe(document.getElementById('ai-result'))
    expect(window.DOM.aiApplyBtn).toBe(document.getElementById('ai-apply-btn'))
  })

  it('应缓存统计/专注模式元素', () => {
    expect(window.DOM.statsBtn).toBe(document.getElementById('stats-btn'))
    expect(window.DOM.focusModeSwitch).toBe(document.getElementById('focus-mode-switch'))
    expect(window.DOM.focusModeStatus).toBe(document.getElementById('focus-mode-status'))
  })

  it('应缓存音乐播放器元素', () => {
    expect(window.DOM.playBtn).toBe(document.getElementById('music-play-btn'))
    expect(window.DOM.nextBtn).toBe(document.getElementById('music-next-btn'))
    expect(window.DOM.prevBtn).toBe(document.getElementById('music-prev-btn'))
    expect(window.DOM.modeBtn).toBe(document.getElementById('music-mode-btn'))
    expect(window.DOM.progressBar).toBe(document.getElementById('music-progress-bar'))
    expect(window.DOM.progressFill).toBe(document.getElementById('music-progress-fill'))
    expect(window.DOM.progressHandle).toBe(document.getElementById('music-progress-handle'))
    expect(window.DOM.trackNameEl).toBe(document.getElementById('music-track-name'))
    expect(window.DOM.currentTimeEl).toBe(document.getElementById('music-current-time'))
    expect(window.DOM.durationEl).toBe(document.getElementById('music-duration'))
    expect(window.DOM.musicPlayer).toBe(document.getElementById('music-player'))
    expect(window.DOM.deviceBtn).toBe(document.getElementById('music-device-btn'))
    expect(window.DOM.deviceList).toBe(document.getElementById('music-device-list'))
    expect(window.DOM.volumeBtn).toBe(document.getElementById('music-volume-btn'))
    expect(window.DOM.volumeSlider).toBe(document.getElementById('music-volume-slider'))
    expect(window.DOM.volumeRange).toBe(document.getElementById('music-volume-range'))
    expect(window.DOM.collapseBtn).toBe(document.getElementById('music-collapse-btn'))
    expect(window.DOM.collapsedTrack).toBe(document.getElementById('music-collapsed-track'))
    expect(window.DOM.visualizerBars).toBeInstanceOf(NodeList)
    expect(window.DOM.playlistBtn).toBe(document.getElementById('music-playlist-btn'))
    expect(window.DOM.playlistPanel).toBe(document.getElementById('music-playlist-panel'))
    expect(window.DOM.playlistItems).toBe(document.getElementById('music-playlist-items'))
    expect(window.DOM.refreshBtn).toBe(document.getElementById('music-refresh-btn'))
  })

  it('应缓存榜单/图表元素', () => {
    expect(window.DOM.chartsBtn).toBe(document.getElementById('music-charts-btn'))
    expect(window.DOM.chartsModal).toBe(document.getElementById('charts-modal'))
    expect(window.DOM.chartsModalClose).toBe(document.getElementById('charts-modal-close'))
    expect(window.DOM.chartsSourceToggle).toBe(document.getElementById('charts-source-toggle'))
    expect(window.DOM.chartsSourceLabelNetease).toBe(document.getElementById('charts-source-label-netease'))
    expect(window.DOM.chartsSourceLabelQQ).toBe(document.getElementById('charts-source-label-qq'))
    expect(window.DOM.chartsLoading).toBe(document.getElementById('charts-loading'))
    expect(window.DOM.chartsError).toBe(document.getElementById('charts-error'))
    expect(window.DOM.chartsTableContainer).toBe(document.getElementById('charts-table-container'))
    expect(window.DOM.chartsTbody).toBe(document.getElementById('charts-tbody'))
    expect(window.DOM.chartsRefreshBtn).toBe(document.getElementById('charts-refresh-btn'))
    expect(window.DOM.chartsDownloadToggle).toBe(document.getElementById('charts-download-toggle'))
    expect(window.DOM.chartsDownloadTh).toBe(document.getElementById('charts-download-th'))
    expect(window.DOM.disclaimerModal).toBe(document.getElementById('disclaimer-modal'))
    expect(window.DOM.disclaimerCancelBtn).toBe(document.getElementById('disclaimer-cancel-btn'))
    expect(window.DOM.disclaimerConfirmBtn).toBe(document.getElementById('disclaimer-confirm-btn'))
    expect(window.DOM.chartsDownloadStatus).toBe(document.getElementById('charts-download-status'))
    expect(window.DOM.chartsDownloadStatusText).toBe(document.getElementById('download-status-text'))
    expect(window.DOM.chartsManualDownload).toBe(document.getElementById('charts-manual-download'))
    expect(window.DOM.chartsManualDownloadInput).toBe(document.getElementById('charts-download-input'))
    expect(window.DOM.chartsManualDownloadBtn).toBe(document.getElementById('charts-manual-download-btn'))
  })

  it('应缓存窗口按钮元素', () => {
    expect(window.DOM.btnClose).toBe(document.querySelector('.btn-close'))
    expect(window.DOM.btnMinimize).toBe(document.querySelector('.btn-minimize'))
    expect(window.DOM.btnReset).toBe(document.querySelector('.btn-reset'))
    expect(window.DOM.btnPin).toBe(document.getElementById('focus-pin-btn'))
  })

  it('当 DOM 元素不存在时应返回 null', () => {
    document.body.innerHTML = ''
    window.DOM._refresh()
    expect(window.DOM.container).toBeNull()
    expect(window.DOM.timeDisplay).toBeNull()
    expect(window.DOM.startBtn).toBeNull()
    expect(window.DOM.modeBtns.length).toBe(0)
  })
})
