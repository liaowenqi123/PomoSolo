/**
 * main/ipc-data.js 测试
 *
 * 测试 read-data/write-data/read-settings/write-settings 处理器
 * 是否正确注册并委托给 dataManager。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

// Mock dataManager
const mockDataManager = vi.hoisted(() => {
  const m = {
    readData: vi.fn(),
    writeData: vi.fn(),
    readSettings: vi.fn(),
    writeSettings: vi.fn()
  }
  if (global.__registerRequireMock) global.__registerRequireMock('src/modules/dataManager', m)
  return m
})
vi.mock('../../src/modules/dataManager', () => mockDataManager)

const ipcMain = __electronMock.ipcMain
const { register } = require('../../main/ipc-data')

// 辅助：查找 ipcMain.handle 注册的处理器
function findHandler(channel) {
  const call = ipcMain.handle.mock.calls.find(c => c[0] === channel)
  return call ? call[1] : undefined
}

describe('main/ipc-data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    register(ipcMain)
  })

  it('应注册 4 个 handle 处理器', () => {
    expect(ipcMain.handle).toHaveBeenCalledTimes(4)
    const channels = ipcMain.handle.mock.calls.map(c => c[0])
    expect(channels).toContain('read-data')
    expect(channels).toContain('write-data')
    expect(channels).toContain('read-settings')
    expect(channels).toContain('write-settings')
  })

  describe('read-data', () => {
    it('应调用 dataManager.readData 并返回结果', async () => {
      const mockData = { stats: { totalFocusTime: 100 }, presets: [] }
      mockDataManager.readData.mockReturnValue(mockData)

      const handler = findHandler('read-data')
      const result = await handler({})

      expect(mockDataManager.readData).toHaveBeenCalledTimes(1)
      expect(result).toBe(mockData)
    })

    it('dataManager 抛出异常时应传播', () => {
      mockDataManager.readData.mockImplementation(() => {
        throw new Error('read error')
      })

      const handler = findHandler('read-data')
      expect(() => handler({})).toThrow('read error')
    })
  })

  describe('write-data', () => {
    it('应调用 dataManager.writeData 并传入数据', async () => {
      mockDataManager.writeData.mockReturnValue(true)
      const data = { stats: { totalFocusTime: 200 } }

      const handler = findHandler('write-data')
      const result = await handler({}, data)

      expect(mockDataManager.writeData).toHaveBeenCalledWith(data)
      expect(result).toBe(true)
    })

    it('dataManager 抛出异常时应传播', () => {
      mockDataManager.writeData.mockImplementation(() => {
        throw new Error('write error')
      })

      const handler = findHandler('write-data')
      expect(() => handler({}, {})).toThrow('write error')
    })
  })

  describe('read-settings', () => {
    it('应调用 dataManager.readSettings 并返回结果', async () => {
      const mockSettings = { theme: 'dark', alwaysOnTop: true }
      mockDataManager.readSettings.mockReturnValue(mockSettings)

      const handler = findHandler('read-settings')
      const result = await handler({})

      expect(mockDataManager.readSettings).toHaveBeenCalledTimes(1)
      expect(result).toBe(mockSettings)
    })
  })

  describe('write-settings', () => {
    it('应调用 dataManager.writeSettings 并传入设置', async () => {
      mockDataManager.writeSettings.mockReturnValue(true)
      const settings = { theme: 'light' }

      const handler = findHandler('write-settings')
      const result = await handler({}, settings)

      expect(mockDataManager.writeSettings).toHaveBeenCalledWith(settings)
      expect(result).toBe(true)
    })
  })
})
