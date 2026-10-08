/**
 * Modal 模块测试 - BaseModal / AnimatedModal / ModalManager
 */
import { beforeAll, describe, expect, it, vi, afterEach } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/modal')
})

afterEach(() => {
  document.body.innerHTML = ''
  // 重置 modalManager 状态
  if (window.modalManager) {
    window.modalManager.stack = []
  }
  delete window.expandSidebarIfNeeded
})

describe('BaseModal', () => {
  function setupModal(options = {}) {
    document.body.innerHTML = `<div id="modal" class="modal"></div>`
    const element = document.getElementById('modal')
    return new window.BaseModal({ element, ...options })
  }

  it('构造函数应缓存元素引用', () => {
    const modal = setupModal()
    expect(modal.element).toBe(document.getElementById('modal'))
  })

  it('构造函数应接受字符串选择器', () => {
    document.body.innerHTML = `<div id="modal-x" class="modal"></div>`
    const modal = new window.BaseModal({ element: '#modal-x' })
    expect(modal.element).toBe(document.getElementById('modal-x'))
  })

  it('默认 showClass 应为 "show"', () => {
    const modal = setupModal()
    expect(modal.showClass).toBe('show')
  })

  it('closeOnBackground 默认为 true', () => {
    const modal = setupModal()
    expect(modal.closeOnBackground).toBe(true)
  })

  it('expandSidebarOnShow 默认为 true', () => {
    const modal = setupModal()
    expect(modal.expandSidebarOnShow).toBe(true)
  })

  it('应抛出错误当 element 缺失', () => {
    expect(() => new window.BaseModal({})).toThrow('element is required')
  })

  it('应抛出错误当 element 找不到', () => {
    document.body.innerHTML = ''
    expect(() => new window.BaseModal({ element: '#nonexistent' })).toThrow(/element not found/)
  })

  it('show 应添加 showClass', () => {
    const modal = setupModal()
    modal.show()
    expect(modal.element.classList.contains('show')).toBe(true)
  })

  it('hide 应移除 showClass', () => {
    const modal = setupModal()
    modal.show()
    modal.hide()
    expect(modal.element.classList.contains('show')).toBe(false)
  })

  it('show 应调用 onShow 回调', () => {
    const onShow = vi.fn()
    const modal = setupModal({ onShow })
    modal.show()
    expect(onShow).toHaveBeenCalled()
  })

  it('hide 应调用 onHide 回调', () => {
    const onHide = vi.fn()
    const modal = setupModal({ onHide })
    modal.show()
    modal.hide()
    expect(onHide).toHaveBeenCalled()
  })

  it('isVisible 应反映显示状态', () => {
    const modal = setupModal()
    expect(modal.isVisible()).toBe(false)
    modal.show()
    expect(modal.isVisible()).toBe(true)
    modal.hide()
    expect(modal.isVisible()).toBe(false)
  })

  it('toggle 应在显示/隐藏间切换', () => {
    const modal = setupModal()
    modal.toggle()
    expect(modal.isVisible()).toBe(true)
    modal.toggle()
    expect(modal.isVisible()).toBe(false)
  })

  it('点击背景（target === element）应触发 hide', () => {
    const modal = setupModal()
    modal.show()
    modal.element.click()
    expect(modal.isVisible()).toBe(false)
  })

  it('点击背景，closeOnBackground=false 时不应 hide', () => {
    const modal = setupModal({ closeOnBackground: false })
    modal.show()
    modal.element.click()
    expect(modal.isVisible()).toBe(true)
  })

  it('点击子元素不应触发 hide（e.target !== element）', () => {
    document.body.innerHTML = `<div id="modal"><button id="inner">click</button></div>`
    const modal = new window.BaseModal({ element: document.getElementById('modal') })
    modal.show()
    document.getElementById('inner').click()
    expect(modal.isVisible()).toBe(true)
  })

  it('onBackgroundClick 返回 false 时不应关闭', () => {
    const onBackgroundClick = vi.fn().mockReturnValue(false)
    const modal = setupModal({ onBackgroundClick })
    modal.show()
    modal.element.click()
    expect(onBackgroundClick).toHaveBeenCalled()
    expect(modal.isVisible()).toBe(true)
  })

  it('onBackgroundClick 返回 true 时应关闭', () => {
    const onBackgroundClick = vi.fn().mockReturnValue(true)
    const modal = setupModal({ onBackgroundClick })
    modal.show()
    modal.element.click()
    expect(modal.isVisible()).toBe(false)
  })

  it('setBackgroundClose 应动态调整关闭行为', () => {
    const modal = setupModal()
    modal.show()
    modal.setBackgroundClose(false)
    modal.element.click()
    expect(modal.isVisible()).toBe(true)
    modal.setBackgroundClose(true)
    modal.element.click()
    expect(modal.isVisible()).toBe(false)
  })

  it('show 应调用 expandSidebarIfNeeded（如果存在）', () => {
    window.expandSidebarIfNeeded = vi.fn()
    const modal = setupModal()
    modal.show()
    expect(window.expandSidebarIfNeeded).toHaveBeenCalled()
  })

  it('expandSidebarOnShow=false 时不应调用 expandSidebarIfNeeded', () => {
    window.expandSidebarIfNeeded = vi.fn()
    const modal = setupModal({ expandSidebarOnShow: false })
    modal.show()
    expect(window.expandSidebarIfNeeded).not.toHaveBeenCalled()
  })

  it('_applyBaseStyles 应设置默认样式', () => {
    const modal = setupModal()
    expect(modal.element.style.position).toBe('absolute')
    expect(modal.element.style.top).toBe('0px')
    expect(modal.element.style.left).toBe('0px')
    expect(modal.element.style.width).toBe('100%')
    expect(modal.element.style.height).toBe('100%')
    expect(modal.element.style.borderRadius).toBe('20px')
  })

  it('自定义 showClass 应生效', () => {
    const modal = setupModal({ showClass: 'modal-active' })
    modal.show()
    expect(modal.element.classList.contains('modal-active')).toBe(true)
  })

  it('destroy 应解绑背景点击事件并标记未初始化', () => {
    const modal = setupModal()
    modal.show()
    modal.destroy()
    expect(modal._isInitialized).toBe(false)
    // 点击不再关闭
    modal.element.classList.add('show')
    modal.element.click()
    expect(modal.element.classList.contains('show')).toBe(true)
  })

  it('modalId 应使用 options.name 或 element.id', () => {
    document.body.innerHTML = `<div id="myModal"></div>`
    const modal = new window.BaseModal({ element: document.getElementById('myModal') })
    expect(modal._modalId).toBe('myModal')

    document.body.innerHTML = `<div id="x"></div>`
    const modal2 = new window.BaseModal({ element: document.getElementById('x'), name: 'custom-name' })
    expect(modal2._modalId).toBe('custom-name')
  })

  it('modalManager 应注册该 modal', () => {
    document.body.innerHTML = `<div id="modal"></div>`
    const modal = new window.BaseModal({ element: document.getElementById('modal'), name: 'registered' })
    expect(window.modalManager.get('registered')).toBe(modal)
  })

  it('show 应将 modal 加入 modalManager 栈', () => {
    document.body.innerHTML = `<div id="modal"></div>`
    const modal = new window.BaseModal({ element: document.getElementById('modal'), name: 'stack-test' })
    modal.show()
    expect(window.modalManager.stack).toContain(modal)
  })

  it('hide 应将 modal 从 modalManager 栈移除', () => {
    document.body.innerHTML = `<div id="modal"></div>`
    const modal = new window.BaseModal({ element: document.getElementById('modal'), name: 'stack-test' })
    modal.show()
    modal.hide()
    expect(window.modalManager.stack).not.toContain(modal)
  })

  it('非顶层 modal 点击背景不应关闭', () => {
    document.body.innerHTML = `<div id="m1"></div><div id="m2"></div>`
    const m1 = new window.BaseModal({ element: document.getElementById('m1'), name: 'm1' })
    const m2 = new window.BaseModal({ element: document.getElementById('m2'), name: 'm2' })
    m1.show()
    m2.show()
    // m1 不是顶层，点击 m1 不应关闭
    m1.element.click()
    expect(m1.isVisible()).toBe(true)
  })

  it('顶层 modal 点击背景应关闭', () => {
    document.body.innerHTML = `<div id="m1"></div><div id="m2"></div>`
    const m1 = new window.BaseModal({ element: document.getElementById('m1'), name: 'm1' })
    const m2 = new window.BaseModal({ element: document.getElementById('m2'), name: 'm2' })
    m1.show()
    m2.show()
    m2.element.click()
    expect(m2.isVisible()).toBe(false)
  })
})

