/**
 * 音乐榜单抓取模块
 * 支持网易云音乐和QQ音乐热歌榜
 */

const https = require('https')
const http = require('http')

// 通用请求头
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://www.google.com/'
}

/**
 * 通用HTTP请求函数
 * @param {string} url - 请求URL
 * @param {object} options - 请求选项
 * @returns {Promise<string>} 响应内容
 */
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const isHttps = urlObj.protocol === 'https:'
    const lib = isHttps ? https : http
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: { ...HEADERS, ...options.headers },
      timeout: 10000
    }
    
    const req = lib.request(reqOptions, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data)
        } else if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // 处理重定向
          fetch(res.headers.location, options).then(resolve).catch(reject)
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      })
    })
    
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
    
    req.end()
  })
}

/**
 * 抓取网易云音乐热歌榜
 * @returns {Promise<Array>} 歌曲列表
 */
async function fetchNeteaseHot() {
  try {
    // 网易云热歌榜 ID: 3778678
    const url = 'https://music.163.com/api/playlist/detail?id=3778678'
    const data = await fetch(url, {
      headers: { 'Referer': 'https://music.163.com/' }
    })
    
    const json = JSON.parse(data)
    const tracks = json?.result?.tracks?.slice(0, 10) || []
    
    return tracks.map((track, index) => ({
      rank: index + 1,
      title: track.name || '未知歌曲',
      artist: (track.artists || []).map(a => a.name).join(' / '),
      album: track.album?.name || ''
    }))
  } catch (error) {
    console.error('[Charts] 网易云抓取失败:', error.message)
    // 尝试备用接口
    return fetchNeteaseBackup()
  }
}

/**
 * 网易云备用抓取方式
 */
async function fetchNeteaseBackup() {
  try {
    // 使用另一个接口
    const url = 'https://music.163.com/discover/toplist?id=3778678'
    const html = await fetch(url, {
      headers: { 'Referer': 'https://music.163.com/' }
    })
    
    // 尝试从HTML中提取数据
    const match = html.match(/<textarea[^>]*id="song-list-pre-data"[^>]*>([\s\S]*?)<\/textarea>/)
    if (match) {
      const songs = JSON.parse(decodeURIComponent(match[1]))
      return songs.slice(0, 10).map((song, index) => ({
        rank: index + 1,
        title: song.name || song.title || '未知歌曲',
        artist: song.artists ? song.artists.map(a => a.name).join(' / ') : (song.authorName || ''),
        album: song.album?.name || song.albumName || ''
      }))
    }
    
    // 尝试提取JSON数据
    const jsonMatch = html.match(/window\.__INITIAL_DATA__\s*=\s*({[\s\S]*?})\s*<\/script>/)
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1])
      const tracks = data?.playlist?.tracks?.slice(0, 10) || []
      return tracks.map((track, index) => ({
        rank: index + 1,
        title: track.name || '未知歌曲',
        artist: (track.ar || []).map(a => a.name).join(' / '),
        album: track.al?.name || ''
      }))
    }
    
    throw new Error('无法解析HTML')
  } catch (error) {
    console.error('[Charts] 网易云备用抓取失败:', error.message)
    return []
  }
}

/**
 * 抓取QQ音乐热歌榜
 * @returns {Promise<Array>} 歌曲列表
 */
async function fetchQQMusicHot() {
  try {
    // QQ音乐热歌榜 topid=27
    const url = 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=27&needNewCode=1&uin=0&format=json&platform=h5&tpl=3&page=detail&type=top&song_begin=0&song_num=10'
    const data = await fetch(url, {
      headers: { 'Referer': 'https://y.qq.com/' }
    })
    
    const json = JSON.parse(data)
    const songs = json?.songlist?.slice(0, 10) || []
    
    return songs.map((item, index) => {
      const songInfo = item.data || item
      return {
        rank: index + 1,
        title: songInfo.songname || songInfo.name || '未知歌曲',
        artist: (songInfo.singer || []).map(s => s.name).join(' / '),
        album: songInfo.albumname || songInfo.album?.name || ''
      }
    })
  } catch (error) {
    console.error('[Charts] QQ音乐抓取失败:', error.message)
    return fetchQQMusicBackup()
  }
}

/**
 * QQ音乐备用抓取方式
 */
async function fetchQQMusicBackup() {
  try {
    // 使用另一个接口
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg?data={"topList":{"module":"musicToplist.ToplistInfoServer","method":"GetDetail","param":{"topid":27,"num":10,"period":"2026-03-30"}}}'
    const data = await fetch(url, {
      headers: { 'Referer': 'https://y.qq.com/' }
    })
    
    const json = JSON.parse(data)
    const songs = json?.topList?.data?.data?.songInfoList?.slice(0, 10) || []
    
    return songs.map((song, index) => ({
      rank: index + 1,
      title: song.title || song.name || '未知歌曲',
      artist: (song.singer || []).map(s => s.name).join(' / '),
      album: song.album?.name || song.albumName || ''
    }))
  } catch (error) {
    console.error('[Charts] QQ音乐备用抓取失败:', error.message)
    return []
  }
}

/**
 * 获取榜单
 * @param {string} source - 来源: 'netease' 或 'qq'
 * @returns {Promise<Array>} 歌曲列表
 */
async function fetchCharts(source = 'netease') {
  if (source === 'qq') {
    return fetchQQMusicHot()
  }
  return fetchNeteaseHot()
}

module.exports = {
  fetchCharts,
  fetchNeteaseHot,
  fetchQQMusicHot
}
