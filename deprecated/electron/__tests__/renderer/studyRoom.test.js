/**
 * StudyRoom 模块测试
 *
 * 测试自习室模块：初始化、弹窗、创建/加入、列表、视图、心跳、调试函数
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  // studyRoom.js 是普通对象字面量，不需要 IIFE 包装，require 即可挂载到 window.StudyRoom
  require('../../src/scripts/modules/studyRoom')
})

beforeEach(async () => {
  vi.useFakeTimers()

  document.body.innerHTML = `
    <button id="ui-study-room-btn">👥</button>
    <span id="timer-total-minutes">0</span>
    <div id="study-room-modal" class="study-room-modal">
      <div class="study-room-modal-content">
        <button id="study-room-modal-close">×</button>
        <div class="study-room-modal-header">
          <h2>👥 自习室</h2>
        </div>
        <div class="study-room-modal-body">
          <div class="study-room-options">
            <div class="study-room-option" id="study-room-my-rooms-option">
              <button class="study-room-btn" id="study-room-my-rooms-btn">查看</button>
            </div>
            <div class="study-room-option" id="study-room-create-option">
              <div class="study-room-requirement" id="study-room-create-requirement">
                <span class="requirement-text">需要累计专注 10 分钟</span>
              </div>
              <button class="study-room-btn" id="study-room-create-btn">开启</button>
            </div>
            <div class="study-room-option" id="study-room-join-option">
              <div class="study-room-requirement" id="study-room-join-requirement">
                <span class="requirement-text">需要累计专注 15 分钟</span>
              </div>
              <button class="study-room-btn" id="study-room-join-btn">加入</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="ui-toast"></div>
  `

  // AnimatedModal mock
  window.AnimatedModal = vi.fn().mockImplementation(function({
    element, showClass, hidingClass, closeOnBackground, animationDuration
  } = {}) {
    return {
      element,
      showClass,
      hidingClass,
      closeOnBackground,
      animationDuration,
      show: vi.fn(),
      hide: vi.fn()
    }
  })

  window.electronAPI = {
    studyRoomCreate: vi.fn(),
    studyRoomJoin: vi.fn(),
    studyRoomDelete: vi.fn(),
    studyRoomLeave: vi.fn(),
    studyRoomGetActive: vi.fn(),
    studyRoomGetById: vi.fn(),
    studyRoomGetRanking: vi.fn(),
    studyRoomGetMembers: vi.fn(),
    studyRoomGetMyRooms: vi.fn(),
    studyRoomUpdateStatus: vi.fn(),
    studyRoomUploadStats: vi.fn(),
    studyRoomCheckStatus: vi.fn(),
    readData: vi.fn(),
    writeData: vi.fn().mockResolvedValue(true)
  }

  window.DataStore = {
    getData: vi.fn().mockReturnValue({}),
    saveImmediate: vi.fn().mockResolvedValue(true)
  }

  window.Settings = {
    getSetting: vi.fn().mockReturnValue(true)
  }

  window.Stats = {
    getTodayCount: vi.fn().mockReturnValue(0),
    getTodayMinutes: vi.fn().mockReturnValue(0),
    update: vi.fn()
  }

  // 重置 StudyRoom 状态
  window.StudyRoom.modal = null
  window.StudyRoom.currentRoomId = null
  window.StudyRoom.currentRoomName = null
  window.StudyRoom.heartbeatInterval = null
  window.StudyRoom.refreshInterval = null

  // mock clipboard
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true
  })

  await window.StudyRoom.init()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * 设置累计专注分钟数
 */
function setTotalMinutes(minutes) {
  document.getElementById('timer-total-minutes').textContent = String(minutes)
}

describe('StudyRoom init', () => {
  it('init 应创建 AnimatedModal 实例', () => {
    expect(window.AnimatedModal).toHaveBeenCalled()
    expect(window.StudyRoom.modal).toBeDefined()
    const args = window.AnimatedModal.mock.calls[0][0]
    expect(args.element).toBe(document.getElementById('study-room-modal'))
    expect(args.showClass).toBe('active')
    expect(args.hidingClass).toBe('closing')
    expect(args.animationDuration).toBe(300)
  })

  it('init 应绑定按钮事件', async () => {
    const modalInstance = window.StudyRoom.modal
    const showSpy = vi.spyOn(modalInstance, 'show')

    document.getElementById('ui-study-room-btn').click()
    expect(showSpy).toHaveBeenCalled()
  })

  it('init 应根据 Settings 显示按钮', async () => {
    window.Settings.getSetting.mockReturnValue(true)
    await window.StudyRoom.init()
    const btn = document.getElementById('ui-study-room-btn')
    expect(btn.style.display).not.toBe('none')
  })

  it('init 当 Settings 返回 false 时不修改 display', async () => {
    window.Settings.getSetting.mockReturnValue(false)
    const btn = document.getElementById('ui-study-room-btn')
    btn.style.display = 'none'
    await window.StudyRoom.init()
    expect(btn.style.display).toBe('none')
  })

  it('init 无 Settings 时不报错', async () => {
    delete window.Settings
    await expect(window.StudyRoom.init()).resolves.toBeUndefined()
    window.Settings = { getSetting: vi.fn().mockReturnValue(true) }
  })

  it('init 应恢复自习室状态', async () => {
    window.DataStore.getData.mockReturnValue({
      studyRoom: { currentRoomId: 'room-1', currentRoomName: 'Test Room' }
    })
    await window.StudyRoom.init()
    expect(window.StudyRoom.currentRoomId).toBe('room-1')
    expect(window.StudyRoom.currentRoomName).toBe('Test Room')
  })
})

describe('StudyRoom initModal 回退方案', () => {
  it('无 AnimatedModal 但有 BaseModal 应使用 BaseModal', async () => {
    delete window.AnimatedModal
    window.BaseModal = vi.fn().mockImplementation(function({ element, showClass, closeOnBackground } = {}) {
      return { element, showClass, closeOnBackground, show: vi.fn(), hide: vi.fn() }
    })

    await window.StudyRoom.initModal()
    expect(window.BaseModal).toHaveBeenCalled()
    expect(window.StudyRoom.modal).toBeDefined()

    // 还原
    window.AnimatedModal = vi.fn().mockImplementation(function() {
      return { show: vi.fn(), hide: vi.fn() }
    })
  })

  it('无 AnimatedModal 和 BaseModal 时 modal 为 null', async () => {
    delete window.AnimatedModal
    delete window.BaseModal
    window.StudyRoom.modal = null
    expect(() => window.StudyRoom.initModal()).not.toThrow()
    expect(window.StudyRoom.modal).toBeNull()

    // 还原
    window.AnimatedModal = vi.fn().mockImplementation(function() {
      return { show: vi.fn(), hide: vi.fn() }
    })
  })

  it('无 modal 元素时不应报错', async () => {
    document.body.innerHTML = ''
    window.StudyRoom.modal = null
    expect(() => window.StudyRoom.initModal()).not.toThrow()
  })
})

