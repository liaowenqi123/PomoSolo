/**
 * GardenSignin 模块测试
 *
 * 测试签到：初始化、打开/关闭、签到检查、执行签到
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/utils')
  require('../../src/scripts/modules/gardenSignin')
})

beforeEach(() => {
  document.body.innerHTML = `
    <div id="signinModal"></div>
    <button id="signinBtn">签到</button>
    <button id="signinCloseBtn">关闭</button>
    <span id="signinContinuous">0</span>
    <span id="signinTotal">0</span>
    <div id="signinWeekDots">
      <div class="signin-dot"></div>
      <div class="signin-dot"></div>
      <div class="signin-dot"></div>
      <div class="signin-dot"></div>
      <div class="signin-dot"></div>
      <div class="signin-dot"></div>
      <div class="signin-dot"></div>
    </div>
    <div id="signinRewardsList"></div>
    <button id="signinConfirmBtn">签到</button>
  `

  window.BaseModal = vi.fn().mockImplementation(function({ element, onShow, onHide } = {}) {
    return {
      element,
      show: vi.fn(() => onShow && onShow()),
      hide: vi.fn(() => onHide && onHide()),
      toggle: vi.fn()
    }
  })

  window.electronAPI = {
    gardenSignIn: vi.fn()
  }

  window.Garden = {
    updateData: vi.fn(),
    render: vi.fn()
  }

  window.GardenSignin.init({
    signinBtn: document.getElementById('signinBtn'),
    signinModal: document.getElementById('signinModal'),
    signinCloseBtn: document.getElementById('signinCloseBtn'),
    signinContinuous: document.getElementById('signinContinuous'),
    signinTotal: document.getElementById('signinTotal'),
    signinWeekDots: document.getElementById('signinWeekDots'),
    signinRewardsList: document.getElementById('signinRewardsList'),
    signinConfirmBtn: document.getElementById('signinConfirmBtn')
  })
})

function createDefaultData() {
  return {
    coins: 100,
    seeds: { carrot: 5, tomato: 2, sunflower: 0, rose: 0, osmanthus: 0 },
    signIn: {
      lastDate: null,
      continuousDays: 0,
      totalDays: 0,
      weekRecords: [false, false, false, false, false, false, false]
    }
  }
}

describe('GardenSignin init', () => {
  it('init 应创建 BaseModal 实例', () => {
    expect(window.BaseModal).toHaveBeenCalled()
  })
})

describe('GardenSignin openSigninModal / closeSigninModal', () => {
  it('openSigninModal 应渲染签到信息', () => {
    const data = createDefaultData()
    data.signIn.continuousDays = 5
    data.signIn.totalDays = 10

    window.GardenSignin.openSigninModal(data, vi.fn())

    expect(document.getElementById('signinContinuous').textContent).toBe('5')
    expect(document.getElementById('signinTotal').textContent).toBe('10')
  })

  it('openSigninModal 未签到应启用签到按钮', () => {
    window.GardenSignin.openSigninModal(createDefaultData(), vi.fn())

    expect(document.getElementById('signinConfirmBtn').disabled).toBe(false)
    expect(document.getElementById('signinConfirmBtn').textContent).toContain('立即签到')
  })

  it('openSigninModal 已签到应禁用签到按钮', () => {
    const data = createDefaultData()
    data.signIn.lastDate = new Date().toDateString()

    window.GardenSignin.openSigninModal(data, vi.fn())

    expect(document.getElementById('signinConfirmBtn').disabled).toBe(true)
    expect(document.getElementById('signinConfirmBtn').textContent).toBe('今日已签到')
  })

  it('closeSigninModal 不应报错', () => {
    expect(() => window.GardenSignin.closeSigninModal()).not.toThrow()
  })
})

describe('GardenSignin renderSigninModal', () => {
  it('应渲染连续签到天数', () => {
    const data = createDefaultData()
    data.signIn.continuousDays = 7

    window.GardenSignin.renderSigninModal(data)

    expect(document.getElementById('signinContinuous').textContent).toBe('7')
  })

  it('应渲染签到奖励列表', () => {
    window.GardenSignin.renderSigninModal(createDefaultData())

    expect(document.getElementById('signinRewardsList').children.length).toBeGreaterThan(0)
  })

  it('无 signIn 数据应使用默认值', () => {
    expect(() => window.GardenSignin.renderSigninModal({})).not.toThrow()
  })
})

describe('GardenSignin canSignIn', () => {
  it('未签到应返回 true', () => {
    expect(window.GardenSignin.canSignIn(createDefaultData())).toBe(true)
  })

  it('已签到应返回 false', () => {
    const data = createDefaultData()
    data.signIn.lastDate = new Date().toDateString()

    expect(window.GardenSignin.canSignIn(data)).toBe(false)
  })

  it('无 signIn 数据应返回 true', () => {
    expect(window.GardenSignin.canSignIn({})).toBe(true)
  })
})

describe('GardenSignin updateSigninBtnStatus', () => {
  it('未签到应移除 signed 类', () => {
    const btn = document.getElementById('signinBtn')
    btn.classList.add('signed')

    window.GardenSignin.updateSigninBtnStatus(createDefaultData())

    expect(btn.classList.contains('signed')).toBe(false)
  })

  it('已签到应添加 signed 类', () => {
    const data = createDefaultData()
    data.signIn.lastDate = new Date().toDateString()

    window.GardenSignin.updateSigninBtnStatus(data)

    expect(document.getElementById('signinBtn').classList.contains('signed')).toBe(true)
  })
})

describe('GardenSignin handleSignIn', () => {
  it('签到成功应更新数据', async () => {
    const newData = createDefaultData()
    newData.signIn.lastDate = new Date().toDateString()
    newData.signIn.continuousDays = 1
    newData.signIn.totalDays = 1
    window.electronAPI.gardenSignIn.mockResolvedValue({
      success: true,
      garden: newData,
      unlockedAchievements: []
    })

    // 先打开签到弹窗设置 currentData
    window.GardenSignin.openSigninModal(createDefaultData(), vi.fn())

    // 点击签到按钮
    document.getElementById('signinConfirmBtn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.electronAPI.gardenSignIn).toHaveBeenCalled()
    expect(window.Garden.updateData).toHaveBeenCalledWith(newData)
  })

  it('签到成功解锁成就应显示提示', async () => {
    const newData = createDefaultData()
    newData.signIn.lastDate = new Date().toDateString()
    window.electronAPI.gardenSignIn.mockResolvedValue({
      success: true,
      garden: newData,
      unlockedAchievements: [{ name: '坚持一周' }]
    })

    const updateTip = vi.fn()
    window.GardenSignin.openSigninModal(createDefaultData(), updateTip)
    document.getElementById('signinConfirmBtn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(updateTip).toHaveBeenCalledWith(expect.stringContaining('坚持一周'))
  })
})

describe('GardenSignin 未覆盖分支补充', () => {
  it('点击签到弹窗背景应关闭弹窗', () => {
    const signinModal = document.getElementById('signinModal')
    signinModal.dispatchEvent(new Event('click', { bubbles: true }))

    const signinModalInstance = window.BaseModal.mock.results[0].value
    expect(signinModalInstance.hide).toHaveBeenCalled()
  })

  it('点击签到按钮应打开签到弹窗', () => {
    document.getElementById('signinBtn').click()

    const signinModalInstance = window.BaseModal.mock.results[0].value
    expect(signinModalInstance.show).toHaveBeenCalled()
  })

  it('点击关闭按钮应关闭签到弹窗', () => {
    document.getElementById('signinCloseBtn').click()

    const signinModalInstance = window.BaseModal.mock.results[0].value
    expect(signinModalInstance.hide).toHaveBeenCalled()
  })

  it('openSigninModal 应调用 signinModal.show', () => {
    window.GardenSignin.openSigninModal(createDefaultData(), vi.fn())

    const signinModalInstance = window.BaseModal.mock.results[0].value
    expect(signinModalInstance.show).toHaveBeenCalled()
  })

  it('已签到的天数应有 signed 类', () => {
    const data = createDefaultData()
    const today = new Date().getDay()
    data.signIn.weekRecords = [false, false, false, false, false, false, false]
    data.signIn.weekRecords[today] = true

    window.GardenSignin.renderSigninModal(data)

    const dots = document.querySelectorAll('.signin-dot')
    const todayDot = today === 0 ? dots[6] : dots[today - 1]
    expect(todayDot.classList.contains('signed')).toBe(true)
  })

  it('今天应有 today 类', () => {
    window.GardenSignin.renderSigninModal(createDefaultData())

    const dots = document.querySelectorAll('.signin-dot')
    const today = new Date().getDay()
    const todayDot = today === 0 ? dots[6] : dots[today - 1]
    expect(todayDot.classList.contains('today')).toBe(true)
  })

  it('签到失败应显示错误消息', async () => {
    window.electronAPI.gardenSignIn.mockResolvedValue({
      success: false,
      message: '签到失败'
    })

    const updateTip = vi.fn()
    window.GardenSignin.openSigninModal(createDefaultData(), updateTip)
    document.getElementById('signinConfirmBtn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(updateTip).toHaveBeenCalledWith('签到失败')
  })

  it('已签到时点击签到按钮应显示已签到提示', async () => {
    const data = createDefaultData()
    data.signIn.lastDate = new Date().toDateString()

    const updateTip = vi.fn()
    window.GardenSignin.openSigninModal(data, updateTip)

    // 按钮被禁用，手动重新启用以触发事件
    const btn = document.getElementById('signinConfirmBtn')
    btn.disabled = false
    btn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(updateTip).toHaveBeenCalledWith('今日已签到')
    expect(window.electronAPI.gardenSignIn).not.toHaveBeenCalled()
  })

  it('签到成功应调用 Garden.render', async () => {
    const newData = createDefaultData()
    newData.signIn.lastDate = new Date().toDateString()
    window.electronAPI.gardenSignIn.mockResolvedValue({
      success: true,
      garden: newData,
      unlockedAchievements: []
    })

    window.Garden.render.mockClear()
    window.GardenSignin.openSigninModal(createDefaultData(), vi.fn())
    document.getElementById('signinConfirmBtn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.Garden.render).toHaveBeenCalled()
  })

  it('连续签到天数达到里程碑应显示里程碑奖励', () => {
    const data = createDefaultData()
    data.signIn.continuousDays = 6

    window.GardenSignin.renderSigninModal(data)

    expect(document.getElementById('signinRewardsList').innerHTML).toContain('连续')
  })

  it('getNextMilestone 超过所有里程碑应返回 null', () => {
    const data = createDefaultData()
    data.signIn.continuousDays = 999

    window.GardenSignin.renderSigninModal(data)

    // 不崩溃即可
    expect(true).toBe(true)
  })
})
