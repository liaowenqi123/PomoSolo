/**
 * foregroundInspection.js 测试
 * 覆盖：进程启动、消息处理、命令发送、控制命令、回调设置、停止流程
 *
 * child_process 和 readline 已在 setup.js 中通过 Module._load 拦截替换。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const childProcess = require('child_process')
const foregroundInspection = require('../../src/modules/foregroundInspection')

// 便捷访问
function getLastSpawnedProcess() {
  return childProcess.__lastSpawned
}

function getLastSpawnArgs() {
  return childProcess.__lastSpawnArgs
}

describe('foregroundInspection - start', () => {
  let originalPlatform

  beforeEach(() => {
    vi.clearAllMocks()
    childProcess.__reset()
    // 重置 foregroundInspection 内部状态
    foregroundInspection.process = null
    foregroundInspection.isRunning = false
    foregroundInspection.isDetecting = false
    originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('启动进程 - 设置 isRunning 并 spawn', () => {
    foregroundInspection.start('/path/to/exe.exe')
    expect(getLastSpawnArgs()).toBeDefined()
    expect(getLastSpawnArgs().cmd).toBe('/path/to/exe.exe')
    expect(getLastSpawnArgs().opts.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(foregroundInspection.isRunning).toBe(true)
  })

  it('进程已在运行时不重复启动', () => {
    foregroundInspection.start('/path/to/exe.exe')
    const firstProcess = foregroundInspection.process
    foregroundInspection.start('/path/to/exe.exe')
    expect(foregroundInspection.process).toBe(firstProcess)
  })

  it('使用默认路径当 exePath 为空', () => {
    foregroundInspection.start()
    expect(getLastSpawnArgs().cmd).toContain('foreground_inspection.exe')
  })

  it('进程 close 事件重置状态', () => {
    foregroundInspection.start('/path/to/exe.exe')
    expect(foregroundInspection.isRunning).toBe(true)
    getLastSpawnedProcess().emit('close', 0)
    expect(foregroundInspection.isRunning).toBe(false)
    expect(foregroundInspection.isDetecting).toBe(false)
    expect(foregroundInspection.process).toBe(null)
  })

  it('进程 error 事件调用 onErrorCallback', () => {
    const onError = vi.fn()
    foregroundInspection.onError(onError)
    foregroundInspection.start('/path/to/exe.exe')
    getLastSpawnedProcess().emit('error', new Error('spawn failed'))
    expect(foregroundInspection.isRunning).toBe(false)
    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0][0].message).toContain('启动失败')
  })

  it('stderr data 事件不抛错', () => {
    foregroundInspection.start('/path/to/exe.exe')
    expect(() => {
      getLastSpawnedProcess().stderr.emit('data', Buffer.from('warning'))
    }).not.toThrow()
  })

  it('spawn 抛异常时设置 isRunning 为 false', () => {
    childProcess.spawn.mockImplementationOnce(() => {
      throw new Error('spawn ENOENT')
    })
    foregroundInspection.start('/bad/path.exe')
    expect(foregroundInspection.isRunning).toBe(false)
    expect(foregroundInspection.process).toBe(null)
  })
})

describe('foregroundInspection - handleMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    foregroundInspection.process = { stdin: { writable: true } }
    foregroundInspection.isRunning = true
  })

  it('ready 事件触发 onReadyCallback', () => {
    const cb = vi.fn()
    foregroundInspection.onReady(cb)
    foregroundInspection.handleMessage(JSON.stringify({ event: 'ready', data: { ok: true } }))
    expect(cb).toHaveBeenCalledWith({ ok: true })
  })

  it('api_key_invalid 事件触发回调', () => {
    const cb = vi.fn()
    foregroundInspection.onApiKeyInvalid(cb)
    foregroundInspection.handleMessage(JSON.stringify({ event: 'api_key_invalid', data: { reason: 'expired' } }))
    expect(cb).toHaveBeenCalledWith({ reason: 'expired' })
  })

  it('entertainment_detected 事件触发回调', () => {
    const cb = vi.fn()
    foregroundInspection.onEntertainmentDetected(cb)
    foregroundInspection.handleMessage(JSON.stringify({ event: 'entertainment_detected', data: { app: 'game' } }))
    expect(cb).toHaveBeenCalledWith({ app: 'game' })
  })

  it('status 事件更新 isDetecting 并触发回调', () => {
    const cb = vi.fn()
    foregroundInspection.onStatus(cb)
    foregroundInspection.isDetecting = false
    foregroundInspection.handleMessage(JSON.stringify({ event: 'status', data: { running: true } }))
    expect(foregroundInspection.isDetecting).toBe(true)
    expect(cb).toHaveBeenCalledWith({ running: true })
  })

  it('status 事件无 running 字段时不修改 isDetecting', () => {
    const cb = vi.fn()
    foregroundInspection.onStatus(cb)
    foregroundInspection.isDetecting = true
    foregroundInspection.handleMessage(JSON.stringify({ event: 'status', data: { other: 'info' } }))
    expect(foregroundInspection.isDetecting).toBe(true)
    expect(cb).toHaveBeenCalledWith({ other: 'info' })
  })

  it('error 事件触发 onErrorCallback', () => {
    const cb = vi.fn()
    foregroundInspection.onError(cb)
    foregroundInspection.handleMessage(JSON.stringify({ event: 'error', data: { msg: 'failed' } }))
    expect(cb).toHaveBeenCalledWith({ msg: 'failed' })
  })

  it('未知事件不抛错', () => {
    expect(() => {
      foregroundInspection.handleMessage(JSON.stringify({ event: 'unknown_event', data: {} }))
    }).not.toThrow()
  })

  it('无效 JSON 不抛错', () => {
    expect(() => {
      foregroundInspection.handleMessage('not json')
    }).not.toThrow()
  })
})

describe('foregroundInspection - sendCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('进程未运行时返回 false', () => {
    foregroundInspection.process = null
    const result = foregroundInspection.sendCommand({ command: 'test' })
    expect(result).toBe(false)
  })

  it('stdin 不可写时返回 false', () => {
    foregroundInspection.process = { stdin: { writable: false } }
    const result = foregroundInspection.sendCommand({ command: 'test' })
    expect(result).toBe(false)
  })

  it('写入成功返回 true', () => {
    foregroundInspection.process = { stdin: { writable: true, write: vi.fn() } }
    const result = foregroundInspection.sendCommand({ command: 'test' })
    expect(result).toBe(true)
    expect(foregroundInspection.process.stdin.write).toHaveBeenCalled()
    const written = foregroundInspection.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"test"')
    expect(written.endsWith('\n')).toBe(true)
  })

  it('写入抛异常返回 false', () => {
    foregroundInspection.process = { stdin: { writable: true, write: () => { throw new Error('EPIPE') } } }
    const result = foregroundInspection.sendCommand({ command: 'test' })
    expect(result).toBe(false)
  })
})

describe('foregroundInspection - 控制命令', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    foregroundInspection.process = { stdin: { writable: true, write: vi.fn() } }
    foregroundInspection.isDetecting = false
  })

  it('startDetection 发送 start 命令并设置 isDetecting', () => {
    const result = foregroundInspection.startDetection()
    expect(result).toBe(true)
    expect(foregroundInspection.isDetecting).toBe(true)
    const written = foregroundInspection.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"start"')
  })

  it('startDetection 进程未运行时不修改 isDetecting', () => {
    foregroundInspection.process = null
    const result = foregroundInspection.startDetection()
    expect(result).toBe(false)
    expect(foregroundInspection.isDetecting).toBe(false)
  })

  it('stopDetection 发送 stop 命令并清除 isDetecting', () => {
    foregroundInspection.isDetecting = true
    const result = foregroundInspection.stopDetection()
    expect(result).toBe(true)
    expect(foregroundInspection.isDetecting).toBe(false)
    const written = foregroundInspection.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"stop"')
  })

  it('getStatus 发送 get_status 命令', () => {
    const result = foregroundInspection.getStatus()
    expect(result).toBe(true)
    const written = foregroundInspection.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"get_status"')
  })

  it('addWhitelist 发送 add_whitelist 命令带 keyword', () => {
    const result = foregroundInspection.addWhitelist('notepad')
    expect(result).toBe(true)
    const written = foregroundInspection.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"add_whitelist"')
    expect(written).toContain('"keyword":"notepad"')
  })

  it('addBlacklist 发送 add_blacklist 命令带 keyword', () => {
    const result = foregroundInspection.addBlacklist('game')
    expect(result).toBe(true)
    const written = foregroundInspection.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"add_blacklist"')
    expect(written).toContain('"keyword":"game"')
  })

  it('markHistoryNot 发送 mark_history_not 命令带 window_title', () => {
    const result = foregroundInspection.markHistoryNot('Game Window')
    expect(result).toBe(true)
    const written = foregroundInspection.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"mark_history_not"')
    expect(written).toContain('"window_title":"Game Window"')
  })

  it('moveBlacklistToWhitelist 发送对应命令', () => {
    const result = foregroundInspection.moveBlacklistToWhitelist('game')
    expect(result).toBe(true)
    const written = foregroundInspection.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"move_blacklist_to_whitelist"')
    expect(written).toContain('"keyword":"game"')
  })

  it('setApiKey 进程运行时发送 set_api_key 命令', () => {
    const result = foregroundInspection.setApiKey('my-api-key')
    expect(result).toBe(true)
    const written = foregroundInspection.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"set_api_key"')
    expect(written).toContain('"api_key":"my-api-key"')
  })

  it('setApiKey null 时发送空字符串', () => {
    const result = foregroundInspection.setApiKey(null)
    expect(result).toBe(true)
    const written = foregroundInspection.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"api_key":""')
  })

  it('setApiKey 进程未运行时返回 false', () => {
    foregroundInspection.process = null
    const result = foregroundInspection.setApiKey('key')
    expect(result).toBe(false)
  })
})

describe('foregroundInspection - stop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    foregroundInspection.process = null
    foregroundInspection.isRunning = false
    foregroundInspection.isDetecting = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('进程未运行时 stop 不抛错', () => {
    expect(() => foregroundInspection.stop()).not.toThrow()
  })

  it('stop 发送 exit 命令并在 500ms 后 taskkill', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    
    // 启动一个进程
    foregroundInspection.start('/path/to/exe.exe')
    const proc = foregroundInspection.process
    expect(proc).not.toBe(null)
    
    // stop
    foregroundInspection.stop()
    // 应立即发送 exit 命令
    expect(proc.stdin.write).toHaveBeenCalled()
    const written = proc.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"exit"')
    
    // 500ms 前状态不变
    expect(foregroundInspection.process).not.toBe(null)
    
    // 推进 500ms
    vi.advanceTimersByTime(500)
    
    // 应调用 taskkill
    const { execSync } = require('child_process')
    expect(execSync).toHaveBeenCalled()
    const cmd = execSync.mock.calls[0][0]
    expect(cmd).toContain('taskkill')
    expect(cmd).toContain(String(proc.pid))
    
    expect(foregroundInspection.process).toBe(null)
    expect(foregroundInspection.isRunning).toBe(false)
    
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('stop 在非 Windows 平台使用 SIGKILL', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    
    foregroundInspection.start('/path/to/exe')
    const proc = foregroundInspection.process
    
    foregroundInspection.stop()
    vi.advanceTimersByTime(500)
    
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
    
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('taskkill 失败时回退到 SIGKILL', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    
    const { execSync } = require('child_process')
    execSync.mockImplementationOnce(() => { throw new Error('access denied') })
    
    foregroundInspection.start('/path/to/exe.exe')
    const proc = foregroundInspection.process
    
    foregroundInspection.stop()
    vi.advanceTimersByTime(500)
    
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
    
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('stop 在 500ms 内进程已退出时不报错', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    
    foregroundInspection.start('/path/to/exe.exe')
    const proc = foregroundInspection.process
    
    foregroundInspection.stop()
    // 模拟进程已退出
    foregroundInspection.process = null
    expect(() => vi.advanceTimersByTime(500)).not.toThrow()
    
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })
})

describe('foregroundInspection - 回调设置', () => {
  it('所有回调设置器不抛错', () => {
    expect(() => {
      foregroundInspection.onReady(() => {})
      foregroundInspection.onApiKeyInvalid(() => {})
      foregroundInspection.onEntertainmentDetected(() => {})
      foregroundInspection.onStatus(() => {})
      foregroundInspection.onError(() => {})
    }).not.toThrow()
  })
})
