# Submission draft: Devpost text and the video's shot list

Drafted 2026-11-04, rewritten 2026-11-10 after night two, for the Meta VR Start Developer Competition 2026 (entries close
2026-11-18, 12:00 PT). Track **Productivity**, division **New Experience**. Everything below is a draft for the owner to
edit. Lines marked **[owner]** need a fact only the owner has. Lines marked **(to confirm)** describe something built and
proven on the PC, or seen only on an unattended headset, that a person has not yet tried wearing it: check it with
[`../vr-light-table/headset-morning-check.md`](../vr-light-table/headset-morning-check.md) before the claim goes in. The
rules this answers are in [`../vr-light-table/compliance.md`](../vr-light-table/compliance.md); what was measured and
where is in [`../vr-light-table/runs/2026-11-10-night-two.md`](../vr-light-table/runs/2026-11-10-night-two.md).

The rules, as the owner recorded them: four criteria at 25 % each (Innovation, Experience Design, Technical, Polish and
Presentation); at least 60 fps on Quest hardware; hands, field-of-view-aware UI, and passthrough only where it has a
purpose; clear onboarding and a habit-forming purpose; no brand names, logos or ads, no identifiable people, licences for
third-party assets; a video under 3 minutes of real footage from a Quest or the XR Simulator (no AI video); the text covers
inspiration, how it was built, future plans and a target launch date; English; fully usable with hands only.

**Third-party names are left out of the text below on purpose** ("a cloud speech service", "a coding agent CLI", "a
real-time 3D engine"). **[owner]** decide whether naming the engine in "How we built it" is allowed; the safe reading of
the brand rule is no.

## Devpost text

**Tagline (one line).** Your codebase as an architect's drawing on a light table: hold the morning stand-up with a desk
lamp that plans with you, and decide what gets built today, with your hands.

### Inspiration

Software teams lose the shape of their product. The code is thousands of files, the backlog is a list, and nobody can
see the whole building at once. Architects solved this long ago with the drawing set: a site plan, wings, rooms,
fixtures, read at any zoom on a backlit table. Developer's Blueprint gives a software product that drawing, and puts the
person at the table in the morning, where the day's decisions are made, with a companion that does the legwork and
asks before it acts.

### What it does

- **The product as a building.** Domains are wings, capabilities are rooms, features are fixtures. The sample product,
  Kettle (a fictional studio app with 5 wings, 13 rooms and 133 features), is drawn on a backlit blueprint.
- **Tap, lift and step in with your hands.** Tap a wing to lift it, tap a room to raise it, pull it once more to step
  inside, push away or tap BACK to step out. Controllers work too and add, never replace: thumbstick to move the focus, A
  to select, B to go back. **(to confirm: the tap and the controllers on the headset)**
- **The morning stand-up.** The console's STAND-UP page goes through what needs you since your last visit, one decision
  per card. Each card raises its room on the plan and shows the screen the finding is about. APPROVE, LATER or HOLD. The
  words on the card are sent with the answer and kept in the decision log, so every decision says what the person saw.
- **Plan my day.** With the PC linked, PLAN MY DAY asks the companion to compose today's work from what you approved. It
  answers in plain words, and anything it wants to run comes back as a card you approve or decline at the table.
- **Hand over, within bounds.** HAND OVER FOR TODAY lets the companion handle one product for a few hours: four kinds of
  action at most, never a stop-ship finding, at most 12 hours, shown in words before you confirm. TAKE BACK on the bar or
  the wrist ends it at once. **(to confirm on the headset)**
- **Talk to the lamp.** Hold X, pinch and hold the lamp, or hold TALK on the wrist. The first time, a sheet says in plain
  words where your voice goes; nothing is recorded or sent without ALLOW, and the microphone permission is asked only
  then. The lamp's light shows when it listens, thinks and answers; your words appear as a caption and the reply is spoken
  and captioned. **(to confirm: the permission dialog and real speech on the headset)**
- **Your room.** One tap fades the studio out and puts the table on your real desk through passthrough, so you can see
  your keyboard, a notebook or a colleague while you plan. One tap brings the studio back. The choice is remembered.
  **(to confirm: how it looks to a person)**
- **Runs alone, or linked.** The judged build carries a sample of Kettle and runs with no PC. With the owner's PC paired
  (a 6-character code approved on the PC), the same app reads live products over the USB cable or over Wi-Fi.
- **A companion that teaches.** On first launch Glim, the lamp, walks you through the table one gesture at a time, by
  voice and caption, and waits for you. The tour ends on your first real stand-up decision.

### How we built it

- A real-time 3D engine with the Quest platform's XR plugin and interaction SDK for hand tracking (tap, pinch, pull,
  push, hold). Seated and hands-first: every action is within arm's reach. **[owner: name the engine or not]**
