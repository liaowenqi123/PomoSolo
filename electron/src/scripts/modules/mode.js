/**
 * 模式切换模块
 */
;(function() {
  'use strict'

  const MODE = {
    WORK: 'work',
    BREAK: 'break'
  }

  let elements = {}
  let callbacks = {}
  let currentMode = MODE.WORK

  function setMode(mode) {
    currentMode = mode
    
    elements.modeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode)
    })
    
    elements.container.classList.toggle('break-mode', mode === MODE.BREAK)
    
    // 同时给 window-frame 添加模式类（用于教程弹窗样式）
    const windowFrame = document.querySelector('.window-frame')
    if (windowFrame) {
      windowFrame.classList.toggle('break-mode', mode === MODE.BREAK)
    }
    
    if (callbacks.onModeChange) {
      callbacks.onModeChange(mode)
    }
  }

  function getMode() {
    return currentMode
  }

  function isWorkMode() {
    return currentMode === MODE.WORK
  }

  function isBreakMode() {
    return currentMode === MODE.BREAK
  }

  function init(els, cbs) {
    elements = els
    callbacks = cbs || {}
    
    elements.modeBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        const mode = this.dataset.mode
        if (callbacks.onBeforeChange) {
          if (!callbacks.onBeforeChange(mode)) return
        }
        setMode(mode)
      })
    })
  }

  // 导出到全局
  window.Mode = {
    MODE: MODE,
    init: init,
    setMode: setMode,
    getMode: getMode,
    isWorkMode: isWorkMode,
    isBreakMode: isBreakMode
  }
})()