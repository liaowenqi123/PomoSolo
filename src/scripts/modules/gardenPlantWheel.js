/**
 * 菜园子 - 种植轮盘模块
 * 点击空格子时显示轮盘选择要种植的种子
 */
;(function() {
  'use strict'

  // 从 Utils 获取配置
  const CROP_CONFIG = typeof Utils !== 'undefined' ? Utils.CROP_CONFIG : {}

  // 获取有种子的作物列表
  function getAvailableSeeds(data) {
    if (!data || !data.seeds) return []
    
    const available = []
    Object.keys(CROP_CONFIG).forEach(cropKey => {
      const count = data.seeds[cropKey] || 0
      if (count > 0) {
        available.push({
          key: cropKey,
          ...CROP_CONFIG[cropKey],
          count: count
        })
      }
    })
    return available
  }

  // DOM 元素
  let wheelEl = null
  let canvas = null
  let closeBtn = null
  let ctx = null

  // 状态
  let isActive = false
  let currentHover = -1
  let currentSeeds = []
  let currentIndex = -1  // 当前点击的格子索引
  let onPlantCallback = null

  // 创建轮盘 DOM
  function createWheelDOM() {
    if (wheelEl) return

    wheelEl = document.createElement('div')
    wheelEl.className = 'plant-wheel'
    wheelEl.innerHTML = `
      <canvas class="plant-wheel-canvas" width="500" height="500"></canvas>
      <div class="plant-wheel-close">✕</div>
    `
    document.body.appendChild(wheelEl)

    canvas = wheelEl.querySelector('.plant-wheel-canvas')
    closeBtn = wheelEl.querySelector('.plant-wheel-close')
    ctx = canvas.getContext('2d')

    // 绑定事件
    bindEvents()
  }

  // 绑定事件
  function bindEvents() {
    // 关闭按钮
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      hide()
    })

    // 画布点击
    canvas.addEventListener('click', onCanvasClick)
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault()
      onCanvasClick(e)
    })

    // 鼠标移动高亮
    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault()
      onTouchMove(e)
    })

    // 点击外部关闭
    document.addEventListener('click', onDocumentClick)
  }

  // 绘制轮盘
  function drawWheel(hoverIdx) {
    if (!ctx || currentSeeds.length === 0) return

    const w = canvas.width
    const h = canvas.height
    const cx = w / 2
    const cy = h / 2
    const radius = w * 0.44
    const segCount = currentSeeds.length
    const angleStep = (Math.PI * 2) / segCount
    const startOffset = -Math.PI / 2

    ctx.clearRect(0, 0, w, h)

    // 绘制扇形
    for (let i = 0; i < segCount; i++) {
      const start = i * angleStep + startOffset
      const end = (i + 1) * angleStep + startOffset
      const isHover = (hoverIdx === i)

      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, radius, start, end)
      ctx.closePath()
      ctx.fillStyle = isHover ? "rgba(80, 120, 70, 0.7)" : "rgba(30, 50, 25, 0.85)"
      ctx.shadowBlur = isHover ? 8 : 2
      ctx.shadowColor = "rgba(0,0,0,0.4)"
      ctx.fill()
    }

    // 内圈中心区域
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.22, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(20, 35, 20, 0.9)"
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.12, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(15, 25, 15, 0.95)"
    ctx.fill()

    // 绘制图标和文字
    for (let i = 0; i < segCount; i++) {
      const midAngle = i * angleStep + startOffset + angleStep / 2
      const textR = radius * 0.68
      const x = cx + Math.cos(midAngle) * textR
      const y = cy + Math.sin(midAngle) * textR

      const seed = currentSeeds[i]
      const isHover = (hoverIdx === i)

      // 图标
      ctx.font = `500 ${Math.floor(radius * 0.22)}px "Segoe UI Emoji", "Apple Color Emoji", system-ui`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.shadowBlur = isHover ? 4 : 1
      ctx.fillStyle = isHover ? "#90EE90" : "#C8E6C8"
      ctx.fillText(seed.icon, x, y - 10)

      // 名称
      ctx.font = `500 ${Math.floor(radius * 0.075)}px "Segoe UI", system-ui`
      ctx.fillStyle = isHover ? "#E8F5E8" : "#A8D5A8"
      ctx.fillText(seed.name, x, y + 16)

      // 数量
      ctx.font = `400 ${Math.floor(radius * 0.065)}px "Segoe UI", system-ui`
      ctx.fillStyle = isHover ? "#B8E8B8" : "#88C888"
      ctx.fillText(`x${seed.count}`, x, y + 32)
    }
    ctx.shadowBlur = 0
  }

  // 获取扇区索引
  function getSectorIndex(clientX, clientY) {
    if (!wheelEl) return -1
    const rect = wheelEl.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = clientX - cx
    const dy = clientY - cy
    const dist = Math.hypot(dx, dy)

    // 点击中心区域返回 -1
    if (dist < (rect.width / 2) * 0.27) return -1

    let angle = Math.atan2(dy, dx)
    const offset = -Math.PI / 2
    let local = angle - offset
    if (local < 0) local += Math.PI * 2
    const step = (Math.PI * 2) / currentSeeds.length
    let idx = Math.floor(local / step)
    return Math.min(currentSeeds.length - 1, Math.max(0, idx))
  }

  // 定位轮盘
  function positionAt(x, y) {
    const size = 260
    const gardenFrame = document.querySelector('.garden-frame')
    let left, top

    if (gardenFrame) {
      const frameRect = gardenFrame.getBoundingClientRect()
      // 限制在 garden-frame 内
      left = Math.max(frameRect.left + 10, Math.min(frameRect.right - size - 10, x - size / 2))
      top = Math.max(frameRect.top + 10, Math.min(frameRect.bottom - size - 10, y - size / 2))
    } else {
      left = Math.min(window.innerWidth - size - 10, Math.max(10, x - size / 2))
      top = Math.min(window.innerHeight - size - 10, Math.max(10, y - size / 2))
    }

    wheelEl.style.left = left + 'px'
    wheelEl.style.top = top + 'px'
  }

  // 显示轮盘
  function show(x, y, plotIndex, data, onPlant) {
    if (isActive) return

    // 获取可用种子
    currentSeeds = getAvailableSeeds(data)
    if (currentSeeds.length === 0) {
      // 没有可用种子
      if (onPlant) onPlant(null)
      return
    }

    createWheelDOM()
    positionAt(x, y)

    currentIndex = plotIndex
    onPlantCallback = onPlant
    isActive = true
    currentHover = -1

    wheelEl.classList.add('active')
    drawWheel(-1)
  }

  // 隐藏轮盘
  function hide() {
    if (!isActive || !wheelEl) return

    wheelEl.classList.remove('active')
    isActive = false
    currentHover = -1
    currentIndex = -1
    onPlantCallback = null
  }

  // 点击画布
  function onCanvasClick(e) {
    if (!isActive) return

    let clientX, clientY
    if (e.touches) {
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }

    const idx = getSectorIndex(clientX, clientY)
    if (idx !== -1 && idx < currentSeeds.length) {
      const selectedSeed = currentSeeds[idx]
      hide()
      if (onPlantCallback) {
        onPlantCallback(selectedSeed.key)
      }
    }
  }

  // 鼠标移动
  function onMouseMove(e) {
    if (!isActive) return
    const idx = getSectorIndex(e.clientX, e.clientY)
    if (idx !== currentHover) {
      currentHover = idx
      drawWheel(currentHover)
    }
  }

  // 触摸移动
  function onTouchMove(e) {
    if (!isActive) return
    const touch = e.touches[0]
    if (!touch) return
    const idx = getSectorIndex(touch.clientX, touch.clientY)
    if (idx !== currentHover) {
      currentHover = idx
      drawWheel(currentHover)
    }
  }

  // 点击文档
  function onDocumentClick(e) {
    if (!isActive) return
    if (wheelEl && !wheelEl.contains(e.target)) {
      hide()
    }
  }

  // 导出
  window.PlantWheel = {
    show,
    hide,
    isActive: () => isActive
  }
})()
