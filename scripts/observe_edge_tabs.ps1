#Requires -Version 5.1
<#
.SYNOPSIS
  只读列出本机 Microsoft Edge 窗口及其标签页标题/URL（Windows UI Automation）。

.DESCRIPTION
  仅通过 UI Automation 读取窗口、标签页与地址栏的公开属性：
  - 不点击、不输入、不刷新、不导航、不切换标签页、不关闭任何窗口；
  - 不启动/重启 Edge，不读取用户配置文件内容；
  - 不连接远程调试端口。
  用于在真实页验证前，只读确认用户当前是否打开了目标招聘页。

  已知限制：
  - UI Automation 对 Chromium 标签页只稳定暴露“标题”；逐标签页 URL 不可靠。
    本脚本只在窗口级给出当前标签页地址栏 URL（若可读），其余标签 URL 为 null。
  - 若会话非交互、UIA 被策略禁用或 Edge 未运行，会输出 available=false 并说明原因。

.PARAMETER Format
  输出格式：Json（默认，便于其他脚本消费）或 Text（便于人读）。

.PARAMETER MaxWindows
  最多处理的顶层 Edge 窗口数（默认 20），避免异常环境下遍历过慢。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/observe_edge_tabs.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/observe_edge_tabs.ps1 -Format Text
#>
[CmdletBinding()]
param(
    [ValidateSet('Json', 'Text')]
    [string]$Format = 'Json',
    [ValidateRange(1, 100)]
    [int]$MaxWindows = 20
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$result = [ordered]@{
    available      = $false
    generatedAt    = (Get-Date).ToString('o')
    script         = 'scripts/observe_edge_tabs.ps1'
    mode           = 'read-only UI Automation（无点击/输入/刷新/导航）'
    edgeProcesses  = 0
    windowCount    = 0
    windows        = @()
    limitations    = @(
        'UI Automation 只读取公开属性，不修改浏览器状态。',
        'Chromium/Edge 的标签页元素只稳定暴露标题；逐标签页 URL 通常不可读，仅窗口级给出当前标签页地址栏 URL（若可读）。',
        '本结果只能用于确认“用户是否打开了页面”，不能证明页面内容或扩展已在此页面生效。'
    )
    error          = $null
}

function Write-Result {
    if ($Format -eq 'Json') {
        $result | ConvertTo-Json -Depth 8
    }
    else {
        Write-Host ("Edge 只读标签页观察 @ {0}" -f $result.generatedAt)
        Write-Host ("UI Automation 可用: {0}" -f $result.available)
        if ($result.error) { Write-Host ("错误: {0}" -f $result.error) -ForegroundColor Yellow }
        Write-Host ("Edge 进程数: {0}；顶层窗口数: {1}" -f $result.edgeProcesses, $result.windowCount)
        $index = 0
        foreach ($window in $result.windows) {
            $index += 1
            Write-Host ''
            Write-Host ("[{0}] 窗口: {1}" -f $index, $window.title) -ForegroundColor Cyan
            if ($window.currentUrl) { Write-Host ("    当前标签 URL: {0}" -f $window.currentUrl) }
            else { Write-Host '    当前标签 URL: (不可读取)' }
            foreach ($tab in $window.tabs) {
                $marker = if ($tab.isSelected) { '*' } else { ' ' }
                Write-Host ("    {0} {1}" -f $marker, $tab.title)
            }
        }
        Write-Host ''
        foreach ($limitation in $result.limitations) { Write-Host ("注意: {0}" -f $limitation) -ForegroundColor DarkGray }
    }
}

# ---------- 1. 前置检查：UIA 程序集与 Edge 进程（只读） ----------
try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
}
catch {
    $result.error = "Windows UI Automation 不可用（加载 UIAutomationClient 失败）：$($_.Exception.Message)"
    Write-Result
    exit 0
}