- **The drawing is data, not art.** The table reads the product's structure and plan layout as data files and draws every
  wing, room and fixture at runtime, with text sized by a legibility rule (every text class at or above its readable
  angle from the seated eye).
- **A main panel where the eye already is.** The console sits in the best part of the field of view, in front of you and
  slightly below the line of sight; the wrist keeps only quick actions and turns to face your eye by itself.
- **The PC link.** A small home server serves the product's live state. A headset pairs with a one-time code the owner
  approves on the PC and gets a token scoped to what it may do; every decision from the headset is recorded with the
  device and the words shown. A decision from the table can approve only what a table grant could cover; anything wider
  waits for the PC. Turns and speech have per-device limits.
- **Speech goes through the PC.** The headset records only while you hold to talk; the PC sends the recording to a cloud
  speech service and speaks the companion's answer in Glim's designed voice. The companion runs through a coding agent
  CLI on the PC.
- **A Quest tier in the same scene**: cheaper studio materials, the table glass off, fixed foveation, so the headset keeps
  its frame rate without forking the art. Measured on a Quest 3S on 2026-11-09/10: 72 fps at rest and with the console
  open, and 8.4 to 10.9 ms of GPU time per frame in every state measured after the night's performance work (the 72 Hz
  budget is 13.9 ms). These were taken
  with the headset still on a desk; a measurement with a person wearing it is **(to confirm)**.
- Art: procedural 3D builds plus CC0 materials and models; generated images only for the night-city backdrop, the wall
  drawings and the sample product's screens; generated music and voice. **[owner: confirm against compliance.md before
  submitting]**

### Challenges we ran into

- Building for Quest from an ARM laptop the mobile toolchain does not support: no official IDE installer, the native
  compiler tools under x64 emulation, and a linker that crashed under the build accelerator.
- Text in VR: a blueprint is dense. Every label is sized by the angle it subtends from the seated eye.
- The frame budget: the studio's original materials cost 21.2 ms of GPU time on the headset; a cheap lit material
  brought it to 13.0 ms, and hiding the table glass to 10.7 ms with no visible difference.
- Things only the device shows: the lamp vanished in passthrough until it got a self-lit material, and the engine deleted
  the app's settings file at every launch until the app kept its own.
- Letting an agent act without letting it run away: every action is a card, a hand-over is bounded and ends with one tap,
  and the headset can never approve more than it could grant.

### Accomplishments we're proud of

- A whole product readable at a glance, with three levels of zoom done by moving the drawing, never the person.
- A morning ritual you can finish in a few minutes, where every decision is recorded with what you were shown.
- An agent you can talk to that asks before it acts.

### What's next

- Speech recognition on the PC itself, with the cloud service as an opt-in fallback.
- An encrypted link between headset and PC, and the token kept in the headset's secure storage.
- More lenses, and the agent's work shown room by room as it builds.
- **Target launch date: [owner]** (Meta Horizon Store, Productivity).

### Hand interactions (for the form)

| Gesture | Does |
|---|---|
| Pinch-tap a wing or room | Lift the wing; raise the room |
| Pinch a room, pull toward you | Step inside (room mode) |
| Pinch, push away, or tap BACK on the console | One level back |
| Hold a feature (point and wait) | Glim tells you about it |
| Tap MENU on the console bar | The pages: rooms, scan, stand-up, ask, projects, packages, settings, PC link |
| Tap APPROVE / LATER / HOLD on a stand-up card | Answer the decision |
| Pinch and hold the lamp, or hold TALK on the wrist | Talk to the lamp |
| Look at the left wrist | Quick actions: MENU, TOUR, TALK, the waiting decision |
| Pinch-drag a loop on the map | Lasso features into the draft wave |

Controllers (optional): thumbstick moves the focus, A selects (twice to approve), B back, Y or menu opens the console,
stick click goes home, hold X to talk.

