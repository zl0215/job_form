<#
.SYNOPSIS
  构建纯浏览器扩展，并把可加载产物同步到仓库根 extension/。

.DESCRIPTION
  - 从 extension-src/ 运行 `npm run build`（tsc -b + vite build + post-build）。
  - 校验产物 manifest.json 的 name/version，确认 content.js 为 classic script。
  - 用 robocopy /MIR 把 extension-src/dist 同步为仓库根 extension/（可加载的 unpacked 扩展目录）。

.PARAMETER SkipBuild
  跳过 npm run build，只做校验和复制（用于已构建产物）。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build_extension.ps1
#>
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'extension-src'
$dist = Join-Path $src 'dist'
$out = Join-Path $root 'extension'

if (-not $SkipBuild) {
    Write-Host "==> npm run build (extension-src)" -ForegroundColor Cyan
    Push-Location $src
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build 失败，exit=$LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $dist 'manifest.json'))) {
    throw "未找到 extension-src/dist/manifest.json；请先运行 npm run build"
}

# ---- 校验构建产物 ----
$manifest = Get-Content (Join-Path $dist 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) { throw "manifest_version 不是 3" }
if (-not $manifest.name) { throw "manifest 缺少 name" }
if (-not $manifest.version) { throw "manifest 缺少 version" }
if ($manifest.name -ne '校招表单助手') { throw "manifest.name 不是 校招表单助手（实际：$($manifest.name)）" }

$contentPath = Join-Path $dist 'content.js'
if (-not (Test-Path $contentPath)) { throw "缺少 dist/content.js" }
$contentText = Get-Content $contentPath -Raw
if ($contentText -match '(?m)^\s*(import|export)\s') {
    throw "dist/content.js 含 ES module import/export，不能作为 content script 加载"
}

foreach ($required in @('background.js', 'icons/icon16.png', 'pdf.worker.min.js')) {
    if (-not (Test-Path (Join-Path $dist $required))) { throw "缺少 dist/$required" }
}

# ---- 同步到 extension/ ----
New-Item -ItemType Directory -Force -Path $out | Out-Null
$null = robocopy $dist $out /MIR /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy 同步失败，exit=$LASTEXITCODE" }

$files = Get-ChildItem $out -Recurse -File
$size = ($files | Measure-Object Length -Sum).Sum
Write-Host ""
Write-Host "构建完成：" -ForegroundColor Green
Write-Host "  manifest : $($manifest.name) v$($manifest.version)"
Write-Host "  输出目录 : $out"
Write-Host "  文件数量 : $($files.Count)"
Write-Host "  总大小   : $([math]::Round($size / 1MB, 2)) MB"
Write-Host ""
Write-Host "下一步：在 Edge/Chrome 扩展管理页加载 $out（加载解压缩的扩展）。" -ForegroundColor Yellow
