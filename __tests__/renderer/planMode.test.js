/**
 * PlanMode 模块测试
 *
 * 测试番茄计划模式：渲染、增删、拖拽、开始/停止/下一项、状态查询
 *
 * 注意：setup.js 在每个测试前清空 DOM，因此 DOM 和 mock 必须在 beforeEach 中重新设置。
 * PlanMode 的 IIFE 闭包状态（planList/currentIndex/isRunning）持久化，
 * 通过 stopPlan() + init() 在 beforeEach 中重置。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/planMode')
})

beforeEach(() => {
  // setup.js 清空了 DOM，重新设置
  document.body.innerHTML = `
    <div id="plan-list"></div>
    <div id="note-view-modal" class="modal">
      <div class="note-modal-content">
        <h3>备注详情</h3>
        <div class="note-view"></div>
        <div class="note-modal-buttons"></div>
      </div>
    </div>
  `

  // 重新设置 mock（vi.clearAllMocks 会清除实现）
  window.DataStore = {
    getData: vi.fn().mockReturnValue({ planList: [] }),
    updatePlanList: vi.fn().mockResolvedValue(true)
  }

  window.BaseModal = vi.fn().mockImplementation(function ({ element } = {}) {
    return {
      element,
      show: vi.fn(),
      hide: vi.fn(),
      toggle: vi.fn()
    }
  })

  // 先 init 设置 elements（使 render() 可用），再 stopPlan 重置 isRunning/currentIndex
  window.PlanMode.init(
    { planList: document.getElementById('plan-list') },
    {}
  )
  window.PlanMode.stopPlan()
})

describe('PlanMode init', () => {
  it('init 应加载计划列表', () => {
    window.DataStore.getData.mockReturnValue({
      planList: [{ id: '1', minutes: 25, type: 'work', note: null }]
    })
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    expect(document.querySelectorAll('.plan-item').length).toBe(1)
  })

  it('init 无计划列表时应渲染空', () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    expect(document.querySelectorAll('.plan-item').length).toBe(0)
  })

  it('init 非数组 planList 应被忽略', () => {
    window.DataStore.getData.mockReturnValue({ planList: 'invalid' })
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    expect(document.querySelectorAll('.plan-item').length).toBe(0)
  })
})

describe('PlanMode addItem', () => {
  beforeEach(() => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
  })

  it('addItem 应添加项目并保存', async () => {
    const item = await window.PlanMode.addItem(25, 'work')
    expect(item).toBeTruthy()
    expect(item.minutes).toBe(25)
    expect(item.type).toBe('work')
    expect(item.id).toBeDefined()
    expect(window.DataStore.updatePlanList).toHaveBeenCalled()
    expect(document.querySelectorAll('.plan-item').length).toBe(1)
  })

  it('addItem 应支持 note', async () => {
    const item = await window.PlanMode.addItem(15, 'break', { title: '休息', detail: '' })
    expect(item.note).toEqual({ title: '休息', detail: '' })
  })

  it('addItem 字符串 minutes 应转换为数字', async () => {
    const item = await window.PlanMode.addItem('30', 'work')
    expect(item.minutes).toBe(30)
  })
})

describe('PlanMode deleteItem', () => {
  beforeEach(async () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    await window.PlanMode.addItem(25, 'work')
    await window.PlanMode.addItem(5, 'break')
    await window.PlanMode.addItem(45, 'work')
  })

  it('deleteItem 应删除指定索引', async () => {
    await window.PlanMode.deleteItem(0)
    expect(document.querySelectorAll('.plan-item').length).toBe(2)
  })

  it('deleteItem 越界索引不应报错', async () => {
    const initial = document.querySelectorAll('.plan-item').length
    await window.PlanMode.deleteItem(99)
    expect(document.querySelectorAll('.plan-item').length).toBe(initial)
  })
})

describe('PlanMode startPlan / nextItem / stopPlan', () => {
  beforeEach(async () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    await window.PlanMode.addItem(25, 'work')
    await window.PlanMode.addItem(5, 'break')
    await window.PlanMode.addItem(45, 'work')
  })

  it('startPlan 应返回第一项并标记运行', () => {
    const first = window.PlanMode.startPlan()
    expect(first).toBeTruthy()
    expect(first.minutes).toBe(25)
    const status = window.PlanMode.getPlanStatus()
    expect(status.isRunning).toBe(true)
    expect(status.currentIndex).toBe(0)
  })

  it('startPlan 空列表应返回 false', async () => {
    await window.PlanMode.clearAll()
    expect(window.PlanMode.startPlan()).toBe(false)
  })

  it('nextItem 应推进到下一项', () => {
    window.PlanMode.startPlan()
    const next = window.PlanMode.nextItem()
    expect(next.minutes).toBe(5)
    expect(window.PlanMode.getPlanStatus().currentIndex).toBe(1)
  })

  it('nextItem 超出范围应停止计划', () => {
    window.PlanMode.startPlan()
    window.PlanMode.nextItem()
    window.PlanMode.nextItem()
    const result = window.PlanMode.nextItem()
    expect(result).toBeNull()
    expect(window.PlanMode.getPlanStatus().isRunning).toBe(false)
  })

  it('stopPlan 应停止并重置索引', () => {
    window.PlanMode.startPlan()
    window.PlanMode.stopPlan()
    const status = window.PlanMode.getPlanStatus()
    expect(status.isRunning).toBe(false)
    expect(status.currentIndex).toBe(-1)
  })
})

describe('PlanMode getPlanStatus', () => {
  beforeEach(async () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    await window.PlanMode.addItem(25, 'work')
    await window.PlanMode.addItem(5, 'break')
  })

  it('未运行时 status 应正确', () => {
    const status = window.PlanMode.getPlanStatus()
    expect(status.isRunning).toBe(false)
    expect(status.currentIndex).toBe(-1)
    expect(status.totalItems).toBe(2)
    expect(status.remainingItems).toBe(2)
  })

  it('运行中 status 应反映当前项', () => {
    window.PlanMode.startPlan()
    const status = window.PlanMode.getPlanStatus()
    expect(status.isRunning).toBe(true)
    expect(status.currentItem).toBeTruthy()
    expect(status.remainingItems).toBe(1)
  })
})

describe('PlanMode getCurrentItem / getFirstItem / hasPlan', () => {
  beforeEach(async () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    await window.PlanMode.addItem(25, 'work')
    await window.PlanMode.addItem(5, 'break')
  })

  it('getCurrentItem 未运行时返回 null', () => {
    expect(window.PlanMode.getCurrentItem()).toBeNull()
  })

  it('getCurrentItem 运行时返回当前项', () => {
    window.PlanMode.startPlan()
    const current = window.PlanMode.getCurrentItem()
    expect(current).toBeTruthy()
    expect(current.minutes).toBe(25)
  })

  it('getFirstItem 返回第一项', () => {
    const first = window.PlanMode.getFirstItem()
    expect(first).toBeTruthy()
    expect(first.minutes).toBe(25)
  })

  it('hasPlan 有计划时返回 true', () => {
    expect(window.PlanMode.hasPlan()).toBe(true)
  })

  it('hasPlan 无计划时返回 false', async () => {
    await window.PlanMode.clearAll()
    expect(window.PlanMode.hasPlan()).toBe(false)
  })
})

describe('PlanMode clearAll', () => {
  beforeEach(async () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    await window.PlanMode.addItem(25, 'work')
  })

  it('clearAll 应清空列表', async () => {
    await window.PlanMode.clearAll()
    expect(document.querySelectorAll('.plan-item').length).toBe(0)
    expect(window.PlanMode.hasPlan()).toBe(false)
  })
})

describe('PlanMode render 行为', () => {
  beforeEach(() => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      { onFirstItemChange: vi.fn(), onTimeUpdate: vi.fn() }
    )
  })

  it('render 应触发 onFirstItemChange 回调', async () => {
    const cbs = { onFirstItemChange: vi.fn(), onTimeUpdate: vi.fn() }
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      cbs
    )
    await window.PlanMode.addItem(25, 'work')
    expect(cbs.onFirstItemChange).toHaveBeenCalled()
  })

  it('render 单项时不显示删除按钮', async () => {
    await window.PlanMode.addItem(25, 'work')
    expect(document.querySelector('.plan-item-delete')).toBeNull()
  })

  it('render 多项时显示删除按钮', async () => {
    await window.PlanMode.addItem(25, 'work')
    await window.PlanMode.addItem(5, 'break')
    expect(document.querySelector('.plan-item-delete')).toBeTruthy()
  })

  it('render 运行中应禁用拖拽', async () => {
    await window.PlanMode.addItem(25, 'work')
    await window.PlanMode.addItem(5, 'break')
    window.PlanMode.startPlan()
    const firstItem = document.querySelector('.plan-item')
    expect(firstItem.classList.contains('disabled')).toBe(true)
    expect(firstItem.draggable).toBe(false)
  })

  it('render 当前运行项应带 active 类', async () => {
    await window.PlanMode.addItem(25, 'work')
    await window.PlanMode.addItem(5, 'break')
    window.PlanMode.startPlan()
    const firstItem = document.querySelector('.plan-item')
    expect(firstItem.classList.contains('active')).toBe(true)
  })

  it('render 带 note 的项应显示备注图标', async () => {
    await window.PlanMode.addItem(25, 'work', { title: '学习', detail: '' })
    expect(document.querySelector('.preset-note-icon')).toBeTruthy()
  })
})

describe('PlanMode loadPlan', () => {
  it('loadPlan 应从 DataStore 加载', () => {
    window.DataStore.getData.mockReturnValue({
      planList: [{ id: '1', minutes: 30, type: 'work', note: null }]
    })
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    window.PlanMode.loadPlan()
    expect(window.PlanMode.hasPlan()).toBe(true)
  })

  it('loadPlan 无数据时不应报错', () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    expect(() => window.PlanMode.loadPlan()).not.toThrow()
  })
})

// 辅助：创建带 dataTransfer mock 的拖拽事件（jsdom 无 DragEvent）
function createDragEvent(type) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      effectAllowed: '',
      dropEffect: '',
      setData: () => {},
      getData: () => ''
    },
    writable: true,
    configurable: true
  })
  return event
}

describe('PlanMode 拖拽', () => {
  beforeEach(async () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    await window.PlanMode.addItem(25, 'work')
    await window.PlanMode.addItem(5, 'break')
    await window.PlanMode.addItem(45, 'work')
  })

  it('dragstart 应标记 dragging 并设置 effectAllowed', () => {
    const items = document.querySelectorAll('.plan-item')
    const event = createDragEvent('dragstart')
    items[0].dispatchEvent(event)
    expect(items[0].classList.contains('dragging')).toBe(true)
    expect(event.dataTransfer.effectAllowed).toBe('move')
  })

  it('dragend 应移除 dragging 类并清空 draggedItem', () => {
    const items = document.querySelectorAll('.plan-item')
    const startEvent = createDragEvent('dragstart')
    items[0].dispatchEvent(startEvent)
    expect(items[0].classList.contains('dragging')).toBe(true)
    const endEvent = createDragEvent('dragend')
    items[0].dispatchEvent(endEvent)
    expect(items[0].classList.contains('dragging')).toBe(false)
  })

  it('dragover 应添加 drag-over 类', () => {
    const items = document.querySelectorAll('.plan-item')
    const startEvent = createDragEvent('dragstart')
    items[0].dispatchEvent(startEvent)
    const overEvent = createDragEvent('dragover')
    items[1].dispatchEvent(overEvent)
    expect(items[1].classList.contains('drag-over')).toBe(true)
    expect(overEvent.dataTransfer.dropEffect).toBe('move')
  })

  it('dragover 在同一项上不应添加 drag-over', () => {
    const items = document.querySelectorAll('.plan-item')
    const startEvent = createDragEvent('dragstart')
    items[0].dispatchEvent(startEvent)
    const overEvent = createDragEvent('dragover')
    items[0].dispatchEvent(overEvent)
    expect(items[0].classList.contains('drag-over')).toBe(false)
  })

  it('dragleave 应移除 drag-over 类', () => {
    const items = document.querySelectorAll('.plan-item')
    const startEvent = createDragEvent('dragstart')
    items[0].dispatchEvent(startEvent)
    const overEvent = createDragEvent('dragover')
    items[1].dispatchEvent(overEvent)
    expect(items[1].classList.contains('drag-over')).toBe(true)
    const leaveEvent = createDragEvent('dragleave')
    items[1].dispatchEvent(leaveEvent)
    expect(items[1].classList.contains('drag-over')).toBe(false)
  })

  it('drop 应重新排序项目', async () => {
    const items = document.querySelectorAll('.plan-item')
    const startEvent = createDragEvent('dragstart')
    items[0].dispatchEvent(startEvent)
    const dropEvent = createDragEvent('drop')
    items[2].dispatchEvent(dropEvent)
    await new Promise(r => setTimeout(r, 0))
    // 原 [25, 5, 45]，从 0 拖到 2 → [5, 45, 25]
    const newItems = document.querySelectorAll('.plan-item')
    expect(newItems[0].querySelector('.plan-item-time').textContent).toContain('5')
    expect(newItems[2].querySelector('.plan-item-time').textContent).toContain('25')
  })

  it('drop 在同一项上不应重新排序', () => {
    const items = document.querySelectorAll('.plan-item')
    const startEvent = createDragEvent('dragstart')
    items[0].dispatchEvent(startEvent)
    const dropEvent = createDragEvent('drop')
    items[0].dispatchEvent(dropEvent)
    const newItems = document.querySelectorAll('.plan-item')
    expect(newItems[0].querySelector('.plan-item-time').textContent).toContain('25')
  })

  it('dragstart 在运行中应被忽略', () => {
    window.PlanMode.startPlan()
    const items = document.querySelectorAll('.plan-item')
    const event = createDragEvent('dragstart')
    items[0].dispatchEvent(event)
    expect(items[0].classList.contains('dragging')).toBe(false)
  })

  it('dragover 在运行中应被忽略', () => {
    window.PlanMode.startPlan()
    const items = document.querySelectorAll('.plan-item')
    const overEvent = createDragEvent('dragover')
    items[1].dispatchEvent(overEvent)
    expect(items[1].classList.contains('drag-over')).toBe(false)
  })

  it('drop 在运行中应被忽略', () => {
    const items = document.querySelectorAll('.plan-item')
    const startEvent = createDragEvent('dragstart')
    items[0].dispatchEvent(startEvent)
    window.PlanMode.startPlan()
    const newItems = document.querySelectorAll('.plan-item')
    const dropEvent = createDragEvent('drop')
    newItems[1].dispatchEvent(dropEvent)
    const finalItems = document.querySelectorAll('.plan-item')
    expect(finalItems[0].querySelector('.plan-item-time').textContent).toContain('25')
  })
})

describe('PlanMode 备注编辑（editNoteForPlan）', () => {
  beforeEach(async () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    await window.PlanMode.addItem(25, 'work', { title: '学习', detail: '番茄工作法' })
    await window.PlanMode.addItem(5, 'break')
  })

  it('点击备注图标应打开编辑弹窗并填充输入框', () => {
    const noteIcon = document.querySelector('.preset-note-icon')
    expect(noteIcon).toBeTruthy()
    noteIcon.click()
    const titleInput = document.getElementById('editNoteTitleInput')
    expect(titleInput).toBeTruthy()
    expect(titleInput.value).toBe('学习')
    const detailInput = document.getElementById('editNoteDetailInput')
    expect(detailInput.value).toBe('番茄工作法')
    const saveBtn = document.getElementById('noteSaveBtn')
    expect(saveBtn).toBeTruthy()
    const deleteBtn = document.getElementById('noteDeleteBtn')
    expect(deleteBtn).toBeTruthy()
    expect(deleteBtn.style.display).toBe('inline-block')
    // 关闭按钮
    const closeX = document.querySelector('.note-modal-close')
    expect(closeX).toBeTruthy()
    // 标题应被修改
    const titleEl = document.querySelector('#note-view-modal h3')
    expect(titleEl.textContent).toBe('编辑备注')
  })

  it('保存备注应调用 updatePlanList 并清理', async () => {
    const noteIcon = document.querySelector('.preset-note-icon')
    noteIcon.click()
    const titleInput = document.getElementById('editNoteTitleInput')
    titleInput.value = '新标题'
    const detailInput = document.getElementById('editNoteDetailInput')
    detailInput.value = '新内容'
    const saveBtn = document.getElementById('noteSaveBtn')
    saveBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(window.DataStore.updatePlanList).toHaveBeenCalled()
    // cleanup 后 closeX 应被移除
    expect(document.querySelector('.note-modal-close')).toBeNull()
    // buttons 应恢复
    const closeBtn = document.getElementById('noteViewCloseBtn')
    expect(closeBtn).toBeTruthy()
  })

  it('保存空备注应删除备注', async () => {
    const noteIcon = document.querySelector('.preset-note-icon')
    noteIcon.click()
    const titleInput = document.getElementById('editNoteTitleInput')
    titleInput.value = ''
    const detailInput = document.getElementById('editNoteDetailInput')
    detailInput.value = ''
    const saveBtn = document.getElementById('noteSaveBtn')
    saveBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(window.DataStore.updatePlanList).toHaveBeenCalled()
  })

  it('删除备注应调用 updatePlanList', async () => {
    const noteIcon = document.querySelector('.preset-note-icon')
    noteIcon.click()
    const deleteBtn = document.getElementById('noteDeleteBtn')
    deleteBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(window.DataStore.updatePlanList).toHaveBeenCalled()
  })

  it('关闭按钮应隐藏弹窗并清理', () => {
    const noteIcon = document.querySelector('.preset-note-icon')
    noteIcon.click()
    const closeX = document.querySelector('.note-modal-close')
    closeX.click()
    expect(document.querySelector('.note-modal-close')).toBeNull()
  })

  it('运行中点击备注图标不应打开弹窗', () => {
    window.PlanMode.startPlan()
    // 重新查询（render 后 DOM 已更新）
    const noteIcon = document.querySelector('.preset-note-icon')
    if (noteIcon) {
      noteIcon.click()
      expect(document.getElementById('editNoteTitleInput')).toBeNull()
    }
  })
})

describe('PlanMode 删除按钮点击', () => {
  beforeEach(async () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    await window.PlanMode.addItem(25, 'work')
    await window.PlanMode.addItem(5, 'break')
  })

  it('点击删除按钮应删除项目', async () => {
    const deleteBtn = document.querySelector('.plan-item-delete')
    expect(deleteBtn).toBeTruthy()
    deleteBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(document.querySelectorAll('.plan-item').length).toBe(1)
  })

  it('运行中点击删除按钮不应删除', async () => {
    window.PlanMode.startPlan()
    const deleteBtn = document.querySelector('.plan-item-delete')
    deleteBtn.click()
    await new Promise(r => setTimeout(r, 0))
    expect(document.querySelectorAll('.plan-item').length).toBe(2)
  })
})

describe('PlanMode onTimeUpdate 回调', () => {
  it('render 应触发 onTimeUpdate 回调（有项目时传 first.minutes）', async () => {
    const cbs = { onTimeUpdate: vi.fn() }
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      cbs
    )
    await window.PlanMode.addItem(50, 'work')
    expect(cbs.onTimeUpdate).toHaveBeenCalledWith(50)
  })

  it('onTimeUpdate 无计划时传 25', () => {
    const cbs = { onTimeUpdate: vi.fn() }
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      cbs
    )
    expect(cbs.onTimeUpdate).toHaveBeenCalledWith(25)
  })

  it('onFirstItemChange 无计划时不应调用', () => {
    const cbs = { onFirstItemChange: vi.fn() }
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      cbs
    )
    expect(cbs.onFirstItemChange).not.toHaveBeenCalled()
  })
})

describe('PlanMode getFirstItem 边界', () => {
  it('getFirstItem 空列表时返回 null', async () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    expect(window.PlanMode.getFirstItem()).toBeNull()
  })
})

describe('PlanMode deleteItem currentIndex 重置', () => {
  it('删除当前执行项（最后一项）应重置 currentIndex', async () => {
    window.DataStore.getData.mockReturnValue({})
    window.PlanMode.init(
      { planList: document.getElementById('plan-list') },
      {}
    )
    await window.PlanMode.addItem(25, 'work')
    await window.PlanMode.addItem(5, 'break')
    await window.PlanMode.addItem(45, 'work')
    window.PlanMode.startPlan()       // currentIndex = 0
    window.PlanMode.nextItem()        // currentIndex = 1
    window.PlanMode.nextItem()        // currentIndex = 2 (last)
    // 删除最后一项（index 2）
    await window.PlanMode.deleteItem(2)
    // currentIndex (2) >= planList.length (2) → 重置为 1
    const status = window.PlanMode.getPlanStatus()
    expect(status.currentIndex).toBe(1)
  })
})
