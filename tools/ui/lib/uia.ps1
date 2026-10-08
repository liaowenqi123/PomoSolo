<#
.SYNOPSIS
  UI Automation 驱动真实桌面窗口（Tauri / WebView2）—— UI 取证工具的一部分

.DESCRIPTION
  给 tools/ui/desktop-drive.mjs 调用。能对**真实 Tauri 窗口**做三件事：
    dump   导出无障碍树（元素类型/名称/屏幕坐标/尺寸/可用模式）
    click  按名称点击元素（优先 UIA InvokePattern；失败回退 Win32 SendInput）
    audit  按"点击热区"判据审计真实 UI

  为什么用 UIA 而不是 CDP：
    Tauri v2 会程序化注入 WebView2 的 additionalBrowserArgs，**覆盖**
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 环境变量（已实测：端口不开放）。
    要开 CDP 必须改 tauri.conf.json 并重编译。UIA 无需改动应用。

  关键坑（都实测过）：
  1. **WebView2 的无障碍树是惰性构建的** —— 第一次遍历只能看到宿主 Pane，
     必须"走一遍 → 等 → 再走一遍"才拿得到 DOM 内容。本脚本内置双次遍历。
  2. **BoundingRectangle 是屏幕物理像素**，不是 CSS 像素。
     本机 DPI 150% → 除以 1.5 才是 CSS/逻辑像素（与 Web 端审计对齐）。
  3. WebView2 元素大多不支持 InvokePattern，需要回退 SendInput 真鼠标点击
     （会移动光标，但走真实输入管线，能测出遮挡/热区问题）。

.PARAMETER Action
  dump | click | audit | list

.EXAMPLE
  pwsh -File uia.ps1 -ProcessName pomo-solo -Action dump -MaxNodes 400
  pwsh -File uia.ps1 -ProcessName pomo-solo -Action click -Name '⚙️' -ControlType Button
  pwsh -File uia.ps1 -ProcessName pomo-solo -Action audit -MinTargetCss 44
#>
[CmdletBinding()]
param(
  [string]$ProcessName = 'pomo-solo',
  [string]$TitleMatch = 'PomoSolo',
  [ValidateSet('dump', 'click', 'audit', 'list')]
  [string]$Action = 'dump',
  [int]$MaxNodes = 500,
  [int]$MaxDepth = 18,
  # 定位元素：Name 精确 / NameContains 包含 / ControlType 限定 / 类名包含与排除
  [string]$Name = '',
  [string]$NameContains = '',
  [string]$ControlType = '',
  [string]$ClassNameContains = '',
  [string]$ClassNameNotContains = '',
  [string]$HelpTextContains = '',
  [int]$Index = 0,
  # audit 判据：CSS 像素下的最小点击热区
  #   ⚠️ 桌面端与触摸端标准不同：
  #      44 = 触摸目标（WCAG 2.5.5 / 本项目 PWA 规矩，适用于手机）
  #      24 = 桌面指针目标下限（WCAG 2.5.8 Target Size Minimum）
  #   对 520×560 的桌面窗口用 44 会把 39×39 的正常图标全报成问题（纯噪声）。
  #   默认由调用方（desktop-drive.mjs）按窗口类型传入。
  [double]$MinTargetCss = 24,
  # 允许 InvokePattern 之外的回退点击（SendInput 真鼠标）
  [switch]$AllowSendInput
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$AE = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

# ── Win32：DPI + SendInput ──────────────────────────────────────────────
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(40);
    mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
  }
}
"@

function Fail($msg) {
  $o = [ordered]@{ ok = $false; error = $msg }
  $o | ConvertTo-Json -Depth 6 -Compress
  exit 2
}

# ── 找窗口 ─────────────────────────────────────────────────────────────
$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$TitleMatch*" } |
  Select-Object -First 1
