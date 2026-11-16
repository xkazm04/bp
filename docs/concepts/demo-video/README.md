# Demo video: the story

Written 2026-11-11 for the Meta VR Start Developer Competition 2026 (entries close 2026-11-18 12:00 PT, which is
21:00 CET). Filming 2026-11-16/17. This page is the strategy; the timed script is [scenes.md](scenes.md), one setup per
scene is in [shots/](shots/), the tools are in [capture-plan.md](capture-plan.md), and what must happen before filming is
in [readiness.md](readiness.md). It replaces the 10-shot list in
[`../recording/submission-draft.md`](../recording/submission-draft.md) (that page keeps the Devpost text).

## The promise, in one line

Your codebase drawn as an architect's building on a light table, with Glim, a drafting lamp who reads it for you, asks
before he acts, and greets you each morning with what your decisions became.

## The arc

The owner's story (2026-11-11): start on the web, cross into VR, onboard a project in sped-up time with web and VR side by
side, a scan, then the stand-up and talking with Glim.

| Act | Scenes | What the viewer learns | Earns |
|---|---|---|---|
| I. The problem | S1 cold open on the web | A product is too big to see. Here it is as a building. | Innovation |
| II. The drawing | S2 the crossing, S3 onboarding (split) | The same drawing lies on a table in VR. Point it at a repository and both screens draw what the agent learns. | Innovation, Technical, First Five Minutes, Experience Design |
| III. The agent that asks | S4 the scan | Glim does the legwork where you can see it, and the result waits for your decision. | Agentic Interaction, Polish |
| IV. The morning ritual | S5 the stand-up, S6 talking with Glim | Each morning: what yesterday's yeses became, then today's decisions by hand. Ask Glim what next; he opens it and puts a card up for your yes. | Experience Design, Agentic Interaction, Technical (hands, field-of-view UI), Reason to Come Back |
| V. Come back tomorrow | S7 your room (optional), S8 end card | It fits your real desk; tomorrow it opens with what moved. | Reason to Come Back, Accessibility, Technical (passthrough, frame rate) |

Accessibility is carried by every frame (in-app captions on every spoken line, hands only, seated) more than by one shot.
If S7 is cut, its 6 s goes to a TEXT SIZE 130 % insert instead (see [shots/s7-your-room.md](shots/s7-your-room.md)).

## Tone

Calm and exact, like a drawing office in the early morning. Few words on screen, each one true. No hype words, no
countdowns, no claims the footage does not show. Glim is playful but brief. Let the table and the wall do the talking;
cut on motion, hold on the moments that land (a room rising, the stamp on APPROVE, BEFORE and AFTER).

## The 3:00 budget (aim 2:50)

| Act | Scene | Time | Length |
|---|---|---|---|
| I | S1 Cold open: the product as a blueprint (web) | 0:00-0:14 | 14 s |
| II | S2 The crossing: the table lights, Glim turns | 0:14-0:28 | 14 s |
| II | S3 Onboarding a project, web and VR split, sped up | 0:28-1:05 | 37 s |
| III | S4 A scan: Glim flies room to room, findings land | 1:05-1:29 | 24 s |
| IV | S5 The morning stand-up on the wall | 1:29-2:01 | 32 s |
| IV | S6 Talking with Glim | 2:01-2:35 | 34 s |
| V | S7 Your room (optional; else TEXT SIZE) | 2:35-2:41 | 6 s |
| V | S8 End card: tomorrow morning, then the title | 2:41-2:50 | 9 s |
| | Margin | 2:50-3:00 | 10 s |

## Real footage and what is composited

- **Real footage, every frame.** VR from the Quest 3S itself (the headset's recorder, see capture-plan.md); the XR
  Simulator only as a fallback. The web from a screen capture of the real app on the PC. No generated video, no mock-ups.
  The web's `/crossing` page is a prototype with sketched VR parts: it is not used.
- **Composited:** S3 (web left, headset right, both sped up by the same factor, the run's own clock visible) and short
  cut-aways to the PC in S5 (the decision row on the Headsets page). The composite is labelled on screen ("PC" and
  "HEADSET") so nobody mistakes two captures for one camera.
- **Edited, and said so:** S3's speed-up is captioned with its factor; waits in S6 longer than 3 s are shortened with a
  visible time-cut marker. Nothing else is retimed.
- **Sample data, and said so:** S4 runs on the bundled Kettle sample (the page says SAMPLE). Kettle is a fictional
  fitness-studio product.

## Voice and music

- **Glim's own voice only.** His lines come from the app: the clip book (`apps/vr/Source/bp/BpTourBook.cpp`, rendered
  clips under `apps/vr/Content/BpData/voice/`) and, in S6, his live replies spoken by the PC's speech route.
- **No narrator. Captions only (recommended).** A second voice would compete with Glim and add a generated-voice
  licence question. Title captions carry the story in short lines; a transcript caption carries every word Glim says.
  Both are English and burned in; the same text goes up as an .srt with the upload.
- **Music:** the app's own music bed, as the headset recorder captures it (it already dips under Glim's voice). Raise it
  only under S1 and S8. Its licence is compliance.md P2 (the owner keeps the invoice). No other music.
- **Sound effects:** none added. What the app plays is what the viewer hears.

## The rules this must obey

From the official rules as the owner recorded them (compliance.md, submission-draft.md). The live rules page has not
been read by an agent (Devpost answered 403): the owner reads it once before export.

- Under 3 minutes. Real footage from a Quest or the XR Simulator; no AI-generated video.
- English, with English captions.
- No brand names or logos, no slogans, no recognizable branded products, no identifiable people other than the entrants.
  This includes the data on screen (feature names in Kettle, the onboarded repo's names), the browser chrome, the OS
  taskbar, the PC desktop, file paths with a person's name, and the room behind passthrough.
- Hands only: every VR action on camera is done by hand. Controllers are not shown.
- No tokens, pairing codes, network addresses or keys on screen (the Headsets page's Wi-Fi line names an address; the
  headset's PC LINK page shows the code while pairing: neither is filmed).
- Claims on the end card (frame rate, hands only) only once checked with a person wearing the headset.
