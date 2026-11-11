# S6. Talking with Glim (2:01-2:35)

Script: [../scenes.md](../scenes.md#s6-talking-with-glim-201-235-headset-linked).

## Setup

- **Build:** the filming APK (watching Glim think, `2e0e6b38`, or later). Server from the repo root (companion turns fail
  otherwise), the companion's engine (the coding agent CLI) signed in on the PC, the speech route working (its keys live
  in `.env`: never on screen, never printed).
- **Data:** `kettle-live`, the stand-up of S5 not yet answered for the decision Glim will rank first (reset before the
  take), so "what should I do next?" has a clear answer and "approve it" raises a GLIM ASKS card.
- **Consent:** TALK allowed and the microphone permission granted before the take (the consent sheet and the Android
  dialog are not filmed in the main take; a separate optional take shows the TALK TO GLIM sheet for 3 s, if wanted).
- **Room:** quiet, no other voices (the headset's microphone picks up the room).
- **Settings:** VOICE 100 %, `bp.TalkSpokenMax` at its default (280 characters) so a reply stays short.

## Steps

1. Recorder on (with app audio; the wearer's microphone off in the recorder, so only Glim's voice and the app sound).
2. Pinch and hold Glim. Say "What should I do next?" Let go.
3. Keep looking at the wall while he thinks; the sheet lists his steps. Let him finish speaking.
4. Hold again: "Show me the first one." The table moves, the decision opens on the wall, Glim points.
5. Hold again: "Approve it." A GLIM ASKS card goes up. Pinch APPROVE. Hold 2 s. Stop.

## Takes to get

- At least 5 full takes (live replies differ every time; pick the clearest and shortest). Keep a log of each take's words.
- 1 take that pinches a reply button (YOU COULD SAY) instead of speaking turn 2.
- Rehearse the wording with `node scripts/glim-talk.mjs` and `BpTalk.Say` first, so the spoken questions match what works.

## What can go wrong

- The voice starts only at the end of the turn: 6 to 13 s of thinking light on the PC (2026-11-11). The streamed steps
  fill some of it; shorten the rest in the edit with a visible time-cut marker, or build the bundled "let me look" line
  (readiness.md G4).
- Speech never tried on the device with a person: the microphone dialog, recognition, timing. Must pass the dry run; if it
  fails on the day, film with `BpTalk.Say` sending the typed words and caption "typed" (no speech claim), or cut S6 to the
  sample exchange (`BpTalk.Hold 1.5` with no PC plays the bundled sample: "What should I do next?" / "Here is the one I
  would do first. Pinch me to open it on the deck."; its "on the deck" should become "on the wall", G5).
- He answers off script ("which one?" after two named items): re-take; ask with one clear subject.
- A reply names a brand from the data: G1 must be done first.

## Post

- Real time except shortened waits (each marked). Captions: the transcript of the question and of each reply in full;
  keep the reply captions on screen as long as they are spoken.
