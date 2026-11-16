# Stop the Meta XR Simulator that an Unreal run of this project left behind.
#
# Any Unreal process of apps/vr (the editor, a -game run, UAT's cook) starts the Meta XR Simulator when it is the machine's
# active OpenXR runtime, with its synthetic-environment server, and nothing stops them when the run ends. The server grows
# to 16 to 25 GB of private memory over hours: on 2026-11-10 that is what ran the machine out of memory during a packaging
# build. Call this after a run with the time the run began:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/stop-xr-sim.ps1 -Since <datetime>
#
# It stops, by process id, only the simulator processes that started at or after -Since: a Simulator the owner opened
# before the run is left alone. Without -Since it only lists what is running and stops nothing. Exit 0 always.
param([datetime]$Since)

$found = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in 'MetaXRSimulator', 'synth_env_server' })
if (-not $found) { Write-Host 'xr-sim: none running'; exit 0 }
foreach ($p in $found) {
    $gb = [math]::Round($p.PrivateMemorySize64 / 1GB, 1)
    if ($PSBoundParameters.ContainsKey('Since') -and $p.StartTime -ge $Since) {
        try { Stop-Process -Id $p.Id -Force -Confirm:$false -ErrorAction Stop; Write-Host "xr-sim: stopped $($p.ProcessName) pid $($p.Id) (started $($p.StartTime.ToString('HH:mm:ss')), $gb GB)" }
        catch { Write-Host "xr-sim: could not stop $($p.ProcessName) pid $($p.Id): $($_.Exception.Message)" }
    } else {
        Write-Host "xr-sim: left $($p.ProcessName) pid $($p.Id) (started $($p.StartTime.ToString('yyyy-MM-dd HH:mm:ss')), $gb GB)"
    }
}
exit 0
