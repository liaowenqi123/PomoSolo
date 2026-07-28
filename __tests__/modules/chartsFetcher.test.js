/**
 * chartsFetcher.js 测试
 * 覆盖：fetchCharts（netease/qq）、各备用接口、错误回退
 *
 * chartsFetcher 直接 require('https') / require('http')
 * 在 setup.js 中已通过 Module._load 拦截将这两个模块替换为 __httpsMock。
 * 测试通过 __httpsMock.__lastRequest / __httpsMock.__requestHandler 访问请求对象。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const https = require('https')
const chartsFetcher = require('../../src/modules/chartsFetcher')

// 创建 fake response 对象
function createFakeResponse(statusCode, body, headers = {}) {
  const res = https.__createFakeResponse(statusCode, body, headers)
  return res
}

// 辅助：触发 https.request 的回调并返回响应
function respondToRequest(statusCode, body, headers = {}) {
  const res = createFakeResponse(statusCode, body, headers)
  if (https.__requestHandler) {
    https.__requestHandler(res)
  }
  return res
}

describe('chartsFetcher - fetchCharts netease', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    https.__reset()
  })

  it('网易云 - 成功返回歌曲列表', async () => {
    const apiData = JSON.stringify({
      result: {
        tracks: [
          { name: 'song1', artists: [{ name: 'artist1' }], album: { name: 'album1' } },
          { name: 'song2', artists: [{ name: 'artist2' }, { name: 'artist3' }], album: { name: 'album2' } }
        ]
      }
    })
    const promise = chartsFetcher.fetchCharts('netease')
    respondToRequest(200, apiData)
    const result = await promise
    expect(result).toHaveLength(2)
    expect(result[0].rank).toBe(1)
    expect(result[0].title).toBe('song1')
    expect(result[0].artist).toBe('artist1')
    expect(result[0].album).toBe('album1')
    expect(result[1].rank).toBe(2)
    expect(result[1].artist).toBe('artist2 / artist3')
  })

  it('网易云 - 默认参数返回 netease', async () => {
    const apiData = JSON.stringify({ result: { tracks: [] } })
    const promise = chartsFetcher.fetchCharts()
    respondToRequest(200, apiData)
    const result = await promise
    expect(result).toEqual([])
  })

  it('网易云 - API 返回无效 JSON 时回退到备用接口', async () => {
    const promise = chartsFetcher.fetchNeteaseHot()
    // 主接口失败
    respondToRequest(200, 'invalid json')
    // 等待主接口失败，备用接口请求
    await new Promise(r => setTimeout(r, 10))
    // 备用接口返回 textarea HTML
    const backupHtml = '<textarea id="song-list-pre-data">' + encodeURIComponent(JSON.stringify([
      { name: 'b1', artists: [{ name: 'a1' }], album: { name: 'al1' } }
    ])) + '</textarea>'
    respondToRequest(200, backupHtml)
    const result = await promise
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('b1')
  })

  it('网易云 - 备用接口使用 INITIAL_DATA', async () => {
    const promise = chartsFetcher.fetchNeteaseHot()
    respondToRequest(200, 'invalid json')
    await new Promise(r => setTimeout(r, 10))
    const initialData = {
      playlist: {
        tracks: [
          { name: 'init-song', ar: [{ name: 'init-artist' }], al: { name: 'init-album' } }
        ]
      }
    }
    const backupHtml = '<script>window.__INITIAL_DATA__ = ' + JSON.stringify(initialData) + '</script>'
    respondToRequest(200, backupHtml)
    const result = await promise
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('init-song')
    expect(result[0].artist).toBe('init-artist')
  })

  it('网易云 - 主接口和备用接口都失败时返回空数组', async () => {
    const promise = chartsFetcher.fetchNeteaseHot()
    respondToRequest(500, '')
    await new Promise(r => setTimeout(r, 10))
    respondToRequest(500, '')
    const result = await promise
    expect(result).toEqual([])
  })

  it('网易云 - 备用接口无法解析 HTML 时返回空数组', async () => {
    const promise = chartsFetcher.fetchNeteaseHot()
    respondToRequest(200, 'invalid json')
    await new Promise(r => setTimeout(r, 10))
    respondToRequest(200, '<html>no useful data</html>')
    const result = await promise
    expect(result).toEqual([])
  })

  it('网易云 - tracks 缺失时返回空数组', async () => {
    const promise = chartsFetcher.fetchCharts('netease')
    respondToRequest(200, JSON.stringify({ result: {} }))
    const result = await promise
    expect(result).toEqual([])
  })

  it('网易云 - song name 缺失时使用 "未知歌曲"', async () => {
    const apiData = JSON.stringify({
      result: {
        tracks: [
          { artists: [], album: {} }
          // 没有 name
        ]
      }
    })
    const promise = chartsFetcher.fetchCharts('netease')
    respondToRequest(200, apiData)
    const result = await promise
    expect(result[0].title).toBe('未知歌曲')
  })
})

describe('chartsFetcher - fetchCharts qq', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    https.__reset()
  })

  it('QQ音乐 - 成功返回歌曲列表', async () => {
    const apiData = JSON.stringify({
      songlist: [
        { data: { songname: 'q1', singer: [{ name: 's1' }], albumname: 'al1' } },
        { data: { songname: 'q2', singer: [{ name: 's2' }, { name: 's3' }] } }
      ]
    })
    const promise = chartsFetcher.fetchCharts('qq')
    respondToRequest(200, apiData)
    const result = await promise
    expect(result).toHaveLength(2)
    expect(result[0].title).toBe('q1')
    expect(result[0].artist).toBe('s1')
    expect(result[1].artist).toBe('s2 / s3')
  })

  it('QQ音乐 - 主接口失败回退到备用接口', async () => {
    const promise = chartsFetcher.fetchQQMusicHot()
    respondToRequest(200, 'invalid json')
    await new Promise(r => setTimeout(r, 10))
    const backupData = JSON.stringify({
      topList: {
        data: {
          data: {
            songInfoList: [
              { title: 'qq-b1', singer: [{ name: 'b-artist' }], album: { name: 'b-album' } }
            ]
          }
        }
      }
    })
    respondToRequest(200, backupData)
    const result = await promise
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('qq-b1')
    expect(result[0].artist).toBe('b-artist')
  })

  it('QQ音乐 - 主备接口都失败返回空数组', async () => {
    const promise = chartsFetcher.fetchQQMusicHot()
    respondToRequest(500, '')
    await new Promise(r => setTimeout(r, 10))
    respondToRequest(200, 'invalid json')
    const result = await promise
    expect(result).toEqual([])
  })

  it('QQ音乐 - songlist 缺失时返回空数组', async () => {
    const promise = chartsFetcher.fetchCharts('qq')
    respondToRequest(200, JSON.stringify({}))
    const result = await promise
    expect(result).toEqual([])
  })

  it('QQ音乐 - 备用接口 songInfoList 缺失返回空数组', async () => {
    const promise = chartsFetcher.fetchQQMusicHot()
    respondToRequest(200, 'invalid json')
    await new Promise(r => setTimeout(r, 10))
    respondToRequest(200, JSON.stringify({ topList: {} }))
    const result = await promise
    expect(result).toEqual([])
  })

  it('QQ音乐 - item.data 不存在时使用 item 本身', async () => {
    const apiData = JSON.stringify({
      songlist: [
        { name: 'direct-name', singer: [{ name: 'direct-singer' }] }
        // 没有 data 字段
      ]
    })
    const promise = chartsFetcher.fetchCharts('qq')
    respondToRequest(200, apiData)
    const result = await promise
    expect(result[0].title).toBe('direct-name')
    expect(result[0].artist).toBe('direct-singer')
  })
})

describe('chartsFetcher - fetch 通用功能', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    https.__reset()
  })

  it('重定向 - 3xx 状态码跟随 Location', async () => {
    const finalData = JSON.stringify({ result: { tracks: [{ name: 'redirected' }] } })
    const promise = chartsFetcher.fetchCharts('netease')
    // 第一次响应：重定向
    respondToRequest(302, '', { location: 'https://music.163.com/redirected' })
    await new Promise(r => setTimeout(r, 10))
    // 第二次响应：成功
    respondToRequest(200, finalData)
    const result = await promise
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('redirected')
  })

  it('HTTP 错误状态码触发 reject', async () => {
    const promise = chartsFetcher.fetchCharts('netease')
    respondToRequest(404, 'Not Found')
    await new Promise(r => setTimeout(r, 10))
    // 主接口失败 -> 备用接口
    respondToRequest(404, 'Not Found')
    await new Promise(r => setTimeout(r, 10))
    // 备用也失败 -> 空数组
    const result = await promise
    expect(result).toEqual([])
  })

  it('请求超时', async () => {
    const promise = chartsFetcher.fetchCharts('netease')
    // 模拟超时事件
    const req = https.__lastRequest
    expect(req).not.toBe(null)
    setTimeout(() => {
      req.emit('timeout')
    }, 10)
    // 等待超时被处理
    await new Promise(r => setTimeout(r, 50))
    // 主接口失败 -> 备用接口
    respondToRequest(200, '<html>no data</html>')
    const result = await promise
    expect(result).toEqual([])
  })

  it('请求 error 事件触发 reject', async () => {
    const promise = chartsFetcher.fetchCharts('netease')
    const req = https.__lastRequest
    expect(req).not.toBe(null)
    setTimeout(() => {
      req.emit('error', new Error('network error'))
    }, 10)
    await new Promise(r => setTimeout(r, 50))
    respondToRequest(200, '<html>no data</html>')
    const result = await promise
    expect(result).toEqual([])
  })
})

describe('chartsFetcher - 导出', () => {
  it('导出 fetchCharts、fetchNeteaseHot、fetchQQMusicHot', () => {
    expect(typeof chartsFetcher.fetchCharts).toBe('function')
    expect(typeof chartsFetcher.fetchNeteaseHot).toBe('function')
    expect(typeof chartsFetcher.fetchQQMusicHot).toBe('function')
  })
})
