/**
 * 主题模块 - 管理深色/亮色模式切换
 */
;(function() {
  'use strict'

  // 私有变量：存储 DOM 元素和当前主题
  let elements = {}
  let currentTheme = 'light' // 默认亮色

  /**
   * 应用主题到页面
   * @param {string} theme - 'light' 或 'dark'
   */
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark-theme')
      // 切换按钮图标为太阳（表示当前是深色，点击会切回亮色）
      if (elements.themeToggleBtn) {
        elements.themeToggleBtn.textContent = '☀️'
        elements.themeToggleBtn.title = '切换亮色模式'
      }
    } else {
      document.body.classList.remove('dark-theme')
      // 切换按钮图标为月亮
      if (elements.themeToggleBtn) {
        elements.themeToggleBtn.textContent = '🌙'
        elements.themeToggleBtn.title = '切换深色模式'
      }
    }
    currentTheme = theme
  }

  /**
   * 切换主题（亮色 ↔ 深色）
   */
  async function toggleTheme() {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light'
    applyTheme(newTheme)

    // 将用户选择保存到数据存储中
    if (window.DataStore && window.DataStore.updateTheme) {
      await window.DataStore.updateTheme(newTheme)
    }
  }

  /**
   * 从数据存储中加载保存的主题
   */
  async function loadSavedTheme() {
    if (window.DataStore && window.DataStore.getTheme) {
      const theme = await window.DataStore.getTheme()
      applyTheme(theme)
    }
  }

  /**
   * 初始化主题模块
   * @param {Object} els - 包含所需 DOM 元素的对象
   */
  function init(els) {
    elements = els
    // 加载保存的主题
    loadSavedTheme()
    // 绑定点击事件
    if (elements.themeToggleBtn) {
      elements.themeToggleBtn.addEventListener('click', toggleTheme)
    }
  }

  // 将公共 API 暴露给全局 window 对象
  window.Theme = {
    init: init,
    toggle: toggleTheme,
    getCurrentTheme: () => currentTheme
  }
})()