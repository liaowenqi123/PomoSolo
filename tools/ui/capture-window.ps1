<#
.SYNOPSIS
  抓取指定进程的窗口位图（Win32 PrintWindow，DPI 感知）—— UI 取证工具

.DESCRIPTION
  与 tools/ui/shot.mjs（浏览器 + IPC mock）互补：本脚本抓的是**真实 Tauri 窗口**，
  真 WebView2 + 真 Rust 后端 + 真数据。

  关键点（踩过的坑都写在这里）：
  1. **WebView2 必须用 PW_RENDERFULLCONTENT（flag=2）**，否则 PrintWindow 只拿到空白/边框；
     flag=0 作为兼容回退，两个都存，便于对照。
  2. **DPI 感知**：用 GetDpiForWindow 取实际缩放。Tauri 窗口在 125%/150% 缩放下
     物理像素 ≠ CSS 像素，不换算会得到尺寸对不上的图。
  3. **窗口被最小化时 PrintWindow 抓到的是空白** → 先 ShowWindow(SW_RESTORE) 再抓。
  4. **透明窗口**（本项目主窗口 transparent:true）PrintWindow 会留下未初始化像素
     （常见为黑色/花屏）→ 先在底色上铺一层再叠加窗口位图，图才可读。
  5. 用 DWMWA_EXTENDED_FRAME_BOUNDS 取**不含投影**的边界，避免四周多出黑边。

.PARAMETER ProcessName
  进程名，不带 .exe（默认 pomo-solo）

.PARAMETER TitleMatch
  只抓标题包含该子串的窗口（如 "菜园子"）。不给则抓第一个可见且有标题的窗口。

.PARAMETER OutDir
  产物目录（必填）

.PARAMETER Flags
  只试某个 PrintWindow flag；不给则依次试 2 和 0

.PARAMETER Background
  透明窗口的垫底色，默认 #2b2b2b

.EXAMPLE
  pwsh -File capture-window.ps1 -ProcessName pomo-solo -OutDir temp-debug/ui-shots/x
#>
[CmdletBinding()]
param(
  [string]$ProcessName = 'pomo-solo',
  [string]$TitleMatch = '',
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$Flags = -1,
  [string]$Background = '#2b2b2b'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class WinCap {
    public delegate bool EnumProc(IntPtr h, IntPtr p);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT val, int size);

    public struct RECT { public int Left, Top, Right, Bottom; }

    public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    public const uint PW_RENDERFULLCONTENT = 0x00000002;
    public const int SW_RESTORE = 9;

    public class WinInfo {
        public IntPtr Handle;
        public string Title = "";
        public string Class = "";
        public bool Visible;
        public bool Minimized;
    }

    public static List<WinInfo> Find(string procName, string titleMatch) {
        var outp = new List<WinInfo>();
        var pids = new HashSet<uint>();
        foreach (var p in System.Diagnostics.Process.GetProcessesByName(procName)) pids.Add((uint)p.Id);
        if (pids.Count == 0) return outp;

        EnumWindows((h, p) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (!pids.Contains(pid)) return true;
            var t = new StringBuilder(512); GetWindowTextW(h, t, 512);
            var c = new StringBuilder(256); GetClassNameW(h, c, 256);
            var title = t.ToString();
            if (!string.IsNullOrEmpty(titleMatch) &&
                title.IndexOf(titleMatch, StringComparison.OrdinalIgnoreCase) < 0) return true;
            outp.Add(new WinInfo {
                Handle = h, Title = title, Class = c.ToString(),
                Visible = IsWindowVisible(h), Minimized = IsIconic(h)
            });
            return true;
        }, IntPtr.Zero);
        return outp;
    }

    /// 优先用 DWM 扩展边界（不含投影）；失败回退 GetWindowRect
    public static RECT Bounds(IntPtr h) {
        RECT r;
        if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) == 0)
            return r;
        GetWindowRect(h, out r);
        return r;
    }
}
"@

