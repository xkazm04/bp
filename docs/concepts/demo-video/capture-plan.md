# Capture plan: tools, settings, the composite

For the scenes in [scenes.md](scenes.md). Nothing here has been run for this video yet: the dry run (below) settles every
"to confirm".

## VR capture: which tool

| Tool | What it gives | Use |
|---|---|---|
| **The headset's own recorder** (camera menu, or the Meta button and trigger shortcut) | One undistorted view, app audio (and optionally the wearer's microphone), saved on the headset. Default 1024x1024; landscape 1920x1080 and 60 fps are set over adb (`adb shell setprop debug.oculus.capture.width 1920`, `...capture.height 1080`, `...capture.fps 60`, `...capture.bitrate 20000000`; to confirm these props on this OS build, they reset on reboot) | **Primary** for every VR scene. Whether it records passthrough (S7) is to confirm. |
| **scrcpy** over USB | The raw display: both eye buffers side by side (3664x1920 on the 3S, as `screencap` showed on 2026-11-09). One eye by crop (`--crop 1832:1920:0:0`, then a 16:9 crop in the edit). Audio forwarding on recent Android, to confirm. Recorded on the PC, so no file pull. | **Backup** if the recorder drops frames or its resolution is poor. The foveated edges are soft: crop to the centre. |
| `adb shell screenrecord` | The same raw display, no audio, a time limit. | Not used. |
| **Meta XR Simulator** + `apps/vr/tools/record-demo.mjs --window` | PC rendering of the PC build, scripted by console. Reached READY only, never FOCUSED (recording/README.md); hands are keyboard poses. | **Fallback only**, if the headset cannot be used on 16-17 Nov. It is allowed footage, but it shows the PC look, not the Quest look. |

Recorder hygiene: the recorder's start and stop show an OS toast; trim it. Charge to 100 % and keep the cable in during
long takes (S3). Pull files with `adb pull /sdcard/Oculus/VideoShots/` after each scene (path to confirm), never during a
take.

**Frame rate.** The app runs at 72 Hz. Record at 60 fps if the recorder holds it without a frame-rate drop in the app
(check `bp.FrameMeter 1` during a recorded take in the dry run); else 30 fps. Edit at 30 fps (60 if all sources allow).

**Audio.** Glim's voice, the narration clips and the music bed come from the app's audio, which the recorder captures.
Turn the wearer's microphone off in the recorder (the owner's voice in S6 is not needed: his words show as YOU SAID).
Exception: S6 may keep the spoken question if the owner wants it heard; it is the entrant, so allowed.

## Web capture

- `node apps/vr/tools/record-demo.mjs --name <scene>-web --window "<exact browser title>" --fps 30` (ffmpeg gdigrab,
  libx264 crf 18; writes `<name>-<UTC stamp>.mp4` and a sidecar with the start time; `q` stops it). Add `-c:v h264_nvenc`
  in the tool if libx264 costs frames.
- Browser: an app or kiosk window, no tabs, bookmarks or extension icons; dark theme; 100 % zoom; client area 1920x1080
  (S1, S5's cut-away) or 960x1080 (S3's left half, 1:1).
- The page title is the window title (`bp · projects`, `<slug> · onboarding`, `bp · headsets`): the `--window` value
  changes with the page. For S3, record the desktop region instead (`--desktop` with the window placed at a known spot)
  or keep one window and read its title after navigation.
- Hide the OS taskbar, notifications off (Focus mode), no other windows.

## The split-screen

Two captures, joined in ffmpeg. The layout is 1920x1080: the web's 960x1080 window at 1:1 on the left, a 960x1080 crop of
the headset's 1920x1080 frame on the right (around the table and the wall). `record-demo.mjs --stack` is not used: it
scales both to 960 wide and hstacks them, which fails when the heights differ (gap G7).

Align first, then speed both by the same factor (placeholders in angle brackets):

