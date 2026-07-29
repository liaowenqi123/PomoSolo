/**
 * AIHelper 模块测试
 *
 * 测试AI助手：初始化、生成计划、应用计划、错误处理
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/utils')
  require('../../src/scripts/modules/aiHelper')
})

beforeEach(() => {
  document.body.innerHTML = `
    <div id="ai-modal">
      <button id="ai-modal-close">关闭</button>
      <textarea id="ai-input"></textarea>
      <button id="ai-generate-btn">生成</button>
      <button id="ai-apply-btn" style="display:none"></button>
      <div id="ai-result"></div>
    </div>
    <button id="ai-btn">AI助手</button>
    <div id="ai-confirm-dialog">
      <button id="ai-confirm-cancel-btn">取消</button>
      <button id="ai-confirm-ok-btn">确定</button>
    </div>
    <div id="status-el"></div>
  `

  window.AnimatedModal = vi.fn().mockImplementation(function({ element, onShow, onHide, onBackgroundClick, showClass } = {}) {
    return {
      element,
      showClass,
      show: vi.fn(() => onShow && onShow()),
      hide: vi.fn(() => onHide && onHide()),
      toggle: vi.fn()
    }
  })

  window.BaseModal = vi.fn().mockImplementation(function({ element, onShow, onHide, onBackgroundClick, showClass } = {}) {
    return {
      element,
      showClass,
      show: vi.fn(() => onShow && onShow()),
      hide: vi.fn(() => onHide && onHide()),
      toggle: vi.fn()
    }
  })

  window.electronAPI = {
    aiGeneratePlan: vi.fn()
  }

  window.Timer = {
    PHASE: { READY: 'ready', RUNNING: 'running', PAUSED: 'paused', FINISHED: 'finished' },
    getPhase: vi.fn().mockReturnValue('ready')
  }

  window.AppState = {
    switchAppMode: vi.fn()
  }

  window.PlanMode = {
    clearAll: vi.fn().mockResolvedValue(true),
    addItem: vi.fn().mockResolvedValue(true)
  }

  window.DOM = {
    statusEl: document.getElementById('status-el')
  }

  window.AIHelper.init({
    aiModal: document.getElementById('ai-modal'),
    aiModalClose: document.getElementById('ai-modal-close'),
    aiBtn: document.getElementById('ai-btn'),
    aiInput: document.getElementById('ai-input'),
    aiGenerateBtn: document.getElementById('ai-generate-btn'),
    aiApplyBtn: document.getElementById('ai-apply-btn'),
    aiResult: document.getElementById('ai-result')
  })
})

describe('AIHelper init', () => {
  it('init 应创建 AnimatedModal 和 BaseModal 实例', () => {
    expect(window.AnimatedModal).toHaveBeenCalled()
    expect(window.BaseModal).toHaveBeenCalled()
  })

  it('点击 AI 助手按钮应显示弹窗', () => {
    document.getElementById('ai-btn').click()
    const aiModalInstance = window.AnimatedModal.mock.results[0].value
    expect(aiModalInstance.show).toHaveBeenCalled()
  })

  it('点击关闭按钮（非处理中）应隐藏弹窗', () => {
    document.getElementById('ai-modal-close').click()
    const aiModalInstance = window.AnimatedModal.mock.results[0].value
    expect(aiModalInstance.hide).toHaveBeenCalled()
  })
})

describe('AIHelper handleGenerate', () => {
  it('空输入应显示错误提示', async () => {
    document.getElementById('ai-input').value = ''
    document.getElementById('ai-generate-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ai-result').innerHTML).toContain('请输入')
    expect(window.electronAPI.aiGeneratePlan).not.toHaveBeenCalled()
  })

  it('有效输入应调用 aiGeneratePlan', async () => {
    document.getElementById('ai-input').value = '我要学习英语'
    window.electronAPI.aiGeneratePlan.mockResolvedValue({
      success: true,
      data: {
        summary: '学习计划',
        plan: [{ type: 'work', minutes: 25, description: '学习' }]
      }
    })

    document.getElementById('ai-generate-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.aiGeneratePlan).toHaveBeenCalledWith('我要学习英语')
  })

  it('成功生成应显示计划内容', async () => {
    document.getElementById('ai-input').value = '学习'
    window.electronAPI.aiGeneratePlan.mockResolvedValue({
      success: true,
      data: {
        summary: '学习计划总结',
        plan: [
          { type: 'work', minutes: 25, description: '学习英语' },
          { type: 'break', minutes: 5, description: '休息' }
        ]
      }
    })

    document.getElementById('ai-generate-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    const resultHtml = document.getElementById('ai-result').innerHTML
    expect(resultHtml).toContain('学习计划总结')
    expect(resultHtml).toContain('学习英语')
    expect(resultHtml).toContain('休息')
    expect(resultHtml).toContain('30分钟')
  })

  it('生成失败应显示错误信息', async () => {
    document.getElementById('ai-input').value = '学习'
    window.electronAPI.aiGeneratePlan.mockResolvedValue({
      success: false,
      error: 'API错误'
    })

    document.getElementById('ai-generate-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ai-result').innerHTML).toContain('API错误')
  })

  it('生成异常应显示网络错误', async () => {
    document.getElementById('ai-input').value = '学习'
    window.electronAPI.aiGeneratePlan.mockRejectedValue(new Error('network'))

    document.getElementById('ai-generate-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ai-result').innerHTML).toContain('网络错误')
  })

  it('成功生成应显示应用按钮', async () => {
    document.getElementById('ai-input').value = '学习'
    window.electronAPI.aiGeneratePlan.mockResolvedValue({
      success: true,
      data: {
        summary: '计划',
        plan: [{ type: 'work', minutes: 25 }]
      }
    })

    document.getElementById('ai-generate-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ai-apply-btn').style.display).toBe('block')
  })

  it('Timer 运行中应禁用应用按钮', async () => {
    window.Timer.getPhase.mockReturnValue('running')
    document.getElementById('ai-input').value = '学习'
    window.electronAPI.aiGeneratePlan.mockResolvedValue({
      success: true,
      data: {
        summary: '计划',
        plan: [{ type: 'work', minutes: 25 }]
      }
    })

    document.getElementById('ai-generate-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ai-apply-btn').disabled).toBe(true)
  })

  it('回车键应触发生成', async () => {
    document.getElementById('ai-input').value = '学习'
    window.electronAPI.aiGeneratePlan.mockResolvedValue({
      success: true,
      data: { summary: '计划', plan: [] }
    })

    const input = document.getElementById('ai-input')
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }))

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.aiGeneratePlan).toHaveBeenCalled()
  })

  it('Shift+Enter 不应触发生成', async () => {
    document.getElementById('ai-input').value = '学习'
    const input = document.getElementById('ai-input')
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', shiftKey: true, bubbles: true }))

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.aiGeneratePlan).not.toHaveBeenCalled()
  })
})

describe('AIHelper handleApplyPlan', () => {
  it('Timer 运行中应显示错误', async () => {
    window.Timer.getPhase.mockReturnValue('running')
    // 先设置 plan 数据
    const applyBtn = document.getElementById('ai-apply-btn')
    applyBtn.dataset.plan = JSON.stringify([{ type: 'work', minutes: 25 }])

    applyBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ai-result').innerHTML).toContain('请先停止')
  })

  it('无计划数据应显示错误', async () => {
    window.Timer.getPhase.mockReturnValue('ready')
    const applyBtn = document.getElementById('ai-apply-btn')
    applyBtn.dataset.plan = ''

    applyBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('ai-result').innerHTML).toContain('计划数据丢失')
  })

  it('应用计划应切换到 plan 模式并清空、添加计划项', async () => {
    window.Timer.getPhase.mockReturnValue('ready')
    const applyBtn = document.getElementById('ai-apply-btn')
    applyBtn.dataset.plan = JSON.stringify([
      { type: 'work', minutes: 25 },
      { type: 'break', minutes: 5 }
    ])

    applyBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.AppState.switchAppMode).toHaveBeenCalledWith('plan')
    expect(window.PlanMode.clearAll).toHaveBeenCalled()
    expect(window.PlanMode.addItem).toHaveBeenCalledTimes(2)
    expect(window.PlanMode.addItem).toHaveBeenCalledWith(25, 'work')
    expect(window.PlanMode.addItem).toHaveBeenCalledWith(5, 'break')
  })

  it('应用成功应显示提示并关闭弹窗', async () => {
    window.Timer.getPhase.mockReturnValue('ready')
    const applyBtn = document.getElementById('ai-apply-btn')
    applyBtn.dataset.plan = JSON.stringify([{ type: 'work', minutes: 25 }])

    applyBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('status-el').textContent).toContain('AI计划已应用')
    const aiModalInstance = window.AnimatedModal.mock.results[0].value
    expect(aiModalInstance.hide).toHaveBeenCalled()
  })
})

describe('AIHelper 关闭弹窗时正在处理', () => {
  it('正在处理时点击关闭应显示确认弹窗', async () => {
    document.getElementById('ai-input').value = '学习'
    // 模拟长时间响应
    window.electronAPI.aiGeneratePlan.mockImplementation(() => new Promise(() => {}))

    document.getElementById('ai-generate-btn').click()

    await new Promise(resolve => setTimeout(resolve, 10))

    // 此时正在处理
    document.getElementById('ai-modal-close').click()

    const confirmModalInstance = window.BaseModal.mock.results[0].value
    expect(confirmModalInstance.show).toHaveBeenCalled()
  })
})
