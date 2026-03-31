/**
 * 番茄钟 - DOM 元素引用
 */
;(function() {
  'use strict'

  const elements = {
    // 容器
    container: document.querySelector('.container'),
    windowFrame: document.querySelector('.window-frame'),
    
    // 计时器
    timeDisplay: document.getElementById('timer-display'),
    startBtn: document.getElementById('timer-start-btn'),
    statusEl: document.getElementById('timer-status'),
    progressCircle: document.getElementById('timer-progress-circle'),
    
    // 统计
    todayCountEl: document.getElementById('timer-today-count'),
    totalMinutesEl: document.getElementById('timer-total-minutes'),
    
    // 工作/休息模式按钮
    modeBtns: document.querySelectorAll('.mode-btn'),
    
    // 预设列表
    presetList: document.getElementById('preset-list'),
    wheelPickerEl: document.getElementById('ui-wheel-picker'),
    wheelColumn: document.getElementById('ui-wheel-column'),
    addPresetBtn: document.getElementById('preset-add-btn'),
    
    // 应用模式切换滑块
    modeSlider: document.getElementById('modeSlider'),
    modeSliderThumb: document.getElementById('modeSliderThumb'),
    modeLabels: document.querySelectorAll('.mode-label'),
    
    // 单次/计划模式内容
    singleModeContent: document.getElementById('ui-single-mode-content'),
    planModeContent: document.getElementById('plan-mode-content'),
    planList: document.getElementById('plan-list'),
    planAddButtons: document.getElementById('plan-add-buttons'),
    addWorkBtn: document.getElementById('plan-add-work-btn'),
    addBreakBtn: document.getElementById('plan-add-break-btn'),
    
    // 教程弹窗
    tutorialBtn: document.getElementById('ui-tutorial-btn'),
    gardenBtn: document.getElementById('ui-garden-btn'),
    tutorialModal: document.getElementById('tutorial-modal'),
    tutorialClose: document.getElementById('tutorial-close'),
    
    // AI助手
    aiBtn: document.getElementById('ai-btn'),
    aiModal: document.getElementById('ai-modal'),
    aiModalClose: document.getElementById('ai-modal-close'),
    aiInput: document.getElementById('ai-input'),
    aiGenerateBtn: document.getElementById('ai-generate-btn'),
    aiResult: document.getElementById('ai-result'),
    aiApplyBtn: document.getElementById('ai-apply-btn'),
    
    // 统计功能
    statsBtn: document.getElementById('stats-btn'),
    
    // 专注模式开关
    focusModeSwitch: document.getElementById('focus-mode-switch'),
    focusModeStatus: document.getElementById('focus-mode-status'),
    
    // 音乐播放器
    playBtn: document.getElementById('music-play-btn'),
    nextBtn: document.getElementById('music-next-btn'),
    prevBtn: document.getElementById('music-prev-btn'),
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
    
    // 按钮
    btnClose: document.querySelector('.btn-close'),
    btnMinimize: document.querySelector('.btn-minimize'),
    btnReset: document.querySelector('.btn-reset'),
    btnPin: document.getElementById('focus-pin-btn')
  }

  // 导出到全局
  window.DOM = elements
})()
