# Dry run, night of 2026-11-17: a first full cut tonight, fixes and re-takes tomorrow (2:19, on the picked cue)

The first tour now *is* the story (owner, 2026-11-17): a blank table, ADD the tutorial project, it draws itself, a wing,
a scan, its findings, the decision cards, talk, the end. So the film's spine is **one uninterrupted first-run take** of
that tour on the headset, not the scene-by-scene set of scenes.md (written before the tour was rebuilt). Tonight: film
the spine twice, cut a rough version to a temporary cue, and list what to fix. Tomorrow (18th, upload by 18:00 CET,
deadline 21:00 CET): app fixes, re-takes of the weak beats, the final cue, captions, export.

Method, from the registry (media-generation: `live-system-demo-film`, `trailer-structure`):
- **The dry walk is the beat list** (prototype-the-cut-from-stills-and-a-dry-walk): film what the product actually does
  on the staged data, keep what it does better than the script, drop any claim it does not show. Note every wait (the
  drawing, the scan) and write the caption about its end state, not the wait.
- **Cue first** (cue-first-assembly): pick the music before the fine cut, mark its sections, cut picture to the marks.
  Changing the cue later is a re-cut. A cue with no breath before its peak is rejected however good it sounds.
- **The bed sits under Glim** (music-bed-sized-to-the-finished-cut): about -20 dB, ducked further while he speaks;
  judge it only under his voice in the rendered film, never alone.
- **Reset the stage between takes**: every take starts from `film-prep.mjs --first-run`, never from the last walk.

## The cue (picked 2026-11-17): "Vinyl Crackles & Rhodes", 2:19.2, 84.8 bpm

The film is the cue's length: **2:19**. Marks from gravitone's music-clip analysis (`analyze --dry`, local DSP; the
folder is `apps/vr/Saved/demo/cue/`, `music-clip/timeline.json`). One bar is 2.83 s; per-bar intensity 0..1.

| Mark | Time | The music |
|---|---|---|
| Intro | 0:00-0:23 | Rhodes and crackle (0.25), lifting from 0:12 (0.35-0.44) |
| **Drop** | **0:23.4** | the beat enters (0.77) |
| Groove A | 0:23-1:03 | steady drive (0.7-0.87) |
| **Breath 1** | **1:03.0-1:08.6** | two bars nearly empty (0.20, 0.41) |
| Groove B | 1:08.6-1:22.7, easing to 1:31.2 | drive (0.8-0.91), then softer (0.5-0.58) |
| Peak 1 | 1:31.2-1:45.3 | the loudest yet (0.86-0.95) |
| **Breath 2** | **1:45.3-1:53.8** | the big pause (0.37, 0.12, 0.36) |
| **Final peak** | **1:53.8-2:05.0** | full energy (0.93-0.94) |
| Tail | 2:05.0-2:19.2 | falls away (0.24, 0.06) |

## The spine: one first-run take (about 3-4 min raw), cut to the cue's 2:19

| Act | Tour step | What the camera sees | Glim (spoken + caption) | Film caption (ours) | On the cue |
|---|---|---|---|---|---|
| Hook | (S1 web, optional) | the web blueprint flying into a wing | none | "A software product is thousands of files and a list of tickets." | 0:00-0:08 intro |
| 1 Hello | welcome | blank lit table, Glim turns on | "Hi, I'm Glim. I turn your code into a building we decide on." | "Put on the headset." | 0:08-0:16 intro |
| 2 Add | add-project | PROJECTS, The tutorial project; **the pinch on ADD lands on the drop** | "First, your project. Pinch ADD, and we start with the tutorial one." | "Add a project." | 0:16-0:23.4 |
| 3 Drawn | drawing | the building draws itself (sped up about x1.5) | "I'm reading your project now. Watch it draw itself." / "There it is: your building, drawn." | "Glim reads the code and draws it." | 0:23.4-0:43 groove A |
| 4 Read it | look-wing | the hand taps a wing; its rooms rise | "Each wing is one area of your product. Each room, one thing it does." | "Wings are areas. Rooms are what they do." | 0:43-1:03 groove A |
| 5 Scan | scan-first | Glim's line in the breath; **SCAN pinched as the beat returns** | "Now let's check it. Pinch SCAN, and I'll read every room." | "Then a scan reads every room." | 1:03-1:08.6 breath 1 |
| 6 Findings | findings | Glim flies room to room, rooms light, findings land (sped up) | "What needs you comes out as a decision card." (on the softer bars) | "What needs a person becomes a card." | 1:08.6-1:31 groove B |
| 7 Decide | standup | the first card opens on the downbeat; read it; **the hand hovers in the pause; APPROVE pinched on the final peak's downbeat**, the stamp lands | "Each card is one decision. Approve it, or leave it for later." | "Decide by hand, one card at a time." | 1:31.2-1:53.8 peak 1 + breath 2 |
| 8 Ask | talk | hold Glim; the sample exchange | "Not sure? Hold me, or TALK on your wrist, and ask." | "Or just ask." | 1:53.8-2:05 final peak |
| 9 Again | hand-off | Glim goes home | "That's your morning: add a project, scan it, decide. See you tomorrow." | "Tomorrow, it opens with what moved." | 2:05-2:12 tail |
| End | (S8 card) | title on black | none | "Developer's Blueprint · Productivity · Hands only" | 2:12-2:19 tail |