describe('StudyRoom updateRequirements', () => {
  it('专注时间不足 10 分钟时创建按钮应被禁用', async () => {
    setTotalMinutes(5)
    await window.StudyRoom.updateRequirements()

    const createBtn = document.getElementById('study-room-create-btn')
    const createReq = document.getElementById('study-room-create-requirement')
    expect(createBtn.disabled).toBe(true)
    expect(createReq.classList.contains('not-met')).toBe(true)
    expect(createReq.querySelector('.requirement-text').textContent).toContain('需要累计专注 10 分钟')
  })

  it('专注时间达 10 分钟时创建按钮应启用', async () => {
    setTotalMinutes(10)
    await window.StudyRoom.updateRequirements()

    const createBtn = document.getElementById('study-room-create-btn')
    const createReq = document.getElementById('study-room-create-requirement')
    expect(createBtn.disabled).toBe(false)
    expect(createReq.classList.contains('met')).toBe(true)
    expect(createReq.querySelector('.requirement-text').textContent).toContain('已达到要求')
  })

  it('专注时间不足 15 分钟时加入按钮应被禁用', async () => {
    setTotalMinutes(10)
    await window.StudyRoom.updateRequirements()

    const joinBtn = document.getElementById('study-room-join-btn')
    expect(joinBtn.disabled).toBe(true)
  })

  it('专注时间达 15 分钟时加入按钮应启用', async () => {
    setTotalMinutes(20)
    await window.StudyRoom.updateRequirements()

    const joinBtn = document.getElementById('study-room-join-btn')
    expect(joinBtn.disabled).toBe(false)
  })

  it('getTotalFocusMinutes 应读取 timer-total-minutes 文本', () => {
    setTotalMinutes(42)
    expect(window.StudyRoom.getTotalFocusMinutes()).toBe(42)
  })

  it('getTotalFocusMinutes 元素缺失时返回 0', () => {
    document.body.innerHTML = ''
    expect(window.StudyRoom.getTotalFocusMinutes()).toBe(0)
  })

  it('getTotalFocusMinutes 无效文本返回 0', () => {
    document.getElementById('timer-total-minutes').textContent = 'abc'
    expect(window.StudyRoom.getTotalFocusMinutes()).toBe(0)
  })

  it('updateRequirement 元素缺失时不应报错', () => {
    document.body.innerHTML = ''
    expect(() => window.StudyRoom.updateRequirement('xxx', 'yyy', 10, 5)).not.toThrow()
  })
})

describe('StudyRoom openModal/closeModal', () => {
  it('openModal 应调用 modal.show', () => {
    const modalInstance = window.StudyRoom.modal
    window.StudyRoom.openModal()
    expect(modalInstance.show).toHaveBeenCalled()
  })

  it('openModal 无 modal 实例时使用回退方案', () => {
    window.StudyRoom.modal = null
    window.expandSidebarIfNeeded = vi.fn()
    const modalEl = document.getElementById('study-room-modal')
    modalEl.classList.remove('active')

    window.StudyRoom.openModal()

    expect(window.expandSidebarIfNeeded).toHaveBeenCalled()
    expect(modalEl.classList.contains('active')).toBe(true)

    vi.advanceTimersByTime(200)
    delete window.expandSidebarIfNeeded
  })

  it('openModal 无 modal 实例和元素时不应报错', () => {
    window.StudyRoom.modal = null
    document.body.innerHTML = ''
    expect(() => window.StudyRoom.openModal()).not.toThrow()
  })

  it('closeModal 应调用 modal.hide 并停止定时器', () => {
    const modalInstance = window.StudyRoom.modal
    const stopSpy = vi.spyOn(window.StudyRoom, 'stopTimers')
    window.StudyRoom.closeModal()
    expect(modalInstance.hide).toHaveBeenCalled()
    expect(stopSpy).toHaveBeenCalled()
  })

  it('closeModal 无 modal 实例时应使用回退方案', () => {
    window.StudyRoom.modal = null
    const modalEl = document.getElementById('study-room-modal')
    modalEl.classList.add('active')

    window.StudyRoom.closeModal()
    vi.advanceTimersByTime(400)

    expect(modalEl.classList.contains('active')).toBe(false)
    expect(modalEl.classList.contains('closing')).toBe(false)
  })
})

describe('StudyRoom showInputDialog', () => {
  it('点击确定应返回输入值', async () => {
    const promise = window.StudyRoom.showInputDialog('请输入', '占位符', '默认值')
    vi.advanceTimersByTime(150)

    const input = document.getElementById('input-dialog-input')
    input.value = 'test-value'
    document.getElementById('input-dialog-confirm').click()

    const result = await promise
    expect(result).toBe('test-value')
  })

  it('点击取消应返回 null', async () => {
    const promise = window.StudyRoom.showInputDialog('请输入')
    vi.advanceTimersByTime(150)

    document.getElementById('input-dialog-cancel').click()

    const result = await promise
    expect(result).toBeNull()
  })

  it('按 Enter 应确认', async () => {
    const promise = window.StudyRoom.showInputDialog('请输入')
    vi.advanceTimersByTime(150)

    const input = document.getElementById('input-dialog-input')
    input.value = 'enter-val'
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }))

    const result = await promise
    expect(result).toBe('enter-val')
  })

  it('按 Escape 应取消', async () => {
    const promise = window.StudyRoom.showInputDialog('请输入')
    vi.advanceTimersByTime(150)

    const input = document.getElementById('input-dialog-input')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    const result = await promise
    expect(result).toBeNull()
  })

  it('点击背景应取消', async () => {
    const promise = window.StudyRoom.showInputDialog('请输入')
    vi.advanceTimersByTime(150)

    const overlay = document.getElementById('input-dialog-overlay')
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const result = await promise
    expect(result).toBeNull()
  })
})

describe('StudyRoom showConfirmDialog', () => {
  it('点击确定应返回 true', async () => {
    const promise = window.StudyRoom.showConfirmDialog('确认？')
    document.getElementById('confirm-dialog-confirm').click()
    const result = await promise
    expect(result).toBe(true)
  })

  it('点击取消应返回 false', async () => {
    const promise = window.StudyRoom.showConfirmDialog('确认？')
    document.getElementById('confirm-dialog-cancel').click()
    const result = await promise
    expect(result).toBe(false)
  })

  it('点击背景应返回 false', async () => {
    const promise = window.StudyRoom.showConfirmDialog('确认？')
    const overlay = document.getElementById('confirm-dialog-overlay')
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const result = await promise
    expect(result).toBe(false)
  })
})

