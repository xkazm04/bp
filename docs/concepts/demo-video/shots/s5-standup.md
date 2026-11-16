# S5. The morning stand-up on the wall (1:29-2:01)

Script: [../scenes.md](../scenes.md#s5-the-morning-stand-up-on-the-wall-129-201-headset-linked).

## Setup

- **Build:** the filming APK with the wall's new look. Server and web as in S2; paired with standup, decide, focus,
  place.
- **Data:** `kettle-live`, reset the evening before (`node scripts/scan-demo.mjs --reset`). It holds approvals of the last
  7 days, so a YESTERDAY sheet shows (on 2026-11-10: "7 approved this week: 6 built, 1 failed"). Check in the dry run
  that the outcomes have BEFORE and AFTER screens and that both read at 1080p (known on the PC: the two screens are
  small). Neutral wording in place (G1): the decisions' titles and screens must name no brand.
- **Stand-up state:** a first stand-up of the day: `BpStandup.Forget` before the take (sends no request; local only).
- **Approval side effect:** APPROVE writes the real decision log (`.bp/companion/decisions.jsonl`) for `kettle-live`.
  That is acceptable for a demo product; re-run the reset between takes so every take starts the same.
- **PC window for the cut-away:** `/headsets` at 1920x1080, scrolled so WHAT THE TABLE DID fills the frame, filter "At
  the table". The PAIRED list and the Wi-Fi line (it shows an address) out of frame.

## Steps

1. Recorder on; PC capture on (`record-demo.mjs --name s5-pc --window "<title>"`).
2. MENU > STAND-UP by hand. The sheet arrives from Glim's side. Glim: "Here is what yesterday's approvals became."
3. Read the first outcome (BUILT, BEFORE and AFTER). NEXT. Read the second.
4. NEXT to the first decision. Wait for Glim's line. Pinch APPROVE (a clean pinch: a release counts only on the control the
   pinch began on). Hold through the stamp and the room's flash.
5. Stop the headset recorder. On the PC, the new row appears; hold 4 s; stop.

## Takes to get

- 3 full takes. 1 take of YESTERDAY alone with a slow read of BEFORE and AFTER (a cut-in). 1 close take of the pinch on
  APPROVE (hand large in frame).

## What can go wrong

- No YESTERDAY sheet: nothing approved in the last 7 days on that product; reset `kettle-live`.
- The first decision is not payout reconciliation: Glim says `su-decide-other` instead; fine, re-word the caption only if
  needed.
- The ray drifts to HOLD during the pinch: nothing happens (by design); pinch again.
- The PC row is slow: the table's decision is posted when the card is answered; refresh the page once.

## Post

- Real time. Trim the outcome reading to about 12 s. Cut-away to the PC for 3-4 s with the tag "PC", crop to the row.
- Duck the music under every Glim line (the app already does; check the levels).
