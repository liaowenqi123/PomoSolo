/**
 * API 配置管理模块 - 渲染进程
 * 支持两种模式：
 * - 云端登录模式：通过 Supabase 登录获取 API Key（仅内存）
 * - 本地配置模式：手动输入 API Key 并持久化存储
 * 
 * 两种模式互斥：
 * - 切换到云端模式：删除本地 API Key
 * - 切换到本地模式：清除云端登录凭据
 */

const CloudAuth = (function() {
  'use strict'

  let elements = {}
  let confirmElements = {}
  let onLoginCallback = null
  let currentDeepseekKey = null  // 内存中保存 API Key
  let isAutoLoggingIn = false    // 是否正在自动登录
  let currentMode = 'cloud'      // 当前模式：'cloud' | 'local'
  let pendingModeSwitch = null   // 待确认的模式切换

  /**
   * 初始化
   */
  async function init() {
    bindElements()
    bindEvents()
    
    // 先加载保存的模式
    await loadMode()
    
    // 测试云端连接
    testConnection()
    
    // 根据模式初始化
    if (currentMode === 'local') {
      // 本地模式：尝试加载本地保存的 API Key
      await tryLoadLocalApiKey()
    } else {
      // 云端模式：尝试自动登录
      const autoLoggedIn = await tryAutoLogin()
      if (!autoLoggedIn) {
        await checkSession()
      }
    }
  }

  /**
   * 加载保存的模式
   */
  async function loadMode() {
    if (!window.electronAPI) return
    
    try {
      const mode = await window.electronAPI.getApiMode()
      currentMode = mode || 'cloud'
      updateModeUI()
    } catch (err) {
      console.error('[CloudAuth] 加载模式失败:', err)
    }
  }

  /**
   * 更新模式切换 UI（拨杆）
   */
  function updateModeUI() {
    const modeToggle = document.getElementById('mode-toggle')
    const modeLabelCloud = document.getElementById('mode-label-cloud')
    const modeLabelLocal = document.getElementById('mode-label-local')
    
    if (modeToggle) {
      // local 模式时 checkbox 为 checked
      modeToggle.checked = (currentMode === 'local')
    }
    
    // 更新标签高亮
    if (modeLabelCloud) {
      modeLabelCloud.classList.toggle('active', currentMode === 'cloud')
    }
    if (modeLabelLocal) {
      modeLabelLocal.classList.toggle('active', currentMode === 'local')
    }
    
    // 切换面板显示
    const cloudPanel = document.getElementById('auth-cloud-panel')
    const localPanel = document.getElementById('auth-local-panel')
    const modalIcon = document.getElementById('auth-modal-icon')
    const modalTitle = document.getElementById('auth-modal-title')
    
    if (currentMode === 'local') {
      if (cloudPanel) cloudPanel.style.display = 'none'
      if (localPanel) localPanel.style.display = 'block'
      if (modalIcon) modalIcon.textContent = '⚙️'
      if (modalTitle) modalTitle.textContent = '本地配置'
    } else {
      if (cloudPanel) cloudPanel.style.display = 'block'
      if (localPanel) localPanel.style.display = 'none'
      if (modalIcon) modalIcon.textContent = '☁️'
      if (modalTitle) modalTitle.textContent = '云端登录'
    }
  }

  /**
   * 尝试加载本地保存的 API Key
   */
  async function tryLoadLocalApiKey() {
    if (!window.electronAPI) return
    
    try {
      const apiKey = await window.electronAPI.getApiKey()
      if (apiKey) {
        currentDeepseekKey = apiKey
        // 填充输入框
        const input = document.getElementById('auth-local-api-key-input')
        if (input) input.value = apiKey
        
        // 隐藏弹窗
        hideModal(false)
        
        // 调用回调
        if (onLoginCallback) {
          onLoginCallback(null, apiKey)
        }
        
        // 更新顶部按钮
        if (elements.loginHeaderBtn) {
          elements.loginHeaderBtn.textContent = '🔑'
          elements.loginHeaderBtn.title = '本地配置模式'
        }
        
        console.log('[CloudAuth] 已加载本地 API Key')
      } else {
        // 没有保存的 API Key，显示配置弹窗
        showModal(false)
      }
    } catch (err) {
      console.error('[CloudAuth] 加载本地 API Key 失败:', err)
      showModal(false)
    }
  }

  /**
   * 绑定元素
   */
  function bindElements() {
    elements = {
      modal: document.getElementById('auth-modal'),
      modalClose: document.getElementById('auth-modal-close'),
      authPanel: document.getElementById('authPanel'),
      loggedInPanel: document.getElementById('auth-logged-in-panel'),
      welcomeText: document.getElementById('auth-welcome-text'),
      userMetaText: document.getElementById('auth-user-meta'),
      connectionStatus: document.getElementById('auth-connection-status'),
      authMessage: document.getElementById('authMessage'),
      // 登录表单
      loginUsername: document.getElementById('auth-username'),
      loginPassword: document.getElementById('auth-password'),
      rememberPassword: document.getElementById('auth-remember-password'),
      autoLogin: document.getElementById('auth-auto-login'),
      loginBtn: document.getElementById('auth-login-btn'),
      // 注册表单
      registerUsername: document.getElementById('auth-register-username'),
      registerPassword: document.getElementById('auth-register-password'),
      registerBtn: document.getElementById('auth-register-btn'),
      // 退出按钮
      logoutBtn: document.getElementById('auth-logout-btn'),
      // 顶部登录按钮
      loginHeaderBtn: document.getElementById('auth-header-btn'),
      // 本地配置相关
      localApiKeyInput: document.getElementById('auth-local-api-key-input'),
      showApiKey: document.getElementById('auth-show-api-key'),
      saveLocalApiKeyBtn: document.getElementById('auth-save-api-key-btn'),
      localConfigMessage: document.getElementById('auth-local-message'),
      deepseekLink: document.getElementById('auth-deepseek-link'),
      // 模式切换拨杆
      modeToggle: document.getElementById('mode-toggle')
    }
    
    // 确认弹窗元素
    confirmElements = {
      modal: document.getElementById('confirm-mode-switch-modal'),
      icon: document.getElementById('confirm-mode-switch-icon'),
      title: document.getElementById('confirm-mode-switch-title'),
      message: document.getElementById('confirm-mode-switch-message'),
      cancelBtn: document.getElementById('confirm-mode-switch-cancel-btn'),
      okBtn: document.getElementById('confirm-mode-switch-ok-btn')
    }
  }

  /**
   * 绑定事件
   */
  function bindEvents() {
    // 顶部登录按钮
    if (elements.loginHeaderBtn) {
      elements.loginHeaderBtn.addEventListener('click', showModal)
    }

    // 关闭按钮
    if (elements.modalClose) {
      elements.modalClose.addEventListener('click', hideModal)
    }

    // 模式切换拨杆 - 监听 mousedown 事件在容器上
    const toggleContainer = document.querySelector('.mode-toggle-container')
    if (toggleContainer) {
      toggleContainer.addEventListener('mousedown', function(e) {
        // 只有点击拨杆本身才触发
        const toggle = elements.modeToggle
        if (!toggle) return
        
        // 检查是否点击的是拨杆区域（slider 或 checkbox）
        const isToggleClick = e.target === toggle || 
                              e.target.classList.contains('mode-toggle-slider') ||
                              e.target.closest('.mode-toggle-switch')
        
        if (!isToggleClick) return
        
        // 阻止默认行为
        e.preventDefault()
        
        // 计算目标模式
        const targetMode = currentMode === 'cloud' ? 'local' : 'cloud'
        
        // 保存待切换的模式
        pendingModeSwitch = targetMode
        
        // 显示确认弹窗
        if (targetMode === 'local') {
          showConfirmModal(
            '⚙️',
            '切换到本地配置模式',
            '切换后云端登录凭据将被清除，需要重新输入 API Key。\n确定要切换吗？'
          )
        } else {
          showConfirmModal(
            '☁️',
            '切换到云端登录模式',
            '切换后本地保存的 API Key 将被删除。\n确定要切换吗？'
          )
        }
      })
    }

    // Tab 切换（登录/注册）
    document.querySelectorAll('.login-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        
        const tabName = tab.dataset.tab
        document.querySelectorAll('.login-form').forEach(f => f.classList.remove('active'))
        document.getElementById('auth-' + tabName + '-form').classList.add('active')
        
        hideMessage()
      })
    })

    // 登录按钮
    if (elements.loginBtn) {
      elements.loginBtn.addEventListener('click', handleLogin)
    }

    // 注册按钮
    if (elements.registerBtn) {
      elements.registerBtn.addEventListener('click', handleRegister)
    }

    // 退出登录按钮
    if (elements.logoutBtn) {
      elements.logoutBtn.addEventListener('click', handleLogout)
    }

    // 回车键登录
    if (elements.loginPassword) {
      elements.loginPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin()
      })
    }

    // 回车键注册
    if (elements.registerPassword) {
      elements.registerPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleRegister()
      })
    }

    // 点击遮罩层关闭（仅非自动登录时可关闭）
    if (elements.modal) {
      elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal && !isAutoLoggingIn) {
          hideModal()
        }
      })
    }
    
    // 自动登录复选框联动
    if (elements.autoLogin) {
      elements.autoLogin.addEventListener('change', () => {
        if (elements.autoLogin.checked && elements.rememberPassword) {
          elements.rememberPassword.checked = true
        }
      })
    }
    
    // 取消记住密码时取消自动登录
    if (elements.rememberPassword) {
      elements.rememberPassword.addEventListener('change', () => {
        if (!elements.rememberPassword.checked && elements.autoLogin) {
          elements.autoLogin.checked = false
        }
      })
    }

    // 本地配置相关事件
    if (elements.saveLocalApiKeyBtn) {
      elements.saveLocalApiKeyBtn.addEventListener('click', handleSaveLocalApiKey)
    }

    if (elements.showApiKey) {
      elements.showApiKey.addEventListener('change', () => {
        const type = elements.showApiKey.checked ? 'text' : 'password'
        if (elements.localApiKeyInput) elements.localApiKeyInput.type = type
      })
    }

    // DeepSeek 链接
    if (elements.deepseekLink) {
      elements.deepseekLink.addEventListener('click', (e) => {
        e.preventDefault()
        if (window.electronAPI && window.electronAPI.openExternal) {
          window.electronAPI.openExternal('https://platform.deepseek.com')
        }
      })
    }

    // 回车键保存本地配置
    if (elements.localApiKeyInput) {
      elements.localApiKeyInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSaveLocalApiKey()
      })
    }

    // 确认弹窗事件
    if (confirmElements.cancelBtn) {
      confirmElements.cancelBtn.addEventListener('click', hideConfirmModal)
    }
    if (confirmElements.okBtn) {
      confirmElements.okBtn.addEventListener('click', confirmModeSwitch)
    }
    if (confirmElements.modal) {
      confirmElements.modal.addEventListener('click', (e) => {
        if (e.target === confirmElements.modal) {
          hideConfirmModal()
        }
      })
    }
  }

  /**
   * 显示确认弹窗
   */
  function showConfirmModal(icon, title, message) {
    // 展开侧边栏（如果收起状态）
    if (window.expandSidebarIfNeeded) {
      window.expandSidebarIfNeeded()
    }
    
    if (confirmElements.icon) confirmElements.icon.textContent = icon
    if (confirmElements.title) confirmElements.title.textContent = title
    if (confirmElements.message) confirmElements.message.textContent = message
    if (confirmElements.modal) {
      confirmElements.modal.classList.add('show')
    }
  }

  /**
   * 隐藏确认弹窗
   */
  function hideConfirmModal() {
    if (confirmElements.modal) {
      confirmElements.modal.classList.remove('show')
    }
    pendingModeSwitch = null
  }

  /**
   * 确认模式切换
   */
  function confirmModeSwitch() {
    if (!pendingModeSwitch) return
    
    const newMode = pendingModeSwitch
    
    // 立即隐藏确认弹窗
    hideConfirmModal()
    
    // 更新模式
    currentMode = newMode
    
    // 更新拨杆状态
    if (elements.modeToggle) {
      elements.modeToggle.checked = (currentMode === 'local')
    }
    
    // 更新标签高亮
    const modeLabelCloud = document.getElementById('mode-label-cloud')
    const modeLabelLocal = document.getElementById('mode-label-local')
    if (modeLabelCloud) {
      modeLabelCloud.classList.toggle('active', currentMode === 'cloud')
    }
    if (modeLabelLocal) {
      modeLabelLocal.classList.toggle('active', currentMode === 'local')
    }
    
    // 切换面板显示
    const cloudPanel = document.getElementById('auth-cloud-panel')
    const localPanel = document.getElementById('auth-local-panel')
    const modalIcon = document.getElementById('auth-modal-icon')
    const modalTitle = document.getElementById('auth-modal-title')
    
    if (currentMode === 'local') {
      if (cloudPanel) cloudPanel.style.display = 'none'
      if (localPanel) localPanel.style.display = 'block'
      if (modalIcon) modalIcon.textContent = '⚙️'
      if (modalTitle) modalTitle.textContent = '本地配置'
    } else {
      if (cloudPanel) cloudPanel.style.display = 'block'
      if (localPanel) localPanel.style.display = 'none'
      if (modalIcon) modalIcon.textContent = '☁️'
      if (modalTitle) modalTitle.textContent = '云端登录'
    }
    
    // 清空当前内存中的 API Key
    currentDeepseekKey = null
    
    // 清空输入框
    if (elements.localApiKeyInput) elements.localApiKeyInput.value = ''
    
    // 重置云端登录表单
    showAuthPanel()
    if (elements.loginUsername) elements.loginUsername.value = ''
    if (elements.loginPassword) elements.loginPassword.value = ''
    if (elements.rememberPassword) elements.rememberPassword.checked = false
    if (elements.autoLogin) elements.autoLogin.checked = false
    
    // 更新顶部按钮
    if (elements.loginHeaderBtn) {
      if (newMode === 'local') {
        elements.loginHeaderBtn.textContent = '🔑'
        elements.loginHeaderBtn.title = '本地配置模式'
      } else {
        elements.loginHeaderBtn.textContent = '☁️'
        elements.loginHeaderBtn.title = '云端登录'
      }
    }
    
    // 异步执行清理和保存操作（不阻塞 UI）
    if (window.electronAPI) {
      window.electronAPI.setApiMode(newMode).catch(err => 
        console.error('[CloudAuth] 保存模式失败:', err)
      )
      
      if (newMode === 'local') {
        window.electronAPI.clearCredentials().catch(err => 
          console.error('[CloudAuth] 清除凭据失败:', err)
        )
        window.electronAPI.cloudLogout().catch(err => 
          console.error('[CloudAuth] 退出登录失败:', err)
        )
      } else {
        window.electronAPI.saveApiKey(null).catch(err => 
          console.error('[CloudAuth] 清除 API Key 失败:', err)
        )
      }
    }
    
    console.log('[CloudAuth] 已切换到', newMode, '模式')
  }

  /**
   * 处理保存本地 API Key
   */
  async function handleSaveLocalApiKey() {
    const apiKey = elements.localApiKeyInput?.value.trim()

    if (!apiKey) {
      showLocalMessage('请输入 API Key', 'error')
      return
    }

    if (!apiKey.startsWith('sk-')) {
      showLocalMessage('API Key 格式不正确，应以 sk- 开头', 'error')
      return
    }

    elements.saveLocalApiKeyBtn.disabled = true
    elements.saveLocalApiKeyBtn.textContent = '保存中...'

    try {
      const success = await window.electronAPI.saveApiKey(apiKey)
      
      if (success) {
        currentDeepseekKey = apiKey
        showLocalMessage('配置成功！', 'success')
        
        // 隐藏弹窗
        setTimeout(() => {
          hideModal()
        }, 500)
        
        // 调用回调
        if (onLoginCallback) {
          onLoginCallback(null, apiKey)
        }
        
        // 更新顶部按钮
        if (elements.loginHeaderBtn) {
          elements.loginHeaderBtn.textContent = '🔑'
          elements.loginHeaderBtn.title = '本地配置模式'
        }
      } else {
        showLocalMessage('保存失败', 'error')
      }
    } catch (err) {
      showLocalMessage('保存失败: ' + err.message, 'error')
    } finally {
      elements.saveLocalApiKeyBtn.disabled = false
      elements.saveLocalApiKeyBtn.textContent = '保存配置'
    }
  }

  /**
   * 显示本地配置消息
   */
  function showLocalMessage(text, type) {
    if (elements.localConfigMessage) {
      elements.localConfigMessage.textContent = text
      elements.localConfigMessage.className = 'login-message ' + type
    }
  }

  /**
   * 测试连接
   */
  async function testConnection() {
    if (!window.electronAPI) return

    try {
      const result = await window.electronAPI.cloudTestConnection()
      if (result.success) {
        elements.connectionStatus.textContent = '● 已连接'
        elements.connectionStatus.className = 'connection-status connected'
      } else {
        elements.connectionStatus.textContent = '● 连接失败'
        elements.connectionStatus.className = 'connection-status disconnected'
      }
    } catch (err) {
      elements.connectionStatus.textContent = '● 连接失败'
      elements.connectionStatus.className = 'connection-status disconnected'
    }
  }

  /**
   * 尝试自动登录
   * @returns {boolean} 是否成功自动登录
   */
  async function tryAutoLogin() {
    if (!window.electronAPI) return false

    try {
      // 加载保存的凭据
      const result = await window.electronAPI.loadCredentials()
      if (!result.success || !result.credentials) {
        return false
      }

      const { username, password, autoLogin: savedAutoLogin } = result.credentials

      // 检查是否启用了自动登录
      if (!savedAutoLogin || !username || !password) {
        // 如果有保存的用户名密码但没有自动登录，填充表单
        if (username && password) {
          elements.loginUsername.value = username
          elements.loginPassword.value = password
          elements.rememberPassword.checked = true
          elements.autoLogin.checked = savedAutoLogin || false
        }
        return false
      }

      // 执行自动登录
      isAutoLoggingIn = true
      console.log('[CloudAuth] 尝试自动登录:', username)

      const loginResult = await window.electronAPI.cloudLogin({ username, password })

      if (loginResult.success) {
        console.log('[CloudAuth] 自动登录成功')
        currentDeepseekKey = loginResult.deepseekKey
        
        // 更新 UI（无动画关闭弹窗）
        showLoggedInPanel(loginResult.user, loginResult.deepseekKey, false)
        
        // 调用回调
        if (onLoginCallback) {
          onLoginCallback(loginResult.user, loginResult.deepseekKey)
        }
        
        return true
      } else {
        console.log('[CloudAuth] 自动登录失败:', loginResult.error)
        // 自动登录失败，显示登录界面并填充用户名密码
        elements.loginUsername.value = username
        elements.loginPassword.value = password
        elements.rememberPassword.checked = true
        elements.autoLogin.checked = false
        
        // 显示登录弹窗（无动画）
        showModal(false)
        showMessage('自动登录失败，请重新登录', 'error')
        
        // 清除无效凭据
        await window.electronAPI.clearCredentials()
        
        return false
      }
    } catch (err) {
      console.error('[CloudAuth] 自动登录异常:', err)
      return false
    } finally {
      isAutoLoggingIn = false
    }
  }

  /**
   * 检查会话
   */
  async function checkSession() {
    if (!window.electronAPI) return

    try {
      const result = await window.electronAPI.cloudGetSession()
      if (result.success && result.session) {
        showLoggedInPanel(result.session, result.deepseekKey, false)
        // 获取 API Key（内存中）
        currentDeepseekKey = result.deepseekKey
      } else {
        // 没有会话，检查是否有保存的凭据
        const credResult = await window.electronAPI.loadCredentials()
        if (credResult.success && credResult.credentials) {
          const { username, password, autoLogin } = credResult.credentials
          if (username) elements.loginUsername.value = username
          if (password) elements.loginPassword.value = password
          if (password) elements.rememberPassword.checked = true
          if (autoLogin) elements.autoLogin.checked = autoLogin
        }
        // 显示登录弹窗（无动画，因为是初始加载）
        showModal(false)
      }
    } catch (err) {
      console.error('检查会话失败:', err)
      showModal(false)
    }
  }

  /**
   * 显示弹窗
   * @param {boolean} withAnimation - 是否显示动画（默认true）
   */
  function showModal(withAnimation = true) {
    // 展开侧边栏（如果收起状态）
    if (window.expandSidebarIfNeeded) {
      window.expandSidebarIfNeeded()
    }
    
    if (elements.modal) {
      if (withAnimation) {
        elements.modal.classList.add('show')
      } else {
        // 无动画显示：直接设置为显示状态，跳过动画
        elements.modal.classList.add('show', 'no-animation')
      }
    }
  }

  /**
   * 隐藏弹窗
   * @param {boolean} withAnimation - 是否显示动画（默认true）
   */
  function hideModal(withAnimation = true) {
    if (elements.modal) {
      if (withAnimation) {
        // 有动画：先移除show，添加hiding，等动画完成后移除hiding
        elements.modal.classList.remove('show')
        elements.modal.classList.add('hiding')
        
        setTimeout(() => {
          elements.modal.classList.remove('hiding', 'no-animation')
        }, 500)
      } else {
        // 无动画：直接移除所有类
        elements.modal.classList.remove('show', 'hiding', 'no-animation')
      }
    }
  }

  /**
   * 显示消息
   */
  function showMessage(text, type) {
    if (elements.authMessage) {
      elements.authMessage.textContent = text
      elements.authMessage.className = 'login-message ' + type
    }
  }

  /**
   * 隐藏消息
   */
  function hideMessage() {
    if (elements.authMessage) {
      elements.authMessage.className = 'login-message'
    }
  }

  /**
   * 显示登录面板
   */
  function showAuthPanel() {
    elements.authPanel.style.display = 'block'
    elements.loggedInPanel.style.display = 'none'
  }

  /**
   * 显示已登录面板
   * @param {boolean} hideWithAnimation - 是否用动画隐藏弹窗（默认true）
   */
  function showLoggedInPanel(user, deepseekKey = null, hideWithAnimation = true) {
    elements.authPanel.style.display = 'none'
    elements.loggedInPanel.style.display = 'block'
    
    elements.welcomeText.textContent = `欢迎, ${user.username}!`
    
    let metaText = `ID: ${user.id}`
    if (user.admin) {
      metaText += ' | Admin'
    }
    elements.userMetaText.textContent = metaText

    // 保存 API Key 到内存（不显示）
    currentDeepseekKey = deepseekKey

    // 更新顶部按钮
    if (elements.loginHeaderBtn) {
      elements.loginHeaderBtn.textContent = '👤'
      elements.loginHeaderBtn.title = user.username
    }
    
    // 隐藏弹窗
    hideModal(hideWithAnimation)
  }

  /**
   * 处理登录
   */
  async function handleLogin() {
    const username = elements.loginUsername?.value.trim()
    const password = elements.loginPassword?.value
    const rememberPassword = elements.rememberPassword?.checked
    const autoLogin = elements.autoLogin?.checked

    if (!username || !password) {
      showMessage('请填写所有字段', 'error')
      return
    }

    elements.loginBtn.disabled = true
    elements.loginBtn.textContent = '登录中...'

    try {
      const result = await window.electronAPI.cloudLogin({ username, password })

      if (result.success) {
        showMessage('登录成功！', 'success')
        showLoggedInPanel(result.user, result.deepseekKey)
        
        // 保存凭据（如果勾选了记住密码）
        if (rememberPassword) {
          await window.electronAPI.saveCredentials({
            username,
            password,
            autoLogin: autoLogin
          })
        } else {
          // 清除之前保存的凭据
          await window.electronAPI.clearCredentials()
        }
        
        // 调用回调
        if (onLoginCallback) {
          onLoginCallback(result.user, result.deepseekKey)
        }
      } else {
        showMessage('登录失败: ' + result.error, 'error')
      }
    } catch (err) {
      showMessage('登录失败: ' + err.message, 'error')
    } finally {
      elements.loginBtn.disabled = false
      elements.loginBtn.textContent = '登录'
    }
  }

  /**
   * 处理注册
   */
  async function handleRegister() {
    const username = elements.registerUsername?.value.trim()
    const password = elements.registerPassword?.value

    if (!username || !password) {
      showMessage('请填写所有字段', 'error')
      return
    }

    if (username.length < 2) {
      showMessage('用户名至少需要2个字符', 'error')
      return
    }

    if (password.length < 6) {
      showMessage('密码至少需要6位', 'error')
      return
    }

    elements.registerBtn.disabled = true
    elements.registerBtn.textContent = '注册中...'

    try {
      const result = await window.electronAPI.cloudRegister({ username, password })

      if (result.success) {
        showMessage('注册成功！请登录', 'success')
        // 切换到登录 Tab
        document.querySelector('.login-tab[data-tab="login"]').click()
        elements.loginUsername.value = username
        elements.loginPassword.focus()
      } else {
        showMessage('注册失败: ' + result.error, 'error')
      }
    } catch (err) {
      showMessage('注册失败: ' + err.message, 'error')
    } finally {
      elements.registerBtn.disabled = false
      elements.registerBtn.textContent = '注册'
    }
  }

  /**
   * 处理退出登录
   */
  async function handleLogout() {
    // 检查番茄钟是否在运行
    if (window.Timer && window.Timer.getIsRunning && window.Timer.getIsRunning()) {
      showMessage('请先停止番茄钟再退出登录', 'error')
      return
    }
    
    // 检查前台检测是否在运行
    if (window.ForegroundDetection && window.ForegroundDetection.getIsDetecting && window.ForegroundDetection.getIsDetecting()) {
      showMessage('前台检测正在运行，请稍后再试', 'error')
      return
    }
    
    try {
      await window.electronAPI.cloudLogout()
      currentDeepseekKey = null
      showAuthPanel()
      
      // 清除保存的凭据
      await window.electronAPI.clearCredentials()
      
      // 清空表单
      elements.loginUsername.value = ''
      elements.loginPassword.value = ''
      elements.rememberPassword.checked = false
      elements.autoLogin.checked = false
      elements.registerUsername.value = ''
      elements.registerPassword.value = ''
      
      // 更新顶部按钮
      if (elements.loginHeaderBtn) {
        elements.loginHeaderBtn.textContent = '☁️'
        elements.loginHeaderBtn.title = '云端登录'
      }
      
      // 显示登录弹窗
      showModal()
    } catch (err) {
      console.error('退出登录失败:', err)
    }
  }

  /**
   * 设置登录回调
   */
  function onLogin(callback) {
    onLoginCallback = callback
  }

  /**
   * 检查是否已登录
   */
  async function isLoggedIn() {
    if (!window.electronAPI) return false
    
    try {
      const result = await window.electronAPI.cloudGetSession()
      return result.success && result.session
    } catch {
      return false
    }
  }

  /**
   * 获取当前 API Key（内存中）
   */
  function getApiKey() {
    return currentDeepseekKey
  }

  /**
   * 检查是否有有效的 API Key
   */
  function hasApiKey() {
    return currentDeepseekKey !== null
  }

  /**
   * 获取当前模式
   */
  function getMode() {
    return currentMode
  }

  return {
    init,
    showModal,
    hideModal,
    onLogin,
    isLoggedIn,
    getApiKey,
    hasApiKey,
    getMode
  }
})()

// 暴露到全局
window.CloudAuth = CloudAuth
