/**
 * songDownloader.js 测试
 * 覆盖：setApiKey、setDownloaderPath、downloadSong 各退出码路径、
 * 进度回调、错误路径、队列状态、超时
 *
 * child_process 已在 setup.js 中通过 Module._load 拦截替换为 __childProcessMock。
 * 测试通过 childProcess.__lastSpawned / childProcess.__lastSpawnArgs 访问。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const childProcess = require('child_process')
const songDownloader = require('../../src/modules/songDownloader')

// 便捷访问
function getLastSpawnedProcess() {
  return childProcess.__lastSpawned
}

function getSpawnCallArgs() {
  return childProcess.__lastSpawnArgs
}

describe('songDownloader - setApiKey & setDownloaderPath', () => {
  it('setApiKey 设置 API Key', () => {
    songDownloader.setApiKey('my-key')
    expect(songDownloader.apiKey).toBe('my-key')
  })

  it('setDownloaderPath 设置路径', () => {
    songDownloader.setDownloaderPath('/path/to/downloader.exe')
    expect(songDownloader.getDownloaderPath()).toBe('/path/to/downloader.exe')
  })
})

describe('songDownloader - getStatus', () => {
  beforeEach(() => {
    songDownloader.isDownloading = false
    songDownloader.currentSong = null
    songDownloader.downloadQueue = []
  })

  it('返回初始状态', () => {
    const status = songDownloader.getStatus()
    expect(status.isDownloading).toBe(false)
    expect(status.currentSong).toBe(null)
    expect(status.queueLength).toBe(0)
  })

  it('isBusy 反映 isDownloading', () => {
    expect(songDownloader.isBusy()).toBe(false)
    songDownloader.isDownloading = true
    expect(songDownloader.isBusy()).toBe(true)
  })

  it('getQueueLength 返回队列长度', () => {
    expect(songDownloader.getQueueLength()).toBe(0)
    songDownloader.downloadQueue.push({ title: 'a', artist: 'b' })
    expect(songDownloader.getQueueLength()).toBe(1)
  })
})

describe('songDownloader - downloadSong 失败路径', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    songDownloader.downloaderPath = null
    songDownloader.apiKey = null
    songDownloader.downloadQueue = []
    songDownloader.isDownloading = false
    songDownloader.currentSong = null
  })

  it('未配置下载器路径失败', async () => {
    songDownloader.setApiKey('key')
    const result = await songDownloader.downloadSong('title', 'artist')
    expect(result.success).toBe(false)
    expect(result.error).toContain('路径未配置')
  })

  it('未配置 API Key 失败', async () => {
    songDownloader.setDownloaderPath('/path/downloader.exe')
    const result = await songDownloader.downloadSong('title', 'artist')
    expect(result.success).toBe(false)
    expect(result.error).toContain('API Key')
  })
})

describe('songDownloader - downloadSong 退出码路径', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    songDownloader.downloaderPath = '/path/downloader.exe'
    songDownloader.apiKey = 'my-key'
    songDownloader.downloadQueue = []
    songDownloader.isDownloading = false
    songDownloader.currentSong = null
    childProcess.__reset()
  })

  it('退出码 0 - 下载成功', async () => {
    const promise = songDownloader.downloadSong('MySong', 'Artist')
    expect(getLastSpawnedProcess()).not.toBe(null)
    getLastSpawnedProcess().emit('close', 0)
    const result = await promise
    expect(result.success).toBe(true)
    expect(result.status).toBe('downloaded')
  })

  it('退出码 2 - 已存在', async () => {
    const promise = songDownloader.downloadSong('MySong', 'Artist')
    getLastSpawnedProcess().emit('close', 2)
    const result = await promise
    expect(result.success).toBe(true)
    expect(result.status).toBe('exists')
  })

  it('退出码 3 - 未找到视频', async () => {
    const promise = songDownloader.downloadSong('MySong', 'Artist')
    getLastSpawnedProcess().emit('close', 3)
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.status).toBe('no_video')
  })

  it('退出码 4 - 未找到纯音乐', async () => {
    const promise = songDownloader.downloadSong('MySong', 'Artist')
    getLastSpawnedProcess().emit('close', 4)
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.status).toBe('no_instrumental')
  })

  it('退出码 1 - 下载失败', async () => {
    const promise = songDownloader.downloadSong('MySong', 'Artist')
    getLastSpawnedProcess().emit('close', 1)
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.status).toBe('failed')
  })

  it('未知退出码 - 下载失败', async () => {
    const promise = songDownloader.downloadSong('MySong', 'Artist')
    getLastSpawnedProcess().emit('close', 99)
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.status).toBe('failed')
  })

  it('进程 error 事件 - 启动失败', async () => {
    const promise = songDownloader.downloadSong('MySong', 'Artist')
    getLastSpawnedProcess().emit('error', new Error('ENOENT'))
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.error).toContain('启动下载器失败')
  })

  it('spawn 参数包含歌曲名和 API Key', async () => {
    const promise = songDownloader.downloadSong('Title', 'Artist')
    expect(getSpawnCallArgs().args).toEqual(['-s', 'Title - Artist', '-k', 'my-key'])
    getLastSpawnedProcess().emit('close', 0)
    await promise
  })

  it('无 artist 时 songName 为 title', async () => {
    const promise = songDownloader.downloadSong('TitleOnly', '')
    expect(getSpawnCallArgs().args[1]).toBe('TitleOnly')
    getLastSpawnedProcess().emit('close', 0)
    await promise
  })

  it('进度回调被触发', async () => {
    const onProgress = vi.fn()
    const promise = songDownloader.downloadSong('Song', 'Artist', onProgress)
    // 启动进度
    const proc = getLastSpawnedProcess()
    proc.stdout.emit('data', Buffer.from('正在 B 站搜索'))
    proc.stdout.emit('data', Buffer.from('DeepSeek 正在分析'))
    proc.stdout.emit('data', Buffer.from('正在下载'))
    proc.stdout.emit('data', Buffer.from('提取音频'))
    expect(onProgress).toHaveBeenCalledWith('正在启动下载器...')
    expect(onProgress).toHaveBeenCalledWith('正在搜索 B 站...')
    expect(onProgress).toHaveBeenCalledWith('AI 正在分析视频...')
    expect(onProgress).toHaveBeenCalledWith('正在下载视频...')
    expect(onProgress).toHaveBeenCalledWith('正在提取音频...')
    proc.emit('close', 0)
    await promise
  })

  it('stderr 数据不抛错', async () => {
    const promise = songDownloader.downloadSong('Song', 'Artist')
    const proc = getLastSpawnedProcess()
    expect(() => {
      proc.stderr.emit('data', Buffer.from('warn'))
    }).not.toThrow()
    proc.emit('close', 0)
    await promise
  })
})

describe('songDownloader - 队列串行执行', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    songDownloader.downloaderPath = '/path/downloader.exe'
    songDownloader.apiKey = 'my-key'
    songDownloader.downloadQueue = []
    songDownloader.isDownloading = false
    songDownloader.currentSong = null
    childProcess.__reset()
  })

  it('串行执行多个下载任务', async () => {
    const p1 = songDownloader.downloadSong('Song1', 'Artist1')
    // 此时第一个下载已启动，第二个会入队
    const p2 = songDownloader.downloadSong('Song2', 'Artist2')

    expect(songDownloader.isBusy()).toBe(true)

    // 完成第一个
    getLastSpawnedProcess().emit('close', 0)
    const r1 = await p1
    expect(r1.success).toBe(true)

    // 第二个开始
    getLastSpawnedProcess().emit('close', 0)
    const r2 = await p2
    expect(r2.success).toBe(true)
  })

  it('currentSong 反映当前下载', async () => {
    const promise = songDownloader.downloadSong('MyTitle', 'MyArtist')
    expect(songDownloader.currentSong).toEqual({ title: 'MyTitle', artist: 'MyArtist' })
    getLastSpawnedProcess().emit('close', 0)
    await promise
  })

  it('队列完成后 currentSong 被清空', async () => {
    const promise = songDownloader.downloadSong('MyTitle', 'MyArtist')
    getLastSpawnedProcess().emit('close', 0)
    await promise
    expect(songDownloader.currentSong).toBe(null)
    expect(songDownloader.isBusy()).toBe(false)
  })

  it('下载异常时返回失败并继续处理队列', async () => {
    const p1 = songDownloader.downloadSong('Song1', 'Artist1')
    // 模拟异常 - 在 _doDownload 之外抛出
    // 由于 _doDownload 已 try/catch，触发 spawn 失败
    childProcess.spawn.mockImplementationOnce(() => { throw new Error('spawn ENOENT') })
    const p2 = songDownloader.downloadSong('Song2', 'Artist2')

    // 第一个正常完成
    getLastSpawnedProcess().emit('close', 0)
    const r1 = await p1
    expect(r1.success).toBe(true)

    // 第二个因 spawn 异常失败
    const r2 = await p2
    expect(r2.success).toBe(false)
  })
})

describe('songDownloader - 超时', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    songDownloader.downloaderPath = '/path/downloader.exe'
    songDownloader.apiKey = 'my-key'
    songDownloader.downloadQueue = []
    songDownloader.isDownloading = false
    songDownloader.currentSong = null
    childProcess.__reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('5 分钟超时返回失败', async () => {
    const promise = songDownloader.downloadSong('Song', 'Artist')
    expect(getLastSpawnedProcess()).not.toBe(null)
    vi.advanceTimersByTime(5 * 60 * 1000 + 100)
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.error).toContain('超时')
  })
})
