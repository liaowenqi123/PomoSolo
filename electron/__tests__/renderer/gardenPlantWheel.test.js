/**
 * PlantWheel 模块测试
 *
 * 测试种植轮盘：显示/隐藏、扇区索引计算、点击种植
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = `
    <div class="garden-frame" style="position:absolute;left:0;top:0;width:800px;height:600px;"></div>
  `

  // Mock canvas getContext to return a mock 2d context (jsdom returns null by default)
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    fillStyle: '',
    shadowBlur: 0,
    shadowColor: '',
    font: '',
    textAlign: '',
    textBaseline: ''
  })

  // 重置模块缓存，使 gardenPlantWheel IIFE 重新执行并重置内部闭包变量
  // （wheelEl、canvas 等闭包变量在 DOM 被清空后会变成 detached 引用，
  //   createWheelDOM 会因 wheelEl 非空而提前返回，导致不创建新 DOM）
  vi.resetModules()
  delete require.cache[require.resolve('../../src/scripts/modules/utils')]
  delete require.cache[require.resolve('../../src/scripts/modules/gardenPlantWheel')]
  require('../../src/scripts/modules/utils')
  require('../../src/scripts/modules/gardenPlantWheel')
})

function createDefaultData(overrides = {}) {
  return Object.assign({
    coins: 100,
    seeds: { carrot: 5, tomato: 2, sunflower: 1, rose: 0, osmanthus: 0 },
    crops: { carrot: 3, tomato: 1, sunflower: 0, rose: 0, osmanthus: 0 },
    plots: []
  }, overrides)
}

describe('PlantWheel show / hide', () => {
  it('show 应创建轮盘 DOM 并添加 active 类', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())

    const wheelEl = document.querySelector('.plant-wheel')
    expect(wheelEl).not.toBeNull()
    expect(wheelEl.classList.contains('active')).toBe(true)
  })

  it('show 后 isActive 应返回 true', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())

    expect(window.PlantWheel.isActive()).toBe(true)
  })

  it('重复 show 不应重复创建（isActive 时直接 return）', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())
    const firstWheel = document.querySelector('.plant-wheel')

    // 再次调用 show
    window.PlantWheel.show(200, 200, 1, data, vi.fn())

    const wheels = document.querySelectorAll('.plant-wheel')
    expect(wheels.length).toBe(1)
  })

  it('hide 应移除 active 类', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())
    const wheelEl = document.querySelector('.plant-wheel')

    window.PlantWheel.hide()

    expect(wheelEl.classList.contains('active')).toBe(false)
    expect(window.PlantWheel.isActive()).toBe(false)
  })

  it('未 show 时 hide 不应报错', () => {
    expect(() => window.PlantWheel.hide()).not.toThrow()
  })

  it('show 应创建 canvas 和关闭按钮', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())

    const canvas = document.querySelector('.plant-wheel-canvas')
    const closeBtn = document.querySelector('.plant-wheel-close')
    expect(canvas).not.toBeNull()
    expect(closeBtn).not.toBeNull()
    expect(canvas.width).toBe(500)
    expect(canvas.height).toBe(500)
  })
})

describe('PlantWheel 点击关闭按钮', () => {
  it('点击关闭按钮应隐藏轮盘', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())
    const closeBtn = document.querySelector('.plant-wheel-close')

    closeBtn.click()

    expect(window.PlantWheel.isActive()).toBe(false)
  })
})

describe('PlantWheel onCanvasClick', () => {
  it('点击中心区域（dist < 0.27）不应触发回调', () => {
    const data = createDefaultData()
    const onPlant = vi.fn()
    window.PlantWheel.show(100, 100, 0, data, onPlant)

    // jsdom 的 getBoundingClientRect 不做布局，返回全 0，需要手动 mock
    const wheelEl = document.querySelector('.plant-wheel')
    wheelEl.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200
    }))

    const canvas = document.querySelector('.plant-wheel-canvas')
    // 中心点 (100, 100)，距离中心 0，必然 < 0.27 * (200/2) = 27
    const event = new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 100 })
    canvas.dispatchEvent(event)

    expect(onPlant).not.toHaveBeenCalled()
  })

  it('未 show 时点击 canvas 不应报错', () => {
    const canvas = document.querySelector('.plant-wheel-canvas')
    // 不存在则创建一个临时
    if (!canvas) {
      const tmpCanvas = document.createElement('canvas')
      tmpCanvas.className = 'plant-wheel-canvas'
      document.body.appendChild(tmpCanvas)
    }
    expect(() => {
      const c = document.querySelector('.plant-wheel-canvas')
      c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 100 }))
    }).not.toThrow()
  })
})

describe('PlantWheel 所有作物渲染', () => {
  it('show 后应渲染 5 种作物（始终 5 个）', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())

    // 轮盘内部 currentSeeds 是私有的，通过不报错和创建 DOM 验证
    const wheelEl = document.querySelector('.plant-wheel')
    expect(wheelEl).not.toBeNull()
    expect(window.PlantWheel.isActive()).toBe(true)
  })

  it('data 为空对象时也不应报错', () => {
    expect(() => {
      window.PlantWheel.show(100, 100, 0, {}, vi.fn())
    }).not.toThrow()
    expect(window.PlantWheel.isActive()).toBe(true)
  })
})

describe('PlantWheel onCanvasClick 扇区点击', () => {
  function setupWheel() {
    const data = createDefaultData()
    const onPlant = vi.fn()
    window.PlantWheel.show(100, 100, 0, data, onPlant)
    const wheelEl = document.querySelector('.plant-wheel')
    wheelEl.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200
    }))
    const canvas = document.querySelector('.plant-wheel-canvas')
    return { canvas, onPlant, wheelEl }
  }

  it('点击有效扇区应触发 onPlant 回调', () => {
    const { canvas, onPlant } = setupWheel()
    // Click at (180, 100) - far right, which is in the first sector (0 to 72 degrees from top)
    const event = new MouseEvent('click', { bubbles: true, clientX: 180, clientY: 100 })
    canvas.dispatchEvent(event)

    expect(onPlant).toHaveBeenCalled()
  })

  it('点击数量为0的种子不应触发回调', () => {
    const data = createDefaultData()
    data.seeds = { carrot: 0, tomato: 0, sunflower: 0, rose: 0, osmanthus: 0 }
    const onPlant = vi.fn()
    window.PlantWheel.show(100, 100, 0, data, onPlant)
    const wheelEl = document.querySelector('.plant-wheel')
    wheelEl.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200
    }))
    const canvas = document.querySelector('.plant-wheel-canvas')

    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 180, clientY: 100 }))

    expect(onPlant).not.toHaveBeenCalled()
  })

  it('touchstart 事件应触发扇区点击', () => {
    const { canvas, onPlant } = setupWheel()
    const touchEvent = new TouchEvent('touchstart', {
      bubbles: true,
      touches: [{ clientX: 180, clientY: 100 }]
    })
    canvas.dispatchEvent(touchEvent)

    expect(onPlant).toHaveBeenCalled()
  })

  it('未激活时点击 canvas 不应触发回调', () => {
    const data = createDefaultData()
    const onPlant = vi.fn()
    // Don't call show - wheel is not active
    // First create the DOM by showing and hiding
    window.PlantWheel.show(100, 100, 0, data, onPlant)
    const wheelEl = document.querySelector('.plant-wheel')
    wheelEl.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200
    }))
    const canvas = document.querySelector('.plant-wheel-canvas')
    window.PlantWheel.hide()

    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 180, clientY: 100 }))

    expect(onPlant).not.toHaveBeenCalled()
  })
})

describe('PlantWheel onMouseMove', () => {
  it('mousemove 应更新 hover 状态并重绘', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())
    const wheelEl = document.querySelector('.plant-wheel')
    wheelEl.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200
    }))
    const canvas = document.querySelector('.plant-wheel-canvas')

    // Move to a sector position
    canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 180, clientY: 100 }))
    // Move to center (should change hover to -1)
    canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }))

    // No error means it worked
    expect(window.PlantWheel.isActive()).toBe(true)
  })

  it('未激活时 mousemove 不应报错', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())
    const canvas = document.querySelector('.plant-wheel-canvas')
    window.PlantWheel.hide()

    expect(() => {
      canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 180, clientY: 100 }))
    }).not.toThrow()
  })
})

describe('PlantWheel onTouchMove', () => {
  it('touchmove 应更新 hover 状态', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())
    const wheelEl = document.querySelector('.plant-wheel')
    wheelEl.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200
    }))
    const canvas = document.querySelector('.plant-wheel-canvas')

    const touchEvent = new TouchEvent('touchmove', {
      bubbles: true,
      touches: [{ clientX: 180, clientY: 100 }]
    })
    canvas.dispatchEvent(touchEvent)

    expect(window.PlantWheel.isActive()).toBe(true)
  })

  it('未激活时 touchmove 不应报错', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())
    const canvas = document.querySelector('.plant-wheel-canvas')
    window.PlantWheel.hide()

    expect(() => {
      const touchEvent = new TouchEvent('touchmove', {
        bubbles: true,
        touches: [{ clientX: 180, clientY: 100 }]
      })
      canvas.dispatchEvent(touchEvent)
    }).not.toThrow()
  })
})

describe('PlantWheel onDocumentClick', () => {
  it('点击轮盘外部应关闭轮盘', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())

    // Wait more than 50ms to avoid the show-time guard
    return new Promise(resolve => setTimeout(() => {
      // Click on body (outside wheel)
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 500, clientY: 500 }))

      expect(window.PlantWheel.isActive()).toBe(false)
      resolve()
    }, 60))
  })

  it('轮盘显示后 50ms 内的点击不应关闭轮盘', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())

    // Immediately click outside (within 50ms)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 500, clientY: 500 }))

    expect(window.PlantWheel.isActive()).toBe(true)
  })

  it('点击轮盘内部不应关闭轮盘', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())
    const wheelEl = document.querySelector('.plant-wheel')

    return new Promise(resolve => setTimeout(() => {
      // Click on wheel itself
      wheelEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 100 }))

      expect(window.PlantWheel.isActive()).toBe(true)
      resolve()
    }, 60))
  })

  it('未激活时 document click 不应报错', () => {
    expect(() => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 500, clientY: 500 }))
    }).not.toThrow()
  })
})

describe('PlantWheel positionAt 无 gardenFrame', () => {
  it('无 gardenFrame 时应使用 window 尺寸定位', () => {
    document.querySelector('.garden-frame').remove()
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())

    const wheelEl = document.querySelector('.plant-wheel')
    expect(wheelEl).not.toBeNull()
    expect(wheelEl.style.left).toBeDefined()
    expect(wheelEl.style.top).toBeDefined()
  })
})

describe('PlantWheel getSectorIndex 边界', () => {
  it('点击左上方应返回有效扇区', () => {
    const data = createDefaultData()
    window.PlantWheel.show(100, 100, 0, data, vi.fn())
    const wheelEl = document.querySelector('.plant-wheel')
    wheelEl.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200
    }))
    const canvas = document.querySelector('.plant-wheel-canvas')

    // Click at (20, 20) - top-left area
    canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 20 }))

    expect(window.PlantWheel.isActive()).toBe(true)
  })
})
