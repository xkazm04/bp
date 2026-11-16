# Scenes: the timed script (2:50 of 3:00)

One table per scene. **Glim's line** names its source: a clip id from `apps/vr/Source/bp/BpTourBook.cpp` (the tour
`Lines`, the `ScanLines`, the `NarrateLines`), a live reply (S6: model-generated, so only its gist is scripted), or
**NEW** (no such line exists: see readiness.md). **Caption** is the video's own title text, burned in at the bottom; Glim's
spoken words are also transcribed under it. **Trigger** says how the beat is started on cue: by hand on camera, and
the console line the Director can send from the PC during rehearsal or as a rescue (`adb shell am broadcast -a
android.intent.action.RUN -e cmd "'<cmd>'"`; never during a take that shows hands doing the same thing).

The wall's look is being redesigned on 2026-11-11: wall shots say what the wall must show, not where.

## S1. Cold open: the product as a blueprint (0:00-0:14, web)

| | |
|---|---|
| Time | 0:00-0:14 |
| On screen | Web, full frame. The Kettle site plan in the dark theme: five wings, thirteen rooms, health colours. The plan flies into one wing, then one room, where its features show as fixtures. |
| Action on cue | 0:00 the plan at rest, the cursor still. 0:05 click the Studio operations wing; the camera flies. 0:09 click Booking and attendance; it lifts and opens. |
| Glim's line | None (Glim has not appeared yet). |
| Caption | 0:01 "A software product is thousands of files and a list of tickets." 0:06 "Here is one drawn as a building." 0:10 "Wings are domains. Rooms are capabilities. Features are fixtures." |
| Cut | Hard cut at 0:14 on the room's settle, to black for 6 frames. |
| Trigger | Clicks in the browser (`http://127.0.0.1:3010/?product=kettle-live`). Leave the page on Booking: S2 starts from that place. |

## S2. The crossing: the table lights, Glim turns (0:14-0:28, headset)

