# Repeatable Meta XR v207 setup for bp's VR client (apps/vr). Lynx only (Windows 11 ARM64, UE 5.8.4 at
# C:\Program Files\Epic Games\UE_5.8, editor emulated x64); PC quality bar, no Android/APK. No credentials. Safe to re-run.
# Adapted 2026-10-23 from mage-arena's apps/vr/tools/install-xr.ps1 (route R-A, its docs/XR-TOOLCHAIN.md): same official
# pages, pinned SHA-256 table, OWNER_ACTION refusals and BuildId report; the Android SDK/NDK/JDK half is gone.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/install-xr.ps1 [-DryRun] [-PluginsOnly | -SimulatorOnly]
#
# Steps (a full run does all three, and refuses before any of them if apps/vr/bp.uproject does not exist):
#   plugins    Meta XR v207 (OculusXR) and the Meta Interaction SDK v207 (OculusInteraction) from Meta's official download
#              pages, curl.exe into apps/vr/.cache/xr, SHA-256 checked against the table below, extracted into
#              apps/vr/Plugins/MetaXR and apps/vr/Plugins/MetaXRInteraction (all git-ignored), then the plugin BuildId is
#              compared with the engine's CompatibleChangelist
#   project    adds OculusXR and OculusInteraction to bp.uproject's Plugins ("Enabled": true, "Optional": true), keeping
#              the rest of the file as it is
#   simulator  Meta XR Simulator v207, extracted (msiexec /a, an administrative image: no install, no registry) under
#              %LOCALAPPDATA%\MetaXRSimulatorExtract, and its runtime json printed as SIMULATOR_JSON=. Point ONE process at it
#              with $env:XR_RUNTIME_JSON. This script never runs activate_simulator.ps1 and never writes
#              HKLM\SOFTWARE\Khronos\OpenXR\1 (that is the machine-wide OpenXR runtime; a headset over Link needs it).
# -PluginsOnly    the plugins step alone; touches no project and no simulator (works before bp.uproject exists)
# -SimulatorOnly  the simulator step alone
# -DryRun         prints every action it would take and writes nothing: no network, no download, no extract, no edit
#
# Exit codes: 0 done (or, with -DryRun, nothing in the way); 1 a step failed; 2 refused before doing anything;
# 3 OWNER_ACTION: a step needs the owner (a login or licence wall, or an archive whose SHA-256 is not pinned yet).
# Never logs in, never clicks through a licence: those are the owner's.
param(
    [switch]$DryRun,
    [switch]$PluginsOnly,
    [switch]$SimulatorOnly
)
$ErrorActionPreference = 'Stop'

$script:VrRoot = Split-Path -Parent $PSScriptRoot
$script:PluginsDir = Join-Path $script:VrRoot 'Plugins'
$script:CacheDir = Join-Path $script:VrRoot '.cache\xr'
$script:Uproject = Join-Path $script:VrRoot 'bp.uproject'
$script:EngineRoot = 'C:\Program Files\Epic Games\UE_5.8'
$script:SimulatorExtractRoot = Join-Path $env:LOCALAPPDATA 'MetaXRSimulatorExtract'
$script:SimulatorDir = Join-Path $script:SimulatorExtractRoot 'PFiles\MetaXRSimulator\v207.0'
$script:SimulatorJson = Join-Path $script:SimulatorDir 'meta_openxr_simulator.json'
$script:IsDry = $DryRun.IsPresent
$script:OwnerActions = @()

$script:IntegrationPage = 'https://developers.meta.com/horizon/downloads/package/unreal-engine-5-integration/'
$script:InteractionPage = 'https://developers.meta.com/horizon/downloads/package/meta-xr-interaction-sdk-unreal/'
$script:SimulatorPage = 'https://developers.meta.com/horizon/downloads/package/meta-xr-simulator-windows/'

