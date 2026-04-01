/**
 * 数据存储模块 - 管理应用数据的读写
 * 所有数据存储在一个 JSON 文件中
 */
;(function() {
  'use strict'

  let cachedData = null
  let saveTimeout = null

  // 使用统一的默认数据结构
  const defaultData = Utils.createDefaultData()

  /**
   * 从文件重新加载数据并合并到缓存
   * 这确保在保存前获取其他模块（如菜园子）的最新修改
   */
  async function syncFromFile() {
    try {
      const fileData = await window.electronAPI.readData()
      if (fileData && cachedData) {
        // 合并文件中的最新数据到缓存
        // 保留 cachedData 中刚修改的字段，但更新其他字段
        if (fileData.garden) {
          cachedData.garden = fileData.garden
        }
        if (fileData.stats && !cachedData._statsModified) {
          cachedData.stats = fileData.stats
        }
        if (fileData.presets && !cachedData._presetsModified) {
          cachedData.presets = fileData.presets
        }
        if (fileData.planList && !cachedData._planListModified) {
          cachedData.planList = fileData.planList
        }
      }
    } catch (e) {
      console.error('同步文件数据失败:', e)
    }
  }

  // 加载数据
  async function load() {
    try {
      const data = await window.electronAPI.readData()
      cachedData = data || defaultData
      
      // 检查日期，如果不是今天则重置今日计数
      const today = new Date().toDateString()
      if (cachedData.stats.date !== today) {
        cachedData.stats.date = today
        cachedData.stats.todayCount = 0
        // 立即保存
        await save()
      }
      
      return cachedData
    } catch (e) {
      console.error('加载数据失败:', e)
      cachedData = defaultData
      return cachedData
    }
  }

  // 保存数据（防抖）
  async function save() {
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
    
    return new Promise((resolve) => {
      saveTimeout = setTimeout(async () => {
        try {
          await window.electronAPI.writeData(cachedData)
          resolve(true)
        } catch (e) {
          console.error('保存数据失败:', e)
          resolve(false)
        }
      }, 300)
    })
  }

  // 立即保存（无防抖）
  // 在保存前会先从文件同步最新数据，避免覆盖其他模块的修改
  async function saveImmediate() {
    try {
      // 先从文件同步最新数据（特别是菜园子数据）
      await syncFromFile()
      await window.electronAPI.writeData(cachedData)
      return true
    } catch (e) {
      console.error('保存数据失败:', e)
      return false
    }
  }

  // 获取统计数据
  function getStats() {
    return cachedData ? cachedData.stats : defaultData.stats
  }

  // 更新统计数据
  async function updateStats(stats) {
    if (!cachedData) return false
    cachedData._statsModified = true
    cachedData.stats = { ...cachedData.stats, ...stats }
    const result = await saveImmediate()
    delete cachedData._statsModified
    return result
  }

  // 获取预设数据
  function getPresets() {
    return cachedData ? cachedData.presets : defaultData.presets
  }

  // 更新预设数据
  async function updatePresets(presets) {
    if (!cachedData) return false
    cachedData._presetsModified = true
    cachedData.presets = { ...cachedData.presets, ...presets }
    const result = await saveImmediate()
    delete cachedData._presetsModified
    return result
  }

  // 获取全部数据
  function getData() {
    return cachedData || defaultData
  }

  // 获取计划列表
  function getPlanList() {
    return cachedData ? (cachedData.planList || []) : []
  }

  // 更新计划列表
  async function updatePlanList(planList) {
    if (!cachedData) return false
    cachedData._planListModified = true
    cachedData.planList = planList
    const result = await saveImmediate()
    delete cachedData._planListModified
    return result
  }

  // 获取菜园数据
  function getGarden() {
    return cachedData ? cachedData.garden : Utils.createDefaultData().garden
  }

  // 更新菜园数据
  async function updateGarden(garden) {
    if (!cachedData) return false
    cachedData.garden = { ...cachedData.garden, ...garden }
    return await saveImmediate()
  }

  // 导出到全局
  window.DataStore = {
    load: load,
    save: save,
    saveImmediate: saveImmediate,
    getStats: getStats,
    updateStats: updateStats,
    getPresets: getPresets,
    updatePresets: updatePresets,
    getData: getData,
    getPlanList: getPlanList,
    updatePlanList: updatePlanList,
    getGarden: getGarden,
    updateGarden: updateGarden,
    getTheme: () => cachedData ? (cachedData.theme || 'light') : 'light',
    updateTheme: (theme) => {
      if (!cachedData) return false;
      cachedData.theme = theme;
      return saveImmediate();
}
  }
})()