# ── 选窗口 ──
$wins = [WinCap]::Find($ProcessName, $TitleMatch)
if ($wins.Count -eq 0) {
  $all = [WinCap]::Find($ProcessName, '')
  if ($all.Count -eq 0) {
    Write-Error "进程 '$ProcessName' 没有窗口。应用没在运行？启动：npm run tauri:dev"
  } else {
    Write-Error "进程 '$ProcessName' 有 $($all.Count) 个窗口，但没有标题含 '$TitleMatch' 的。现有标题：`n" +
      (($all | ForEach-Object { "  - '$($_.Title)' (class=$($_.Class))" }) -join "`n")
  }
}

$target = $wins | Where-Object { $_.Visible -and $_.Title } | Select-Object -First 1
if (-not $target) {
  # 全部最小化/无标题 → 退而求其次，取第一个并尝试恢复
  $target = $wins | Select-Object -First 1
  Write-Warning "没有可见且有标题的窗口，改用 hwnd=$($target.Handle) 标题='$($target.Title)'"
}

$h = $target.Handle
$title = $target.Title
$cls = $target.Class

# ── 最小化则先恢复（最小化窗口 PrintWindow 只能抓到空白）──
if ([WinCap]::IsIconic($h)) {
  Write-Output "窗口已最小化 → 先恢复"
  [WinCap]::ShowWindow($h, [WinCap]::SW_RESTORE) | Out-Null
  Start-Sleep -Milliseconds 700
}

[WinCap]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 400

# ── 尺寸与 DPI ──
$r = [WinCap]::Bounds($h)
$w = $r.Right - $r.Left
$hgt = $r.Bottom - $r.Top
if ($w -le 0 -or $hgt -le 0) { Write-Error "窗口尺寸异常：${w}x${hgt}（窗口可能已销毁）" }

$dpi = [WinCap]::GetDpiForWindow($h)
if ($dpi -eq 0) { $dpi = 96 }
$scale = [double]$dpi / 96.0
$logicalW = [int][Math]::Round($w / $scale)
$logicalH = [int][Math]::Round($hgt / $scale)

Write-Output ("window hwnd={0} class={1}" -f $h, $cls)
Write-Output ("title='{0}'" -f $title)
Write-Output ("physical={0}x{1} dpi={2} scale={3:N2} logical={4}x{5}" -f $w, $hgt, $dpi, $scale, $logicalW, $logicalH)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# 垫底色（透明窗口用）
$bgColor = [System.Drawing.ColorTranslator]::FromHtml($Background)

$flagList = if ($Flags -ge 0) { @($Flags) } else { @(2, 0) }
$saved = @()

foreach ($f in $flagList) {
  $bmp = New-Object System.Drawing.Bitmap($w, $hgt)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [WinCap]::PrintWindow($h, $hdc, [uint32]$f)
  $g.ReleaseHdc($hdc)
  $g.Dispose()

  # 铺底色后叠加窗口位图 → 透明区域也可读
  $flat = New-Object System.Drawing.Bitmap($w, $hgt)
  $fg = [System.Drawing.Graphics]::FromImage($flat)
  $fg.Clear($bgColor)
  $fg.DrawImage($bmp, 0, 0, $w, $hgt)
  $fg.Dispose()
  $bmp.Dispose()

  $name = if ($f -eq 2) { "window-pw2-fullcontent.png" } else { "window-pw$f.png" }
  $path = Join-Path $OutDir $name
  $flat.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $flat.Dispose()

  Write-Output ("flags={0} ok={1} saved={2}" -f $f, $ok, $name)
  $saved += [pscustomobject]@{ flag = $f; ok = [bool]$ok; file = $name }
}

# 机读元信息（尺寸/DPI 用于核对"浏览器里 520x560"是否等于"真机 520x560"）
$meta = [ordered]@{
  capturedAt = (Get-Date).ToString('o')
  process = $ProcessName
  hwnd = $h.ToInt64()
  title = $title
  className = $cls
  physical = @{ width = $w; height = $hgt }
  dpi = $dpi
  scale = $scale
  logical = @{ width = $logicalW; height = $logicalH }
  background = $Background
  attempts = $saved
}
$meta | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $OutDir 'window-meta.json') -Encoding utf8
Write-Output "meta saved=window-meta.json"
