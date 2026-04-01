/**
 * 番茄钟 - 教程弹窗模块
 */
;(function() {
  'use strict'

  function init() {
    // 打开弹窗
    DOM.tutorialBtn.addEventListener('click', () => {
      // 展开侧边栏（如果收起状态）
      if (window.expandSidebarIfNeeded) {
        window.expandSidebarIfNeeded()
      }
      DOM.tutorialModal.classList.add('show')
    })

    // 关闭按钮
    DOM.tutorialClose.addEventListener('click', () => {
      closeTutorial()
    })

    // 点击遮罩层关闭
    DOM.tutorialModal.addEventListener('click', (e) => {
      if (e.target === DOM.tutorialModal) {
        closeTutorial()
      }
    })

    // 分页标签切换
    const tabs = document.querySelectorAll('.tutorial-tab')
    const pages = document.querySelectorAll('.tutorial-page')
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab
        
        // 更新标签状态
        tabs.forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        
        // 更新页面显示
        pages.forEach(page => {
          page.classList.remove('active')
          if (page.id === `tutorial-${targetTab}`) {
            page.classList.add('active')
          }
        })
      })
    })
  }

  function closeTutorial() {
    DOM.tutorialModal.classList.remove('show')
    DOM.tutorialModal.classList.add('hiding')
    
    setTimeout(() => {
      DOM.tutorialModal.classList.remove('hiding')
    }, 500)
  }

  // 导出到全局
  window.Tutorial = {
    init
  }
})()
