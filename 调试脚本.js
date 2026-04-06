// 复制以下代码到浏览器控制台（F12），然后按回车执行

console.log('========== 自习室排名调试 ==========\n')

// 1. 检查自习室状态
console.log('【1. 自习室状态】')
console.log('是否在自习室:', StudyRoom.isInRoom())
console.log('自习室ID:', StudyRoom.currentRoomId)
console.log('自习室名称:', StudyRoom.currentRoomName)
console.log('')

// 2. 检查统计数据
console.log('【2. 统计数据】')
const stats = DataStore.getStats()
console.log('stats对象:', stats)
console.log('今日完成次数:', Stats.getTodayCount())
console.log('累计专注分钟:', Stats.getTotalMinutes())
console.log('今日专注分钟:', Stats.getTodayMinutes())
console.log('')

// 3. 检查历史记录
console.log('【3. 历史记录】')
const data = DataStore.getData()
const today = new Date().toISOString().split('T')[0]
console.log('今天的日期:', today)
console.log('statisticsHistory存在:', !!data.statisticsHistory)
if (data.statisticsHistory) {
  const todayRecords = data.statisticsHistory.filter(record => record.date === today)
  console.log('今日记录数量:', todayRecords.length)
  console.log('今日记录详情:', todayRecords)
  
  // 计算今日总分钟
  const todayMinutes = todayRecords.reduce((sum, r) => sum + (r.minutes || 0), 0)
  console.log('今日总分钟（手动计算）:', todayMinutes)
}
console.log('')

// 4. 检查上传函数
console.log('【4. 上传函数检查】')
console.log('StudyRoom.uploadSession 存在:', typeof StudyRoom.uploadSession === 'function')
console.log('Stats.getTodayMinutes 存在:', typeof Stats.getTodayMinutes === 'function')
console.log('electronAPI.studyRoomUploadStats 存在:', typeof window.electronAPI.studyRoomUploadStats === 'function')
console.log('')

// 5. 模拟上传（不实际执行）
console.log('【5. 模拟上传数据】')
if (StudyRoom.currentRoomId) {
  const todayCount = Stats.getTodayCount()
  const todayMinutes = Stats.getTodayMinutes()
  console.log('将要上传的数据:')
  console.log('  - 自习室ID:', StudyRoom.currentRoomId)
  console.log('  - 今日次数:', todayCount)
  console.log('  - 今日分钟:', todayMinutes)
  
  if (todayMinutes === 0) {
    console.warn('⚠️ 警告：今日分钟数为0，不会显示在排名中')
    console.log('   请完成至少一个番茄钟')
  }
} else {
  console.warn('⚠️ 警告：未加入自习室，无法上传数据')
  console.log('   请先加入或创建一个自习室')
}
console.log('')

// 6. 检查 DataStore
console.log('【6. DataStore 状态】')
console.log('studyRoom 数据:', data.studyRoom)
console.log('')

// 7. 总结
console.log('========== 诊断总结 ==========')
const issues = []

if (!StudyRoom.currentRoomId) {
  issues.push('❌ 未加入自习室')
}

if (Stats.getTodayMinutes() === 0) {
  issues.push('❌ 今日还没有完成任何番茄钟')
}

if (!data.statisticsHistory || data.statisticsHistory.length === 0) {
  issues.push('❌ 没有历史记录数据')
}

if (issues.length === 0) {
  console.log('✅ 所有检查通过！')
  console.log('如果排名还是不显示，请：')
  console.log('1. 完成一个新的番茄钟')
  console.log('2. 查看控制台是否有上传成功的日志')
  console.log('3. 刷新自习室排名')
} else {
  console.log('发现以下问题：')
  issues.forEach(issue => console.log(issue))
  console.log('')
  console.log('解决方案：')
  if (!StudyRoom.currentRoomId) {
    console.log('1. 打开自习室弹窗，加入或创建一个自习室')
  }
  if (Stats.getTodayMinutes() === 0) {
    console.log('2. 完成至少一个番茄钟（单次/计划/正向任意模式）')
  }
}

console.log('\n========== 调试完成 ==========')
console.log('请将以上所有输出截图或复制，以便进一步分析')
