/**
 * 统计模块 - 使用 JSON 文件存储
 */
;(function() {
  'use strict'

  let elements = {}

  function updateDisplay() {
    const stats = DataStore.getStats()
    
    if (elements.todayCount) {
      elements.todayCount.textContent = stats.todayCount || 0
    }
    if (elements.totalMinutes) {
      elements.totalMinutes.textContent = stats.totalMinutes || 0
    }
  }

  async function increment(minutes, note = '') {
    const stats = DataStore.getStats()
    const data = DataStore.getData()
    
    // 更新统计
    const newStats = {
      date: new Date().toDateString(),
      todayCount: (stats.todayCount || 0) + 1,
      totalMinutes: (stats.totalMinutes || 0) + minutes
    }
    
    await DataStore.updateStats(newStats)
    
    // 记录到历史数据（每次完成番茄钟都添加一条新记录）
    const today = new Date().toISOString().split('T')[0]
    const now = new Date().toISOString()
    
    if (!data.statisticsHistory) {
      data.statisticsHistory = []
    }
    
    // 添加新记录（不再累加，每次都是独立记录）
    data.statisticsHistory.push({
      date: today,
      timestamp: now,
      minutes: minutes,
      note: note || '无备注'
    })
    
    // 保存历史数据
    await window.electronAPI.writeData(data)
    
    // 更新成就进度（专注时长）
    if (window.Garden && window.Garden.updateAchievementStats) {
      await window.Garden.updateAchievementStats('focus', minutes)
    }
    
    updateDisplay()
  }

  /**
   * 记录部分完成的专注时间（当用户重置计时器时）
   * @param {number} seconds 已流逝的秒数
   * @param {string} note 备注
   */
  async function recordPartialFocus(seconds, note = '') {
    if (seconds <= 0) return
    
    const minutes = Math.floor(seconds / 60)
    if (minutes <= 0) return
    
    const stats = DataStore.getStats()
    const data = DataStore.getData()
    
    // 更新统计
    const newStats = {
      date: new Date().toDateString(),
      todayCount: (stats.todayCount || 0) + 1,
      totalMinutes: (stats.totalMinutes || 0) + minutes
    }
    
    await DataStore.updateStats(newStats)
    
    // 记录到历史数据
    const today = new Date().toISOString().split('T')[0]
    const now = new Date().toISOString()
    
    if (!data.statisticsHistory) {
      data.statisticsHistory = []
    }
    
    // 添加部分完成记录
    data.statisticsHistory.push({
      date: today,
      timestamp: now,
      minutes: minutes,
      note: note || '部分完成',
      partial: true, // 标记为部分完成
      originalSeconds: seconds
    })
    
    // 保存历史数据
    await window.electronAPI.writeData(data)
    
    // 更新成就进度（专注时长）
    if (window.Garden && window.Garden.updateAchievementStats) {
      await window.Garden.updateAchievementStats('focus', minutes)
    }
    
    updateDisplay()
  }

  function getTodayCount() {
    const stats = DataStore.getStats()
    return stats.todayCount || 0
  }

  function getTotalMinutes() {
    const stats = DataStore.getStats()
    return stats.totalMinutes || 0
  }

  function init(els) {
    elements = els
    updateDisplay()
  }

  // 导出到全局
  window.Stats = {
    init: init,
    updateDisplay: updateDisplay,
    increment: increment,
    recordPartialFocus: recordPartialFocus,
    getTodayCount: getTodayCount,
    getTotalMinutes: getTotalMinutes
  }
})()
