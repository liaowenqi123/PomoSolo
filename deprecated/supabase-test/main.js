const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Supabase 配置
const SUPABASE_URL = 'https://sjexeynibnfqxvwehnxk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NtzlEhTWwC4qpSY0DEvQ0Q_ER6yJoTz';

let supabase = null;
let currentSession = null;

// 密码哈希函数
function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

// 验证密码
function verifyPassword(password, hash, salt) {
  const result = hashPassword(password, salt);
  return result.hash === hash;
}

// 初始化 Supabase
function initSupabase() {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('Supabase 客户端已初始化');
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();
}

// 测试数据库连接
ipcMain.handle('test-connection', async () => {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' };
  }

  try {
    const { data, error } = await supabase.from('users').select('count').limit(1);
    
    if (error && error.code !== 'PGRST116') {
      console.error('连接测试失败:', error);
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (err) {
    console.error('连接异常:', err);
    return { success: false, error: err.message };
  }
});

// 获取当前会话
ipcMain.handle('get-session', async () => {
  return { success: true, session: currentSession };
});

// 登录（用户名 + 密码）
ipcMain.handle('login', async (event, { username, password }) => {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' };
  }

  try {
    // 通过用户名查找用户
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .limit(1);

    if (error) {
      console.error('查询用户失败:', error);
      return { success: false, error: '登录失败' };
    }

    if (!users || users.length === 0) {
      return { success: false, error: '用户名不存在' };
    }

    const user = users[0];

    // 验证密码
    if (!verifyPassword(password, user.password_hash, user.salt)) {
      return { success: false, error: '密码错误' };
    }

    // 更新最后登录时间
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // 创建会话
    currentSession = {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      admin: user.admin || false
    };

    // 如果是 admin，获取 deepseek API key
    let deepseekKey = null;
    if (user.admin) {
      const { data: keyData, error: keyError } = await supabase
        .from('api_keys')
        .select('api_key')
        .eq('name', 'deepseek')
        .limit(1);

      if (!keyError && keyData && keyData.length > 0) {
        deepseekKey = keyData[0].api_key;
        console.log('Admin 用户登录，已获取 DeepSeek API Key');
      }
    }

    console.log('登录成功:', username, user.admin ? '(Admin)' : '');
    return { 
      success: true, 
      user: currentSession,
      deepseekKey: deepseekKey 
    };
  } catch (err) {
    console.error('登录异常:', err);
    return { success: false, error: err.message };
  }
});

// 退出登录
ipcMain.handle('logout', async () => {
  currentSession = null;
  return { success: true };
});

// 注册用户（用户名 + 密码）
ipcMain.handle('register-user', async (event, { username, password }) => {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' };
  }

  if (!username || username.length < 2) {
    return { success: false, error: '用户名至少需要2个字符' };
  }

  if (!password || password.length < 6) {
    return { success: false, error: '密码至少需要6个字符' };
  }

  try {
    // 检查用户名是否已存在
    const { data: existingUsers } = await supabase
      .from('users')
      .select('username')
      .eq('username', username)
      .limit(1);

    if (existingUsers && existingUsers.length > 0) {
      return { success: false, error: '用户名已存在' };
    }

    // 哈希密码
    const { hash, salt } = hashPassword(password);

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
      .select();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: '用户名已存在' };
      }
      console.error('注册失败:', error);
      return { success: false, error: error.message };
    }

    console.log('注册成功:', username);
    return { success: true, data: data[0] };
  } catch (err) {
    console.error('注册异常:', err);
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
  initSupabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});