The three sync points that carry the film: **ADD on the drop (0:23.4)**, **SCAN as the beat returns (1:08.6)**,
**APPROVE on the final peak (1:53.8)**. Pick them in the takes by their frame, then slide the takes to the marks;
never move the cue. Speed-ups only where Glim is silent (the drawing, the scan).

If the takes leave time and the PC link holds, the linked inserts from scenes.md S5 (YESTERDAY on the wall) and S6
(a live talk turn) can replace act 7's or 8's sample footage tomorrow. They are not tonight's goal.

## Unattended: the film from a resting headset (built 2026-11-18, `apps/vr/tools/film/`)

The headset lies on the desk on USB; nobody wears it. The Development APK must be installed (it has the console; the
judged Shipping APK does not). Three commands make the whole film; a re-take is the first one again.

```
node apps/vr/tools/film/quest-take.mjs --name take5          # about 2:30: a first run, cue-locked, recorded on the headset
node apps/vr/tools/film/auto-edl.mjs --take apps/vr/Saved/demo/takes/take5 \
  --web apps/vr/Saved/demo/web/s1-take1.mp4 --web-still apps/vr/Saved/demo/web/web-plan-still-take1.mp4
node apps/vr/tools/film/compose.mjs apps/vr/Saved/demo/out/take5.edl.json [--preview] --stills   # 25 s preview, 55 s full
node apps/vr/tools/film/web-take.mjs --scene s1 --out apps/vr/Saved/demo/web/s1-take2.mp4         # re-film the web hook (3.5 min)
```

- **quest-take** clears the app's data (a true first run), turns the bed off, grants the microphone, keeps the display
  awake (`prox_close`), records the eye buffers (`screenrecord` 3664x1920) and the log with device time, and drives the
  tour over the console: ADD, the highlighted wing, SCAN at ADD + 45.2 s, APPROVE at SCAN + 45.2 s (the cue's spacing),
  the talk sample. The hands are not shown (the synthetic hand does not act while the headset counts as worn).
- **auto-edl** lays the take on the cue with one offset (ADD on 23.4) and prints the sync error of SCAN and APPROVE;
  Glim's clean WAVs go where the app played them (`BpVoice: plays`), with our caption on top and his words below.
- **compose** renders: left-eye crop, the bed at -20 dB ducked 8 dB under Glim, burned captions, -14 LUFS; `contact.png`
  in `<out>.stills/` to review without watching.

Status 2026-11-18 03:30: **v3** `apps/vr/Saved/demo/out/v3.mp4` (2:19, 1080p, -13.8 LUFS), from take5 and
`apps/vr/tools/film/edl.v3.json`. The owner's notes of 01:00, each done: an intro title layer (`intro.html`, 0-12 s); the
web's new project (12-17.4); web and headset onboarding the tutorial project side by side, both pressing ADD on the drop
(split 17.4-47.5, `compose.mjs` splits[]); the headset 20 % wider (`BpView.Bench -13 0 32 10`); Glim 20 % quieter
(-1.94 dB); the talk sample's reply no longer repeats the tour's line. Rebuild v3:
`node apps/vr/tools/film/auto-edl.mjs --take apps/vr/Saved/demo/takes/take5 --intro apps/vr/Saved/demo/web/intro-take3.mp4
--web-onboard apps/vr/Saved/demo/web/onboard-take2.mp4 --web-action 6.0 --web-new apps/vr/Saved/demo/web/new-project-take1.mp4
--split-end 47.5 --out apps/vr/Saved/demo/out/v3.edl.json` then compose. Known: the left desk's top behind Glim (an editor
fix); no hands on screen.


## Before the first take (once, about 10 min)

1. The newest Shipping APK is installed (`bp-Android-Shipping-arm64.apk`, 2026-11-17 23:2x, tour v4).
2. **OVR Metrics overlay OFF** (it would be filmed). Guardian boundary set, room lit evenly, nothing identifiable in
   passthrough (not used by the tour).
3. Headset recorder: Settings > Camera (or the quick-settings Record video), 1080p if offered, landscape; note where the
   files land (`/sdcard/Oculus/VideoShots`). Check one 10 s test clip plays back with Glim's voice in it.
4. `node apps/vr/tools/film-prep.mjs --first-run` (stops the app, clears its data, music bed OFF, starts it).

## Each take

1. `node apps/vr/tools/film-prep.mjs --first-run` (from the PC; a fresh first run every time).
2. Start the headset recorder, then put the headset on and confirm the boundary.
3. Play the tour by hand, slowly; let each line finish; look at what Glim names. Pinch ADD, tap the wing, pinch SCAN,
   pinch APPROVE, hold Glim. Do nothing during the drawing and the scan except look at them.
