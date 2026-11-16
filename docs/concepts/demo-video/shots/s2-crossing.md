# S2. The crossing: the table lights, Glim turns (0:14-0:28)

Script: [../scenes.md](../scenes.md#s2-the-crossing-the-table-lights-glim-turns-014-028-headset).

## Setup

- **Build:** the Development APK at the filming commit, installed (headset-morning-check.md step 0). The wall's new look
  in.
- **Server and link:** the PC server (`npm run server -- --lan`) and the web app (`BP_COMPANION_URL=http://127.0.0.1:3100
  npm run dev`), from the repo root. The headset paired beforehand, off camera, with scopes standup, place, focus,
  decide, scan (and onboard, for S3). The cable route (`node apps/vr/tools/quest-tether.mjs`) is the steadier one for
  filming; Wi-Fi is fine if it held during the dry run.
- **Data:** the headset opens on `kettle-live` (`BpLink.Product kettle-live` once, before the take; it is remembered).
  The web page from S1 left on Booking and attendance.
- **Settings:** VOICE 100 %, MUSIC 35 %, captions on, TEXT SIZE 100 %, STUDIO (not your room), the tour finished (so it
  does not start by itself).
- **Capture:** the headset's own recorder (capture-plan.md), 1920x1080, 60 fps if the dry run held 72 fps while
  recording.
- **Pose:** seated at the desk, head level, looking at the table's centre. Hold the Meta button once before the take so
  the table seats in front of you.

## Steps

1. App closed (`adb shell am force-stop com.developersblueprint.vr`, sent before the wearer is ready). Start the
   recorder.
2. Open the app from the library by hand; let the studio come up. Keep the head still for 3 s while the table lights.
3. The Director sends `BpTour.Start welcome`. Glim turns and says the welcome. After the line, `BpTour.Stop`.
4. Raise the right hand into view and tap a wing. Hold 2 s. Stop the recorder.

## Takes to get

- 3 full takes. 1 take of the studio lighting up with no hand (a cut-in). 1 take where the welcome is played by a real
  first launch (`BpTour.Forget`, force-stop, launch) in case the started tour sounds different.

## What can go wrong

- The library and the app's loading screen show OS chrome: start the cut after the studio is up; never show the
  library.
- The table does not land on Booking: `BpLink.Follow on`, or click the room again on the web (it publishes the place).
- The tour runs on past the welcome and shows the "Tap a wing" step: stop it sooner, or cut on the welcome's last word.
- `BpTour.Stop` makes Glim say "Tour stopped...": cut before it, or mute that clip in the edit.

## Post

- Real time. 8-frame dip from S1. Caption one line. Keep the studio's room tone and music.
- The welcome line's in-app caption may be small at 1080p: the transcript caption carries it.