## How the build answers the judging

| Criterion or award | What in the build answers it | Status | Shot |
|---|---|---|---|
| Innovation (25 %) | A codebase drawn as an architect's building; the agent as a desk lamp you talk to; decisions recorded with the words shown | built; talk with real speech to confirm | 1, 4, 6 |
| Experience Design (25 %) | Onboarding: the tour, one gesture at a time, ending on a real decision. Habit: the morning stand-up, with a "since your last stand-up" replay | tour on the headset with hands to confirm | 2, 4 |
| Technical (25 %): 60 fps | 72 fps measured on a Quest 3S (at rest, console open); GPU 8.4 to 10.9 ms against 13.9 ms | measured unattended; with a wearer to confirm | 9 (end card) |
| Technical: hands | Every action works by hand; controllers add | tap and full hands-only run to confirm | 2, 3 |
| Technical: field-of-view-aware UI | The console in the deck slot below the line of sight; the wrist turns to face the eye; text sized by angle | wrist on a real arm to confirm | 2, 4 |
| Technical: purposeful passthrough | Your room: see your real desk while you plan; the table and lamp stay; one tap back | passthrough active and measured; the look to confirm | 8 |
| Polish and Presentation (25 %) | The lamp's light states, the studio floor, the sheet language on every panel, a music bed that dips under the voice | built; loudness to confirm | all |
| Agentic Interaction | PLAN MY DAY (a real companion answer and a card, approved or declined at the table); HAND OVER with bounds and TAKE BACK; spoken requests | PLAN MY DAY seen on the headset; hand-over and spoken card to confirm | 5, 6, 7 |
| First Five Minutes | The tour: hands only, voice and caption, waits for you, ends on the first stand-up decision | to confirm with a person | 2 |
| Reason to Come Back | The daily stand-up and its replay of what moved since last time; pairing, settings and the last stand-up are kept across launches | persistence seen on the headset | 4 |
| Accessibility | Captions on every spoken line; reduced motion (SETTINGS > MOTION); the wrist on either hand; voice and music volumes apart; hands or controllers; seated; talking is optional | built; not tested with users | 3, 6 |

## The video: under 3 minutes, real footage

Footage: on the Quest (the headset's own recorder) or the XR Simulator. No AI-generated video. Lead with the story,
then the gestures. Captions on every shot (English). **(to confirm)** whether the headset's recorder captures the
passthrough room (shot 8); if not, shot 8 is cut or shown in the Simulator's room.

| # | Time | Shot | Source |
|---|---|---|---|
| 1 | 0:00-0:10 | The studio at night, the table lights up, the lamp turns to you. Title: "Your codebase, drawn like a building." | Headset, cold start |
| 2 | 0:10-0:35 | Glim's welcome; tap a wing, it lifts; tap a room, pull, step inside. Hold on the hand. | Headset, the tour |
| 3 | 0:35-0:50 | Hold a feature; Glim answers by voice and caption. A second take with controllers (thumbstick, A, B), 3 s. | Headset |
| 4 | 0:50-1:20 | The stand-up: "since your last stand-up", a card with its finding's screen, its room raised; APPROVE by hand. Cut to the PC: the decision log's new line with "vr" and the words shown. | Headset; PC screen recording |
| 5 | 1:20-1:40 | PLAN MY DAY: the companion's answer, and the card it raises; approve or decline at the table. | Headset, PC linked |
| 6 | 1:40-2:05 | Talk to the lamp: the consent sheet, ALLOW; hold, speak; the lamp listens, thinks, answers; the caption. | Headset, PC linked |
| 7 | 2:05-2:20 | HAND OVER: the bounds in words, GRANT; the amber TAKE BACK; take it back. | Headset |
| 8 | 2:20-2:38 | Your room: the studio fades, the table sits on the real desk; back to the studio. | Headset (recorder support to confirm) |
| 9 | 2:38-2:55 | Push back out to the whole site plan, PC LINK showing Wi-Fi. End card: name, track, "hands only", "72 fps on Quest 3S" (only once confirmed with a wearer). | Headset |

Cut list rules: every shot shows real hands except the short controller take; no shot longer than 30 s; the caption text
in each frame must read at 1080p (the lamp's caption is the smallest text that matters); no PC desktop shows a token, a
pairing code, a network address or a third-party logo.
