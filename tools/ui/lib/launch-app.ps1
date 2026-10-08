<#
.SYNOPSIS
  启动一个 GUI 程序，**不抢走当前前台窗口的焦点**。

.DESCRIPTION
  为什么需要它：
    `Start-Process` / `spawn` 启动 GUI 程序时，Windows 会按默认的
    SW_SHOWNORMAL 创建窗口 → 新窗口**被激活**，把用户正在用的窗口挤到后台。
    对 UI 自动化取证工具来说这很打扰人：每次跑一次点击测试，
    用户的前台工作就被打断一次。

  本脚本做两件事：
    1. 用 CreateProcess + STARTF_USESHOWWINDOW + SW_SHOWNOACTIVATE(4) 启动
       —— 窗口**可见但不激活**（可见是必需的：WebView2 最小化/隐藏时
       不渲染，PrintWindow 会抓到空白、无障碍树也会退化）。
    2. 启动前记住当前前台窗口，启动后**把焦点还回去** ——
       兜底用：有些程序（含 WebView2 宿主）会自己调用 SetForegroundWindow，
       只靠 (1) 挡不住。

.PARAMETER Exe
  可执行文件完整路径。

.PARAMETER Arguments
  传给程序的参数（可选）。

.PARAMETER WorkDir
  工作目录（默认取 Exe 所在目录）。

.PARAMETER WaitMs
  启动后等待多少毫秒再把焦点还回去（默认 1200）。

.PARAMETER RestoreFocus
  是否把焦点还给启动前的窗口（默认是）。设为 $false 可关闭。

.OUTPUTS
  一行机读结果：pid=<PID> restored=<hwnd 或 0>
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Arguments = '',
  [string]$WorkDir = '',
  [int]$WaitMs = 1200,
  [bool]$RestoreFocus = $true
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NoActivateLauncher
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars;
        public int dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName, string lpCommandLine,
        IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
        bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment,
        string lpCurrentDirectory, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr h);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    public const uint STARTF_USESHOWWINDOW = 0x00000001;
    public const short SW_SHOWNOACTIVATE = 4;
}
'@

if (-not (Test-Path -LiteralPath $Exe)) {
  throw "找不到可执行文件：$Exe"
}
if ([string]::IsNullOrWhiteSpace($WorkDir)) {
  $WorkDir = Split-Path -Parent $Exe
}

# 记住启动前的前台窗口，稍后还回去
$prevFg = [NoActivateLauncher]::GetForegroundWindow()

$si = New-Object NoActivateLauncher+STARTUPINFO
$si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($si)
$si.dwFlags = [NoActivateLauncher]::STARTF_USESHOWWINDOW
$si.wShowWindow = [NoActivateLauncher]::SW_SHOWNOACTIVATE
$si.lpDesktop = $null

$pi = New-Object NoActivateLauncher+PROCESS_INFORMATION

# 命令行：CreateProcess 的 lpCommandLine 需要可写缓冲，PowerShell 传字符串即可
$cmdline = if ([string]::IsNullOrWhiteSpace($Arguments)) { "`"$Exe`"" } else { "`"$Exe`" $Arguments" }

$ok = [NoActivateLauncher]::CreateProcess(
  $Exe, $cmdline, [IntPtr]::Zero, [IntPtr]::Zero, $false,
  0, [IntPtr]::Zero, $WorkDir, [ref]$si, [ref]$pi)

if (-not $ok) {
  $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
  throw "CreateProcess 失败（Win32 错误 $err）"
}

$pid_ = $pi.dwProcessId
[NoActivateLauncher]::CloseHandle($pi.hThread) | Out-Null
[NoActivateLauncher]::CloseHandle($pi.hProcess) | Out-Null

# 兜底：有些程序会自己抢前台，等窗口出来后把焦点还给原来的窗口
$restored = 0
if ($RestoreFocus -and $prevFg -ne [IntPtr]::Zero) {
  Start-Sleep -Milliseconds $WaitMs
  if ([NoActivateLauncher]::IsWindow($prevFg)) {
    [NoActivateLauncher]::SetForegroundWindow($prevFg) | Out-Null
    $restored = $prevFg.ToInt64()
  }
}

Write-Output ("pid={0} restored={1}" -f $pid_, $restored)
