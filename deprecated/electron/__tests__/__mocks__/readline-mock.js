/**
 * readline mock - 返回 EventEmitter 作为接口
 *
 * 使用方式：
 *   const readline = require('readline')
 *   const rl = readline.createInterface({ input: ... })
 *   rl.on('line', callback)
 */
const mockFn = require('./mock-fn')
const vi = (typeof globalThis !== 'undefined' && globalThis.vi) ? globalThis.vi : { fn: mockFn }
const { EventEmitter } = require('events')

const readlineMock = {
  createInterface: vi.fn(() => new EventEmitter()),
  emitKeypressEvents: vi.fn(),
  clearLine: vi.fn(),
  cursorTo: vi.fn(),
  moveCursor: vi.fn(),
  __reset: () => {
    if (readlineMock.createInterface.mockClear) readlineMock.createInterface.mockClear()
  }
}

module.exports = readlineMock