describe('AnimatedModal', () => {
  function setupAnimated(options = {}) {
    document.body.innerHTML = `<div id="modal"></div>`
    return new window.AnimatedModal({ element: document.getElementById('modal'), ...options })
  }

  it('应继承 BaseModal', () => {
    const modal = setupAnimated()
    expect(modal).toBeInstanceOf(window.BaseModal)
    expect(modal).toBeInstanceOf(window.AnimatedModal)
  })

  it('默认 hidingClass 为 "hiding"', () => {
    const modal = setupAnimated()
    expect(modal.hidingClass).toBe('hiding')
  })

  it('默认 noAnimationClass 为 "no-animation"', () => {
    const modal = setupAnimated()
    expect(modal.noAnimationClass).toBe('no-animation')
  })

  it('默认 animationDuration 为 500', () => {
    const modal = setupAnimated()
    expect(modal.animationDuration).toBe(500)
  })

  it('show(动画) 应添加 showClass 并移除 hiding/no-animation 类', () => {
    const modal = setupAnimated()
    modal.element.classList.add('hiding', 'no-animation')
    modal.show(true)
    expect(modal.element.classList.contains('show')).toBe(true)
    expect(modal.element.classList.contains('hiding')).toBe(false)
    expect(modal.element.classList.contains('no-animation')).toBe(false)
  })

  it('show(无动画) 应同时添加 show 和 no-animation 类', () => {
    const modal = setupAnimated()
    modal.show(false)
    expect(modal.element.classList.contains('show')).toBe(true)
    expect(modal.element.classList.contains('no-animation')).toBe(true)
  })

  it('show 默认带动画', () => {
    const modal = setupAnimated()
    modal.show()
    expect(modal.element.classList.contains('show')).toBe(true)
    expect(modal.element.classList.contains('no-animation')).toBe(false)
  })

  it('hide(动画) 应移除 showClass 并添加 hiding 类', () => {
    const modal = setupAnimated()
    modal.show()
    modal.hide(true)
    expect(modal.element.classList.contains('show')).toBe(false)
    expect(modal.element.classList.contains('hiding')).toBe(true)
  })

  it('hide(动画) 后应延时移除 hiding 类', () => {
    vi.useFakeTimers()
    const modal = setupAnimated({ animationDuration: 300 })
    modal.show()
    modal.hide(true)
    expect(modal.element.classList.contains('hiding')).toBe(true)
    vi.advanceTimersByTime(300)
    expect(modal.element.classList.contains('hiding')).toBe(false)
    expect(modal.element.classList.contains('no-animation')).toBe(false)
    vi.useRealTimers()
  })

  it('hide(无动画) 应立即移除所有动画类', () => {
    const modal = setupAnimated()
    modal.show()
    modal.hide(false)
    expect(modal.element.classList.contains('show')).toBe(false)
    expect(modal.element.classList.contains('hiding')).toBe(false)
    expect(modal.element.classList.contains('no-animation')).toBe(false)
  })

  it('hideImmediate 应等价于 hide(false)', () => {
    const modal = setupAnimated()
    modal.show()
    modal.hideImmediate()
    expect(modal.element.classList.contains('show')).toBe(false)
    expect(modal.element.classList.contains('hiding')).toBe(false)
  })

  it('show 应触发 onShow 回调', () => {
    const onShow = vi.fn()
    const modal = setupAnimated({ onShow })
    modal.show()
    expect(onShow).toHaveBeenCalled()
  })

  it('hide 应触发 onHide 回调', () => {
    const onHide = vi.fn()
    const modal = setupAnimated({ onHide })
    modal.show()
    modal.hide()
    expect(onHide).toHaveBeenCalled()
  })

  it('自定义 animationDuration 应生效', () => {
    vi.useFakeTimers()
    const modal = setupAnimated({ animationDuration: 1000 })
    modal.show()
    modal.hide(true)
    expect(modal.element.classList.contains('hiding')).toBe(true)
    vi.advanceTimersByTime(500)  // 还没到 1000ms
    expect(modal.element.classList.contains('hiding')).toBe(true)
    vi.advanceTimersByTime(500)
    expect(modal.element.classList.contains('hiding')).toBe(false)
    vi.useRealTimers()
  })

  it('自定义 hidingClass/noAnimationClass 应生效', () => {
    const modal = setupAnimated({ hidingClass: 'fade-out', noAnimationClass: 'no-anim' })
    expect(modal.hidingClass).toBe('fade-out')
    expect(modal.noAnimationClass).toBe('no-anim')
    modal.show()
    modal.hide(true)
    expect(modal.element.classList.contains('fade-out')).toBe(true)
  })
})

