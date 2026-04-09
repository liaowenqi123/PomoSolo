/**
 * 菜园子 - 种植轮盘模块
 * 点击空格子时显示轮盘选择要种植的种子
 */
;(function() {
  'use strict'

  // 从 Utils 获取配置
  const CROP_CONFIG = typeof Utils !== 'undefined' ? Utils.CROP_CONFIG : {}

  // 获取所有作物作为选择（始终5个）
  function getAllCrops(data) {
    const seeds = data?.seeds || {}
    const crops = []
    
    // 始终按固定顺序返回5种作物
    const cropKeys = ['carrot', 'tomato', 'sunflower', 'rose', 'osmanthus']
    cropKeys.forEach(cropKey => {
      const config = CROP_CONFIG[cropKey]
      if (config) {
        crops.push({
          key: cropKey,
          ...config,
          count: seeds[cropKey] || 0
        })
      }
    })
    return crops
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
  let showTime = 0  // 轮盘显示时间戳（用于解决事件冒泡竞争）

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

    // 绘制扇形（半透明黑色）
    for (let i = 0; i < segCount; i++) {
      const start = i * angleStep + startOffset
      const end = (i + 1) * angleStep + startOffset
      const isHover = (hoverIdx === i)
      const seed = currentSeeds[i]
      const isDisabled = seed.count <= 0

      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, radius, start, end)
      ctx.closePath()
      
      if (isDisabled) {
        ctx.fillStyle = "rgba(20, 20, 20, 0.6)"
      } else if (isHover) {
        ctx.fillStyle = "rgba(60, 60, 60, 0.85)"
      } else {
        ctx.fillStyle = "rgba(35, 35, 35, 0.8)"
      }
      ctx.shadowBlur = isHover ? 6 : 2
      ctx.shadowColor = "rgba(0,0,0,0.5)"
      ctx.fill()
    }

    // 内圈中心区域
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.25, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(25, 25, 25, 0.9)"
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.15, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(15, 15, 15, 0.95)"
    ctx.fill()

    // 绘制图标和数量
    for (let i = 0; i < segCount; i++) {
      const midAngle = i * angleStep + startOffset + angleStep / 2
      const textR = radius * 0.62
      const x = cx + Math.cos(midAngle) * textR
      const y = cy + Math.sin(midAngle) * textR

      const seed = currentSeeds[i]
      const isHover = (hoverIdx === i)
      const isDisabled = seed.count <= 0

      // 图标（大一点）
      ctx.font = `${Math.floor(radius * 0.32)}px "Segoe UI Emoji", "Apple Color Emoji", system-ui`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.shadowBlur = isHover ? 3 : 1
      ctx.shadowColor = "rgba(0,0,0,0.3)"
      
      if (isDisabled) {
        ctx.fillStyle = "rgba(120, 120, 120, 0.5)"
      } else if (isHover) {
        ctx.fillStyle = "#ffffff"
      } else {
        ctx.fillStyle = "rgba(220, 220, 220, 0.9)"
      }
      ctx.fillText(seed.icon, x, y - 5)

      // 数量（往下移一点，避开图标，稍微大一点）
      ctx.font = `700 ${Math.floor(radius * 0.14)}px "Segoe UI", system-ui`
      ctx.shadowBlur = 0
      
      if (isDisabled) {
        ctx.fillStyle = "rgba(150, 150, 150, 0.4)"
        ctx.fillText("×0", x, y + 28)
      } else if (isHover) {
        ctx.fillStyle = "#ffffff"
        ctx.fillText(`×${seed.count}`, x, y + 28)
      } else {
        ctx.fillStyle = "rgba(200, 200, 200, 0.8)"
        ctx.fillText(`×${seed.count}`, x, y + 28)
      }
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
    const size = 200
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

    // 获取所有作物（始终5个）
    currentSeeds = getAllCrops(data)

    createWheelDOM()
    positionAt(x, y)

    currentIndex = plotIndex
    onPlantCallback = onPlant
    isActive = true
    currentHover = -1
    showTime = Date.now()

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
      // 检查是否有种子
      if (selectedSeed.count <= 0) {
        return  // 数量为0，不允许种植
      }
      // 先保存回调引用，再隐藏轮盘
      const callback = onPlantCallback
      const seedKey = selectedSeed.key
      hide()
      if (callback) {
        callback(seedKey)
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

  // 点击文档（关闭轮盘）
  function onDocumentClick(e) {
    if (!isActive) return
    // 忽略触发轮盘显示的同一个点击事件（事件冒泡竞争问题）
    // 如果点击发生在轮盘显示后 50ms 内，说明是同一个事件在冒泡
    if (Date.now() - showTime < 50) return
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
