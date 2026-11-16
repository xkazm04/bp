# Run note: Quest performance prep on the PC (Lynx, 2026-11-04)

The Meta VR Start rules ask for at least 60 fps on Quest hardware; we aim at 72 Hz (13.9 ms). The owner has no headset
time until 2026-11-07/08, so this session measured what the PC can measure, so that the weekend confirms numbers instead
of discovering them. Commits: `b576742` (frame meter), `744beeb` (the Quest tier in code), `be2a954` (the Quest tier in
config).

**Read every timing here as relative.** Lynx runs UE 5.8.4's x64 binaries under ARM64 emulation, uncooked `-game` from
the editor's binaries, one flat view off screen at 1600 x 900, the D3D12 SM6 forward path. None of it is the Quest's
mobile renderer, its multiview or its CPU. Draw and triangle counts are scene facts and carry over better than times.

## How it was run

Every run is `node apps/vr/tools/run-bplink.mjs --mode game --bundle --xr-sim` (the bundled Kettle snapshot; `--xr-sim`
without `--vr` renders off screen with no XR session) with `--ue-args "-ResX=1600 -ResY=900 -csvCaptureFrames=<n>
-csvGpuStats"`. `--exec` always starts with `bp.Tour 0,bp.TourVoice 0,BpView.Pose target`, then what the row names. The
CSVs land in `%LOCALAPPDATA%/UnrealEngine/5.8/Saved/Profiling/CSV` (not `apps/vr/Saved`) for `-game` from the installed
engine. Summaries skip the first 600 frames (load and plan) and give p50 / p95 over the rest.

The PC captures are PIE in the MCP editor (`mcp-editor.mjs start`, `StartPIE`, then `capture_viewport` at 1600 x 900), as
in earlier readings.

## Baseline (binaries of 18:59, before this session's code)

| Pose | Frame | Game thread | of it, waiting | Render thread | GPU | Draws | Primitives |
|---|---|---|---|---|---|---|---|
| Target (site plan, L0) | 6.17 / 8.66 | 3.77 / 5.23 | 2.32 (EventWait) | **6.19 / 8.69** | 4.71 / 6.51 | 164 | 295.5k |
| Room mode, `BpRoom.Enter communications` | 6.07 / 8.81 | 3.65 / 5.24 | 2.29 | **6.04 / 8.69** | 4.47 / 5.80 | 177 | 295.6k |

- Draws at the target pose, by pass: prepass 31, base pass 32, translucency 31, occlusion queries 28, shadow depths 3,
  Slate 2; the rest are post-process and fog passes. Room mode adds 7 translucency and 5 occlusion draws.
- About 16% of CSV rows show double pass counts (base 64). These are two render frames landing in one CSV row; the p50
  is the honest per-frame count.
- The frame meter at the same time: `BpFrame: p50 over 2 s gpu_ms=4.29 game_ms=3.66 frame_ms=6.03`.
- Flat, the **render thread is the critical path**, not the game thread. The game thread's own work is about 1.5 ms of
  its 3.8 ms; the rest is waiting for the render thread.

## The headset's 25 ms "game" reading (2026-10-29) is mostly the runtime's frame wait

The first headset session read `game_ms=25.3-26.1` against `gpu_ms=20.9-21.5`. Flat, the same scene's world tick is
1.3 ms. The gap is how UE counts:

- `FOpenXRHMD::OnBeginSimulation_GameThread` calls `xrWaitFrame` on the game thread
  (`Plugins/Runtime/OpenXR/.../OpenXRHMD.cpp`, near line 4046).
- `GGameThreadTime` is the frame's game-thread time minus the waits recorded by `FThreadIdleStats`
  (`UnrealClient.cpp`, near line 1844). `xrWaitFrame` is not wrapped in an idle scope.
