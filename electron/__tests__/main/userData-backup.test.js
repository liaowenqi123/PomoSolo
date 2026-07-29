/**
 * main/userData-backup.js 测试
 *
 * 测试备份/还原逻辑：
 *   - backupUserData 创建备份文件
 *   - restoreUserData 将备份复制回 resources
 *   - 默认歌曲被跳过
 *   - 无备份时 hasPendingBackup 返回 false
 *
 * 注意：__fsMock 的 readdirSync/rmSync/cpSync/existsSync 使用 '/' 作为分隔符，
 * 但 Windows 上 path.join 产生 '\' 分隔符。因此在 beforeAll 中重写这些方法，
 * 使其在比较前统一规范化分隔符。
 */
import { describe, expect, it, beforeEach, beforeAll, vi } from 'vitest'
const path = require('path')

// 使用全局 fs mock
vi.mock('fs', () => __fsMock)

// 规范化路径分隔符（\ -> /）以便在 Windows 上比较
const norm = (p) => String(p).replace(/\\/g, '/')

beforeAll(() => {
  // 重写依赖路径分隔符的方法
  __fsMock.existsSync.mockImplementation((p) => {
    const np = norm(p)
    const snap = __fsMock.__snapshot()
    return Object.keys(snap).some(k => {
      const nk = norm(k)
      return nk === np || nk === np + '/'
    })
  })

  __fsMock.readdirSync.mockImplementation((dirPath) => {
    const np = norm(dirPath)
    const result = []
    const seen = new Set()
    const snap = __fsMock.__snapshot()
    for (const key of Object.keys(snap)) {
      const nk = norm(key)
      if (nk.startsWith(np + '/')) {
        const rest = nk.slice(np.length + 1)
        if (rest && !rest.includes('/')) {
          if (!seen.has(rest)) {
            result.push(rest)
            seen.add(rest)
          }
        }
      }
    }
    return result
  })

  __fsMock.rmSync.mockImplementation((dirPath) => {
    const np = norm(dirPath)
    const snap = __fsMock.__snapshot()
    const toDelete = Object.keys(snap).filter(k => {
      const nk = norm(k)
      return nk === np || nk.startsWith(np + '/')
    })
    toDelete.forEach((k) => __fsMock.unlinkSync(k))
  })

  __fsMock.cpSync.mockImplementation((src, dest) => {
    const ns = norm(src)
    const snap = __fsMock.__snapshot()
    for (const [key, value] of Object.entries(snap)) {
      const nk = norm(key)
      if (nk === ns || nk.startsWith(ns + '/')) {
        let newKey
        if (nk === ns) {
          newKey = dest
        } else {
          newKey = dest + key.slice(src.length)
        }
        __fsMock.writeFileSync(newKey, value)
      }
    }
  })
})

const { app } = require('electron')
const { backupUserData, restoreUserData, hasPendingBackup } = require('../../main/userData-backup')

function getBackupDir() {
  return path.join(app.getPath('userData'), 'backup')
}

