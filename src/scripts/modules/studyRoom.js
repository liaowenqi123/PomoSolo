/**
 * 自习室模块
 * 管理自习室的创建和加入功能
 */

const StudyRoom = {
  // 最小专注时间要求（分钟）
  CREATE_REQUIREMENT: 10,
  JOIN_REQUIREMENT: 15,
  
  // 弹窗实例
  modal: null,
  
  // 当前加入的自习室
  currentRoomId: null,
  currentRoomName: null,
  
  // 心跳定时器
  heartbeatInterval: null,
  
  // 刷新定时器
  refreshInterval: null,

  /**
   * 初始化自习室模块
   */
  async init() {
    console.log('[StudyRoom] 初始化自习室模块');
    
    // 确保按钮可见（防止被设置隐藏）
    const studyRoomBtn = document.getElementById('ui-study-room-btn');
    if (studyRoomBtn) {
      // 检查设置中是否有 showStudyRoomBtn
      const settings = window.Settings ? window.Settings.getSetting('showStudyRoomBtn') : true;
      if (settings !== false) {
        studyRoomBtn.style.display = '';
      }
      console.log('[StudyRoom] 自习室按钮:', studyRoomBtn, '显示状态:', studyRoomBtn.style.display);
    } else {
      console.warn('[StudyRoom] 未找到自习室按钮元素');
    }
    
    // 恢复上次的自习室状态
    await this.restoreRoomState();
    
    this.initModal();
    this.bindEvents();
    this.updateRequirements();
  },

  /**
   * 初始化弹窗实例
   */
  initModal() {
    const modalElement = document.getElementById('study-room-modal');
    if (modalElement && typeof AnimatedModal !== 'undefined') {
      this.modal = new AnimatedModal({
        element: modalElement,
        showClass: 'active',
        hidingClass: 'closing',
        closeOnBackground: true,
        animationDuration: 300
      });
      console.log('[StudyRoom] AnimatedModal 实例已创建');
    } else if (modalElement && typeof BaseModal !== 'undefined') {
      this.modal = new BaseModal({
        element: modalElement,
        showClass: 'active',
        closeOnBackground: true
      });
      console.log('[StudyRoom] BaseModal 实例已创建（回退方案）');
    } else {
      console.warn('[StudyRoom] Modal 类不可用或弹窗元素未找到');
    }
  },

  /**
   * 绑定事件
   */
  bindEvents() {
    // 打开自习室弹窗
    const studyRoomBtn = document.getElementById('ui-study-room-btn');
    if (studyRoomBtn) {
      console.log('[StudyRoom] 绑定自习室按钮点击事件');
      console.log('[StudyRoom] 按钮计算样式:', window.getComputedStyle(studyRoomBtn).display);
      console.log('[StudyRoom] 按钮可见性:', studyRoomBtn.offsetParent !== null);
      
      studyRoomBtn.addEventListener('click', (e) => {
        console.log('[StudyRoom] 自习室按钮被点击');
        console.log('[StudyRoom] 事件对象:', e);
        e.stopPropagation();
        e.preventDefault();
        this.openModal();
      });
      
      // 添加鼠标悬停测试
      studyRoomBtn.addEventListener('mouseenter', () => {
        console.log('[StudyRoom] 鼠标进入按钮区域');
      });
    } else {
      console.warn('[StudyRoom] 未找到自习室按钮');
    }

    // 关闭弹窗按钮（BaseModal 会自动处理，但保留以防回退）
    const closeBtn = document.getElementById('study-room-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    // 我的自习室按钮
    const myRoomsBtn = document.getElementById('study-room-my-rooms-btn');
    if (myRoomsBtn) {
      console.log('[StudyRoom] 绑定我的自习室按钮事件');
      myRoomsBtn.addEventListener('click', (e) => {
        console.log('[StudyRoom] 我的自习室按钮被点击');
        e.stopPropagation();
        e.preventDefault();
        this.showMyRooms();
      });
    } else {
      console.warn('[StudyRoom] 未找到我的自习室按钮');
    }

    // 开启自习室按钮 - 使用捕获阶段确保事件被触发
    const createBtn = document.getElementById('study-room-create-btn');
    if (createBtn) {
      console.log('[StudyRoom] 绑定创建按钮事件');
      
      // 添加多个事件监听器确保能捕获
      createBtn.addEventListener('click', (e) => {
        console.log('[StudyRoom] 创建按钮被点击 (bubble)');
        console.log('[StudyRoom] 按钮disabled状态:', createBtn.disabled);
        if (!createBtn.disabled) {
          e.stopPropagation();
          e.preventDefault();
          this.handleCreate();
        }
      }, false);
      
      createBtn.addEventListener('click', (e) => {
        console.log('[StudyRoom] 创建按钮被点击 (capture)');
      }, true);
      
      createBtn.addEventListener('mousedown', (e) => {
        console.log('[StudyRoom] 创建按钮 mousedown');
      });
    } else {
      console.warn('[StudyRoom] 未找到创建按钮');
    }

    // 加入自习室按钮 - 使用捕获阶段确保事件被触发
    const joinBtn = document.getElementById('study-room-join-btn');
    if (joinBtn) {
      console.log('[StudyRoom] 绑定加入按钮事件');
      
      // 添加多个事件监听器确保能捕获
      joinBtn.addEventListener('click', (e) => {
        console.log('[StudyRoom] 加入按钮被点击 (bubble)');
        console.log('[StudyRoom] 按钮disabled状态:', joinBtn.disabled);
        if (!joinBtn.disabled) {
          e.stopPropagation();
          e.preventDefault();
          this.handleJoin();
        }
      }, false);
      
      joinBtn.addEventListener('click', (e) => {
        console.log('[StudyRoom] 加入按钮被点击 (capture)');
      }, true);
      
      joinBtn.addEventListener('mousedown', (e) => {
        console.log('[StudyRoom] 加入按钮 mousedown');
      });
    } else {
      console.warn('[StudyRoom] 未找到加入按钮');
    }
    
    // 也在整个option容器上添加点击事件作为备用
    const createOption = document.getElementById('study-room-create-option');
    if (createOption) {
      createOption.addEventListener('click', (e) => {
        console.log('[StudyRoom] 创建选项容器被点击');
        console.log('[StudyRoom] 点击目标:', e.target);
        // 如果点击的是按钮，让按钮处理
        if (e.target.id === 'study-room-create-btn') {
          return;
        }
      });
    }
    
    const joinOption = document.getElementById('study-room-join-option');
    if (joinOption) {
      joinOption.addEventListener('click', (e) => {
        console.log('[StudyRoom] 加入选项容器被点击');
        console.log('[StudyRoom] 点击目标:', e.target);
        // 如果点击的是按钮，让按钮处理
        if (e.target.id === 'study-room-join-btn') {
          return;
        }
      });
    }
  },

  /**
   * 打开自习室弹窗
   */
  openModal() {
    console.log('[StudyRoom] 打开自习室弹窗');
    
    if (this.modal) {
      // 使用 BaseModal 实例（会自动展开侧边栏）
      this.modal.show();
      // 延迟更新需求状态，等待DOM渲染完成
      setTimeout(() => {
        this.updateRequirements();
      }, 100);
      console.log('[StudyRoom] 使用 BaseModal 显示弹窗');
    } else {
      // 回退方案：手动展开侧边栏并显示弹窗
      if (window.expandSidebarIfNeeded) {
        window.expandSidebarIfNeeded();
      }
      const modalElement = document.getElementById('study-room-modal');
      if (modalElement) {
        modalElement.classList.add('active');
        // 延迟更新需求状态，等待DOM渲染完成
        setTimeout(() => {
          this.updateRequirements();
        }, 100);
        console.log('[StudyRoom] 使用回退方案显示弹窗');
      } else {
        console.error('[StudyRoom] 未找到自习室弹窗元素');
      }
    }
  },

  /**
   * 关闭自习室弹窗
   */
  closeModal() {
    // 停止定时器
    this.stopTimers();
    
    if (this.modal) {
      this.modal.hide();
    } else {
      // 回退方案：添加关闭动画
      const modalElement = document.getElementById('study-room-modal');
      if (modalElement && modalElement.classList.contains('active')) {
        // 添加关闭动画类
        modalElement.classList.add('closing');
        
        // 等待动画完成后移除 active 类
        setTimeout(() => {
          modalElement.classList.remove('active', 'closing');
        }, 300); // 动画时长 0.3s
      }
    }
  },

  /**
   * 更新需求状态
   */
  updateRequirements() {
    const totalMinutes = this.getTotalFocusMinutes();

    // 更新开启自习室的状态
    this.updateRequirement(
      'study-room-create-requirement',
      'study-room-create-btn',
      totalMinutes,
      this.CREATE_REQUIREMENT
    );

    // 更新加入自习室的状态
    this.updateRequirement(
      'study-room-join-requirement',
      'study-room-join-btn',
      totalMinutes,
      this.JOIN_REQUIREMENT
    );
  },

  /**
   * 更新单个需求的状态
   */
  updateRequirement(requirementId, btnId, currentMinutes, requiredMinutes) {
    const requirementEl = document.getElementById(requirementId);
    const btnEl = document.getElementById(btnId);

    if (!requirementEl || !btnEl) {
      console.warn(`[StudyRoom] 未找到元素: ${requirementId} 或 ${btnId}`);
      return;
    }

    const isMet = currentMinutes >= requiredMinutes;
    
    console.log(`[StudyRoom] 更新需求状态: ${btnId}`, {
      currentMinutes,
      requiredMinutes,
      isMet,
      btnDisabled: btnEl.disabled
    });

    // 更新需求显示
    if (isMet) {
      requirementEl.classList.add('met');
      requirementEl.classList.remove('not-met');
      const textEl = requirementEl.querySelector('.requirement-text');
      if (textEl) {
        textEl.textContent = '已达到要求 ✓';
      }
      btnEl.disabled = false;
      console.log(`[StudyRoom] 按钮 ${btnId} 已启用`);
    } else {
      requirementEl.classList.add('not-met');
      requirementEl.classList.remove('met');
      const textEl = requirementEl.querySelector('.requirement-text');
      if (textEl) {
        textEl.textContent = `需要累计专注 ${requiredMinutes} 分钟（当前 ${currentMinutes} 分钟）`;
      }
      btnEl.disabled = true;
      console.log(`[StudyRoom] 按钮 ${btnId} 已禁用`);
    }
  },

  /**
   * 获取累计专注时间（分钟）
   */
  getTotalFocusMinutes() {
    // 从侧边栏统计信息获取
    const totalMinutesEl = document.getElementById('timer-total-minutes');
    if (totalMinutesEl) {
      return parseInt(totalMinutesEl.textContent) || 0;
    }
    return 0;
  },

  /**
   * 显示输入框（替代 prompt）
   */
  showInputDialog(title, placeholder = '', defaultValue = '') {
    return new Promise((resolve) => {
      // 创建输入框HTML
      const dialogHTML = `
        <div class="input-dialog-overlay" id="input-dialog-overlay">
          <div class="input-dialog">
            <h3 class="input-dialog-title">${title}</h3>
            <input type="text" class="input-dialog-input" id="input-dialog-input" 
                   placeholder="${placeholder}" value="${defaultValue}" />
            <div class="input-dialog-buttons">
              <button class="input-dialog-btn input-dialog-cancel" id="input-dialog-cancel">取消</button>
              <button class="input-dialog-btn input-dialog-confirm" id="input-dialog-confirm">确定</button>
            </div>
          </div>
        </div>
      `;
      
      // 添加到body
      document.body.insertAdjacentHTML('beforeend', dialogHTML);
      
      const overlay = document.getElementById('input-dialog-overlay');
      const input = document.getElementById('input-dialog-input');
      const confirmBtn = document.getElementById('input-dialog-confirm');
      const cancelBtn = document.getElementById('input-dialog-cancel');
      
      // 聚焦输入框
      setTimeout(() => input.focus(), 100);
      
      // 确定按钮
      const handleConfirm = () => {
        const value = input.value.trim();
        overlay.remove();
        resolve(value);
      };
      
      // 取消按钮
      const handleCancel = () => {
        overlay.remove();
        resolve(null);
      };
      
      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      
      // 回车确认
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          handleConfirm();
        }
      });
      
      // ESC取消
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          handleCancel();
        }
      });
      
      // 点击背景关闭
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          handleCancel();
        }
      });
    });
  },

  /**
   * 显示确认框（替代 confirm）
   */
  showConfirmDialog(message) {
    return new Promise((resolve) => {
      const dialogHTML = `
        <div class="input-dialog-overlay" id="confirm-dialog-overlay">
          <div class="input-dialog">
            <p class="confirm-dialog-message">${message}</p>
            <div class="input-dialog-buttons">
              <button class="input-dialog-btn input-dialog-cancel" id="confirm-dialog-cancel">取消</button>
              <button class="input-dialog-btn input-dialog-confirm" id="confirm-dialog-confirm">确定</button>
            </div>
          </div>
        </div>
      `;
      
      document.body.insertAdjacentHTML('beforeend', dialogHTML);
      
      const overlay = document.getElementById('confirm-dialog-overlay');
      const confirmBtn = document.getElementById('confirm-dialog-confirm');
      const cancelBtn = document.getElementById('confirm-dialog-cancel');
      
      confirmBtn.addEventListener('click', () => {
        overlay.remove();
        resolve(true);
      });
      
      cancelBtn.addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
      
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(false);
        }
      });
    });
  },

  /**
   * 显示创建自习室表单
   */
  showCreateRoomForm() {
    return new Promise((resolve) => {
      const formHTML = `
        <div class="input-dialog-overlay" id="create-room-overlay">
          <div class="create-room-dialog">
            <h3 class="create-room-title">创建自习室</h3>
            
            <div class="create-room-form">
              <div class="form-group">
                <label class="form-label">自习室名称 <span class="required">*</span></label>
                <input type="text" class="form-input" id="room-name-input" 
                       placeholder="例如：深夜学习室" maxlength="50" />
              </div>
              
              <div class="form-group">
                <label class="form-label">自习室描述</label>
                <textarea class="form-textarea" id="room-desc-input" 
                          placeholder="例如：一起加油！（可选）" maxlength="200"></textarea>
              </div>
              
              <div class="form-group">
                <label class="form-label">隐私设置</label>
                <div class="privacy-options">
                  <label class="privacy-option active" data-value="public">
                    <input type="radio" name="privacy" value="public" checked />
                    <div class="privacy-option-content">
                      <div class="privacy-option-icon">🌐</div>
                      <div class="privacy-option-text">
                        <div class="privacy-option-title">公开</div>
                        <div class="privacy-option-desc">所有人可以浏览并加入</div>
                      </div>
                    </div>
                  </label>
                  
                  <label class="privacy-option" data-value="private">
                    <input type="radio" name="privacy" value="private" />
                    <div class="privacy-option-content">
                      <div class="privacy-option-icon">🔒</div>
                      <div class="privacy-option-text">
                        <div class="privacy-option-title">私密</div>
                        <div class="privacy-option-desc">只能通过ID加入</div>
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
            
            <div class="create-room-buttons">
              <button class="create-room-btn create-room-cancel" id="create-room-cancel">取消</button>
              <button class="create-room-btn create-room-confirm" id="create-room-confirm">创建</button>
            </div>
          </div>
        </div>
      `;
      
      document.body.insertAdjacentHTML('beforeend', formHTML);
      
      const overlay = document.getElementById('create-room-overlay');
      const nameInput = document.getElementById('room-name-input');
      const descInput = document.getElementById('room-desc-input');
      const confirmBtn = document.getElementById('create-room-confirm');
      const cancelBtn = document.getElementById('create-room-cancel');
      const privacyOptions = overlay.querySelectorAll('.privacy-option');
      
      // 聚焦名称输入框
      setTimeout(() => nameInput.focus(), 100);
      
      // 隐私选项切换
      privacyOptions.forEach(option => {
        option.addEventListener('click', () => {
          privacyOptions.forEach(opt => opt.classList.remove('active'));
          option.classList.add('active');
          option.querySelector('input[type="radio"]').checked = true;
        });
      });
      
      // 确定按钮
      const handleConfirm = () => {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          nameInput.style.borderColor = '#ff5252';
          setTimeout(() => {
            nameInput.style.borderColor = '';
          }, 1000);
          return;
        }
        
        const description = descInput.value.trim();
        const isPublic = overlay.querySelector('input[name="privacy"]:checked').value === 'public';
        
        overlay.remove();
        resolve({ name, description, isPublic });
      };
      
      // 取消按钮
      const handleCancel = () => {
        overlay.remove();
        resolve(null);
      };
      
      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      
      // 回车确认（仅在名称输入框）
      nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          handleConfirm();
        }
      });
      
      // ESC取消
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          handleCancel();
        }
      });
      
      // 点击背景关闭
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          handleCancel();
        }
      });
    });
  },

  /**
   * 处理开启自习室
   */
  async handleCreate() {
    console.log('[StudyRoom] handleCreate 被调用');
    const totalMinutes = this.getTotalFocusMinutes();
    
    console.log('[StudyRoom] 当前专注时间:', totalMinutes, '分钟');
    
    if (totalMinutes < this.CREATE_REQUIREMENT) {
      this.showToast(`需要累计专注 ${this.CREATE_REQUIREMENT} 分钟才能开启自习室`);
      return;
    }

    // 显示创建表单
    const formData = await this.showCreateRoomForm();
    if (!formData) {
      return;
    }
    
    const { name, description, isPublic } = formData;
    
    // 创建自习室
    this.showToast('正在创建自习室...');
    const result = await window.electronAPI.studyRoomCreate(name, description, isPublic);
    
    if (result.success) {
      this.showToast(isPublic ? '创建成功！（公开）' : '创建成功！（私密）');
      this.currentRoomId = result.data.id;
      this.currentRoomName = result.data.name;
      await this.saveRoomState();
      this.closeModal();
      
      // 打开自习室视图
      setTimeout(() => {
        this.openRoomView(result.data.id, result.data.name, isPublic);
      }, 300);
    } else {
      this.showToast('创建失败：' + result.error);
    }
  },

  /**
   * 处理加入自习室
   */
  async handleJoin() {
    console.log('[StudyRoom] handleJoin 被调用');
    const totalMinutes = this.getTotalFocusMinutes();
    
    console.log('[StudyRoom] 当前专注时间:', totalMinutes, '分钟');
    
    if (totalMinutes < this.JOIN_REQUIREMENT) {
      this.showToast(`需要累计专注 ${this.JOIN_REQUIREMENT} 分钟才能加入自习室`);
      return;
    }

    // 显示加入选项界面
    this.showJoinOptions();
  },
  
  /**
   * 显示加入选项界面
   */
  showJoinOptions() {
    const modalBody = document.querySelector('.study-room-modal-body');
    const modalHeader = document.querySelector('.study-room-modal-header h2');
    
    if (!modalBody) return;
    
    // 恢复弹窗标题
    if (modalHeader) {
      modalHeader.textContent = '👥 自习室';
    }
    
    const optionsHTML = `
      <div class="join-options-container">
        <h3>加入自习室</h3>
        
        <div class="join-option-card" id="join-by-id-card">
          <div class="join-option-icon">🔑</div>
          <div class="join-option-content">
            <h4>通过ID加入</h4>
            <p>输入朋友分享的自习室ID</p>
          </div>
          <button class="join-option-btn" id="join-by-id-btn">输入ID</button>
        </div>
        
        <div class="join-option-card" id="browse-rooms-card">
          <div class="join-option-icon">🔍</div>
          <div class="join-option-content">
            <h4>浏览自习室</h4>
            <p>查看所有活跃的自习室</p>
          </div>
          <button class="join-option-btn" id="browse-rooms-btn">浏览</button>
        </div>
        
        <button class="join-back-btn" id="join-back-btn">← 返回</button>
      </div>
    `;
    
    modalBody.innerHTML = optionsHTML;
    
    // 绑定按钮事件
    const joinByIdBtn = document.getElementById('join-by-id-btn');
    if (joinByIdBtn) {
      joinByIdBtn.addEventListener('click', async () => {
        const roomId = await this.showInputDialog('请输入自习室ID', '粘贴自习室ID');
        if (roomId) {
          await this.joinRoomById(roomId);
        }
      });
    }
    
    const browseBtn = document.getElementById('browse-rooms-btn');
    if (browseBtn) {
      browseBtn.addEventListener('click', async () => {
        this.showToast('正在加载自习室列表...');
        // 只获取公开的自习室
        const result = await window.electronAPI.studyRoomGetActive(true);
        
        if (!result.success) {
          this.showToast('获取自习室列表失败：' + result.error);
          return;
        }
        
        this.showRoomList(result.data);
      });
    }
    
    const backBtn = document.getElementById('join-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.showMainView();
      });
    }
  },
  
  /**
   * 通过ID直接加入自习室
   */
  async joinRoomById(roomId) {
    this.showToast('正在查询自习室...');
    
    // 先获取自习室信息
    const roomInfo = await window.electronAPI.studyRoomGetById(roomId);
    
    if (!roomInfo.success) {
      this.showToast('查询失败：' + roomInfo.error);
      return;
    }
    
    const room = roomInfo.data;
    
    // 显示自习室信息并询问是否加入
    const confirmed = await this.showConfirmDialog(
      `确定要加入以下自习室吗？\n\n` +
      `名称：${room.name}\n` +
      `描述：${room.description || '无'}\n` +
      `创建者：${room.creator_name}\n` +
      `成员数：${room.member_count}\n` +
      `类型：${room.is_public ? '公开' : '私密'}`
    );
    
    if (!confirmed) {
      return;
    }
    
    this.showToast('正在加入自习室...');
    const result = await window.electronAPI.studyRoomJoin(roomId);
    
    if (result.success) {
      this.showToast('加入成功！');
      this.currentRoomId = roomId;
      this.currentRoomName = room.name;
      await this.saveRoomState();
      
      this.closeModal();
      
      // 打开自习室视图
      setTimeout(() => {
        this.openRoomView(roomId, room.name, room.is_public);
      }, 300);
    } else {
      this.showToast('加入失败：' + result.error);
    }
  },
  
  /**
   * 显示自习室列表
   */
  showRoomList(rooms) {
    if (!rooms || rooms.length === 0) {
      this.showToast('暂无公开的自习室');
      return;
    }
    
    const modalHeader = document.querySelector('.study-room-modal-header h2');
    
    // 恢复弹窗标题
    if (modalHeader) {
      modalHeader.textContent = '👥 自习室';
    }
    
    // 创建列表HTML
    let listHTML = '<div class="room-list-container">';
    listHTML += '<h3>公开的自习室</h3>';
    listHTML += '<div class="room-list">';
    
    rooms.forEach(room => {
      const privacyBadge = room.is_public ? 
        '<span class="room-privacy-badge public">🌐 公开</span>' : 
        '<span class="room-privacy-badge private">🔒 私密</span>';
      
      // 截取ID的前8位用于显示
      const shortId = room.id.substring(0, 8);
      
      listHTML += `
        <div class="room-list-item" data-room-id="${room.id}">
          <div class="room-info">
            <div class="room-name">${room.name} ${privacyBadge}</div>
            <div class="room-desc">${room.description || '暂无描述'}</div>
            <div class="room-id-display-mini">
              <span class="room-id-label">ID:</span>
              <span class="room-id-short" title="${room.id}">${shortId}...</span>
              <button class="room-id-copy-mini" data-room-id="${room.id}" title="复制完整ID">📋</button>
            </div>
            <div class="room-meta">
              <span>👤 创建者: ${room.creator_name}</span>
              <span>👥 成员: ${room.member_count}</span>
            </div>
          </div>
          <button class="room-join-btn" data-room-id="${room.id}" data-room-name="${room.name}">加入</button>
        </div>
      `;
    });
    
    listHTML += '</div>';
    listHTML += '<button class="room-list-close-btn">返回</button>';
    listHTML += '</div>';
    
    // 替换弹窗内容
    const modalBody = document.querySelector('.study-room-modal-body');
    if (modalBody) {
      modalBody.innerHTML = listHTML;
      
      // 绑定复制ID按钮
      const copyBtns = modalBody.querySelectorAll('.room-id-copy-mini');
      copyBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const roomId = e.target.dataset.roomId;
          navigator.clipboard.writeText(roomId).then(() => {
            this.showToast('自习室ID已复制到剪贴板');
          }).catch(() => {
            prompt('请复制自习室ID:', roomId);
          });
        });
      });
      
      // 绑定加入按钮事件
      const joinBtns = modalBody.querySelectorAll('.room-join-btn');
      joinBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const roomId = e.target.dataset.roomId;
          await this.joinRoomById(roomId);
        });
      });
      
      // 绑定返回按钮
      const closeBtn = modalBody.querySelector('.room-list-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          this.showJoinOptions();
        });
      }
    }
  },
  
  /**
   * 加入自习室
   */
  async joinRoom(roomId, roomName) {
    this.showToast('正在加入自习室...');
    const result = await window.electronAPI.studyRoomJoin(roomId);
    
    if (result.success) {
      this.showToast('加入成功！');
      this.currentRoomId = roomId;
      this.currentRoomName = roomName;
      await this.saveRoomState();
      this.closeModal();
      
      // 打开自习室视图
      setTimeout(() => {
        this.openRoomView(roomId, roomName);
      }, 300);
    } else {
      this.showToast('加入失败：' + result.error);
    }
  },
  
  /**
   * 打开自习室视图
   */
  async openRoomView(roomId, roomName, isPublic = null) {
    this.currentRoomId = roomId;
    this.currentRoomName = roomName;
    
    // 如果没有提供 isPublic，从服务器获取
    if (isPublic === null) {
      const roomInfo = await window.electronAPI.studyRoomGetById(roomId);
      if (roomInfo.success) {
        isPublic = roomInfo.data.is_public;
      }
    }
    
    const privacyBadge = isPublic ? 
      '<span class="room-privacy-badge public">🌐 公开</span>' : 
      '<span class="room-privacy-badge private">🔒 私密</span>';
    
    // 创建自习室视图HTML
    const viewHTML = `
      <div class="room-view-container">
        <div class="room-view-header">
          <div class="room-view-title-group">
            <h3>${roomName}</h3>
            ${privacyBadge}
          </div>
        </div>
        
        <div class="room-id-display">
          <span class="room-id-label">自习室ID:</span>
          <span class="room-id-value">${roomId}</span>
          <button class="room-id-copy-btn" title="复制ID">📋</button>
        </div>
        
        <div class="room-view-tabs">
          <button class="room-tab active" data-tab="ranking">📊 今日排名</button>
          <button class="room-tab" data-tab="members">👥 在线成员</button>
        </div>
        
        <div class="room-view-content">
          <div class="room-tab-panel active" id="ranking-panel">
            <div class="loading">加载中...</div>
          </div>
          <div class="room-tab-panel" id="members-panel">
            <div class="loading">加载中...</div>
          </div>
        </div>
        
        <div class="room-view-actions">
          <button class="room-refresh-btn">🔄 刷新</button>
          <button class="room-delete-btn">🗑️ 删除自习室</button>
          <button class="room-leave-btn">🚪 离开自习室</button>
        </div>
      </div>
    `;
    
    // 显示视图
    const modalBody = document.querySelector('.study-room-modal-body');
    const modalHeader = document.querySelector('.study-room-modal-header h2');
    
    if (modalBody) {
      modalBody.innerHTML = viewHTML;
      
      // 更新弹窗标题显示当前自习室
      if (modalHeader) {
        modalHeader.textContent = `👥 ${roomName}`;
      }
      
      // 绑定标签切换
      const tabs = modalBody.querySelectorAll('.room-tab');
      tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
          const tabName = e.target.dataset.tab;
          this.switchTab(tabName);
        });
      });
      
      // 绑定刷新按钮
      const refreshBtn = modalBody.querySelector('.room-refresh-btn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => this.refreshRoomData());
      }
      
      // 绑定删除按钮
      const deleteBtn = modalBody.querySelector('.room-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => this.deleteRoom());
      }
      
      // 绑定离开按钮
      const leaveBtn = modalBody.querySelector('.room-leave-btn');
      if (leaveBtn) {
        leaveBtn.addEventListener('click', () => this.leaveRoom());
      }
      
      // 绑定复制ID按钮
      const copyBtn = modalBody.querySelector('.room-id-copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          // 复制到剪贴板
          navigator.clipboard.writeText(roomId).then(() => {
            this.showToast('自习室ID已复制到剪贴板');
          }).catch(() => {
            // 回退方案：显示ID让用户手动复制
            prompt('请复制自习室ID:', roomId);
          });
        });
      }
    }
    
    // 打开弹窗
    this.openModal();
    
    // 延迟加载数据，等待DOM渲染完成
    setTimeout(async () => {
      await this.refreshRoomData();
    }, 300);
    
    // 启动心跳（每5分钟更新一次在线状态）
    this.startHeartbeat();
    
    // 启动自动刷新（每30秒刷新一次排名）
    this.startAutoRefresh();
  },
  
  /**
   * 切换标签
   */
  switchTab(tabName) {
    const tabs = document.querySelectorAll('.room-tab');
    const panels = document.querySelectorAll('.room-tab-panel');
    
    tabs.forEach(tab => {
      if (tab.dataset.tab === tabName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
    
    panels.forEach(panel => {
      if (panel.id === tabName + '-panel') {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });
  },
  
  /**
   * 刷新自习室数据
   */
  async refreshRoomData() {
    if (!this.currentRoomId) return;
    
    // 获取排名
    const rankingResult = await window.electronAPI.studyRoomGetRanking(this.currentRoomId);
    if (rankingResult.success) {
      this.updateRankingDisplay(rankingResult.data);
    }
    
    // 获取成员
    const membersResult = await window.electronAPI.studyRoomGetMembers(this.currentRoomId);
    if (membersResult.success) {
      this.updateMembersDisplay(membersResult.data);
    }
  },
  
  /**
   * 更新排名显示
   */
  updateRankingDisplay(data) {
    const panel = document.getElementById('ranking-panel');
    if (!panel) return;
    
    if (!data || data.length === 0) {
      panel.innerHTML = '<div class="empty-state">暂无排名数据</div>';
      return;
    }
    
    let html = '<div class="ranking-list">';
    data.forEach((record, index) => {
      const rank = index + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
      
      html += `
        <div class="ranking-item ${rank <= 3 ? 'top-three' : ''}">
          <div class="ranking-rank">${medal}</div>
          <div class="ranking-info">
            <div class="ranking-username">${record.username}</div>
            <div class="ranking-stats">
              <span>⏱️ ${record.total_minutes} 分钟</span>
              <span>🍅 ${record.session_count} 次</span>
            </div>
          </div>
        </div>
      `;
    });
    html += '</div>';
    
    panel.innerHTML = html;
  },
  
  /**
   * 更新成员显示
   */
  updateMembersDisplay(data) {
    const panel = document.getElementById('members-panel');
    if (!panel) return;
    
    if (!data || data.length === 0) {
      panel.innerHTML = '<div class="empty-state">暂无在线成员</div>';
      return;
    }
    
    let html = '<div class="members-list">';
    data.forEach(member => {
      const lastActive = new Date(member.last_active);
      const timeAgo = this.getTimeAgo(lastActive);
      
      html += `
        <div class="member-item">
          <div class="member-avatar">👤</div>
          <div class="member-info">
            <div class="member-username">${member.username}</div>
            <div class="member-status">最后活跃: ${timeAgo}</div>
          </div>
          <div class="member-online-indicator ${member.is_online ? 'online' : 'offline'}"></div>
        </div>
      `;
    });
    html += '</div>';
    
    panel.innerHTML = html;
  },
  
  /**
   * 获取相对时间
   */
  getTimeAgo(date) {
    const now = new Date();
    const diff = Math.floor((now - date) / 1000); // 秒
    
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
  },
  
  /**
   * 启动心跳
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // 立即执行一次心跳
    if (this.currentRoomId) {
      window.electronAPI.studyRoomUpdateStatus(this.currentRoomId);
    }
    
    // 然后每5分钟执行一次
    this.heartbeatInterval = setInterval(async () => {
      if (this.currentRoomId) {
        await window.electronAPI.studyRoomUpdateStatus(this.currentRoomId);
      }
    }, 5 * 60 * 1000); // 每5分钟
  },
  
  /**
   * 启动自动刷新
   */
  startAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    this.refreshInterval = setInterval(async () => {
      await this.refreshRoomData();
    }, 30 * 1000); // 每30秒
  },
  
  /**
   * 停止定时器
   */
  stopTimers() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  },
  
  /**
   * 删除自习室
   */
  async deleteRoom() {
    if (!this.currentRoomId) return;
    
    const confirmed = await this.showConfirmDialog(
      `确定要删除 "${this.currentRoomName}" 吗？\n\n⚠️ 警告：这将清除该自习室的所有数据，包括：\n• 所有成员记录\n• 所有专注会话\n• 所有每日排名数据\n\n此操作不可恢复！`
    );
    
    if (!confirmed) return;
    
    // 二次确认
    const doubleConfirm = await this.showConfirmDialog(
      `最后确认：真的要删除 "${this.currentRoomName}" 吗？`
    );
    
    if (!doubleConfirm) return;
    
    this.showToast('正在删除自习室...');
    const result = await window.electronAPI.studyRoomDelete(this.currentRoomId);
    
    if (result.success) {
      this.showToast('自习室已删除');
      this.stopTimers();
      
      const oldRoomName = this.currentRoomName;
      this.currentRoomId = null;
      this.currentRoomName = null;
      await this.saveRoomState();
      
      console.log(`[StudyRoom] 已删除自习室: ${oldRoomName}`);
      
      // 返回到主界面
      this.showMainView();
    } else {
      this.showToast('删除失败：' + result.error);
    }
  },
  
  /**
   * 离开自习室
   */
  async leaveRoom() {
    if (!this.currentRoomId) return;
    
    const confirmed = await this.showConfirmDialog(`确定要离开 "${this.currentRoomName}" 吗？`);
    if (!confirmed) return;
    
    this.showToast('正在离开自习室...');
    const result = await window.electronAPI.studyRoomLeave(this.currentRoomId);
    
    if (result.success) {
      this.showToast('已离开自习室');
      this.stopTimers();
      
      // 清除当前自习室信息
      const oldRoomId = this.currentRoomId;
      const oldRoomName = this.currentRoomName;
      this.currentRoomId = null;
      this.currentRoomName = null;
      await this.saveRoomState();
      
      console.log(`[StudyRoom] 已离开自习室: ${oldRoomName} (${oldRoomId})`);
      
      // 返回到主界面而不是关闭弹窗
      this.showMainView();
    } else {
      this.showToast('离开失败：' + result.error);
    }
  },
  
  /**
   * 显示主界面（创建/加入选项）
   */
  showMainView() {
    const modalBody = document.querySelector('.study-room-modal-body');
    const modalHeader = document.querySelector('.study-room-modal-header h2');
    
    if (!modalBody) return;
    
    // 恢复弹窗标题
    if (modalHeader) {
      modalHeader.textContent = '👥 自习室';
    }
    
    const mainHTML = `
      <div class="study-room-options">
        <div class="study-room-option" id="study-room-my-rooms-option">
          <div class="study-room-option-icon">📚</div>
          <div class="study-room-option-content">
            <h3>我的自习室</h3>
            <p class="study-room-option-desc">查看和管理我创建的自习室</p>
          </div>
          <button class="study-room-btn" id="study-room-my-rooms-btn" style="opacity: 1 !important; pointer-events: auto !important;">查看</button>
        </div>
        
        <div class="study-room-option" id="study-room-create-option">
          <div class="study-room-option-icon">🏠</div>
          <div class="study-room-option-content">
            <h3>开启自习室</h3>
            <p class="study-room-option-desc">创建一个自习室，邀请好友一起专注学习</p>
            <div class="study-room-requirement" id="study-room-create-requirement">
              <span class="requirement-icon">⏱️</span>
              <span class="requirement-text">需要累计专注 10 分钟</span>
            </div>
          </div>
          <button class="study-room-btn" id="study-room-create-btn">开启</button>
        </div>
        
        <div class="study-room-option" id="study-room-join-option">
          <div class="study-room-option-icon">🚪</div>
          <div class="study-room-option-content">
            <h3>加入自习室</h3>
            <p class="study-room-option-desc">加入已有的自习室，与他人共同进步</p>
            <div class="study-room-requirement" id="study-room-join-requirement">
              <span class="requirement-icon">⏱️</span>
              <span class="requirement-text">需要累计专注 15 分钟</span>
            </div>
          </div>
          <button class="study-room-btn" id="study-room-join-btn">加入</button>
        </div>
      </div>
    `;
    
    modalBody.innerHTML = mainHTML;
    
    // 重新绑定按钮事件
    this.rebindMainButtons();
    
    // 更新需求状态
    this.updateRequirements();
  },
  
  /**
   * 重新绑定主界面按钮事件
   */
  rebindMainButtons() {
    const myRoomsBtn = document.getElementById('study-room-my-rooms-btn');
    if (myRoomsBtn) {
      myRoomsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.showMyRooms();
      });
    }
    
    const createBtn = document.getElementById('study-room-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', (e) => {
        if (!createBtn.disabled) {
          e.stopPropagation();
          e.preventDefault();
          this.handleCreate();
        }
      });
    }
    
    const joinBtn = document.getElementById('study-room-join-btn');
    if (joinBtn) {
      joinBtn.addEventListener('click', (e) => {
        if (!joinBtn.disabled) {
          e.stopPropagation();
          e.preventDefault();
          this.handleJoin();
        }
      });
    }
  },
  
  /**
   * 显示我的自习室列表
   */
  async showMyRooms() {
    this.showToast('正在加载我的自习室...');
    const result = await window.electronAPI.studyRoomGetMyRooms();
    
    if (!result.success) {
      this.showToast('加载失败：' + result.error);
      return;
    }
    
    const rooms = result.data;
    
    const modalBody = document.querySelector('.study-room-modal-body');
    const modalHeader = document.querySelector('.study-room-modal-header h2');
    
    if (!modalBody) return;
    
    // 恢复弹窗标题
    if (modalHeader) {
      modalHeader.textContent = '👥 自习室';
    }
    
    let listHTML = '<div class="my-rooms-container">';
    listHTML += '<h3>我的自习室</h3>';
    
    if (!rooms || rooms.length === 0) {
      listHTML += '<div class="empty-state">你还没有创建任何自习室</div>';
    } else {
      listHTML += '<div class="my-rooms-list">';
      
      rooms.forEach(room => {
        const privacyBadge = room.is_public ? 
          '<span class="room-privacy-badge public">🌐 公开</span>' : 
          '<span class="room-privacy-badge private">🔒 私密</span>';
        
        // 截取ID的前8位用于显示
        const shortId = room.id.substring(0, 8);
        
        listHTML += `
          <div class="my-room-item">
            <div class="my-room-info">
              <div class="my-room-name">${room.name} ${privacyBadge}</div>
              <div class="my-room-desc">${room.description || '暂无描述'}</div>
              <div class="my-room-id">
                <span class="room-id-label">ID:</span>
                <span class="room-id-short" title="${room.id}">${shortId}...</span>
                <button class="room-id-copy-mini" data-room-id="${room.id}" title="复制完整ID">📋</button>
              </div>
              <div class="my-room-meta">
                <span>👥 成员: ${room.member_count}</span>
                <span>📅 创建于: ${new Date(room.created_at).toLocaleDateString()}</span>
              </div>
            </div>
            <button class="my-room-enter-btn" data-room-id="${room.id}" data-room-name="${room.name}" data-is-public="${room.is_public}">进入</button>
          </div>
        `;
      });
      
      listHTML += '</div>';
    }
    
    listHTML += '<button class="my-rooms-back-btn">← 返回</button>';
    listHTML += '</div>';
    
    modalBody.innerHTML = listHTML;
    
    // 绑定复制ID按钮
    const copyBtns = modalBody.querySelectorAll('.room-id-copy-mini');
    copyBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const roomId = e.target.dataset.roomId;
        navigator.clipboard.writeText(roomId).then(() => {
          this.showToast('自习室ID已复制到剪贴板');
        }).catch(() => {
          prompt('请复制自习室ID:', roomId);
        });
      });
    });
    
    // 绑定进入按钮
    const enterBtns = modalBody.querySelectorAll('.my-room-enter-btn');
    enterBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const roomId = e.target.dataset.roomId;
        const roomName = e.target.dataset.roomName;
        const isPublic = e.target.dataset.isPublic === 'true';
        
        // 先加入（如果还没加入）
        await window.electronAPI.studyRoomJoin(roomId);
        
        this.currentRoomId = roomId;
        this.currentRoomName = roomName;
        await this.saveRoomState();
        
        // 打开自习室视图
        this.openRoomView(roomId, roomName, isPublic);
      });
    });
    
    // 绑定返回按钮
    const backBtn = modalBody.querySelector('.my-rooms-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.showMainView();
      });
    }
  },
  
  /**
   * 上传今日统计到自习室（在计时器完成时调用）
   */
  async uploadSession(minutes, note) {
    if (!this.currentRoomId) {
      console.log('[StudyRoom] 未在自习室中，跳过上传');
      return;
    }
    
    // 获取今日统计数据
    const todayCount = window.Stats ? window.Stats.getTodayCount() : 0;
    const todayMinutes = window.Stats ? window.Stats.getTodayMinutes() : 0;
    
    console.log('[StudyRoom] 上传今日统计到自习室:', todayMinutes, '分钟,', todayCount, '次, 自习室ID:', this.currentRoomId);
    
    const result = await window.electronAPI.studyRoomUploadStats(
      this.currentRoomId,
      todayMinutes,
      todayCount
    );
    
    if (result.success) {
      console.log('[StudyRoom] 今日统计已上传');
      // 刷新排名
      await this.refreshRoomData();
    } else {
      console.error('[StudyRoom] 上传失败:', result.error);
    }
  },
  
  /**
   * 检查是否在自习室中
   */
  isInRoom() {
    return !!this.currentRoomId;
  },
  
  /**
   * 保存自习室状态到本地存储
   */
  async saveRoomState() {
    if (!window.DataStore) return;
    
    const data = window.DataStore.getData();
    if (!data.studyRoom) {
      data.studyRoom = {};
    }
    
    data.studyRoom.currentRoomId = this.currentRoomId;
    data.studyRoom.currentRoomName = this.currentRoomName;
    
    await window.DataStore.saveImmediate();
    console.log('[StudyRoom] 已保存自习室状态:', this.currentRoomId, this.currentRoomName);
  },
  
  /**
   * 从本地存储恢复自习室状态
   */
  async restoreRoomState() {
    if (!window.DataStore) return;
    
    const data = window.DataStore.getData();
    if (data.studyRoom) {
      this.currentRoomId = data.studyRoom.currentRoomId || null;
      this.currentRoomName = data.studyRoom.currentRoomName || null;
      
      if (this.currentRoomId) {
        console.log('[StudyRoom] 已恢复自习室状态:', this.currentRoomId, this.currentRoomName);
      }
    }
  },

  /**
   * 显示提示消息（在弹窗顶部）
   */
  showToast(message) {
    // 过滤掉加载类提示
    if (message.includes('加载') || message.includes('正在')) {
      console.log('[StudyRoom] 跳过加载提示:', message);
      return;
    }
    
    console.log('[StudyRoom] 显示提示:', message);
    
    // 先尝试在弹窗顶部显示
    const modal = document.getElementById('study-room-modal');
    const modalHeader = document.querySelector('.study-room-modal-header');
    
    if (modal && modal.classList.contains('active') && modalHeader) {
      // 移除旧的提示
      const oldToast = modalHeader.querySelector('.study-room-toast');
      if (oldToast) {
        oldToast.remove();
      }
      
      // 创建新提示
      const toast = document.createElement('div');
      toast.className = 'study-room-toast';
      toast.textContent = message;
      modalHeader.appendChild(toast);
      
      console.log('[StudyRoom] 在弹窗顶部显示提示');
      
      // 3秒后自动消失
      setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    } else {
      // 回退到全局 toast
      console.log('[StudyRoom] 使用全局 toast');
      const toast = document.getElementById('ui-toast');
      if (toast) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
          toast.classList.remove('show');
        }, 2000);
      }
    }
  },

  /**
   * 调试函数 - 手动打开弹窗
   */
  debugOpen() {
    console.log('[StudyRoom] 调试：手动打开弹窗');
    this.openModal();
  },

  /**
   * 调试函数 - 设置累计专注时长
   * @param {number} minutes - 要设置的分钟数
   */
  async debugSetTotalMinutes(minutes) {
    try {
      const data = await window.electronAPI.readData();
      data.stats.totalMinutes = minutes;
      await window.electronAPI.writeData(data);
      
      // 刷新显示
      if (window.Stats) {
        window.Stats.update();
      }
      
      // 更新自习室需求状态
      this.updateRequirements();
      
      console.log(`[StudyRoom] 累计专注时长已设置为 ${minutes} 分钟`);
      this.showToast(`累计专注时长已设置为 ${minutes} 分钟`);
      
      // 输出按钮状态
      const createBtn = document.getElementById('study-room-create-btn');
      const joinBtn = document.getElementById('study-room-join-btn');
      console.log('[StudyRoom] 创建按钮disabled:', createBtn?.disabled);
      console.log('[StudyRoom] 加入按钮disabled:', joinBtn?.disabled);
    } catch (error) {
      console.error('[StudyRoom] 设置累计专注时长失败:', error);
      this.showToast('设置失败');
    }
  },
  
  /**
   * 调试函数 - 强制启用按钮（用于测试）
   */
  debugEnableButtons() {
    const createBtn = document.getElementById('study-room-create-btn');
    const joinBtn = document.getElementById('study-room-join-btn');
    
    if (createBtn) {
      createBtn.disabled = false;
      console.log('[StudyRoom] 创建按钮已强制启用');
    }
    
    if (joinBtn) {
      joinBtn.disabled = false;
      console.log('[StudyRoom] 加入按钮已强制启用');
    }
    
    this.showToast('按钮已强制启用');
  }
};

// 暴露到全局用于调试
window.StudyRoom = StudyRoom;

// 导出模块（如果需要）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StudyRoom;
}
