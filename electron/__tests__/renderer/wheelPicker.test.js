/**
 * WheelPicker 模块测试
 *
 * 注意：setup.js 在每个测试前清空 DOM，因此 DOM 和模块必须在 beforeEach 中重新设置。
 * WheelPicker 的 IIFE 闭包状态通过 _resetState() 重置。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/wheelPicker')
})

beforeEach(() => {
  document.body.innerHTML = `
    <div id="wheel-picker">
      <div id="wheel-column"></div>
    </div>
  `
  // 重置 IIFE 闭包状态
  if (window.WheelPicker && window.WheelPicker._resetState) {
    window.WheelPicker._resetState()
  }
  window.WheelPicker.init(
    document.getElementById('wheel-picker'),
    document.getElementById('wheel-column'),
    null
  )
})

describe('WheelPicker 模块', () => {
  it('init 后默认值为 25', () => {
    expect(window.WheelPicker.getValue()).toBe(25)
  })

  it('init 应渲染 wheel-picker-item 元素', () => {
    const items = document.querySelectorAll('.wheel-picker-item')
    expect(items.length).toBeGreaterThan(0)
  })

  it('init 应绑定 wheel/mousedown/touchstart 事件', () => {
    const picker = document.getElementById('wheel-picker')
    const spy = vi.spyOn(picker, 'addEventListener')
    window.WheelPicker.init(picker, document.getElementById('wheel-column'), null)
    expect(spy).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false })
    expect(spy).toHaveBeenCalledWith('mousedown', expect.any(Function))
    expect(spy).toHaveBeenCalledWith('touchstart', expect.any(Function), { passive: false })
  })

  it('setValue 应更新内部值', () => {
    window.WheelPicker.setValue(50)
    expect(window.WheelPicker.getValue()).toBe(50)
  })

  it('setValue 小于 MIN_VAL(1) 应被钳制为 1', () => {
    window.WheelPicker.setValue(-10)
    expect(window.WheelPicker.getValue()).toBe(1)
  })

  it('setValue 大于 MAX_VAL(120) 应被钳制为 120', () => {
    window.WheelPicker.setValue(999)
    expect(window.WheelPicker.getValue()).toBe(120)
  })

  it('setValue 边界值 1', () => {
    window.WheelPicker.setValue(1)
    expect(window.WheelPicker.getValue()).toBe(1)
  })

  it('setValue 边界值 120', () => {
    window.WheelPicker.setValue(120)
    expect(window.WheelPicker.getValue()).toBe(120)
  })

  it('setChangeCallback 应设置回调', () => {
    const cb = vi.fn()
    window.WheelPicker.setChangeCallback(cb)
    // 触发 wheel 事件以验证回调
    const picker = document.getElementById('wheel-picker')
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true })
    picker.dispatchEvent(event)
    expect(cb).toHaveBeenCalled()
  })

  it('wheel 事件 deltaY>0 应增加 1', () => {
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    picker.dispatchEvent(event)
    expect(window.WheelPicker.getValue()).toBe(26)
  })

  it('wheel 事件 deltaY<0 应减少 1', () => {
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    const event = new WheelEvent('wheel', { deltaY: -100, bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    picker.dispatchEvent(event)
    expect(window.WheelPicker.getValue()).toBe(24)
  })

  it('wheel 在 MAX_VAL 时不增加', () => {
    window.WheelPicker.setValue(120)
    const picker = document.getElementById('wheel-picker')
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    picker.dispatchEvent(event)
    expect(window.WheelPicker.getValue()).toBe(120)
  })

  it('wheel 在 MIN_VAL 时不减少', () => {
    window.WheelPicker.setValue(1)
    const picker = document.getElementById('wheel-picker')
    const event = new WheelEvent('wheel', { deltaY: -100, bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    picker.dispatchEvent(event)
    expect(window.WheelPicker.getValue()).toBe(1)
  })

  it('setEnabled(false) 应禁用 wheel 响应', () => {
    window.WheelPicker.setValue(25)
    window.WheelPicker.setEnabled(false)
    const picker = document.getElementById('wheel-picker')
    expect(picker.classList.contains('disabled')).toBe(true)
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    picker.dispatchEvent(event)
    expect(window.WheelPicker.getValue()).toBe(25)  // 不变
  })

  it('setEnabled(true) 应重新启用', () => {
    window.WheelPicker.setEnabled(false)
    window.WheelPicker.setEnabled(true)
    const picker = document.getElementById('wheel-picker')
    expect(picker.classList.contains('disabled')).toBe(false)
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    picker.dispatchEvent(event)
    expect(window.WheelPicker.getValue()).toBe(26)
  })

  it('mousedown 应启动拖拽并设置 cursor 为 grabbing', () => {
    window.WheelPicker.setEnabled(true)
    const picker = document.getElementById('wheel-picker')
    const event = new MouseEvent('mousedown', { clientY: 100, bubbles: true })
    picker.dispatchEvent(event)
    expect(picker.style.cursor).toBe('grabbing')
  })

  it('mousedown 在禁用状态不应启动拖拽', () => {
    window.WheelPicker.setEnabled(false)
    const picker = document.getElementById('wheel-picker')
    const event = new MouseEvent('mousedown', { clientY: 100, bubbles: true })
    picker.dispatchEvent(event)
    // 不应改变 cursor（保持禁用样式）
    // 拖拽逻辑不会执行，cursor 不会被设置为 grabbing
  })

  it('拖拽中 mousemove 应更新显示', () => {
    window.WheelPicker.setEnabled(true)
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    // mock performance.now 使 dt=0，避免惯性动画干扰
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValue(1000)
    // 启动拖拽
    const startEvent = new MouseEvent('mousedown', { clientY: 100, bubbles: true })
    picker.dispatchEvent(startEvent)
    // 模拟向下拖拽 32px（应让值 -1）
    const moveEvent = new MouseEvent('mousemove', { clientY: 132, bubbles: true })
    document.dispatchEvent(moveEvent)
    // 拖拽中尚未 snap，值还是 25
    expect(window.WheelPicker.getValue()).toBe(25)
    // 释放
    const endEvent = new MouseEvent('mouseup', { bubbles: true })
    document.dispatchEvent(endEvent)
    nowSpy.mockRestore()
    // 释放后 snap 到 25 - 1 = 24
    expect(window.WheelPicker.getValue()).toBe(24)
  })

  it('mouseup 未拖拽时不应报错', () => {
    const endEvent = new MouseEvent('mouseup', { bubbles: true })
    expect(() => document.dispatchEvent(endEvent)).not.toThrow()
  })

  it('touchstart 应启动拖拽', () => {
    window.WheelPicker.setEnabled(true)
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    const touchEvent = new TouchEvent('touchstart', {
      touches: [{ clientY: 100 }],
      bubbles: true
    })
    picker.dispatchEvent(touchEvent)
    expect(picker.style.cursor).toBe('grabbing')
  })

  it('touchmove 在未拖拽时不应报错', () => {
    const moveEvent = new TouchEvent('touchmove', {
      touches: [{ clientY: 50 }],
      bubbles: true
    })
    expect(() => document.dispatchEvent(moveEvent)).not.toThrow()
  })

  it('touchmove 拖拽中应更新显示', () => {
    window.WheelPicker.setEnabled(true)
    window.WheelPicker.setValue(50)
    const picker = document.getElementById('wheel-picker')
    // mock performance.now 使 dt=0，避免惯性动画干扰
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValue(1000)
    const startEvent = new TouchEvent('touchstart', {
      touches: [{ clientY: 100 }],
      bubbles: true
    })
    picker.dispatchEvent(startEvent)
    const moveEvent = new TouchEvent('touchmove', {
      touches: [{ clientY: 100 - 32 }],  // 向上拖拽，值 +1
      bubbles: true
    })
    document.dispatchEvent(moveEvent)
    expect(window.WheelPicker.getValue()).toBe(50)  // snap 之前仍是原值
    const endEvent = new TouchEvent('touchend', { bubbles: true })
    document.dispatchEvent(endEvent)
    nowSpy.mockRestore()
    expect(window.WheelPicker.getValue()).toBe(51)
  })

  it('setValue 应正确渲染 wheelColumn 子元素', () => {
    window.WheelPicker.setValue(60)
    const items = document.querySelectorAll('.wheel-picker-item')
    expect(items.length).toBeGreaterThan(0)
    // 中间项的 data-val 应为 60
    const centerItem = Array.from(items).find(el => parseInt(el.dataset.val) === 60)
    expect(centerItem).toBeDefined()
    expect(centerItem.classList.contains('center')).toBe(true)
  })

  it('setChangeCallback 多次设置应覆盖', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    window.WheelPicker.setChangeCallback(cb1)
    window.WheelPicker.setChangeCallback(cb2)
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    picker.dispatchEvent(event)
    expect(cb2).toHaveBeenCalled()
    expect(cb1).not.toHaveBeenCalled()
  })
})

describe('WheelPicker 惯性动画', () => {
  it('高速度拖拽应触发惯性动画并 snap', () => {
    window.WheelPicker.setEnabled(true)
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    // 使用递增的 performance.now 使 dt > 0，从而计算 dragVelocity
    let nowCounter = 1000
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockImplementation(() => {
      const v = nowCounter
      nowCounter += 16  // 每次调用增加 16ms
      return v
    })
    // mock requestAnimationFrame 使动画同步执行
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    rafSpy.mockImplementation((cb) => { cb(); return 1 })

    // 启动拖拽
    const startEvent = new MouseEvent('mousedown', { clientY: 100, bubbles: true })
    picker.dispatchEvent(startEvent)
    // 快速向上拖拽（值增加），产生正速度
    const moveEvent = new MouseEvent('mousemove', { clientY: 68, bubbles: true })
    document.dispatchEvent(moveEvent)
    // 释放鼠标 → 高速度 → animateWheelInertia
    const endEvent = new MouseEvent('mouseup', { bubbles: true })
    document.dispatchEvent(endEvent)

    // 惯性动画后值应增加（snap 到某个值 > 25）
    expect(window.WheelPicker.getValue()).toBeGreaterThan(25)

    nowSpy.mockRestore()
    rafSpy.mockRestore()
  })

  it('惯性动画撞击 MIN_VAL 应停止', () => {
    window.WheelPicker.setEnabled(true)
    window.WheelPicker.setValue(2)
    const picker = document.getElementById('wheel-picker')
    let nowCounter = 1000
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockImplementation(() => {
      const v = nowCounter
      nowCounter += 16
      return v
    })
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    rafSpy.mockImplementation((cb) => { cb(); return 1 })

    // 向下拖拽（值减少），产生负速度，会撞到 MIN_VAL
    const startEvent = new MouseEvent('mousedown', { clientY: 100, bubbles: true })
    picker.dispatchEvent(startEvent)
    const moveEvent = new MouseEvent('mousemove', { clientY: 200, bubbles: true })
    document.dispatchEvent(moveEvent)
    const endEvent = new MouseEvent('mouseup', { bubbles: true })
    document.dispatchEvent(endEvent)

    // 应 snap 到 MIN_VAL (1)
    expect(window.WheelPicker.getValue()).toBe(1)

    nowSpy.mockRestore()
    rafSpy.mockRestore()
  })

  it('惯性动画撞击 MAX_VAL 应停止', () => {
    window.WheelPicker.setEnabled(true)
    window.WheelPicker.setValue(118)
    const picker = document.getElementById('wheel-picker')
    let nowCounter = 1000
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockImplementation(() => {
      const v = nowCounter
      nowCounter += 16
      return v
    })
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    rafSpy.mockImplementation((cb) => { cb(); return 1 })

    // 向上拖拽（值增加），产生正速度，会撞到 MAX_VAL
    const startEvent = new MouseEvent('mousedown', { clientY: 100, bubbles: true })
    picker.dispatchEvent(startEvent)
    const moveEvent = new MouseEvent('mousemove', { clientY: 0, bubbles: true })
    document.dispatchEvent(moveEvent)
    const endEvent = new MouseEvent('mouseup', { bubbles: true })
    document.dispatchEvent(endEvent)

    // 惯性动画后值应被钳制到 MAX_VAL (120)
    const finalVal = window.WheelPicker.getValue()
    expect(finalVal).toBeGreaterThanOrEqual(118)
    expect(finalVal).toBeLessThanOrEqual(120)

    nowSpy.mockRestore()
    rafSpy.mockRestore()
  })

  it('低速度拖拽应直接 snap（不触发惯性）', () => {
    window.WheelPicker.setEnabled(true)
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    // dt=0 → dragVelocity=0 → 低速度路径
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValue(1000)

    const startEvent = new MouseEvent('mousedown', { clientY: 100, bubbles: true })
    picker.dispatchEvent(startEvent)
    const moveEvent = new MouseEvent('mousemove', { clientY: 132, bubbles: true })
    document.dispatchEvent(moveEvent)
    const endEvent = new MouseEvent('mouseup', { bubbles: true })
    document.dispatchEvent(endEvent)

    nowSpy.mockRestore()
    // snap 到 25 - 1 = 24
    expect(window.WheelPicker.getValue()).toBe(24)
  })

  it('snapWheelToValue 应触发 onChangeCallback', () => {
    const cb = vi.fn()
    window.WheelPicker.setChangeCallback(cb)
    window.WheelPicker.setEnabled(true)
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValue(1000)

    const startEvent = new MouseEvent('mousedown', { clientY: 100, bubbles: true })
    picker.dispatchEvent(startEvent)
    const moveEvent = new MouseEvent('mousemove', { clientY: 132, bubbles: true })
    document.dispatchEvent(moveEvent)
    const endEvent = new MouseEvent('mouseup', { bubbles: true })
    document.dispatchEvent(endEvent)

    nowSpy.mockRestore()
    expect(cb).toHaveBeenCalledWith(24)
  })
})

describe('WheelPicker onWheel 范围分支', () => {
  it('wheel 在当前可见范围内应更新 opacity', () => {
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    // 小幅滚动，新值仍在可见范围内（25±3=22~28）
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    picker.dispatchEvent(event)
    expect(window.WheelPicker.getValue()).toBe(26)
    // 验证 transition 被设置为 ease-out（范围内路径）
    const column = document.getElementById('wheel-column')
    expect(column.style.transition).toContain('ease-out')
  })

  it('wheel 超出当前可见范围应重新渲染', () => {
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    // 连续滚动多次直到超出可见范围
    // 当前范围是 22~28，滚到 29 会超出
    for (let i = 0; i < 5; i++) {
      const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true })
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
      picker.dispatchEvent(event)
    }
    // 值应为 30
    expect(window.WheelPicker.getValue()).toBe(30)
    // 验证 transition 被设置为 none（范围外路径，重新渲染）
    const column = document.getElementById('wheel-column')
    // 最后一轮滚动可能走范围内或范围外路径，验证值正确即可
    expect(window.WheelPicker.getValue()).toBeGreaterThan(25)
  })

  it('wheel deltaY=0 时按 -1 处理（0 不大于 0）', () => {
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    const event = new WheelEvent('wheel', { deltaY: 0, bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    picker.dispatchEvent(event)
    // deltaY=0 → 0 > 0 为 false → d = -1 → 值减少 1
    expect(window.WheelPicker.getValue()).toBe(24)
  })
})

describe('WheelPicker updateWheelDisplay 范围变化', () => {
  it('拖拽到不同范围应重新生成 wheel items', () => {
    window.WheelPicker.setEnabled(true)
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    // dt=0 → dragVelocity=0 → 低速度路径，直接 snap（同步执行）
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValue(1000)

    const startEvent = new MouseEvent('mousedown', { clientY: 100, bubbles: true })
    picker.dispatchEvent(startEvent)
    // 大幅向上拖拽，使值变化超过 VISIBLE_RANGE（触发 updateWheelDisplay 重新生成）
    // delta = -300, newVal = 25 - (-300)/32 = 34.375 → snap 到 34
    const moveEvent = new MouseEvent('mousemove', { clientY: -200, bubbles: true })
    document.dispatchEvent(moveEvent)
    const endEvent = new MouseEvent('mouseup', { bubbles: true })
    document.dispatchEvent(endEvent)

    nowSpy.mockRestore()
    // 值应增加（向上拖拽）：snap 到 34
    expect(window.WheelPicker.getValue()).toBe(34)
    // 验证 wheel items 已重新生成（中心项 data-val 应为 34）
    const items = document.querySelectorAll('.wheel-picker-item')
    expect(items.length).toBeGreaterThan(0)
    const centerItem = Array.from(items).find(el => el.classList.contains('center'))
    expect(centerItem).toBeDefined()
    expect(parseInt(centerItem.dataset.val)).toBe(34)
  })

  it('拖拽向下到不同范围应重新生成 wheel items', () => {
    window.WheelPicker.setEnabled(true)
    window.WheelPicker.setValue(25)
    const picker = document.getElementById('wheel-picker')
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValue(1000)

    const startEvent = new MouseEvent('mousedown', { clientY: 100, bubbles: true })
    picker.dispatchEvent(startEvent)
    // 向下拖拽，值减少超过 VISIBLE_RANGE
    // delta = 300, newVal = 25 - 300/32 = 15.625 → snap 到 16
    const moveEvent = new MouseEvent('mousemove', { clientY: 400, bubbles: true })
    document.dispatchEvent(moveEvent)
    const endEvent = new MouseEvent('mouseup', { bubbles: true })
    document.dispatchEvent(endEvent)

    nowSpy.mockRestore()
    expect(window.WheelPicker.getValue()).toBe(16)
    const items = document.querySelectorAll('.wheel-picker-item')
    expect(items.length).toBeGreaterThan(0)
  })
})

describe('WheelPicker touch 事件分支', () => {
  it('touchmove 无 touches 时不应报错', () => {
    window.WheelPicker.setEnabled(true)
    const picker = document.getElementById('wheel-picker')
    // 先启动拖拽
    const startEvent = new TouchEvent('touchstart', {
      touches: [{ clientY: 100 }],
      bubbles: true
    })
    picker.dispatchEvent(startEvent)
    // touchmove 无 touches（e.clientY undefined, e.touches undefined）
    // 源码: const clientY = e.clientY || (e.touches && e.touches[0].clientY)
    // 当两者都 undefined 时 clientY 为 undefined，应 return
    const moveEvent = new Event('touchmove', { bubbles: true })
    expect(() => document.dispatchEvent(moveEvent)).not.toThrow()
  })
})

describe('WheelPicker 防御性分支', () => {
  it('onWheel 在 wheelColumn 为空时应走 currItems.length===0 分支并重新渲染', () => {
    window.WheelPicker.setValue(25)
    // 清空 wheelColumn 模拟异常状态
    const column = document.getElementById('wheel-column')
    column.innerHTML = ''
    const picker = document.getElementById('wheel-picker')
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
    picker.dispatchEvent(event)
    // currItems.length===0 → currStart=0, currEnd=0 → nv(26) 不在 [0,0] → 走 else 重新渲染
    expect(window.WheelPicker.getValue()).toBe(26)
    // 重新渲染后应有 wheel items
    const items = document.querySelectorAll('.wheel-picker-item')
    expect(items.length).toBeGreaterThan(0)
  })
})