$edgeProcessIds = @()
try {
    $edgeProcessIds = @(Get-Process -Name msedge -ErrorAction Stop | Select-Object -ExpandProperty Id)
}
catch {
    $result.error = '未检测到运行中的 Microsoft Edge 进程（msedge）。'
    $result.edgeProcesses = 0
    Write-Result
    exit 0
}
$result.edgeProcesses = $edgeProcessIds.Count
if ($edgeProcessIds.Count -eq 0) {
    $result.error = '未检测到运行中的 Microsoft Edge 进程（msedge）。'
    Write-Result
    exit 0
}
$edgeProcessIdSet = [System.Collections.Generic.HashSet[int]]::new()
foreach ($processId in $edgeProcessIds) { [void]$edgeProcessIdSet.Add([int]$processId) }

# ---------- 2. 枚举 Edge 顶层窗口（只读） ----------
try {
    $rootElement = [System.Windows.Automation.AutomationElement]::RootElement
    $windowCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Window
    )
    $windowElements = $rootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
}
catch {
    $result.error = "枚举顶层窗口失败：$($_.Exception.Message)"
    Write-Result
    exit 0
}

$windows = [System.Collections.Generic.List[object]]::new()
$processed = 0
foreach ($windowElement in $windowElements) {
    if ($processed -ge $MaxWindows) { break }
    $elementProcessId = 0
    try {
        $elementProcessId = [int]$windowElement.Current.ProcessId
    }
    catch {
        continue
    }
    if (-not $edgeProcessIdSet.Contains($elementProcessId)) { continue }
    $processed += 1

    $windowTitle = ''
    $windowBounds = $null
    try { $windowTitle = [string]$windowElement.Current.Name } catch { $windowTitle = '' }
    try {
        $rect = $windowElement.Current.BoundingRectangle
        if ($rect -and -not $rect.IsEmpty) {
            $windowBounds = [ordered]@{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height }
        }
    }
    catch { $windowBounds = $null }

    # 标签页：只读 ControlType.TabItem 的 Name；Selected 状态用 SelectionItemPattern 读取。
    $tabs = [System.Collections.Generic.List[object]]::new()
    try {
        $tabCondition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::TabItem
        )
        $tabElements = $windowElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
        foreach ($tabElement in $tabElements) {
            $tabTitle = ''
            try { $tabTitle = [string]$tabElement.Current.Name } catch { $tabTitle = '' }
            $isSelected = $null
            try {
                $selectionPattern = $tabElement.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                $isSelected = [bool]$selectionPattern.Current.IsSelected
            }
            catch { $isSelected = $null }
            $tabs.Add([ordered]@{
                title      = $tabTitle
                isSelected = $isSelected
                url        = $null
            })
        }
    }
    catch {
        # 单个窗口读取失败不致命
    }

    # 当前标签 URL：只读地址栏（Edit/ValuePattern）；Chromium 只在窗口级暴露当前页 URL。
    $currentUrl = $null
    try {
        $editCondition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit
        )
        $editElements = $windowElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
        $addressBarNames = @('地址和搜索栏', 'Address and search bar', 'Address bar', '搜索或输入网址')
        foreach ($editElement in $editElements) {
            try {
                $editName = [string]$editElement.Current.Name
                if ($addressBarNames -notcontains $editName) { continue }
                $valuePattern = $editElement.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                $value = [string]$valuePattern.Current.Value
                if (-not [string]::IsNullOrWhiteSpace($value)) { $currentUrl = $value; break }
            }
            catch { continue }
        }
    }
    catch { $currentUrl = $null }

    # 若标签页读取为空，至少用窗口标题作为唯一标签提示（避免误报窗口无标签）。
    $windows.Add([ordered]@{
        title      = $windowTitle
        bounds     = $windowBounds
        tabs       = @($tabs)
        currentUrl = $currentUrl
    })
}

$result.windowCount = $windows.Count
$result.windows = @($windows)
$result.available = $true
if ($windows.Count -eq 0) {
    $result.error = '未找到可读取的 Edge 顶层窗口（Edge 进程存在但窗口不可访问，可能已最小化到托盘或会话非交互）。'
}

Write-Result
