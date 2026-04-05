/**
 * 统计模块 - 数据可视化
 */

const Statistics = (function() {
  'use strict'

  let elements = {}
  let currentPeriod = 'daily' // daily, weekly, monthly
  let currentChartType = 'bar' // bar, line, pie
  let chartInstance = null
  let statsModal = null

  /**
   * 初始化统计模块
   */
  function init(els) {
    elements = els
    
    // 创建弹窗实例
    statsModal = new AnimatedModal({
      element: elements.statsModal,
      showClass: 'show',
      hidingClass: 'hiding',
      animationDuration: 500,
      onShow: () => {
        syncCurrentDataToHistory()
        updateOverview()
        updateChart()
        updateDetailsTable()
      },
      onHide: () => {
        // 销毁图表实例
        if (chartInstance) {
          chartInstance.destroy()
          chartInstance = null
        }
      }
    })
    
    bindEvents()
  }

  /**
   * 绑定事件
   */
  function bindEvents() {
    // 统计按钮点击
    if (elements.statsBtn) {
      console.log('统计按钮已找到，绑定事件')
      elements.statsBtn.addEventListener('click', () => statsModal.show())
    } else {
      console.error('统计按钮未找到')
    }

    // 关闭弹窗
    if (elements.statsModalClose) {
      elements.statsModalClose.addEventListener('click', () => statsModal.hide())
    }

    // 时间范围切换
    const periodBtns = document.querySelectorAll('.stats-period-btn')
    periodBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        periodBtns.forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        currentPeriod = btn.dataset.period
        updateOverview()
        updateChart()
        updateDetailsTable()
      })
    })

    // 图表类型切换
    const chartBtns = document.querySelectorAll('.stats-chart-btn')
    chartBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        chartBtns.forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        currentChartType = btn.dataset.chart
        updateChart()
      })
    })
  }

  /**
   * 同步当前统计数据到历史记录
   */
  function syncCurrentDataToHistory() {
    // 不再需要同步，因为现在每次完成番茄钟都会直接记录到历史
    console.log('使用新的历史记录结构，无需同步')
  }

  /**
   * 更新统计概览
   */
  function updateOverview() {
    const history = getStatisticsHistory()
    const data = getDataForPeriod(history, currentPeriod)

    // 计算总次数
    const totalSessions = data.reduce((sum, item) => sum + item.count, 0)
    
    // 计算总时长（分钟）
    const totalMinutes = data.reduce((sum, item) => sum + item.minutes, 0)
    
    // 计算平均时长
    const avgMinutes = totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0

    // 更新显示
    if (elements.statsTotalSessions) {
      elements.statsTotalSessions.textContent = totalSessions
    }
    if (elements.statsTotalMinutes) {
      elements.statsTotalMinutes.textContent = totalMinutes
    }
    if (elements.statsAvgMinutes) {
      elements.statsAvgMinutes.textContent = avgMinutes
    }
  }

  /**
   * 更新图表
   */
  function updateChart() {
    const history = getStatisticsHistory()
    const data = getDataForPeriod(history, currentPeriod)

    if (data.length === 0) {
      showEmptyState()
      return
    }

    hideEmptyState()

    const canvas = elements.statsChart
    if (!canvas) return

    const ctx = canvas.getContext('2d')

    // 销毁旧图表
    if (chartInstance) {
      chartInstance.destroy()
    }

    // 准备数据
    const labels = data.map(item => item.label)
    const minutes = data.map(item => item.minutes)

    // 获取所有备注类型并分配颜色
    const allNotes = new Set()
    data.forEach(item => {
      if (item.noteGroups) {
        Object.keys(item.noteGroups).forEach(note => allNotes.add(note))
      }
    })
    
    const noteColors = {}
    const colorPalette = [
      'rgba(200, 213, 224, 0.8)',  // 莫兰迪蓝
      'rgba(232, 213, 196, 0.8)',  // 莫兰迪米
      'rgba(212, 228, 215, 0.8)',  // 莫兰迪绿
      'rgba(234, 209, 220, 0.8)',  // 莫兰迪粉
      'rgba(217, 217, 230, 0.8)',  // 莫兰迪紫
      'rgba(230, 224, 206, 0.8)',  // 莫兰迪黄
      'rgba(220, 210, 210, 0.8)'   // 莫兰迪灰粉
    ]
    
    Array.from(allNotes).forEach((note, index) => {
      noteColors[note] = colorPalette[index % colorPalette.length]
    })

    const isDarkMode = document.body.classList.contains('dark-mode')
    const textColor = isDarkMode ? '#e0e0e0' : '#666'
    const gridColor = isDarkMode ? '#444' : '#e0e0e0'

    // 根据图表类型创建配置
    let chartConfig = {}

    if (currentChartType === 'pie') {
      // 饼图：显示所有备注的总时长
      const pieData = {}
      data.forEach(item => {
        if (item.noteGroups) {
          Object.entries(item.noteGroups).forEach(([note, minutes]) => {
            pieData[note] = (pieData[note] || 0) + minutes
          })
        }
      })
      
      const pieLabels = Object.keys(pieData)
      const pieValues = Object.values(pieData)
      const pieColors = pieLabels.map(note => noteColors[note])
      
      chartConfig = {
        type: 'pie',
        data: {
          labels: pieLabels,
          datasets: [{
            label: '专注时长（分钟）',
            data: pieValues,
            backgroundColor: pieColors,
            borderWidth: 2,
            borderColor: isDarkMode ? '#2d2d2d' : '#fff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: textColor,
                padding: 10,
                font: { size: 11 }
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.label || ''
                  const value = context.parsed || 0
                  const total = context.dataset.data.reduce((a, b) => a + b, 0)
                  const percentage = ((value / total) * 100).toFixed(1)
                  return `${label}: ${value}分钟 (${percentage}%)`
                }
              }
            }
          }
        }
      }
    } else if (currentChartType === 'line') {
      chartConfig = {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: '专注时长（分钟）',
              data: minutes,
              borderColor: 'rgba(200, 213, 224, 1)',
              backgroundColor: 'rgba(200, 213, 224, 0.15)',
              tension: 0.4,
              fill: true,
              pointBackgroundColor: 'rgba(200, 213, 224, 1)',
              pointBorderColor: '#fff',
              pointBorderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              labels: {
                color: textColor,
                padding: 10,
                font: { size: 12 }
              }
            },
            tooltip: {
              callbacks: {
                afterLabel: function(context) {
                  // 显示这一天不同备注的详细分布
                  const dataIndex = context.dataIndex
                  const item = data[dataIndex]
                  if (item.noteGroups) {
                    const details = []
                    Object.entries(item.noteGroups).forEach(([note, minutes]) => {
                      details.push(`  ${note}: ${minutes}分钟`)
                    })
                    return details.join('\n')
                  }
                  return ''
                }
              }
            }
          },
          scales: {
            x: {
              ticks: {
                color: textColor
              },
              grid: {
                color: gridColor
              }
            },
            y: {
              ticks: {
                color: textColor
              },
              grid: {
                color: gridColor
              },
              title: {
                display: true,
                text: '分钟',
                color: textColor
              }
            }
          }
        }
      }
    } else { // bar - 堆叠柱状图显示不同备注
      // 创建堆叠数据集
      const datasets = []
      Array.from(allNotes).forEach(note => {
        const noteData = data.map(item => {
          return item.noteGroups && item.noteGroups[note] ? item.noteGroups[note] : 0
        })
        
        datasets.push({
          label: note,
          data: noteData,
          backgroundColor: noteColors[note],
          borderColor: noteColors[note].replace('0.8', '1'),
          borderWidth: 1,
          borderRadius: 6
        })
      })
      
      chartConfig = {
        type: 'bar',
        data: {
          labels: labels,
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              stacked: true,
              ticks: {
                color: textColor
              },
              grid: {
                color: gridColor
              }
            },
            y: {
              stacked: true,
              ticks: {
                color: textColor
              },
              grid: {
                color: gridColor
              },
              title: {
                display: true,
                text: '分钟',
                color: textColor
              }
            }
          },
          plugins: {
            legend: {
              labels: {
                color: textColor,
                padding: 10,
                font: { size: 12 }
              }
            }
          }
        }
      }
    }

    chartInstance = new Chart(ctx, chartConfig)
  }

  /**
   * 更新详细数据表格
   */
  function updateDetailsTable() {
    const history = getStatisticsHistory()
    const data = getDataForPeriod(history, currentPeriod)

    const tbody = elements.statsTableBody
    if (!tbody) return

    tbody.innerHTML = ''

    if (data.length === 0) {
      return
    }

    // 倒序显示（最新的在前）
    data.reverse().forEach(item => {
      const row = document.createElement('tr')
      
      // 根据时间范围显示不同的表头内容
      let periodLabel = ''
      if (currentPeriod === 'daily') {
        periodLabel = '当日'
      } else if (currentPeriod === 'weekly') {
        periodLabel = '当周'
      } else {
        periodLabel = '当月'
      }
      
      row.innerHTML = `
        <td>${item.label}</td>
        <td>${item.minutes}</td>
        <td>${item.count > 0 ? Math.round(item.minutes / item.count) : 0}</td>
      `
      tbody.appendChild(row)
    })
    
    // 更新表头
    const tableHeaders = document.querySelectorAll('.stats-table th')
    if (tableHeaders.length >= 3) {
      let periodLabel = ''
      if (currentPeriod === 'daily') {
        periodLabel = '每日专注时长'
      } else if (currentPeriod === 'weekly') {
        periodLabel = '每周专注时长'
      } else {
        periodLabel = '每月专注时长'
      }
      tableHeaders[1].textContent = periodLabel
    }
  }

  /**
   * 显示空状态
   */
  function showEmptyState() {
    if (elements.statsChartContainer) {
      elements.statsChartContainer.innerHTML = `
        <div class="stats-empty">
          <div class="stats-empty-icon">📊</div>
          <div class="stats-empty-text">暂无数据</div>
        </div>
      `
    }
  }

  /**
   * 隐藏空状态
   */
  function hideEmptyState() {
    if (elements.statsChartContainer) {
      elements.statsChartContainer.innerHTML = '<canvas id="stats-chart"></canvas>'
      elements.statsChart = document.getElementById('stats-chart')
    }
  }

  /**
   * 获取统计历史数据
   */
  function getStatisticsHistory() {
    const data = DataStore.getData()
    let history = data.statisticsHistory || []
    let needsSave = false
    
    // 数据迁移：检查是否是旧格式的数据（只迁移一次）
    // 旧格式：每天一条记录，包含 count 和 minutes 字段
    // 新格式：每个番茄钟一条记录，包含 date、timestamp、minutes、note 字段
    if (history.length > 0 && history[0].count !== undefined) {
      console.log('检测到旧格式数据，进行一次性数据迁移')
      const migratedHistory = []
      
      // 将旧格式数据转换为新格式
      history.forEach(oldRecord => {
        if (oldRecord.count && oldRecord.minutes) {
          // 将一天的数据拆分成多个番茄钟记录
          const avgMinutes = Math.round(oldRecord.minutes / oldRecord.count)
          for (let i = 0; i < oldRecord.count; i++) {
            migratedHistory.push({
              date: oldRecord.date,
              timestamp: oldRecord.date + 'T' + String(9 + i).padStart(2, '0') + ':00:00.000Z', // 模拟时间戳
              minutes: i === oldRecord.count - 1 ? oldRecord.minutes - (avgMinutes * (oldRecord.count - 1)) : avgMinutes, // 最后一个记录包含余数
              note: '历史数据'
            })
          }
        }
      })
      
      history = migratedHistory
      needsSave = true
      console.log('数据迁移完成，从旧格式迁移到', migratedHistory.length, '条新记录')
    }
    
    // 保存迁移后的数据（只在需要时保存一次）
    if (needsSave) {
      data.statisticsHistory = history
      if (window.electronAPI) {
        window.electronAPI.writeData(data)
      }
    }
    
    console.log('历史数据:', history)
    return history
  }

  /**
   * 根据时间范围获取数据
   */
  function getDataForPeriod(history, period) {
    const now = new Date()
    
    if (period === 'daily') {
      // 最近7天
      return getLast7Days(history, now)
    } else if (period === 'weekly') {
      // 最近4周
      return getLast4Weeks(history, now)
    } else if (period === 'monthly') {
      // 最近6个月
      return getLast6Months(history, now)
    }
    
    return []
  }

  /**
   * 获取最近7天数据
   */
  function getLast7Days(history, now) {
    const result = []
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      
      // 获取这一天的所有记录
      const dayRecords = history.filter(item => item.date === dateStr)
      const count = dayRecords.length
      const minutes = dayRecords.reduce((sum, item) => sum + (item.minutes || 0), 0)
      
      // 按备注分组统计（用于图表颜色）
      const noteGroups = {}
      dayRecords.forEach(record => {
        const note = record.note || '无备注'
        if (!noteGroups[note]) {
          noteGroups[note] = 0
        }
        noteGroups[note] += record.minutes || 0
      })
      
      result.push({
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        date: dateStr,
        count: count,
        minutes: minutes,
        noteGroups: noteGroups
      })
    }
    
    return result
  }

  /**
   * 获取最近4周数据
   */
  function getLast4Weeks(history, now) {
    const result = []
    
    for (let i = 3; i >= 0; i--) {
      const endDate = new Date(now)
      endDate.setDate(endDate.getDate() - i * 7)
      const startDate = new Date(endDate)
      startDate.setDate(startDate.getDate() - 6)
      
      // 获取这一周的所有记录
      const weekRecords = history.filter(item => {
        const itemDate = new Date(item.date)
        return itemDate >= startDate && itemDate <= endDate
      })
      
      const count = weekRecords.length
      const minutes = weekRecords.reduce((sum, item) => sum + (item.minutes || 0), 0)
      
      // 按备注分组统计
      const noteGroups = {}
      weekRecords.forEach(record => {
        const note = record.note || '无备注'
        if (!noteGroups[note]) {
          noteGroups[note] = 0
        }
        noteGroups[note] += record.minutes || 0
      })
      
      result.push({
        label: `${startDate.getMonth() + 1}/${startDate.getDate()}-${endDate.getMonth() + 1}/${endDate.getDate()}`,
        count: count,
        minutes: minutes,
        noteGroups: noteGroups
      })
    }
    
    return result
  }

  /**
   * 获取最近6个月数据
   */
  function getLast6Months(history, now) {
    const result = []
    
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const year = date.getFullYear()
      const month = date.getMonth() + 1
      
      // 获取这个月的所有记录
      const monthRecords = history.filter(item => {
        const itemDate = new Date(item.date)
        return itemDate.getFullYear() === year && itemDate.getMonth() + 1 === month
      })
      
      const count = monthRecords.length
      const minutes = monthRecords.reduce((sum, item) => sum + (item.minutes || 0), 0)
      
      // 按备注分组统计
      const noteGroups = {}
      monthRecords.forEach(record => {
        const note = record.note || '无备注'
        if (!noteGroups[note]) {
          noteGroups[note] = 0
        }
        noteGroups[note] += record.minutes || 0
      })
      
      result.push({
        label: `${year}/${month}`,
        count: count,
        minutes: minutes,
        noteGroups: noteGroups
      })
    }
    
    return result
  }

  return {
    init: init
  }
})()

// 暴露到全局
window.Statistics = Statistics
