/**
 * https/http mock - 拦截 request 方法
 *
 * 使用方式：
 *   const https = require('https')
 *   https.request.mockImplementation((opts, cb) => {...})
 *
 * 测试可通过 https.__lastRequest / https.__requestHandler 访问最近一次请求
 */
const mockFn = require('./mock-fn')
const vi = (typeof globalThis !== 'undefined' && globalThis.vi) ? globalThis.vi : { fn: mockFn }
const { EventEmitter } = require('events')

function createFakeRequest() {
  const req = new EventEmitter()
  req.end = vi.fn()
  req.destroy = vi.fn()
  req.abort = vi.fn()
  req.setTimeout = vi.fn()
  req.on = vi.fn((event, handler) => {
    EventEmitter.prototype.on.call(req, event, handler)
    return req
  })
  return req
}

function createFakeResponse(statusCode, body, headers = {}) {
  const res = new EventEmitter()
  res.statusCode = statusCode
  res.headers = headers
  res.setEncoding = vi.fn()
  setTimeout(() => {
    if (body) res.emit('data', body)
    res.emit('end')
  }, 0)
  return res
}

const httpsMock = {
  request: vi.fn((opts, cb) => {
    const req = createFakeRequest()
    httpsMock.__lastRequest = req
    httpsMock.__requestHandler = cb
    return req
  }),
  get: vi.fn((url, opts, cb) => {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    return httpsMock.request(url, cb)
  }),
  Agent: vi.fn(),
  globalAgent: { addContext: vi.fn() },
  Server: vi.fn(),
  createServer: vi.fn(),
  __lastRequest: null,
  __requestHandler: null,
  __createFakeResponse: createFakeResponse,
  __createFakeRequest: createFakeRequest,
  __reset: () => {
    httpsMock.__lastRequest = null
    httpsMock.__requestHandler = null
    httpsMock.request.mockClear && httpsMock.request.mockClear()
  }
}

module.exports = httpsMock