# SHA-256 of the Meta v207 archives. The two plugin zips were downloaded and verified on 2026-10-03 (mage-arena route R-A,
# docs/XR-TOOLCHAIN.md). An empty value is a name this script expects but has NOT pinned: it refuses with OWNER_ACTION
# before downloading anything. meta_xr_simulator_v207.0.msi: on 2026-10-23 $script:SimulatorPage published it as an open
# download (no login; 436768768 bytes), but no SHA-256 was ever recorded for it (mage-arena's copy was extracted by hand),
# so pinning it is the owner's deliberate step. A new Meta release is a deliberate re-pin, never an automatic acceptance.
$script:PinnedSha256 = @{
    'UnrealMetaXRPlugin.207.0.zip'         = 'f946093b66cc6682887ad2a5b0b12e2880b48d65a068f7dc84dc22a67aed43a8'
    'MetaXRInteractionPackage.207.0.0.zip' = '8a1dc65ca8ded1dcdc0efead8e6545f7ae19e201564332620a72258e325d6c9f'
    'meta_xr_simulator_v207.0.msi'         = ''
}

function Write-Plan([string]$Text) {
    Write-Host "PLAN $Text"
}

function Stop-ForOwner([string]$Text) {
    # Collected, not thrown, in a dry run, so the plan still prints to the end.
    if ($script:IsDry) {
        $script:OwnerActions += $Text
        Write-Host "OWNER_ACTION (the real run stops here): $Text"
        return
    }
    throw "OWNER_ACTION: $Text"
}

function Get-LastCurlStatus([string]$HeaderText) {
    $blocks = @($HeaderText -split '(?=HTTP/)' | Where-Object { $_ -match 'HTTP/' })
    if ($blocks.Count -eq 0) { return $HeaderText }
    return $blocks[-1]
}

function Get-PinnedName([string]$FilePattern) {
    foreach ($name in $script:PinnedSha256.Keys) {
        if ($name -match $FilePattern) { return $name }
    }
    return $null
}

