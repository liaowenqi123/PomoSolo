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

    [StructLayout(LayoutKind.Sequential)]
    public struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public bool bInheritHandle;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName, string lpCommandLine,
        IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
        bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment,
        string lpCurrentDirectory, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateFile(
        string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        ref SECURITY_ATTRIBUTES lpSecurityAttributes, uint dwCreationDisposition,
        uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr h);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    public const uint STARTF_USESHOWWINDOW = 0x00000001;
    public const uint STARTF_USESTDHANDLES = 0x00000100;
    public const short SW_SHOWNOACTIVATE = 4;

    public const uint GENERIC_READ = 0x80000000;
    public const uint GENERIC_WRITE = 0x40000000;
    public const uint FILE_SHARE_READ = 1;
    public const uint FILE_SHARE_WRITE = 2;
    public const uint OPEN_EXISTING = 3;
    public const uint FILE_ATTRIBUTE_NORMAL = 0x80;

    /// <summary>打开 NUL 设备并标记为可继承，用作子进程的标准句柄。</summary>
    public static IntPtr OpenNulHandle()
    {
        SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
        sa.nLength = Marshal.SizeOf(sa);
        sa.lpSecurityDescriptor = IntPtr.Zero;
        sa.bInheritHandle = true;
        return CreateFile("NUL",
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ref sa, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
    }
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

# ── 关键：把子进程的标准句柄指向 NUL ──────────────────────────────────
# 不这样做的话，GUI 子进程会**继承调用方的 stdout/stderr**（实测：应用自己的
# 日志 —— [updater] / [cloud_auth] —— 会打到调用方的终端里，而且更糟的是：
# 调用方（Node 的 spawnSync / 管道）会一直等 stdout 的 EOF，而应用不退出就
# 永远没有 EOF → **整个 ui:drive 卡死**。这是个真实踩过的坑。
# 注意 bInheritHandles=false 挡不住它：CreateProcess 会把父进程的标准句柄
# 直接填进子进程的 PEB，与继承标志无关。正解是显式 STARTF_USESTDHANDLES。
$nul = [NoActivateLauncher]::OpenNulHandle()
if ($nul -eq [IntPtr]::Zero -or $nul -eq [IntPtr](-1)) {
  throw "无法打开 NUL 设备句柄（Win32 错误 $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())）"
}

$si = New-Object NoActivateLauncher+STARTUPINFO
$si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($si)
$si.dwFlags = [NoActivateLauncher]::STARTF_USESHOWWINDOW -bor [NoActivateLauncher]::STARTF_USESTDHANDLES
$si.wShowWindow = [NoActivateLauncher]::SW_SHOWNOACTIVATE
$si.lpDesktop = $null
$si.hStdInput = $nul
$si.hStdOutput = $nul
$si.hStdError = $nul

$pi = New-Object NoActivateLauncher+PROCESS_INFORMATION

# 命令行：CreateProcess 的 lpCommandLine 需要可写缓冲，PowerShell 传字符串即可
$cmdline = if ([string]::IsNullOrWhiteSpace($Arguments)) { "`"$Exe`"" } else { "`"$Exe`" $Arguments" }

try {
  # bInheritHandles 必须为 $true，NUL 句柄才能在子进程里有效
  $ok = [NoActivateLauncher]::CreateProcess(
    $Exe, $cmdline, [IntPtr]::Zero, [IntPtr]::Zero, $true,
    0, [IntPtr]::Zero, $WorkDir, [ref]$si, [ref]$pi)
} finally {
  # 父进程不再需要 NUL 句柄（子进程已有自己的副本）
  [NoActivateLauncher]::CloseHandle($nul) | Out-Null
}

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
