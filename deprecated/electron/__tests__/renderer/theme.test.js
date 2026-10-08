/**
 * Theme 模块测试
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/theme')
})

beforeEach(() => {
  // setup.js clears DOM between tests; re-setup
  document.body.innerHTML = `<button id="theme-toggle-btn">🌙</button>`
  window.DataStore = {
    getTheme: vi.fn().mockResolvedValue('light'),
    updateTheme: vi.fn().mockResolvedValue(true)
  }
  // Re-init Theme with light theme to reset internal state
  window.Theme.init({ themeToggleBtn: document.getElementById('theme-toggle-btn') })
})

// Helper: wait for async loadSavedTheme to complete
function flush() {
  return new Promise(r => setTimeout(r, 0))
}

describe('Theme 模块', () => {
  it('默认主题应为 light', async () => {
    await flush()
    expect(window.Theme.getCurrentTheme()).toBe('light')
  })

  it('init 应加载保存的主题并绑定点击事件', async () => {
    const btn = document.getElementById('theme-toggle-btn')
    const spy = vi.spyOn(btn, 'addEventListener')
    window.Theme.init({ themeToggleBtn: btn })
    expect(spy).toHaveBeenCalledWith('click', expect.any(Function))
  })

  it('init 无 themeToggleBtn 时不报错', () => {
    expect(() => window.Theme.init({})).not.toThrow()
  })

  it('init 调用 DataStore.getTheme 加载保存的主题', async () => {
    window.DataStore.getTheme.mockResolvedValue('dark')
    window.Theme.init({ themeToggleBtn: document.getElementById('theme-toggle-btn') })
    await flush()
    expect(window.DataStore.getTheme).toHaveBeenCalled()
    expect(window.Theme.getCurrentTheme()).toBe('dark')
    expect(document.body.classList.contains('dark-theme')).toBe(true)
  })

  it('toggle 切换 light → dark 应添加 dark-theme 类', async () => {
    await flush()
    expect(window.Theme.getCurrentTheme()).toBe('light')
    await window.Theme.toggle()
    expect(window.Theme.getCurrentTheme()).toBe('dark')
    expect(document.body.classList.contains('dark-theme')).toBe(true)
    const btn = document.getElementById('theme-toggle-btn')
    expect(btn.textContent).toBe('☀️')
    expect(btn.title).toBe('切换亮色模式')
  })

  it('toggle 切换 dark → light 应移除 dark-theme 类', async () => {
    await flush()
    // First toggle: light → dark
    await window.Theme.toggle()
    expect(window.Theme.getCurrentTheme()).toBe('dark')
    // Second toggle: dark → light
    await window.Theme.toggle()
    expect(window.Theme.getCurrentTheme()).toBe('light')
    expect(document.body.classList.contains('dark-theme')).toBe(false)
    const btn = document.getElementById('theme-toggle-btn')
    expect(btn.textContent).toBe('🌙')
    expect(btn.title).toBe('切换深色模式')
  })

  it('toggle 应调用 DataStore.updateTheme 持久化', async () => {
    await flush()
    window.DataStore.updateTheme.mockClear()
    await window.Theme.toggle()
    expect(window.DataStore.updateTheme).toHaveBeenCalledWith('dark')
  })

  it('init 后点击按钮应触发 toggle', async () => {
    await flush()
    const btn = document.getElementById('theme-toggle-btn')
    const beforeTheme = window.Theme.getCurrentTheme()
    btn.click()
    await flush()
    const afterTheme = window.Theme.getCurrentTheme()
    expect(afterTheme).not.toBe(beforeTheme)
  })

  it('applyTheme dark 应设置按钮为太阳图标', async () => {
    await flush()
    await window.Theme.toggle()
    const btn = document.getElementById('theme-toggle-btn')
    expect(btn.textContent).toBe('☀️')
    expect(btn.title).toBe('切换亮色模式')
  })

  it('applyTheme light 应设置按钮为月亮图标', async () => {
    await flush()
    await window.Theme.toggle()  // → dark
    await window.Theme.toggle()  // → light
    const btn = document.getElementById('theme-toggle-btn')
    expect(btn.textContent).toBe('🌙')
    expect(btn.title).toBe('切换深色模式')
  })

  it('无 themeToggleBtn 时 applyTheme 不应报错', async () => {
    window.Theme.init({})
    await flush()
    await expect(window.Theme.toggle()).resolves.toBeUndefined()
  })

  it('DataStore 不存在时 toggle 不应报错', async () => {
    delete window.DataStore
    await flush()
    await expect(window.Theme.toggle()).resolves.toBeUndefined()
    // Restore for subsequent tests
    window.DataStore = {
      getTheme: vi.fn().mockResolvedValue('light'),
      updateTheme: vi.fn().mockResolvedValue(true)
    }
  })

  it('DataStore 无 getTheme 时 init 不应报错', async () => {
    window.DataStore = {}
    expect(() => window.Theme.init({ themeToggleBtn: document.getElementById('theme-toggle-btn') })).not.toThrow()
    await flush()
  })
})
