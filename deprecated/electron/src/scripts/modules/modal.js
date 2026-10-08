/**
 * 番茄钟 - 弹窗基类模块
 * 提供统一的弹窗管理，包括：
 * - 显示/隐藏控制
 * - 点击背景关闭
 * - 展开侧边栏
 * - 进入/退出动画
 */
;(function() {
  'use strict'

  /**
   * 基础弹窗类
   * 用于无动画的简单弹窗
   */
  class BaseModal {
    /**
     * @param {Object} options 配置选项
     * @param {HTMLElement|string} options.element 弹窗元素或选择器
     * @param {string} [options.showClass='show'] 显示时的 CSS 类名
     * @param {boolean} [options.closeOnBackground=true] 是否允许点击背景关闭
     * @param {boolean} [options.expandSidebarOnShow=true] 显示时是否展开侧边栏
     * @param {Function} [options.onShow] 显示回调
     * @param {Function} [options.onHide] 隐藏回调
     * @param {Function} [options.onBackgroundClick] 背景点击回调（返回 false 可阻止关闭）
     */
    constructor(options) {
      if (!options.element) {
        throw new Error('Modal: element is required')
      }

      this.element = typeof options.element === 'string'
        ? document.querySelector(options.element)
        : options.element

      if (!this.element) {
        throw new Error(`Modal: element not found: ${options.element}`)
      }

      this.showClass = options.showClass || 'show'
      this.closeOnBackground = options.closeOnBackground ?? true
      this.expandSidebarOnShow = options.expandSidebarOnShow ?? true
      this.onShow = options.onShow || null
      this.onHide = options.onHide || null
      this.onBackgroundClick = options.onBackgroundClick || null

      this._isInitialized = false
      this._boundBackgroundHandler = null
      this._modalId = options.name || this.element.id || `modal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      this._init()
    }

    /**
     * 初始化弹窗
     */
    _init() {
      if (this._isInitialized) return

      window.modalManager?.register(this._modalId, this)
      this._applyBaseStyles()
      this._bindBackgroundClick()
      this._isInitialized = true
    }

    /**
     * 应用基础样式
     * 确保所有弹窗都有统一的定位和圆角
     */
    _applyBaseStyles() {
      const el = this.element
      // 只有在样式未设置时才设置默认值
      if (el.style.position === '' && getComputedStyle(el).position === 'static') {
        el.style.position = 'absolute'
      }
      if (el.style.top === '') {
        el.style.top = '0'
      }
      if (el.style.left === '') {
        el.style.left = '0'
      }
      if (el.style.width === '') {
        el.style.width = '100%'
      }
      if (el.style.height === '') {
        el.style.height = '100%'
      }
      if (el.style.borderRadius === '') {
        el.style.borderRadius = '20px'
      }
    }

    /**
     * 绑定背景点击事件
     */
    _bindBackgroundClick() {
      // 先移除旧的监听器（如果存在）
      if (this._boundBackgroundHandler) {
        this.element.removeEventListener('click', this._boundBackgroundHandler)
      }

      this._boundBackgroundHandler = (e) => {
        if (e.target !== this.element) return
        if (window.modalManager && !window.modalManager.isTopModal(this)) {
          e.stopPropagation()
          return
        }

        // 如果有关闭前回调，检查是否允许关闭
        if (this.onBackgroundClick) {
          const shouldClose = this.onBackgroundClick(e)
          if (shouldClose === false) return
        }

        if (this.closeOnBackground) {
          this.hide()
          e.stopPropagation()
        }
      }

      this.element.addEventListener('click', this._boundBackgroundHandler)
    }

    /**
     * 显示弹窗
     */
    show() {
      if (this.expandSidebarOnShow && window.expandSidebarIfNeeded) {
        window.expandSidebarIfNeeded()
      }

      window.modalManager?.onModalShow(this)
      this.element.classList.add(this.showClass)
      this.onShow?.()
    }

    /**
     * 隐藏弹窗
     */
    hide() {
      window.modalManager?.onModalHide(this)
      this.element.classList.remove(this.showClass)
      this.onHide?.()
    }

    /**
     * 切换显示状态
     */
    toggle() {
      return this.isVisible() ? this.hide() : this.show()
    }

    /**
     * 检查是否可见
     * @returns {boolean}
     */
    isVisible() {
      return this.element.classList.contains(this.showClass)
    }

    /**
     * 临时设置是否允许点击背景关闭
     * @param {boolean} value
     */
    setBackgroundClose(value) {
      this.closeOnBackground = value
    }

    /**
     * 销毁弹窗实例
     */
    destroy() {
      if (this._boundBackgroundHandler) {
        this.element.removeEventListener('click', this._boundBackgroundHandler)
        this._boundBackgroundHandler = null
      }
      this._isInitialized = false
    }
  }

  /**
   * 功能弹窗类
   * 继承 BaseModal，添加进入/退出动画支持
   */
  class AnimatedModal extends BaseModal {
    /**
     * @param {Object} options 配置选项
     * @param {string} [options.hidingClass='hiding'] 隐藏动画时的 CSS 类名
     * @param {string} [options.noAnimationClass='no-animation'] 禁用动画的 CSS 类名
     * @param {number} [options.animationDuration=500] 动画时长（毫秒）
     */
    constructor(options) {
      super(options)

      this.hidingClass = options.hidingClass || 'hiding'
      this.noAnimationClass = options.noAnimationClass || 'no-animation'
      this.animationDuration = options.animationDuration || 500
    }

    /**
     * 显示弹窗
     * @param {boolean} [withAnimation=true] 是否显示动画
     */
    show(withAnimation = true) {
      if (this.expandSidebarOnShow && window.expandSidebarIfNeeded) {
        window.expandSidebarIfNeeded()
      }

      window.modalManager?.onModalShow(this)
      if (withAnimation) {
        this.element.classList.remove(this.hidingClass, this.noAnimationClass)
        this.element.classList.add(this.showClass)
      } else {
        this.element.classList.add(this.showClass, this.noAnimationClass)
      }

      this.onShow?.()
    }

    /**
     * 隐藏弹窗
     * @param {boolean} [withAnimation=true] 是否显示动画
     */
    hide(withAnimation = true) {
      window.modalManager?.onModalHide(this)
      if (withAnimation) {
        this.element.classList.remove(this.showClass)
        this.element.classList.add(this.hidingClass)

        setTimeout(() => {
          this.element.classList.remove(this.hidingClass, this.noAnimationClass)
        }, this.animationDuration)
      } else {
        this.element.classList.remove(this.showClass, this.hidingClass, this.noAnimationClass)
      }

      this.onHide?.()
    }

    /**
     * 立即隐藏（无动画）
     */
    hideImmediate() {
      this.hide(false)
    }
  }

  /**
   * 弹窗管理器
   * 用于管理多个弹窗实例，处理层级关系
   */
  class ModalManager {
    constructor() {
      this.modals = new Map()
      this.stack = [] // 当前打开的弹窗栈
    }

    /**
     * 注册弹窗
     * @param {string} name 弹窗名称
     * @param {BaseModal|AnimatedModal} modal 弹窗实例
     */
    register(name, modal) {
      this.modals.set(name, modal)
    }

    onModalShow(modal) {
      const index = this.stack.indexOf(modal)
      if (index > -1) {
        this.stack.splice(index, 1)
      }
      this.stack.push(modal)
    }

    onModalHide(modal) {
      const index = this.stack.indexOf(modal)
      if (index > -1) {
        this.stack.splice(index, 1)
      }
    }

    /**
     * 获取弹窗
     * @param {string} name 弹窗名称
     * @returns {BaseModal|AnimatedModal|undefined}
     */
    get(name) {
      return this.modals.get(name)
    }

    /**
     * 显示弹窗
     * @param {string} name 弹窗名称
     */
    show(name) {
      const modal = this.modals.get(name)
      if (modal) {
        // 添加到栈
        if (!this.stack.includes(name)) {
          this.stack.push(name)
        }
        modal.show()
      }
    }

    /**
     * 隐藏弹窗
     * @param {string} name 弹窗名称
     */
    hide(name) {
      const modal = this.modals.get(name)
      if (modal) {
        // 从栈中移除
        const index = this.stack.indexOf(name)
        if (index > -1) {
          this.stack.splice(index, 1)
        }
        modal.hide()
      }
    }

    /**
     * 隐藏所有弹窗
     */
    hideAll() {
      this.stack.forEach(modal => {
        modal?.hide()
      })
      this.stack = []
    }

    /**
     * 获取当前最上层的弹窗
     * @returns {string|undefined}
     */
    getTopModal() {
      return this.stack[this.stack.length - 1]
    }

    isTopModal(modal) {
      return this.getTopModal() === modal
    }

    /**
     * 检查是否有弹窗打开
     * @returns {boolean}
     */
    hasOpenModal() {
      return this.stack.length > 0
    }
  }

  // 创建全局弹窗管理器实例
  const modalManager = new ModalManager()

  // 导出到全局
  window.BaseModal = BaseModal
  window.AnimatedModal = AnimatedModal
  window.ModalManager = ModalManager
  window.modalManager = modalManager
})()
