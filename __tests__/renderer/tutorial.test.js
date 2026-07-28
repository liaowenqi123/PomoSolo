/**
 * Tutorial 模块测试
 *
 * 注意：setup.js 在每个测试前清空 DOM，因此 DOM 和 window.DOM 必须在 beforeEach 中重新设置。
 * Tutorial 的 init() 将事件绑定到 DOM 元素，需在 beforeEach 中重新调用以绑定到新元素。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  // 加载 modal 基类（提供 AnimatedModal）
  require('../../src/scripts/modules/modal')
  // 加载 tutorial 模块（IIFE 执行一次，tutorialModal 初始为 null）
  require('../../src/scripts/modules/tutorial')
})

beforeEach(() => {
  // setup.js 清空了 DOM，重新设置
  document.body.innerHTML = `
    <div id="tutorial-modal"></div>
    <button id="ui-tutorial-btn">tutorial</button>
    <button id="tutorial-close">close</button>
    <div class="tutorial-tab active" data-tab="page1">tab1</div>
    <div class="tutorial-tab" data-tab="page2">tab2</div>
    <div class="tutorial-page active" id="tutorial-page1">page1</div>
    <div class="tutorial-page" id="tutorial-page2">page2</div>
  `

  // 设置 window.DOM（tutorial.js init 依赖）
  window.DOM = {
    tutorialBtn: document.getElementById('ui-tutorial-btn'),
    tutorialClose: document.getElementById('tutorial-close'),
    tutorialModal: document.getElementById('tutorial-modal')
  }

  // 重新初始化（将事件处理绑定到新 DOM 元素）
  window.Tutorial.init()
})

describe('Tutorial 模块', () => {
  it('init 应创建 AnimatedModal 实例', () => {
    expect(window.Tutorial).toBeDefined()
    expect(window.Tutorial.init).toBeInstanceOf(Function)
  })

  it('show 应显示教程弹窗', () => {
    window.Tutorial.show()
    expect(document.getElementById('tutorial-modal').classList.contains('show')).toBe(true)
  })

  it('hide 应隐藏教程弹窗', () => {
    window.Tutorial.show()
    window.Tutorial.hide()
    // AnimatedModal hide(动画) 移除 show 类
    expect(document.getElementById('tutorial-modal').classList.contains('show')).toBe(false)
  })

  it('点击 tutorialBtn 应显示教程弹窗', () => {
    document.getElementById('ui-tutorial-btn').click()
    expect(document.getElementById('tutorial-modal').classList.contains('show')).toBe(true)
  })

  it('点击 tutorialClose 应隐藏教程弹窗', () => {
    document.getElementById('ui-tutorial-btn').click()
    document.getElementById('tutorial-close').click()
    expect(document.getElementById('tutorial-modal').classList.contains('show')).toBe(false)
  })

  it('点击 tutorial-tab 应切换 active 类', () => {
    const tabs = document.querySelectorAll('.tutorial-tab')
    const pages = document.querySelectorAll('.tutorial-page')
    tabs[1].click()
    expect(tabs[0].classList.contains('active')).toBe(false)
    expect(tabs[1].classList.contains('active')).toBe(true)
    expect(pages[0].classList.contains('active')).toBe(false)
    expect(pages[1].classList.contains('active')).toBe(true)
  })

  it('点击 tutorial-tab 后切回应正确切换 active', () => {
    const tabs = document.querySelectorAll('.tutorial-tab')
    const pages = document.querySelectorAll('.tutorial-page')
    tabs[1].click()
    tabs[0].click()
    expect(tabs[0].classList.contains('active')).toBe(true)
    expect(tabs[1].classList.contains('active')).toBe(false)
    expect(pages[0].classList.contains('active')).toBe(true)
    expect(pages[1].classList.contains('active')).toBe(false)
  })
})
