# Demo video plan: Simulator footage with a web split-screen

Spark `demo-video`, 2026-10-31. The competition wants a video of under 3 minutes (rule unverified, see the table). This page says whether we can make it, how, and
what to try first. Scope is a spike on three scenes; the final cut waits for the project to settle this month.

## Can we do it? Yes, with one unproven link

| Need | State | Evidence |
|---|---|---|
| Table running in the Meta XR Simulator, windowed | **Works to READY**, live interaction unproven | machine.md: window opens and connects after Windows App Runtime 1.5; session stops at READY (`beginFrame() discarded`); Welcome modal may hold it. Never recorded reaching FOCUSED. |
| Scripted scenes without hands | **Works** | `run-bplink.mjs --mode game --xr-sim --exec "BpView.Pose target,BpRoom.Enter communications,..."` (flat-view readings 37, 40) |
| Hands in the Simulator | **Manual only** | Num1-4 poses, `[` `]` cycle; needs window focus; no automation. L3.4 pinch-pull note still open. |
| Web moves the table / table moves the web | **Built** | `BpFollow.cpp` (reads the focus baton; publishes the place after `PublishSettleS`); `apps/web/src/components/crossing/follow.ts` (`bp:place`). Needs the live server, not `-BpLinkUrl=bundle` (writes refused). |
| Lamp companion talks | **Server side built, tour not** | companion-link.md; `BpTour` (D1) is planned in standalone-plan.md S6. Live turns need the claude runtime on the server. |
| Recording | **Works** | ffmpeg 9.0.2 `gdigrab` 30 fps probe ok (Lynx, ARM64); `h264_nvenc` listed. New: `apps/vr/tools/record-demo.mjs`. |
| Simulator footage accepted by the rules | **Unverified** | Devpost returns 403 to fetch; a search found only a scraped, possibly other-year mirror (YouTube link, judges need not watch past 3 min). Read the live rules before the final cut. |

## Method (owner's choices, 2026-10-31)

- **Scripted + Simulator window.** Scenes are driven by console commands / the tour; only hand gestures are done live.
  Recorded with `record-demo.mjs --window "<Simulator title>"`.
- **Sync scenes are two captures, composited.** One capture of the Simulator, one of the browser (the web plan), each
  started by the tool, which writes a sidecar with the start epoch. `--stack a.mp4 b.mp4` joins them side by side.
  Trim each to a shared marker: trigger the sync event (a `focus.show` or a settled room) and cut on the first frame where
  either side moves. Because viewers cannot tell a composite from a staged shot, show the server's event time in a corner
  of both (the web chip's "2 s ago" already does for the page).
- **Spike scenes (final scope later):** (1) table + L0-L2 scan, lift and dive; (2) web moves table and table moves web;
  (3) lamp companion answers and moves focus.

## Spike order (each step is a go/no-go)

1. **Simulator reaches FOCUSED, owner at the keyboard (10 min).** `run-bplink.mjs --mode game --xr-sim --vr`, dismiss the
   Welcome and update prompts and the firewall request, then check for `BpFrame` samples at a steady rate and a rendered
   eye view in the Simulator window. If it stays at READY: record the flat game window for scripted scenes and treat the
   Simulator window as hands-only footage, or fall back to the Steam Link route (passed 2026-10-29) with a headset
   capture.
2. **Record scene 1.** `record-demo.mjs --name s1-table --window "<title>"` while `--exec` plays the pose/room commands.
   Check the frame: fps, legibility of the 25-40 arcmin text at 1080p, no dropped frames while the game renders.
3. **Scene 2.** Server on `http://127.0.0.1:3100` with Kettle; web at `?product=kettle`; post a focus command to the
   companion route and record both windows. Then move a room by hand and watch the page fly.
4. **Scene 3.** Needs the claude runtime; if absent, record the lamp's caption with a canned `focus.show` and say so.

## Risks

- Recording the Simulator window costs GPU/CPU on an emulated x64 process; the earlier flat run was 25 ms a frame. Expect
  to record at 30 fps and cut at 24; use `h264_nvenc` (add `-c:v h264_nvenc`) if libx264 steals frame time.
- Simulator hands cannot be automated, so the pinch scene is the least repeatable and the one most likely to be
  re-shot. Keep it to one 10-second beat.
- The 3-minute cap leaves about 35 s per scene for 5 scenes. Caption lines should read alone (standalone-plan.md S6).

## Open

- The competition's video rule and whether on-device footage is expected.
- The Simulator window title for `--window` (read it once from `Get-Process | ? MainWindowTitle`).