function Get-MetaPackage([string]$PageUrl, [string]$FilePattern) {
    if ($script:IsDry) {
        $expected = Get-PinnedName $FilePattern
        Write-Plan "fetch $PageUrl with curl.exe -fsSL -L --retry 3 into $script:CacheDir and pick the downloadable file matching $FilePattern"
        if (-not $expected) {
            Stop-ForOwner "no name in PinnedSha256 matches $FilePattern; verify the release on $PageUrl and pin it deliberately."
            return $null
        }
        $hash = $script:PinnedSha256[$expected]
        Write-Plan "refuse unless the page names a pinned archive (expected $expected)"
        $zipPath = Join-Path $script:CacheDir $expected
        if (-not $hash) {
            Stop-ForOwner "$expected has no pinned SHA-256. Download it from $PageUrl yourself (accept the Oculus SDK licence there if Meta asks), check it (Get-AuthenticodeSignature for an .msi), put it at $zipPath and pin its SHA-256 in PinnedSha256 in this script. This script will not pin a hash it has not been given."
            return [pscustomobject]@{ Zip = $zipPath; FileName = $expected; Pinned = $false }
        }
        Write-Plan "HEAD the CDN uri the page gives; OWNER_ACTION on a Meta login, a non-200 answer or an HTML body (never logs in or clicks through)"
        if (Test-Path -LiteralPath $zipPath) {
            $have = (Get-Item -LiteralPath $zipPath).Length
            Write-Plan "reuse the cached $zipPath ($have bytes) if its size equals the CDN's Content-Length, else re-download it"
            $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -eq $hash) { Write-Host "DRYRUN_SHA256_OK=$expected (cached copy)" }
            else { Write-Host "DRYRUN_SHA256_MISMATCH=$expected got $actual pinned $hash (the real run refuses it)" }
        } else {
            Write-Plan "download: curl.exe -fL --retry 3 --retry-delay 2 -o $zipPath <uri>"
        }
        Write-Plan "verify SHA-256 of $zipPath equals $hash, else refuse"
        return [pscustomobject]@{ Zip = $zipPath; FileName = $expected; Pinned = $true }
    }

    New-Item -ItemType Directory -Force -Path $script:CacheDir | Out-Null
    $safeName = ($FilePattern -replace '[^A-Za-z0-9]+', '_')
    $htmlPath = Join-Path $script:CacheDir ($safeName + '.html')
    & curl.exe -fsSL -L --retry 3 --retry-delay 2 -o $htmlPath $PageUrl
    if ($LASTEXITCODE -ne 0) { throw "Could not read the official download page $PageUrl (curl $LASTEXITCODE)." }
    $html = [System.IO.File]::ReadAllText($htmlPath)
    $regex = [regex]('"is_downloadable":true,"file_name":"(?<file>[^"]+)","license_info":\{"path":"(?<licpath>[^"]+)","id":"(?<licid>[^"]+)"\},"uri":"(?<uri>[^"]+)"')
    $match = $null
    foreach ($candidate in $regex.Matches($html)) {
        if ($candidate.Groups['file'].Value -match $FilePattern) {
            $match = $candidate
            break
        }
    }
    if ($null -eq $match) {
        Stop-ForOwner "the official page $PageUrl did not publish a downloadable $FilePattern package. Open it and download the v207 file by hand if Meta now requires a login."
    }
    $fileName = $match.Groups['file'].Value
    # The name comes from the web page and becomes the download path, so it must be a pinned name before curl writes
    # anything; the SHA-256 check below runs only after the download.
    if (-not $script:PinnedSha256.ContainsKey($fileName)) {
        throw "The official page names $fileName, which is not a pinned archive. Verify the new release and add it to PinnedSha256 deliberately."
    }
    $zipPath = Join-Path $script:CacheDir $fileName
    $expected = $script:PinnedSha256[$fileName]
    if (-not $expected) {
        Stop-ForOwner "$fileName has no pinned SHA-256. Download it from $PageUrl yourself (accept the Oculus SDK licence there if Meta asks), check it (Get-AuthenticodeSignature for an .msi), put it at $zipPath and pin its SHA-256 in PinnedSha256 in this script. This script will not pin a hash it has not been given."
    }
    $uri = ($match.Groups['uri'].Value -replace '\\/', '/')
    $licensePath = $match.Groups['licpath'].Value
    $licenseId = $match.Groups['licid'].Value
    Write-Host "META_PAGE=$PageUrl"
    Write-Host "META_FILE=$fileName"
    Write-Host "META_LICENSE=$licensePath id=$licenseId"
    $headerText = (& curl.exe -sI -L --max-redirs 8 $uri | Out-String)
    $status = Get-LastCurlStatus $headerText
    if ($headerText -match '(?i)accounts\.meta|facebook\.com/login|oculus\.com/login|Log in to download') {
        Stop-ForOwner "$PageUrl now requires a Meta login before the v207 download. Log in with the owner's Meta developer account and download $fileName to $zipPath. This script does not log in."
    }
    if ($status -notmatch 'HTTP/\S+\s+200') {
        Stop-ForOwner "the official CDN did not return $fileName (last status block follows). If this is a licence or login wall, open $PageUrl and accept the Oculus SDK licence ($licensePath id $licenseId), then re-run.`n$status"
    }
    if ($status -match '(?i)Content-Type:\s*text/html') {
        Stop-ForOwner "the CDN returned HTML instead of $fileName. Open $PageUrl, accept the Oculus SDK licence if Meta asks ($licensePath id $licenseId), and re-run. This script will not click through a login."
    }
    $length = 0L
    $lengthMatch = [regex]::Match($status, '(?i)Content-Length:\s*(\d+)')
    if ($lengthMatch.Success) { $length = [int64]$lengthMatch.Groups[1].Value }
    $have = 0L
    if (Test-Path -LiteralPath $zipPath) { $have = (Get-Item -LiteralPath $zipPath).Length }
    if ($length -gt 0 -and $have -eq $length) {
        Write-Host "CACHE_HIT=$zipPath bytes=$have"
    } else {
        Write-Host "DOWNLOAD=$uri -> $zipPath"
        & curl.exe -fL --retry 3 --retry-delay 2 -o $zipPath $uri
        if ($LASTEXITCODE -ne 0) { throw "Download failed for $fileName (curl $LASTEXITCODE)." }
        $have = (Get-Item -LiteralPath $zipPath).Length
        if ($length -gt 0 -and $have -ne $length) {
            throw "Downloaded $fileName is $have bytes; the CDN advertised $length."
        }
        Write-Host "DOWNLOADED=$zipPath bytes=$have"
    }
    # Integrity: the archive must match the pinned SHA-256. A size match alone proves nothing about content.
    $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "SHA-256 mismatch for $fileName : got $actual, pinned $expected. Delete the file and investigate before re-running." }
    Write-Host "SHA256_OK=$fileName"
    return [pscustomobject]@{ Zip = $zipPath; FileName = $fileName; Pinned = $true }
}

