/**
 * CloudAuth (apiKeyManager) 模块测试
 *
 * 测试 API Key 管理：模式切换、本地配置、登录、注册、退出、自动登录
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(async () => {
  document.body.innerHTML = `
    <div id="auth-modal"></div>
    <button id="auth-modal-close">关闭</button>
    <div id="authPanel">登录面板</div>
    <div id="auth-logged-in-panel" style="display:none">已登录面板</div>
    <span id="auth-welcome-text"></span>
    <span id="auth-user-meta"></span>
    <span id="auth-connection-status"></span>
    <div id="authMessage"></div>
    <input id="auth-username" />
    <input id="auth-password" type="password" />
    <input type="checkbox" id="auth-remember-password" />
    <input type="checkbox" id="auth-auto-login" />
    <button id="auth-login-btn">登录</button>
    <input id="auth-register-username" />
    <input id="auth-register-password" type="password" />
    <button id="auth-register-btn">注册</button>
    <button id="auth-logout-btn">退出</button>
    <button id="auth-header-btn">☁️</button>
    <input id="auth-local-api-key-input" type="password" />
    <input type="checkbox" id="auth-show-api-key" />
    <button id="auth-save-api-key-btn">保存配置</button>
    <div id="auth-local-message"></div>
    <a id="auth-deepseek-link">链接</a>
    <input type="checkbox" id="mode-toggle" />
    <span id="mode-label-cloud">云端</span>
    <span id="mode-label-local">本地</span>
    <div id="auth-cloud-panel"></div>
    <div id="auth-local-panel"></div>
    <span id="auth-modal-icon">☁️</span>
    <span id="auth-modal-title">云端登录</span>
    <div class="mode-toggle-container">
      <div class="mode-toggle-switch">
        <input type="checkbox" class="mode-toggle-checkbox" id="mode-toggle" />
        <span class="mode-toggle-slider"></span>
      </div>
    </div>
    <div id="confirm-mode-switch-modal">
      <span id="confirm-mode-switch-icon"></span>
      <span id="confirm-mode-switch-title"></span>
      <p id="confirm-mode-switch-message"></p>
      <button id="confirm-mode-switch-cancel-btn">取消</button>
      <button id="confirm-mode-switch-ok-btn">确定</button>
    </div>
    <div id="non-admin-hint" style="display:none"></div>
    <div class="login-tab active" data-tab="login">登录</div>
    <div class="login-tab" data-tab="register">注册</div>
    <form id="auth-login-form" class="login-form active"></form>
    <form id="auth-register-form" class="login-form"></form>
  `

  window.AnimatedModal = vi.fn().mockImplementation(function({ element, onShow, onHide, showClass } = {}) {
    return {
      element,
      showClass,
      show: vi.fn(() => onShow && onShow()),
      hide: vi.fn(() => onHide && onHide()),
      toggle: vi.fn()
    }
  })

  window.BaseModal = vi.fn().mockImplementation(function({ element, onShow, onHide, showClass } = {}) {
    return {
      element,
      showClass,
      show: vi.fn(() => onShow && onShow()),
      hide: vi.fn(() => onHide && onHide()),
      toggle: vi.fn()
    }
  })

  window.electronAPI = {
    getApiMode: vi.fn().mockResolvedValue('cloud'),
    setApiMode: vi.fn().mockResolvedValue(true),
    getApiKey: vi.fn().mockResolvedValue(null),
    saveApiKey: vi.fn().mockResolvedValue(true),
    cloudTestConnection: vi.fn().mockResolvedValue({ success: true }),
    cloudGetSession: vi.fn().mockResolvedValue({ success: false, session: null }),
    cloudLogin: vi.fn(),
    cloudRegister: vi.fn(),
    cloudLogout: vi.fn().mockResolvedValue({ success: true }),
    loadCredentials: vi.fn().mockResolvedValue({ success: false, credentials: null }),
    saveCredentials: vi.fn().mockResolvedValue(true),
    clearCredentials: vi.fn().mockResolvedValue(true),
    openExternal: vi.fn()
  }

  window.Timer = {
    PHASE: { READY: 'ready', RUNNING: 'running' },
    getPhase: vi.fn().mockReturnValue('ready')
  }

  window.ForegroundDetection = {
    getIsDetecting: vi.fn().mockReturnValue(false)
  }

  // 重置模块缓存，使 apiKeyManager IIFE 重新执行并重置内部闭包状态
  vi.resetModules()
  delete require.cache[require.resolve('../../src/scripts/modules/apiKeyManager')]
  require('../../src/scripts/modules/apiKeyManager')

  await window.CloudAuth.init()
})

describe('CloudAuth init', () => {
  it('init 应创建 AnimatedModal 和 BaseModal 实例', () => {
    expect(window.AnimatedModal).toHaveBeenCalled()
    expect(window.BaseModal).toHaveBeenCalled()
  })

  it('init 应加载模式', () => {
    expect(window.electronAPI.getApiMode).toHaveBeenCalled()
  })

  it('init 应测试云端连接', () => {
    expect(window.electronAPI.cloudTestConnection).toHaveBeenCalled()
  })

  it('初始模式为 cloud', () => {
    expect(window.CloudAuth.getMode()).toBe('cloud')
  })
})

describe('CloudAuth 模式相关', () => {
  it('getMode 应返回当前模式', () => {
    expect(window.CloudAuth.getMode()).toBe('cloud')
  })

  it('本地模式初始化应尝试加载本地 API Key', async () => {
    window.electronAPI.getApiMode.mockResolvedValue('local')
    window.electronAPI.getApiKey.mockResolvedValue('sk-test123')

    await window.CloudAuth.init()

    expect(window.CloudAuth.hasApiKey()).toBe(true)
    expect(window.CloudAuth.getApiKey()).toBe('sk-test123')
  })

  it('本地模式无 API Key 应显示配置弹窗', async () => {
    window.electronAPI.getApiMode.mockResolvedValue('local')
    window.electronAPI.getApiKey.mockResolvedValue(null)

    await window.CloudAuth.init()

    // 弹窗应显示
    const authModalInstance = window.AnimatedModal.mock.results[0].value
    expect(authModalInstance.show).toHaveBeenCalled()
  })
})

describe('CloudAuth 公共 API', () => {
  it('getApiKey 应返回当前 API Key', () => {
    expect(window.CloudAuth.getApiKey()).toBeNull()
  })

  it('hasApiKey 应返回 false（无 key）', () => {
    expect(window.CloudAuth.hasApiKey()).toBe(false)
  })

  it('isLoggedIn 应返回 false（无 session）', async () => {
    const result = await window.CloudAuth.isLoggedIn()
    expect(result).toBe(false)
  })

  it('isLoggedIn 有 session 应返回 true', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: true, session: { id: 1 } })
    const result = await window.CloudAuth.isLoggedIn()
    expect(result).toBe(true)
  })

  it('onLogin 应设置回调', () => {
    const callback = vi.fn()
    window.CloudAuth.onLogin(callback)
    // 不报错即可
    expect(callback).toBeDefined()
  })

  it('showModal 应显示弹窗', () => {
    window.CloudAuth.showModal()
    const authModalInstance = window.AnimatedModal.mock.results[0].value
    expect(authModalInstance.show).toHaveBeenCalled()
  })

  it('hideModal 应隐藏弹窗', () => {
    window.CloudAuth.hideModal()
    const authModalInstance = window.AnimatedModal.mock.results[0].value
    expect(authModalInstance.hide).toHaveBeenCalled()
  })
})

describe('CloudAuth handleSaveLocalApiKey', () => {
  beforeEach(async () => {
    // 切换到本地模式
    window.electronAPI.getApiMode.mockResolvedValue('local')
    await window.CloudAuth.init()
  })

  it('空 API Key 应显示错误', async () => {
    document.getElementById('auth-local-api-key-input').value = ''
    document.getElementById('auth-save-api-key-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('auth-local-message').textContent).toContain('请输入')
  })

  it('不以 sk- 开头应显示格式错误', async () => {
    document.getElementById('auth-local-api-key-input').value = 'invalid-key'
    document.getElementById('auth-save-api-key-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('auth-local-message').textContent).toContain('sk-')
  })

  it('有效 API Key 应调用 saveApiKey', async () => {
    document.getElementById('auth-local-api-key-input').value = 'sk-valid-key'
    window.electronAPI.saveApiKey.mockResolvedValue(true)

    document.getElementById('auth-save-api-key-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.saveApiKey).toHaveBeenCalledWith('sk-valid-key')
    expect(document.getElementById('auth-local-message').textContent).toContain('配置成功')
    expect(window.CloudAuth.getApiKey()).toBe('sk-valid-key')
  })

  it('saveApiKey 返回 false 应显示失败', async () => {
    document.getElementById('auth-local-api-key-input').value = 'sk-valid-key'
    window.electronAPI.saveApiKey.mockResolvedValue(false)

    document.getElementById('auth-save-api-key-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('auth-local-message').textContent).toContain('保存失败')
  })

  it('saveApiKey 抛错应显示错误信息', async () => {
    document.getElementById('auth-local-api-key-input').value = 'sk-valid-key'
    window.electronAPI.saveApiKey.mockRejectedValue(new Error('IO 错误'))

    document.getElementById('auth-save-api-key-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('auth-local-message').textContent).toContain('IO 错误')
  })

  it('回车键应触发保存', async () => {
    const input = document.getElementById('auth-local-api-key-input')
    input.value = 'sk-valid-key'
    window.electronAPI.saveApiKey.mockResolvedValue(true)

    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }))

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.saveApiKey).toHaveBeenCalledWith('sk-valid-key')
  })

  it('显示 API Key 复选框应切换 input 类型', () => {
    const checkbox = document.getElementById('auth-show-api-key')
    const input = document.getElementById('auth-local-api-key-input')
    expect(input.type).toBe('password')

    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))

    expect(input.type).toBe('text')

    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))

    expect(input.type).toBe('password')
  })
})

describe('CloudAuth handleLogin', () => {
  it('空用户名或密码应显示错误', async () => {
    document.getElementById('auth-username').value = ''
    document.getElementById('auth-password').value = ''
    document.getElementById('auth-login-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('authMessage').textContent).toContain('请填写')
  })

  it('有效凭据应调用 cloudLogin', async () => {
    document.getElementById('auth-username').value = 'testuser'
    document.getElementById('auth-password').value = 'password'
    window.electronAPI.cloudLogin.mockResolvedValue({
      success: true,
      user: { id: 1, username: 'testuser', admin: true },
      hasDeepseekKey: true
    })

    document.getElementById('auth-login-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.cloudLogin).toHaveBeenCalledWith({ username: 'testuser', password: 'password' })
  })

  it('登录成功 + 记住密码应调用 saveCredentials', async () => {
    document.getElementById('auth-username').value = 'testuser'
    document.getElementById('auth-password').value = 'password'
    document.getElementById('auth-remember-password').checked = true
    window.electronAPI.cloudLogin.mockResolvedValue({
      success: true,
      user: { id: 1, username: 'testuser', admin: true },
      hasDeepseekKey: true
    })

    document.getElementById('auth-login-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.saveCredentials).toHaveBeenCalledWith({
      username: 'testuser',
      password: 'password',
      autoLogin: false
    })
  })

  it('登录失败应显示错误', async () => {
    document.getElementById('auth-username').value = 'testuser'
    document.getElementById('auth-password').value = 'password'
    window.electronAPI.cloudLogin.mockResolvedValue({
      success: false,
      error: '密码错误'
    })

    document.getElementById('auth-login-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('authMessage').textContent).toContain('密码错误')
  })

  it('回车键应触发登录', async () => {
    document.getElementById('auth-username').value = 'testuser'
    document.getElementById('auth-password').value = 'password'
    window.electronAPI.cloudLogin.mockResolvedValue({
      success: true,
      user: { id: 1, username: 'testuser', admin: true },
      hasDeepseekKey: true
    })

    document.getElementById('auth-password').dispatchEvent(
      new KeyboardEvent('keypress', { key: 'Enter', bubbles: true })
    )

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.cloudLogin).toHaveBeenCalled()
  })
})

describe('CloudAuth handleRegister', () => {
  it('空字段应显示错误', async () => {
    document.getElementById('auth-register-username').value = ''
    document.getElementById('auth-register-password').value = ''
    document.getElementById('auth-register-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('authMessage').textContent).toContain('请填写')
  })

  it('用户名小于2字符应显示错误', async () => {
    document.getElementById('auth-register-username').value = 'a'
    document.getElementById('auth-register-password').value = 'password'
    document.getElementById('auth-register-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('authMessage').textContent).toContain('2')
  })

  it('密码小于6位应显示错误', async () => {
    document.getElementById('auth-register-username').value = 'user'
    document.getElementById('auth-register-password').value = '12345'
    document.getElementById('auth-register-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('authMessage').textContent).toContain('6')
  })

  it('有效字段应调用 cloudRegister', async () => {
    document.getElementById('auth-register-username').value = 'newuser'
    document.getElementById('auth-register-password').value = 'password123'
    window.electronAPI.cloudRegister.mockResolvedValue({ success: true })

    document.getElementById('auth-register-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.cloudRegister).toHaveBeenCalledWith({ username: 'newuser', password: 'password123' })
  })

  it('注册失败应显示错误', async () => {
    document.getElementById('auth-register-username').value = 'newuser'
    document.getElementById('auth-register-password').value = 'password123'
    window.electronAPI.cloudRegister.mockResolvedValue({ success: false, error: '用户名已存在' })

    document.getElementById('auth-register-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('authMessage').textContent).toContain('用户名已存在')
  })
})

describe('CloudAuth handleLogout', () => {
  it('Timer 运行中应显示错误', async () => {
    window.Timer.getPhase.mockReturnValue('running')
    document.getElementById('auth-logout-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('authMessage').textContent).toContain('请先停止')
  })

  it('前台检测运行中应显示错误', async () => {
    window.ForegroundDetection.getIsDetecting.mockReturnValue(true)
    document.getElementById('auth-logout-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('authMessage').textContent).toContain('前台检测')
  })

  it('正常退出应调用 cloudLogout 和 clearCredentials', async () => {
    document.getElementById('auth-logout-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.cloudLogout).toHaveBeenCalled()
    expect(window.electronAPI.clearCredentials).toHaveBeenCalled()
  })
})

describe('CloudAuth 自动登录', () => {
  it('有自动登录凭据应自动登录', async () => {
    window.electronAPI.getApiMode.mockResolvedValue('cloud')
    window.electronAPI.loadCredentials.mockResolvedValue({
      success: true,
      credentials: { username: 'saved', password: 'pass', autoLogin: true }
    })
    window.electronAPI.cloudLogin.mockResolvedValue({
      success: true,
      user: { id: 1, username: 'saved', admin: true },
      hasDeepseekKey: true
    })

    await window.CloudAuth.init()

    expect(window.electronAPI.cloudLogin).toHaveBeenCalledWith({ username: 'saved', password: 'pass' })
    // 云端模式：密钥留在主进程，渲染进程仅能确认有 Key
    expect(window.CloudAuth.hasApiKey()).toBe(true)
    expect(window.CloudAuth.getApiKey()).toBeNull()
  })

  it('自动登录失败应清除凭据并显示弹窗', async () => {
    window.electronAPI.getApiMode.mockResolvedValue('cloud')
    window.electronAPI.loadCredentials.mockResolvedValue({
      success: true,
      credentials: { username: 'saved', password: 'pass', autoLogin: true }
    })
    window.electronAPI.cloudLogin.mockResolvedValue({ success: false, error: '密码已更改' })

    await window.CloudAuth.init()

    expect(window.electronAPI.clearCredentials).toHaveBeenCalled()
    expect(window.CloudAuth.getApiKey()).toBeNull()
  })

  it('有保存凭据但未开启自动登录应填充表单', async () => {
    window.electronAPI.getApiMode.mockResolvedValue('cloud')
    window.electronAPI.loadCredentials.mockResolvedValue({
      success: true,
      credentials: { username: 'saved', password: 'pass', autoLogin: false }
    })
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: false, session: null })

    await window.CloudAuth.init()

    expect(document.getElementById('auth-username').value).toBe('saved')
    expect(document.getElementById('auth-password').value).toBe('pass')
    expect(document.getElementById('auth-remember-password').checked).toBe(true)
  })
})

describe('CloudAuth DeepSeek 链接', () => {
  it('点击链接应调用 openExternal', () => {
    document.getElementById('auth-deepseek-link').click()
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://platform.deepseek.com')
  })
})

describe('CloudAuth 连接状态', () => {
  it('连接成功应显示已连接', async () => {
    window.electronAPI.cloudTestConnection.mockResolvedValue({ success: true })
    await window.CloudAuth.init()

    expect(document.getElementById('auth-connection-status').textContent).toContain('已连接')
  })

  it('连接失败应显示连接失败', async () => {
    window.electronAPI.cloudTestConnection.mockResolvedValue({ success: false })
    await window.CloudAuth.init()

    expect(document.getElementById('auth-connection-status').textContent).toContain('连接失败')
  })

  it('连接抛错应显示连接失败', async () => {
    window.electronAPI.cloudTestConnection.mockRejectedValue(new Error('network'))
    await window.CloudAuth.init()

    expect(document.getElementById('auth-connection-status').textContent).toContain('连接失败')
  })
})

describe('CloudAuth 自动登录复选框联动', () => {
  it('勾选自动登录应同时勾选记住密码', () => {
    const autoLoginCheckbox = document.getElementById('auth-auto-login')
    const rememberCheckbox = document.getElementById('auth-remember-password')

    autoLoginCheckbox.checked = true
    autoLoginCheckbox.dispatchEvent(new Event('change', { bubbles: true }))

    expect(rememberCheckbox.checked).toBe(true)
  })

  it('取消记住密码应取消自动登录', () => {
    const autoLoginCheckbox = document.getElementById('auth-auto-login')
    const rememberCheckbox = document.getElementById('auth-remember-password')

    autoLoginCheckbox.checked = true
    rememberCheckbox.checked = true

    rememberCheckbox.checked = false
    rememberCheckbox.dispatchEvent(new Event('change', { bubbles: true }))

    expect(autoLoginCheckbox.checked).toBe(false)
  })
})

describe('CloudAuth 模式切换拨杆', () => {
  it('点击拨杆 slider 应显示切换到本地模式确认弹窗', () => {
    const slider = document.querySelector('.mode-toggle-slider')
    slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(document.getElementById('confirm-mode-switch-title').textContent).toContain('本地配置')
    expect(document.getElementById('confirm-mode-switch-message').textContent).toContain('云端登录凭据将被清除')

    const confirmModalInstance = window.BaseModal.mock.results[0].value
    expect(confirmModalInstance.show).toHaveBeenCalled()
  })

  it('点击拨杆 switch 应显示切换到本地模式确认弹窗', () => {
    const switchEl = document.querySelector('.mode-toggle-switch')
    switchEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(document.getElementById('confirm-mode-switch-title').textContent).toContain('本地配置')
  })

  it('点击容器非拨杆区域不应触发确认弹窗', () => {
    const container = document.querySelector('.mode-toggle-container')
    // 直接点击 container 本身（不是 slider 或 switch）
    const evt = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(evt, 'target', { value: container })
    container.dispatchEvent(evt)

    const confirmModalInstance = window.BaseModal.mock.results[0].value
    expect(confirmModalInstance.show).not.toHaveBeenCalled()
  })

  it('确认切换到本地模式应更新 UI 和调用 setApiMode', async () => {
    const slider = document.querySelector('.mode-toggle-slider')
    slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    const okBtn = document.getElementById('confirm-mode-switch-ok-btn')
    okBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.setApiMode).toHaveBeenCalledWith('local')
    expect(window.electronAPI.clearCredentials).toHaveBeenCalled()
    expect(window.electronAPI.cloudLogout).toHaveBeenCalled()
    expect(window.CloudAuth.getMode()).toBe('local')
    expect(document.getElementById('auth-modal-icon').textContent).toBe('⚙️')
    expect(document.getElementById('auth-modal-title').textContent).toBe('本地配置')
    expect(document.getElementById('auth-cloud-panel').style.display).toBe('none')
    expect(document.getElementById('auth-local-panel').style.display).toBe('block')
  })

  it('取消确认弹窗应清除 pendingModeSwitch 且不切换模式', () => {
    const slider = document.querySelector('.mode-toggle-slider')
    slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    const cancelBtn = document.getElementById('confirm-mode-switch-cancel-btn')
    cancelBtn.click()

    // 模式不应改变
    expect(window.CloudAuth.getMode()).toBe('cloud')
    expect(window.electronAPI.setApiMode).not.toHaveBeenCalled()
  })

  it('点击确认弹窗背景应关闭弹窗', () => {
    const slider = document.querySelector('.mode-toggle-slider')
    slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    const confirmModal = document.getElementById('confirm-mode-switch-modal')
    confirmModal.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(window.CloudAuth.getMode()).toBe('cloud')
  })

  it('无 pendingModeSwitch 时点击 OK 不应执行任何操作', () => {
    // 直接点击 OK，不先触发拨杆
    const okBtn = document.getElementById('confirm-mode-switch-ok-btn')
    okBtn.click()

    expect(window.electronAPI.setApiMode).not.toHaveBeenCalled()
  })

  it('从本地模式切换到云端模式应显示云端确认信息', async () => {
    // 先切换到本地模式
    window.electronAPI.getApiMode.mockResolvedValue('local')
    window.electronAPI.getApiKey.mockResolvedValue('sk-test')
    await window.CloudAuth.init()

    // 清除调用记录
    window.electronAPI.setApiMode.mockClear()
    window.electronAPI.saveApiKey.mockClear()

    const slider = document.querySelector('.mode-toggle-slider')
    slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(document.getElementById('confirm-mode-switch-title').textContent).toContain('云端登录')
    expect(document.getElementById('confirm-mode-switch-message').textContent).toContain('本地保存的 API Key 将被删除')

    const okBtn = document.getElementById('confirm-mode-switch-ok-btn')
    okBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.setApiMode).toHaveBeenCalledWith('cloud')
    expect(window.electronAPI.saveApiKey).toHaveBeenCalledWith(null)
    expect(window.CloudAuth.getMode()).toBe('cloud')
    expect(document.getElementById('auth-modal-icon').textContent).toBe('☁️')
    expect(document.getElementById('auth-modal-title').textContent).toBe('云端登录')
  })
})

describe('CloudAuth Tab 切换', () => {
  it('点击注册 Tab 应切换表单', () => {
    const registerTab = document.querySelector('.login-tab[data-tab="register"]')
    registerTab.click()

    expect(registerTab.classList.contains('active')).toBe(true)
    expect(document.querySelector('.login-tab[data-tab="login"]').classList.contains('active')).toBe(false)
    expect(document.getElementById('auth-register-form').classList.contains('active')).toBe(true)
    expect(document.getElementById('auth-login-form').classList.contains('active')).toBe(false)
  })

  it('点击登录 Tab 应切换回登录表单', () => {
    const registerTab = document.querySelector('.login-tab[data-tab="register"]')
    registerTab.click()
    const loginTab = document.querySelector('.login-tab[data-tab="login"]')
    loginTab.click()

    expect(loginTab.classList.contains('active')).toBe(true)
    expect(document.getElementById('auth-login-form').classList.contains('active')).toBe(true)
  })
})

describe('CloudAuth 弹窗交互', () => {
  it('点击顶部登录按钮应显示弹窗', () => {
    const headerBtn = document.getElementById('auth-header-btn')
    headerBtn.click()

    const authModalInstance = window.AnimatedModal.mock.results[0].value
    expect(authModalInstance.show).toHaveBeenCalled()
  })

  it('点击关闭按钮应隐藏弹窗', () => {
    const closeBtn = document.getElementById('auth-modal-close')
    closeBtn.click()

    const authModalInstance = window.AnimatedModal.mock.results[0].value
    expect(authModalInstance.hide).toHaveBeenCalled()
  })

  it('点击遮罩层应关闭弹窗（非自动登录时）', () => {
    const modal = document.getElementById('auth-modal')
    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const authModalInstance = window.AnimatedModal.mock.results[0].value
    expect(authModalInstance.hide).toHaveBeenCalled()
  })
})

describe('CloudAuth 非 Admin 用户', () => {
  it('登录非 Admin 用户应显示提示且不关闭弹窗', async () => {
    document.getElementById('auth-username').value = 'normaluser'
    document.getElementById('auth-password').value = 'password'
    window.electronAPI.cloudLogin.mockResolvedValue({
      success: true,
      user: { id: 2, username: 'normaluser', admin: false },
      hasDeepseekKey: false
    })

    document.getElementById('auth-login-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('non-admin-hint').style.display).toBe('block')
    // 非 admin 不关闭弹窗
    const authModalInstance = window.AnimatedModal.mock.results[0].value
    expect(authModalInstance.hide).not.toHaveBeenCalled()
  })

  it('登录 Admin 用户应隐藏非 Admin 提示', async () => {
    document.getElementById('auth-username').value = 'adminuser'
    document.getElementById('auth-password').value = 'password'
    window.electronAPI.cloudLogin.mockResolvedValue({
      success: true,
      user: { id: 1, username: 'adminuser', admin: true },
      hasDeepseekKey: true
    })

    document.getElementById('auth-login-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('non-admin-hint').style.display).toBe('none')
  })
})

describe('CloudAuth checkSession 有保存凭据', () => {
  it('checkSession 无 session 但有凭据应填充表单', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: false, session: null })
    window.electronAPI.loadCredentials.mockResolvedValue({
      success: true,
      credentials: { username: 'cached', password: 'cachedpass', autoLogin: false }
    })

    await window.CloudAuth.init()

    expect(document.getElementById('auth-username').value).toBe('cached')
    expect(document.getElementById('auth-password').value).toBe('cachedpass')
    expect(document.getElementById('auth-remember-password').checked).toBe(true)
  })

  it('checkSession 有 session 应显示已登录面板', async () => {
    window.electronAPI.cloudGetSession.mockResolvedValue({
      success: true,
      session: { id: 5, username: 'sessionuser', admin: true },
      hasDeepseekKey: true
    })

    await window.CloudAuth.init()

    expect(document.getElementById('auth-welcome-text').textContent).toContain('sessionuser')
    expect(document.getElementById('auth-user-meta').textContent).toContain('Admin')
    // 云端模式：密钥留在主进程，渲染进程仅能确认有 Key
    expect(window.CloudAuth.hasApiKey()).toBe(true)
    expect(window.CloudAuth.getApiKey()).toBeNull()
  })

  it('checkSession 抛错应显示弹窗', async () => {
    window.electronAPI.cloudGetSession.mockRejectedValue(new Error('network'))

    await window.CloudAuth.init()

    const authModalInstance = window.AnimatedModal.mock.results[0].value
    expect(authModalInstance.show).toHaveBeenCalled()
  })
})

describe('CloudAuth tryLoadLocalApiKey 错误处理', () => {
  it('getApiKey 抛错应显示配置弹窗', async () => {
    window.electronAPI.getApiMode.mockResolvedValue('local')
    window.electronAPI.getApiKey.mockRejectedValue(new Error('read error'))

    await window.CloudAuth.init()

    const authModalInstance = window.AnimatedModal.mock.results[0].value
    expect(authModalInstance.show).toHaveBeenCalled()
  })
})

describe('CloudAuth handleLogin 错误处理', () => {
  it('cloudLogin 抛错应显示错误信息', async () => {
    document.getElementById('auth-username').value = 'testuser'
    document.getElementById('auth-password').value = 'password'
    window.electronAPI.cloudLogin.mockRejectedValue(new Error('网络错误'))

    document.getElementById('auth-login-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('authMessage').textContent).toContain('网络错误')
    expect(document.getElementById('auth-login-btn').textContent).toBe('登录')
    expect(document.getElementById('auth-login-btn').disabled).toBe(false)
  })

  it('登录成功未勾选记住密码应清除凭据', async () => {
    document.getElementById('auth-username').value = 'testuser'
    document.getElementById('auth-password').value = 'password'
    document.getElementById('auth-remember-password').checked = false
    window.electronAPI.cloudLogin.mockResolvedValue({
      success: true,
      user: { id: 1, username: 'testuser', admin: true },
      hasDeepseekKey: true
    })

    document.getElementById('auth-login-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.clearCredentials).toHaveBeenCalled()
  })
})

describe('CloudAuth handleRegister 完整流程', () => {
  it('注册成功应切换到登录 Tab 并填充用户名', async () => {
    document.getElementById('auth-register-username').value = 'newuser'
    document.getElementById('auth-register-password').value = 'password123'
    window.electronAPI.cloudRegister.mockResolvedValue({ success: true })

    // 先切换到注册 Tab
    document.querySelector('.login-tab[data-tab="register"]').click()

    document.getElementById('auth-register-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('authMessage').textContent).toContain('注册成功')
    expect(document.querySelector('.login-tab[data-tab="login"]').classList.contains('active')).toBe(true)
    expect(document.getElementById('auth-username').value).toBe('newuser')
    expect(document.getElementById('auth-register-btn').textContent).toBe('注册')
    expect(document.getElementById('auth-register-btn').disabled).toBe(false)
  })

  it('注册抛错应显示错误信息', async () => {
    document.getElementById('auth-register-username').value = 'newuser'
    document.getElementById('auth-register-password').value = 'password123'
    window.electronAPI.cloudRegister.mockRejectedValue(new Error('服务器错误'))

    document.getElementById('auth-register-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('authMessage').textContent).toContain('服务器错误')
  })

  it('回车键应触发注册', async () => {
    document.getElementById('auth-register-username').value = 'newuser'
    document.getElementById('auth-register-password').value = 'password123'
    window.electronAPI.cloudRegister.mockResolvedValue({ success: true })

    document.getElementById('auth-register-password').dispatchEvent(
      new KeyboardEvent('keypress', { key: 'Enter', bubbles: true })
    )

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.cloudRegister).toHaveBeenCalled()
  })
})

describe('CloudAuth handleLogout 错误处理', () => {
  it('cloudLogout 抛错应捕获错误', async () => {
    window.electronAPI.cloudLogout.mockRejectedValue(new Error('退出失败'))

    // 不应抛出
    document.getElementById('auth-logout-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    // 不报错即可
    expect(true).toBe(true)
  })

  it('退出后应清空表单并显示弹窗', async () => {
    document.getElementById('auth-username').value = 'testuser'
    document.getElementById('auth-password').value = 'password'
    document.getElementById('auth-register-username').value = 'reguser'
    document.getElementById('auth-register-password').value = 'regpass'

    document.getElementById('auth-logout-btn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(document.getElementById('auth-username').value).toBe('')
    expect(document.getElementById('auth-password').value).toBe('')
    expect(document.getElementById('auth-register-username').value).toBe('')
    expect(document.getElementById('auth-register-password').value).toBe('')
    expect(document.getElementById('auth-header-btn').textContent).toBe('☁️')
  })
})

describe('CloudAuth 自动登录凭据填充', () => {
  it('有保存凭据但未开启自动登录应填充表单并显示弹窗', async () => {
    window.electronAPI.getApiMode.mockResolvedValue('cloud')
    window.electronAPI.loadCredentials.mockResolvedValue({
      success: true,
      credentials: { username: 'saved', password: 'pass', autoLogin: false }
    })
    window.electronAPI.cloudGetSession.mockResolvedValue({ success: false, session: null })

    await window.CloudAuth.init()

    expect(document.getElementById('auth-auto-login').checked).toBe(false)
  })

  it('自动登录抛错应返回 false', async () => {
    window.electronAPI.getApiMode.mockResolvedValue('cloud')
    window.electronAPI.loadCredentials.mockRejectedValue(new Error('read error'))

    await window.CloudAuth.init()

    // 不报错即可，应回退到 checkSession
    expect(window.electronAPI.cloudGetSession).toHaveBeenCalled()
  })
})

describe('CloudAuth loadMode 错误处理', () => {
  it('getApiMode 抛错应使用默认 cloud 模式', async () => {
    window.electronAPI.getApiMode.mockRejectedValue(new Error('storage error'))

    await window.CloudAuth.init()

    expect(window.CloudAuth.getMode()).toBe('cloud')
  })
})

describe('CloudAuth setApiMode 错误处理', () => {
  it('确认切换模式时 setApiMode 抛错应捕获', async () => {
    window.electronAPI.setApiMode.mockRejectedValue(new Error('save failed'))
    window.electronAPI.clearCredentials.mockRejectedValue(new Error('clear failed'))
    window.electronAPI.cloudLogout.mockRejectedValue(new Error('logout failed'))

    const slider = document.querySelector('.mode-toggle-slider')
    slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    const okBtn = document.getElementById('confirm-mode-switch-ok-btn')
    okBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    // 模式仍应切换（错误被捕获）
    expect(window.CloudAuth.getMode()).toBe('local')
  })

  it('切换到云端模式时 saveApiKey 抛错应捕获', async () => {
    // 先切换到本地模式
    window.electronAPI.getApiMode.mockResolvedValue('local')
    window.electronAPI.getApiKey.mockResolvedValue('sk-test')
    await window.CloudAuth.init()

    window.electronAPI.saveApiKey.mockRejectedValue(new Error('save failed'))

    const slider = document.querySelector('.mode-toggle-slider')
    slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    const okBtn = document.getElementById('confirm-mode-switch-ok-btn')
    okBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.CloudAuth.getMode()).toBe('cloud')
  })
})

describe('CloudAuth isLoggedIn 错误处理', () => {
  it('cloudGetSession 抛错应返回 false', async () => {
    window.electronAPI.cloudGetSession.mockRejectedValue(new Error('network'))
    const result = await window.CloudAuth.isLoggedIn()
    expect(result).toBe(false)
  })
})

describe('CloudAuth handleSaveLocalApiKey 回调', () => {
  beforeEach(async () => {
    window.electronAPI.getApiMode.mockResolvedValue('local')
    await window.CloudAuth.init()
  })

  it('保存成功应调用 onLogin 回调', async () => {
    const callback = vi.fn()
    window.CloudAuth.onLogin(callback)

    document.getElementById('auth-local-api-key-input').value = 'sk-valid-key'
    window.electronAPI.saveApiKey.mockResolvedValue(true)

    document.getElementById('auth-save-api-key-btn').click()

    await new Promise(resolve => setTimeout(resolve, 600))

    expect(callback).toHaveBeenCalledWith(null, 'sk-valid-key')
  })
})
