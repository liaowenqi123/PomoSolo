; 自定义 NSIS 安装脚本
; 检测更新安装（--updated 标志），强制静默模式，避免弹出安装向导
!macro customInit
  ${If} ${isUpdated}
    SetSilent silent
  ${EndIf}
!macroend