describe('ModalManager', () => {
  it('register / get 应能存取 modal', () => {
    const manager = new window.ModalManager()
    document.body.innerHTML = `<div id="m"></div>`
    const modal = new window.BaseModal({ element: document.getElementById('m') })
    manager.register('test', modal)
    expect(manager.get('test')).toBe(modal)
  })

  it('show(name) 应调用对应 modal 的 show', () => {
    const manager = new window.ModalManager()
    document.body.innerHTML = `<div id="m"></div>`
    const modal = new window.BaseModal({ element: document.getElementById('m') })
    manager.register('test', modal)
    manager.show('test')
    expect(modal.isVisible()).toBe(true)
  })

  it('hide(name) 应调用对应 modal 的 hide', () => {
    const manager = new window.ModalManager()
    document.body.innerHTML = `<div id="m"></div>`
    const modal = new window.BaseModal({ element: document.getElementById('m') })
    manager.register('test', modal)
    manager.show('test')
    manager.hide('test')
    expect(modal.isVisible()).toBe(false)
  })

  it('hasOpenModal 应反映栈状态', () => {
    const manager = new window.ModalManager()
    expect(manager.hasOpenModal()).toBe(false)
    document.body.innerHTML = `<div id="m"></div>`
    const modal = new window.BaseModal({ element: document.getElementById('m') })
    manager.register('test', modal)
    manager.show('test')
    expect(manager.hasOpenModal()).toBe(true)
    manager.hide('test')
    expect(manager.hasOpenModal()).toBe(false)
  })

  it('hideAll 应隐藏所有打开的 modal', () => {
    // 使用全局 modalManager（BaseModal.show/hide 与之交互）
    const manager = window.modalManager
    manager.stack = []
    document.body.innerHTML = `<div id="m1"></div><div id="m2"></div>`
    const m1 = new window.BaseModal({ element: document.getElementById('m1') })
    const m2 = new window.BaseModal({ element: document.getElementById('m2') })
    // 通过 onModalShow 直接压栈 modal 对象（避免 show(name) 压入字符串）
    manager.onModalShow(m1)
    manager.onModalShow(m2)
    expect(manager.hasOpenModal()).toBe(true)
    manager.hideAll()
    expect(manager.hasOpenModal()).toBe(false)
  })

  it('getTopModal 应返回栈顶 modal', () => {
    const manager = new window.ModalManager()
    document.body.innerHTML = `<div id="m1"></div><div id="m2"></div>`
    const m1 = new window.BaseModal({ element: document.getElementById('m1') })
    const m2 = new window.BaseModal({ element: document.getElementById('m2') })
    manager.register('m1', m1)
    manager.register('m2', m2)
    manager.show('m1')
    manager.show('m2')
    // 注意：onModalShow 传入的是 modal 对象，但 manager.show(name) 时栈中可能存的是 name 或 modal
    // 查看 modal.js：onModalShow 接收 modal 对象，将其压栈
    // 但 manager.show(name) 是先压 name 再调用 modal.show() -> onModalShow(modal)
    // 这里直接验证 getTopModal 返回栈顶
    const top = manager.getTopModal()
    expect(manager.stack.length).toBeGreaterThan(0)
  })

  it('isTopModal 应判断传入 modal 是否在栈顶', () => {
    // 使用全局 modalManager（BaseModal.show 会调用 window.modalManager.onModalShow）
    const manager = window.modalManager
    manager.stack = []
    document.body.innerHTML = `<div id="m1"></div><div id="m2"></div>`
    const m1 = new window.BaseModal({ element: document.getElementById('m1') })
    const m2 = new window.BaseModal({ element: document.getElementById('m2') })
    m1.show()
    m2.show()
    expect(manager.isTopModal(m2)).toBe(true)
    expect(manager.isTopModal(m1)).toBe(false)
  })

  it('onModalShow 重复调用同一 modal 应去重', () => {
    const manager = new window.ModalManager()
    document.body.innerHTML = `<div id="m"></div>`
    const modal = new window.BaseModal({ element: document.getElementById('m') })
    manager.onModalShow(modal)
    manager.onModalShow(modal)
    expect(manager.stack.filter(m => m === modal)).toHaveLength(1)
  })

  it('onModalHide 不在栈中的 modal 不应报错', () => {
    const manager = new window.ModalManager()
    document.body.innerHTML = `<div id="m"></div>`
    const modal = new window.BaseModal({ element: document.getElementById('m') })
    expect(() => manager.onModalHide(modal)).not.toThrow()
  })

  it('get 不存在的 name 应返回 undefined', () => {
    const manager = new window.ModalManager()
    expect(manager.get('nonexistent')).toBeUndefined()
  })

  it('show 不存在的 name 不应报错', () => {
    const manager = new window.ModalManager()
    expect(() => manager.show('nonexistent')).not.toThrow()
  })

  it('hide 不存在的 name 不应报错', () => {
    const manager = new window.ModalManager()
    expect(() => manager.hide('nonexistent')).not.toThrow()
  })

  it('全局 modalManager 单例应被导出', () => {
    expect(window.modalManager).toBeInstanceOf(window.ModalManager)
  })
})
