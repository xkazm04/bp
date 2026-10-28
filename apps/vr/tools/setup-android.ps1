# The Android toolchain for packaging bp's VR app for Quest (docs/concepts/vr-light-table/standalone-plan.md, S2), without
# Android Studio. Built for Lynx (Windows 11 ARM64), where Google ships no Windows ARM64 Android Studio, SDK or NDK:
#   JDK        Microsoft Build of OpenJDK 21, the native windows-aarch64 zip (Gradle runs natively)
#   SDK        Google's command-line tools, then their `android sdk install` (the CLI that replaced sdkmanager in 2026;
#              it names packages with / where sdkmanager used ;) installs the versions UE 5.8 pins in
#              Engine/Config/Android/Android_SDK.json: platform-tools, platforms/android-36, build-tools/36.0.0,
#              cmake/3.22.1, ndk/27.2.12479018 (r27c). These Windows host binaries are x64 and run under Prism
#              emulation, as the UE editor already does on Lynx.
# Works the same on x64 Windows (pass -JdkArch x64). The owner allowed the install and the SDK licences on 2026-10-27.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/setup-android.ps1 [-DryRun] [-JdkArch aarch64|x64]
#
# Installs into %LOCALAPPDATA%\Android\Sdk and %LOCALAPPDATA%\Programs\microsoft-jdk-21 (no admin), checks each download
# against the pinned hash below, and sets ANDROID_HOME, JAVA_HOME, NDKROOT and NDK_ROOT for the user (what UE's
# SetupAndroid.bat sets). Safe to re-run: a present piece is skipped. Exit 0 done; 1 a step failed.
param(
    [switch]$DryRun,
    # The machine's own architecture: an emulated x64 shell sees AMD64 in PROCESSOR_ARCHITECTURE, the real one in the registry
    [ValidateSet('aarch64', 'x64')][string]$JdkArch = $(if ((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x64' })
)
$ErrorActionPreference = 'Stop'

$Sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$JdkDir = Join-Path $env:LOCALAPPDATA 'Programs\microsoft-jdk-21'
$Cache = Join-Path (Split-Path -Parent $PSScriptRoot) '.cache\android'
$Packages = @('platform-tools', 'platforms/android-36', 'build-tools/36.0.0', 'cmake/3.22.1', 'ndk/27.2.12479018')
$Ndk = Join-Path $Sdk 'ndk\27.2.12479018'

# name -> url, algorithm, hash (Google's repository2-3.xml sha1; Microsoft's published sha256sum)
$Downloads = @{
    'cmdline-tools' = @{ Url = 'https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip'; Alg = 'SHA1'; Hash = '57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d' }
    'jdk-aarch64'   = @{ Url = 'https://aka.ms/download-jdk/microsoft-jdk-21.0.13.0.2-windows-aarch64.zip'; Alg = 'SHA256'; Hash = '9c1f36b1660d97ab228787294433eefaaad3e3e8963bdd3cf975b02171137ecc' }
    'jdk-x64'       = @{ Url = 'https://aka.ms/download-jdk/microsoft-jdk-21.0.13.0.2-windows-x64.zip'; Alg = 'SHA256'; Hash = 'c5706a9cf482ef1a0622a86eea5b13d557b07f04554572af061e2d02b58c0f99' }
}

function Step($msg) { Write-Host "== $msg" }

function Fetch($name) {
    $d = $Downloads[$name]
    $zip = Join-Path $Cache ([IO.Path]::GetFileName($d.Url))
    if ($DryRun) { Write-Host "would download $($d.Url) -> $zip"; return $zip }
    New-Item -ItemType Directory -Force $Cache | Out-Null
    if (-not (Test-Path $zip)) { & curl.exe -sSfL -o $zip $d.Url; if ($LASTEXITCODE) { throw "download failed: $($d.Url)" } }
    $got = (Get-FileHash $zip -Algorithm $d.Alg).Hash.ToLower()
    if (-not $d.Hash) { throw "$name has no pinned hash yet ($($d.Alg) of the download is $got); pin it in this script first" }
    if ($got -ne $d.Hash) { Remove-Item $zip; throw "$name $($d.Alg) mismatch: got $got, pinned $($d.Hash)" }
    return $zip
}

function Unpack($zip, $dest) {
    if ($DryRun) { Write-Host "would extract $zip -> $dest"; return }
    $tmp = "$dest.extract"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive $zip $tmp
    $inner = @(Get-ChildItem $tmp)
    $src = if ($inner.Count -eq 1 -and $inner[0].PSIsContainer) { $inner[0].FullName } else { $tmp }
    New-Item -ItemType Directory -Force (Split-Path -Parent $dest) | Out-Null
    Move-Item $src $dest
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}

try {
    Step "JDK 21 ($JdkArch) at $JdkDir"
    if (Test-Path (Join-Path $JdkDir 'bin\java.exe')) { Write-Host 'present' } else { Unpack (Fetch "jdk-$JdkArch") $JdkDir }

    $tools = Join-Path $Sdk 'cmdline-tools\latest'
    Step "Android command-line tools at $tools"
    if (Test-Path (Join-Path $tools 'bin\android.exe')) { Write-Host 'present' } else { Unpack (Fetch 'cmdline-tools') $tools }

    Step "android sdk install: $($Packages -join ', ')"
    if ($DryRun) { Write-Host 'would install the packages (the CLI accepts the SDK licence; the owner allowed it)' }
    else {
        $env:JAVA_HOME = $JdkDir
        & (Join-Path $tools 'bin\android.exe') --sdk=$Sdk sdk install @Packages
        if ($LASTEXITCODE) { throw "android sdk install exited $LASTEXITCODE" }
        if (-not (Test-Path (Join-Path $Ndk 'source.properties'))) { throw "the NDK is not at $Ndk after sdkmanager" }
    }

    Step 'user environment: ANDROID_HOME, JAVA_HOME, NDKROOT, NDK_ROOT, PATH += platform-tools'
    $vars = @{ ANDROID_HOME = $Sdk; JAVA_HOME = $JdkDir; NDKROOT = $Ndk; NDK_ROOT = $Ndk }
    foreach ($k in $vars.Keys) {
        if ($DryRun) { Write-Host "would set $k=$($vars[$k])" } else { [Environment]::SetEnvironmentVariable($k, $vars[$k], 'User') }
    }
    $pt = Join-Path $Sdk 'platform-tools'
    $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
    if (($userPath -split ';') -notcontains $pt) {
        if ($DryRun) { Write-Host "would add $pt to the user PATH" } else { [Environment]::SetEnvironmentVariable('PATH', "$userPath;$pt", 'User') }
    }
    Step 'done: restart the editor (start-editor.ps1) so it reads the new environment'
    exit 0
}
catch {
    Write-Host "FAILED: $($_.Exception.Message)"
    exit 1
}
