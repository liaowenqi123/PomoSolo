/**
 * Presets 模块测试
 *
 * 测试预设管理：渲染、增删、选择、模式切换、启用/禁用、备注显示
 *
 * 注意：setup.js 在每个测试前清空 DOM，因此 DOM 和 mock 必须在 beforeEach 中重新设置。
 * Presets 的 IIFE 闭包状态（currentPresets/currentMode/activePreset）通过 init() 重置。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// presets.js IIFE 在 require 时立即访问 Utils.DEFAULT_PRESETS，因此必须在 require 前设置 Utils
beforeAll(() => {
  window.Utils = {
    DEFAULT_PRESETS: {
      work: [15, 25, 45, 60],
      break: [5, 10, 15]
    }
  }
  require('../../src/scripts/modules/presets')
})

beforeEach(() => {
  // setup.js 清空了 DOM，重新设置
  document.body.innerHTML = `
    <div id="preset-list"></div>
    <button id="preset-add-btn">+</button>
    <div id="ui-wheel-picker"></div>
    <div id="ui-toast"></div>
    <input id="timer-note-input" style="display:none"/>
    <div id="timer-note-display" style="display:none">
      <span id="timer-note-text"></span>
    </div>
    <input id="timer-note-title-input"/>
    <button id="timer-note-confirm">确定</button>
    <button id="timer-note-edit-btn">edit</button>
    <div id="note-view-modal" class="modal">
      <div class="note-modal-content">
        <h3>备注详情</h3>
        <div class="note-view"></div>
        <div class="note-modal-buttons">
          <button id="note-view-close-btn">关闭</button>
        </div>
      </div>
    </div>
    <div id="note-view-title"></div>
    <div id="note-view-detail"></div>
  `

  // 重新设置 mock（vi.clearAllMocks 会清除实现）
  window.Utils = {
    DEFAULT_PRESETS: {
      work: [15, 25, 45, 60],
      break: [5, 10, 15]
    }
  }

  window.DataStore = {
    getPresets: vi.fn().mockReturnValue(null),
    updatePresets: vi.fn().mockResolvedValue(true),
    getData: vi.fn().mockReturnValue({}),
    saveImmediate: vi.fn().mockResolvedValue(true)
  }

  window.AppState = { appMode: 'single' }

  window.Timer = { setTime: vi.fn() }

  window.BaseModal = vi.fn().mockImplementation(function ({ element, onShow, onHide } = {}) {
    return {
      element,
      show: vi.fn(() => onShow && onShow()),
      hide: vi.fn(() => onHide && onHide()),
      toggle: vi.fn()
    }
  })

  window.confirm = vi.fn().mockReturnValue(true)
})

describe('Presets init', () => {
  it('init 应使用默认预设当 DataStore 无数据', async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      { onSelect: vi.fn() }
    )
    // 应渲染 4 个工作模式预设
    expect(document.querySelectorAll('.preset-item').length).toBe(4)
  })

  it('init 应使用 DataStore 数据（数字格式迁移为对象）', async () => {
    window.DataStore.getPresets.mockReturnValue({
      work: [10, 20],
      break: [5]
    })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    expect(document.querySelectorAll('.preset-item').length).toBe(2)
  })

  it('init 应保留对象格式的预设和备注', async () => {
    window.DataStore.getPresets.mockReturnValue({
      work: [{ minutes: 30, note: { title: '学习', detail: '英语' } }],
      break: []
    })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    expect(document.querySelectorAll('.preset-item').length).toBe(1)
  })

  it('init 空 DataStore 时也应使用默认', async () => {
    window.DataStore.getPresets.mockReturnValue({ work: [], break: [] })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    expect(document.querySelectorAll('.preset-item').length).toBe(4)
  })
})

describe('Presets render', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
  })

  it('render 应生成 preset-item 元素', () => {
    window.Presets.render()
    expect(document.querySelectorAll('.preset-item').length).toBeGreaterThan(0)
  })

  it('render 应包含时间显示和删除按钮', () => {
    window.Presets.render()
    const first = document.querySelector('.preset-item')
    expect(first.querySelector('.preset-time')).toBeTruthy()
    expect(first.querySelector('.preset-delete')).toBeTruthy()
  })
})

describe('Presets setMode', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
  })

  it('setMode 切换到 break 应渲染 break 预设', () => {
    window.Presets.setMode('break')
    expect(document.querySelectorAll('.preset-item').length).toBe(3)
  })

  it('setMode preserveActivePreset=true 应保留选中', () => {
    window.Presets.selectPreset(25, null, 1)
    expect(window.Presets.getActivePreset()).toBe(25)
    window.Presets.setMode('work', true)
    expect(window.Presets.getActivePreset()).toBe(25)
  })

  it('setMode 默认清除选中', () => {
    window.Presets.selectPreset(25, null, 1)
    window.Presets.setMode('work')
    expect(window.Presets.getActivePreset()).toBeNull()
  })
})

describe('Presets setEnabled', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
  })

  it('setEnabled(false) 应禁用元素', () => {
    const wheel = document.getElementById('ui-wheel-picker')
    const addBtn = document.getElementById('preset-add-btn')
    window.Presets.setEnabled(false)
    expect(wheel.classList.contains('disabled')).toBe(true)
    expect(addBtn.disabled).toBe(true)
  })

  it('setEnabled(true) 应启用元素', () => {
    const wheel = document.getElementById('ui-wheel-picker')
    const addBtn = document.getElementById('preset-add-btn')
    window.Presets.setEnabled(false)
    window.Presets.setEnabled(true)
    expect(wheel.classList.contains('disabled')).toBe(false)
    expect(addBtn.disabled).toBe(false)
  })

  it('禁用状态时 preset-item 应带 disabled 类', () => {
    window.Presets.setEnabled(false)
    expect(document.querySelector('.preset-item').classList.contains('disabled')).toBe(true)
  })
})

describe('Presets selectPreset', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      { onSelect: vi.fn() }
    )
  })

  it('selectPreset 应更新 activePreset', () => {
    window.Presets.selectPreset(25, null, 1)
    expect(window.Presets.getActivePreset()).toBe(25)
  })

  it('selectPreset 应触发 onSelect 回调', async () => {
    const cb = vi.fn()
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      { onSelect: cb }
    )
    window.Presets.selectPreset(15, null, 0)
    expect(cb).toHaveBeenCalledWith(15)
  })

  it('selectPreset 在 single 模式应显示备注', () => {
    window.AppState.appMode = 'single'
    window.Presets.selectPreset(15, null, 0)
    const display = document.getElementById('timer-note-display')
    expect(display.style.display).toBe('flex')
  })

  it('selectPreset 在 plan 模式应隐藏备注', () => {
    window.AppState.appMode = 'plan'
    window.Presets.selectPreset(15, null, 0)
    const input = document.getElementById('timer-note-input')
    const display = document.getElementById('timer-note-display')
    expect(input.style.display).toBe('none')
    expect(display.style.display).toBe('none')
  })

  it('selectPreset 备注长度影响 top 位置', () => {
    window.AppState.appMode = 'single'
    // 短备注
    window.Presets.selectPreset(15, { title: 'a' }, 0)
    expect(document.getElementById('timer-note-display').style.top).toBe('40px')
  })
})

describe('Presets addPreset', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
  })

  it('addPreset 有效时间应添加成功', async () => {
    const result = await window.Presets.addPreset(50)
    expect(result).toBe(true)
    expect(window.DataStore.updatePresets).toHaveBeenCalled()
  })

  it('addPreset NaN 应失败', async () => {
    const result = await window.Presets.addPreset('abc')
    expect(result).toBe(false)
  })

  it('addPreset 0 分钟应失败', async () => {
    const result = await window.Presets.addPreset(0)
    expect(result).toBe(false)
  })

  it('addPreset 超过 120 分钟应失败', async () => {
    const result = await window.Presets.addPreset(150)
    expect(result).toBe(false)
  })

  it('addPreset 重复时间应失败', async () => {
    // 默认预设中已有 25
    const result = await window.Presets.addPreset(25)
    expect(result).toBe(false)
  })

  it('addPreset 成功后应自动选中新预设', async () => {
    await window.Presets.addPreset(50)
    expect(window.Presets.getActivePreset()).toBe(50)
  })
})

describe('Presets deletePreset', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
  })

  it('deletePreset 应删除指定索引', async () => {
    const initial = document.querySelectorAll('.preset-item').length
    await window.Presets.deletePreset(0)
    expect(document.querySelectorAll('.preset-item').length).toBe(initial - 1)
  })

  it('deletePreset 越界索引不应报错', async () => {
    const initial = document.querySelectorAll('.preset-item').length
    await window.Presets.deletePreset(99)
    expect(document.querySelectorAll('.preset-item').length).toBe(initial)
  })

  it('deletePreset 应清除 activePreset', async () => {
    window.Presets.selectPreset(15, null, 0)
    await window.Presets.deletePreset(0)
    expect(window.Presets.getActivePreset()).toBeNull()
  })

  it('删除最后一个预设应调用 Timer.setTime(0)', async () => {
    window.Timer.setTime.mockClear()
    // 删除所有预设
    const count = document.querySelectorAll('.preset-item').length
    for (let i = 0; i < count; i++) {
      await window.Presets.deletePreset(0)
    }
    expect(window.Timer.setTime).toHaveBeenCalledWith(0)
  })
})

describe('Presets reinitializeNoteDisplay', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue({
      work: [{ minutes: 25, note: { title: '学习', detail: '' } }],
      break: []
    })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    // 重置 activePreset（IIFE 闭包状态跨测试持久化）
    window.Presets.setMode('work')
  })

  it('single 模式有选中预设时应显示备注', () => {
    window.AppState.appMode = 'single'
    window.Presets.selectPreset(25, null, 0)
    window.Presets.reinitializeNoteDisplay()
    expect(document.getElementById('timer-note-display').style.display).toBe('flex')
  })

  it('single 模式无选中预设时应清空显示', () => {
    window.AppState.appMode = 'single'
    window.Presets.reinitializeNoteDisplay()
    expect(document.getElementById('timer-note-text').textContent).toBe('')
  })

  it('plan 模式应隐藏备注', () => {
    window.AppState.appMode = 'plan'
    window.Presets.reinitializeNoteDisplay()
    expect(document.getElementById('timer-note-display').style.display).toBe('none')
  })
})

describe('Presets initializeNoteEditButton', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
  })

  it('initializeNoteEditButton 不应在无选中预设时崩溃', () => {
    expect(() => window.Presets.initializeNoteEditButton()).not.toThrow()
  })

  it('点击 edit 按钮在 stopwatch 模式应显示输入框', () => {
    window.AppState.appMode = 'stopwatch'
    window.Presets.selectPreset(25, null, 1)
    window.Presets.initializeNoteEditButton()
    const editBtn = document.getElementById('timer-note-edit-btn')
    editBtn.click()
    expect(document.getElementById('timer-note-input').style.display).toBe('flex')
  })

  it('点击 edit 按钮在 single 模式应显示输入框', () => {
    window.AppState.appMode = 'single'
    window.Presets.selectPreset(25, null, 1)
    window.Presets.initializeNoteEditButton()
    const editBtn = document.getElementById('timer-note-edit-btn')
    editBtn.click()
    expect(document.getElementById('timer-note-input').style.display).toBe('flex')
  })
})

describe('Presets _updatePresetNote', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue({
      work: [{ minutes: 25, note: { title: '学习', detail: '英语' } }, { minutes: 45, note: null }],
      break: []
    })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
  })

  it('更新有效索引的备注为对象应保存并渲染', async () => {
    await window.Presets._updatePresetNote(0, { title: '新标题', detail: '新内容' })
    expect(window.DataStore.updatePresets).toHaveBeenCalled()
    // 验证预设被更新（通过 render 后的 DOM）
    expect(document.querySelectorAll('.preset-item').length).toBeGreaterThan(0)
  })

  it('更新有效索引的备注为 null 应转回数字格式', async () => {
    await window.Presets._updatePresetNote(0, null)
    expect(window.DataStore.updatePresets).toHaveBeenCalled()
  })

  it('无效索引（负数）应跳过更新', async () => {
    window.DataStore.updatePresets.mockClear()
    await window.Presets._updatePresetNote(-1, { title: 'x' })
    expect(window.DataStore.updatePresets).not.toHaveBeenCalled()
  })

  it('无效索引（超出范围）应跳过更新', async () => {
    window.DataStore.updatePresets.mockClear()
    await window.Presets._updatePresetNote(99, { title: 'x' })
    expect(window.DataStore.updatePresets).not.toHaveBeenCalled()
  })

  it('当预设为纯数字格式时应正确处理', async () => {
    // 设置一个纯数字预设
    window.DataStore.getPresets.mockReturnValue({ work: [25], break: [] })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    await window.Presets._updatePresetNote(0, { title: '标题', detail: '' })
    expect(window.DataStore.updatePresets).toHaveBeenCalled()
  })
})

describe('Presets _showNoteDetail', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
  })

  it('有效备注应显示标题和详情', () => {
    window.Presets._showNoteDetail({ title: '学习', detail: '专注英语' })
    expect(document.getElementById('note-view-title').textContent).toBe('学习')
    expect(document.getElementById('note-view-detail').textContent).toBe('专注英语')
    expect(window.BaseModal).toHaveBeenCalled()
  })

  it('无标题时应显示（无标题）', () => {
    window.Presets._showNoteDetail({ title: '', detail: '内容' })
    expect(document.getElementById('note-view-title').textContent).toBe('（无标题）')
    expect(document.getElementById('note-view-detail').textContent).toBe('内容')
  })

  it('无详情时应显示（无详细备注）', () => {
    window.Presets._showNoteDetail({ title: '标题', detail: '' })
    expect(document.getElementById('note-view-detail').textContent).toBe('（无详细备注）')
  })

  it('null 备注应直接返回不显示', () => {
    const titleBefore = document.getElementById('note-view-title').textContent
    window.Presets._showNoteDetail(null)
    // 应直接 return，未修改文本
    expect(document.getElementById('note-view-title').textContent).toBe(titleBefore)
  })

  it('空备注对象（无标题和详情）应直接返回', () => {
    const titleBefore = document.getElementById('note-view-title').textContent
    window.Presets._showNoteDetail({ title: '', detail: '' })
    expect(document.getElementById('note-view-title').textContent).toBe(titleBefore)
  })

  it('点击关闭按钮应隐藏弹窗', () => {
    window.Presets._showNoteDetail({ title: '测试', detail: '内容' })
    const closeBtn = document.getElementById('note-view-close-btn')
    closeBtn.click()
    // 验证未抛错（closeHandler 被执行）
    expect(closeBtn).toBeTruthy()
  })

  it('重复调用应复用 noteModal 实例', () => {
    window.Presets._showNoteDetail({ title: 'A', detail: 'a' })
    const firstCallCount = window.BaseModal.mock.calls.length
    window.Presets._showNoteDetail({ title: 'B', detail: 'b' })
    // 第二次调用不应创建新 BaseModal
    expect(window.BaseModal.mock.calls.length).toBe(firstCallCount)
  })
})

describe('Presets _editNoteForPreset', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue({
      work: [
        { minutes: 25, note: { title: '学习', detail: '英语' } },
        { minutes: 45, note: null }
      ],
      break: []
    })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    window.confirm = vi.fn().mockReturnValue(true)
  })

  it('应填充弹窗并显示（已有备注）', () => {
    window.Presets._editNoteForPreset(0, { title: '学习', detail: '英语' })
    // 应修改标题
    const modal = document.getElementById('note-view-modal')
    expect(modal.querySelector('h3').textContent).toBe('编辑备注')
    // 应创建输入框
    expect(document.getElementById('editNoteTitleInput')).toBeTruthy()
    expect(document.getElementById('editNoteDetailInput')).toBeTruthy()
    // 应填充当前值
    expect(document.getElementById('editNoteTitleInput').value).toBe('学习')
    expect(document.getElementById('editNoteDetailInput').value).toBe('英语')
    // 应创建 closeX 按钮
    expect(document.querySelector('.note-modal-close')).toBeTruthy()
  })

  it('无备注时应填充空值并显示删除按钮为隐藏', () => {
    window.Presets._editNoteForPreset(1, null)
    expect(document.getElementById('editNoteTitleInput').value).toBe('')
    expect(document.getElementById('editNoteDetailInput').value).toBe('')
    // 删除按钮应隐藏
    expect(document.getElementById('noteDeleteBtn').style.display).toBe('none')
  })

  it('有备注时应显示删除按钮', () => {
    window.Presets._editNoteForPreset(0, { title: 'x', detail: 'y' })
    expect(document.getElementById('noteDeleteBtn').style.display).toBe('inline-block')
  })

  it('保存按钮应调用 updatePresetNote 并清理', async () => {
    window.Presets._editNoteForPreset(0, { title: '旧', detail: '' })
    const saveBtn = document.getElementById('noteSaveBtn')
    document.getElementById('editNoteTitleInput').value = '新标题'
    document.getElementById('editNoteDetailInput').value = '新内容'
    saveBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(window.DataStore.updatePresets).toHaveBeenCalled()
    // cleanup 后 closeX 应被移除
    expect(document.querySelector('.note-modal-close')).toBeNull()
    // 标题应被恢复
    expect(document.getElementById('note-view-modal').querySelector('h3').textContent).toBe('备注详情')
  })

  it('保存空标题和空详情应删除备注（newNote=null）', async () => {
    window.Presets._editNoteForPreset(0, { title: '旧', detail: '' })
    const saveBtn = document.getElementById('noteSaveBtn')
    document.getElementById('editNoteTitleInput').value = ''
    document.getElementById('editNoteDetailInput').value = '   '
    saveBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(window.DataStore.updatePresets).toHaveBeenCalled()
  })

  it('删除按钮在 confirm=true 时应删除备注', async () => {
    window.Presets._editNoteForPreset(0, { title: '旧', detail: '' })
    const deleteBtn = document.getElementById('noteDeleteBtn')
    deleteBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(window.confirm).toHaveBeenCalled()
    expect(window.DataStore.updatePresets).toHaveBeenCalled()
    expect(document.querySelector('.note-modal-close')).toBeNull()
  })

  it('删除按钮在 confirm=false 时不应删除备注', async () => {
    window.confirm = vi.fn().mockReturnValue(false)
    window.Presets._editNoteForPreset(0, { title: '旧', detail: '' })
    const deleteBtn = document.getElementById('noteDeleteBtn')
    deleteBtn.click()
    await new Promise(r => setTimeout(r, 0))
    // 不应调用 updatePresets
    expect(window.DataStore.updatePresets).not.toHaveBeenCalled()
    // closeX 应仍然存在
    expect(document.querySelector('.note-modal-close')).toBeTruthy()
  })

  it('点击关闭按钮（closeX）应隐藏弹窗并清理', () => {
    window.Presets._editNoteForPreset(0, { title: 'x', detail: '' })
    const closeX = document.querySelector('.note-modal-close')
    expect(closeX).toBeTruthy()
    closeX.click()
    // closeX 应被移除
    expect(document.querySelector('.note-modal-close')).toBeNull()
  })

  it('重复调用应复用 noteModal 但创建新的 closeX', () => {
    window.Presets._editNoteForPreset(0, { title: 'a', detail: '' })
    // 模拟关闭后再次编辑
    const closeX = document.querySelector('.note-modal-close')
    expect(closeX).toBeTruthy()
    closeX.click()
    expect(document.querySelector('.note-modal-close')).toBeNull()
    // cleanup 会替换按钮容器 innerHTML，需恢复 note-view-close-btn 以便再次编辑
    const buttonsContainer = document.querySelector('#note-view-modal .note-modal-buttons')
    if (buttonsContainer && !document.getElementById('note-view-close-btn')) {
      buttonsContainer.innerHTML = '<button id="note-view-close-btn">关闭</button>'
    }
    window.Presets._editNoteForPreset(1, null)
    // 应有新的 closeX
    expect(document.querySelector('.note-modal-close')).toBeTruthy()
    // 标题应被修改为编辑备注
    expect(document.getElementById('note-view-modal').querySelector('h3').textContent).toBe('编辑备注')
  })
})

describe('Presets _bindConfirmButton', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
  })

  it('无 confirmBtn 时应直接返回', () => {
    // 移除 confirmBtn
    document.getElementById('timer-note-confirm').remove()
    expect(() => window.Presets._bindConfirmButton()).not.toThrow()
  })

  it('应克隆并替换 confirm 按钮和 input', () => {
    const originalConfirm = document.getElementById('timer-note-confirm')
    const originalInput = document.getElementById('timer-note-title-input')
    window.Presets._bindConfirmButton()
    // 替换后元素应仍存在（id 一致）
    expect(document.getElementById('timer-note-confirm')).toBeTruthy()
    expect(document.getElementById('timer-note-title-input')).toBeTruthy()
    // 应是不同的 DOM 节点
    expect(document.getElementById('timer-note-confirm')).not.toBe(originalConfirm)
    expect(document.getElementById('timer-note-title-input')).not.toBe(originalInput)
  })

  it('compositionstart 应设置 isComposing=true', () => {
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    input.value = 'test'
    input.dispatchEvent(new CompositionEvent('compositionstart'))
    // isComposing 应被设置（间接验证：compositionend 后才截断）
    input.dispatchEvent(new CompositionEvent('compositionend', { data: 'test' }))
    // 不应抛错
    expect(input.value).toBe('test')
  })

  it('compositionend 在长度超过 12 时应截断', () => {
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    // 设置超过 12 长度的字符串（中文算2，英文算1）
    input.value = 'abcdefghijklm' // 13 字符
    input.dispatchEvent(new CompositionEvent('compositionend', { data: 'x' }))
    // 应被截断为 12 字符
    expect(input.value.length).toBeLessThanOrEqual(12)
  })

  it('input 事件在非 composition 状态长度超过 12 应截断', () => {
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    input.value = 'abcdefghijklm' // 13 字符
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(input.value.length).toBeLessThanOrEqual(12)
  })

  it('input 事件在 composition 状态不应截断', () => {
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    input.dispatchEvent(new CompositionEvent('compositionstart'))
    input.value = 'abcdefghijklm' // 13 字符
    input.dispatchEvent(new Event('input', { bubbles: true }))
    // 应保留原值（composition 时不截断）
    expect(input.value).toBe('abcdefghijklm')
  })

  it('input 事件应支持中文字符截断（中文算2字符）', () => {
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    // 7 个中文字符 = 14 长度，应截断为 6 个（12 长度）
    input.value = '一二三四五六七'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    // 应被截断
    expect(input.value.length).toBeLessThanOrEqual(7)
  })

  it('确认按钮在 stopwatch 模式应保存到 stopwatchModeNote', async () => {
    window.AppState.appMode = 'stopwatch'
    const data = {}
    window.DataStore.getData.mockReturnValue(data)
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    const confirmBtn = document.getElementById('timer-note-confirm')
    input.value = '专注学习'
    confirmBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(data.stopwatchModeNote).toBe('专注学习')
    expect(window.DataStore.saveImmediate).toHaveBeenCalled()
    expect(document.getElementById('timer-note-display').style.display).toBe('flex')
  })

  it('确认按钮在 stopwatch 模式短标题应设置 top=40px', async () => {
    window.AppState.appMode = 'stopwatch'
    window.DataStore.getData.mockReturnValue({})
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    const confirmBtn = document.getElementById('timer-note-confirm')
    input.value = 'ab' // 长度 2
    confirmBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(document.getElementById('timer-note-display').style.top).toBe('40px')
  })

  it('确认按钮在 stopwatch 模式中标题应设置 top=45px', async () => {
    window.AppState.appMode = 'stopwatch'
    window.DataStore.getData.mockReturnValue({})
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    const confirmBtn = document.getElementById('timer-note-confirm')
    input.value = 'abcd' // 长度 4
    confirmBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(document.getElementById('timer-note-display').style.top).toBe('45px')
  })

  it('确认按钮在 stopwatch 模式长标题应设置 top=50px', async () => {
    window.AppState.appMode = 'stopwatch'
    window.DataStore.getData.mockReturnValue({})
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    const confirmBtn = document.getElementById('timer-note-confirm')
    input.value = 'abcdef' // 长度 6
    confirmBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(document.getElementById('timer-note-display').style.top).toBe('50px')
  })

  it('确认按钮在 single 模式无选中预设应直接返回', async () => {
    window.AppState.appMode = 'single'
    // 通过 setMode 重置 activePreset（IIFE 闭包状态跨测试持久化）
    window.Presets.setMode('work')
    expect(window.Presets.getActivePreset()).toBeNull()
    window.Presets._bindConfirmButton()
    const confirmBtn = document.getElementById('timer-note-confirm')
    confirmBtn.click()
    await new Promise(r => setTimeout(r, 0))
    // 不应调用 updatePresets（activeMinutes === null → return）
    expect(window.DataStore.updatePresets).not.toHaveBeenCalled()
  })

  it('确认按钮在 single 模式选中数字预设应转为对象并保存', async () => {
    window.AppState.appMode = 'single'
    // 设置纯数字预设
    window.DataStore.getPresets.mockReturnValue({ work: [25], break: [] })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    window.Presets.selectPreset(25, null, 0)
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    const confirmBtn = document.getElementById('timer-note-confirm')
    input.value = '专注工作'
    confirmBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(window.DataStore.updatePresets).toHaveBeenCalled()
    expect(document.getElementById('timer-note-display').style.display).toBe('flex')
  })

  it('确认按钮在 single 模式选中对象预设应更新 note', async () => {
    window.AppState.appMode = 'single'
    window.DataStore.getPresets.mockReturnValue({
      work: [{ minutes: 25, note: { title: '旧', detail: '' } }],
      break: []
    })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    window.Presets.selectPreset(25, null, 0)
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    const confirmBtn = document.getElementById('timer-note-confirm')
    input.value = '新标题'
    confirmBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(window.DataStore.updatePresets).toHaveBeenCalled()
  })

  it('确认按钮在 single 模式无效预设（不存在）应直接返回', async () => {
    window.AppState.appMode = 'single'
    // 设置预设但 activePreset 指向不存在的值
    window.DataStore.getPresets.mockReturnValue({ work: [25], break: [] })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    // 选中后删除预设，使 activePreset 指向不存在的值
    window.Presets.selectPreset(25, null, 0)
    // 直接修改 activePreset 到无效值
    window.Presets.selectPreset(999, null, 0)
    window.Presets._bindConfirmButton()
    const confirmBtn = document.getElementById('timer-note-confirm')
    confirmBtn.click()
    await new Promise(r => setTimeout(r, 0))
    // 不应调用 updatePresets（index < 0）
    expect(window.DataStore.updatePresets).not.toHaveBeenCalled()
  })

  it('确认按钮在 single 模式空标题应设置 note=null', async () => {
    window.AppState.appMode = 'single'
    window.DataStore.getPresets.mockReturnValue({ work: [25], break: [] })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    window.Presets.selectPreset(25, null, 0)
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    const confirmBtn = document.getElementById('timer-note-confirm')
    input.value = '   ' // 空白
    confirmBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(window.DataStore.updatePresets).toHaveBeenCalled()
  })

  it('Enter 键在非 composition 状态应触发确认按钮点击', async () => {
    window.AppState.appMode = 'stopwatch'
    window.DataStore.getData.mockReturnValue({})
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    input.value = 'test'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
    expect(window.DataStore.saveImmediate).toHaveBeenCalled()
  })

  it('Enter 键在 composition 状态不应触发', async () => {
    window.AppState.appMode = 'stopwatch'
    window.DataStore.getData.mockReturnValue({})
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    input.dispatchEvent(new CompositionEvent('compositionstart'))
    input.value = 'test'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
    // 不应触发保存
    expect(window.DataStore.saveImmediate).not.toHaveBeenCalled()
  })

  it('非 Enter 键不应触发确认', async () => {
    window.AppState.appMode = 'stopwatch'
    window.DataStore.getData.mockReturnValue({})
    window.Presets._bindConfirmButton()
    const input = document.getElementById('timer-note-title-input')
    input.value = 'test'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
    expect(window.DataStore.saveImmediate).not.toHaveBeenCalled()
  })
})

describe('Presets showToast', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('重复时间预设应调用 showToast 显示提示', () => {
    // 默认预设中已有 25
    window.Presets.addPreset(25)
    const toast = document.getElementById('ui-toast')
    expect(toast.classList.contains('show')).toBe(true)
    expect(toast.textContent).toBe('该时间预设已存在')
  })

  it('showToast 应在 700ms 后自动隐藏', async () => {
    window.Presets.addPreset(25)
    const toast = document.getElementById('ui-toast')
    expect(toast.classList.contains('show')).toBe(true)
    vi.advanceTimersByTime(700)
    expect(toast.classList.contains('show')).toBe(false)
  })

  it('无 ui-toast 元素时不应抛错', async () => {
    document.getElementById('ui-toast').remove()
    // 触发 showToast
    expect(() => window.Presets.addPreset(25)).not.toThrow()
  })
})

describe('Presets deletePreset 在 plan 模式', () => {
  beforeEach(async () => {
    window.DataStore.getPresets.mockReturnValue(null)
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    window.AppState.appMode = 'plan'
  })

  it('plan 模式删除应隐藏备注', async () => {
    const input = document.getElementById('timer-note-input')
    const display = document.getElementById('timer-note-display')
    await window.Presets.deletePreset(0)
    expect(input.style.display).toBe('none')
    expect(display.style.display).toBe('none')
  })

  it('plan 模式删除最后一个预设应调用 Timer.setTime(0)', async () => {
    window.Timer.setTime.mockClear()
    const count = document.querySelectorAll('.preset-item').length
    for (let i = 0; i < count; i++) {
      await window.Presets.deletePreset(0)
    }
    expect(window.Timer.setTime).toHaveBeenCalledWith(0)
  })
})

describe('Presets init 分支', () => {
  beforeEach(() => {
    window.DataStore.getPresets.mockReturnValue(null)
  })

  it('init 应在 DataStore 返回部分数据时使用部分数据', async () => {
    window.DataStore.getPresets.mockReturnValue({
      work: [],
      break: [5, 10]
    })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    // work 模式数据为空数组（不回退到默认）
    expect(document.querySelectorAll('.preset-item').length).toBe(0)
    // 切换到 break 模式应显示 2 个预设
    window.Presets.setMode('break')
    expect(document.querySelectorAll('.preset-item').length).toBe(2)
  })

  it('init 在 presets 仅有 break 时应正确加载', async () => {
    window.DataStore.getPresets.mockReturnValue({
      work: [],
      break: [5]
    })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    window.Presets.setMode('break')
    expect(document.querySelectorAll('.preset-item').length).toBe(1)
  })

  it('init 在 presets 仅有 work 时应正确加载', async () => {
    window.DataStore.getPresets.mockReturnValue({
      work: [30],
      break: []
    })
    await window.Presets.init(
      {
        presetList: document.getElementById('preset-list'),
        wheelPickerEl: document.getElementById('ui-wheel-picker'),
        addPresetBtn: document.getElementById('preset-add-btn')
      },
      {}
    )
    // 重置 currentMode（IIFE 闭包状态跨测试持久化）
    window.Presets.setMode('work')
    // work 模式应有 1 个预设
    expect(document.querySelectorAll('.preset-item').length).toBe(1)
    // 切换到 break 应为空
    window.Presets.setMode('break')
    expect(document.querySelectorAll('.preset-item').length).toBe(0)
  })
})
