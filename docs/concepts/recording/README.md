# Recording: the demo video

State at the session wrap, 2026-11-01. The plan, with the feasibility table and the spike order, is [plan.md](plan.md).

## Where it stands

- **Decided (owner, 2026-10-31).**
  - Footage: scripted scenes in the Meta XR Simulator window. Only hand gestures are performed live.
  - Split-screen: the Simulator and the web plan are recorded as two captures, then composited.
  - Spike scenes: (1) the table and L0-L2; (2) web and table sync, both ways; (3) the lamp companion talks.
  - The final scope will take shape this month, as the project develops.
- **Built.** `apps/vr/tools/record-demo.mjs` records a window or the desktop through ffmpeg gdigrab. It writes an mp4
  plus a sidecar with the start time, and `--stack a.mp4 b.mp4` puts two takes side by side. A 2 s desktop take and a
  stack were tested on Lynx on 2026-10-31. A Simulator take has not been recorded yet.
- **Unproven.** The Simulator session has never been seen running live with the table showing (it has only reached
  READY). Spike step 1 tests this, with the owner at the keyboard.
- **Not built.** The lamp's scripted tour (`BpTour`, standalone-plan.md S6).
- **Unverified.** The competition's video rule. Devpost answered 403 to a fetch. A search found only a scraped copy of
  the page, possibly from another year, which says a public YouTube link and that judges need not watch past 3 minutes.
  Read the live rules before the final cut.

## Next

1. The owner runs `node apps/vr/tools/run-bplink.mjs --mode game --xr-sim --vr` and dismisses the Welcome, update and
   firewall prompts. Then they report whether the session gets past READY.
2. If it does, record scene 1. If it stays at READY, take the fallback in plan.md: record the flat window, or capture on
   the headset over the Steam Link route.