describe('StudyRoom showCreateRoomForm', () => {
  it('点击确定且名称为空应不提交（聚焦输入框）', async () => {
    const promise = window.StudyRoom.showCreateRoomForm()
    vi.advanceTimersByTime(150)

    const nameInput = document.getElementById('room-name-input')
    nameInput.value = ''
    document.getElementById('create-room-confirm').click()

    // 表单应仍然存在
    expect(document.getElementById('create-room-overlay')).not.toBeNull()
    // 取消以清理
    document.getElementById('create-room-cancel').click()
    await promise
  })

  it('点击确定且名称有效应返回数据', async () => {
    const promise = window.StudyRoom.showCreateRoomForm()
    vi.advanceTimersByTime(150)

    document.getElementById('room-name-input').value = '我的自习室'
    document.getElementById('room-desc-input').value = '描述'
    document.getElementById('create-room-confirm').click()

    const result = await promise
    expect(result).toEqual({
      name: '我的自习室',
      description: '描述',
      isPublic: true
    })
  })

  it('点击取消应返回 null', async () => {
    const promise = window.StudyRoom.showCreateRoomForm()
    vi.advanceTimersByTime(150)

    document.getElementById('create-room-cancel').click()

    const result = await promise
    expect(result).toBeNull()
  })

  it('切换隐私选项应更新 active 类', async () => {
    const promise = window.StudyRoom.showCreateRoomForm()
    vi.advanceTimersByTime(150)

    const privateOption = document.querySelector('.privacy-option[data-value="private"]')
    privateOption.click()

    expect(privateOption.classList.contains('active')).toBe(true)
    expect(document.querySelector('.privacy-option[data-value="public"]').classList.contains('active')).toBe(false)

    document.getElementById('create-room-cancel').click()
    await promise
  })

  it('按 ESC 应取消', async () => {
    const promise = window.StudyRoom.showCreateRoomForm()
    vi.advanceTimersByTime(150)

    const overlay = document.getElementById('create-room-overlay')
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    const result = await promise
    expect(result).toBeNull()
  })

  it('名称输入框按 Enter 应确认', async () => {
    const promise = window.StudyRoom.showCreateRoomForm()
    vi.advanceTimersByTime(150)

    const nameInput = document.getElementById('room-name-input')
    nameInput.value = 'EnterRoom'
    nameInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }))

    const result = await promise
    expect(result.name).toBe('EnterRoom')
  })

  it('点击背景应取消', async () => {
    const promise = window.StudyRoom.showCreateRoomForm()
    vi.advanceTimersByTime(150)

    const overlay = document.getElementById('create-room-overlay')
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const result = await promise
    expect(result).toBeNull()
  })
})

describe('StudyRoom handleCreate', () => {
  it('专注时间不足应显示提示并返回', async () => {
    setTotalMinutes(5)
    const showSpy = vi.spyOn(window.StudyRoom, 'showToast')
    await window.StudyRoom.handleCreate()
    expect(showSpy).toHaveBeenCalledWith(expect.stringContaining('需要累计专注 10 分钟'))
  })

  it('创建成功应保存状态并打开自习室视图', async () => {
    setTotalMinutes(15)
    window.electronAPI.studyRoomCreate.mockResolvedValue({
      success: true,
      data: { id: 'room-1', name: 'TestRoom' }
    })

    // 立即显示创建表单并填入名称
    const formPromise = window.StudyRoom.handleCreate()
    vi.advanceTimersByTime(150)
    document.getElementById('room-name-input').value = 'TestRoom'
    document.getElementById('create-room-confirm').click()

    await formPromise
    await vi.advanceTimersByTimeAsync(400)

    expect(window.electronAPI.studyRoomCreate).toHaveBeenCalled()
    expect(window.StudyRoom.currentRoomId).toBe('room-1')
    expect(window.StudyRoom.currentRoomName).toBe('TestRoom')
    expect(window.DataStore.saveImmediate).toHaveBeenCalled()
  })

  it('创建失败应显示错误消息', async () => {
    setTotalMinutes(15)
    window.electronAPI.studyRoomCreate.mockResolvedValue({
      success: false,
      error: '名称已存在'
    })

    const formPromise = window.StudyRoom.handleCreate()
    vi.advanceTimersByTime(150)
    document.getElementById('room-name-input').value = 'TestRoom'
    document.getElementById('create-room-confirm').click()

    await formPromise
    // 应该显示错误 toast
    expect(window.electronAPI.studyRoomCreate).toHaveBeenCalled()
  })

  it('用户取消表单应直接返回', async () => {
    setTotalMinutes(15)
    const formPromise = window.StudyRoom.handleCreate()
    vi.advanceTimersByTime(150)
    document.getElementById('create-room-cancel').click()
    await formPromise

    expect(window.electronAPI.studyRoomCreate).not.toHaveBeenCalled()
  })
})

describe('StudyRoom handleJoin', () => {
  it('专注时间不足应显示提示', async () => {
    setTotalMinutes(5)
    const showSpy = vi.spyOn(window.StudyRoom, 'showToast')
    await window.StudyRoom.handleJoin()
    expect(showSpy).toHaveBeenCalledWith(expect.stringContaining('需要累计专注 15 分钟'))
  })

  it('专注时间足够应显示加入选项', async () => {
    setTotalMinutes(20)
    const showJoinSpy = vi.spyOn(window.StudyRoom, 'showJoinOptions')
    await window.StudyRoom.handleJoin()
    expect(showJoinSpy).toHaveBeenCalled()
  })
})

describe('StudyRoom showJoinOptions', () => {
  it('应渲染加入选项界面', () => {
    window.StudyRoom.showJoinOptions()
    expect(document.getElementById('join-by-id-card')).not.toBeNull()
    expect(document.getElementById('browse-rooms-card')).not.toBeNull()
    expect(document.getElementById('join-back-btn')).not.toBeNull()
  })

  it('点击返回按钮应调用 showMainView', () => {
    const spy = vi.spyOn(window.StudyRoom, 'showMainView')
    window.StudyRoom.showJoinOptions()
    document.getElementById('join-back-btn').click()
    expect(spy).toHaveBeenCalled()
  })

  it('点击通过 ID 加入应调用 showInputDialog', async () => {
    const spy = vi.spyOn(window.StudyRoom, 'showInputDialog').mockResolvedValue(null)
    window.StudyRoom.showJoinOptions()
    document.getElementById('join-by-id-btn').click()
    vi.advanceTimersByTime(50)
    expect(spy).toHaveBeenCalledWith('请输入自习室ID', '粘贴自习室ID')
  })

  it('点击浏览自习室应调用 studyRoomGetActive', async () => {
    window.electronAPI.studyRoomGetActive.mockResolvedValue({ success: false, error: 'network' })
    window.StudyRoom.showJoinOptions()
    document.getElementById('browse-rooms-btn').click()
    await vi.advanceTimersByTimeAsync(50)
    expect(window.electronAPI.studyRoomGetActive).toHaveBeenCalledWith(true)
  })

  it('浏览自习室成功应显示列表', async () => {
    const rooms = [{ id: 'r1', name: 'Room1', description: 'd', creator_name: 'c', member_count: 1, is_public: true }]
    window.electronAPI.studyRoomGetActive.mockResolvedValue({ success: true, data: rooms })
    const spy = vi.spyOn(window.StudyRoom, 'showRoomList')
    window.StudyRoom.showJoinOptions()
    document.getElementById('browse-rooms-btn').click()
    await vi.advanceTimersByTimeAsync(50)
    expect(spy).toHaveBeenCalledWith(rooms)
  })

  it('modalBody 缺失时不应报错', () => {
    document.body.innerHTML = ''
    expect(() => window.StudyRoom.showJoinOptions()).not.toThrow()
  })
})

