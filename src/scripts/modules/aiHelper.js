/**
 * AI助手模块 - 渲染进程
 * 处理AI规划助手的UI交互
 */

const AIHelper = (function() {
  'use strict'

  let elements = {}
  let isProcessing = false
  let currentRequestId = 0
  let aiModal = null
  let aiConfirmModal = null

  /**
   * 初始化AI助手
   */
  function init(els) {
    elements = els
    
    // 创建弹窗实例
    aiModal = new AnimatedModal({
      element: elements.aiModal,
      showClass: 'show',
      hidingClass: 'hiding',
      animationDuration: 500,
      closeOnBackground: true,
      onBackgroundClick: () => !isProcessing,
      onShow: () => {
        // 确保状态已重置
        isProcessing = false
        
        // 清空之前的内容
        if (elements.aiInput) {
          elements.aiInput.value = ''
        }
        if (elements.aiResult) {
          elements.aiResult.innerHTML = ''
        }
        if (elements.aiApplyBtn) {
          elements.aiApplyBtn.style.display = 'none'
          elements.aiApplyBtn.dataset.plan = ''
        }
      },
      onHide: () => {
        aiConfirmModal?.hide()
        // 取消当前请求（通过增加requestId使旧请求失效）
        currentRequestId++
        
        // 清空所有内容和状态
        if (elements.aiInput) {
          elements.aiInput.value = ''
        }
        if (elements.aiResult) {
          elements.aiResult.innerHTML = ''
        }
        if (elements.aiApplyBtn) {
          elements.aiApplyBtn.style.display = 'none'
          elements.aiApplyBtn.dataset.plan = ''
        }
        
        // 重置生成状态
        isProcessing = false
      }
    })

    aiConfirmModal = new BaseModal({
      element: document.getElementById('ai-confirm-dialog'),
      showClass: 'show',
      closeOnBackground: true,
      expandSidebarOnShow: false
    })
    
    bindEvents()
  }

  /**
   * 绑定事件
   */
  function bindEvents() {
    // AI助手按钮点击
    if (elements.aiBtn) {
      elements.aiBtn.addEventListener('click', () => aiModal.show())
    }

    // 关闭弹窗
    if (elements.aiModalClose) {
      elements.aiModalClose.addEventListener('click', handleCloseClick)
    }

    // 生成计划按钮
    if (elements.aiGenerateBtn) {
      elements.aiGenerateBtn.addEventListener('click', handleGenerate)
    }

    // 输入框回车键
    if (elements.aiInput) {
      elements.aiInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleGenerate()
        }
      })
    }

    // 应用计划按钮
    if (elements.aiApplyBtn) {
      elements.aiApplyBtn.addEventListener('click', handleApplyPlan)
    }

    const aiConfirmCancelBtn = document.getElementById('ai-confirm-cancel-btn')
    const aiConfirmOkBtn = document.getElementById('ai-confirm-ok-btn')
    if (aiConfirmCancelBtn) {
      aiConfirmCancelBtn.addEventListener('click', () => {
        aiConfirmModal?.hide()
      })
    }
    if (aiConfirmOkBtn) {
      aiConfirmOkBtn.addEventListener('click', () => {
        aiConfirmModal?.hide()
        aiModal.hide()
      })
    }
  }

  /**
   * 处理关闭按钮点击
   */
  function handleCloseClick() {
    if (isProcessing) {
      aiConfirmModal?.show()
    } else {
      aiModal.hide()
    }
  }

  /**
   * 处理生成计划
   */
  async function handleGenerate() {
    const input = elements.aiInput?.value.trim()
    
    if (!input) {
      showError('请输入您的工作或学习需求')
      return
    }

    if (isProcessing) {
      return
    }

    isProcessing = true
    const requestId = ++currentRequestId
    showLoading()

    try {
      const result = await window.electronAPI.aiGeneratePlan(input)
      
      // 检查请求是否已过期（弹窗已关闭）
      if (requestId !== currentRequestId) {
        return
      }
      
      if (result.success) {
        displayPlan(result.data)
      } else {
        showError(result.error || '生成计划失败，请重试')
      }
    } catch (error) {
      // 检查请求是否已过期
      if (requestId !== currentRequestId) {
        return
      }
      
      console.error('AI助手错误:', error)
      showError('网络错误，请检查连接后重试')
    } finally {
      // 只有当前请求才重置状态
      if (requestId === currentRequestId) {
        isProcessing = false
      }
    }
  }

  /**
   * 显示加载状态
   */
  function showLoading() {
    if (elements.aiResult) {
      elements.aiResult.innerHTML = '<div class="ai-loading">🤖 AI正在为您规划...</div>'
    }
    if (elements.aiApplyBtn) {
      elements.aiApplyBtn.style.display = 'none'
    }
  }

  /**
   * 显示错误信息
   */
  function showError(message) {
    if (elements.aiResult) {
      elements.aiResult.innerHTML = `<div class="ai-error">❌ ${message}</div>`
    }
  }

  /**
   * 显示生成的计划
   */
  function displayPlan(data) {
    if (!elements.aiResult) return

    let html = '<div class="ai-plan-result">'
    
    // 显示总结
    if (data.summary) {
      html += `<div class="ai-summary">📋 ${data.summary}</div>`
    }

    // 显示计划列表
    if (data.plan && data.plan.length > 0) {
      html += '<div class="ai-plan-list">'
      
      data.plan.forEach((item, index) => {
        const icon = item.type === 'work' ? '💼' : '☕'
        const typeText = item.type === 'work' ? '工作' : '休息'
        const className = item.type === 'work' ? 'work' : 'break'
        
        html += `
          <div class="ai-plan-item ${className}">
            <span class="ai-plan-number">${index + 1}</span>
            <span class="ai-plan-icon">${icon}</span>
            <span class="ai-plan-type">${typeText}</span>
            <span class="ai-plan-time">${item.minutes}分钟</span>
            ${item.description ? `<span class="ai-plan-desc">${item.description}</span>` : ''}
          </div>
        `
      })
      
      html += '</div>'
      
      // 计算总时间
      const totalMinutes = data.plan.reduce((sum, item) => sum + item.minutes, 0)
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      const timeText = hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`
      
      html += `<div class="ai-total-time">⏱️ 总计: ${timeText}</div>`
    }

    html += '</div>'
    
    elements.aiResult.innerHTML = html
    
    // 显示应用按钮，并根据番茄钟状态设置禁用状态
    if (elements.aiApplyBtn) {
      const isTimerRunning = window.Timer && window.Timer.getPhase() === window.Timer.PHASE.RUNNING
      
      elements.aiApplyBtn.style.display = 'block'
      elements.aiApplyBtn.disabled = isTimerRunning
      
      if (isTimerRunning) {
        elements.aiApplyBtn.style.opacity = '0.5'
        elements.aiApplyBtn.style.cursor = 'not-allowed'
        elements.aiApplyBtn.title = '请先停止当前番茄钟'
      } else {
        elements.aiApplyBtn.style.opacity = '1'
        elements.aiApplyBtn.style.cursor = 'pointer'
        elements.aiApplyBtn.title = ''
      }
      
      // 保存计划数据到按钮
      elements.aiApplyBtn.dataset.plan = JSON.stringify(data.plan)
    }
  }

  /**
   * 应用计划到番茄钟
   */
  async function handleApplyPlan() {
    // 检查番茄钟是否在运行阶段
    if (window.Timer && window.Timer.getPhase() === window.Timer.PHASE.RUNNING) {
      showError('请先停止当前番茄钟再应用计划')
      return
    }

    const planData = elements.aiApplyBtn?.dataset.plan
    
    if (!planData) {
      showError('计划数据丢失')
      return
    }

    try {
      const plan = JSON.parse(planData)
      
      // 切换到计划模式
      if (window.AppState) {
        window.AppState.switchAppMode('plan')
      }

      // 清空现有计划
      if (window.PlanMode) {
        await window.PlanMode.clearAll()
        
        // 添加AI生成的计划
        for (const item of plan) {
          await window.PlanMode.addItem(item.minutes, item.type)
        }
      }

      // 关闭弹窗
      aiModal.hide()
      
      // 显示成功提示
      if (window.DOM && window.DOM.statusEl) {
        window.DOM.statusEl.textContent = '✨ AI计划已应用，点击开始执行'
      }
    } catch (error) {
      console.error('应用计划失败:', error)
      showError('应用计划失败')
    }
  }

  return {
    init
  }
})()

// 暴露到全局
window.AIHelper = AIHelper
