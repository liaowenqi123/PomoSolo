/**
 * 滚筒选择器模块
 */
;(function() {
  'use strict'

  const ITEM_HEIGHT = 32
  const MIN_VAL = 1
  const MAX_VAL = 120
  const VISIBLE_RANGE = 3

  let wheelPickerEl = null
  let wheelColumn = null
  let onChangeCallback = null

  let wheelValue = 25
  let isDragging = false
  let dragStartY = 0
  let dragStartValue = 0
  let dragVelocity = 0
  let lastDragY = 0
  let lastDragTime = 0
  let animFrameId = null
  let isDisabled = false

  function renderWheel(centerVal) {
    wheelColumn.innerHTML = ''
    const startIdx = Math.max(MIN_VAL, Math.round(centerVal) - VISIBLE_RANGE)
    const endIdx = Math.min(MAX_VAL, Math.round(centerVal) + VISIBLE_RANGE)
    
    for (let i = startIdx; i <= endIdx; i++) {
      const el = document.createElement('div')
      el.className = 'wheel-picker-item' + (i === Math.round(centerVal) ? ' center' : '')
      el.textContent = i
      el.dataset.val = i
      wheelColumn.appendChild(el)
    }
    
    const index = Math.round(centerVal) - startIdx
    const offset = -index * ITEM_HEIGHT
    wheelColumn.style.transition = 'none'
    wheelColumn.style.transform = `translateY(${offset}px)`
    updateWheelOpacity(centerVal)
  }

  function updateWheelOpacity(centerVal) {
    const items = wheelColumn.querySelectorAll('.wheel-picker-item')
    items.forEach(el => {
      const v = parseInt(el.dataset.val)
      const dist = Math.abs(v - centerVal)
      el.style.opacity = dist < 0.5 ? 1 : Math.max(0.3, 1 - dist * 0.35)
      el.classList.toggle('center', v === Math.round(centerVal))
    })
  }

  function updateWheelDisplay(newVal) {
    const startIdx = Math.max(MIN_VAL, Math.round(newVal) - VISIBLE_RANGE)
    const endIdx = Math.min(MAX_VAL, Math.round(newVal) + VISIBLE_RANGE)
    
    const currItems = wheelColumn.querySelectorAll('.wheel-picker-item')
    const currStart = currItems.length > 0 ? parseInt(currItems[0].dataset.val) : 0
    const currEnd = currItems.length > 0 ? parseInt(currItems[currItems.length - 1].dataset.val) : 0
    
    if (currStart !== startIdx || currEnd !== endIdx) {
      wheelColumn.innerHTML = ''
      for (let i = startIdx; i <= endIdx; i++) {
        const el = document.createElement('div')
        el.className = 'wheel-picker-item'
        el.textContent = i
        el.dataset.val = i
        wheelColumn.appendChild(el)
      }
    }
    
    const index = Math.round(newVal) - startIdx
    const offset = -index * ITEM_HEIGHT - (newVal - Math.round(newVal)) * ITEM_HEIGHT
    wheelColumn.style.transform = `translateY(${offset}px)`
    updateWheelOpacity(newVal)
  }

  function onWheelDragStart(e) {
    if (isDisabled) return
    cancelAnimationFrame(animFrameId)
    isDragging = true
    dragStartY = e.clientY || e.touches[0].clientY
    dragStartValue = wheelValue
    lastDragY = dragStartY
    lastDragTime = performance.now()
    dragVelocity = 0
    wheelPickerEl.style.cursor = 'grabbing'
    wheelColumn.style.transition = 'none'
  }

  function onWheelDragMove(e) {
    if (!isDragging) return
    const clientY = e.clientY || (e.touches && e.touches[0].clientY)
    if (clientY === undefined) return
    
    const delta = clientY - dragStartY
    const now = performance.now()
    const dt = now - lastDragTime
    
    if (dt > 0) {
      dragVelocity = (clientY - lastDragY) / dt * 16
    }
    lastDragY = clientY
    lastDragTime = now
    
    let newVal = dragStartValue - delta / ITEM_HEIGHT
    newVal = Math.max(MIN_VAL, Math.min(MAX_VAL, newVal))
    updateWheelDisplay(newVal)
  }

  function onWheelDragEnd() {
    if (!isDragging) return
    isDragging = false
    wheelPickerEl.style.cursor = 'ns-resize'
    
    let currentVal = dragStartValue - (lastDragY - dragStartY) / ITEM_HEIGHT
    
    if (Math.abs(dragVelocity) > 0.5) {
      animateWheelInertia(currentVal, dragVelocity)
    } else {
      snapWheelToValue(currentVal)
    }
  }

  function animateWheelInertia(startVal, vel) {
    let val = startVal
    let v = vel
    const friction = 0.94
    
    function step() {
      v *= friction
      val -= v / ITEM_HEIGHT
      if (val < MIN_VAL) { val = MIN_VAL; v = 0 }
      if (val > MAX_VAL) { val = MAX_VAL; v = 0 }
      updateWheelDisplay(val)
      
      if (Math.abs(v) > 0.5) {
        animFrameId = requestAnimationFrame(step)
      } else {
        snapWheelToValue(val)
      }
    }
    step()
  }

  function snapWheelToValue(rawVal) {
    const target = Math.max(MIN_VAL, Math.min(MAX_VAL, Math.round(rawVal)))
    wheelColumn.style.transition = 'transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    wheelValue = target
    renderWheel(target)
    if (onChangeCallback) {
      onChangeCallback(target)
    }
  }

  function onWheel(e) {
    if (isDisabled) return
    e.preventDefault()
    const d = e.deltaY > 0 ? 1 : -1
    const nv = Math.max(MIN_VAL, Math.min(MAX_VAL, wheelValue + d))
    if (nv !== wheelValue) {
      const currItems = wheelColumn.querySelectorAll('.wheel-picker-item')
      const currStart = currItems.length > 0 ? parseInt(currItems[0].dataset.val) : 0
      const currEnd = currItems.length > 0 ? parseInt(currItems[currItems.length - 1].dataset.val) : 0
      
      wheelValue = nv
      
      if (nv >= currStart && nv <= currEnd) {
        wheelColumn.style.transition = 'transform 0.15s ease-out'
        const index = nv - currStart
        const offset = -index * ITEM_HEIGHT
        wheelColumn.style.transform = `translateY(${offset}px)`
        updateWheelOpacity(nv)
      } else {
        wheelColumn.style.transition = 'none'
        renderWheel(nv)
      }
      
      if (onChangeCallback) {
        onChangeCallback(nv)
      }
    }
  }

  function init(pickerEl, columnEl, onChange) {
    wheelPickerEl = pickerEl
    wheelColumn = columnEl
    onChangeCallback = onChange
    
    wheelPickerEl.addEventListener('wheel', onWheel, { passive: false })
    wheelPickerEl.addEventListener('mousedown', onWheelDragStart)
    wheelPickerEl.addEventListener('touchstart', onWheelDragStart, { passive: false })
    document.addEventListener('mousemove', onWheelDragMove)
    document.addEventListener('touchmove', onWheelDragMove, { passive: false })
    document.addEventListener('mouseup', onWheelDragEnd)
    document.addEventListener('touchend', onWheelDragEnd)
    
    renderWheel(wheelValue)
  }

  function setValue(val) {
    wheelValue = Math.max(MIN_VAL, Math.min(MAX_VAL, val))
    renderWheel(wheelValue)
  }

  function getValue() {
    return wheelValue
  }

  function setEnabled(enabled) {
    isDisabled = !enabled
    wheelPickerEl.classList.toggle('disabled', !enabled)
  }

  function setChangeCallback(callback) {
    onChangeCallback = callback
  }

  // 重置内部状态（用于测试）
  function _resetState() {
    wheelValue = 25
    isDragging = false
    dragStartY = 0
    dragStartValue = 0
    dragVelocity = 0
    lastDragY = 0
    lastDragTime = 0
    animFrameId = null
    isDisabled = false
    onChangeCallback = null
  }

  // 导出到全局
  window.WheelPicker = {
    init: init,
    setValue: setValue,
    getValue: getValue,
    setEnabled: setEnabled,
    setChangeCallback: setChangeCallback,
    _resetState: _resetState
  }
})()