describe('StudyRoom joinRoomById', () => {
  it('查询失败应显示错误', async () => {
    window.electronAPI.studyRoomGetById.mockResolvedValue({ success: false, error: 'not found' })
    await window.StudyRoom.joinRoomById('xxx')
    expect(window.electronAPI.studyRoomJoin).not.toHaveBeenCalled()
  })

  it('用户取消确认应不加入', async () => {
    window.electronAPI.studyRoomGetById.mockResolvedValue({
      success: true,
      data: { id: 'r1', name: 'Room', description: '', creator_name: 'c', member_count: 1, is_public: true }
    })
    // showConfirmDialog 默认 mock 返回 false（用户取消）
    const promise = window.StudyRoom.joinRoomById('r1')
    // 等待 studyRoomGetById 微任务完成后再点击取消
    await vi.advanceTimersByTimeAsync(50)
    const cancelBtn = document.getElementById('confirm-dialog-cancel')
    if (cancelBtn) cancelBtn.click()
    await promise
    expect(window.electronAPI.studyRoomJoin).not.toHaveBeenCalled()
  })

  it('加入成功应保存状态', async () => {
    window.electronAPI.studyRoomGetById.mockResolvedValue({
      success: true,
      data: { id: 'r1', name: 'Room', description: '', creator_name: 'c', member_count: 1, is_public: true }
    })
    window.electronAPI.studyRoomJoin.mockResolvedValue({ success: true })

    const promise = window.StudyRoom.joinRoomById('r1')
    await vi.advanceTimersByTimeAsync(50)
    document.getElementById('confirm-dialog-confirm').click()
    await promise
    await vi.advanceTimersByTimeAsync(50)

    expect(window.electronAPI.studyRoomJoin).toHaveBeenCalledWith('r1')
    expect(window.StudyRoom.currentRoomId).toBe('r1')
    expect(window.StudyRoom.currentRoomName).toBe('Room')
  })

  it('加入失败应显示错误', async () => {
    window.electronAPI.studyRoomGetById.mockResolvedValue({
      success: true,
      data: { id: 'r1', name: 'Room', description: '', creator_name: 'c', member_count: 1, is_public: true }
    })
    window.electronAPI.studyRoomJoin.mockResolvedValue({ success: false, error: 'full' })

    const promise = window.StudyRoom.joinRoomById('r1')
    await vi.advanceTimersByTimeAsync(50)
    document.getElementById('confirm-dialog-confirm').click()
    await promise
    await vi.advanceTimersByTimeAsync(50)

    expect(window.electronAPI.studyRoomJoin).toHaveBeenCalled()
  })
})

describe('StudyRoom showRoomList', () => {
  it('空列表应显示提示', () => {
    const showSpy = vi.spyOn(window.StudyRoom, 'showToast')
    window.StudyRoom.showRoomList([])
    expect(showSpy).toHaveBeenCalledWith('暂无公开的自习室')
  })

  it('null 列表应显示提示', () => {
    const showSpy = vi.spyOn(window.StudyRoom, 'showToast')
    window.StudyRoom.showRoomList(null)
    expect(showSpy).toHaveBeenCalledWith('暂无公开的自习室')
  })

  it('应渲染房间列表', () => {
    const rooms = [
      { id: 'r1-abcdefgh', name: 'Room1', description: 'desc', creator_name: 'c1', member_count: 5, is_public: true }
    ]
    window.StudyRoom.showRoomList(rooms)

    const items = document.querySelectorAll('.room-list-item')
    expect(items.length).toBe(1)
    expect(document.querySelector('.room-name').textContent).toContain('Room1')
    expect(document.querySelector('.room-join-btn').dataset.roomId).toBe('r1-abcdefgh')
  })

  it('点击加入按钮应调用 joinRoomById', async () => {
    const spy = vi.spyOn(window.StudyRoom, 'joinRoomById').mockResolvedValue(undefined)
    const rooms = [{ id: 'r1', name: 'Room1', description: 'desc', creator_name: 'c1', member_count: 5, is_public: true }]
    window.StudyRoom.showRoomList(rooms)

    document.querySelector('.room-join-btn').click()
    expect(spy).toHaveBeenCalledWith('r1')
  })

  it('点击复制 ID 按钮应调用 clipboard.writeText', () => {
    const rooms = [{ id: 'r1', name: 'Room1', description: 'desc', creator_name: 'c1', member_count: 5, is_public: true }]
    window.StudyRoom.showRoomList(rooms)

    document.querySelector('.room-id-copy-mini').click()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('r1')
  })

  it('点击返回按钮应调用 showJoinOptions', () => {
    const spy = vi.spyOn(window.StudyRoom, 'showJoinOptions')
    const rooms = [{ id: 'r1', name: 'Room1', description: 'desc', creator_name: 'c1', member_count: 5, is_public: true }]
    window.StudyRoom.showRoomList(rooms)

    document.querySelector('.room-list-close-btn').click()
    expect(spy).toHaveBeenCalled()
  })
})

describe('StudyRoom joinRoom', () => {
  it('加入成功应保存状态', async () => {
    window.electronAPI.studyRoomJoin.mockResolvedValue({ success: true })
    // openRoomView 会在 setTimeout(300) 后调用，需要 mock 相关 API
    window.electronAPI.studyRoomGetById.mockResolvedValue({
      success: true, data: { is_public: true }
    })
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    const promise = window.StudyRoom.joinRoom('r1', 'RoomName')
    await vi.advanceTimersByTimeAsync(400)
    await promise

    expect(window.StudyRoom.currentRoomId).toBe('r1')
    expect(window.StudyRoom.currentRoomName).toBe('RoomName')
  })

  it('加入失败应显示错误', async () => {
    window.electronAPI.studyRoomJoin.mockResolvedValue({ success: false, error: '已满' })
    await window.StudyRoom.joinRoom('r1', 'RoomName')
    expect(window.StudyRoom.currentRoomId).toBeNull()
  })
})

describe('StudyRoom openRoomView', () => {
  it('应渲染自习室视图', async () => {
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    const promise = window.StudyRoom.openRoomView('r1', 'RoomName', true)
    await vi.advanceTimersByTimeAsync(400)
    await promise

    expect(window.StudyRoom.currentRoomId).toBe('r1')
    expect(document.querySelector('.room-view-container')).not.toBeNull()
    expect(document.querySelector('.room-tab')).not.toBeNull()
  })

  it('无 isPublic 参数应从服务器获取', async () => {
    window.electronAPI.studyRoomGetById.mockResolvedValue({
      success: true,
      data: { is_public: false }
    })
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    const promise = window.StudyRoom.openRoomView('r1', 'RoomName', null)
    await vi.advanceTimersByTimeAsync(400)
    await promise

    expect(window.electronAPI.studyRoomGetById).toHaveBeenCalledWith('r1')
  })

  it('应绑定标签切换事件', async () => {
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    const promise = window.StudyRoom.openRoomView('r1', 'RoomName', true)
    await vi.advanceTimersByTimeAsync(400)
    await promise

    const membersTab = document.querySelector('.room-tab[data-tab="members"]')
    membersTab.click()
    expect(membersTab.classList.contains('active')).toBe(true)
    expect(document.getElementById('members-panel').classList.contains('active')).toBe(true)
  })

  it('点击刷新按钮应调用 refreshRoomData', async () => {
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    const promise = window.StudyRoom.openRoomView('r1', 'RoomName', true)
    await vi.advanceTimersByTimeAsync(400)
    await promise

    const refreshSpy = vi.spyOn(window.StudyRoom, 'refreshRoomData')
    document.querySelector('.room-refresh-btn').click()
    expect(refreshSpy).toHaveBeenCalled()
  })

  it('点击离开按钮应调用 leaveRoom', async () => {
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    const promise = window.StudyRoom.openRoomView('r1', 'RoomName', true)
    await vi.advanceTimersByTimeAsync(400)
    await promise

    const spy = vi.spyOn(window.StudyRoom, 'leaveRoom')
    document.querySelector('.room-leave-btn').click()
    expect(spy).toHaveBeenCalled()
  })

  it('点击删除按钮应调用 deleteRoom', async () => {
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    const promise = window.StudyRoom.openRoomView('r1', 'RoomName', true)
    await vi.advanceTimersByTimeAsync(400)
    await promise

    const spy = vi.spyOn(window.StudyRoom, 'deleteRoom')
    document.querySelector('.room-delete-btn').click()
    expect(spy).toHaveBeenCalled()
  })

  it('点击复制 ID 按钮应复制到剪贴板', async () => {
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    const promise = window.StudyRoom.openRoomView('r1', 'RoomName', true)
    await vi.advanceTimersByTimeAsync(400)
    await promise

    document.querySelector('.room-id-copy-btn').click()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('r1')
  })

  it('应启动心跳和自动刷新', async () => {
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    const promise = window.StudyRoom.openRoomView('r1', 'RoomName', true)
    await vi.advanceTimersByTimeAsync(400)
    await promise

    expect(window.electronAPI.studyRoomUpdateStatus).toHaveBeenCalledWith('r1')
    expect(window.StudyRoom.heartbeatInterval).not.toBeNull()
    expect(window.StudyRoom.refreshInterval).not.toBeNull()
  })

  it('modalBody 缺失时不应报错', async () => {
    document.body.innerHTML = ''
    await expect(window.StudyRoom.openRoomView('r1', 'RoomName', true)).resolves.toBeUndefined()
  })
})