- So on any OpenXR runtime, `stat unit`'s Game and our meter's GAME include the time the runtime holds the app to its
  frame pacing. When the GPU (and Steam Link's encode) take ~21 ms, the wait fills the game thread up to the frame time.

This is **inferred from the engine source**, not from a headset trace. Steam Link's ~21 ms GPU on Lynx's integrated
GPU says nothing about the Quest.

**Fix (`b576742`).** The meter's log line now also prints `render_ms` (`GRenderThreadTime`) and `tick_ms`, the game
world's own tick from `OnWorldTickStart` to `OnWorldPostActorTick`, which never contains `xrWaitFrame`. After the
build, flat at the target pose: `BpFrame: p50 over 2 s gpu_ms=4.87 game_ms=3.83 frame_ms=6.40 render_ms=6.44
tick_ms=1.31`. On the device, read `tick_ms` for the game's CPU cost and `render_ms` for the draw-submission cost. Use
`game_ms` only next to them.

**Correction (2026-11-11, a device trace).** That claim was wrong: the span DID contain `xrWaitFrame`. `UWorld::Tick`
broadcasts `OnWorldTickStart` and then calls `XRSystem->OnStartGameFrame` (LevelTick.cpp), where OpenXR blocks in
`xrWaitFrame` (OpenXRHMD.cpp, `OnBeginSimulation_GameThread`). On the PC flat there is no XR system, hence 1.31 ms; on
the Quest 3S at rest at home the meter read `tick_ms=12.0`, and an Insights trace of the same state (`Trace.File
p1rest.utrace cpu,frame,bookmark` for 8 s, 600 frames) split it: `UWorld_Tick` p50 12.06 ms, of which `OpenXrWaitFrame`
10.50 ms; the world tick's own work p50 1.58 ms (p95 2.38); the whole game thread busy (`FEngineLoop::Tick` minus the
wait) p50 3.37 ms (p95 4.13) of the 13.9 ms frame. Since then `tick_ms` runs from `OnWorldPreActorTick` (after the wait)
to `OnWorldPostActorTick`, and the log adds `wait_ms` (tick start to actor tick: on a headset nearly all `xrWaitFrame`).

## Game-thread hotspots: none worth a change at rest

Code read and CSV `Exclusive/GameThread/*` at the target pose:

| Item | Cost | Verdict |
|---|---|---|
| Slate (`UI`) | 0.41 ms | the game viewport's Slate tick |
| `TickActors` | 0.34 ms, 96 ticks a frame | 59 of the ticks are `UWidgetComponent`s, all `SetManuallyRedraw(true)`. Their tick is what runs a `RequestRedraw`, so it cannot be switched off without changing how labels redraw. |
| `ABpTable::Tick` (`BpBuild/GameThread/TableTick`) | 0.00 ms p95 | already at 0.25 s when nothing moves; frame rate only while something eases |
| Per-frame `SetSlateWidget` / `RequestRedraw` | none at rest | only the frame meter rebuilds, at 4 Hz, and only when shown |
| Render-target sheet redraws | none at rest | `RedrawSheet` is event-driven (machine.md readings 46-55) |

A 58 s capture (9000 frames, after the build) has no frame over 12 ms whose game thread is over 11.6 ms. Every frame
over 12 ms is a render-thread frame. The GC result is below.

## The Quest tier

### Config (`be2a954`), Android only

- `Config/DefaultDeviceProfiles.ini`, `[Android DeviceProfile]`: the world, character, cinematic, effects and sky
  texture groups are capped at `MaxLODSize=1024`. The UI group is not capped. Every Quest device profile inherits from
  `[Android]` (via `Android_OpenXR` and `Android_Mid`).
- `Config/Android/AndroidEngine.ini`:
  - `r.AllowOcclusionQueries=False`. Measured on the PC: with queries off the base pass still draws 32, so they cull
    nothing at the target pose, and their 28 draws go.
  - Meta XR `SuggestedCpuPerfLevel` and `SuggestedGpuPerfLevel` set to `SustainedHigh`.
  - Fixed foveated rendering, `Medium`, dynamic.

### Code (`744beeb`): `bp.QuestTier`

`-1` (the default) turns the tier on at a mobile feature level, which is the APK. `1` previews it on the PC; `0` forces
it off. The tier:
- hides the studio's 4 haze cards (the level's `M_HazeShaft` and `M_HazeVeil` instances);
- keeps the scan's veil off, so the scan line is the scan's one additive card;
- captures the live hand shadow at `bp.QuestTier.HandShadowHz` (36 Hz) instead of every frame. The capture is a second
  depth-only scene render, and on a tiler that is a render-pass switch every frame.