if (-not $proc) {
  $all = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
  if (-not $all) { Fail "进程 '$ProcessName' 未运行" }
  Fail "进程 '$ProcessName' 在跑，但没有标题含 '$TitleMatch' 的窗口。现有标题：$(($all | ForEach-Object { $_.MainWindowTitle }) -join ' / ')"
}
$hwnd = $proc.MainWindowHandle
# ── 不抢焦点 ───────────────────────────────────────────────────────────
# 这里**故意不调用 SetForegroundWindow**（原来调了，导致每次点击/审计都把
# 用户的前台窗口挤到后台，很打扰人）。要点：
#   · UIA 的 InvokePattern / LegacyIAccessible 是**直接调用提供程序**，
#     不需要窗口在前台；
#   · 无障碍树只要求窗口**可见**（非最小化）—— 被别的窗口盖住也算可见。
# 唯一需要的动作：窗口若被最小化则不渲染、树会退化，用 SW_SHOWNOACTIVATE(4)
# 让它显示出来但**不激活**（原来的 SW_RESTORE(9) 会激活）。
# 真需要前台（例如 --allow-sendinput 走 Win32 真鼠标）时才由调用方显式要求。
if ([W32]::IsIconic($hwnd)) {
  [W32]::ShowWindow($hwnd, 4) | Out-Null   # SW_SHOWNOACTIVATE
  Start-Sleep -Milliseconds 600
}
$dpi = [W32]::GetDpiForWindow($hwnd); if ($dpi -eq 0) { $dpi = 96 }
$dpiScale = [double]$dpi / 96.0

$root = $AE::FromHandle($hwnd)
if (-not $root) { Fail 'UIA FromHandle 返回空（窗口可能正在销毁）' }

# ── 遍历（含 WebView2 惰性构建的唤醒）──────────────────────────────────
function New-Acc([System.Windows.Automation.AutomationElement]$el, [int]$depth) {
  $c = $el.Current
  $r = $c.BoundingRectangle
  $patterns = @()
  try { if ($el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)) { $patterns += 'invoke' } } catch {}
  try { if ($el.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)) { $patterns += 'legacy' } } catch {}
  try { if ($el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)) { $patterns += 'value' } } catch {}
  try { if ($el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)) { $patterns += 'select' } } catch {}
  [pscustomobject]@{
    depth     = $depth
    type      = ($c.ControlType.ProgrammaticName -replace 'ControlType\.', '')
    name      = ($c.Name -replace '\s+', ' ')
    # HelpText 通常来自 HTML 的 title 属性 —— 比 emoji 名称**稳定得多**，
    # 例如主题按钮的 name 会随主题在 ☀️/🌙 之间变，但 title 恒为「切换深色模式」。
    helpText  = $c.HelpText
    autoId    = $c.AutomationId
    className = $c.ClassName
    enabled   = $c.IsEnabled
    offscreen = $c.IsOffscreen
    x         = if ($r.IsEmpty) { $null } else { [int]$r.X }
    y         = if ($r.IsEmpty) { $null } else { [int]$r.Y }
    w         = if ($r.IsEmpty) { $null } else { [int]$r.Width }
    h         = if ($r.IsEmpty) { $null } else { [int]$r.Height }
    patterns  = $patterns
  }
}

function Walk([System.Windows.Automation.AutomationElement]$el, [int]$depth, $acc, $elems, [ref]$count) {
  if ($null -eq $el) { return }
  if ($count.Value -ge $MaxNodes) { return }
  if ($depth -gt $MaxDepth) { return }
  $count.Value++
  $acc.Add((New-Acc $el $depth)) | Out-Null
  # ⚠️ 必须同时留下**真实的 AutomationElement 引用**：
  #    上面的 PSCustomObject 只用于 JSON 输出，它没有 GetCurrentPattern 方法。
  #    丢了引用就会得到"patterns 里有 invoke 却说该元素不支持 invoke"这种自相矛盾的错误。
  $elems.Add($el) | Out-Null
  try {
    $child = $walker.GetFirstChild($el)
    while ($null -ne $child) {
      Walk $child ($depth + 1) $acc $elems $count
      if ($count.Value -ge $MaxNodes) { break }
      $child = $walker.GetNextSibling($child)
    }
  } catch { }
}