describe('StudyRoom switchTab', () => {
  it('应切换 active 类', async () => {
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    const promise = window.StudyRoom.openRoomView('r1', 'RoomName', true)
    await vi.advanceTimersByTimeAsync(400)
    await promise

    window.StudyRoom.switchTab('members')
    expect(document.querySelector('.room-tab[data-tab="members"]').classList.contains('active')).toBe(true)
    expect(document.getElementById('members-panel').classList.contains('active')).toBe(true)

    window.StudyRoom.switchTab('ranking')
    expect(document.querySelector('.room-tab[data-tab="ranking"]').classList.contains('active')).toBe(true)
    expect(document.getElementById('ranking-panel').classList.contains('active')).toBe(true)
  })
})

describe('StudyRoom refreshRoomData', () => {
  it('无 currentRoomId 时不应调用 API', async () => {
    window.StudyRoom.currentRoomId = null
    await window.StudyRoom.refreshRoomData()
    expect(window.electronAPI.studyRoomGetRanking).not.toHaveBeenCalled()
  })

  it('应调用 ranking 和 members API', async () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    await window.StudyRoom.refreshRoomData()

    expect(window.electronAPI.studyRoomGetRanking).toHaveBeenCalledWith('r1')
    expect(window.electronAPI.studyRoomGetMembers).toHaveBeenCalledWith('r1')
  })

  it('API 失败时不应报错', async () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: false })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: false })

    await expect(window.StudyRoom.refreshRoomData()).resolves.toBeUndefined()
  })
})

describe('StudyRoom updateRankingDisplay', () => {
  beforeEach(() => {
    document.body.innerHTML += '<div id="ranking-panel"></div>'
  })

  it('空数据应显示空状态', () => {
    window.StudyRoom.updateRankingDisplay([])
    expect(document.getElementById('ranking-panel').innerHTML).toContain('暂无排名数据')
  })

  it('null 数据应显示空状态', () => {
    window.StudyRoom.updateRankingDisplay(null)
    expect(document.getElementById('ranking-panel').innerHTML).toContain('暂无排名数据')
  })

  it('应渲染排名列表并显示奖牌', () => {
    const data = [
      { username: 'user1', total_minutes: 100, session_count: 4 },
      { username: 'user2', total_minutes: 80, session_count: 3 },
      { username: 'user3', total_minutes: 60, session_count: 2 },
      { username: 'user4', total_minutes: 40, session_count: 1 }
    ]
    window.StudyRoom.updateRankingDisplay(data)
    const items = document.querySelectorAll('.ranking-item')
    expect(items.length).toBe(4)
    // 前三名应有 top-three 类
    expect(items[0].classList.contains('top-three')).toBe(true)
    expect(items[3].classList.contains('top-three')).toBe(false)
  })

  it('panel 元素缺失时不应报错', () => {
    document.body.innerHTML = ''
    expect(() => window.StudyRoom.updateRankingDisplay([])).not.toThrow()
  })
})

describe('StudyRoom updateMembersDisplay', () => {
  beforeEach(() => {
    document.body.innerHTML += '<div id="members-panel"></div>'
  })

  it('空数据应显示空状态', () => {
    window.StudyRoom.updateMembersDisplay([])
    expect(document.getElementById('members-panel').innerHTML).toContain('暂无在线成员')
  })

  it('null 数据应显示空状态', () => {
    window.StudyRoom.updateMembersDisplay(null)
    expect(document.getElementById('members-panel').innerHTML).toContain('暂无在线成员')
  })

  it('应渲染成员列表', () => {
    const data = [
      { username: 'user1', last_active: new Date().toISOString(), is_online: true }
    ]
    window.StudyRoom.updateMembersDisplay(data)
    const items = document.querySelectorAll('.member-item')
    expect(items.length).toBe(1)
    expect(items[0].querySelector('.member-online-indicator').classList.contains('online')).toBe(true)
  })

  it('panel 元素缺失时不应报错', () => {
    document.body.innerHTML = ''
    expect(() => window.StudyRoom.updateMembersDisplay([])).not.toThrow()
  })
})

describe('StudyRoom getTimeAgo', () => {
  it('刚刚（< 60秒）', () => {
    const date = new Date()
    expect(window.StudyRoom.getTimeAgo(date)).toBe('刚刚')
  })

  it('分钟前（< 60分钟）', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000)
    expect(window.StudyRoom.getTimeAgo(date)).toContain('分钟前')
  })

  it('小时前（< 24小时）', () => {
    const date = new Date(Date.now() - 3 * 3600 * 1000)
    expect(window.StudyRoom.getTimeAgo(date)).toContain('小时前')
  })

  it('天前（>= 24小时）', () => {
    const date = new Date(Date.now() - 2 * 86400 * 1000)
    expect(window.StudyRoom.getTimeAgo(date)).toContain('天前')
  })
})

describe('StudyRoom startHeartbeat', () => {
  it('应立即执行一次心跳', () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.electronAPI.studyRoomUpdateStatus.mockClear()
    window.StudyRoom.startHeartbeat()
    expect(window.electronAPI.studyRoomUpdateStatus).toHaveBeenCalledWith('r1')
  })

  it('无 currentRoomId 时不应立即执行', () => {
    window.StudyRoom.currentRoomId = null
    window.electronAPI.studyRoomUpdateStatus.mockClear()
    window.StudyRoom.startHeartbeat()
    expect(window.electronAPI.studyRoomUpdateStatus).not.toHaveBeenCalled()
  })

  it('应清除旧的定时器', () => {
    const oldInterval = setInterval(() => {}, 10000)
    window.StudyRoom.heartbeatInterval = oldInterval
    window.StudyRoom.startHeartbeat()
    expect(window.StudyRoom.heartbeatInterval).not.toBe(oldInterval)
  })

  it('每 5 分钟应调用一次 studyRoomUpdateStatus', () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.electronAPI.studyRoomUpdateStatus.mockClear()
    window.StudyRoom.startHeartbeat()

    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(window.electronAPI.studyRoomUpdateStatus).toHaveBeenCalledTimes(2) // 1 立即 + 1 定时
  })
})

