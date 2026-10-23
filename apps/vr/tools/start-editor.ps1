# Start the UE 5.8 editor on Lynx (Windows on ARM64) so that its own UnrealBuildTool calls work.
#
# Why: Build.bat and RunUAT.bat call Engine/Build/BatchFiles/GetDotnetPath.bat, which picks the bundled
# DotNet/10.0/win-arm64 on an ARM64 host. The installed build ships only win-x64, so every editor-driven UBT call fails:
# the New Project dialog's "-projectfiles" step dies after copying the template, and the editor then rolls the new
# project back (2026-10-23, Lynx: "An error occurred while trying to generate project files", Documents/Unreal Projects
# left empty). GetDotnetPath.bat skips its arch choice when UE_DOTNET_VERSION is already 10.0, so this script sets that
# and puts the bundled win-x64 dotnet first on PATH for the editor process and its children only. UBT then runs as an
# emulated x64 process, the same route scripts/uht-probe.mjs and every Lynx build reading use (machine.md). Nothing in
# the engine, the registry or the user's environment is changed.
#
#   apps/vr/tools/start-editor.ps1                    # editor with the project browser (New Project)
#   apps/vr/tools/start-editor.ps1 -Project <path>    # editor on a .uproject (default: apps/vr/bp.uproject if present)
#   apps/vr/tools/start-editor.ps1 -EnvOnly           # print the environment lines and start nothing
#
# Exit 0 started (or printed), 2 refused.
param(
    [string]$Engine = 'C:\Program Files\Epic Games\UE_5.8',
    [string]$Project = '',
    [switch]$EnvOnly
)
$ErrorActionPreference = 'Stop'

$editor = Join-Path $Engine 'Engine\Binaries\Win64\UnrealEditor.exe'
$dotnetDir = Join-Path $Engine 'Engine\Binaries\ThirdParty\DotNet\10.0\win-x64'
foreach ($required in @($editor, (Join-Path $dotnetDir 'dotnet.exe'))) {
    if (-not (Test-Path -LiteralPath $required)) {
        Write-Host "REFUSED: $required is missing; this needs a UE 5.8 install with the bundled win-x64 dotnet."
        exit 2
    }
}

if (-not $Project) {
    $default = Join-Path (Split-Path -Parent $PSScriptRoot) 'bp.uproject'
    if (Test-Path -LiteralPath $default) { $Project = $default }
} elseif (-not (Test-Path -LiteralPath $Project)) {
    Write-Host "REFUSED: $Project does not exist."
    exit 2
}

$env:UE_DOTNET_VERSION = '10.0'
$env:UE_DOTNET_ARCH = 'win-x64'
$env:DOTNET_ROOT = $dotnetDir
$env:PATH = "$dotnetDir;$env:PATH"
$env:DOTNET_MULTILEVEL_LOOKUP = '0'
$env:DOTNET_ROLL_FORWARD = 'LatestMajor'

Write-Host "UE_DOTNET=$dotnetDir (win-x64, emulated on ARM64; for this process tree only)"
if ($EnvOnly) { exit 0 }

$editorArgs = @()
if ($Project) { $editorArgs += "`"$Project`"" }
Write-Host ("EDITOR=$editor " + ($editorArgs -join ' '))
if ($editorArgs.Count -gt 0) { Start-Process -FilePath $editor -ArgumentList $editorArgs }
else { Start-Process -FilePath $editor }
exit 0