function Get-Tree {
  # WebView2 惰性构建：第一次遍历只唤醒，第二次才拿得到 DOM 内容（实测）。
  # 有时一遍就够（同一 runtime 已被唤醒过），所以取节点更多的那个。
  $c1 = [ref]0; $a1 = New-Object System.Collections.ArrayList; $e1 = New-Object System.Collections.ArrayList
  Walk $root 0 $a1 $e1 $c1
  Start-Sleep -Milliseconds 900
  $c2 = [ref]0; $a2 = New-Object System.Collections.ArrayList; $e2 = New-Object System.Collections.ArrayList
  Walk $root 0 $a2 $e2 $c2
  if ($c2.Value -ge $c1.Value) { return @{ nodes = $a2; elems = $e2; count = $c2.Value; firstPass = $c1.Value } }
  return @{ nodes = $a1; elems = $e1; count = $c1.Value; firstPass = $c1.Value }
}

# ── 元素匹配 ───────────────────────────────────────────────────────────
function Test-Match($n) {
  if ($Name -and $n.name -ne $Name) { return $false }
  if ($NameContains -and ($n.name -notlike "*$NameContains*")) { return $false }
  if ($ControlType -and $n.type -ne $ControlType) { return $false }
  # 类名匹配用来**消歧**：例如「×」既是窗口关闭按钮（window-controls__btn--close）
  # 又是各面板的关闭按钮（settings-panel__close）—— 不排除窗口控件就会误点、把应用关掉。
  if ($ClassNameContains -and ($n.className -notlike "*$ClassNameContains*")) { return $false }
  if ($ClassNameNotContains -and ($n.className -like "*$ClassNameNotContains*")) { return $false }
  if ($HelpTextContains -and ($n.helpText -notlike "*$HelpTextContains*")) { return $false }
  return $true
}

# 需要"能点"的元素：有 invoke/legacy/select 模式，或本身就是按钮类控件
$CLICKY = @('Button', 'Hyperlink', 'MenuItem', 'TabItem', 'CheckBox', 'RadioButton', 'ListItem', 'SplitButton')

