/**
 * 主进程共享状态
 * 所有 IPC 模块通过 require 引入同一实例
 */
module.exports = {
  // 主窗口引用
  mainWindow: null,

  // 菜园子窗口引用
  gardenWindow: null,

  // 系统托盘（迷你模式时创建）
  tray: null,

  // 专注模式状态（供菜园子窗口查询）
  focusModeEnabled: false,
  timerRunning: false,
  timerPaused: false,

  // 前台检测就绪状态
  foregroundInspectionReady: false,

  // 迷你模式位置信息
  normalModePosition: null,
  miniModePosition: null,

  // 退出标志（防止重复触发 before-quit）
  isQuitting: false
}
