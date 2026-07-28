/**
 * 云端认证模块 - 主进程
 * 处理 Supabase 云端登录、注册、凭据存储
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { app, safeStorage } = require('electron')
const { createClient } = require('@supabase/supabase-js')

// Supabase 配置
const SUPABASE_URL = 'https://sjexeynibnfqxvwehnxk.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_NtzlEhTWwC4qpSY0DEvQ0Q_ER6yJoTz'

// 单点登录配置
const HEARTBEAT_INTERVAL = 60 * 1000      // 心跳间隔：1 分钟
const HEARTBEAT_TIMEOUT = 2 * 60 * 1000   // 超时阈值：2 分钟

let supabase = null
let currentSession = null
let heartbeatTimer = null                 // 心跳定时器
let localClientId = null                  // 本地 client_id（内存缓存）

/**
 * 密码哈希函数（异步，避免阻塞主进程事件循环）
 * @param {string} password - 原始密码
 * @param {string|null} salt - 盐值（可选）
 * @returns {Promise<{ hash: string, salt: string }>}
 */
async function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex')
  }
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) return reject(err)
      resolve({ hash: derivedKey.toString('hex'), salt })
    })
  })
}

/**
 * 验证密码（异步）
 * @param {string} password - 原始密码
 * @param {string} hash - 存储的哈希值
 * @param {string} salt - 盐值
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, hash, salt) {
  const result = await hashPassword(password, salt)
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

// ============ 单点登录：client_id 管理 ============

/**
 * 获取机器标识（尽可能稳定的唯一标识）
 * @returns {string}
 */
function getMachineId() {
  const os = require('os')
  const hostname = os.hostname()
  const platform = os.platform()
  const cpus = os.cpus()
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown'
  
  // 组合多个因素生成机器标识
  const machineInfo = `${hostname}-${platform}-${cpuModel}`
  return crypto.createHash('sha256').update(machineInfo).digest('hex').substring(0, 32)
}

/**
 * 获取可执行文件路径
 * @returns {string}
 */
function getExecutablePath() {
  try {
    // Electron 应用的执行路径
    return app.getPath('exe') || app.getAppPath() || 'unknown'
  } catch (err) {
    return 'unknown'
  }
}

/**
 * 生成客户端 ID
 * @returns {string}
 */
function generateClientId() {
  const machineId = getMachineId()
  const execPath = getExecutablePath()
  const combined = `${machineId}-${execPath}`
  return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32)
}

/**
 * 获取本地 client_id（优先从内存缓存，其次从文件，最后生成新值）
 * @returns {{ success: boolean, clientId?: string, error?: string }}
 */
function getLocalClientId() {
  // 优先返回内存缓存
  if (localClientId) {
    return { success: true, clientId: localClientId }
  }
  
  try {
    const credentialsPath = getCredentialsPath()
    
    // 尝试从凭据文件读取
    if (fs.existsSync(credentialsPath)) {
      const data = fs.readFileSync(credentialsPath, 'utf-8')
      const credentials = JSON.parse(data)
      
      if (credentials.client_id) {
        localClientId = credentials.client_id
        console.log('[CloudAuth] 从文件加载 client_id:', localClientId)
        return { success: true, clientId: localClientId }
      }
    }
    
    // 生成新的 client_id
    localClientId = generateClientId()
    console.log('[CloudAuth] 生成新 client_id:', localClientId)
    
    // 持久化存储
    saveClientIdToFile(localClientId)
    
    return { success: true, clientId: localClientId }
  } catch (err) {
    console.error('[CloudAuth] 获取 client_id 失败:', err)
    // 失败时生成临时 ID（不持久化）
    localClientId = generateClientId()
    return { success: true, clientId: localClientId }
  }
}

/**
 * 将 client_id 保存到凭据文件
 * @param {string} clientId
 */
function saveClientIdToFile(clientId) {
  try {
    const credentialsPath = getCredentialsPath()
    
    let credentials = {}
    if (fs.existsSync(credentialsPath)) {
      const data = fs.readFileSync(credentialsPath, 'utf-8')
      credentials = JSON.parse(data)
    }
    
    credentials.client_id = clientId
    fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), 'utf-8')
    console.log('[CloudAuth] client_id 已持久化存储')
  } catch (err) {
    console.error('[CloudAuth] 保存 client_id 失败:', err)
  }
}

// ============ 单点登录：登录检查 ============