describe('StudyRoom startAutoRefresh', () => {
  it('应清除旧的定时器', () => {
    const oldInterval = setInterval(() => {}, 10000)
    window.StudyRoom.refreshInterval = oldInterval
    window.StudyRoom.startAutoRefresh()
    expect(window.StudyRoom.refreshInterval).not.toBe(oldInterval)
  })

  it('每 30 秒应调用一次 refreshRoomData', () => {
    const spy = vi.spyOn(window.StudyRoom, 'refreshRoomData').mockResolvedValue(undefined)
    window.StudyRoom.startAutoRefresh()

    vi.advanceTimersByTime(30 * 1000)
    expect(spy).toHaveBeenCalled()
  })
})

describe('StudyRoom stopTimers', () => {
  it('应清除两个定时器', () => {
    window.StudyRoom.heartbeatInterval = setInterval(() => {}, 10000)
    window.StudyRoom.refreshInterval = setInterval(() => {}, 10000)

    window.StudyRoom.stopTimers()

    expect(window.StudyRoom.heartbeatInterval).toBeNull()
    expect(window.StudyRoom.refreshInterval).toBeNull()
  })

  it('无定时器时不应报错', () => {
    window.StudyRoom.heartbeatInterval = null
    window.StudyRoom.refreshInterval = null
    expect(() => window.StudyRoom.stopTimers()).not.toThrow()
  })
})

describe('StudyRoom deleteRoom', () => {
  it('无 currentRoomId 时应直接返回', async () => {
    window.StudyRoom.currentRoomId = null
    await window.StudyRoom.deleteRoom()
    expect(window.electronAPI.studyRoomDelete).not.toHaveBeenCalled()
  })

  it('用户在第一次确认时取消应直接返回', async () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.StudyRoom.currentRoomName = 'Room'
    const promise = window.StudyRoom.deleteRoom()
    vi.advanceTimersByTime(50)
    document.getElementById('confirm-dialog-cancel').click()
    await promise
    expect(window.electronAPI.studyRoomDelete).not.toHaveBeenCalled()
  })

  it('删除成功应清除状态并显示主界面', async () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.StudyRoom.currentRoomName = 'Room'
    window.electronAPI.studyRoomDelete.mockResolvedValue({ success: true })
    const showMainSpy = vi.spyOn(window.StudyRoom, 'showMainView')

    const promise = window.StudyRoom.deleteRoom()
    await vi.advanceTimersByTimeAsync(50)
    document.getElementById('confirm-dialog-confirm').click()
    await vi.advanceTimersByTimeAsync(50)
    document.getElementById('confirm-dialog-confirm').click()
    await promise

    expect(window.electronAPI.studyRoomDelete).toHaveBeenCalledWith('r1')
    expect(window.StudyRoom.currentRoomId).toBeNull()
    expect(showMainSpy).toHaveBeenCalled()
  })

  it('删除失败应显示错误', async () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.StudyRoom.currentRoomName = 'Room'
    window.electronAPI.studyRoomDelete.mockResolvedValue({ success: false, error: 'db' })

    const promise = window.StudyRoom.deleteRoom()
    await vi.advanceTimersByTimeAsync(50)
    document.getElementById('confirm-dialog-confirm').click()
    await vi.advanceTimersByTimeAsync(50)
    document.getElementById('confirm-dialog-confirm').click()
    await promise

    expect(window.electronAPI.studyRoomDelete).toHaveBeenCalled()
  })
})

describe('StudyRoom leaveRoom', () => {
  it('无 currentRoomId 时应直接返回', async () => {
    window.StudyRoom.currentRoomId = null
    await window.StudyRoom.leaveRoom()
    expect(window.electronAPI.studyRoomLeave).not.toHaveBeenCalled()
  })

  it('用户取消应直接返回', async () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.StudyRoom.currentRoomName = 'Room'
    const promise = window.StudyRoom.leaveRoom()
    vi.advanceTimersByTime(50)
    document.getElementById('confirm-dialog-cancel').click()
    await promise
    expect(window.electronAPI.studyRoomLeave).not.toHaveBeenCalled()
  })

  it('离开成功应清除状态并检查房间状态', async () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.StudyRoom.currentRoomName = 'Room'
    window.electronAPI.studyRoomLeave.mockResolvedValue({ success: true })
    window.electronAPI.studyRoomCheckStatus.mockResolvedValue({ success: true })
    const showMainSpy = vi.spyOn(window.StudyRoom, 'showMainView')

    const promise = window.StudyRoom.leaveRoom()
    vi.advanceTimersByTime(50)
    document.getElementById('confirm-dialog-confirm').click()
    await promise
    await vi.advanceTimersByTimeAsync(50)

    expect(window.electronAPI.studyRoomLeave).toHaveBeenCalledWith('r1')
    expect(window.electronAPI.studyRoomCheckStatus).toHaveBeenCalledWith('r1')
    expect(window.StudyRoom.currentRoomId).toBeNull()
    expect(showMainSpy).toHaveBeenCalled()
  })

  it('离开失败应显示错误', async () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.StudyRoom.currentRoomName = 'Room'
    window.electronAPI.studyRoomLeave.mockResolvedValue({ success: false, error: 'failed' })

    const promise = window.StudyRoom.leaveRoom()
    vi.advanceTimersByTime(50)
    document.getElementById('confirm-dialog-confirm').click()
    await promise

    expect(window.StudyRoom.currentRoomId).toBe('r1')
  })
})