`bp.QuestTier.Report [delay_s]` logs every visible primitive, with its LOD0 triangles and blend.

### Measured on the PC

All rows are at the target pose, after the build.

| Run | Draws | Translucency | Occlusion | Primitives | Render thread | GPU |
|---|---|---|---|---|---|---|
| Tier off (the PC as shipped) | 164 | 31 | 28 | 295.5k | 6.47 / 9.23 | 4.99 / 6.59 |
| `bp.QuestTier 1` + `r.AllowOcclusionQueries 0` | **132** | 27 | 0 | 296.2k | **5.08 / 7.22** | 4.97 / 6.76 |

- Occlusion queries cost about 1.4 ms of render thread here (emulated), for no culling.
- The haze cards are small on the PC's screen, so hiding them barely moves the GPU's translucency time (0.85 to
  0.82 ms). Their worth on a tiler is overdraw, and only the device can measure that.

**Pass accounting (counts only).** Three runs with `showflag.Translucency 0`, then also `showflag.DynamicShadows 0` and
`r.AllowOcclusionQueries 0`. These three overlapped another session's game run, so their times are not used.

| Run | Draws | Primitives |
|---|---|---|
| All passes | 164 | 295.5k |
| No translucency | 132 | 294.8k |
| Opaque only (no translucency, no shadows, no occlusion) | 96 | 279.9k |

So translucency is about 0.7k triangles, the shadow pass about 15k, and the opaque scene about 140k a pass (prepass and
base pass draw the same 31-32 meshes).

`bp.QuestTier.Report` with the tier off: 56 visible primitives, 201.2k LOD0 triangles in the whole level before
frustum culling, 31 translucent. The largest:

| Triangles | Primitive |
|---|---|
| 14.7k | `SM_LampAgent` (has a translucent slot) |
| 12.5k | `SM_StudioDeskClutter` |
| 11.2k + 10.7k | the posed capture hands (a headset removes them; the ISDK hands replace them) |
| 10.2k | `SM_StudioDrawingTubes` |
| 4 x 8.6k | `SM_StudioShelves` |
| 8.4k | the rest volumes (instanced cubes) |
| 8.1k | `SM_LightTableFrame` |
| 7.8k + 7.8k | pin beads and halos |
| 2 x 7.8k | `SM_StudioWallKit` |

### Android-tier estimate against the S4 budget (inferred)

The Quest draws with the mobile forward renderer: no depth prepass (`r.Mobile.EarlyZPass` 0) and multiview (one draw
for both eyes).

| | PC now | Quest tier, estimated | S4 budget |
|---|---|---|---|
| Draws, target pose | 164 | base 32 + translucency 27 + shadow 3 + UI and misc ~5 = **~67** | under ~100 |
| Draws, room mode | 177 | **~75** | under ~100 |
| Triangles | 295.5k (prepass + base + shadow) | base ~140k + shadow ~15k + translucency ~1k = **~156k** | under ~200k |

The estimate takes the PC's per-pass counts and removes what the mobile path does not draw. It is not a mobile-renderer
reading. Multiview runs the vertex stage for both views, so vertex work is about twice the triangle count. The budget
counts triangles as submitted.

### The PC look is unchanged

PIE at the target pose, `capture_viewport` 1600 x 900, before (binaries of 18:59) and after (`744beeb` built):
- target pose: mean absolute difference 0.229 of 255; **0.000%** of pixels differ by more than 24;
- room mode (`BpRoom.Enter communications`): 0.197; 0.000%.

The remaining difference is the lamp's idle motion.

## GC

The one game-thread hitch at rest is the garbage collector. Two 150 s captures at the target pose
(`-csvCaptureFrames=24000`, 23,403 frames after the first 600):

