/**
 * Mode 模块测试
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/mode')
})

beforeEach(() => {
  // setup.js clears DOM between tests; re-setup and re-init
  document.body.innerHTML = `
    <div class="container"></div>
    <div class="window-frame"></div>
    <button class="mode-btn" data-mode="work">work</button>
    <button class="mode-btn" data-mode="break">break</button>
  `
  window.Mode.init(
    { modeBtns: document.querySelectorAll('.mode-btn'), container: document.querySelector('.container') },
    {}
  )
  // Reset to default mode
  window.Mode.setMode('work')
})

describe('Mode 模块', () => {
  it('MODE 常量应包含 WORK 和 BREAK', () => {
    expect(window.Mode.MODE.WORK).toBe('work')
    expect(window.Mode.MODE.BREAK).toBe('break')
  })

  it('默认模式为 WORK', () => {
    expect(window.Mode.getMode()).toBe('work')
  })

  it('isWorkMode / isBreakMode 初始状态', () => {
    expect(window.Mode.isWorkMode()).toBe(true)
    expect(window.Mode.isBreakMode()).toBe(false)
  })

  it('setMode 切换到 break 应更新按钮 active 类', () => {
    window.Mode.setMode('break')
    const btns = document.querySelectorAll('.mode-btn')
    expect(btns[0].classList.contains('active')).toBe(false)
    expect(btns[1].classList.contains('active')).toBe(true)
  })

  it('setMode 切换到 break 应给 container 添加 break-mode 类', () => {
    window.Mode.setMode('break')
    expect(document.querySelector('.container').classList.contains('break-mode')).toBe(true)
    expect(document.querySelector('.window-frame').classList.contains('break-mode')).toBe(true)
  })

  it('setMode 切换回 work 应移除 break-mode 类', () => {
    window.Mode.setMode('break')
    window.Mode.setMode('work')
    expect(document.querySelector('.container').classList.contains('break-mode')).toBe(false)
    expect(document.querySelector('.window-frame').classList.contains('break-mode')).toBe(false)
    const btns = document.querySelectorAll('.mode-btn')
    expect(btns[0].classList.contains('active')).toBe(true)
    expect(btns[1].classList.contains('active')).toBe(false)
  })

  it('setMode 应调用 onModeChange 回调', () => {
    const cb = vi.fn()
    window.Mode.init(
      { modeBtns: document.querySelectorAll('.mode-btn'), container: document.querySelector('.container') },
      { onModeChange: cb }
    )
    window.Mode.setMode('break')
    expect(cb).toHaveBeenCalledWith('break')
    window.Mode.setMode('work')
    expect(cb).toHaveBeenCalledWith('work')
  })

  it('init 应给按钮绑定 click 事件', () => {
    const btns = document.querySelectorAll('.mode-btn')
    const spy = vi.spyOn(btns[0], 'addEventListener')
    window.Mode.init(
      { modeBtns: btns, container: document.querySelector('.container') },
      {}
    )
    expect(spy).toHaveBeenCalledWith('click', expect.any(Function))
  })

  it('点击 work 按钮应切换到 work 模式', () => {
    const btns = document.querySelectorAll('.mode-btn')
    window.Mode.setMode('break')
    btns[0].click()
    expect(window.Mode.getMode()).toBe('work')
  })

  it('点击 break 按钮应切换到 break 模式', () => {
    const btns = document.querySelectorAll('.mode-btn')
    btns[1].click()
    expect(window.Mode.getMode()).toBe('break')
  })

  it('onBeforeChange 返回 false 时不应切换模式', () => {
    const onBeforeChange = vi.fn().mockReturnValue(false)
    window.Mode.init(
      { modeBtns: document.querySelectorAll('.mode-btn'), container: document.querySelector('.container') },
      { onBeforeChange }
    )
    window.Mode.setMode('work')
    const btns = document.querySelectorAll('.mode-btn')
    btns[1].click()
    expect(onBeforeChange).toHaveBeenCalledWith('break')
    expect(window.Mode.getMode()).toBe('work')
  })

  it('onBeforeChange 返回 true 时应切换模式', () => {
    const onBeforeChange = vi.fn().mockReturnValue(true)
    window.Mode.init(
      { modeBtns: document.querySelectorAll('.mode-btn'), container: document.querySelector('.container') },
      { onBeforeChange }
    )
    window.Mode.setMode('work')
    const btns = document.querySelectorAll('.mode-btn')
    btns[1].click()
    expect(window.Mode.getMode()).toBe('break')
  })

  it('init 无回调参数不应报错', () => {
    expect(() => {
      window.Mode.init(
        { modeBtns: document.querySelectorAll('.mode-btn'), container: document.querySelector('.container') }
      )
    }).not.toThrow()
  })

  it('切换模式后 isWorkMode / isBreakMode 应正确反映', () => {
    window.Mode.setMode('break')
    expect(window.Mode.isWorkMode()).toBe(false)
    expect(window.Mode.isBreakMode()).toBe(true)
    window.Mode.setMode('work')
    expect(window.Mode.isWorkMode()).toBe(true)
    expect(window.Mode.isBreakMode()).toBe(false)
  })
})