describe('StudyRoom showMainView', () => {
  it('应渲染主界面 HTML', () => {
    window.StudyRoom.showMainView()
    expect(document.getElementById('study-room-my-rooms-btn')).not.toBeNull()
    expect(document.getElementById('study-room-create-btn')).not.toBeNull()
    expect(document.getElementById('study-room-join-btn')).not.toBeNull()
  })

  it('应调用 rebindMainButtons', () => {
    const spy = vi.spyOn(window.StudyRoom, 'rebindMainButtons')
    window.StudyRoom.showMainView()
    expect(spy).toHaveBeenCalled()
  })

  it('应调用 updateRequirements', () => {
    const spy = vi.spyOn(window.StudyRoom, 'updateRequirements')
    window.StudyRoom.showMainView()
    expect(spy).toHaveBeenCalled()
  })

  it('modalBody 缺失时不应报错', () => {
    document.body.innerHTML = ''
    expect(() => window.StudyRoom.showMainView()).not.toThrow()
  })

  it('渲染后点击创建按钮应触发 handleCreate', async () => {
    setTotalMinutes(20)
    const spy = vi.spyOn(window.StudyRoom, 'handleCreate').mockResolvedValue(undefined)
    window.StudyRoom.showMainView()
    document.getElementById('study-room-create-btn').click()
    expect(spy).toHaveBeenCalled()
  })

  it('渲染后点击加入按钮应触发 handleJoin', async () => {
    setTotalMinutes(20)
    const spy = vi.spyOn(window.StudyRoom, 'handleJoin').mockResolvedValue(undefined)
    window.StudyRoom.showMainView()
    document.getElementById('study-room-join-btn').click()
    expect(spy).toHaveBeenCalled()
  })

  it('渲染后点击我的自习室应触发 showMyRooms', async () => {
    const spy = vi.spyOn(window.StudyRoom, 'showMyRooms').mockResolvedValue(undefined)
    window.StudyRoom.showMainView()
    document.getElementById('study-room-my-rooms-btn').click()
    expect(spy).toHaveBeenCalled()
  })

  it('禁用按钮被点击时不应触发 handleCreate', async () => {
    setTotalMinutes(5)
    const spy = vi.spyOn(window.StudyRoom, 'handleCreate').mockResolvedValue(undefined)
    window.StudyRoom.showMainView()
    document.getElementById('study-room-create-btn').click()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('StudyRoom showMyRooms', () => {
  it('加载失败应显示错误', async () => {
    window.electronAPI.studyRoomGetMyRooms.mockResolvedValue({ success: false, error: 'network' })
    await window.StudyRoom.showMyRooms()
    // 不应渲染列表
    expect(document.querySelector('.my-rooms-container')).toBeNull()
  })

  it('空列表应显示空状态', async () => {
    window.electronAPI.studyRoomGetMyRooms.mockResolvedValue({ success: true, data: [] })
    await window.StudyRoom.showMyRooms()
    expect(document.querySelector('.empty-state')).not.toBeNull()
  })

  it('应渲染房间列表', async () => {
    window.electronAPI.studyRoomGetMyRooms.mockResolvedValue({
      success: true,
      data: [
        { id: 'r1', name: 'Room1', description: 'd', is_public: true, is_active: true, online_count: 3, created_at: new Date().toISOString() }
      ]
    })
    await window.StudyRoom.showMyRooms()
    const items = document.querySelectorAll('.my-room-item')
    expect(items.length).toBe(1)
    expect(document.querySelector('.my-room-enter-btn').dataset.roomId).toBe('r1')
  })

  it('点击进入按钮应加入并打开视图', async () => {
    window.electronAPI.studyRoomJoin.mockResolvedValue({ success: true })
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMyRooms.mockResolvedValue({
      success: true,
      data: [
        { id: 'r1', name: 'Room1', description: 'd', is_public: true, is_active: true, online_count: 3, created_at: new Date().toISOString() }
      ]
    })

    await window.StudyRoom.showMyRooms()
    document.querySelector('.my-room-enter-btn').click()
    await vi.advanceTimersByTimeAsync(50)

    expect(window.electronAPI.studyRoomJoin).toHaveBeenCalledWith('r1')
  })

  it('点击不活跃房间的进入按钮应先确认', async () => {
    window.electronAPI.studyRoomGetMyRooms.mockResolvedValue({
      success: true,
      data: [
        { id: 'r1', name: 'Room1', description: 'd', is_public: true, is_active: false, online_count: 0, created_at: new Date().toISOString() }
      ]
    })

    await window.StudyRoom.showMyRooms()
    document.querySelector('.my-room-enter-btn').click()
    // 应显示确认对话框
    await vi.advanceTimersByTimeAsync(50)
    expect(document.getElementById('confirm-dialog-overlay')).not.toBeNull()
    // 取消
    document.getElementById('confirm-dialog-cancel').click()
  })

  it('点击复制 ID 按钮应复制到剪贴板', async () => {
    window.electronAPI.studyRoomGetMyRooms.mockResolvedValue({
      success: true,
      data: [
        { id: 'r1', name: 'Room1', description: 'd', is_public: true, is_active: true, online_count: 3, created_at: new Date().toISOString() }
      ]
    })

    await window.StudyRoom.showMyRooms()
    document.querySelector('.room-id-copy-mini').click()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('r1')
  })

  it('点击删除按钮应触发二次确认', async () => {
    window.electronAPI.studyRoomDelete.mockResolvedValue({ success: true })
    window.electronAPI.studyRoomGetMyRooms.mockResolvedValue({
      success: true,
      data: [
        { id: 'r1', name: 'Room1', description: 'd', is_public: true, is_active: true, online_count: 3, created_at: new Date().toISOString() }
      ]
    })

    await window.StudyRoom.showMyRooms()
    document.querySelector('.my-room-delete-btn').click()
    await vi.advanceTimersByTimeAsync(50)

    // 第一次确认
    document.getElementById('confirm-dialog-confirm').click()
    await vi.advanceTimersByTimeAsync(50)

    // 第二次确认
    document.getElementById('confirm-dialog-confirm').click()
    await vi.advanceTimersByTimeAsync(50)

    expect(window.electronAPI.studyRoomDelete).toHaveBeenCalledWith('r1')
  })

  it('点击返回按钮应调用 showMainView', async () => {
    const spy = vi.spyOn(window.StudyRoom, 'showMainView')
    window.electronAPI.studyRoomGetMyRooms.mockResolvedValue({ success: true, data: [] })

    await window.StudyRoom.showMyRooms()
    document.querySelector('.my-rooms-back-btn').click()
    expect(spy).toHaveBeenCalled()
  })
})

describe('StudyRoom uploadSession', () => {
  it('无 currentRoomId 时应直接返回', async () => {
    window.StudyRoom.currentRoomId = null
    await window.StudyRoom.uploadSession(25, 'note')
    expect(window.electronAPI.studyRoomUploadStats).not.toHaveBeenCalled()
  })

  it('应调用 studyRoomUploadStats 并刷新数据', async () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.Stats.getTodayCount.mockReturnValue(3)
    window.Stats.getTodayMinutes.mockReturnValue(75)
    window.electronAPI.studyRoomUploadStats.mockResolvedValue({ success: true })
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    await window.StudyRoom.uploadSession(25, 'note')

    expect(window.electronAPI.studyRoomUploadStats).toHaveBeenCalledWith('r1', 75, 3)
  })

  it('上传失败时不应报错', async () => {
    window.StudyRoom.currentRoomId = 'r1'
    window.electronAPI.studyRoomUploadStats.mockResolvedValue({ success: false, error: 'x' })
    await expect(window.StudyRoom.uploadSession(25, 'note')).resolves.toBeUndefined()
  })

  it('无 Stats 模块时应使用 0', async () => {
    window.StudyRoom.currentRoomId = 'r1'
    delete window.Stats
    window.electronAPI.studyRoomUploadStats.mockResolvedValue({ success: true })
    window.electronAPI.studyRoomGetRanking.mockResolvedValue({ success: true, data: [] })
    window.electronAPI.studyRoomGetMembers.mockResolvedValue({ success: true, data: [] })

    await window.StudyRoom.uploadSession(25, 'note')

    expect(window.electronAPI.studyRoomUploadStats).toHaveBeenCalledWith('r1', 0, 0)
    window.Stats = { getTodayCount: vi.fn().mockReturnValue(0), getTodayMinutes: vi.fn().mockReturnValue(0) }
  })
})

describe('StudyRoom isInRoom', () => {
  it('无 currentRoomId 时返回 false', () => {
    window.StudyRoom.currentRoomId = null
    expect(window.StudyRoom.isInRoom()).toBe(false)
  })

  it('有 currentRoomId 时返回 true', () => {
    window.StudyRoom.currentRoomId = 'r1'
    expect(window.StudyRoom.isInRoom()).toBe(true)
  })
})

describe('StudyRoom saveRoomState', () => {
  it('无 DataStore 时应直接返回', async () => {
    delete window.DataStore
    await expect(window.StudyRoom.saveRoomState()).resolves.toBeUndefined()
    window.DataStore = { getData: vi.fn().mockReturnValue({}), saveImmediate: vi.fn() }
  })

  it('应保存到 data.studyRoom', async () => {
    const data = {}
    window.DataStore.getData.mockReturnValue(data)
    window.StudyRoom.currentRoomId = 'r1'
    window.StudyRoom.currentRoomName = 'Room'

    await window.StudyRoom.saveRoomState()

    expect(data.studyRoom.currentRoomId).toBe('r1')
    expect(data.studyRoom.currentRoomName).toBe('Room')
    expect(window.DataStore.saveImmediate).toHaveBeenCalled()
  })

  it('已有 studyRoom 字段时应保留其他字段', async () => {
    const data = { studyRoom: { otherField: 'x' } }
    window.DataStore.getData.mockReturnValue(data)
    window.StudyRoom.currentRoomId = 'r1'
    window.StudyRoom.currentRoomName = 'Room'

    await window.StudyRoom.saveRoomState()

    expect(data.studyRoom.otherField).toBe('x')
    expect(data.studyRoom.currentRoomId).toBe('r1')
  })
})

describe('StudyRoom restoreRoomState', () => {
  it('无 DataStore 时应直接返回', async () => {
    delete window.DataStore
    await expect(window.StudyRoom.restoreRoomState()).resolves.toBeUndefined()
    window.DataStore = { getData: vi.fn().mockReturnValue({}) }
  })

  it('无 studyRoom 字段时不应修改状态', async () => {
    window.DataStore.getData.mockReturnValue({})
    window.StudyRoom.currentRoomId = 'initial'
    await window.StudyRoom.restoreRoomState()
    expect(window.StudyRoom.currentRoomId).toBe('initial')
  })

  it('应从存储中恢复状态', async () => {
    window.DataStore.getData.mockReturnValue({
      studyRoom: { currentRoomId: 'r2', currentRoomName: 'Restored' }
    })
    window.StudyRoom.currentRoomId = null
    window.StudyRoom.currentRoomName = null

    await window.StudyRoom.restoreRoomState()

    expect(window.StudyRoom.currentRoomId).toBe('r2')
    expect(window.StudyRoom.currentRoomName).toBe('Restored')
  })

  it('字段缺失时应设为 null', async () => {
    window.DataStore.getData.mockReturnValue({ studyRoom: {} })
    window.StudyRoom.currentRoomId = 'something'
    await window.StudyRoom.restoreRoomState()
    expect(window.StudyRoom.currentRoomId).toBeNull()
    expect(window.StudyRoom.currentRoomName).toBeNull()
  })
})

describe('StudyRoom showToast', () => {
  it('加载类提示应被过滤（不显示）', () => {
    window.StudyRoom.showToast('正在加载...')
    const toasts = document.querySelectorAll('.study-room-toast')
    expect(toasts.length).toBe(0)
  })

  it('弹窗未激活时应使用全局 toast', () => {
    const modalEl = document.getElementById('study-room-modal')
    modalEl.classList.remove('active')
    window.StudyRoom.showToast('操作成功')
    const toast = document.getElementById('ui-toast')
    expect(toast.textContent).toBe('操作成功')
    expect(toast.classList.contains('show')).toBe(true)
  })

  it('弹窗激活时应在 header 显示 toast', () => {
    const modalEl = document.getElementById('study-room-modal')
    modalEl.classList.add('active')
    window.StudyRoom.showToast('操作成功')

    const toast = document.querySelector('.study-room-modal-header .study-room-toast')
    expect(toast).not.toBeNull()
    expect(toast.textContent).toBe('操作成功')

    // 3秒后应添加 fade-out 类
    vi.advanceTimersByTime(3000)
    expect(toast.classList.contains('fade-out')).toBe(true)
  })

  it('已有旧 toast 时应先移除', () => {
    const modalEl = document.getElementById('study-room-modal')
    modalEl.classList.add('active')
    window.StudyRoom.showToast('first')
    window.StudyRoom.showToast('second')

    const toasts = document.querySelectorAll('.study-room-modal-header .study-room-toast')
    expect(toasts.length).toBe(1)
    expect(toasts[0].textContent).toBe('second')
  })
})

describe('StudyRoom debug 函数', () => {
  it('debugOpen 应调用 openModal', () => {
    const spy = vi.spyOn(window.StudyRoom, 'openModal')
    window.StudyRoom.debugOpen()
    expect(spy).toHaveBeenCalled()
  })

  it('debugSetTotalMinutes 应更新数据并刷新需求', async () => {
    const data = { stats: {} }
    window.electronAPI.readData.mockResolvedValue(data)
    const spy = vi.spyOn(window.StudyRoom, 'updateRequirements')

    await window.StudyRoom.debugSetTotalMinutes(50)
    await vi.advanceTimersByTimeAsync(50)

    expect(window.electronAPI.writeData).toHaveBeenCalledWith(data)
    expect(data.stats.totalMinutes).toBe(50)
    expect(spy).toHaveBeenCalled()
  })

  it('debugSetTotalMinutes 失败时不应报错', async () => {
    window.electronAPI.readData.mockRejectedValue(new Error('fail'))
    await expect(window.StudyRoom.debugSetTotalMinutes(50)).resolves.toBeUndefined()
  })

  it('debugEnableButtons 应启用按钮', () => {
    document.getElementById('study-room-create-btn').disabled = true
    document.getElementById('study-room-join-btn').disabled = true

    window.StudyRoom.debugEnableButtons()

    expect(document.getElementById('study-room-create-btn').disabled).toBe(false)
    expect(document.getElementById('study-room-join-btn').disabled).toBe(false)
  })
})

describe('StudyRoom bindEvents', () => {
  it('点击关闭按钮应调用 closeModal', () => {
    const spy = vi.spyOn(window.StudyRoom, 'closeModal')
    document.getElementById('study-room-modal-close').click()
    expect(spy).toHaveBeenCalled()
  })

  it('点击我的自习室按钮应调用 showMyRooms', async () => {
    const spy = vi.spyOn(window.StudyRoom, 'showMyRooms').mockResolvedValue(undefined)
    document.getElementById('study-room-my-rooms-btn').click()
    expect(spy).toHaveBeenCalled()
  })

  it('点击创建按钮（disabled 时）不应调用 handleCreate', async () => {
    setTotalMinutes(5)
    await window.StudyRoom.updateRequirements()
    const spy = vi.spyOn(window.StudyRoom, 'handleCreate')
    document.getElementById('study-room-create-btn').click()
    expect(spy).not.toHaveBeenCalled()
  })

  it('点击创建按钮（enabled 时）应调用 handleCreate', async () => {
    setTotalMinutes(20)
    await window.StudyRoom.updateRequirements()
    const spy = vi.spyOn(window.StudyRoom, 'handleCreate').mockResolvedValue(undefined)
    document.getElementById('study-room-create-btn').click()
    expect(spy).toHaveBeenCalled()
  })

  it('点击加入按钮（enabled 时）应调用 handleJoin', async () => {
    setTotalMinutes(20)
    await window.StudyRoom.updateRequirements()
    const spy = vi.spyOn(window.StudyRoom, 'handleJoin').mockResolvedValue(undefined)
    document.getElementById('study-room-join-btn').click()
    expect(spy).toHaveBeenCalled()
  })

  it('无按钮元素时不应报错', () => {
    document.body.innerHTML = ''
    expect(() => window.StudyRoom.bindEvents()).not.toThrow()
  })
})
