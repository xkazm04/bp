# Readiness: from today to the upload

Written 2026-11-11. Filming 2026-11-16/17. Upload before 2026-11-18 12:00 PT (21:00 CET); aim for 12:00 CET the same
day, nine hours of margin.

## Gaps: what a scene needs that does not exist or is unproven

| # | Gap | Scenes | What to do | Who |
|---|---|---|---|---|
| G1 | **Brand names in Kettle on the web and on a linked headset.** `apps/vr/tools/bundle-words.mjs` neutralizes only the VR bundle (compliance.md P4). `packages/core/data/kettle.json`, `kettle.app-structure.json` and `kettle.findings.json` still say "Google sign-in", "Apple sign-in", "Apple and Google Wallet", "iOS app store"; `kettle-live` is built from them, and the linked headset reads them from the server. | S1, S5, S6, S8 | Apply the same neutral wording at the source (D5), rebuild `kettle-live` (`node scripts/scan-demo.mjs --reset`), and grep the served product for the brand list (`bundle-words.mjs --check` covers the bundle only; extend it to the source data). Also check the context descriptions (framework and database names) are not drawn on the web. | agent, owner approves wording |
| G2 | **No safe project to onboard on camera, and the free stand-in only clones dowser.** dowser's plan names Jira, Rovo and Atlassian; pof names tools too. `scripts/buildup/fake-onboard.mjs` hard-codes `SOURCE` to the dowser repo. | S3 | Make or pick the demo repo (D2) at a neutral path; add `--source <repo> --commit <sha>` to `fake-onboard.mjs` for rehearsals; one real run in the dry run if budget allows (D1). | agent; owner for D1, D2 |
| G3 | **Glim says nothing during the build-up.** No line exists for a project starting or finishing its read (the table shows the job's narration as text only). | S3 | Two narrate lines in `BpTourBook.cpp` NarrateLines (`buildup-start` "I'm reading it now. Watch it draw itself.", `buildup-done` "Done. <n> wings. Shall we look?" or a count-free version), clips via `apps/vr/tools/tour-voice.ts --narrate`, said from `BpBuildup.cpp` at the first event and at done. A count in a clip only works if fixed; prefer "Done. It's all on the table." | agent |
| G4 | **Glim's voice starts only when his turn ends** (6 to 13 s of thinking on the PC, 2026-11-11). Streaming steps fill some of it. | S6 | Owner's choice from night three (D8): a short bundled "Let me look." in his voice when a turn passes about 1.5 s (no cloud cost; new clips), or speak each sentence as it streams. Otherwise shorten the waits in the edit with a marker. | owner, then agent |
| G5 | The bundled sample exchange says "open it on the deck"; with the wall it should be "on the wall". | S6 fallback | Re-render `voice/talk/next.wav` with the new words, update `sample.json`. | agent |
| G6 | **Never seen on the device with a person wearing it:** the scan theatre, YESTERDAY and the welcome back, talking by speech (the microphone dialog, the streamed turn over the link), ADD A PROJECT, the wall's new look, hands-only taps on the wall. | S3-S8 | headset-morning-check.md (night three, steps 8, 9, 11-14) before or as part of the dry run. Every scene with a failed step gets its fallback from its shot file. | owner wears, agent fixes |
| G7 | `record-demo.mjs --stack` scales both takes to 960 wide and hstacks them, which fails when their heights differ. | S3 | Composite with the ffmpeg command in capture-plan.md, or fix `--stack` to crop or pad to 960x1080 each. | agent |
| G8 | **Capture settings unknown:** the recorder's resolution and fps props on this OS, whether it records passthrough, whether recording costs the app frames, where the files land. | all VR | The dry run, capture-plan.md steps 1-3. | owner, with the agent on the PC |
| G9 | The wall's redesign (2026-11-11) must be built, packaged and installed before the dry run. Every wall shot depends on it. | S4-S6, S8 | Package by 2026-11-13 evening; freeze the wall's look after the dry run. | owner, agent |
| G10 | Repeatable state between takes: approvals write the real decision log (`.bp/companion/decisions.jsonl`) and the stand-up's state. Unknown whether `scan-demo.mjs --reset` restores both. | S5, S6, S8 | Check once; if not, copy `.bp/companion/` aside before filming and restore it between takes and after. | agent |
| G11 | The tour's welcome on cue: `BpTour.Start welcome` runs on into the next step, and `BpTour.Stop` speaks "Tour stopped." | S2 | Cut in the edit (planned). Optional: a console line that plays one narrate clip by id. | agent, optional |
| G12 | The live competition rules have not been read by an agent (Devpost 403). | all | The owner reads the video section once (length, hosting, visibility, captions) before export. | owner |

## The data to use

- **Kettle** (fictional fitness-studio product, 5 wings, 13 rooms): S1 and S5-S8 as `kettle-live`, S4 as the bundled
  sample. Safe once G1 is done. Its eight fictional team members are not drawn.
- **The demo project** for S3: a repository whose every folder, package and README name is ours and neutral (D2). It is
  registered only in a scratch products file (`BP_PRODUCTS_FILE`), so the real `bp.products.local.json` is never written.
- **Never on camera:** bp, pof, dowser as products (brand and tool names in their plans); the `.env` file; a terminal
  (the server prints routes, and `BpLink` logs the token's last 4 characters); the headset's PC LINK page while pairing
  (the code); the Headsets page's Wi-Fi line (an address); a typed path holding a person's name; browser autocomplete.

## Risks

- **Money and time.** A real onboarding cost $11.00 and 17.4 min on dowser (n=1). Budget two real runs ($25 at most) and
  rehearse with the free stand-in. Companion turns in S6 cost cents each (night three: $0.49 for three turns); budget 20
  takes.
- **Live replies differ every take** (S6): film many, pick one; never edit his words, only the waits between them.
- **The headset sleeps when lifted** during S3's long run: keep it worn, or use `prox_close` (shot file).
- **The owner wears the headset for hours:** plan breaks; S3 needs only the start and the end worn.
- **A brand slips in through generated words** (the agent's names in S3, Glim's replies in S6): check every picked take
  frame by frame for names.
- **Wi-Fi drops mid-take:** film on the cable route unless Wi-Fi held through the whole dry run.

## Dated checklist

**Wed 2026-11-11 (today)**
- [ ] Owner: the wall's redesign. Owner reads this directory and answers D1-D11.
- [ ] Agent: G1 wording proposal (owner approves), G7, G10 check.

**Thu 2026-11-12**
- [ ] Agent: G1 at the source plus the extended check; G2 (`--source` on `fake-onboard.mjs`, and the demo repo once D2 is
      decided); G3 and G5 lines and clips; G4 if chosen.
- [ ] Owner: the live rules' video section (G12). Brand scan of the demo repo's names.

**Fri 2026-11-13**
- [ ] Package and install the filming candidate with the wall, G1, G3-G5 (headset-morning-check.md step 0).
- [ ] Owner wears it: headset-morning-check.md night-three section and steps 8, 9, 11-14 (G6). Note every failure.
- [ ] Agent: one free stand-in run of S3 on the PC with both captures, to test the composite and the sync.

**Sat 2026-11-14: the dry run** (capture-plan.md, about 2 hours)
- [ ] Recorder settings, passthrough capture, scrcpy comparison (G8).
- [ ] Every scene once; a rough cut timed against 2:50; one still per scene checked for legibility and for names,
      codes, addresses.
- [ ] One real onboarding of the demo repo if D1 says so: its length sets S3's factor.

**Sun 2026-11-15**
- [ ] Agent: fix what the dry run found; package and install the filming build; freeze it (no new features after this).
- [ ] Owner: rehearse S5 and S6 by hand twice (the pinches, the questions' wording). Clear the room for S7.
- [ ] Captions file drafted from scenes.md.

**Mon 2026-11-16: filming day 1**
- [ ] Morning: reset `kettle-live` and `.bp/companion/` state; pair over the cable; S1, S2, S5, S6, S8 (linked).
- [ ] Afternoon: S3 (the real run, both captures); S4 (unlinked, the sample); S7 or TEXT SIZE.
- [ ] Pull and back up every take the same evening; take log.

**Tue 2026-11-17: filming day 2 and the edit**
- [ ] Pick-ups for any scene that failed; a second real S3 run only if the first is unusable.
- [ ] Assemble, captions burned in, .srt exported, sound levels (Glim's voice clear above the bed).
- [ ] Owner watches the cut once on a phone and once on a laptop; checks every frame for names, codes, addresses, people.

**Wed 2026-11-18**
- [ ] Final export by 10:00 CET; upload by 12:00 CET (deadline 21:00 CET); link into the Devpost form; play it once from
      the public link, logged out.

## Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | How S3's onboarding is filmed: a real run (costs about $11 and 10-20 min, honest), the free stand-in (real server and drawing, simulated reading), or a replayed tape | **A real run on the demo repo**, filmed once, sped up with the clock visible. The stand-in for rehearsals only; if it must be used, caption it as simulated. |
| D2 | Which repository is onboarded on camera | **A small purpose-built repo with neutral names** (for example a fictional booking app's skeleton, a few dozen files), so the run is short and every name the agent draws is ours. Not dowser, pof or bp. |
| D3 | Narrator or captions only | **Captions only**, with Glim as the only voice. |
| D4 | Headset recorder or the XR Simulator | **The headset recorder** for every VR scene; scrcpy as backup; the Simulator only if the headset is unavailable. |
| D5 | Fix the Kettle brand wording at the source (changes the web too) or only in what is filmed | **At the source**, the wording compliance.md P4 proposed ("Social sign-in", "Platform sign-in", "the phone's wallet app", "the phone app stores"). |
| D6 | S4 on the bundled sample, or a live scan of the demo project | **The sample**: deterministic and free; the live theatre has never run. Caption nothing that implies a live scan. |
| D7 | S7: your room, or the TEXT SIZE insert | **Your room only if** the recorder captures passthrough and the room shows nothing identifiable; otherwise TEXT SIZE (it also serves the Accessibility award). |
| D8 | Glim's slow start in S6: build "Let me look." (G4) or shorten the waits in the edit | **Build the bundled line** if it is done by 11-13; keep the edit's marked time-cuts either way. |
| D9 | Hear the owner's spoken questions in S6, or show them as text only | **Keep the owner's voice** if the recorder's microphone is clean (the owner is an entrant, so allowed); the caption carries it either way. |
| D10 | The end card's claims ("72 fps on Quest 3S", "Hands only") and naming the device | **Only after the worn check**; plain text, no logos or store badges. |
| D11 | Where and how it is hosted (public or unlisted, which site) | **What the live rules say**; prepare a YouTube upload with the .srt as its English captions. |