| | |
|---|---|
| Time | 0:14-0:28 |
| On screen | Headset. The dark studio; the table's light comes up; the plan on the paper is where the page was (Booking raised). Glim, at the table's left, turns his head to you and his lens brightens. |
| Action on cue | 0:14 the app starts (cold start from the headset's library). 0:17 the table has seated itself and follows the page's place. 0:20 Glim's welcome. 0:26 the wearer's hand comes into view and taps a wing: it lifts. |
| Glim's line | `welcome`: "Welcome. My name is Glim. Each block here is part of your product." |
| Caption | 0:15 "Put on the headset. The same drawing lies on a light table." |
| Cut | Cut on the wing's lift at 0:28, straight into S3's split. |
| Trigger | Launch from the library by hand. The place: the table follows the page's shared focus (`BpFollow.cpp`; `BpLink.Follow on` if it does not). The welcome: `BpTour.Start welcome`, then `BpTour.Stop` after the line (cut before Glim says `tour-stopped`). |

## S3. Onboarding a project, web and VR split, sped up (0:28-1:05)

| | |
|---|---|
| Time | 0:28-1:05 (0:28-0:33 real time, 0:33-0:59 sped up, 0:59-1:05 real time) |
| On screen | Split. Left "PC": `/projects`, Add a project, Check, Start onboarding, then the onboarding screen (the build-up: the outline becomes the building), its run clock top right. Right "HEADSET": the table switches to the new project and draws itself in its own idiom: code areas chalked as dashed parcels, domain names typed in the margin, wings outlined, rooms rising one at a time, pencil brackets on the batch being judged, then the ink. |
| Action on cue | 0:28 on the PC the demo repo's folder is typed, Check, Start onboarding (left). 0:31 in the headset the hand taps the new project on MENU > PROJECTS (right): the table clears. 0:33 speed-up starts; both sides advance together. 0:59 back to real time on the finished sheet; the web shows "Open blueprint"; the table's ink fades into the live plan. |
| Glim's line | 0:32 **NEW** "I'm reading it now. Watch it draw itself." 1:00 **NEW** (optional) "Done. Five wings. Shall we look?" (the count must match the run). |
| Caption | 0:29 "Point it at a repository." 0:34 "An agent reads the code. Both screens draw what it learns." 0:36 corner tag for the whole sped-up part: "Sped up ×N. The clock shows the real run." 1:00 "About N minutes, once per project." |
| Cut | Dissolve (8 frames) into and out of the sped-up part. Hard cut at 1:05 into S4. |
| Trigger | Web: clicks (`apps/web/src/projects/AddPanel.tsx`: Check, Start onboarding; `apps/web/src/onboarding/OnboardingScreen.tsx`). Headset: MENU > PROJECTS, tap the project marked BEING READ; console rescue `BpLink.Product <demo-slug>` (`apps/vr/Source/BpLink/Private/BpLink.cpp`). The table's build-up is `apps/vr/Source/bp/BpBuildup.cpp`; `BpBuild.Line` logs it. |

## S4. A scan: Glim flies room to room, findings land (1:05-1:29, headset, the sample)

| | |
|---|---|
| Time | 1:05-1:29 |
| On screen | Headset, the Kettle sample (the console says SAMPLE). The whole site plan. Glim leaves his place and flies to each room as it is read, his light in the scan's colour; the scan line sweeps; the room is named in his caption; new findings drop onto their rooms. The SCAN RESULT sheet arrives on the wall: what was read, what was found by severity, the three most serious. |
| Action on cue | 1:05 the hand taps MENU, SCAN, SCAN THIS (it says PRESS AGAIN), SCAN THIS. 1:08 the start line. 1:09-1:24 the walk (sped up ×2 if the take runs long). 1:24 the result sheet and line. 1:27 the hand points at DECIDE THEM. |
| Glim's line | 1:08 `scan-start-everything`: "Scanning everything." His caption per room, "Reading <room>, 3 of 13" (text only). 1:24 `scan-done-thirteen-six`: "Done. Thirteen rooms read, six new findings." |
| Caption | 1:06 "Ask for a scan and watch it work." 1:25 "Findings land on the rooms they are about. Nothing is changed without you." |
| Cut | Cut on DECIDE THEM's press at 1:29 into S5. |
| Trigger | By hand. Rescue: `BpConsole.Open scan`, then `BpConsole.Tap scan:this` twice (`apps/vr/Source/bp/BpConsole.cpp`); the theatre is `BpScanTheatre.cpp`, the sample walk `BpSampleScan.cpp` (`bp.SampleScanMaxS` sets its length; default 40 s). |

## S5. The morning stand-up on the wall (1:29-2:01, headset, linked)

| | |
|---|---|
| Time | 1:29-2:01 |
| On screen | Headset. The wall shows YESTERDAY: one outcome at a time, BUILT with its commit or FAILED with its reason, who approved it and when, BEFORE and AFTER side by side; the plan raises its room. Then a decision: the card's title, the finding's screen, what it touches; the room raised on the table. The hand pinches APPROVE; the stamp lands; the room lifts and flashes once. Then 3 s on the PC: the Headsets page, WHAT THE TABLE DID, the new row with the words the card showed. |
| Action on cue | 1:29 the hand opens MENU > STAND-UP; the sheet arrives from Glim's side as his beam brightens. 1:31 YESTERDAY. 1:38 NEXT to a second outcome. 1:43 the first decision. 1:52 pinch APPROVE. 1:55 the stamp, the room flashes. 1:57 cut to the PC row. |
| Glim's line | 1:31 `standup-yesterday`: "Here is what yesterday's approvals became." 1:35 `su-outcome-built`: "This one was built. You'll find it on the plan." 1:43 `su-decide-payout-reconciliation`: "First, a stop-ship: unsafe pages in payout reconciliation. Your call." (if the first card is another, `su-decide-other`: "One decision. Approve it, leave it for later, or hold it.") 1:53 `su-answer-approved`: "Approved. That one goes ahead." |
| Caption | 1:30 "Every morning starts at the table." 1:36 "First, what yesterday's yeses became." 1:44 "Then today's decisions, one card at a time, by hand." 1:57 "Each answer is kept with the words you saw." |
| Cut | Cut from the headset to the PC on the stamp's settle; cut back for S6. |
| Trigger | By hand. Rescue: `BpConsole.Open standup`; `BpStandup.Act next`, `BpStandup.Act approve` (`apps/vr/Source/bp/BpStandup.cpp`). PC: `/headsets` (`apps/web/src/headsets/HeadsetsPage.tsx`), WHAT THE TABLE DID filtered "At the table". |

## S6. Talking with Glim (2:01-2:35, headset, linked)

| | |
|---|---|
| Time | 2:01-2:35 |
| On screen | Headset. The hand pinches and holds Glim: his light turns to listening, the level meter moves, "YOU SAID" shows the words. He thinks: the conversation sheet on the wall lists what he does in plain words, his words arrive as they stream. He answers; the table moves to the place he names, the decision opens on the wall and he points at it. Asked to approve it, a GLIM ASKS card goes up for your yes; the hand pinches APPROVE. Up to three reply buttons sit under his words (YOU COULD SAY). |
| Action on cue | 2:01 hold Glim: "What should I do next?" 2:04 thinking lines: "Reading this morning's decisions", "Ranking what to do next". 2:08 his answer (time cut marked if the wait ran over 3 s). 2:16 hold: "Show me the first one." 2:18 "Opening it for you"; the decision opens on the wall; Glim points. 2:25 hold: "Approve it." 2:28 GLIM ASKS card. 2:31 pinch APPROVE. |
| Glim's line | Live replies, gist only (recorded on the PC 2026-11-11: 30 to 37 words a turn): turn 1 names the most urgent decision and why, from the data; turn 2 "Here it is, on the wall."; turn 3 asks for your yes on the card. The step lines (`BpTalk.cpp` StepWords) are text, not voice. |
| Caption | 2:02 "Or just ask." 2:09 "He answers from the project's data, never an invented priority." 2:26 "He acts only on your yes." |
| Cut | Time-cut marker (a 6-frame dip and a small "−Ns" tag) wherever a wait is shortened. Cut at 2:35 on the stamp. |
| Trigger | By hand (pinch and hold Glim, or hold TALK on the wrist), real speech. Rehearsal: `BpTalk.Say What should I do next?`, `BpTalk.Reply 1` (`apps/vr/Source/bp/BpTalk.cpp`). Text-only rehearsal without a headset: `node scripts/glim-talk.mjs`. |

## S7. Your room (2:35-2:41, headset, optional)

| | |
|---|---|
| Time | 2:35-2:41 |
| On screen | Headset. The hand taps STUDIO on the bar; the studio fades over about a second; the table, Glim and the wall stay over the real desk. |
| Action on cue | 2:35 tap; 2:37 the room is in; 2:40 hold. |
| Glim's line | `your-room-on`: "Your own room, around the table. The studio comes back anytime." |
| Caption | 2:36 "Plan at your real desk." |
| Cut | Cut at 2:41. If cut: replace with the TEXT SIZE insert (SETTINGS > ACCESSIBILITY, tap 130 %; caption "Text at 115 or 130 %, reduced motion, captions, either hand."; line `page-access`). |
| Trigger | By hand. Rescue: `BpConsole.Open settings`; the passthrough look is `bp.Room.*` (`apps/vr/Source/bp/BpSurround.cpp`). |

## S8. End card: tomorrow morning, then the title (2:41-2:50)

| | |
|---|---|
| Time | 2:41-2:50 |
| On screen | 2:41-2:46 headset: a later morning; the bar and the MENU's STAND-UP tile say what came of yesterday ("2 built, 1 failed since yesterday", whatever the data holds); the stand-up opens with "Welcome back. Since <time>: ...". 2:46-2:50 the title card on black: "Developer's Blueprint", "Productivity", "Hands only", "72 fps on Quest 3S" (only if confirmed with a wearer). |
| Action on cue | The hand opens STAND-UP. |
| Glim's line | `standup-welcome`: "Welcome back. Here is what your approvals became." |
| Caption | 2:42 "Tomorrow, it opens with what moved." |
| Cut | Fade to black at 2:46; title; fade out at 2:50. |
| Trigger | Before the take: `BpStandup.Last 30` (the last stand-up 30 hours ago), then open STAND-UP by hand (`BpStandup.cpp`). |
