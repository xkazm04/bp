# Submission draft: Devpost text and the video's shot list

Drafted 2026-11-04 for the Meta VR Start Developer Competition 2026 (entries close 2026-11-18, 12:00 PT). Track
**Productivity**, division **New Experience**. Everything below is a draft for the owner to edit. Lines marked
**[owner]** need a fact only the owner has. The rules this answers are in [`../vr-light-table/compliance.md`](../vr-light-table/compliance.md)
and the owner's pasted rules (section 4: the text must cover inspiration, how it was built, future plans and a target
launch date; the video must be under 3 minutes, real footage on a Quest or the XR Simulator, public on YouTube or Vimeo).

## Devpost text

**Tagline (one line).** Your codebase as an architect's drawing on a light table: lift a wing, step into a room, and
decide what gets built next, with your hands.

### Inspiration

Software teams lose the shape of their product. The code is thousands of files, the backlog is a list, and nobody can
see the whole building at once. Architects solved this a long time ago with the drawing set: a site plan, wings, rooms,
fixtures, read at any zoom on a backlit table. Developer's Blueprint gives a software product that drawing, and puts the
person at the table in the morning, where the day's decisions are made.

### What it does

- **The product as a building.** Domains are wings, capabilities are rooms, features are fixtures. The sample product,
  Kettle (a fictional studio app with 5 wings, 13 rooms and 133 features), is drawn on a 166 cm blueprint under glass.
- **Lift and dive with your hands.** Pinch a wing and pull it toward you: it rises off the paper. Pull a room up, then
  once more to step inside it, where the room's map, its pins and a screen deck stand in front of you. Push away to
  step back out.
- **Pins are what the last scan found.** Each lens (security, performance, development, business) scans the code and
  leaves findings as pins. Hold a feature and Glim, the lamp, turns to it and tells you its open findings, its health
  by lens and when it was last scanned.
- **One decision per screen.** The deck shows the room's open decisions, most urgent first. Tap APPROVE to put a
  finding into the next wave of agent work, or DECLINE it.
- **A companion that teaches.** On first launch Glim walks you through the table one gesture at a time, by voice and
  caption, and waits for you; leave a step alone and it shows you once. It pauses when you take the headset off and
  picks up where you were.
- **A daily moment.** Productivity's "habit tied to a recurring context": the morning round. Sit down, see what moved,
  take today's decisions, go.

### How we built it

- **Unreal Engine 5.8** with the **Meta XR plugin v207** and the **Interaction SDK** for hand tracking (pinch, pull,
  push, hold, tap). Seated and hands-first: every action works within arm's reach, with no controller.
- **The drawing is data, not art.** The table reads the product's structure and its plan layout as JSON and draws every
  wing, room and fixture at runtime: instanced shells, a render-target sheet for the paper, and text sized by a
  legibility rule (every text class at or above its readable angle from the seated eye).
- **Runs on the headset alone.** The judged build carries a bundled snapshot of the sample product, so it needs no PC
  and no server. With a paired home server the same app reads live products.
- **The companion's voice** is Glim's own designed voice (ElevenLabs Voice Design), rendered ahead of time for the tour
  and played from the lamp in 3D. Take it away and the tour still runs, by caption.
- **A Quest tier** in the same scene: texture caps, no occlusion queries, fixed foveation, cheaper haze and hand shadow,
  so the headset holds its frame rate without forking the art. **[owner: the on-device fps after the weekend]**
- Art: procedural Blender builds plus CC0 materials and models; image-generated concept work only for the night-city
  backdrop and wall drawings. **[owner: confirm against compliance.md before submitting]**

### Challenges we ran into

- Building for Quest from a Windows-on-ARM laptop: no Android Studio, the NDK's x64 tools under emulation, and a
  linker that crashed under the build accelerator.
- Text in VR: a blueprint is dense. Every label is sized by the angle it subtends from the seated eye, and the far
  labels set the limit, not texture resolution (we measured: 8192 px sheets read the same as 4096).
- A tour that never fights your hands: the steps read where the table is, not where a script thinks it is.

### Accomplishments we're proud of

- A whole product readable at a glance, with three levels of zoom done by moving the drawing, never the person.
- Hands-only from the first second, with an onboarding that teaches by asking, not by a wall of text.

### What's next

- Live products over a paired home connection for the daily stand-up (the server half is built).
- Voice questions to Glim (speech to text), and the companion answering live instead of from the tour.
- More lenses and the agent swarm's progress shown room by room.
- **Target launch date: [owner]** (Meta Horizon Store, Productivity).

### Hand interactions (for the form)

| Gesture | Does |
|---|---|
| Pinch a wing, pull toward you | Lift the wing (level 1) |
| Pinch a room, pull up; pull again | Lift the room (level 2); step inside (room mode) |
| Pinch, push away | One level back; out of room mode |
| Hold a feature (point and wait) | Glim tells you about it |
| Hold the lamp's head (in a room) | Glim takes you to the next most urgent room |
| Tap a deck button | APPROVE / DECLINE / next screen |
| Pinch-drag a loop on the map | Lasso features into the draft wave |
| Tap the wrist panel | Rooms, projects, TOUR, SEAT |

## The video: under 3 minutes, real footage

Footage: on the Quest (the owner's weekend session; Quest's own recorder or scrcpy), or the XR Simulator. No
AI-generated video. Lead with the story, then the gestures. Captions on every shot (English).

| # | Time | Shot | Source |
|---|---|---|---|
| 1 | 0:00-0:12 | Black, then the studio at night, the table lights up. Title: "Your codebase, drawn like a building." | Headset, cold start |
| 2 | 0:12-0:35 | Glim's welcome and the first pinch: a wing lifts. Hold on the hand. | Headset, the tour's steps 1-2 |
| 3 | 0:35-1:05 | The most urgent room rises, the second pull dives inside: map, pins, deck. | Headset, steps 3-4 |
| 4 | 1:05-1:30 | Hold a feature; Glim turns and answers. | Headset, step 5 |
| 5 | 1:30-1:55 | Decide: APPROVE on the deck; the next screen comes forward. | Headset, step 6 |
| 6 | 1:55-2:20 | Hold the lamp: next room. Lasso three features. | Headset, free play |
| 7 | 2:20-2:45 | (If live works by then) the web page and the table following each other, side by side. | Composite, record-demo.mjs --stack |
| 8 | 2:45-2:58 | Push back out to the whole site plan. End card: name, track, "hands only". | Headset |

Cut list rules: every shot shows real hands; no shot longer than 30 s; the caption text in each frame must read at
1080p (the lamp's caption is the smallest text that matters).
