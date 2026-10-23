# Creates the one path BpLink has to the generated USTRUCT headers (2026-10-23, Lynx; R1 closed: junction only):
#   apps/vr/Source/BpLink/Public/Schema  ->  packages/schema/generated/ue
# BpLink includes them as "Schema/BpSchema.h" and "Schema/BpSchemaFixups.h", the spelling UHT's generated code uses, and
# Public/ is already on the module's include path, so BpLink.Build.cs adds no path of its own (two paths to one file broke
# #pragma once, docs/concepts/vr-light-table/machine.md readings 4-5). The headers stay in packages/schema, never copied.
# The junction is machine state and git-ignored; run this once per checkout, before the first UE build.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/link-schema.ps1
#
# Idempotent. Exit 0: the junction is in place (created now, or already pointing at the target).
# Exit 2: refused, nothing changed (Schema exists as something else, or the target is missing).
# Prints one line: SCHEMA_JUNCTION=<link> -> <target> (created | already present).
# scripts/check-bplink.mjs reads $LinkRel and $TargetRel out of this file; keep them single-quoted literals.
$ErrorActionPreference = 'Stop'

$LinkRel = 'apps\vr\Source\BpLink\Public\Schema'
$TargetRel = 'packages\schema\generated\ue'

# This file is apps\vr\tools\link-schema.ps1, so the repo root is three up from its folder.
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$Link = Join-Path $RepoRoot $LinkRel
$Target = Join-Path $RepoRoot $TargetRel

function Get-NormalPath([string]$Path) {
    $p = $Path
    if ($p.StartsWith('\??\')) { $p = $p.Substring(4) }
    return [System.IO.Path]::GetFullPath($p).TrimEnd('\')
}

if (-not (Test-Path -LiteralPath (Join-Path $Target 'BpSchema.h'))) {
    Write-Host "REFUSED: $Target has no BpSchema.h; regenerate it (node packages/schema/generate.mjs) before linking."
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
        Write-Host "REFUSED: $Link is a real directory or file, not a junction. Move it aside yourself (it may hold copies of the headers), then re-run."
        exit 2
    }
    $linkType = [string]$entry.LinkType
    $current = @($entry.Target) | Select-Object -First 1
    if ($linkType -ne 'Junction' -or [string]::IsNullOrEmpty($current)) {
        Write-Host "REFUSED: $Link is a $linkType reparse point, not a junction to $Target. Remove it with: cmd /c rmdir `"$Link`" (removes the link only), then re-run."
        exit 2
    }
    if ((Get-NormalPath $current) -ne (Get-NormalPath $Target)) {
        Write-Host "REFUSED: $Link is a junction to $current, not $Target. Remove it with: cmd /c rmdir `"$Link`" (removes the link only), then re-run."
        exit 2
    }
    Write-Host "SCHEMA_JUNCTION=$Link -> $Target (already present)"
    exit 0
}

if (-not (Test-Path -LiteralPath $parent)) {
    Write-Host "REFUSED: $parent does not exist; this script expects the BpLink module at apps\vr\Source\BpLink."
    exit 2
}

try {
    New-Item -ItemType Junction -Path $Link -Target $Target | Out-Null
} catch {
    # Fallback for a host whose New-Item cannot make junctions; mklink /J needs no elevation.
    & cmd.exe /d /c mklink /J "$Link" "$Target" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "REFUSED: could not create the junction $Link -> $Target (New-Item: $($_.Exception.Message); mklink exit $LASTEXITCODE)."
        exit 2
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $Link 'BpSchema.h'))) {
    Write-Host "REFUSED: created $Link but BpSchema.h is not readable through it; remove it with: cmd /c rmdir `"$Link`""
    exit 2
}
Write-Host "SCHEMA_JUNCTION=$Link -> $Target (created)"
exit 0