describe('main/userData-backup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ============ hasPendingBackup ============

  describe('hasPendingBackup', () => {
    it('无备份目录时应返回 false', () => {
      expect(hasPendingBackup()).toBe(false)
    })

    it('有备份目录时应返回 true', () => {
      const backupDir = getBackupDir()
      __fsMock.mkdirSync(backupDir, { recursive: true })
      expect(hasPendingBackup()).toBe(true)
    })
  })

  // ============ backupUserData ============

  describe('backupUserData', () => {
    it('应备份 list_config.json 文件', () => {
      const resourcesPath = 'C:\\resources'
      const configFile = path.join(resourcesPath, 'list_config.json')
      __fsMock.__setFile(configFile, '{"whitelist": []}')

      const count = backupUserData(resourcesPath)

      expect(count).toBe(1) // 只备份了 list_config.json（music 目录不存在）
      const backupFile = path.join(getBackupDir(), 'list_config.json')
      expect(__fsMock.__hasFile(backupFile)).toBe(true)
      expect(__fsMock.__getFile(backupFile)).toBe('{"whitelist": []}')
    })

    it('应备份 music 目录中的非默认歌曲', () => {
      const resourcesPath = 'C:\\resources'
      const musicDir = path.join(resourcesPath, 'music')
      __fsMock.mkdirSync(musicDir, { recursive: true })

      // 非默认歌曲
      __fsMock.__setFile(path.join(musicDir, 'my-song.mp3'), 'audio-data')
      __fsMock.__setFile(path.join(musicDir, 'tags.json'), '{"tags": {}}')
      // 默认歌曲（应跳过）
      __fsMock.__setFile(path.join(musicDir, '番茄小宇宙 - 番茄钟.mp3'), 'default-audio')
      // list_config.json 也存在
      __fsMock.__setFile(path.join(resourcesPath, 'list_config.json'), '{}')

      const count = backupUserData(resourcesPath)

      expect(count).toBe(2) // list_config.json + music 目录

      const backupMusicDir = path.join(getBackupDir(), 'music')
      expect(__fsMock.__hasFile(path.join(backupMusicDir, 'my-song.mp3'))).toBe(true)
      expect(__fsMock.__hasFile(path.join(backupMusicDir, 'tags.json'))).toBe(true)
      // 默认歌曲不应被备份
      expect(__fsMock.__hasFile(path.join(backupMusicDir, '番茄小宇宙 - 番茄钟.mp3'))).toBe(false)
    })

    it('源文件不存在时应跳过该项', () => {
      const resourcesPath = 'C:\\empty-resources'
      // 不设置任何文件
      const count = backupUserData(resourcesPath)
      expect(count).toBe(0)
    })

    it('已存在旧备份时应先清除再备份', () => {
      const resourcesPath = 'C:\\resources'
      const configFile = path.join(resourcesPath, 'list_config.json')
      __fsMock.__setFile(configFile, '{"new": true}')

      // 预设旧备份
      const backupDir = getBackupDir()
      __fsMock.mkdirSync(backupDir, { recursive: true })
      __fsMock.__setFile(path.join(backupDir, 'old-file.txt'), 'old')

      backupUserData(resourcesPath)

      // 旧文件应被清除
      expect(__fsMock.__hasFile(path.join(backupDir, 'old-file.txt'))).toBe(false)
      // 新文件应存在
      expect(__fsMock.__hasFile(path.join(backupDir, 'list_config.json'))).toBe(true)
    })

    it('音乐目录包含子目录时应使用 cpSync 复制', () => {
      const resourcesPath = 'C:\\resources'
      const musicDir = path.join(resourcesPath, 'music')
      __fsMock.mkdirSync(musicDir, { recursive: true })

      // 创建子目录：设置子目录名作为 key + 目录标记
      const subDir = path.join(musicDir, 'playlist1')
      __fsMock.__setFile(subDir, true) // 让 readdirSync 返回 'playlist1'
      __fsMock.mkdirSync(subDir, { recursive: true }) // 设置目录标记
      // 子目录中的文件
      __fsMock.__setFile(path.join(subDir, 'song1.mp3'), 'audio1')

      // list_config.json 不存在，只备份 music
      const count = backupUserData(resourcesPath)

      expect(count).toBe(1)
      const backupSubDir = path.join(getBackupDir(), 'music', 'playlist1')
      expect(__fsMock.__hasFile(path.join(backupSubDir, 'song1.mp3'))).toBe(true)
    })

    it('所有默认歌曲都应被跳过', () => {
      const resourcesPath = 'C:\\resources'
      const musicDir = path.join(resourcesPath, 'music')
      __fsMock.mkdirSync(musicDir, { recursive: true })

      __fsMock.__setFile(path.join(musicDir, 'Tick Tock, Take Control - 番茄钟.mp3'), 'a')
      __fsMock.__setFile(path.join(musicDir, '番茄倒数快一点 - 番茄钟.mp3'), 'b')
      __fsMock.__setFile(path.join(musicDir, '番茄小宇宙 - 番茄钟.mp3'), 'c')

      const count = backupUserData(resourcesPath)

      expect(count).toBe(1) // music 目录本身被备份（copiedCount++），但内部 0 首歌曲
      const backupMusicDir = path.join(getBackupDir(), 'music')
      // 不应有任何文件被复制
      expect(__fsMock.__hasFile(path.join(backupMusicDir, 'Tick Tock, Take Control - 番茄钟.mp3'))).toBe(false)
    })
  })

  // ============ restoreUserData ============

  describe('restoreUserData', () => {
    it('无备份时应返回 false', () => {
      const result = restoreUserData('C:\\new-resources')
      expect(result).toBe(false)
    })

    it('应将备份文件还原到 resources 目录', () => {
      const resourcesPath = 'C:\\new-resources'

      // 预设备份
      const backupDir = getBackupDir()
      __fsMock.mkdirSync(backupDir, { recursive: true })
      __fsMock.__setFile(path.join(backupDir, 'list_config.json'), '{"restored": true}')

      const result = restoreUserData(resourcesPath)

      expect(result).toBe(true)
      expect(__fsMock.__hasFile(path.join(resourcesPath, 'list_config.json'))).toBe(true)
      expect(__fsMock.__getFile(path.join(resourcesPath, 'list_config.json'))).toBe('{"restored": true}')
    })

    it('应还原 music 目录中的非默认歌曲', () => {
      const resourcesPath = 'C:\\new-resources'

      const backupDir = getBackupDir()
      __fsMock.mkdirSync(backupDir, { recursive: true })
      const backupMusicDir = path.join(backupDir, 'music')
      __fsMock.mkdirSync(backupMusicDir, { recursive: true })
      __fsMock.__setFile(path.join(backupMusicDir, 'my-song.mp3'), 'audio')
      __fsMock.__setFile(path.join(backupMusicDir, 'tags.json'), '{}')
      // 默认歌曲也在备份中（不应被还原）
      __fsMock.__setFile(path.join(backupMusicDir, '番茄小宇宙 - 番茄钟.mp3'), 'default')

      const result = restoreUserData(resourcesPath)

      expect(result).toBe(true)
      const musicDir = path.join(resourcesPath, 'music')
      expect(__fsMock.__hasFile(path.join(musicDir, 'my-song.mp3'))).toBe(true)
      expect(__fsMock.__hasFile(path.join(musicDir, 'tags.json'))).toBe(true)
      expect(__fsMock.__hasFile(path.join(musicDir, '番茄小宇宙 - 番茄钟.mp3'))).toBe(false)
    })

    it('还原后应清除备份目录', () => {
      const resourcesPath = 'C:\\new-resources'
      const backupDir = getBackupDir()
      __fsMock.mkdirSync(backupDir, { recursive: true })
      __fsMock.__setFile(path.join(backupDir, 'list_config.json'), '{}')

      restoreUserData(resourcesPath)

      expect(hasPendingBackup()).toBe(false)
    })

    it('备份中某项不存在时应跳过该项', () => {
      const resourcesPath = 'C:\\new-resources'

      const backupDir = getBackupDir()
      __fsMock.mkdirSync(backupDir, { recursive: true })
      // 只备份 list_config.json，不备份 music
      __fsMock.__setFile(path.join(backupDir, 'list_config.json'), '{}')

      const result = restoreUserData(resourcesPath)

      expect(result).toBe(true) // 至少还原了一项
      expect(__fsMock.__hasFile(path.join(resourcesPath, 'list_config.json'))).toBe(true)
    })

    it('目标 music 目录不存在时应创建', () => {
      const resourcesPath = 'C:\\fresh-resources'

      const backupDir = getBackupDir()
      __fsMock.mkdirSync(backupDir, { recursive: true })
      const backupMusicDir = path.join(backupDir, 'music')
      __fsMock.mkdirSync(backupMusicDir, { recursive: true })
      __fsMock.__setFile(path.join(backupMusicDir, 'song.mp3'), 'audio')

      restoreUserData(resourcesPath)

      const musicDir = path.join(resourcesPath, 'music')
      expect(__fsMock.__hasFile(path.join(musicDir, 'song.mp3'))).toBe(true)
    })

    it('目标 list_config.json 父目录不存在时应创建', () => {
      const resourcesPath = 'C:\\fresh-resources2'

      const backupDir = getBackupDir()
      __fsMock.mkdirSync(backupDir, { recursive: true })
      __fsMock.__setFile(path.join(backupDir, 'list_config.json'), '{"v": 2}')

      restoreUserData(resourcesPath)

      expect(__fsMock.__hasFile(path.join(resourcesPath, 'list_config.json'))).toBe(true)
    })

    it('还原后备份为空时返回 false', () => {
      const resourcesPath = 'C:\\new-resources'

      const backupDir = getBackupDir()
      __fsMock.mkdirSync(backupDir, { recursive: true })
      // 不设置任何备份文件

      const result = restoreUserData(resourcesPath)

      expect(result).toBe(false)
    })

    it('music 目录包含子目录时应使用 cpSync 还原', () => {
      const resourcesPath = 'C:\\new-resources'

      const backupDir = getBackupDir()
      __fsMock.mkdirSync(backupDir, { recursive: true })
      const backupMusicDir = path.join(backupDir, 'music')
      __fsMock.mkdirSync(backupMusicDir, { recursive: true })

      // 子目录
      const backupSubDir = path.join(backupMusicDir, 'playlist1')
      __fsMock.__setFile(backupSubDir, true)
      __fsMock.mkdirSync(backupSubDir, { recursive: true })
      __fsMock.__setFile(path.join(backupSubDir, 'song1.mp3'), 'audio1')

      const result = restoreUserData(resourcesPath)

      expect(result).toBe(true)
      const subDir = path.join(resourcesPath, 'music', 'playlist1')
      expect(__fsMock.__hasFile(path.join(subDir, 'song1.mp3'))).toBe(true)
    })
  })
})
