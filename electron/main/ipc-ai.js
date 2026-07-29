/**
 * AI 助手 IPC
 */
const aiAssistant = require('../src/modules/aiAssistant')

function register(ipcMain) {
  ipcMain.handle('ai-generate-plan', async (event, userInput) => {
    return await aiAssistant.generatePlan(userInput)
  })
}

module.exports = { register }
