/**
 * 本地 mock 函数实现
 *
 * 与 vi.fn() 接口兼容，用于 CommonJS mock 文件中 vi 不可用时作为回退。
 * 支持：mockReturnValue / mockReturnValueOnce / mockResolvedValue /
 *      mockResolvedValueOnce / mockRejectedValue / mockRejectedValueOnce /
 *      mockImplementation / mockImplementationOnce / mockReset / mockClear /
 *      mockRestore / mockName / getMockName
 */
function mockFn(impl) {
  const fn = function (...args) {
    fn.mock.calls.push(args)
    fn.mock.instances.push(this)
    if (typeof fn._nextImpls === 'function' && fn._nextImpls.length > 0) {
      const nextImpl = fn._nextImpls.shift()
      const value = nextImpl.apply(this, args)
      fn.mock.results.push({ type: 'return', value })
      return value
    }
    if (typeof fn._impl === 'function') {
      const value = fn._impl.apply(this, args)
      fn.mock.results.push({ type: 'return', value })
      return value
    }
    fn.mock.results.push({ type: 'return', value: undefined })
    return undefined
  }

  fn._impl = typeof impl === 'function' ? impl : null
  fn._nextImpls = []
  fn.mock = {
    calls: [],
    results: [],
    instances: []
  }

  fn.mockReturnValue = function (v) {
    fn._impl = () => v
    return fn
  }
  fn.mockReturnValueOnce = function (v) {
    fn._nextImpls.push(() => v)
    return fn
  }
  fn.mockResolvedValue = function (v) {
    fn._impl = () => Promise.resolve(v)
    return fn
  }
  fn.mockResolvedValueOnce = function (v) {
    fn._nextImpls.push(() => Promise.resolve(v))
    return fn
  }
  fn.mockRejectedValue = function (e) {
    fn._impl = () => Promise.reject(e)
    return fn
  }
  fn.mockRejectedValueOnce = function (e) {
    fn._nextImpls.push(() => Promise.reject(e))
    return fn
  }
  fn.mockImplementation = function (impl) {
    fn._impl = impl
    return fn
  }
  fn.mockImplementationOnce = function (impl) {
    fn._nextImpls.push(impl)
    return fn
  }
  fn.mockReset = function () {
    fn.mock.calls = []
    fn.mock.results = []
    fn.mock.instances = []
    fn._impl = null
    fn._nextImpls = []
    return fn
  }
  fn.mockClear = function () {
    fn.mock.calls = []
    fn.mock.results = []
    fn.mock.instances = []
    return fn
  }
  fn.mockRestore = function () {
    return fn.mockReset()
  }
  fn.getMockName = function () {
    return fn._name || 'vi.fn'
  }
  fn.mockName = function (n) {
    fn._name = n
    return fn
  }

  return fn
}

module.exports = mockFn
