# S1. Cold open on the web (0:00-0:14)

Script: [../scenes.md](../scenes.md#s1-cold-open-the-product-as-a-blueprint-000-014-web). Tools: [../capture-plan.md](../capture-plan.md).

## Setup

- **Build:** the web app from master at the filming commit (`npm run dev`, :3010) with the server (`npm run server`, :3100),
  both from the repo root. No headset needed for this shot.
- **Data:** `kettle-live` (`node scripts/scan-demo.mjs --reset` the evening before, so health and outcomes are as
  planned). The Kettle feature names must already carry the neutral wording (readiness.md, gap G1): no "Google",
  "Apple" or "iOS" anywhere on the plan or a fixture's label.
- **Window:** a browser window with no tabs bar, no bookmarks, no extensions' icons (an app window or kiosk mode), client
  area exactly 1920x1080, dark theme (`ThemeToggle`). The OS taskbar hidden. Zoom 100 %.
- **Pairing state:** irrelevant here, but the page must not show a pairing code or address (it does not on `/`).

## Steps

1. Open `http://127.0.0.1:3010/?product=kettle-live`; wait until the plan settles; move the cursor off the plan.
2. Start the capture (`record-demo.mjs --name s1-web --window "<title>" --fps 60`).
3. Wait 5 s. Click the Studio operations wing. Wait for the flight to settle (about 2 s). Click Booking and attendance.
4. Hold 4 s on the open room. Stop.

## Takes to get

- 3 takes of the full move. 1 take of 10 s of the plan at rest (an under-caption plate). 1 take with the light theme in
  case the dark one reads too dim at 1080p.

## What can go wrong

- A brand name in a fixture label: stop, fix the data (G1), re-shoot.
- The flight overshoots or the cursor covers a label: re-take with slower clicks; hide the cursor (`--no-mouse`) for the
  plate take.
- Health colours differ from S5's YESTERDAY outcomes: reset `kettle-live` and re-take both on the same day.

## Post

- No speed change. Trim to 14 s. Captions (three lines) bottom third, white on a 60 % navy band.
- Music bed fades in from 0:00 at -24 LUFS short-term, under the captions.
