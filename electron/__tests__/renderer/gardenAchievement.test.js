/**
 * GardenAchievement 模块测试
 *
 * 测试成就墙：初始化、打开/关闭、渲染成就列表、更新成就统计
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  require('../../src/scripts/modules/utils')
  require('../../src/scripts/modules/gardenAchievement')
})

beforeEach(() => {
  document.body.innerHTML = `
    <div id="achievementModal">
      <button id="achievementCloseBtn">关闭</button>
      <span id="achievementUnlocked">0</span>
      <span id="achievementTotal">0</span>
      <div id="achievementTabs">
        <div class="achievement-tab active" data-category="all">全部</div>
        <div class="achievement-tab" data-category="focus">专注</div>
        <div class="achievement-tab" data-category="harvest">收获</div>
        <div class="achievement-tab" data-category="plant">种植</div>
        <div class="achievement-tab" data-category="collect">收集</div>
        <div class="achievement-tab" data-category="wealth">财富</div>
        <div class="achievement-tab" data-category="persist">坚持</div>
        <div class="achievement-tab" data-category="hidden">隐藏</div>
      </div>
      <div id="achievementList"></div>
    </div>
    <button id="achievementBtn">成就墙</button>
  `

  window.BaseModal = vi.fn().mockImplementation(function({ element, onShow, onHide, onBackgroundClick, showClass, expandSidebarOnShow } = {}) {
    return {
      element,
      showClass,
      show: vi.fn(() => onShow && onShow()),
      hide: vi.fn(() => onHide && onHide()),
      toggle: vi.fn()
    }
  })

  window.electronAPI = {
    gardenUpdateFocus: vi.fn()
  }

  window.Garden = {
    updateData: vi.fn()
  }

  window.GardenAchievement.init({
    achievementBtn: document.getElementById('achievementBtn'),
    achievementModal: document.getElementById('achievementModal'),
    achievementCloseBtn: document.getElementById('achievementCloseBtn'),
    achievementUnlocked: document.getElementById('achievementUnlocked'),
    achievementTotal: document.getElementById('achievementTotal'),
    achievementTabs: document.getElementById('achievementTabs'),
    achievementList: document.getElementById('achievementList')
  })
})

function createDefaultData(overrides = {}) {
  return Object.assign({
    coins: 100,
    seeds: { carrot: 5, tomato: 2, sunflower: 0, rose: 0, osmanthus: 0 },
    crops: { carrot: 3, tomato: 1, sunflower: 0, rose: 0, osmanthus: 0 },
    plots: [],
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

describe('GardenAchievement init', () => {
  it('init 应创建 BaseModal 实例并绑定事件', () => {
    expect(window.BaseModal).toHaveBeenCalled()
  })

  it('点击成就墙按钮应打开弹窗', () => {
    const btn = document.getElementById('achievementBtn')
    btn.click()
    // BaseModal.show 应该被调用
    const modalInstance = window.BaseModal.mock.results[0].value
    expect(modalInstance.show).toHaveBeenCalled()
  })

  it('点击关闭按钮应关闭弹窗', () => {
    const closeBtn = document.getElementById('achievementCloseBtn')
    closeBtn.click()
    const modalInstance = window.BaseModal.mock.results[0].value
    expect(modalInstance.hide).toHaveBeenCalled()
  })

  it('点击弹窗背景应关闭弹窗', () => {
    const modal = document.getElementById('achievementModal')
    // 模拟点击背景（e.target === modal）
    const event = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(event, 'target', { value: modal })
    modal.dispatchEvent(event)
    const modalInstance = window.BaseModal.mock.results[0].value
    expect(modalInstance.hide).toHaveBeenCalled()
  })
})

describe('GardenAchievement openAchievementModal', () => {
  it('打开弹窗应渲染成就模态框', async () => {
    const data = createDefaultData()
    await window.GardenAchievement.openAchievementModal(data)

    // 应更新已解锁数量和总数
    expect(document.getElementById('achievementUnlocked').textContent).toBe('0')
    expect(document.getElementById('achievementTotal').textContent).toBe(String(Object.keys(window.Utils.ACHIEVEMENT_CONFIG).length))
  })

  it('打开弹窗时有已解锁成就应正确计数', async () => {
    const data = createDefaultData({
      achievements: {
        focus1h: { unlocked: true, unlockedAt: '2024-01-01' },
        harvest1: { unlocked: true, unlockedAt: '2024-01-02' }
      }
    })
    await window.GardenAchievement.openAchievementModal(data)

    expect(document.getElementById('achievementUnlocked').textContent).toBe('2')
  })
})

describe('GardenAchievement renderAchievementList', () => {
  it('渲染全部成就应包含所有成就项', async () => {
    const data = createDefaultData()
    await window.GardenAchievement.openAchievementModal(data)

    const items = document.querySelectorAll('#achievementList .achievement-item')
    expect(items.length).toBe(Object.keys(window.Utils.ACHIEVEMENT_CONFIG).length)
  })

  it('按 focus 类别筛选应只显示专注成就', async () => {
    const data = createDefaultData()
    await window.GardenAchievement.openAchievementModal(data)

    window.GardenAchievement.renderAchievementList('focus')

    const items = document.querySelectorAll('#achievementList .achievement-item')
    const focusCount = Object.values(window.Utils.ACHIEVEMENT_CONFIG).filter(a => a.category === 'focus').length
    expect(items.length).toBe(focusCount)
  })

  it('按 harvest 类别筛选应只显示收获成就', async () => {
    const data = createDefaultData()
    await window.GardenAchievement.openAchievementModal(data)

    window.GardenAchievement.renderAchievementList('harvest')

    const items = document.querySelectorAll('#achievementList .achievement-item')
    const harvestCount = Object.values(window.Utils.ACHIEVEMENT_CONFIG).filter(a => a.category === 'harvest').length
    expect(items.length).toBe(harvestCount)
  })

  it('已解锁的成就应显示 unlocked 类和徽章', async () => {
    const data = createDefaultData({
      achievements: {
        focus1h: { unlocked: true, unlockedAt: '2024-01-01' }
      }
    })
    await window.GardenAchievement.openAchievementModal(data)

    const items = document.querySelectorAll('#achievementList .achievement-item.unlocked')
    expect(items.length).toBe(1)
    const badge = document.querySelector('.achievement-badge')
    expect(badge).not.toBeNull()
  })

  it('点击 tab 应切换类别', async () => {
    const data = createDefaultData()
    await window.GardenAchievement.openAchievementModal(data)

    const tabs = document.querySelectorAll('.achievement-tab')
    const focusTab = Array.from(tabs).find(t => t.dataset.category === 'focus')
    focusTab.click()

    const items = document.querySelectorAll('#achievementList .achievement-item')
    const focusCount = Object.values(window.Utils.ACHIEVEMENT_CONFIG).filter(a => a.category === 'focus').length
    expect(items.length).toBe(focusCount)
    expect(focusTab.classList.contains('active')).toBe(true)
  })

  it('未解锁成就应显示进度条和进度文字', async () => {
    const data = createDefaultData({
      achievementStats: {
        totalFocusMinutes: 30,
        totalHarvestCount: 0,
        totalPlantCount: 0,
        cropTypesCollected: [],
        totalCoinsEarned: 0
      }
    })
    await window.GardenAchievement.openAchievementModal(data)

    const firstItem = document.querySelector('#achievementList .achievement-item')
    const progressText = firstItem.querySelector('.achievement-progress-text')
    expect(progressText).not.toBeNull()
    expect(progressText.textContent).toContain('30/60')
  })
})

describe('GardenAchievement updateAchievementStats', () => {
  it('type=focus 应调用 gardenUpdateFocus 并返回结果', async () => {
    const updateTip = vi.fn()
    const mockResult = {
      garden: createDefaultData(),
      unlockedAchievements: []
    }
    window.electronAPI.gardenUpdateFocus.mockResolvedValue(mockResult)

    const result = await window.GardenAchievement.updateAchievementStats('focus', 60, updateTip)

    expect(window.electronAPI.gardenUpdateFocus).toHaveBeenCalledWith(60)
    expect(result).toBe(mockResult)
  })

  it('解锁新成就应调用 updateTip 提示', async () => {
    const updateTip = vi.fn()
    const mockResult = {
      garden: createDefaultData(),
      unlockedAchievements: [{ id: 'focus1h', name: '初心者' }]
    }
    window.electronAPI.gardenUpdateFocus.mockResolvedValue(mockResult)

    await window.GardenAchievement.updateAchievementStats('focus', 60, updateTip)

    expect(window.Garden.updateData).toHaveBeenCalledWith(mockResult.garden)
    expect(updateTip).toHaveBeenCalledWith(expect.stringContaining('初心者'))
  })

  it('无新成就时不调用 updateTip', async () => {
    const updateTip = vi.fn()
    window.electronAPI.gardenUpdateFocus.mockResolvedValue({
      garden: createDefaultData(),
      unlockedAchievements: []
    })

    await window.GardenAchievement.updateAchievementStats('focus', 60, updateTip)

    expect(updateTip).not.toHaveBeenCalled()
  })

  it('非 focus 类型应返回 undefined', async () => {
    const result = await window.GardenAchievement.updateAchievementStats('harvest', 1, vi.fn())
    expect(result).toBeUndefined()
  })
})

describe('GardenAchievement closeAchievementModal', () => {
  it('closeAchievementModal 应调用 modal.hide', () => {
    window.GardenAchievement.closeAchievementModal()
    const modalInstance = window.BaseModal.mock.results[0].value
    expect(modalInstance.hide).toHaveBeenCalled()
  })
})
