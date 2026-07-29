/**
 * aiAssistant.js 测试
 * 覆盖：generatePlan、parseAIResponse、setApiKey
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const axios = require('axios')
const aiAssistant = require('../../src/modules/aiAssistant')

describe('aiAssistant - setApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiAssistant.setApiKey(null)
  })

  it('设置 API Key', () => {
    aiAssistant.setApiKey('my-key')
    // 内部状态被设置（通过 generatePlan 验证）
    expect(aiAssistant.apiKey).toBe('my-key')
  })

  it('清除 API Key', () => {
    aiAssistant.setApiKey('my-key')
    aiAssistant.setApiKey(null)
    expect(aiAssistant.apiKey).toBe(null)
  })
})

describe('aiAssistant - generatePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiAssistant.setApiKey(null)
  })

  it('无 API Key 时返回错误', async () => {
    const result = await aiAssistant.generatePlan('帮我规划学习时间')
    expect(result.success).toBe(false)
    expect(result.error).toContain('API Key')
  })

  it('成功生成计划 - 直接 JSON 响应', async () => {
    aiAssistant.setApiKey('my-key')
    const plan = {
      plan: [{ type: 'work', minutes: 25, description: 'task1' }],
      summary: 'plan summary'
    }
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: JSON.stringify(plan) } }]
      }
    })
    const result = await aiAssistant.generatePlan('学习')
    expect(result.success).toBe(true)
    expect(result.data.plan).toBeDefined()
    expect(result.data.summary).toBe('plan summary')
  })

  it('成功生成计划 - markdown 包裹的 JSON', async () => {
    aiAssistant.setApiKey('my-key')
    const plan = { plan: [], summary: 'md wrapped' }
    const content = '```json\n' + JSON.stringify(plan) + '\n```'
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { content } }]
      }
    })
    const result = await aiAssistant.generatePlan('test')
    expect(result.success).toBe(true)
    expect(result.data.summary).toBe('md wrapped')
  })

  it('API 调用失败时返回错误', async () => {
    aiAssistant.setApiKey('my-key')
    axios.post.mockRejectedValueOnce(new Error('Network error'))
    const result = await aiAssistant.generatePlan('test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Network error')
  })

  it('API 返回无法解析的内容时返回错误', async () => {
    aiAssistant.setApiKey('my-key')
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: 'totally not json' } }]
      }
    })
    const result = await aiAssistant.generatePlan('test')
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('验证 axios.post 调用参数', async () => {
    aiAssistant.setApiKey('my-key-123')
    const plan = { plan: [], summary: 'x' }
    axios.post.mockResolvedValueOnce({
      data: { choices: [{ message: { content: JSON.stringify(plan) } }] }
    })
    await aiAssistant.generatePlan('my input')
    expect(axios.post).toHaveBeenCalled()
    const args = axios.post.mock.calls[0]
    expect(args[0]).toContain('deepseek.com')
    const body = args[1]
    expect(body.model).toBe('deepseek-chat')
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toBe('my input')
    const config = args[2]
    expect(config.headers.Authorization).toBe('Bearer my-key-123')
    expect(config.headers['Content-Type']).toBe('application/json')
  })
})

describe('aiAssistant - parseAIResponse', () => {
  it('直接解析 JSON', () => {
    const obj = { plan: [], summary: 'x' }
    const result = aiAssistant.parseAIResponse(JSON.stringify(obj))
    expect(result.plan).toEqual([])
    expect(result.summary).toBe('x')
  })

  it('解析 ```json 代码块', () => {
    const obj = { plan: [{ type: 'work' }], summary: 'block' }
    const content = '```json\n' + JSON.stringify(obj) + '\n```'
    const result = aiAssistant.parseAIResponse(content)
    expect(result.summary).toBe('block')
  })

  it('解析普通 ``` 代码块', () => {
    const obj = { plan: [], summary: 'plain block' }
    const content = '```\n' + JSON.stringify(obj) + '\n```'
    const result = aiAssistant.parseAIResponse(content)
    expect(result.summary).toBe('plain block')
  })

  it('解析裸 JSON（前缀文字）', () => {
    const obj = { plan: [], summary: 'bare' }
    // 直接 JSON.parse 失败后，回退到 /\{[\s\S]*\}/ 匹配
    const content = 'Here is the plan:\n' + JSON.stringify(obj)
    // 注意：先尝试直接解析，"Here is the plan:\n{...}" 不是有效 JSON，会进入 fallback
    const result = aiAssistant.parseAIResponse(content)
    expect(result.summary).toBe('bare')
  })

  it('无效内容抛出错误', () => {
    expect(() => aiAssistant.parseAIResponse('totally not json at all')).toThrow()
  })
})