switch ($Action) {

  'list' {
    $t = Get-Tree
    $o = [ordered]@{
      ok = $true; hwnd = $hwnd.ToInt64(); title = $proc.MainWindowTitle
      dpi = $dpi; dpiScale = $dpiScale; nodes = $t.count; firstPass = $t.firstPass
    }
    $o | ConvertTo-Json -Depth 4 -Compress
    break
  }

  'dump' {
    $t = Get-Tree
    $o = [ordered]@{
      ok         = $true
      hwnd       = $hwnd.ToInt64()
      title      = $proc.MainWindowTitle
      dpi        = $dpi
      dpiScale   = $dpiScale
      nodeCount  = $t.count
      firstPass  = $t.firstPass
      nodes      = $t.nodes
    }
    $o | ConvertTo-Json -Depth 6
    break
  }

  'audit' {
    $t = Get-Tree
    $findings = New-Object System.Collections.ArrayList
    foreach ($n in $t.nodes) {
      if ($null -eq $n.x -or $null -eq $n.w) { continue }
      if (-not $n.enabled -or $n.offscreen) { continue }
      if ($n.w -le 0 -or $n.h -le 0) { continue }
      # 跳过**无名称**的元素：WebView2 会给大量布局容器（含窗口根节点）挂 invoke 模式，
      # 但它们既无法识别（报告里只能写 "Group|"）也不是用户目标 → 纯噪声。
      if ([string]::IsNullOrWhiteSpace($n.name)) { continue }
      $isClicky = ($CLICKY -contains $n.type) -or ($n.patterns -contains 'invoke')
      if (-not $isClicky) { continue }
      $wCss = [math]::Round($n.w / $dpiScale, 1)
      $hCss = [math]::Round($n.h / $dpiScale, 1)
      if ($wCss -lt $MinTargetCss -or $hCss -lt $MinTargetCss) {
        # className 是最可行动的线索（= CSS 里去哪改），优先于 emoji 名称
        $where = if ($n.className) { $n.className } else { "$($n.type)「$($n.name)」" }
        $findings.Add([pscustomobject]@{
          kind     = 'tiny-target'
          selector = $where
          label    = "$($n.type)「$($n.name)」"
          value    = "$($wCss)×$($hCss) css px  ($($n.w)×$($n.h) @${dpiScale}x)"
          wCss     = $wCss
          hCss     = $hCss
          detail   = "真实窗口实测点击热区小于 $MinTargetCss css px"
        }) | Out-Null
      }
    }
    # 最严重的排前面（按"较短边"升序）
    $sorted = $findings | Sort-Object { [math]::Min($_.wCss, $_.hCss) }
    $o = [ordered]@{
      ok = $true; hwnd = $hwnd.ToInt64(); dpi = $dpi; dpiScale = $dpiScale
      nodeCount = $t.count; minTargetCss = $MinTargetCss
      findings = @($sorted)
    }
    $o | ConvertTo-Json -Depth 6
    break
  }

  'click' {
    $t = Get-Tree
    # 找出匹配项的**下标**（要拿回真实 AutomationElement 引用，不能用 POCO）
    $matchIdx = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $t.nodes.Count; $i++) {
      if (Test-Match $t.nodes[$i]) { $matchIdx.Add($i) | Out-Null }
    }
    if ($matchIdx.Count -eq 0) {
      Fail "在真实窗口里找不到匹配元素（Name='$Name' NameContains='$NameContains' ControlType='$ControlType' ClassNameContains='$ClassNameContains' ClassNameNotContains='$ClassNameNotContains' HelpTextContains='$HelpTextContains'）。树里共 $($t.count) 个节点。可用 -Action dump 看全部。"
    }
    if ($Index -ge $matchIdx.Count) { Fail "匹配到 $($matchIdx.Count) 个元素，但索引 $Index 越界（可用 -Index 指定第几个）" }

    $info = $t.nodes[$matchIdx[$Index]]
    $el = $t.elems[$matchIdx[$Index]]
    $cx = [int]($info.x + $info.w / 2)
    $cy = [int]($info.y + $info.h / 2)
    $method = ''
    $ok = $false
    $tried = New-Object System.Collections.ArrayList

    # 优先 InvokePattern（不动光标，最干净）
    try {
      $ip = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      if ($ip) { $ip.Invoke(); $method = 'InvokePattern'; $ok = $true }
    } catch { $tried.Add("invoke: $($_.Exception.Message.Split([char]10)[0])") | Out-Null }

    # 其次 LegacyIAccessible 默认动作
    if (-not $ok) {
      try {
        $lp = $el.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
        if ($lp) { $lp.DoDefaultAction(); $method = 'LegacyIAccessible'; $ok = $true }
      } catch { $tried.Add("legacy: $($_.Exception.Message.Split([char]10)[0])") | Out-Null }
    }

    # 再次 SelectionItemPattern（列表项/标签页）
    if (-not $ok) {
      try {
        $sp = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
        if ($sp) { $sp.Select(); $method = 'SelectionItemPattern'; $ok = $true }
      } catch { $tried.Add("select: $($_.Exception.Message.Split([char]10)[0])") | Out-Null }
    }

    # 最后回退：真鼠标点击（走真实输入管线，会移动光标）
    if (-not $ok -and $AllowSendInput) {
      [W32]::Click($cx, $cy); $method = 'SendInput'; $ok = $true
    }

    if (-not $ok) {
      Fail "元素 '$($info.type)|$($info.name)' 的三种 UIA 模式都不可用（声明支持: $($info.patterns -join ',')）。尝试记录：$($tried -join ' | ')。可加 -AllowSendInput 用真鼠标回退。"
    }

    Start-Sleep -Milliseconds 400
    $o = [ordered]@{
      ok = $true; method = $method
      element = [ordered]@{ type = $info.type; name = $info.name; x = $info.x; y = $info.y; w = $info.w; h = $info.h; depth = $info.depth; patterns = $info.patterns }
      clickAt = @{ x = $cx; y = $cy }
      matchCount = $matchIdx.Count
    }
    $o | ConvertTo-Json -Depth 6 -Compress
    break
  }
}
