/**
 * 云端认证模块 - 主进程
 * 处理 Supabase 云端登录、注册、凭据存储
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const { createClient } = require('@supabase/supabase-js')

// Supabase 配置
const SUPABASE_URL = 'https://sjexeynibnfqxvwehnxk.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_NtzlEhTWwC4qpSY0DEvQ0Q_ER6yJoTz'

let supabase = null
let currentSession = null

/**
 * 密码哈希函数
 * @param {string} password - 原始密码
 * @param {string|null} salt - 盐值（可选）
 * @returns {{ hash: string, salt: string }}
 */
function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex')
  }
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return { hash, salt }
}

/**
 * 验证密码
 * @param {string} password - 原始密码
 * @param {string} hash - 存储的哈希值
 * @param {string} salt - 盐值
 * @returns {boolean}
 */
function verifyPassword(password, hash, salt) {
  const result = hashPassword(password, salt)
  return result.hash === hash
}

/**
 * 初始化 Supabase
 */
function init() {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  console.log('[CloudAuth] Supabase 客户端已初始化')
}

/**
 * 获取当前会话
 * @returns {object|null}
 */
function getSession() {
  return currentSession
}

/**
 * 获取凭据文件路径
 * @returns {string}
 */
function getCredentialsPath() {
  return path.join(app.getPath('userData'), 'credentials.json')
}

/**
 * 保存凭据到本地
 * @param {object} credentials - { username, password, autoLogin }
 * @returns {{ success: boolean, error?: string }}
 */
