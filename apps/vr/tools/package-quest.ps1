# Package bp's VR app as a Quest APK (docs/concepts/vr-light-table/standalone-plan.md, S5): build, cook (ASTC), stage, pak
# and package for Android arm64, archived to apps/vr/.cache/quest (git-ignored). Needs setup-android.ps1 first.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/package-quest.ps1 [-Config Development|Shipping] [-Install]
#
# The environment is start-editor.ps1's (the bundled win-x64 .NET for UBT on ARM64) plus the user's ANDROID_HOME,
# JAVA_HOME and NDKROOT, read from the registry so a shell opened before setup-android.ps1 still sees them. -Install
# runs adb install -r on the one connected headset. The full UAT log is apps/vr/.cache/quest/uat.log.
# Exit: UAT's exit code; 2 refused (no toolchain).
param(
    [ValidateSet('Development', 'Shipping', 'DebugGame')][string]$Config = 'Development',
    [switch]$Install
)
$ErrorActionPreference = 'Stop'

$VrRoot = Split-Path -Parent $PSScriptRoot
$Engine = if ($env:UE_ROOT) { $env:UE_ROOT } else { 'C:\Program Files\Epic Games\UE_5.8' }
$Out = Join-Path $VrRoot '.cache\quest'

foreach ($k in 'ANDROID_HOME', 'JAVA_HOME', 'NDKROOT') {
    $v = [Environment]::GetEnvironmentVariable($k, 'User')
    if (-not $v -or -not (Test-Path $v)) { Write-Host "REFUSED: $k is not set; run apps/vr/tools/setup-android.ps1"; exit 2 }
    Set-Item "env:$k" $v
}
$env:NDK_ROOT = $env:NDKROOT
$dotnetDir = Join-Path $Engine 'Engine\Binaries\ThirdParty\DotNet\10.0\win-x64'
$env:UE_DOTNET_VERSION = '10.0'
$env:UE_DOTNET_ARCH = 'win-x64'
$env:DOTNET_ROOT = $dotnetDir
$env:DOTNET_MULTILEVEL_LOOKUP = '0'
$env:DOTNET_ROLL_FORWARD = 'LatestMajor'
$env:PATH = "$dotnetDir;$(Join-Path $env:ANDROID_HOME 'platform-tools');$env:PATH"

New-Item -ItemType Directory -Force $Out | Out-Null
$log = Join-Path $Out 'uat.log'
$uat = Join-Path $Engine 'Engine\Build\BatchFiles\RunUAT.bat'
$project = Join-Path $VrRoot 'bp.uproject'
Write-Host "packaging $Config for Android (ASTC) -> $Out; log $log"
# Start-Process's redirect keeps the log in UAT's UTF-8 (PowerShell 5.1's Tee-Object writes UTF-16)
$uatArgs = "BuildCookRun `"-project=$project`" -platform=Android -cookflavor=ASTC -clientconfig=$Config -build -cook -stage -pak -package -archive `"-archivedirectory=$Out`" -unattended -utf8output -nop4 -ubtargs=-NoUBA"
# -NoUBA: on Lynx (ARM64) the NDK's x64 ld.lld crashes (0xc0000374, heap corruption) when UBA's executor detours it under
# Prism emulation; UBT's plain local executor links it.
# WaitForExit, not -Wait: -Wait also waits for every descendant, and UAT leaves an adb server running.
$p = Start-Process -FilePath $uat -ArgumentList $uatArgs -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru
$p.WaitForExit()
$code = $p.ExitCode
Select-String -Path $log, "$log.err" -Pattern 'BUILD (SUCCESSFUL|FAILED)|Error:|error:|AutomationTool exiting' | ForEach-Object { $_.Line }
if ($code -eq 0) {
    $apk = Get-ChildItem $Out -Recurse -Filter *.apk | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Write-Host "APK=$($apk.FullName) ($([math]::Round($apk.Length / 1MB)) MB)"
    if ($Install) { & adb install -r $apk.FullName; $code = $LASTEXITCODE }
}
exit $code
