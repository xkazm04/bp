# Creates the one path bp's editor has to pof's MCP toolset (2026-10-23, Lynx; spark vr-table):
#   apps/vr/Plugins/PoFToolset  ->  <kiro>/pof/ue/PoFToolset
# PoFToolset is a content-only Python plugin that registers extra tools with UE 5.8's Toolset Registry, so the editor's
# MCP server exposes them: capture_viewport (the L3.2 proof capture) and run_python (unsandboxed code mode). bp.uproject
# enables it for the Editor target only. The plugin stays in the pof checkout, never copied; the junction is machine
# state and git-ignored. Run this once per checkout, before opening the project (the .uproject requires the plugin).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/link-pof-toolset.ps1 [-PofRoot <path>]
#
# Idempotent. Exit 0: the junction is in place (created now, or already pointing at the target).
# Exit 2: refused, nothing changed (PoFToolset exists as something else, or the pof checkout is missing).
# Prints one line: POF_TOOLSET_JUNCTION=<link> -> <target> (created | already present).
param([string]$PofRoot = '')
$ErrorActionPreference = 'Stop'

# This file is apps\vr\tools\link-pof-toolset.ps1, so the repo root is three up from its folder, and pof is its sibling.
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
if (-not $PofRoot) { $PofRoot = Join-Path (Split-Path -Parent $RepoRoot) 'pof' }
$Link = Join-Path $RepoRoot 'apps\vr\Plugins\PoFToolset'
$Target = Join-Path $PofRoot 'ue\PoFToolset'

function Get-NormalPath([string]$Path) {
    $p = $Path
    if ($p.StartsWith('\??\')) { $p = $p.Substring(4) }
    return [System.IO.Path]::GetFullPath($p).TrimEnd('\')
}

if (-not (Test-Path -LiteralPath (Join-Path $Target 'PoFToolset.uplugin'))) {
    Write-Host "REFUSED: $Target has no PoFToolset.uplugin; check out pof beside bp (or pass -PofRoot) before linking."
    exit 2
}

# A dangling junction answers False to Test-Path, so look for the entry in its parent instead.
$parent = Split-Path -Parent $Link
$leaf = Split-Path -Leaf $Link
$entry = $null
if (Test-Path -LiteralPath $parent) {
    $entry = Get-ChildItem -LiteralPath $parent -Force | Where-Object { $_.Name -eq $leaf } | Select-Object -First 1
}

if ($null -ne $entry) {
    $isReparse = ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
    if (-not $isReparse) {
        Write-Host "REFUSED: $Link is a real directory or file, not a junction. Move it aside yourself, then re-run."
        exit 2
    }
    $current = @($entry.Target) | Select-Object -First 1
    if ([string]$entry.LinkType -ne 'Junction' -or [string]::IsNullOrEmpty($current) -or (Get-NormalPath $current) -ne (Get-NormalPath $Target)) {
        Write-Host "REFUSED: $Link is not a junction to $Target. Remove it with: cmd /c rmdir `"$Link`" (removes the link only), then re-run."
        exit 2
    }
    Write-Host "POF_TOOLSET_JUNCTION=$Link -> $Target (already present)"
    exit 0
}

New-Item -ItemType Directory -Force -Path $parent | Out-Null
try {
    New-Item -ItemType Junction -Path $Link -Target $Target | Out-Null
} catch {
    & cmd.exe /d /c mklink /J "$Link" "$Target" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "REFUSED: could not create the junction $Link -> $Target (New-Item: $($_.Exception.Message); mklink exit $LASTEXITCODE)."
        exit 2
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $Link 'PoFToolset.uplugin'))) {
    Write-Host "REFUSED: created $Link but PoFToolset.uplugin is not readable through it; remove it with: cmd /c rmdir `"$Link`""
    exit 2
}
Write-Host "POF_TOOLSET_JUNCTION=$Link -> $Target (created)"
exit 0
