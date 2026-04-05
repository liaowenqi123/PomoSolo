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

  /**
   * 初始化自习室模块
   */
  init() {
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

    // 开启自习室按钮
    const createBtn = document.getElementById('study-room-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => this.handleCreate());
    }

    // 加入自习室按钮
    const joinBtn = document.getElementById('study-room-join-btn');
    if (joinBtn) {
      joinBtn.addEventListener('click', () => this.handleJoin());
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
      this.updateRequirements();
      console.log('[StudyRoom] 使用 BaseModal 显示弹窗');
    } else {
      // 回退方案：手动展开侧边栏并显示弹窗
      if (window.expandSidebarIfNeeded) {
        window.expandSidebarIfNeeded();
      }
      const modalElement = document.getElementById('study-room-modal');
      if (modalElement) {
        modalElement.classList.add('active');
        this.updateRequirements();
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

    if (!requirementEl || !btnEl) return;

    const isMet = currentMinutes >= requiredMinutes;

    // 更新需求显示
    if (isMet) {
      requirementEl.classList.add('met');
      requirementEl.classList.remove('not-met');
      requirementEl.querySelector('.requirement-text').textContent = '已达到要求 ✓';
      btnEl.disabled = false;
    } else {
      requirementEl.classList.add('not-met');
      requirementEl.classList.remove('met');
      requirementEl.querySelector('.requirement-text').textContent = 
        `需要累计专注 ${requiredMinutes} 分钟（当前 ${currentMinutes} 分钟）`;
      btnEl.disabled = true;
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
   * 处理开启自习室
   */
  handleCreate() {
    const totalMinutes = this.getTotalFocusMinutes();
    
    if (totalMinutes < this.CREATE_REQUIREMENT) {
      this.showToast(`需要累计专注 ${this.CREATE_REQUIREMENT} 分钟才能开启自习室`);
      return;
    }

    // TODO: 实现开启自习室的逻辑
    console.log('开启自习室');
    this.showToast('开启自习室功能开发中...');
  },

  /**
   * 处理加入自习室
   */
  handleJoin() {
    const totalMinutes = this.getTotalFocusMinutes();
    
    if (totalMinutes < this.JOIN_REQUIREMENT) {
      this.showToast(`需要累计专注 ${this.JOIN_REQUIREMENT} 分钟才能加入自习室`);
      return;
    }

    // TODO: 实现加入自习室的逻辑
    console.log('加入自习室');
    this.showToast('加入自习室功能开发中...');
  },

  /**
   * 显示提示消息
   */
  showToast(message) {
    // 使用现有的 toast 系统
    const toast = document.getElementById('ui-toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 2000);
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
    } catch (error) {
      console.error('[StudyRoom] 设置累计专注时长失败:', error);
      this.showToast('设置失败');
    }
  }
};

// 暴露到全局用于调试
window.StudyRoom = StudyRoom;

// 导出模块（如果需要）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StudyRoom;
}
