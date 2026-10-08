/**
 * main/ipc-ai.js 测试
 *
 * 测试 ai-generate-plan 处理器委托给 aiAssistant.generatePlan。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

// Mock aiAssistant
const mockAiAssistant = vi.hoisted(() => {
  const m = { generatePlan: vi.fn() }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/aiAssistant', m)
  return m
})
vi.mock('../../src/modules/aiAssistant', () => mockAiAssistant)

const ipcMain = __electronMock.ipcMain
const { register } = require('../../main/ipc-ai')

function findHandler(channel) {
  const call = ipcMain.handle.mock.calls.find(c => c[0] === channel)
  return call ? call[1] : undefined
}

describe('main/ipc-ai', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    register(ipcMain)
  })

  it('应注册 ai-generate-plan 处理器', () => {
    expect(ipcMain.handle).toHaveBeenCalledTimes(1)
    expect(ipcMain.handle.mock.calls[0][0]).toBe('ai-generate-plan')
  })

  it('应调用 aiAssistant.generatePlan 并返回结果', async () => {
    const mockPlan = { tasks: [{ name: 'task1', duration: 25 }] }
    mockAiAssistant.generatePlan.mockResolvedValue(mockPlan)

    const handler = findHandler('ai-generate-plan')
    const userInput = '帮我制定一个学习计划'
    const result = await handler({}, userInput)

    expect(mockAiAssistant.generatePlan).toHaveBeenCalledWith(userInput)
    expect(result).toBe(mockPlan)
  })

  it('aiAssistant.generatePlan 抛出异常时应传播', async () => {
    mockAiAssistant.generatePlan.mockRejectedValue(new Error('AI error'))

    const handler = findHandler('ai-generate-plan')
    await expect(handler({}, 'test')).rejects.toThrow('AI error')
  })

  it('应正确传递复杂用户输入', async () => {
    mockAiAssistant.generatePlan.mockResolvedValue({ ok: true })
    const handler = findHandler('ai-generate-plan')
    const complexInput = { topic: '数学', duration: 120, breaks: true }
    await handler({}, complexInput)
    expect(mockAiAssistant.generatePlan).toHaveBeenCalledWith(complexInput)
  })
})