/**
 * 检查是否允许登录（单点登录检查）
 * @param {number} userId - 用户ID
 * @param {string} clientId - 本地 client_id
 * @returns {{ allowed: boolean, reason?: string, error?: string }}
 */
async function checkLoginAllowed(userId, clientId) {
  if (!supabase) {
    return { allowed: false, error: 'Supabase 未初始化' }
  }
  
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('is_online, last_main_login_heartbeat, client_id')
      .eq('id', userId)
      .single()
    
    if (error) {
      console.error('[CloudAuth] 查询用户状态失败:', error)
      return { allowed: false, error: '查询用户状态失败' }
    }
    
    // 优先级 1：client_id 一致，同一设备重新登录
    if (user.client_id && user.client_id === clientId) {
      console.log('[CloudAuth] 同一设备重新登录，允许')
      return { allowed: true, reason: 'same_device' }
    }
    
    // 优先级 2：云端显示 offline
    if (!user.is_online) {
      console.log('[CloudAuth] 云端显示离线，允许登录')
      return { allowed: true, reason: 'offline' }
    }
    
    // 优先级 3：云端显示 online，检查心跳超时
    if (user.last_main_login_heartbeat) {
      const lastHeartbeat = new Date(user.last_main_login_heartbeat)
      const elapsed = Date.now() - lastHeartbeat.getTime()
      
      if (elapsed > HEARTBEAT_TIMEOUT) {
        console.log('[CloudAuth] 心跳超时，对方已掉线，允许登录')
        return { allowed: true, reason: 'heartbeat_timeout' }
      }
    } else {
      // 没有心跳记录，但显示在线，可能是异常状态，允许登录
      console.log('[CloudAuth] 无心跳记录但显示在线，允许登录')
      return { allowed: true, reason: 'no_heartbeat_record' }
    }
    
    // 对方确实在线
    console.log('[CloudAuth] 账号已在其他设备登录，拒绝登录')
    return { allowed: false, reason: 'already_online' }
  } catch (err) {
    console.error('[CloudAuth] 检查登录状态异常:', err)
    return { allowed: false, error: err.message }
  }
}

// ============ 单点登录：心跳管理 ============

/**
 * 启动心跳
 * @param {number} userId - 用户ID
 * @param {string} clientId - 客户端ID
 */
function startHeartbeat(userId, clientId) {
  // 先停止之前的心跳
  stopHeartbeat()
  
  // 立即发送一次心跳
  sendHeartbeat(userId, clientId)
  
  // 启动定时器
  heartbeatTimer = setInterval(() => {
    sendHeartbeat(userId, clientId)
  }, HEARTBEAT_INTERVAL)
  
  console.log('[CloudAuth] 心跳已启动，间隔:', HEARTBEAT_INTERVAL / 1000, '秒')
}

/**
 * 发送心跳
 * @param {number} userId
 * @param {string} clientId
 */
async function sendHeartbeat(userId, clientId) {
  if (!supabase || !currentSession) {
    return
  }
  
  try {
    const now = new Date().toISOString()
    
    const { error } = await supabase
      .from('users')
      .update({
        is_online: true,
        last_main_login_heartbeat: now,
        client_id: clientId
      })
      .eq('id', userId)
    
    if (error) {
      console.error('[CloudAuth] 心跳发送失败:', error)
    } else {
      console.log('[CloudAuth] 心跳发送成功:', now)
    }
  } catch (err) {
    console.error('[CloudAuth] 心跳发送异常:', err)
  }
}

/**
 * 停止心跳
 */
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
    console.log('[CloudAuth] 心跳已停止')
  }
}

/**
 * 标记离线
 * @param {number} userId
 */
async function markOffline(userId) {
  if (!supabase) {
    return
  }
  
  try {
    await supabase
      .from('users')
      .update({
        is_online: false,
        last_main_login_heartbeat: new Date().toISOString()
      })
      .eq('id', userId)
    
    console.log('[CloudAuth] 已标记离线')
  } catch (err) {
    console.error('[CloudAuth] 标记离线失败:', err)
  }
}

/**
 * 获取凭据文件路径
 * @returns {string}
 */
function getCredentialsPath() {
  return path.join(app.getPath('userData'), 'credentials.json')
}

/**
 * 保存凭据到本地（使用 safeStorage 加密密码）
 * @param {object} credentials - { username, password, autoLogin }
 * @returns {{ success: boolean, error?: string }}
 */