function Test-PluginPresent([string]$FolderName, [string]$UpluginName) {
    $dest = Join-Path $script:PluginsDir $FolderName
    $uplugin = Join-Path $dest $UpluginName
    $modules = Join-Path $dest 'Binaries\Win64\UnrealEditor.modules'
    if ((Test-Path -LiteralPath $uplugin) -and (Test-Path -LiteralPath $modules)) {
        $text = [System.IO.File]::ReadAllText($uplugin)
        if ($text -match '"VersionName"\s*:\s*"1\.207\.0"' -and $text -match '"EngineVersion"\s*:\s*"5\.8\.0"') {
            return $true
        }
    }
    return $false
}

function Install-PluginZip([string]$ZipPath, [string]$FolderName, [string]$UpluginName) {
    $dest = Join-Path $script:PluginsDir $FolderName
    $uplugin = Join-Path $dest $UpluginName
    if (Test-PluginPresent $FolderName $UpluginName) {
        Write-Host "PLUGIN_PRESENT=$dest"
        return
    }
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if ($script:IsDry) {
        if (Test-Path -LiteralPath $dest) { Write-Plan "remove $dest (not a v207 / UE 5.8.0 build with Win64 editor binaries)" }
        Write-Plan "extract: $tar -xf $ZipPath -C $script:PluginsDir"
        Write-Plan "expect $uplugin, else fail"
        return
    }
    if (Test-Path -LiteralPath $dest) {
        Remove-Item -LiteralPath $dest -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $script:PluginsDir | Out-Null
    & $tar -xf $ZipPath -C $script:PluginsDir
    if ($LASTEXITCODE -ne 0) { throw "tar failed extracting $ZipPath ($LASTEXITCODE)." }
    if (-not (Test-Path -LiteralPath $uplugin)) { throw "Extract did not produce $uplugin." }
    Write-Host "PLUGIN_EXTRACTED=$dest"
}

function Install-MetaPlugin([string]$PageUrl, [string]$FilePattern, [string]$FolderName, [string]$UpluginName) {
    if (Test-PluginPresent $FolderName $UpluginName) {
        Write-Host ("PLUGIN_PRESENT=" + (Join-Path $script:PluginsDir $FolderName))
        return
    }
    $package = Get-MetaPackage -PageUrl $PageUrl -FilePattern $FilePattern
    if ($null -eq $package -or -not $package.Pinned) { return }
    Install-PluginZip -ZipPath $package.Zip -FolderName $FolderName -UpluginName $UpluginName
}

function Write-BuildIdReport {
    $modulesPath = Join-Path $script:PluginsDir 'MetaXR\Binaries\Win64\UnrealEditor.modules'
    $buildId = ''
    if (Test-Path -LiteralPath $modulesPath) {
        $modules = [System.IO.File]::ReadAllText($modulesPath)
        $idMatch = [regex]::Match($modules, '"BuildId"\s*:\s*"(\d+)"')
        if ($idMatch.Success) { $buildId = $idMatch.Groups[1].Value }
    }
    $engineVersion = Join-Path $script:EngineRoot 'Engine\Build\Build.version'
    $compatible = ''
    if (Test-Path -LiteralPath $engineVersion) {
        $versionText = [System.IO.File]::ReadAllText($engineVersion)
        $compatibleMatch = [regex]::Match($versionText, '"CompatibleChangelist"\s*:\s*(\d+)')
        if ($compatibleMatch.Success) { $compatible = $compatibleMatch.Groups[1].Value }
    }
    if ($script:IsDry -and -not $buildId) { Write-Plan "after extraction, read BuildId from $modulesPath" }
    Write-Host "PLUGIN_BUILD_ID=$buildId"
    Write-Host "ENGINE_COMPATIBLE_CHANGELIST=$compatible"
    if ($buildId -and $compatible -and $buildId -ne $compatible) {
        Write-Host "PLUGIN_BUILD_ID_MISMATCH expected=$compatible actual=$buildId"
    }
}

function Enable-UprojectPlugins([string[]]$Names) {
    $bytes = [System.IO.File]::ReadAllBytes($script:Uproject)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $text = [System.IO.File]::ReadAllText($script:Uproject)
    $json = $text | ConvertFrom-Json
    $todo = @()
    foreach ($name in $Names) {
        $existing = @($json.Plugins | Where-Object { $_.Name -eq $name }) | Select-Object -First 1
        if ($null -eq $existing) { $todo += $name; continue }
        if ($existing.Enabled -eq $true) { Write-Host "UPROJECT_ALREADY=$name" }
        else { Write-Host "UPROJECT_PLUGIN_DISABLED=$name (the project lists it with Enabled false; left as it is)" }
    }
    if ($todo.Count -eq 0) { return }

    # Text insertion, not a JSON round trip, so the editor's formatting and every other member stay byte for byte.
    $nl = "`n"
    if ($text.Contains("`r`n")) { $nl = "`r`n" }
    $entries = @($todo | ForEach-Object { "`t`t{$nl`t`t`t`"Name`": `"$_`",$nl`t`t`t`"Enabled`": true,$nl`t`t`t`"Optional`": true$nl`t`t}" })
    $block = $nl + ($entries -join ",$nl")
    $emptyArray = [regex]::Match($text, '"Plugins"\s*:\s*\[\s*\]')
    $openArray = [regex]::Match($text, '"Plugins"\s*:\s*\[')
    if ($emptyArray.Success) {
        $updated = $text.Substring(0, $emptyArray.Index) + "`"Plugins`": [" + $block + $nl + "`t]" + $text.Substring($emptyArray.Index + $emptyArray.Length)
    } elseif ($openArray.Success) {
        $at = $openArray.Index + $openArray.Length
        $updated = $text.Insert($at, $block + ',')
    } else {
        $last = $text.LastIndexOf('}')
        if ($last -lt 0) { throw "REFUSED: $script:Uproject has no closing brace; not editing it." }
        $before = $text.Substring(0, $last).TrimEnd()
        $comma = ','
        if ($before.EndsWith('{')) { $comma = '' }
        $updated = $before + $comma + $nl + "`t`"Plugins`": [" + $block + $nl + "`t]" + $nl + $text.Substring($last)
    }
    # The edit must still parse, and must say what was asked, before anything is written.
    $check = $updated | ConvertFrom-Json
    foreach ($name in $todo) {
        $entry = @($check.Plugins | Where-Object { $_.Name -eq $name }) | Select-Object -First 1
        if ($null -eq $entry -or $entry.Enabled -ne $true -or $entry.Optional -ne $true) {
            throw "The edited bp.uproject does not list $name as Enabled and Optional; not writing it."
        }
    }
    if ($script:IsDry) {
        foreach ($name in $todo) { Write-Plan "add to $script:Uproject Plugins: { `"Name`": `"$name`", `"Enabled`": true, `"Optional`": true }" }
        return
    }
    [System.IO.File]::WriteAllText($script:Uproject, $updated, (New-Object System.Text.UTF8Encoding($hasBom)))
    foreach ($name in $todo) { Write-Host "UPROJECT_ENABLED=$name" }
}

function Install-Simulator {
    $hint = "per process only: `$env:XR_RUNTIME_JSON = '$script:SimulatorJson' (never activate_simulator.ps1, never HKLM\SOFTWARE\Khronos\OpenXR\1)"
    if (Test-Path -LiteralPath $script:SimulatorJson) {
        Write-Host "SIMULATOR_PRESENT=$script:SimulatorDir"
        Write-Host "SIMULATOR_JSON=$script:SimulatorJson"
        Write-Host "SIMULATOR_USE $hint"
        return
    }
    $package = Get-MetaPackage -PageUrl $script:SimulatorPage -FilePattern '^meta_xr_simulator_v207\.0\.msi$'
    if ($null -eq $package -or -not $package.Pinned) { return }
    $msiLog = Join-Path $script:CacheDir 'meta_xr_simulator_v207.0.extract.log'
    $msiArgs = @('/a', "`"$($package.Zip)`"", '/qn', "TARGETDIR=`"$script:SimulatorExtractRoot`"", '/L*v', "`"$msiLog`"")
    if ($script:IsDry) {
        Write-Plan ("extract (administrative image, nothing installed or registered): msiexec.exe " + ($msiArgs -join ' '))
        Write-Plan "expect $script:SimulatorJson, then print SIMULATOR_JSON="
        return
    }
    New-Item -ItemType Directory -Force -Path $script:SimulatorExtractRoot | Out-Null
    $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Wait -PassThru -WindowStyle Hidden
    if ($proc.ExitCode -ne 0) { throw "msiexec /a exited $($proc.ExitCode) extracting $($package.Zip); its log is $msiLog." }
    if (-not (Test-Path -LiteralPath $script:SimulatorJson)) {
        $found = @(Get-ChildItem -LiteralPath $script:SimulatorExtractRoot -Recurse -Filter 'meta_openxr_simulator.json' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
        throw ("The extract did not produce $script:SimulatorJson. Found instead: " + ($found -join ', ') + ". Log: $msiLog")
    }
    Write-Host "SIMULATOR_EXTRACTED=$script:SimulatorDir"
    Write-Host "SIMULATOR_JSON=$script:SimulatorJson"
    Write-Host "SIMULATOR_USE $hint"
}

# ---- main
if ($PluginsOnly -and $SimulatorOnly) {
    Write-Host 'REFUSED: -PluginsOnly and -SimulatorOnly each name one step; pass at most one.'
    exit 2
}
$doPlugins = -not $SimulatorOnly
$doProject = -not ($PluginsOnly -or $SimulatorOnly)
$doSimulator = -not $PluginsOnly
if ($script:IsDry) { Write-Host 'DRYRUN: nothing below is written, downloaded or extracted.' }
Write-Host "VR_ROOT=$script:VrRoot"

if ($doProject) {
    if (-not (Test-Path -LiteralPath $script:Uproject)) {
        Write-Host "REFUSED: $script:Uproject does not exist yet (the owner creates it with the editor). Re-run once it exists, or pass -PluginsOnly to install the plugins without touching a project."
        exit 2
    }
    try {
        [System.IO.File]::ReadAllText($script:Uproject) | ConvertFrom-Json | Out-Null
    } catch {
        Write-Host "REFUSED: $script:Uproject is not valid JSON ($($_.Exception.Message)); not touching it."
        exit 2
    }
}

try {
    if ($doPlugins) {
        Install-MetaPlugin -PageUrl $script:IntegrationPage -FilePattern 'UnrealMetaXRPlugin\.207' -FolderName 'MetaXR' -UpluginName 'OculusXR.uplugin'
        Install-MetaPlugin -PageUrl $script:InteractionPage -FilePattern 'MetaXRInteractionPackage\.207' -FolderName 'MetaXRInteraction' -UpluginName 'OculusInteraction.uplugin'
        Write-BuildIdReport
    }
    if ($doProject) {
        Enable-UprojectPlugins -Names @('OculusXR', 'OculusInteraction')
    }
    if ($doSimulator) {
        Install-Simulator
    }
} catch {
    $message = $_.Exception.Message
    if ($message.StartsWith('OWNER_ACTION')) { Write-Host $message; exit 3 }
    if ($message.StartsWith('REFUSED')) { Write-Host $message; exit 2 }
    Write-Host "FAILED: $message"
    exit 1
}

if ($script:OwnerActions.Count -gt 0) {
    Write-Host "DRYRUN_DONE: $($script:OwnerActions.Count) OWNER_ACTION step(s) above; the real run would exit 3 there."
    exit 3
}
if ($script:IsDry) { Write-Host 'DRYRUN_DONE: nothing was written.' }
exit 0
