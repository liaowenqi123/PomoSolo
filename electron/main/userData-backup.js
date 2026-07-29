/**
 * 用户数据备份/还原工具
 *
 * 解决增量更新时用户数据被覆盖的问题。
 * 子进程（foreground_inspection.exe / music.exe）使用相对于 exe 所在目录的路径，
 * 无法直接读取 userData 目录，因此采用"更新前备份，更新后还原"策略。
 *
 * 备份内容：
 *   - resources/list_config.json （前台检测黑白名单）
 *   - resources/music/ （音乐文件和 tags.json）
 *
 * 流程：
 *   1. 更新下载完成 → backupUserData() 将当前文件复制到 userData/backup/
 *   2. NSIS 安装器运行，覆盖 resources/ 目录
 *   3. 新版本 app 启动 → restoreUserData() 将备份复制回 resources/
 */
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

/**
 * 需要备份的用户数据文件/目录列表
 * @returns {Array<{src: string, relPath: string, isDir: boolean}>}
 */
function getBackupItems(resourcesPath) {
  return [
    {
      src: path.join(resourcesPath, 'list_config.json'),
      relPath: 'list_config.json',
      isDir: false
    },
    {
      src: path.join(resourcesPath, 'music'),
      relPath: 'music',
      isDir: true
    }
  ]
}

/**
 * 默认歌曲文件名列表（应用自带的，不需要备份/还原）
 * 备份时跳过这些文件可以减少增量更新的差分体积
 */
const DEFAULT_SONGS = [
  'Tick Tock, Take Control - 番茄钟.mp3',
  '番茄倒数快一点 - 番茄钟.mp3',
  '番茄小宇宙 - 番茄钟.mp3'
]

function isDefaultSong(filename) {
  return DEFAULT_SONGS.includes(filename)
}

/**
 * 获取备份根目录
 */
function getBackupDir() {
  return path.join(app.getPath('userData'), 'backup')
}

/**
 * 备份用户数据到 userData/backup/
 * 在更新安装前调用
 * @param {string} resourcesPath - 当前 resources 目录路径
 */
function backupUserData(resourcesPath) {
  const backupDir = getBackupDir()
  const items = getBackupItems(resourcesPath)

  // 清空旧的备份
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true })
  }
  fs.mkdirSync(backupDir, { recursive: true })

  let copiedCount = 0
  for (const item of items) {
    if (!fs.existsSync(item.src)) continue
    const dest = path.join(backupDir, item.relPath)

    if (item.isDir) {
      fs.mkdirSync(dest, { recursive: true })
      // 复制音乐目录，跳过默认歌曲
      const musicFiles = fs.readdirSync(item.src)
      let musicCopied = 0
      for (const file of musicFiles) {
        if (isDefaultSong(file)) {
          continue  // 跳过默认歌曲，它们在新版安装包中自带
        }
        const srcFile = path.join(item.src, file)
        const destFile = path.join(dest, file)
        const stat = fs.statSync(srcFile)
        if (stat.isFile()) {
          fs.copyFileSync(srcFile, destFile)
        } else if (stat.isDirectory()) {
          fs.cpSync(srcFile, destFile, { recursive: true, force: true })
        }
        musicCopied++
      }
      console.log(`[UserData] 备份音乐文件: ${musicCopied} 首（跳过 ${musicFiles.length - musicCopied} 首默认歌曲）`)
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(item.src, dest)
    }
    copiedCount++
  }

  console.log(`[UserData] 备份完成: ${copiedCount} 项 -> ${backupDir}`)
  return copiedCount
}

/**
 * 还原用户数据到 resources/
 * 在 app 启动时调用，检查 userData/backup/ 是否存在则还原
 * @param {string} resourcesPath - 新版本的 resources 目录路径
 * @returns {boolean} 是否执行了还原
 */
function restoreUserData(resourcesPath) {
  const backupDir = getBackupDir()
  if (!fs.existsSync(backupDir)) {
    return false // 没有备份，无需还原（首次安装）
  }

  const items = getBackupItems(resourcesPath)
  let restoredCount = 0

  for (const item of items) {
    const src = path.join(backupDir, item.relPath)
    if (!fs.existsSync(src)) continue

    // 确保目标父目录存在
    if (item.isDir) {
      if (!fs.existsSync(item.src)) {
        fs.mkdirSync(item.src, { recursive: true })
      }
      // 还原音乐文件，跳过默认歌曲（新安装包已有）
      const backupFiles = fs.readdirSync(src)
      let musicRestored = 0
      for (const file of backupFiles) {
        if (isDefaultSong(file)) {
          continue
        }
        const srcFile = path.join(src, file)
        const destFile = path.join(item.src, file)
        const stat = fs.statSync(srcFile)
        if (stat.isFile()) {
          fs.copyFileSync(srcFile, destFile)
        } else if (stat.isDirectory()) {
          fs.cpSync(srcFile, destFile, { recursive: true, force: true })
        }
        musicRestored++
      }
      console.log(`[UserData] 还原音乐文件: ${musicRestored} 首`)
    } else {
      const destDir = path.dirname(item.src)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      fs.copyFileSync(src, item.src)
    }
    restoredCount++
  }

  // 还原后清除备份
  fs.rmSync(backupDir, { recursive: true, force: true })

  console.log(`[UserData] 还原完成: ${restoredCount} 项 -> ${resourcesPath}`)
  return restoredCount > 0
}

/**
 * 检查是否存在待还原的备份
 */
function hasPendingBackup() {
  return fs.existsSync(getBackupDir())
}

module.exports = {
  backupUserData,
  restoreUserData,
  hasPendingBackup
}
