# Dry run, night of 2026-11-17: a first full cut tonight, fixes and re-takes tomorrow

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

## The spine: one first-run take (about 3-4 min raw, cut to about 2:00)

| Act | Tour step | What the camera sees | Glim (spoken + caption) | Film caption (ours) | Target in the cut |
|---|---|---|---|---|---|
| Hook | (S1 web, optional) | the web blueprint flying into a wing | none | "A software product is thousands of files and a list of tickets." | 0:00-0:10 |
| 1 Hello | welcome | blank lit table, Glim turns on | "Hi, I'm Glim. I turn your code into a building we decide on." | "Put on the headset." | 0:10-0:20 |
| 2 Add | add-project | PROJECTS, The tutorial project, the hand pinches ADD | "First, your project. Pinch ADD, and we start with the tutorial one." | "Add a project." | 0:20-0:32 |
| 3 Drawn | drawing | the building draws itself (12 s; speed up x2 if long) | "I'm reading your project now. Watch it draw itself." / "There it is: your building, drawn." | "Glim reads the code and draws it." | 0:32-0:52 |
| 4 Read it | look-wing | the hand taps a wing; its rooms rise | "Each wing is one area of your product. Each room, one thing it does." | "Wings are areas. Rooms are what they do." | 0:52-1:05 |
| 5 Scan | scan-first | SCAN pinched; Glim flies room to room | "Now let's check it. Pinch SCAN, and I'll read every room." | "Then a scan reads every room." | 1:05-1:25 |
| 6 Findings | findings | rooms light as read; findings land | "What needs you comes out as a decision card." | "What needs a person becomes a card." | 1:25-1:35 |
| 7 Decide | standup | the first card; the hand pinches APPROVE | "Each card is one decision. Approve it, or leave it for later." | "Decide by hand, one card at a time." | 1:35-2:00 |
| 8 Ask | talk | hold Glim; the sample exchange (unlinked) | "Not sure? Hold me, or TALK on your wrist, and ask." | "Or just ask." | 2:00-2:20 |
| 9 Again | hand-off | Glim goes home | "That's your morning: add a project, scan it, decide. See you tomorrow." | "Tomorrow, it opens with what moved." | 2:20-2:35 |
| End | (S8 card) | title on black | none | "Developer's Blueprint · Productivity · Hands only" | 2:35-2:50 |

If the takes leave time and the PC link holds, the linked inserts from scenes.md S5 (YESTERDAY on the wall) and S6
(a live talk turn) can replace act 7's or 8's sample footage tomorrow. They are not tonight's goal.

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

1. **Temporary cue**: the best of the Suno candidates (prompts below), the full 2:50-3:00 version.
2. Mark the cue (beats, bars, sections) with gravitone's music-clip analysis, which is local DSP with no vendor call:
   put the mp3, a `style.txt` (the prompt) and a `lyrics.txt` holding `[Instrumental]` in one folder, then
   `npx tsx pipeline/music-clip.mts analyze "<folder>" --dry` in `C:\Users\kazda\kiro\gravitone-gcloud`. Read
   `music-clip/timeline.json`: `bpmGlobal`, `sections` (start, end, intensity), `beats`.
3. Put the acts on the cue's marks: hook on the intro, acts 1-3 on the first section, the drawing's finish on a
   downbeat, the scan (act 5) where the rhythm drives, the breath before the peak on the first card (act 7 starts in the
   pause), the peak under APPROVE and the talk, the tail under the hand-off and the title.
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

## Suno prompts (owner picks one; instrumental, 2:50-3:00)

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