```
ffmpeg -ss <web_sync_s> -i <web.mp4> -ss <vr_sync_s> -i <vr.mp4> -t <real_len_s> -filter_complex ^
 "[0:v]fps=30,crop=960:1080:0:0,setpts=(PTS-STARTPTS)/<N>[l];" ^
 "[1:v]fps=30,crop=960:1080:<vr_x>:0,setpts=(PTS-STARTPTS)/<N>[r];" ^
 "[l][r]hstack=inputs=2,drawtext=text='PC':x=24:y=24:fontsize=28:fontcolor=white@0.8,drawtext=text='HEADSET':x=984:y=24:fontsize=28:fontcolor=white@0.8[v]" ^
 -map "[v]" -an -c:v libx264 -crf 18 -pix_fmt yuv420p s3-split-fast.mp4
```

Do the real-time head (0:28-0:33) and tail (0:59-1:05) the same way with N = 1, then join the three parts with the concat
demuxer. The corner tag ("Sped up ×N. The clock shows the real run.") is a `drawtext` on the fast part, or a title in the
editor. Use any editor for the final assembly; ffmpeg is the reproducible path.

**Syncing.** One event both sides show: before the run, click a room on the web so the table flies to it (the page
publishes the place; the table follows it, `BpFollow.cpp`). `<web_sync_s>` and `<vr_sync_s>` are the first frames where
each side starts to move. Check the alignment again at the end: the web's run clock and the table's finishing ink should
land within a second. If they drift (recorder frame drops), use the run's start (Start onboarding on the web, the table
clearing) as a second anchor and stretch the VR side by the measured ratio.

## The sped-up onboarding

- How long the real adopt takes: n=1 on dowser@414e6ed (2026-11-02): 17.4 min, $11.00, the longest silence 135 s.
  The demo repo's own time is measured in the dry run (with the free stand-in only its pacing is measured, not the
  model's). Budget 10-20 min per real take.
- Factor: N = (real run length) / 26 s of screen. For 12 min, ×28; for 17 min, ×40. One factor for the whole fast part,
  same on both sides; no ramping, so the clocks stay comparable.
- The on-screen clock: the onboarding screen shows the run's elapsed time (`OnboardingScreen.tsx`, the run clock). Keep it
  inside the web crop and readable. The headset side has no clock; the label "Sped up ×N" covers both.

## Colour and legibility at 1080p

- Glim's caption and the wall's small text are the smallest text that matters. In the dry run, export one 1080p still per
  scene and read it at 100 % on a laptop screen and at phone size. If a line does not read, raise `bp.TextSize` to 1.15
  for that scene (the app's own setting), rather than zoom in post.
- No grading beyond matching the two halves of S3: lift the headset side to match the web's navy if it reads darker.
  Never sharpen the foveated edges; crop them.
- Captions: white, 40-44 px on 1080p, on a 60 % navy band, bottom third, two lines at most, 1.5 s minimum on screen.

## File naming and where takes live

- Raw takes live **outside git**: `%USERPROFILE%\Videos\bp-demo-2026\raw\` (headset files as pulled, web files from
  `record-demo.mjs --out` pointed there). Edits in `...\bp-demo-2026\edit\`, exports in `...\bp-demo-2026\export\`. The
  repo's `apps/vr/Saved/demo` is git-ignored too, but keep the final set in one place.
- Names: `<scene>-<source>-t<take>-<yyyymmdd-hhmm>.mp4`, for example `s3-web-t1-20261116-1015.mp4`,
  `s3-vr-t1-20261116-1015.mp4`, `s6-vr-t4-20261117-0940.mp4`. A take log (`takes.md` in the same folder) says what each
  take holds and which one is picked.
- The export: `developers-blueprint-demo-<yyyymmdd>.mp4` and its `.srt`.

## The dry run (2026-11-14, about 2 hours with the headset)

1. Recorder settings: set 1920x1080 / 60 fps, record 30 s of the studio, pull it, check resolution, fps, audio, and the
   app's frame rate during recording.
2. Passthrough: tap STUDIO while recording; does the room show in the file? (decides S7)
3. scrcpy: one 30 s take with the eye crop, for comparison.
4. Each scene once, end to end, with the planned settings and a stopwatch. S3 with the free stand-in on the demo repo
   (after G2). S6 with real speech (first time on the device with a wearer).
5. A rough cut of all eight scenes from the dry-run takes (no polish), timed against the 2:50 budget; one 1080p still per
   scene checked for legibility and for any brand, address, code or name on screen.
6. Write down every console value changed, and fix the gaps found before filming.
