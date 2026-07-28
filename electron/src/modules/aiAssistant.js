/**
 * AI规划助手模块 - 主进程
 * 使用 DeepSeek API 处理用户自然语言并生成番茄钟计划
 */

const axios = require('axios')

class AIAssistant {
  constructor() {
    // DeepSeek API配置
    this.apiKey = null // 从数据存储中读取
    this.apiUrl = 'https://api.deepseek.com/v1/chat/completions'
    this.model = 'deepseek-chat'
  }

  /**
   * 处理用户输入，生成番茄钟计划
   * @param {string} userInput - 用户的自然语言输入
   * @returns {Promise<Object>} 返回计划数据
   */
  async generatePlan(userInput) {
    try {
      // 检查API Key
      if (!this.apiKey) {
        return {
          success: false,
          error: '请先配置 API Key'
        }
      }

      const systemPrompt = `你是一个番茄钟规划助手。用户会告诉你他们的工作或学习需求，你需要帮他们规划合理的工作和休息时间。

规则：
1. 工作时间通常为25分钟（标准番茄钟），也可以是15、30、45、60分钟
2. 短休息通常为5分钟，长休息为10-15分钟
3. 每完成4个工作番茄钟后，建议安排一次长休息
4. 根据任务难度和时长合理安排

请以JSON格式返回计划，格式如下：
{
  "plan": [
    {"type": "work", "minutes": 25, "description": "任务描述"},
    {"type": "break", "minutes": 5, "description": "短休息"}
  ],
  "summary": "计划总结说明"
}

只返回JSON，不要其他文字。`

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userInput }
          ],
          temperature: 0.7,
          max_tokens: 1000
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: 30000
        }
      )

      const content = response.data.choices[0].message.content
      const result = this.parseAIResponse(content)
      
      return {
        success: true,
        data: result
      }
    } catch (error) {
      console.error('AI助手错误:', error)
      return {
        success: false,
        error: error.message || '生成计划失败，请重试'
      }
    }
  }

  /**
   * 解析AI返回的JSON响应
   */
  parseAIResponse(content) {
    try {
      // 先尝试直接解析
      try {
        return JSON.parse(content)
      } catch (e) {
        // 如果直接解析失败，尝试提取JSON
      }
      
      // 尝试提取JSON（可能包含在markdown代码块中）
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                       content.match(/```\s*([\s\S]*?)\s*```/) ||
                       content.match(/\{[\s\S]*\}/)
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0]
        return JSON.parse(jsonStr.trim())
      }
      
      throw new Error('无法解析AI响应')
    } catch (error) {
      console.error('解析AI响应失败:', error)
      console.error('原始内容:', content)
      throw new Error('AI响应格式错误')
    }
  }

  /**
   * 设置API密钥
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey
  }
}

module.exports = new AIAssistant()