4. Stop the recorder at the hand-off. Pull: `adb pull /sdcard/Oculus/VideoShots <folder>` into
   `apps/vr/Saved/demo/2026-11-17/` (git-ignored); name `spine-take<N>.mp4`.
5. Note in the take log below: what stalled, what read badly, any frame with a name, code or address.

Two takes tonight. A third only if both failed at the same beat (then that beat is an app fix, not a take problem).

## The rough cut tonight

1. **The cue**: "Vinyl Crackles & Rhodes" (picked; frozen: every note from here on is a picture note).
2. The marks are above (re-run `npx tsx pipeline/music-clip.mts analyze "<bp>/apps/vr/Saved/demo/cue" --audio "<bp>/apps/vr/Saved/demo/cue/cue.mp3" --dry` in gravitone-gcloud if the file changes).
3. Lay the cue on the timeline first, then the three sync points (ADD, SCAN, APPROVE), then fill the acts between them.
4. Glim's lines stay whole; speed-ups only where he is silent (the drawing, the scan). The bed at -20 dB, ducked about
   a further 8 dB under each line.
5. Captions burned in (ours above, Glim's words below), plus an `.srt`.

## Take log

| Take | Time | Result | Stalled / read badly | Names, codes, addresses seen |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |

## Tomorrow (2026-11-18)

- Morning: app fixes from the take log (rebuild about 12 min each), one re-take of each weak beat, or a whole spine.
- Midday: final cue picked and frozen, then the fine cut on its marks (no cue change after this point).
- Afternoon: captions, mix, export, watch once on a phone and once on a laptop, upload by 18:00 CET, link into Devpost.

## Suno prompts (the candidates; the owner picked a lofi Rhodes cue, above)

Each is laid out as the cue the cut needs: a quiet intro for the hello, the rhythm entering for the drawing, drive
under the scan, **a one-bar stop before the peak** (the first decision card), the peak under APPROVE and the talk, a
short tail for the title. Paste the style into Suno's style box and the bracketed structure into the lyrics box with
Instrumental on. No artist names (Suno refuses them; the style words carry the sound).

1. **Late-night lofi blueprint.** Style: `lofi hip hop, instrumental, 84 bpm, dusty boom bap drums, warm Rhodes chords, soft upright bass, vinyl crackle, tape wow, mellow and focused, no vocals, clean section changes`. Structure: `[Intro: Rhodes and crackle only, 8 bars] [Verse: drums enter, 16 bars] [Verse 2: bass walks, light percussion, 16 bars] [Build: filter opens, 8 bars] [Break: one bar of silence] [Chorus: full groove, brighter chords, 16 bars] [Outro: Rhodes alone, fades, 4 bars]`
2. **Electro swing studio.** Style: `electro swing, instrumental, 120 bpm, swung four-on-the-floor kick, 1930s big band brass stabs, muted trumpet hook, walking upright bass, ragtime piano, vinyl crackle, playful and confident, clean breaks`. Structure: `[Intro: crackly piano alone, 4 bars] [Verse: kick and bass enter, 16 bars] [Verse 2: brass stabs answer, 16 bars] [Build: snare roll and rising brass, 8 bars] [Stop: one bar of silence] [Chorus: full band, trumpet hook, 16 bars] [Outro: piano and a final brass hit]`
3. **Drafting-room jazzhop.** Style: `jazzhop instrumental, 90 bpm, brushed snare, mellow saxophone pads (no lead line), nylon guitar chords, deep sub bass, rain-on-window texture, calm then uplifting, distinct sections`. Structure: `[Intro: guitar and rain, 8 bars] [Verse: brushed drums enter, 16 bars] [Verse 2: sax pads join, 16 bars] [Build: drums double, 8 bars] [Break: one bar, just rain] [Chorus: fuller drums, warm sax chords, 16 bars] [Outro: guitar alone, 4 bars]`
4. **Swing house morning.** Style: `electro swing house, instrumental, 124 bpm, punchy swung kick, chopped clarinet and trombone samples, double bass, Charleston piano riff, hand claps, bright and optimistic, sidechained, big drops with clean stops`. Structure: `[Intro: filtered piano riff, 8 bars] [Verse: kick and claps enter, 16 bars] [Verse 2: clarinet answers, 16 bars] [Build: riser and snare roll, 8 bars] [Stop: one bar of silence] [Drop: full band, horns, 16 bars] [Outro: piano riff alone, final hit]`
5. **Chillhop with a swing lift.** Style: `chillhop instrumental, 92 bpm, swung hip hop drums, muted jazz trumpet chords, vibraphone, upright bass, soft vinyl texture, warm and curious, builds to a confident swing groove, clear section boundaries`. Structure: `[Intro: vibraphone alone, 8 bars] [Verse: drums and bass enter, 16 bars] [Verse 2: trumpet chords, 16 bars] [Build: drums open up, 8 bars] [Break: one bar of silence] [Chorus: full swing groove, 16 bars] [Outro: vibraphone, 4 bars, ring out]`

The bars are approximate: at 84-124 bpm the structure runs about 2:30-3:20, and Suno drifts. Ask for the full song
(extend if it ends early), export the WAV, and the music-clip analysis gives the real marks to cut to.
