/**
 * GardenBag 模块测试
 *
 * 测试背包：展开/收起、种子和作物列表渲染、种子选择
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/utils')
  require('../../src/scripts/modules/gardenBag')
})

beforeEach(() => {
  document.body.innerHTML = `
    <div id="seedList"></div>
    <div id="cropList"></div>
    <button id="seed-expand-btn"></button>
    <button id="crop-expand-btn"></button>
    <div id="garden-seed-bag"></div>
    <div id="garden-crop-bag"></div>
  `
})

function createDefaultData() {
  return {
    seeds: { carrot: 5, tomato: 2, sunflower: 0, rose: 0, osmanthus: 0 },
    crops: { carrot: 3, tomato: 1, sunflower: 0, rose: 0, osmanthus: 0 }
  }
}

describe('GardenBag initBagEvents', () => {
  it('initBagEvents 不应报错', () => {
    expect(() => window.GardenBag.initBagEvents()).not.toThrow()
  })
})

describe('GardenBag toggleSeedBag', () => {
  it('展开种子背包应添加 expanded 类', () => {
    window.GardenBag.initBagEvents()
    window.GardenBag.toggleSeedBag()

    expect(document.getElementById('garden-seed-bag').classList.contains('expanded')).toBe(true)
    expect(document.getElementById('seed-expand-btn').classList.contains('active')).toBe(true)
  })

  it('再次点击应收起种子背包', () => {
    window.GardenBag.initBagEvents()
    window.GardenBag.toggleSeedBag()
    window.GardenBag.toggleSeedBag()

    expect(document.getElementById('garden-seed-bag').classList.contains('expanded')).toBe(false)
  })

  it('展开种子背包应收起作物背包', () => {
    window.GardenBag.initBagEvents()
    window.GardenBag.toggleCropBag()
    window.GardenBag.toggleSeedBag()

    expect(document.getElementById('garden-crop-bag').classList.contains('expanded')).toBe(false)
    expect(document.getElementById('garden-seed-bag').classList.contains('expanded')).toBe(true)
  })
})

describe('GardenBag toggleCropBag', () => {
  it('展开作物背包应添加 expanded 类', () => {
    window.GardenBag.initBagEvents()
    window.GardenBag.toggleCropBag()

    expect(document.getElementById('garden-crop-bag').classList.contains('expanded')).toBe(true)
    expect(document.getElementById('crop-expand-btn').classList.contains('active')).toBe(true)
  })

  it('再次点击应收起作物背包', () => {
    window.GardenBag.initBagEvents()
    window.GardenBag.toggleCropBag()
    window.GardenBag.toggleCropBag()

    expect(document.getElementById('garden-crop-bag').classList.contains('expanded')).toBe(false)
  })

  it('展开作物背包应收起种子背包', () => {
    window.GardenBag.initBagEvents()
    window.GardenBag.toggleSeedBag()
    window.GardenBag.toggleCropBag()

    expect(document.getElementById('garden-seed-bag').classList.contains('expanded')).toBe(false)
    expect(document.getElementById('garden-crop-bag').classList.contains('expanded')).toBe(true)
  })
})

describe('GardenBag renderSeeds', () => {
  it('应渲染所有种子项', () => {
    const list = document.getElementById('seedList')
    window.GardenBag.renderSeeds(list, createDefaultData(), null, vi.fn())

    expect(list.children.length).toBe(5) // 5 种作物
  })

  it('数量为 0 的种子应有 disabled 类', () => {
    const list = document.getElementById('seedList')
    window.GardenBag.renderSeeds(list, createDefaultData(), null, vi.fn())

    // sunflower 是第 3 个，数量为 0
    expect(list.children[2].classList.contains('disabled')).toBe(true)
  })

  it('选中的种子应有 selected 类', () => {
    const list = document.getElementById('seedList')
    window.GardenBag.renderSeeds(list, createDefaultData(), 'carrot', vi.fn())

    expect(list.children[0].classList.contains('selected')).toBe(true)
  })

  it('点击有数量的种子应触发 onSeedSelect', () => {
    const onSeedSelect = vi.fn()
    const list = document.getElementById('seedList')
    window.GardenBag.renderSeeds(list, createDefaultData(), null, onSeedSelect)

    list.children[0].click()

    expect(onSeedSelect).toHaveBeenCalledWith('carrot')
  })

  it('点击数量为 0 的种子不应触发 onSeedSelect', () => {
    const onSeedSelect = vi.fn()
    const list = document.getElementById('seedList')
    window.GardenBag.renderSeeds(list, createDefaultData(), null, onSeedSelect)

    list.children[2].click() // sunflower, count=0

    expect(onSeedSelect).not.toHaveBeenCalled()
  })

  it('listEl 为 null 不应报错', () => {
    expect(() => window.GardenBag.renderSeeds(null, createDefaultData(), null, vi.fn())).not.toThrow()
  })

  it('data 为 null 不应报错', () => {
    expect(() => window.GardenBag.renderSeeds(document.getElementById('seedList'), null, null, vi.fn())).not.toThrow()
  })
})

describe('GardenBag renderCrops', () => {
  it('应渲染有数量的作物', () => {
    const list = document.getElementById('cropList')
    window.GardenBag.renderCrops(list, createDefaultData())

    // carrot: 3, tomato: 1, others: 0 -> 2 items
    expect(list.children.length).toBe(2)
  })

  it('无作物应显示空提示', () => {
    const list = document.getElementById('cropList')
    window.GardenBag.renderCrops(list, { crops: {} })

    expect(list.innerHTML).toContain('暂无收获的作物')
  })

  it('listEl 为 null 不应报错', () => {
    expect(() => window.GardenBag.renderCrops(null, createDefaultData())).not.toThrow()
  })
})

describe('GardenBag handleSeedSelect', () => {
  it('选择不同种子应返回新 cropKey', () => {
    const updateTip = vi.fn()
    const result = window.GardenBag.handleSeedSelect('tomato', 'carrot', updateTip)

    expect(result).toBe('tomato')
    expect(updateTip).toHaveBeenCalledWith(expect.stringContaining('番茄'))
  })

  it('选择相同种子应返回 null', () => {
    const updateTip = vi.fn()
    const result = window.GardenBag.handleSeedSelect('carrot', 'carrot', updateTip)

    expect(result).toBeNull()
    expect(updateTip).toHaveBeenCalled()
  })
})

describe('GardenBag getBagState', () => {
  it('初始状态应都为 false', () => {
    window.GardenBag.initBagEvents()
    const state = window.GardenBag.getBagState()

    expect(state.seedBagExpanded).toBe(false)
    expect(state.cropBagExpanded).toBe(false)
  })

  it('展开种子背包后状态应更新', () => {
    window.GardenBag.initBagEvents()
    window.GardenBag.toggleSeedBag()
    const state = window.GardenBag.getBagState()

    expect(state.seedBagExpanded).toBe(true)
  })
})
