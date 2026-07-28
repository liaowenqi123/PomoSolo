/**
 * NoteManager 模块测试
 *
 * 注意：setup.js 在每个测试前清空 DOM，因此 DOM 和 AppState 必须在 beforeEach 中重新设置。
 * noteManager 的 IIFE 闭包状态（noteModal/currentNote）通过 _resetState() 重置。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  // 加载 modal 模块以提供 BaseModal（window.BaseModal 持久化）
  require('../../src/scripts/modules/modal')
  // 加载 noteManager 模块（IIFE 执行一次）
  require('../../src/scripts/modules/noteManager')
})

beforeEach(() => {
  // setup.js 清空了 DOM，重新设置
  document.body.innerHTML = `
    <input id="noteTitleInput" />
    <input id="noteDetailInput" />
    <input id="plan-note-title-input" />
    <input id="plan-note-detail-input" />
    <div id="note-view-modal"></div>
    <h3 id="note-view-title"></h3>
    <p id="note-view-detail"></p>
    <button id="note-view-close-btn">close</button>
  `
  window.AppState = { appMode: 'single' }

  // 重置 modalManager 栈（避免上一个测试的 stack 影响当前测试）
  if (window.modalManager) {
    window.modalManager.stack = []
  }

  // 重置 noteManager 内部状态（noteModal 和 currentNote）
  // 通过 _resetState() 重置闭包变量，避免持久化状态影响测试
  if (window.NoteManager && window.NoteManager._resetState) {
    window.NoteManager._resetState()
  }
})

describe('NoteManager 模块', () => {
  it('init 不应报错', () => {
    expect(() => window.NoteManager.init()).not.toThrow()
  })

  it('getNote 应从输入框读取值', () => {
    document.getElementById('noteTitleInput').value = '标题'
    document.getElementById('noteDetailInput').value = '详细内容'
    const note = window.NoteManager.getNote()
    expect(note.title).toBe('标题')
    expect(note.detail).toBe('详细内容')
  })

  it('getNote 应去除前后空格', () => {
    document.getElementById('noteTitleInput').value = '  trim title  '
    document.getElementById('noteDetailInput').value = '  trim detail  '
    const note = window.NoteManager.getNote()
    expect(note.title).toBe('trim title')
    expect(note.detail).toBe('trim detail')
  })

  it('getNote 输入框不存在时应返回空字符串', () => {
    window.AppState.appMode = 'plan'  // 使用 plan 模式的输入框，但都不存在
    document.body.innerHTML = `<div></div>`
    const note = window.NoteManager.getNote()
    expect(note.title).toBe('')
    expect(note.detail).toBe('')
  })

  it('setNote 应更新输入框', () => {
    window.NoteManager.setNote({ title: 'new title', detail: 'new detail' })
    expect(document.getElementById('noteTitleInput').value).toBe('new title')
    expect(document.getElementById('noteDetailInput').value).toBe('new detail')
  })

  it('setNote 应处理 undefined 字段', () => {
    window.NoteManager.setNote({})
    expect(document.getElementById('noteTitleInput').value).toBe('')
    expect(document.getElementById('noteDetailInput').value).toBe('')
  })

  it('clearNote 应清空输入框', () => {
    document.getElementById('noteTitleInput').value = 'xxx'
    document.getElementById('noteDetailInput').value = 'yyy'
    window.NoteManager.clearNote()
    expect(document.getElementById('noteTitleInput').value).toBe('')
    expect(document.getElementById('noteDetailInput').value).toBe('')
  })

  it('plan 模式应使用 plan-note-* 输入框', () => {
    window.AppState.appMode = 'plan'
    document.getElementById('plan-note-title-input').value = 'plan title'
    document.getElementById('plan-note-detail-input').value = 'plan detail'
    const note = window.NoteManager.getNote()
    expect(note.title).toBe('plan title')
    expect(note.detail).toBe('plan detail')
  })

  it('setNote 在 plan 模式应更新 plan-note-* 输入框', () => {
    window.AppState.appMode = 'plan'
    window.NoteManager.setNote({ title: 'ptitle', detail: 'pdetail' })
    expect(document.getElementById('plan-note-title-input').value).toBe('ptitle')
    expect(document.getElementById('plan-note-detail-input').value).toBe('pdetail')
  })

  it('clearNote 在 plan 模式应清空 plan-note-* 输入框', () => {
    window.AppState.appMode = 'plan'
    document.getElementById('plan-note-title-input').value = 'xxx'
    document.getElementById('plan-note-detail-input').value = 'yyy'
    window.NoteManager.clearNote()
    expect(document.getElementById('plan-note-title-input').value).toBe('')
    expect(document.getElementById('plan-note-detail-input').value).toBe('')
  })

  describe('showViewModal', () => {
    it('title 为空时不应显示', () => {
      window.NoteManager.setNote({ title: '', detail: '' })
      window.NoteManager.showViewModal()
      expect(document.getElementById('note-view-modal').classList.contains('show')).toBe(false)
    })

    it('有 title 时应显示弹窗', () => {
      window.NoteManager.setNote({ title: '我的标题', detail: '我的内容' })
      window.NoteManager.showViewModal()
      expect(document.getElementById('note-view-modal').classList.contains('show')).toBe(true)
      expect(document.getElementById('note-view-title').textContent).toBe('我的标题')
      expect(document.getElementById('note-view-detail').textContent).toBe('我的内容')
    })

    it('detail 为空时显示"（无详细备注）"', () => {
      window.NoteManager.setNote({ title: '标题', detail: '' })
      window.NoteManager.showViewModal()
      expect(document.getElementById('note-view-detail').textContent).toBe('（无详细备注）')
    })

    it('点击关闭按钮应关闭弹窗', () => {
      window.NoteManager.setNote({ title: 'x' })
      window.NoteManager.showViewModal()
      expect(document.getElementById('note-view-modal').classList.contains('show')).toBe(true)
      document.getElementById('note-view-close-btn').click()
      expect(document.getElementById('note-view-modal').classList.contains('show')).toBe(false)
    })

    it('多次 showViewModal 应复用同一个 noteModal 实例', () => {
      window.NoteManager.setNote({ title: 'first' })
      window.NoteManager.showViewModal()
      window.NoteManager.setNote({ title: 'second' })
      window.NoteManager.showViewModal()
      expect(document.getElementById('note-view-modal').classList.contains('show')).toBe(true)
    })
  })
})