function saveCredentials(credentials) {
  try {
    const credentialsPath = getCredentialsPath()
    // 加密密码字段（使用 OS 级加密：Windows DPAPI / macOS Keychain / Linux libsecret）
    const toStore = { ...credentials }
    if (toStore.password && safeStorage.isEncryptionAvailable()) {
      toStore.passwordEncrypted = safeStorage.encryptString(toStore.password).toString('base64')
      delete toStore.password
    }
    fs.writeFileSync(credentialsPath, JSON.stringify(toStore, null, 2), 'utf-8')
    return { success: true }
  } catch (err) {
    console.error('[CloudAuth] 保存凭据失败:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 加载本地凭据（自动解密密码）
 * @returns {{ success: boolean, credentials?: object|null, error?: string }}
 */
function loadCredentials() {
  try {
    const credentialsPath = getCredentialsPath()
    if (fs.existsSync(credentialsPath)) {
      const data = fs.readFileSync(credentialsPath, 'utf-8')
      const parsed = JSON.parse(data)
      // 解密密码字段
      if (parsed.passwordEncrypted && safeStorage.isEncryptionAvailable()) {
        parsed.password = safeStorage.decryptString(Buffer.from(parsed.passwordEncrypted, 'base64'))
        delete parsed.passwordEncrypted
      }
      return { success: true, credentials: parsed }
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
 * 获取会话信息（不向渲染进程暴露 API Key）
 * @param {object} aiAssistant - AI 助手模块引用
 * @param {object} songDownloader - 歌曲下载模块引用
 * @param {object} [foregroundInspection] - 前台检测模块引用
 * @returns {{ success: boolean, session?: object|null, hasDeepseekKey?: boolean }}
 */
async function getSessionWithKey(aiAssistant, songDownloader, foregroundInspection) {
  if (!currentSession) {
    return { success: true, session: null, hasDeepseekKey: false }
  }

  // 如果是 admin，重新获取 DeepSeek API Key（仅留在主进程，不返回给渲染进程）
  let hasDeepseekKey = false
  if (currentSession.admin && supabase) {
    try {
      const { data: keyData } = await supabase
        .from('api_keys')
        .select('api_key')
        .eq('name', 'deepseek')
        .limit(1)

      if (keyData && keyData.length > 0) {
        const deepseekKey = keyData[0].api_key
        hasDeepseekKey = true
        // 更新主进程各模块的 API Key（不经过渲染进程）
        if (aiAssistant) {
          aiAssistant.setApiKey(deepseekKey)
        }
        if (songDownloader) {
          songDownloader.setApiKey(deepseekKey)
        }
        if (foregroundInspection) {
          foregroundInspection.setApiKey(deepseekKey)
        }
      }
    } catch (err) {
      console.error('[CloudAuth] 获取 API Key 失败:', err)
    }
  }

  return { success: true, session: currentSession, hasDeepseekKey: hasDeepseekKey }
}

/**
 * 用户登录
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @param {object} aiAssistant - AI 助手模块引用
 * @param {object} songDownloader - 歌曲下载模块引用
 * @param {object} [foregroundInspection] - 前台检测模块引用
 * @returns {{ success: boolean, user?: object, hasDeepseekKey?: boolean, error?: string }}
 */
async function login(username, password, aiAssistant, songDownloader, foregroundInspection) {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' }
  }

  try {
    // 获取本地 client_id
    const clientIdResult = getLocalClientId()
    if (!clientIdResult.success) {
      return { success: false, error: '获取客户端ID失败' }
    }
    const clientId = clientIdResult.clientId

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

    // ===== 单点登录检查 =====
    const loginCheck = await checkLoginAllowed(user.id, clientId)
    if (!loginCheck.allowed) {
      if (loginCheck.reason === 'already_online') {
        return { success: false, error: '账号已在其他设备登录，请稍后再试' }
      }
      return { success: false, error: loginCheck.error || '登录检查失败' }
    }
    console.log('[CloudAuth] 单点登录检查通过:', loginCheck.reason)

    // ===== 密码验证 =====
    if (!(await verifyPassword(password, user.password_hash, user.salt))) {
      return { success: false, error: '密码错误' }
    }

    // 更新最后登录时间和在线状态
    const now = new Date().toISOString()
    await supabase
      .from('users')
      .update({ 
        last_login: now,
        is_online: true,
        last_main_login_heartbeat: now,
        client_id: clientId
      })
      .eq('id', user.id)

    // 创建会话
    currentSession = {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      admin: user.admin || false
    }

    // ===== 启动心跳 =====
    startHeartbeat(user.id, clientId)

    // 如果是 admin，获取 DeepSeek API Key（仅留在主进程，不返回给渲染进程）
    let hasDeepseekKey = false
    if (user.admin) {
      const { data: keyData } = await supabase
        .from('api_keys')
        .select('api_key')
        .eq('name', 'deepseek')
        .limit(1)

      if (keyData && keyData.length > 0) {
        const deepseekKey = keyData[0].api_key
        hasDeepseekKey = true
        // 更新主进程各模块的 API Key（不经过渲染进程）
        if (aiAssistant) {
          aiAssistant.setApiKey(deepseekKey)
        }
        if (songDownloader) {
          songDownloader.setApiKey(deepseekKey)
        }
        if (foregroundInspection) {
          foregroundInspection.setApiKey(deepseekKey)
        }
        console.log('[CloudAuth] Admin 用户登录，已获取 DeepSeek API Key（仅主进程内存）')
      }
    }

    console.log('[CloudAuth] 登录成功:', username, user.admin ? '(Admin)' : '')
    return { 
      success: true, 
      user: currentSession,
      hasDeepseekKey: hasDeepseekKey 
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
    const { hash, salt } = await hashPassword(password)

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
async function logout(aiAssistant, foregroundInspection, songDownloader) {
  // 停止心跳
  stopHeartbeat()
  
  // 标记云端离线状态
  if (currentSession) {
    await markOffline(currentSession.id)
  }
  
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

// ============ 意见反馈功能 ============

/**
 * 提交用户反馈
 * @param {string} content - 反馈内容
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
async function submitFeedback(content) {
  if (!supabase || !currentSession) {
    return { success: false, error: '未登录或 Supabase 未初始化' }
  }

  if (!content || content.trim().length === 0) {
    return { success: false, error: '反馈内容不能为空' }
  }

  if (content.length > 500) {
    return { success: false, error: '反馈内容不能超过500字' }
  }

  try {
    const { data, error } = await supabase
      .from('feedback')
      .insert([{
        user_id: currentSession.id,
        feedback_content: content.trim(),
        feedback_status: 0, // 默认状态：已收到
        create_time: new Date().toISOString()
      }])
      .select()
      .single()

    if (error) {
      console.error('[CloudAuth] 提交反馈失败:', error)
      return { success: false, error: error.message }
    }

    console.log('[CloudAuth] 提交反馈成功')
    return { success: true, data }
  } catch (err) {
    console.error('[CloudAuth] 提交反馈异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 获取用户的反馈列表
 * @returns {{ success: boolean, data?: array, error?: string }}
 */
async function getUserFeedbacks() {
  if (!supabase || !currentSession) {
    return { success: false, error: '未登录或 Supabase 未初始化' }
  }

  try {
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .eq('user_id', currentSession.id)
      .order('create_time', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[CloudAuth] 获取反馈列表失败:', error)
      return { success: false, error: error.message }
    }

    return { success: true, data: data || [] }
  } catch (err) {
    console.error('[CloudAuth] 获取反馈列表异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 删除用户反馈
 * @param {number} feedbackId - 反馈ID
 * @returns {{ success: boolean, error?: string }}
 */
async function deleteFeedback(feedbackId) {
  if (!supabase || !currentSession) {
    return { success: false, error: '未登录或 Supabase 未初始化' }
  }

  try {
    // 先验证这条反馈是否属于当前用户
    const { data: feedback, error: fetchError } = await supabase
      .from('feedback')
      .select('id, user_id')
      .eq('id', feedbackId)
      .single()

    if (fetchError || !feedback) {
      return { success: false, error: '反馈不存在' }
    }

    if (feedback.user_id !== currentSession.id) {
      return { success: false, error: '无权删除此反馈' }
    }

    // 删除反馈
    const { error: deleteError } = await supabase
      .from('feedback')
      .delete()
      .eq('id', feedbackId)

    if (deleteError) {
      console.error('[CloudAuth] 删除反馈失败:', deleteError)
      return { success: false, error: deleteError.message }
    }

    console.log('[CloudAuth] 删除反馈成功')
    return { success: true }
  } catch (err) {
    console.error('[CloudAuth] 删除反馈异常:', err)
    return { success: false, error: err.message }
  }
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
  logout,
  submitFeedback,
  getUserFeedbacks,
  deleteFeedback,
  // 单点登录相关
  getLocalClientId,
  checkLoginAllowed,
  startHeartbeat,
  stopHeartbeat,
  markOffline
}
