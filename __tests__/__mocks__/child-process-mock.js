/**
 * child_process mock - 拦截 spawn / exec / execSync / fork
 *
 * 使用方式：
 *   const { spawn } = require('child_process')
 *   spawn.mockImplementation((cmd, args, opts) => {...})
 *
 * 测试可通过 childProcess.__lastSpawned 访问最近一次 spawn 返回的进程
 */
const mockFn = require('./mock-fn')
const vi = (typeof globalThis !== 'undefined' && globalThis.vi) ? globalThis.vi : { fn: mockFn }
const { EventEmitter } = require('events')

function createFakeProcess() {
  const proc = new EventEmitter()
  proc.pid = 4321
  // stdout/stderr 需要支持 setEncoding（源码中 `stdout.setEncoding('utf8')`）
  // 同时需要返回流自身以支持链式调用
  proc.stdout = new EventEmitter()
  proc.stdout.setEncoding = vi.fn(function () { return proc.stdout })
  proc.stderr = new EventEmitter()
  proc.stderr.setEncoding = vi.fn(function () { return proc.stderr })
  proc.stdin = {
    write: vi.fn(() => true),
    end: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    destroy: vi.fn(),
    writable: true
  }
  proc.kill = vi.fn()
  proc.send = vi.fn()
  proc.disconnect = vi.fn()
  proc.unref = vi.fn()
  proc.ref = vi.fn()
  return proc
}

const childProcessMock = {
  spawn: vi.fn((cmd, args, opts) => {
    const proc = createFakeProcess()
    childProcessMock.__lastSpawned = proc
    childProcessMock.__lastSpawnArgs = { cmd, args, opts }
    return proc
  }),
  exec: vi.fn((cmd, opts, cb) => {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    const proc = createFakeProcess()
    childProcessMock.__lastExec = proc
    childProcessMock.__lastExecArgs = { cmd, opts, cb }
    if (cb) {
      setTimeout(() => cb(null, '', ''), 0)
    }
    return proc
  }),
  execSync: vi.fn(() => Buffer.from('')),
  execFile: vi.fn((file, args, opts, cb) => {
    if (typeof args === 'function') {
      cb = args
      args = []
      opts = {}
    } else if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    const proc = createFakeProcess()
    if (cb) {
      setTimeout(() => cb(null, '', ''), 0)
    }
    return proc
  }),
  fork: vi.fn((modulePath, args, opts) => {
    const proc = createFakeProcess()
    childProcessMock.__lastForked = proc
    return proc
  }),
  spawnSync: vi.fn(() => ({
    pid: 1234,
    output: [],
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    status: 0,
    error: undefined
  })),
  __lastSpawned: null,
  __lastSpawnArgs: null,
  __lastExec: null,
  __lastExecArgs: null,
  __lastForked: null,
  __createFakeProcess: createFakeProcess,
  __reset: () => {
    childProcessMock.__lastSpawned = null
    childProcessMock.__lastSpawnArgs = null
    childProcessMock.__lastExec = null
    childProcessMock.__lastExecArgs = null
    childProcessMock.__lastForked = null
    if (childProcessMock.spawn.mockClear) childProcessMock.spawn.mockClear()
    if (childProcessMock.exec.mockClear) childProcessMock.exec.mockClear()
    if (childProcessMock.execSync.mockClear) childProcessMock.execSync.mockClear()
  }
}

module.exports = childProcessMock
