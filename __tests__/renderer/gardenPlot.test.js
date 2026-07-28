/**
 * GardenPlot 模块测试
 *
 * 测试土地格子：渲染、种植、收获、解锁
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = `<div id="garden-grid"></div>`

  window.electronAPI = {
    gardenPlant: vi.fn(),
    gardenHarvest: vi.fn(),
    gardenUnlockPlot: vi.fn(),
    getTimerState: vi.fn().mockResolvedValue({ focusModeEnabled: false, timerRunning: false })
  }

  // 重置模块缓存，使 gardenPlot IIFE 重新执行并重置内部闭包状态
  vi.resetModules()
  delete require.cache[require.resolve('../../src/scripts/modules/utils')]
  delete require.cache[require.resolve('../../src/scripts/modules/gardenPlot')]
  require('../../src/scripts/modules/utils')
  require('../../src/scripts/modules/gardenPlot')
})

function createDefaultData() {
  return {
    coins: 100,
    seeds: { carrot: 5, tomato: 2, sunflower: 0, rose: 0, osmanthus: 0 },
    crops: {},
    plots: [
      { id: 0, crop: null, progress: 0, plantedAt: null },
      { id: 1, crop: null, progress: 0, plantedAt: null },
      { id: 2, crop: 'carrot', progress: 25, plantedAt: Date.now() },
      { id: 3, crop: 'carrot', progress: 10, plantedAt: Date.now() },
      { id: 6, crop: null, progress: 0, plantedAt: null, locked: true }
    ],
    achievements: {}
  }
}

describe('GardenPlot renderPlots', () => {
  it('应渲染所有格子', () => {
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, createDefaultData(), null, vi.fn(), vi.fn())

    expect(grid.children.length).toBe(5)
  })

  it('空格子应有 empty 类', () => {
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, createDefaultData(), null, vi.fn(), vi.fn())

    expect(grid.children[0].classList.contains('empty')).toBe(true)
  })

  it('有作物的格子应有 has-crop 类', () => {
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, createDefaultData(), null, vi.fn(), vi.fn())

    expect(grid.children[2].classList.contains('has-crop')).toBe(true)
  })

  it('成熟作物应有 mature 类', () => {
    const data = createDefaultData()
    data.plots[2].progress = 25 // carrot growTime=25, so 100%
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, data, null, vi.fn(), vi.fn())

    expect(grid.children[2].classList.contains('mature')).toBe(true)
  })

  it('未成熟作物不应有 mature 类', () => {
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, createDefaultData(), null, vi.fn(), vi.fn())

    expect(grid.children[3].classList.contains('mature')).toBe(false)
  })

  it('锁定格子应有 locked 类', () => {
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, createDefaultData(), null, vi.fn(), vi.fn())

    expect(grid.children[4].classList.contains('locked')).toBe(true)
  })

  it('锁定金币格子金币足够应显示解锁按钮', () => {
    const data = createDefaultData()
    // PLOT_UNLOCK_CONFIG[6] = { type: 'coins', price: 100 }，需要在 index 6 放置 locked plot
    data.plots = [
      { id: 0, crop: null, progress: 0, plantedAt: null },
      { id: 1, crop: null, progress: 0, plantedAt: null },
      { id: 2, crop: 'carrot', progress: 25, plantedAt: Date.now() },
      { id: 3, crop: 'carrot', progress: 10, plantedAt: Date.now() },
      { id: 4, crop: null, progress: 0, plantedAt: null },
      { id: 5, crop: null, progress: 0, plantedAt: null },
      { id: 6, crop: null, progress: 0, plantedAt: null, locked: true }
    ]
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, data, null, vi.fn(), vi.fn())

    const lockedPlot = grid.children[6]
    expect(lockedPlot.innerHTML).toContain('解锁')
  })

  it('锁定金币格子金币不足应显示金币不足', () => {
    const data = createDefaultData()
    data.coins = 0
    // PLOT_UNLOCK_CONFIG[6] = { type: 'coins', price: 100 }，需要在 index 6 放置 locked plot
    data.plots = [
      { id: 0, crop: null, progress: 0, plantedAt: null },
      { id: 1, crop: null, progress: 0, plantedAt: null },
      { id: 2, crop: 'carrot', progress: 25, plantedAt: Date.now() },
      { id: 3, crop: 'carrot', progress: 10, plantedAt: Date.now() },
      { id: 4, crop: null, progress: 0, plantedAt: null },
      { id: 5, crop: null, progress: 0, plantedAt: null },
      { id: 6, crop: null, progress: 0, plantedAt: null, locked: true }
    ]
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, data, null, vi.fn(), vi.fn())

    const lockedPlot = grid.children[6]
    expect(lockedPlot.innerHTML).toContain('金币不足')
  })

  it('selectedPlotIndex 应添加 selected 类', () => {
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, createDefaultData(), 0, vi.fn(), vi.fn())

    expect(grid.children[0].classList.contains('selected')).toBe(true)
  })

  it('点击非锁定格子应触发 onPlotClick', () => {
    const onPlotClick = vi.fn()
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, createDefaultData(), null, onPlotClick, vi.fn())

    grid.children[0].click()

    expect(onPlotClick).toHaveBeenCalledWith(0, expect.any(MouseEvent))
  })

  it('gridEl 为 null 不应报错', () => {
    expect(() => window.GardenPlot.renderPlots(null, createDefaultData(), null, vi.fn(), vi.fn())).not.toThrow()
  })

  it('data 为 null 不应报错', () => {
    const grid = document.getElementById('garden-grid')
    expect(() => window.GardenPlot.renderPlots(grid, null, null, vi.fn(), vi.fn())).not.toThrow()
  })
})

describe('GardenPlot plantCrop', () => {
  it('种植成功应调用 onSuccess', async () => {
    const newData = createDefaultData()
    newData.seeds.carrot = 4
    window.electronAPI.gardenPlant.mockResolvedValue({
      success: true,
      garden: newData,
      unlockedAchievements: []
    })

    const onSuccess = vi.fn()
    const updateTip = vi.fn()
    const result = await window.GardenPlot.plantCrop(0, 'carrot', onSuccess, updateTip)

    expect(result.success).toBe(true)
    expect(onSuccess).toHaveBeenCalledWith(newData)
    expect(updateTip).toHaveBeenCalledWith(expect.stringContaining('种植成功'))
  })

  it('种植成功种子用完应返回 clearSeed', async () => {
    const newData = createDefaultData()
    newData.seeds.carrot = 0
    window.electronAPI.gardenPlant.mockResolvedValue({
      success: true,
      garden: newData,
      unlockedAchievements: []
    })

    const result = await window.GardenPlot.plantCrop(0, 'carrot', vi.fn(), vi.fn())

    expect(result.success).toBe(true)
    expect(result.clearSeed).toBe(true)
  })

  it('种植失败应显示错误消息', async () => {
    window.electronAPI.gardenPlant.mockResolvedValue({
      success: false,
      message: '格子已被占用'
    })

    const updateTip = vi.fn()
    const result = await window.GardenPlot.plantCrop(0, 'carrot', vi.fn(), updateTip)

    expect(result.success).toBe(false)
    expect(updateTip).toHaveBeenCalledWith('格子已被占用')
  })

  it('专注模式下应阻止种植', async () => {
    window.electronAPI.getTimerState.mockResolvedValue({
      focusModeEnabled: true,
      timerRunning: true
    })

    const updateTip = vi.fn()
    const result = await window.GardenPlot.plantCrop(0, 'carrot', vi.fn(), updateTip)

    expect(result.success).toBe(false)
    expect(updateTip).toHaveBeenCalledWith('专注模式下无法种植作物，请先停止专注')
  })

  it('种植成功解锁成就应显示提示', async () => {
    const newData = createDefaultData()
    window.electronAPI.gardenPlant.mockResolvedValue({
      success: true,
      garden: newData,
      unlockedAchievements: [{ name: '新手农夫' }]
    })

    const updateTip = vi.fn()
    await window.GardenPlot.plantCrop(0, 'carrot', vi.fn(), updateTip)

    expect(updateTip).toHaveBeenCalledWith(expect.stringContaining('新手农夫'))
  })
})

describe('GardenPlot harvestCrop', () => {
  it('收获成功应调用 onSuccess', async () => {
    const newData = createDefaultData()
    newData.plots[2].crop = null
    window.electronAPI.gardenHarvest.mockResolvedValue({
      success: true,
      garden: newData,
      message: '收获成功'
    })

    const onSuccess = vi.fn()
    const updateTip = vi.fn()
    const result = await window.GardenPlot.harvestCrop(2, onSuccess, updateTip)

    expect(result.success).toBe(true)
    expect(onSuccess).toHaveBeenCalledWith(newData)
    expect(updateTip).toHaveBeenCalledWith('收获成功')
  })

  it('收获失败应显示错误消息', async () => {
    window.electronAPI.gardenHarvest.mockResolvedValue({
      success: false,
      message: '作物未成熟'
    })

    const updateTip = vi.fn()
    const result = await window.GardenPlot.harvestCrop(2, vi.fn(), updateTip)

    expect(result.success).toBe(false)
    expect(updateTip).toHaveBeenCalledWith('作物未成熟')
  })

  it('收获成功解锁成就应显示提示', async () => {
    window.electronAPI.gardenHarvest.mockResolvedValue({
      success: true,
      garden: createDefaultData(),
      message: '收获成功',
      unlockedAchievements: [{ name: '初次丰收' }]
    })

    const updateTip = vi.fn()
    await window.GardenPlot.harvestCrop(2, vi.fn(), updateTip)

    expect(updateTip).toHaveBeenCalledWith(expect.stringContaining('初次丰收'))
  })
})

describe('GardenPlot unlockPlot', () => {
  it('解锁成功应调用 onSuccess', async () => {
    const newData = createDefaultData()
    newData.plots[4].locked = false
    window.electronAPI.gardenUnlockPlot.mockResolvedValue({
      success: true,
      garden: newData,
      message: '解锁成功'
    })

    const onSuccess = vi.fn()
    const updateTip = vi.fn()
    const result = await window.GardenPlot.unlockPlot(6, onSuccess, updateTip)

    expect(result.success).toBe(true)
    expect(onSuccess).toHaveBeenCalledWith(newData)
  })

  it('解锁失败应显示错误消息', async () => {
    window.electronAPI.gardenUnlockPlot.mockResolvedValue({
      success: false,
      message: '金币不足'
    })

    const updateTip = vi.fn()
    const result = await window.GardenPlot.unlockPlot(6, vi.fn(), updateTip)

    expect(result.success).toBe(false)
    expect(updateTip).toHaveBeenCalledWith('金币不足')
  })
})

describe('GardenPlot CROP_CONFIG', () => {
  it('应暴露 CROP_CONFIG', () => {
    expect(window.GardenPlot.CROP_CONFIG).toBeDefined()
    expect(window.GardenPlot.CROP_CONFIG.carrot).toBeDefined()
    expect(window.GardenPlot.CROP_CONFIG.carrot.name).toBe('胡萝卜')
  })
})

describe('GardenPlot handlePlotClick', () => {
  it('成熟作物应调用 onHarvest', () => {
    const plot = { crop: 'carrot', progress: 25 } // carrot growTime=25, 100%
    const onHarvest = vi.fn()
    const onPlant = vi.fn()
    const updateTip = vi.fn()

    window.GardenPlot.handlePlotClick(0, plot, null, onHarvest, onPlant, updateTip)

    expect(onHarvest).toHaveBeenCalledWith(0)
    expect(onPlant).not.toHaveBeenCalled()
  })

  it('未成熟作物应显示提示', () => {
    const plot = { crop: 'carrot', progress: 10 } // 10/25 = 40%
    const onHarvest = vi.fn()
    const onPlant = vi.fn()
    const updateTip = vi.fn()

    window.GardenPlot.handlePlotClick(0, plot, null, onHarvest, onPlant, updateTip)

    expect(updateTip).toHaveBeenCalledWith('作物还未成熟，无法收获')
    expect(onHarvest).not.toHaveBeenCalled()
  })

  it('空格子有选中种子应调用 onPlant', () => {
    const plot = { crop: null, progress: 0 }
    const onHarvest = vi.fn()
    const onPlant = vi.fn()
    const updateTip = vi.fn()

    window.GardenPlot.handlePlotClick(0, plot, 'tomato', onHarvest, onPlant, updateTip)

    expect(onPlant).toHaveBeenCalledWith(0, 'tomato')
  })

  it('空格子无选中种子应显示提示', () => {
    const plot = { crop: null, progress: 0 }
    const onHarvest = vi.fn()
    const onPlant = vi.fn()
    const updateTip = vi.fn()

    window.GardenPlot.handlePlotClick(0, plot, null, onHarvest, onPlant, updateTip)

    expect(updateTip).toHaveBeenCalledWith('请先选择一个种子')
    expect(onPlant).not.toHaveBeenCalled()
  })
})

describe('GardenPlot renderLockedPlot 成就类型', () => {
  it('成就未达成应显示未达成', () => {
    const data = createDefaultData()
    // Need 8 unlocked plots (indices 0-7) then locked at index 8
    data.plots = []
    for (let i = 0; i < 8; i++) {
      data.plots.push({ id: i, crop: null, progress: 0, plantedAt: null })
    }
    // index 8 is achievement type in PLOT_UNLOCK_CONFIG
    data.plots.push({ id: 8, crop: null, progress: 0, plantedAt: null, locked: true })
    data.achievements = {}

    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, data, null, vi.fn(), vi.fn())

    const lockedPlot = grid.children[8]
    expect(lockedPlot.innerHTML).toContain('未达成')
    expect(lockedPlot.classList.contains('locked-achievement')).toBe(true)
    expect(lockedPlot.classList.contains('can-unlock')).toBe(false)
  })

  it('成就已达成应显示解锁按钮', () => {
    const data = createDefaultData()
    data.plots = []
    for (let i = 0; i < 8; i++) {
      data.plots.push({ id: i, crop: null, progress: 0, plantedAt: null })
    }
    data.plots.push({ id: 8, crop: null, progress: 0, plantedAt: null, locked: true })
    data.achievements = { signin100: { unlocked: true } }

    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, data, null, vi.fn(), vi.fn())

    const lockedPlot = grid.children[8]
    expect(lockedPlot.innerHTML).toContain('解锁')
    expect(lockedPlot.classList.contains('can-unlock')).toBe(true)
  })

  it('成就已达成点击解锁按钮应调用 onUnlock', () => {
    const data = createDefaultData()
    data.plots = []
    for (let i = 0; i < 8; i++) {
      data.plots.push({ id: i, crop: null, progress: 0, plantedAt: null })
    }
    data.plots.push({ id: 8, crop: null, progress: 0, plantedAt: null, locked: true })
    data.achievements = { signin100: { unlocked: true } }

    const onUnlock = vi.fn()
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, data, null, vi.fn(), onUnlock)

    const unlockBtn = grid.children[8].querySelector('.unlock-btn')
    unlockBtn.click()

    expect(onUnlock).toHaveBeenCalledWith(8)
  })

  it('金币足够点击解锁按钮应调用 onUnlock', () => {
    const data = createDefaultData()
    // Need 6 unlocked plots (indices 0-5) then locked at index 6
    data.plots = []
    for (let i = 0; i < 6; i++) {
      data.plots.push({ id: i, crop: null, progress: 0, plantedAt: null })
    }
    data.plots.push({ id: 6, crop: null, progress: 0, plantedAt: null, locked: true })

    const onUnlock = vi.fn()
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, data, null, vi.fn(), onUnlock)

    const unlockBtn = grid.children[6].querySelector('.unlock-btn')
    unlockBtn.click()

    expect(onUnlock).toHaveBeenCalledWith(6)
  })
})

describe('GardenPlot renderCropPlot 边界', () => {
  it('未知作物不应渲染内容', () => {
    const data = createDefaultData()
    data.plots[0] = { id: 0, crop: 'unknown_crop', progress: 10, plantedAt: Date.now() }

    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, data, null, vi.fn(), vi.fn())

    expect(grid.children[0].classList.contains('has-crop')).toBe(false)
  })
})

describe('GardenPlot renderLockedPlot 边界', () => {
  it('未知解锁配置不应渲染内容', () => {
    const data = createDefaultData()
    // Use an index beyond PLOT_UNLOCK_CONFIG range (max is 11)
    data.plots = []
    for (let i = 0; i < 15; i++) {
      data.plots.push({ id: i, crop: null, progress: 0, plantedAt: null })
    }
    data.plots[14] = { id: 14, crop: null, progress: 0, plantedAt: null, locked: true }

    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, data, null, vi.fn(), vi.fn())

    // Should not have locked class since unlockConfig is undefined
    expect(grid.children[14].classList.contains('locked')).toBe(false)
  })
})

describe('GardenPlot plantCrop 错误处理', () => {
  it('getTimerState 抛错应继续种植', async () => {
    window.electronAPI.getTimerState.mockRejectedValue(new Error('timer error'))
    window.electronAPI.gardenPlant.mockResolvedValue({
      success: true,
      garden: createDefaultData(),
      unlockedAchievements: []
    })

    const updateTip = vi.fn()
    const result = await window.GardenPlot.plantCrop(0, 'carrot', vi.fn(), updateTip)

    expect(result.success).toBe(true)
    expect(window.electronAPI.gardenPlant).toHaveBeenCalled()
  })
})

describe('GardenPlot renderPlots 点击锁定格子', () => {
  it('点击锁定格子不应触发 onPlotClick', () => {
    const data = createDefaultData()
    data.plots = []
    for (let i = 0; i < 7; i++) {
      data.plots.push({ id: i, crop: null, progress: 0, plantedAt: null })
    }
    data.plots[6] = { id: 6, crop: null, progress: 0, plantedAt: null, locked: true }

    const onPlotClick = vi.fn()
    const grid = document.getElementById('garden-grid')
    window.GardenPlot.renderPlots(grid, data, null, onPlotClick, vi.fn())

    grid.children[6].click()

    expect(onPlotClick).not.toHaveBeenCalled()
  })
})