function saveCredentials(credentials) {
  try {
    const credentialsPath = getCredentialsPath()
    fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), 'utf-8')
    return { success: true }
  } catch (err) {
    console.error('[CloudAuth] 保存凭据失败:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 加载本地凭据
 * @returns {{ success: boolean, credentials?: object|null, error?: string }}
 */
function loadCredentials() {
  try {
    const credentialsPath = getCredentialsPath()
    if (fs.existsSync(credentialsPath)) {
      const data = fs.readFileSync(credentialsPath, 'utf-8')
      return { success: true, credentials: JSON.parse(data) }
    }
    return { success: true, credentials: null }
  } catch (err) {
    console.error('[CloudAuth] 加载凭据失败:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 清除本地凭据
 * @returns {{ success: boolean, error?: string }}
 */
function clearCredentials() {
  try {
    const credentialsPath = getCredentialsPath()
    if (fs.existsSync(credentialsPath)) {
      fs.unlinkSync(credentialsPath)
    }
    return { success: true }
  } catch (err) {
    console.error('[CloudAuth] 清除凭据失败:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 测试云端连接
 * @returns {{ success: boolean, error?: string }}
 */
async function testConnection() {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' }
  }

  try {
    const { data, error } = await supabase.from('users').select('count').limit(1)
    
    if (error && error.code !== 'PGRST116') {
      return { success: false, error: error.message }
    }
    
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * 获取会话信息（包含 DeepSeek API Key）
 * @param {object} aiAssistant - AI 助手模块引用
 * @param {object} songDownloader - 歌曲下载模块引用
 * @returns {{ success: boolean, session?: object|null, deepseekKey?: string|null }}
 */
async function getSessionWithKey(aiAssistant, songDownloader) {
  if (!currentSession) {
    return { success: true, session: null, deepseekKey: null }
  }
  
  // 如果是 admin，重新获取 DeepSeek API Key
  let deepseekKey = null
  if (currentSession.admin && supabase) {
    try {
      const { data: keyData } = await supabase
        .from('api_keys')
        .select('api_key')
        .eq('name', 'deepseek')
        .limit(1)

      if (keyData && keyData.length > 0) {
        deepseekKey = keyData[0].api_key
        // 更新 AI 助手的 API Key
        if (aiAssistant) {
          aiAssistant.setApiKey(deepseekKey)
        }
        // 更新下载模块的 API Key
        if (songDownloader) {
          songDownloader.setApiKey(deepseekKey)
        }
      }
    } catch (err) {
      console.error('[CloudAuth] 获取 API Key 失败:', err)
    }
  }
  
  return { success: true, session: currentSession, deepseekKey: deepseekKey }
}

/**
 * 用户登录
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @param {object} aiAssistant - AI 助手模块引用
 * @param {object} songDownloader - 歌曲下载模块引用
 * @returns {{ success: boolean, user?: object, deepseekKey?: string|null, error?: string }}
 */
async function login(username, password, aiAssistant, songDownloader) {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' }
  }

  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .limit(1)

    if (error) {
      return { success: false, error: '登录失败' }
    }

    if (!users || users.length === 0) {
      return { success: false, error: '用户名不存在' }
    }

    const user = users[0]

    if (!verifyPassword(password, user.password_hash, user.salt)) {
      return { success: false, error: '密码错误' }
    }

    // 更新最后登录时间
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id)

    // 创建会话
    currentSession = {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      admin: user.admin || false
    }

    // 如果是 admin，获取 DeepSeek API Key
    let deepseekKey = null
    if (user.admin) {
      const { data: keyData } = await supabase
        .from('api_keys')
        .select('api_key')
        .eq('name', 'deepseek')
        .limit(1)

      if (keyData && keyData.length > 0) {
        deepseekKey = keyData[0].api_key
        // 更新 AI 助手的 API Key
        if (aiAssistant) {
          aiAssistant.setApiKey(deepseekKey)
        }
        // 更新下载模块的 API Key
        if (songDownloader) {
          songDownloader.setApiKey(deepseekKey)
        }
        console.log('[CloudAuth] Admin 用户登录，已获取 DeepSeek API Key（仅内存）')
      }
    }

    console.log('[CloudAuth] 登录成功:', username, user.admin ? '(Admin)' : '')
    return { 
      success: true, 
      user: currentSession,
      deepseekKey: deepseekKey 
    }
  } catch (err) {
    console.error('[CloudAuth] 登录异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 用户注册
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
async function register(username, password) {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' }
  }

  if (!username || username.length < 2) {
    return { success: false, error: '用户名至少需要2个字符' }
  }

  if (!password || password.length < 6) {
    return { success: false, error: '密码至少需要6个字符' }
  }

  try {
    // 检查用户名是否已存在
    const { data: existingUsers } = await supabase
      .from('users')
      .select('username')
      .eq('username', username)
      .limit(1)

    if (existingUsers && existingUsers.length > 0) {
      return { success: false, error: '用户名已存在' }
    }

    // 哈希密码
    const { hash, salt } = hashPassword(password)

    // 插入用户
    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          username: username,
          password_hash: hash,
          salt: salt,
          created_at: new Date().toISOString()
        }
      ])
      .select()

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: '用户名已存在' }
      }
      return { success: false, error: error.message }
    }

    console.log('[CloudAuth] 注册成功:', username)
    return { success: true, data: data[0] }
  } catch (err) {
    console.error('[CloudAuth] 注册异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 退出登录
 * @param {object} aiAssistant - AI 助手模块引用
 * @param {object} foregroundInspection - 前台检测模块引用
 * @param {object} songDownloader - 歌曲下载模块引用
 * @returns {{ success: boolean }}
 */
function logout(aiAssistant, foregroundInspection, songDownloader) {
  currentSession = null
  // 清除 AI 助手的 API Key
  if (aiAssistant) {
    aiAssistant.setApiKey(null)
  }
  // 清除前台检测的 API Key（发送空值）
  if (foregroundInspection) {
    foregroundInspection.setApiKey(null)
  }
  // 清除下载模块的 API Key
  if (songDownloader) {
    songDownloader.setApiKey(null)
  }
  console.log('[CloudAuth] 已退出登录，已清除内存中的 API Key')
  return { success: true }
}

module.exports = {
  init,
  getSession,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  testConnection,
  getSessionWithKey,
  login,
  register,
  logout
}
