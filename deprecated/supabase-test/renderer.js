// 更新连接状态
function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  if (connected) {
    statusEl.className = 'connected';
    statusEl.textContent = '● 已连接到 Supabase';
  } else {
    statusEl.className = 'disconnected';
    statusEl.textContent = '● 未连接';
  }
}

// 显示消息
function showMessage(text, type) {
  const messageEl = document.getElementById('authMessage');
  messageEl.textContent = text;
  messageEl.className = 'message ' + type;

  if (type === 'success') {
    setTimeout(() => {
      messageEl.className = 'message';
    }, 3000);
  }
}

// 显示登录面板
function showAuthPanel() {
  document.getElementById('loggedInPanel').classList.add('hidden');
  document.getElementById('authPanel').classList.remove('hidden');
}

// 显示已登录面板
function showLoggedInPanel(user, deepseekKey = null) {
  document.getElementById('authPanel').classList.add('hidden');
  document.getElementById('loggedInPanel').classList.remove('hidden');
  document.getElementById('welcomeText').textContent = `欢迎, ${user.username}!`;
  
  let metaText = `ID: ${user.id}`;
  if (user.admin) {
    metaText += ' | 👑 Admin';
  }
  document.getElementById('userMetaText').textContent = metaText;

  // 显示 API Key（如果有）
  const apiKeyPanel = document.getElementById('apiKeyPanel');
  const apiKeyText = document.getElementById('apiKeyText');
  if (deepseekKey) {
    apiKeyPanel.style.display = 'block';
    apiKeyText.textContent = deepseekKey;
  } else {
    apiKeyPanel.style.display = 'none';
  }
}

// 测试连接
async function testConnection() {
  const result = await window.electronAPI.testConnection();
  if (result.success) {
    updateConnectionStatus(true);
    // 检查是否已登录
    const sessionResult = await window.electronAPI.getSession();
    if (sessionResult.success && sessionResult.session) {
      showLoggedInPanel(sessionResult.session);
    }
  } else {
    updateConnectionStatus(false);
    showMessage('连接失败: ' + result.error, 'error');
  }
}

// 登录
async function login(username, password) {
  const loginBtn = document.getElementById('loginBtn');
  loginBtn.disabled = true;
  loginBtn.textContent = '登录中...';

  const result = await window.electronAPI.login({ username, password });

  if (result.success) {
    showMessage('登录成功！', 'success');
    showLoggedInPanel(result.user, result.deepseekKey);
  } else {
    showMessage('登录失败: ' + result.error, 'error');
  }

  loginBtn.disabled = false;
  loginBtn.textContent = '登录';
}

// 注册
async function registerUser(username, password) {
  const registerBtn = document.getElementById('registerBtn');
  registerBtn.disabled = true;
  registerBtn.textContent = '注册中...';

  const result = await window.electronAPI.registerUser({ username, password });

  if (result.success) {
    showMessage('注册成功！请登录', 'success');
    // 切换到登录面板
    document.querySelector('[data-tab="login"]').click();
    document.getElementById('loginUsername').value = username;
  } else {
    showMessage('注册失败: ' + result.error, 'error');
  }

  registerBtn.disabled = false;
  registerBtn.textContent = '注册';
}

// 退出登录
async function logout() {
  const result = await window.electronAPI.logout();
  if (result.success) {
    showAuthPanel();
    document.querySelector('[data-tab="login"]').click();
  }
}

// Tab 切换
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const tabName = tab.dataset.tab;
    document.querySelectorAll('.form-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(tabName + 'Panel').classList.add('active');

    // 清除消息
    document.getElementById('authMessage').className = 'message';
  });
});

// 登录表单提交
document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!username || !password) {
    showMessage('请填写所有字段', 'error');
    return;
  }

  login(username, password);
});

// 注册表单提交
document.getElementById('registerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('registerUsername').value.trim();
  const password = document.getElementById('registerPassword').value;

  if (!username || !password) {
    showMessage('请填写所有字段', 'error');
    return;
  }

  registerUser(username, password);
});

// 退出登录按钮
document.getElementById('logoutBtn').addEventListener('click', logout);

// 页面加载完成后测试连接
document.addEventListener('DOMContentLoaded', () => {
  testConnection();
});
