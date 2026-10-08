/**
 * Garden 主模块测试
 *
 * 测试菜园子主入口：初始化、加载渲染、模式切换、惩罚处理
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/utils')
  require('../../src/scripts/modules/garden')
})

beforeEach(() => {
  document.body.innerHTML = `
    <div class="garden-frame"></div>
    <span id="coinCount">0</span>
    <div id="gardenGrid"></div>
    <div id="seedList"></div>
    <div id="cropList"></div>
    <div id="gardenTip"></div>
    <button id="gardenCloseBtn">关闭</button>
    <div id="bagsContainer"></div>
    <div id="garden-seed-bag"></div>
    <div id="garden-crop-bag"></div>
    <button id="shopBtn">商店</button>
    <div id="shopModal"></div>
    <button id="shopCloseBtn">关闭商店</button>
    <div id="shopBuyGrid"></div>
    <div id="shopSellGrid"></div>
    <button id="sellAllBtn">全部出售</button>
    <button id="signinBtn">签到</button>
    <div id="signinModal"></div>
    <button id="signinCloseBtn">关闭签到</button>
    <span id="signinContinuous">0</span>
    <span id="signinTotal">0</span>
    <div id="signinWeekDots"></div>
    <div id="signinRewardsList"></div>
    <button id="signinConfirmBtn">签到</button>
    <button id="achievementBtn">成就</button>
    <button id="achievementBtnCrop">成就2</button>
    <div id="achievementModal"></div>
    <button id="achievementCloseBtn">关闭成就</button>
    <span id="achievementUnlocked">0</span>
    <span id="achievementTotal">0</span>
    <div id="achievementTabs"></div>
    <div id="achievementList"></div>
    <div id="achievementModal"></div>
  `

  window.electronAPI = {
    gardenRead: vi.fn().mockResolvedValue(null),
    closeGarden: vi.fn(),
    onGardenRefresh: vi.fn(),
    readSettings: vi.fn().mockResolvedValue({ plantWheelMode: true }),
    gardenPunishment: vi.fn()
  }

  window.BaseModal = vi.fn().mockImplementation(function({ element, onShow, onHide, showClass } = {}) {
    return {
      element,
      showClass,
      show: vi.fn(() => onShow && onShow()),
      hide: vi.fn(() => onHide && onHide()),
      toggle: vi.fn()
    }
  })

  // 子模块 mock
  window.GardenPlot = {
    renderPlots: vi.fn(),
    harvestCrop: vi.fn(),
    plantCrop: vi.fn(),
    unlockPlot: vi.fn(),
    CROP_CONFIG: window.Utils.CROP_CONFIG
  }

  window.GardenBag = {
    initBagEvents: vi.fn(),
    renderSeeds: vi.fn(),
    renderCrops: vi.fn(),
    handleSeedSelect: vi.fn().mockReturnValue(null)
  }

  window.GardenShop = {
    init: vi.fn(),
    openShop: vi.fn()
  }

  window.GardenSignin = {
    init: vi.fn(),
    openSigninModal: vi.fn(),
    updateSigninBtnStatus: vi.fn()
  }

  window.GardenAchievement = {
    init: vi.fn(),
    openAchievementModal: vi.fn(),
    renderAchievementModal: vi.fn(),
    updateAchievementStats: vi.fn().mockResolvedValue({})
  }

  window.PlantWheel = {
    show: vi.fn(),
    hide: vi.fn(),
    isActive: vi.fn().mockReturnValue(false)
  }
})

function createDefaultGardenData(overrides = {}) {
  return Object.assign({
    coins: 100,
    seeds: { carrot: 5, tomato: 2, sunflower: 0, rose: 0, osmanthus: 0 },
    crops: { carrot: 3, tomato: 1, sunflower: 0, rose: 0, osmanthus: 0 },
    plots: [
      { crop: null, progress: 0, unlocked: true },
      { crop: null, progress: 0, unlocked: true },
      { crop: null, progress: 0, unlocked: false }
    ],
    achievements: {},
    achievementStats: {
      totalFocusMinutes: 0,
      totalHarvestCount: 0,
      totalPlantCount: 0,
      cropTypesCollected: [],
      totalCoinsEarned: 0
    },
    signIn: {
      lastDate: null,
      continuousDays: 0,
      totalDays: 0
    }
  }, overrides)
}

describe('Garden init', () => {
  it('init 应读取设置、初始化子模块、加载数据', async () => {
    const gardenData = createDefaultGardenData()
    window.electronAPI.gardenRead.mockResolvedValue(gardenData)

    await window.Garden.init()

    expect(window.electronAPI.readSettings).toHaveBeenCalled()
    expect(window.GardenShop.init).toHaveBeenCalled()
    expect(window.GardenSignin.init).toHaveBeenCalled()
    expect(window.GardenAchievement.init).toHaveBeenCalled()
    expect(window.electronAPI.gardenRead).toHaveBeenCalled()
  })

  it('gardenRead 返回 null 时 render 应跳过（currentGardenData 为 null）', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(null)

    await window.Garden.init()

    // render() 在 currentGardenData 为 null 时直接 return，不调用 renderPlots
    expect(window.GardenPlot.renderPlots).not.toHaveBeenCalled()
  })

  it('gardenRead 抛错应使用默认数据', async () => {
    window.electronAPI.gardenRead.mockRejectedValue(new Error('read failed'))

    await window.Garden.init()

    expect(window.GardenPlot.renderPlots).toHaveBeenCalled()
  })

  it('没有 gardenGrid 元素时应直接 return（非菜园子页面）', async () => {
    document.body.innerHTML = '' // 清空 DOM
    await window.Garden.init()
    // 不报错即可
    expect(window.electronAPI.gardenRead).not.toHaveBeenCalled()
  })

  it('plantWheelMode=false 时应初始化 GardenBag.initBagEvents', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ plantWheelMode: false })
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())

    await window.Garden.init()

    expect(window.GardenBag.initBagEvents).toHaveBeenCalled()
  })

  it('点击关闭按钮应调用 closeGarden', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    const closeBtn = document.getElementById('gardenCloseBtn')
    vi.useFakeTimers()
    closeBtn.click()
    // 关闭按钮使用 setTimeout(500) 等待关闭动画
    await vi.advanceTimersByTimeAsync(500)
    vi.useRealTimers()

    expect(window.electronAPI.closeGarden).toHaveBeenCalled()
  })
})

describe('Garden render', () => {
  it('render 应更新金币、调用 renderPlots 和 renderCrops', async () => {
    const data = createDefaultGardenData({ coins: 250 })
    window.electronAPI.gardenRead.mockResolvedValue(data)

    await window.Garden.init()

    expect(document.getElementById('coinCount').textContent).toBe('250')
    expect(window.GardenPlot.renderPlots).toHaveBeenCalled()
    expect(window.GardenBag.renderCrops).toHaveBeenCalled()
  })

  it('轮盘模式下不应调用 renderSeeds', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ plantWheelMode: true })
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())

    await window.Garden.init()

    expect(window.GardenBag.renderSeeds).not.toHaveBeenCalled()
    expect(window.GardenBag.renderCrops).toHaveBeenCalled()
  })

  it('非轮盘模式应调用 renderSeeds 和 renderCrops', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ plantWheelMode: false })
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())

    await window.Garden.init()

    expect(window.GardenBag.renderSeeds).toHaveBeenCalled()
    expect(window.GardenBag.renderCrops).toHaveBeenCalled()
  })
})

describe('Garden 轮盘模式', () => {
  it('getWheelMode 应返回当前模式', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    expect(window.Garden.getWheelMode()).toBe(true)
  })

  it('setWheelMode(false) 应关闭轮盘模式并初始化背包事件', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    window.Garden.setWheelMode(false)

    expect(window.Garden.getWheelMode()).toBe(false)
    expect(window.GardenBag.initBagEvents).toHaveBeenCalled()
    const frame = document.querySelector('.garden-frame')
    expect(frame.classList.contains('wheel-mode')).toBe(false)
  })

  it('setWheelMode(true) 应开启轮盘模式并添加 wheel-mode 类', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    window.Garden.setWheelMode(false)
    window.Garden.setWheelMode(true)

    expect(window.Garden.getWheelMode()).toBe(true)
    const frame = document.querySelector('.garden-frame')
    expect(frame.classList.contains('wheel-mode')).toBe(true)
  })
})

describe('Garden handleResetPunishment', () => {
  it('无 electronAPI.gardenPunishment 应返回默认空结果', async () => {
    window.electronAPI.gardenPunishment = undefined
    const result = await window.Garden.handleResetPunishment()
    expect(result).toEqual({ hasLoss: false, losses: [], totalMinutes: 0 })
  })

  it('有 gardenPunishment 应返回调用结果', async () => {
    const mockResult = { hasLoss: true, losses: [{ crop: 'carrot' }], totalMinutes: 10 }
    window.electronAPI.gardenPunishment.mockResolvedValue(mockResult)
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    const result = await window.Garden.handleResetPunishment()
    expect(result).toEqual(mockResult)
  })

  it('hasLoss=true 时（在菜园子页面）应重新加载数据', async () => {
    const mockResult = { hasLoss: true, losses: [{ crop: 'carrot' }], totalMinutes: 10 }
    window.electronAPI.gardenPunishment.mockResolvedValue(mockResult)
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    // 清除调用记录
    window.electronAPI.gardenRead.mockClear()

    await window.Garden.handleResetPunishment()

    expect(window.electronAPI.gardenRead).toHaveBeenCalled()
  })
})

describe('Garden updateData / updateTip / render', () => {
  it('updateData 应更新内部数据', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    const newData = createDefaultGardenData({ coins: 999 })
    window.Garden.updateData(newData)
    window.Garden.render()

    expect(document.getElementById('coinCount').textContent).toBe('999')
  })

  it('updateTip 应更新提示文字', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    window.Garden.updateTip('测试提示')
    expect(document.getElementById('gardenTip').textContent).toBe('测试提示')
  })

  it('updateAchievementStats 应委托给 GardenAchievement', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    await window.Garden.updateAchievementStats('focus', 60)
    expect(window.GardenAchievement.updateAchievementStats).toHaveBeenCalledWith('focus', 60, expect.any(Function))
  })

  it('checkAndUnlockAchievements 应不报错（已废弃）', async () => {
    await expect(window.Garden.checkAndUnlockAchievements()).resolves.toBeUndefined()
  })

  it('updateProgress 应不报错（已废弃）', async () => {
    await expect(window.Garden.updateProgress()).resolves.toBeUndefined()
  })
})

describe('Garden onGardenRefresh', () => {
  it('init 应注册 onGardenRefresh 监听器', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    expect(window.electronAPI.onGardenRefresh).toHaveBeenCalled()
  })
})

describe('Garden handlePlotClick', () => {
  it('成熟作物应调用 harvestCrop', async () => {
    const data = createDefaultGardenData()
    data.plots[0] = { crop: 'carrot', progress: 25, unlocked: true } // 25/25 = 100%
    window.electronAPI.gardenRead.mockResolvedValue(data)
    window.GardenPlot.harvestCrop.mockResolvedValue({ success: true })
    await window.Garden.init()

    // handlePlotClick is passed as onPlotClick callback to GardenPlot.renderPlots
    const onPlotClick = window.GardenPlot.renderPlots.mock.calls[0][3]
    await onPlotClick(0, { clientX: 100, clientY: 100 })

    expect(window.GardenPlot.harvestCrop).toHaveBeenCalledWith(0, expect.any(Function), expect.any(Function))
  })

  it('未成熟作物应显示提示', async () => {
    const data = createDefaultGardenData()
    data.plots[0] = { crop: 'carrot', progress: 10, unlocked: true } // 10/25 = 40%
    window.electronAPI.gardenRead.mockResolvedValue(data)
    await window.Garden.init()

    const onPlotClick = window.GardenPlot.renderPlots.mock.calls[0][3]
    await onPlotClick(0, { clientX: 100, clientY: 100 })

    expect(document.getElementById('gardenTip').textContent).toContain('还未成熟')
  })

  it('轮盘模式空格子应显示 PlantWheel', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ plantWheelMode: true })
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    const onPlotClick = window.GardenPlot.renderPlots.mock.calls[0][3]
    await onPlotClick(0, { clientX: 100, clientY: 100 })

    expect(window.PlantWheel.show).toHaveBeenCalled()
  })

  it('轮盘模式 PlantWheel 回调种植种子', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ plantWheelMode: true })
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    window.GardenPlot.plantCrop.mockResolvedValue({ success: true })
    await window.Garden.init()

    const onPlotClick = window.GardenPlot.renderPlots.mock.calls[0][3]
    await onPlotClick(0, { clientX: 100, clientY: 100 })

    // Get the PlantWheel.show callback
    const plantWheelCallback = window.PlantWheel.show.mock.calls[0][4]
    await plantWheelCallback('carrot')

    expect(window.GardenPlot.plantCrop).toHaveBeenCalledWith(0, 'carrot', expect.any(Function), expect.any(Function))
  })

  it('轮盘模式无 event 不应显示 PlantWheel', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ plantWheelMode: true })
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    const onPlotClick = window.GardenPlot.renderPlots.mock.calls[0][3]
    await onPlotClick(0, null)

    expect(window.PlantWheel.show).not.toHaveBeenCalled()
  })

  it('传统模式有选中种子应调用 plantCrop', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ plantWheelMode: false })
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    window.GardenPlot.plantCrop.mockResolvedValue({ success: true })
    window.GardenBag.handleSeedSelect.mockReturnValue('carrot')
    await window.Garden.init()

    // Simulate selecting a seed
    const onSeedSelect = window.GardenBag.renderSeeds.mock.calls[0][3]
    onSeedSelect('carrot')

    const onPlotClick = window.GardenPlot.renderPlots.mock.calls[0][3]
    await onPlotClick(0, { clientX: 100, clientY: 100 })

    expect(window.GardenPlot.plantCrop).toHaveBeenCalledWith(0, 'carrot', expect.any(Function), expect.any(Function))
  })

  it('传统模式种子用完应清除选中种子', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ plantWheelMode: false })
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    window.GardenPlot.plantCrop.mockResolvedValue({ success: true, clearSeed: true })
    window.GardenBag.handleSeedSelect.mockReturnValue('carrot')
    await window.Garden.init()

    const onSeedSelect = window.GardenBag.renderSeeds.mock.calls[0][3]
    onSeedSelect('carrot')

    const onPlotClick = window.GardenPlot.renderPlots.mock.calls[0][3]
    await onPlotClick(0, { clientX: 100, clientY: 100 })

    // After clearSeed, planting again should show '请先选择一个种子'
    await onPlotClick(1, { clientX: 100, clientY: 100 })
    expect(document.getElementById('gardenTip').textContent).toContain('请先选择一个种子')
  })

  it('传统模式无选中种子应显示提示', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ plantWheelMode: false })
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    const onPlotClick = window.GardenPlot.renderPlots.mock.calls[0][3]
    await onPlotClick(0, { clientX: 100, clientY: 100 })

    expect(document.getElementById('gardenTip').textContent).toContain('请先选择一个种子')
  })
})

describe('Garden handleUnlockPlot', () => {
  it('解锁成功应重新渲染', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    window.GardenPlot.unlockPlot.mockResolvedValue({ success: true })
    await window.Garden.init()

    const onUnlock = window.GardenPlot.renderPlots.mock.calls[0][4]
    await onUnlock(2)

    expect(window.GardenPlot.unlockPlot).toHaveBeenCalledWith(2, expect.any(Function), expect.any(Function))
  })
})

describe('Garden handleSeedSelect', () => {
  it('应委托给 GardenBag.handleSeedSelect 并重新渲染', async () => {
    window.electronAPI.readSettings.mockResolvedValue({ plantWheelMode: false })
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    window.GardenBag.handleSeedSelect.mockReturnValue('tomato')
    await window.Garden.init()

    // Get the onSeedSelect callback from the last renderSeeds call
    const calls = window.GardenBag.renderSeeds.mock.calls
    const onSeedSelect = calls[calls.length - 1][3]
    onSeedSelect('tomato')

    expect(window.GardenBag.handleSeedSelect).toHaveBeenCalledWith('tomato', null, expect.any(Function))
    expect(window.GardenBag.renderSeeds).toHaveBeenCalled()
  })
})

describe('Garden loadWheelModeSetting 错误处理', () => {
  it('readSettings 抛错应使用默认 wheelMode=true', async () => {
    window.electronAPI.readSettings.mockRejectedValue(new Error('read error'))
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())

    await window.Garden.init()

    expect(window.Garden.getWheelMode()).toBe(true)
  })
})

describe('Garden loadAndRender 成就墙刷新', () => {
  it('成就墙打开时应刷新成就墙', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    // 模拟成就墙已打开
    const achievementModal = document.getElementById('achievementModal')
    achievementModal.classList.add('show')

    window.GardenAchievement.renderAchievementModal.mockClear()
    window.electronAPI.gardenRead.mockClear()
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData({ coins: 500 }))

    // 触发 onGardenRefresh 回调
    const refreshCallback = window.electronAPI.onGardenRefresh.mock.calls[0][0]
    await refreshCallback()

    expect(window.GardenAchievement.renderAchievementModal).toHaveBeenCalled()
  })
})

describe('Garden initSubModules 按钮事件', () => {
  it('点击商店按钮应调用 GardenShop.openShop', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    document.getElementById('shopBtn').click()

    expect(window.GardenShop.openShop).toHaveBeenCalled()
  })

  it('点击签到按钮应调用 GardenSignin.openSigninModal', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    document.getElementById('signinBtn').click()

    expect(window.GardenSignin.openSigninModal).toHaveBeenCalled()
  })

  it('点击成就按钮应调用 GardenAchievement.openAchievementModal', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    window.electronAPI.gardenRead.mockClear()
    document.getElementById('achievementBtn').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.GardenAchievement.openAchievementModal).toHaveBeenCalled()
  })

  it('点击作物背包成就按钮应调用 GardenAchievement.openAchievementModal', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    window.electronAPI.gardenRead.mockClear()
    document.getElementById('achievementBtnCrop').click()

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(window.GardenAchievement.openAchievementModal).toHaveBeenCalled()
  })
})

describe('Garden 关闭按钮无 gardenFrame', () => {
  it('无 gardenFrame 应直接调用 closeGarden', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    document.querySelector('.garden-frame').remove()
    await window.Garden.init()

    document.getElementById('gardenCloseBtn').click()

    expect(window.electronAPI.closeGarden).toHaveBeenCalled()
  })
})

describe('Garden handleResetPunishment 提示', () => {
  it('hasLoss=true 时应显示惩罚提示', async () => {
    const mockResult = { hasLoss: true, losses: [{ crop: 'carrot' }], totalMinutes: 10 }
    window.electronAPI.gardenPunishment.mockResolvedValue(mockResult)
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    document.getElementById('gardenTip').textContent = ''
    await window.Garden.handleResetPunishment()

    expect(document.getElementById('gardenTip').textContent).toContain('枯萎')
  })
})

describe('Garden onGardenRefresh 回调', () => {
  it('refresh 回调应重新加载数据', async () => {
    window.electronAPI.gardenRead.mockResolvedValue(createDefaultGardenData())
    await window.Garden.init()

    window.electronAPI.gardenRead.mockClear()
    const refreshCallback = window.electronAPI.onGardenRefresh.mock.calls[0][0]
    await refreshCallback()

    expect(window.electronAPI.gardenRead).toHaveBeenCalled()
  })
})
