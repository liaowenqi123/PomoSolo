/**
 * musicProcess.js 测试
 * 覆盖：进程启动/停止、消息分发、命令发送、控制命令、
 * 异步操作（deleteSong/updateTag/getCustomTags 等）、回调设置
 *
 * child_process 和 readline 已在 setup.js 中通过 Module._load 拦截替换。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const childProcess = require('child_process')
const musicProcess = require('../../src/modules/musicProcess')

// 便捷访问
function getLastSpawnedProcess() {
  return childProcess.__lastSpawned
}

describe('musicProcess - start', () => {
  let originalPlatform

  beforeEach(() => {
    vi.clearAllMocks()
    childProcess.__reset()
    musicProcess.process = null
    musicProcess.isRunning = false
    originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('启动进程并设置 isRunning', () => {
    musicProcess.start('/path/to/music.exe')
    expect(musicProcess.isRunning).toBe(true)
    expect(musicProcess.process).not.toBe(null)
  })

  it('进程已在运行时不重复启动', () => {
    musicProcess.start('/path/to/music.exe')
    const firstProc = musicProcess.process
    musicProcess.start('/path/to/music.exe')
    expect(musicProcess.process).toBe(firstProc)
  })

  it('传入 deviceId 时作为参数', () => {
    musicProcess.start('/path/to/music.exe', 42)
    expect(childProcess.spawn).toHaveBeenCalled()
    const args = childProcess.spawn.mock.calls[0][1]
    expect(args).toEqual(['42'])
  })

  it('deviceId 为 null 时不传参数', () => {
    musicProcess.start('/path/to/music.exe', null)
    const args = childProcess.spawn.mock.calls[0][1]
    expect(args).toEqual([])
  })

  it('未传 exePath 时使用默认路径', () => {
    musicProcess.start()
    const cmd = childProcess.spawn.mock.calls[0][0]
    expect(cmd).toContain('music.exe')
  })

  it('进程 close 事件重置状态', () => {
    musicProcess.start('/path/to/music.exe')
    getLastSpawnedProcess().emit('close', 0)
    expect(musicProcess.isRunning).toBe(false)
    expect(musicProcess.process).toBe(null)
  })

  it('进程 error 事件重置状态', () => {
    musicProcess.start('/path/to/music.exe')
    getLastSpawnedProcess().emit('error', new Error('failed'))
    expect(musicProcess.isRunning).toBe(false)
    expect(musicProcess.process).toBe(null)
  })

  it('stderr data 事件不抛错', () => {
    musicProcess.start('/path/to/music.exe')
    expect(() => {
      getLastSpawnedProcess().stderr.emit('data', Buffer.from('warn'))
    }).not.toThrow()
  })

  it('spawn 抛异常时设置 isRunning 为 false', () => {
    childProcess.spawn.mockImplementationOnce(() => { throw new Error('ENOENT') })
    musicProcess.start('/bad/path.exe')
    expect(musicProcess.isRunning).toBe(false)
    expect(musicProcess.process).toBe(null)
  })
})

describe('musicProcess - handleMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ready 事件触发 onReadyCallback', () => {
    const cb = vi.fn()
    musicProcess.onReady(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'ready', data: { v: 1 } }))
    expect(cb).toHaveBeenCalledWith({ v: 1 })
  })

  it('status 事件触发 onStatusCallback', () => {
    const cb = vi.fn()
    musicProcess.onStatus(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'status', data: { playing: true } }))
    expect(cb).toHaveBeenCalledWith({ playing: true })
  })

  it('track_change 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onTrackChange(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'track_change', data: { name: 's' } }))
    expect(cb).toHaveBeenCalledWith({ name: 's' })
  })

  it('play_state 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onPlayState(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'play_state', data: { playing: true } }))
    expect(cb).toHaveBeenCalledWith({ playing: true })
  })

  it('progress 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onProgress(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'progress', data: { pos: 30 } }))
    expect(cb).toHaveBeenCalledWith({ pos: 30 })
  })

  it('devices 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onDevices(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'devices', data: [{ id: 1 }] }))
    expect(cb).toHaveBeenCalledWith([{ id: 1 }])
  })

  it('no_music 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onNoMusic(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'no_music', data: {} }))
    expect(cb).toHaveBeenCalledWith({})
  })

  it('play_error 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onPlayError(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'play_error', data: { msg: 'x' } }))
    expect(cb).toHaveBeenCalledWith({ msg: 'x' })
  })

  it('volume_change 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onVolumeChange(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'volume_change', data: { volume: 0.5 } }))
    expect(cb).toHaveBeenCalledWith({ volume: 0.5 })
  })

  it('play_mode 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onPlayMode(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'play_mode', data: { mode: 'shuffle' } }))
    expect(cb).toHaveBeenCalledWith({ mode: 'shuffle' })
  })

  it('playlist 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onPlaylist(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'playlist', data: [{ name: 's' }] }))
    expect(cb).toHaveBeenCalledWith([{ name: 's' }])
  })

  it('song_missing 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onSongMissing(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'song_missing', data: { name: 'x' } }))
    expect(cb).toHaveBeenCalledWith({ name: 'x' })
  })

  it('hotkeys 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onHotkeys(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'hotkeys', data: { hotkeys: {} } }))
    expect(cb).toHaveBeenCalledWith({ hotkeys: {} })
  })

  it('hotkeys_updated 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onHotkeysUpdated(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'hotkeys_updated', data: { hotkeys: {} } }))
    expect(cb).toHaveBeenCalledWith({ hotkeys: {} })
  })

  it('hotkey_recording_started 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onHotkeyRecordingStarted(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'hotkey_recording_started', data: {} }))
    expect(cb).toHaveBeenCalledWith({})
  })

  it('hotkey_recording_stopped 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onHotkeyRecordingStopped(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'hotkey_recording_stopped', data: { keys: ['a'] } }))
    expect(cb).toHaveBeenCalledWith({ keys: ['a'] })
  })

  it('hotkey_key_pressed 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onHotkeyKeyPressed(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'hotkey_key_pressed', data: { key: 'a' } }))
    expect(cb).toHaveBeenCalledWith({ key: 'a' })
  })

  it('recording_keys 事件触发回调', () => {
    const cb = vi.fn()
    musicProcess.onRecordingKeys(cb)
    musicProcess.handleMessage(JSON.stringify({ event: 'recording_keys', data: { keys: [] } }))
    expect(cb).toHaveBeenCalledWith({ keys: [] })
  })

  it('未知事件不抛错', () => {
    expect(() => {
      musicProcess.handleMessage(JSON.stringify({ event: 'unknown', data: {} }))
    }).not.toThrow()
  })

  it('无效 JSON 不抛错', () => {
    expect(() => {
      musicProcess.handleMessage('bad json')
    }).not.toThrow()
  })
})

describe('musicProcess - sendCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('进程未运行时返回 false 并触发 playError 回调', () => {
    const onPlayErr = vi.fn()
    musicProcess.onPlayError(onPlayErr)
    musicProcess.process = null
    const result = musicProcess.sendCommand({ command: 'test' })
    expect(result).toBe(false)
    expect(onPlayErr).toHaveBeenCalledWith({ message: expect.stringContaining('未运行') })
  })

  it('stdin 不可写时返回 false', () => {
    musicProcess.process = { stdin: { writable: false } }
    const onPlayErr = vi.fn()
    musicProcess.onPlayError(onPlayErr)
    const result = musicProcess.sendCommand({ command: 'test' })
    expect(result).toBe(false)
    expect(onPlayErr).toHaveBeenCalled()
  })

  it('写入成功返回 true', () => {
    musicProcess.process = { stdin: { writable: true, write: vi.fn() } }
    const result = musicProcess.sendCommand({ command: 'test' })
    expect(result).toBe(true)
    expect(musicProcess.process.stdin.write).toHaveBeenCalled()
  })

  it('写入抛异常返回 false', () => {
    musicProcess.process = { stdin: { writable: true, write: () => { throw new Error('EPIPE') } } }
    const result = musicProcess.sendCommand({ command: 'test' })
    expect(result).toBe(false)
  })
})

describe('musicProcess - 控制命令', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    musicProcess.process = { stdin: { writable: true, write: vi.fn() } }
  })

  it('togglePlay 发送 toggle 命令', () => {
    musicProcess.togglePlay()
    const written = musicProcess.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"toggle"')
  })

  it('next 发送 next 命令', () => {
    musicProcess.next()
    const written = musicProcess.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"next"')
  })

  it('prev 发送 prev 命令', () => {
    musicProcess.prev()
    const written = musicProcess.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"prev"')
  })

  it('seek 发送 seek 命令带 position', () => {
    musicProcess.seek(120)
    const written = musicProcess.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"seek"')
    expect(written).toContain('"position":120')
  })

  it('setVolume 发送 set_volume 命令带 volume', () => {
    musicProcess.setVolume(0.7)
    const written = musicProcess.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"set_volume"')
    expect(written).toContain('"volume":0.7')
  })

  it('getStatus 发送 get_status 命令', () => {
    musicProcess.getStatus()
    const written = musicProcess.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"get_status"')
  })

  it('getDevices 发送 get_devices 命令', () => {
    musicProcess.getDevices()
    const written = musicProcess.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"get_devices"')
  })

  it('setDevice 发送 set_device 命令带 device_id', () => {
    musicProcess.setDevice(5)
    const written = musicProcess.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"set_device"')
    expect(written).toContain('"device_id":5')
  })

  it('setPlayMode 发送 set_play_mode 命令带 mode', () => {
    musicProcess.setPlayMode('shuffle')
    const written = musicProcess.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"set_play_mode"')
    expect(written).toContain('"mode":"shuffle"')
  })

  it('getPlaylist 发送 get_playlist 命令', () => {
    musicProcess.getPlaylist()
    const written = musicProcess.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"get_playlist"')
  })

  it('playSong 发送 play_song 命令带 name', () => {
    musicProcess.playSong('song.mp3')
    const written = musicProcess.process.stdin.write.mock.calls[0][0]
    expect(written).toContain('"command":"play_song"')
    expect(written).toContain('"name":"song.mp3"')
  })
})

describe('musicProcess - 异步操作', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    musicProcess.process = { stdin: { writable: true, write: vi.fn() } }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deleteSong - 成功路径', async () => {
    const promise = musicProcess.deleteSong('song.mp3')
    // 触发 status 回调 with delete_result=success
    musicProcess.onStatusCallback({ delete_result: 'success' })
    const result = await promise
    expect(result.success).toBe(true)
  })

  it('deleteSong - 失败路径', async () => {
    const promise = musicProcess.deleteSong('song.mp3')
    musicProcess.onStatusCallback({ delete_result: 'error', delete_error: 'file locked' })
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.error).toContain('file locked')
  })

  it('deleteSong - 超时返回失败', async () => {
    const promise = musicProcess.deleteSong('song.mp3')
    vi.advanceTimersByTime(6000)
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.error).toContain('超时')
  })

  it('deleteSong - 其他 status 消息转发给原回调', async () => {
    const originalCb = vi.fn()
    musicProcess.onStatus(originalCb)
    const promise = musicProcess.deleteSong('song.mp3')
    musicProcess.onStatusCallback({ other: 'info' })
    expect(originalCb).toHaveBeenCalledWith({ other: 'info' })
    musicProcess.onStatusCallback({ delete_result: 'success' })
    await promise
  })

  it('updateTag - 成功路径', async () => {
    const promise = musicProcess.updateTag('song.mp3', 'pop', 'red')
    musicProcess.onTagUpdatedCallback({ success: true })
    const result = await promise
    expect(result.success).toBe(true)
  })

  it('updateTag - 失败路径', async () => {
    const promise = musicProcess.updateTag('song.mp3', 'pop', 'red')
    musicProcess.onTagUpdatedCallback({ success: false, error: 'tag exists' })
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.error).toBe('tag exists')
  })

  it('updateTag - 超时', async () => {
    const promise = musicProcess.updateTag('s', 't', 'c')
    vi.advanceTimersByTime(6000)
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.error).toContain('超时')
  })

  it('getCustomTags - 成功', async () => {
    const promise = musicProcess.getCustomTags()
    musicProcess.onCustomTagsCallback({ customTags: { tag1: { color: 'red' } } })
    const result = await promise
    expect(result.customTags.tag1).toBeDefined()
  })

  it('getCustomTags - 超时返回空对象', async () => {
    const promise = musicProcess.getCustomTags()
    vi.advanceTimersByTime(6000)
    const result = await promise
    expect(result.customTags).toEqual({})
  })

  it('addCustomTag - 成功', async () => {
    const promise = musicProcess.addCustomTag('newtag', 'blue')
    musicProcess.onCustomTagAddedCallback({ success: true })
    const result = await promise
    expect(result.success).toBe(true)
  })

  it('addCustomTag - 失败', async () => {
    const promise = musicProcess.addCustomTag('newtag', 'blue')
    musicProcess.onCustomTagAddedCallback({ success: false, error: 'dup' })
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.error).toBe('dup')
  })

  it('addCustomTag - 超时', async () => {
    const promise = musicProcess.addCustomTag('t', 'c')
    vi.advanceTimersByTime(6000)
    const result = await promise
    expect(result.success).toBe(false)
  })

  it('deleteCustomTag - 成功', async () => {
    const promise = musicProcess.deleteCustomTag('tag')
    musicProcess.onCustomTagDeletedCallback({ success: true })
    const result = await promise
    expect(result.success).toBe(true)
  })

  it('deleteCustomTag - 失败', async () => {
    const promise = musicProcess.deleteCustomTag('tag')
    musicProcess.onCustomTagDeletedCallback({ success: false, error: 'not found' })
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.error).toBe('not found')
  })

  it('deleteCustomTag - 超时', async () => {
    const promise = musicProcess.deleteCustomTag('tag')
    vi.advanceTimersByTime(6000)
    const result = await promise
    expect(result.success).toBe(false)
  })

  it('getHotkeys - 成功', async () => {
    const promise = musicProcess.getHotkeys()
    musicProcess.onHotkeysCallback({ hotkeys: { pause: ['ctrl'] } })
    const result = await promise
    expect(result.hotkeys.pause).toEqual(['ctrl'])
  })

  it('getHotkeys - 超时返回 null', async () => {
    const promise = musicProcess.getHotkeys()
    vi.advanceTimersByTime(6000)
    const result = await promise
    expect(result.hotkeys).toBe(null)
  })

  it('setHotkeys - 成功', async () => {
    const promise = musicProcess.setHotkeys({ pause: ['ctrl'] })
    musicProcess.onHotkeysUpdatedCallback({ hotkeys: { pause: ['ctrl'] } })
    const result = await promise
    expect(result.success).toBe(true)
    expect(result.hotkeys.pause).toEqual(['ctrl'])
  })

  it('setHotkeys - 超时', async () => {
    const promise = musicProcess.setHotkeys({})
    vi.advanceTimersByTime(6000)
    const result = await promise
    expect(result.success).toBe(false)
  })

  it('startHotkeyRecording - 成功', async () => {
    const promise = musicProcess.startHotkeyRecording()
    musicProcess.onHotkeyRecordingStartedCallback({})
    const result = await promise
    expect(result.success).toBe(true)
  })

  it('startHotkeyRecording - 超时', async () => {
    const promise = musicProcess.startHotkeyRecording()
    vi.advanceTimersByTime(6000)
    const result = await promise
    expect(result.success).toBe(false)
  })

  it('stopHotkeyRecording - 成功', async () => {
    const promise = musicProcess.stopHotkeyRecording()
    musicProcess.onHotkeyRecordingStoppedCallback({ keys: ['Key.ctrl_r'] })
    const result = await promise
    expect(result.keys).toEqual(['Key.ctrl_r'])
  })

  it('stopHotkeyRecording - 超时返回空数组', async () => {
    const promise = musicProcess.stopHotkeyRecording()
    vi.advanceTimersByTime(6000)
    const result = await promise
    expect(result.keys).toEqual([])
  })

  it('getRecordingKeys - 成功', async () => {
    const promise = musicProcess.getRecordingKeys()
    musicProcess.onRecordingKeysCallback({ keys: ['a', 'b'] })
    const result = await promise
    expect(result.keys).toEqual(['a', 'b'])
  })

  it('getRecordingKeys - 超时返回空数组', async () => {
    const promise = musicProcess.getRecordingKeys()
    vi.advanceTimersByTime(6000)
    const result = await promise
    expect(result.keys).toEqual([])
  })
})

describe('musicProcess - stop', () => {
  let originalPlatform

  beforeEach(() => {
    vi.clearAllMocks()
    musicProcess.process = null
    musicProcess.isRunning = false
    originalPlatform = process.platform
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('进程未运行时 stop 不抛错', () => {
    expect(() => musicProcess.stop()).not.toThrow()
  })

  it('stop 在 Windows 使用 taskkill', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    musicProcess.start('/path/to/music.exe')
    const proc = musicProcess.process
    musicProcess.stop()
    const { execSync } = require('child_process')
    expect(execSync).toHaveBeenCalled()
    const cmd = execSync.mock.calls[0][0]
    expect(cmd).toContain('taskkill')
    expect(cmd).toContain(String(proc.pid))
    expect(musicProcess.process).toBe(null)
    expect(musicProcess.isRunning).toBe(false)
  })

  it('stop 在非 Windows 使用 SIGKILL', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    musicProcess.start('/path/to/music')
    const proc = musicProcess.process
    musicProcess.stop()
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('taskkill 失败时回退到 SIGKILL', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const { execSync } = require('child_process')
    execSync.mockImplementationOnce(() => { throw new Error('denied') })
    musicProcess.start('/path/to/music.exe')
    const proc = musicProcess.process
    musicProcess.stop()
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
  })
})

describe('musicProcess - 回调设置', () => {
  it('所有回调设置器不抛错', () => {
    expect(() => {
      musicProcess.onReady(() => {})
      musicProcess.onStatus(() => {})
      musicProcess.onTrackChange(() => {})
      musicProcess.onPlayState(() => {})
      musicProcess.onProgress(() => {})
      musicProcess.onDevices(() => {})
      musicProcess.onNoMusic(() => {})
      musicProcess.onPlayError(() => {})
      musicProcess.onVolumeChange(() => {})
      musicProcess.onPlayMode(() => {})
      musicProcess.onPlaylist(() => {})
      musicProcess.onSongMissing(() => {})
      musicProcess.onHotkeys(() => {})
      musicProcess.onHotkeysUpdated(() => {})
      musicProcess.onHotkeyRecordingStarted(() => {})
      musicProcess.onHotkeyRecordingStopped(() => {})
      musicProcess.onHotkeyKeyPressed(() => {})
      musicProcess.onRecordingKeys(() => {})
    }).not.toThrow()
  })
})
