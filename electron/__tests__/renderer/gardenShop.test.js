/**
 * GardenShop 模块测试
 *
 * 测试商店：初始化、打开/关闭、购买种子、出售作物
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/utils')
  require('../../src/scripts/modules/gardenShop')
})

beforeEach(() => {
  document.body.innerHTML = `
    <div id="shopModal"></div>
    <button id="shopBtn">商店</button>
    <button id="shopCloseBtn">关闭</button>
    <div id="shopBuyGrid"></div>
    <div id="shopSellGrid"></div>
    <button id="sellAllBtn">全部出售</button>
    <div class="shop-tab" data-tab="buy">购买</div>
    <div class="shop-tab" data-tab="sell">出售</div>
    <div id="buyPanel"></div>
    <div id="sellPanel"></div>
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
    gardenBuySeed: vi.fn(),
    gardenSellCrop: vi.fn(),
    gardenSellAll: vi.fn()
  }

  window.Garden = {
    updateData: vi.fn(),
    updateTip: vi.fn(),
    render: vi.fn()
  }

  window.GardenShop.init({
    shopBtn: document.getElementById('shopBtn'),
    shopModal: document.getElementById('shopModal'),
    shopCloseBtn: document.getElementById('shopCloseBtn'),
    shopBuyGrid: document.getElementById('shopBuyGrid'),
    shopSellGrid: document.getElementById('shopSellGrid'),
    sellAllBtn: document.getElementById('sellAllBtn')
  })
})

function createDefaultData() {
  return {
    coins: 100,
    seeds: { carrot: 5, tomato: 2, sunflower: 0, rose: 0, osmanthus: 0 },
    crops: { carrot: 3, tomato: 1, sunflower: 0, rose: 0, osmanthus: 0 }
  }
}

describe('GardenShop init', () => {
  it('init 应创建 BaseModal 实例', () => {
    expect(window.BaseModal).toHaveBeenCalled()
  })
})

describe('GardenShop openShop / closeShop', () => {
  it('openShop 应渲染购买和出售列表', () => {
    const updateTip = vi.fn()
    window.GardenShop.openShop(createDefaultData(), updateTip)

    expect(document.getElementById('shopBuyGrid').children.length).toBe(5)
    expect(document.getElementById('shopSellGrid').children.length).toBe(2)
  })

  it('openShop 金币不足时购买按钮应禁用', () => {
    const data = createDefaultData()
    data.coins = 5
    window.GardenShop.openShop(data, vi.fn())

    const buyBtns = document.querySelectorAll('#shopBuyGrid .shop-item-btn')
    expect(buyBtns[0].disabled).toBe(true) // carrot seedPrice=8, coins=5
  })

  it('closeShop 不应报错', () => {
    expect(() => window.GardenShop.closeShop()).not.toThrow()
  })
})

describe('GardenShop renderShopBuy', () => {
  it('应渲染 5 个种子项', () => {
    window.GardenShop.renderShopBuy(createDefaultData(), vi.fn())

    expect(document.getElementById('shopBuyGrid').children.length).toBe(5)
  })

  it('应显示种子价格', () => {
    window.GardenShop.renderShopBuy(createDefaultData(), vi.fn())

    expect(document.getElementById('shopBuyGrid').innerHTML).toContain('8') // carrot seedPrice
  })

  it('data 为 null 不应报错', () => {
    expect(() => window.GardenShop.renderShopBuy(null, vi.fn())).not.toThrow()
  })
})

describe('GardenShop renderShopSell', () => {
  it('有作物应渲染出售项', () => {
    window.GardenShop.renderShopSell(createDefaultData(), vi.fn())

    expect(document.getElementById('shopSellGrid').children.length).toBe(2)
  })

  it('无作物应显示空提示', () => {
    window.GardenShop.renderShopSell({ crops: {} }, vi.fn())

    expect(document.getElementById('shopSellGrid').innerHTML).toContain('暂无')
  })

  it('无作物应禁用全部出售按钮', () => {
    window.GardenShop.renderShopSell({ crops: {} }, vi.fn())

    expect(document.getElementById('sellAllBtn').disabled).toBe(true)
  })

  it('有作物应启用全部出售按钮', () => {
    window.GardenShop.renderShopSell(createDefaultData(), vi.fn())

    expect(document.getElementById('sellAllBtn').disabled).toBe(false)
  })
})

describe('GardenShop buySeed', () => {
  it('购买成功应更新数据并重新渲染', async () => {
    const newData = createDefaultData()
    newData.coins = 92
    newData.seeds.carrot = 6
    window.electronAPI.gardenBuySeed.mockResolvedValue({
      success: true,
      garden: newData,
      message: '购买成功'
    })

    const updateTip = vi.fn()
    const result = await window.GardenShop.buySeed('carrot', updateTip)

    expect(result.success).toBe(true)
    expect(window.Garden.updateData).toHaveBeenCalledWith(newData)
    expect(updateTip).toHaveBeenCalledWith('购买成功')
    expect(window.Garden.render).toHaveBeenCalled()
  })

  it('购买失败应显示错误消息', async () => {
    window.electronAPI.gardenBuySeed.mockResolvedValue({
      success: false,
      message: '金币不足'
    })

    const updateTip = vi.fn()
    const result = await window.GardenShop.buySeed('carrot', updateTip)

    expect(result.success).toBe(false)
    expect(updateTip).toHaveBeenCalledWith('金币不足')
  })
})

describe('GardenShop sellCrop', () => {
  it('出售成功应更新数据', async () => {
    const newData = createDefaultData()
    newData.crops.carrot = 2
    newData.coins = 110
    window.electronAPI.gardenSellCrop.mockResolvedValue({
      success: true,
      garden: newData,
      message: '出售成功',
      unlockedAchievements: []
    })

    const updateTip = vi.fn()
    const result = await window.GardenShop.sellCrop('carrot', updateTip)

    expect(result.success).toBe(true)
    expect(window.Garden.updateData).toHaveBeenCalledWith(newData)
    expect(updateTip).toHaveBeenCalledWith('出售成功')
  })

  it('出售成功解锁成就应显示提示', async () => {
    window.electronAPI.gardenSellCrop.mockResolvedValue({
      success: true,
      garden: createDefaultData(),
      message: '出售成功',
      unlockedAchievements: [{ name: '小富翁' }]
    })

    const updateTip = vi.fn()
    await window.GardenShop.sellCrop('carrot', updateTip)

    expect(updateTip).toHaveBeenCalledWith(expect.stringContaining('小富翁'))
  })
})

describe('GardenShop sellAllCrops', () => {
  it('一键出售应调用 gardenSellAll', async () => {
    const newData = createDefaultData()
    newData.crops = { carrot: 0, tomato: 0, sunflower: 0, rose: 0, osmanthus: 0 }
    newData.coins = 150
    window.electronAPI.gardenSellAll.mockResolvedValue({
      success: true,
      garden: newData,
      message: '全部出售成功',
      unlockedAchievements: []
    })

    const result = await window.GardenShop.sellAllCrops()

    expect(result.success).toBe(true)
    expect(window.Garden.updateData).toHaveBeenCalledWith(newData)
    expect(window.Garden.updateTip).toHaveBeenCalledWith('全部出售成功')
  })

  it('一键出售失败应显示错误', async () => {
    window.electronAPI.gardenSellAll.mockResolvedValue({
      success: false,
      message: '操作失败'
    })

    const result = await window.GardenShop.sellAllCrops()

    expect(result.success).toBe(false)
    expect(window.Garden.updateTip).toHaveBeenCalledWith('操作失败')
  })
})

describe('GardenShop 未覆盖分支补充', () => {
  it('点击 shopModal 背景应关闭商店', () => {
    const shopModal = document.getElementById('shopModal')
    shopModal.dispatchEvent(new Event('click', { bubbles: true }))

    const shopModalInstance = window.BaseModal.mock.results[0].value
    expect(shopModalInstance.hide).toHaveBeenCalled()
  })

  it('点击购买标签应激活购买面板', () => {
    const buyTab = document.querySelector('.shop-tab[data-tab="buy"]')
    buyTab.click()

    expect(buyTab.classList.contains('active')).toBe(true)
    expect(document.getElementById('buyPanel').classList.contains('active')).toBe(true)
  })

  it('点击出售标签应激活出售面板', () => {
    const sellTab = document.querySelector('.shop-tab[data-tab="sell"]')
    sellTab.click()

    expect(sellTab.classList.contains('active')).toBe(true)
    expect(document.getElementById('sellPanel').classList.contains('active')).toBe(true)
  })

  it('一键出售解锁成就应显示提示', async () => {
    window.electronAPI.gardenSellAll.mockResolvedValue({
      success: true,
      garden: createDefaultData(),
      message: '全部出售成功',
      unlockedAchievements: [{ name: '大富翁' }, { name: '商人' }]
    })

    await window.GardenShop.sellAllCrops()

    expect(window.Garden.updateTip).toHaveBeenCalledWith(expect.stringContaining('大富翁'))
    expect(window.Garden.updateTip).toHaveBeenCalledWith(expect.stringContaining('商人'))
  })

  it('出售失败应显示错误消息', async () => {
    window.electronAPI.gardenSellCrop.mockResolvedValue({
      success: false,
      message: '无作物可出售'
    })

    const updateTip = vi.fn()
    const result = await window.GardenShop.sellCrop('carrot', updateTip)

    expect(result.success).toBe(false)
    expect(updateTip).toHaveBeenCalledWith('无作物可出售')
  })

  it('openShop 应调用 shopModal.show', () => {
    const updateTip = vi.fn()
    window.GardenShop.openShop(createDefaultData(), updateTip)

    const shopModalInstance = window.BaseModal.mock.results[0].value
    expect(shopModalInstance.show).toHaveBeenCalled()
  })

  it('点击商店按钮应打开商店', () => {
    document.getElementById('shopBtn').click()

    const shopModalInstance = window.BaseModal.mock.results[0].value
    expect(shopModalInstance.show).toHaveBeenCalled()
  })

  it('点击关闭按钮应关闭商店', () => {
    document.getElementById('shopCloseBtn').click()

    const shopModalInstance = window.BaseModal.mock.results[0].value
    expect(shopModalInstance.hide).toHaveBeenCalled()
  })

  it('renderShopSell data 为 null 不应报错', () => {
    expect(() => window.GardenShop.renderShopSell(null, vi.fn())).not.toThrow()
  })
})