| Run | Game thread p50 / p99 | GC frames (CSV `GC##` events) |
|---|---|---|
| As shipped | 3.78 / 6.22 ms | **48.6 ms** at 84.7 s and 145.8 s (one frame each, ~61 s apart: the engine's default purge interval) |
| `-ini:Engine:[/Script/Engine.GarbageCollectionSettings]:gc.AllowIncrementalReachability=1,...:gc.IncrementalReachabilityTimeLimit=0.002` | 3.72 / 6.03 ms | 57.0 ms, then 17.7 ms; and 38.2 ms |

- Incremental reachability did not remove the spike here, and the log does not confirm the override took. **No GC
  setting is committed.**
- The uncooked `-game` run loads the editor's objects too, so the cooked APK's GC should mark far fewer objects. At
  72 Hz any GC frame over ~14 ms is still a dropped frame, so it is on the device checklist (step 10).

## What the weekend session has to measure (OVR Metrics Tool checklist)

Install the APK (`package-quest.ps1 -Install`; a new build is needed for this session's commits) and turn on OVR
Metrics Tool's overlay and CSV recording.

1. **Tier on.** `logcat -s UE` shows `BpTier: quest tier on (feature level mobile, bp.QuestTier -1): 4 haze card(s)
   hidden ...`. If it says `SM5+`, the device is not on the mobile path.
2. **Frame rate and GPU at rest.** Record 60 s seated at the site plan (L0). Read FPS (72 held?), App GPU time (13.9 ms
   or less, S4's pass), CPU and GPU levels (should read SustainedHigh, i.e. 3 and 3 or above), stale frames, and the
   foveation level.
3. **The same in room mode** (pull a wing, then a room: deck and widgets) and **during a scan** (the scan line). A scan
   makes the table tick at the frame rate.
4. **The live hands.** Hold both hands over the paper for 30 s. Compare GPU time with step 2, then try
   `bp.QuestTier.HandShadowHz 18` and `72`. Look for visible lag of the shadow at 36 Hz.
5. **The game's CPU, apart from the frame wait.** `bp.FrameMeter 1`, then read the `BpFrame` lines: `tick_ms` and
   `render_ms`. A frame-bound `game_ms` (and `wait_ms`) is the runtime's wait, not our cost. Builds before 2026-11-11
   count the wait inside `tick_ms` (see the correction above).
6. **Draws and triangles on the device.** `stat rhi` (DrawPrimitive calls, triangles) or a short CSV
   (`-csvCaptureFrames=600 -csvGpuStats` in `UECommandLine.txt`, pulled with `adb pull`). Compare with the ~67 / ~156k
   estimate.
7. **The scene's cost by piece.** `bp.QuestTier.Report` (logcat). If GPU is over budget, hide the next suspects one at a
   time and re-read App GPU time:
   - the lamp's translucent slot;
   - the shelves (4 x 8.6k);
   - the desk clutter;
   - the window's city card;
   - the sheet resolution, `bp.SheetPx 2048` against 4096.
8. **Foveation.** Toggle FFR off and on in the overlay (or with `xr.VRS.FoveationLevel`). Read the GPU gain, and whether
   the deck's text softens (`BpView.TextCard 1`; S4's text pass).
9. **Texture memory.** `stat streaming` or `memreport -full`, to confirm that no world texture is resident above 1024.
10. **A 3 to 5 minute run** for thermal throttling and GC hitches: a frame-time spike about once a minute is GC.

## Honest limits

- No Quest number is measured here. Every time above is x64 under ARM64 emulation, uncooked, flat, one view, D3D12.
- The mobile renderer was never run, not even in the PC's ES3.1 preview: under emulation, compiling a mobile shader
  set for every material was too long for this session. The Android draw and triangle figures are an estimate from the
  PC's per-pass counts.
- The haze cards' and the hand-capture rate's gains are fill and pass costs that only a tiler shows. On the PC both are
  within noise, or not exercised: flat, the posed hands are captured once, so the live-capture path did not run.
- The texture cap is config read at cook. Whether the cook strips the mips above 1024 is to be checked in the APK
  (size, `UnrealPak -List`, or step 9).
- Foveation, CPU/GPU levels and occlusion-off take effect only on the device.
- `bp.Tour 0` given through the editor MCP's console after `StartPIE` did not stop a tour already running in PIE. So the
  tier-on PIE capture (not used above) shows the tour's L1. The `-game` runs give it in `-ExecCmds` at start and stay at
  L0.
