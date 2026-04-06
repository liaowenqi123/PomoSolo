// ========================================
// 一键诊断脚本 - 复制到控制台运行
// ========================================

(async function() {
  console.clear()
  console.log('%c========== 自习室排名一键诊断 ==========', 'color: #4CAF50; font-size: 16px; font-weight: bold')
  console.log('')
  
  let hasIssues = false
  
  // 1. 检查自习室状态
  console.log('%c【1. 自习室状态】', 'color: #2196F3; font-weight: bold')
  const isInRoom = StudyRoom.isInRoom()
  const roomId = StudyRoom.currentRoomId
  const roomName = StudyRoom.currentRoomName
  
  console.log('是否在自习室:', isInRoom ? '✅ 是' : '❌ 否')
  console.log('自习室ID:', roomId || '无')
  console.log('自习室名称:', roomName || '无')
  
  if (!isInRoom || !roomId) {
    console.log('%c⚠️ 问题：未加入自习室！', 'color: #FF5722; font-weight: bold')
    console.log('解决方案：')
    console.log('1. 点击侧边栏的"自习室"按钮（👥）')
    console.log('2. 创建或加入一个自习室')
    console.log('3. 关闭弹窗（状态会自动保存）')
    hasIssues = true
  }
  console.log('')
  
  // 2. 检查统计数据
  console.log('%c【2. 统计数据】', 'color: #2196F3; font-weight: bold')
  const todayCount = Stats.getTodayCount()
  const todayMinutes = Stats.getTodayMinutes()
  
  console.log('今日完成次数:', todayCount)
  console.log('今日专注分钟:', todayMinutes)
  
  if (todayMinutes === 0) {
    console.log('%c⚠️ 问题：今日还没有完成任何番茄钟！', 'color: #FF5722; font-weight: bold')
    console.log('解决方案：完成至少一个番茄钟（任意模式）')
    hasIssues = true
  }
  console.log('')
  
  // 3. 检查历史记录
  console.log('%c【3. 历史记录】', 'color: #2196F3; font-weight: bold')
  const data = DataStore.getData()
  const today = new Date().toISOString().split('T')[0]
  const todayRecords = data.statisticsHistory?.filter(r => r.date === today) || []
  
  console.log('今天的日期:', today)
  console.log('今日记录数量:', todayRecords.length)
  if (todayRecords.length > 0) {
    console.log('今日记录详情:', todayRecords)
    const calculatedMinutes = todayRecords.reduce((sum, r) => sum + (r.minutes || 0), 0)
    console.log('计算的今日分钟:', calculatedMinutes)
    
    if (calculatedMinutes !== todayMinutes) {
      console.log('%c⚠️ 警告：计算的分钟数与 getTodayMinutes() 不一致！', 'color: #FF9800; font-weight: bold')
    }
  } else {
    console.log('%c⚠️ 问题：没有今日记录！', 'color: #FF5722; font-weight: bold')
    hasIssues = true
  }
  console.log('')
  
  // 4. 检查上传函数
  console.log('%c【4. 函数检查】', 'color: #2196F3; font-weight: bold')
  console.log('StudyRoom.uploadSession:', typeof StudyRoom.uploadSession === 'function' ? '✅' : '❌')
  console.log('Stats.getTodayMinutes:', typeof Stats.getTodayMinutes === 'function' ? '✅' : '❌')
  console.log('electronAPI.studyRoomUploadStats:', typeof window.electronAPI?.studyRoomUploadStats === 'function' ? '✅' : '❌')
  console.log('')
  
  // 5. 总结
  console.log('%c========== 诊断总结 ==========', 'color: #4CAF50; font-size: 16px; font-weight: bold')
  
  if (!hasIssues && isInRoom && todayMinutes > 0) {
    console.log('%c✅ 所有检查通过！', 'color: #4CAF50; font-weight: bold')
    console.log('')
    console.log('如果排名还是不显示，请：')
    console.log('1. 完成一个新的番茄钟')
    console.log('2. 查看控制台是否有以下日志：')
    console.log('   [Callbacks] 上传专注会话到自习室...')
    console.log('   [StudyRoom] 上传今日统计到自习室...')
    console.log('   [StudyRoomSync] 上传今日统计成功...')
    console.log('')
    console.log('3. 如果没有这些日志，说明代码可能没有正确部署')
    console.log('4. 如果有这些日志但排名还是空，运行以下命令手动刷新：')
    console.log('   await StudyRoom.refreshRoomData()')
  } else {
    console.log('%c❌ 发现问题，请按照上面的解决方案操作', 'color: #FF5722; font-weight: bold')
    console.log('')
    
    if (!isInRoom) {
      console.log('👉 首先：加入一个自习室')
    }
    if (todayMinutes === 0) {
      console.log('👉 然后：完成至少一个番茄钟')
    }
    console.log('👉 最后：查看控制台是否有上传日志')
  }
  
  console.log('')
  console.log('%c========== 诊断完成 ==========', 'color: #4CAF50; font-size: 16px; font-weight: bold')
  console.log('请将以上输出截图或复制，以便进一步分析')
})()
