/**
 * 番茄钟 - 教程弹窗模块
 */
;(function() {
  'use strict'

  let tutorialModal = null

  function init() {
    // 创建弹窗实例
    tutorialModal = new AnimatedModal({
      element: DOM.tutorialModal,
      showClass: 'show',
      hidingClass: 'hiding',
      animationDuration: 500
    })

    // 打开弹窗
    DOM.tutorialBtn.addEventListener('click', () => {
      tutorialModal.show()
    })

    // 关闭按钮
    DOM.tutorialClose.addEventListener('click', () => {
      tutorialModal.hide()
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

  // 导出到全局
  window.Tutorial = {
    init,
    show: () => tutorialModal?.show(),
    hide: () => tutorialModal?.hide()
  }
})()