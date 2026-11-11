# Headset check (next time you wear it; written 2026-11-10 after day two)

About 25 minutes, wearing the Quest 3S. Each line is one action, then what you should see or hear, then the console line
that tunes it. Go in order: the early steps fail fastest and block the later ones. Tick the box or write what you saw
beside it. What was proven only on the PC: night two's record ([`runs/2026-11-10-night-two.md`](runs/2026-11-10-night-two.md))
and day two's ([`runs/2026-11-10-day-two.md`](runs/2026-11-10-day-two.md)). Nothing built on day two has been on a headset.

**How to tune.** Every console line is sent from the PC while the app runs (Development APK on USB):

```
adb shell am broadcast -a android.intent.action.RUN -e cmd "'<command>'"
```

for example `adb shell am broadcast -a android.intent.action.RUN -e cmd "'bp.VoiceLevel 1.2'"`. Six values are saved in
`Saved/BpTable.json` when changed this way too: `bp.VoiceLevel`, `bp.MusicLevel`, `bp.WristFace`, `bp.WristHand`,
`bp.ReducedMotion`, `bp.Room`. Every other value lasts until the app quits: write down the one that works and tell the
builder, so it becomes the default.

## Night three first (2026-11-11, about 10 minutes; the build through `60ba0038` is installed)

What changed overnight and has never been worn ([`runs/2026-11-11-night-three.md`](runs/2026-11-11-night-three.md)). The wall
is the default main screen now; nothing to package.

- [ ] Hold the Meta button. **See:** the table and the wall seat in front of you again (not behind you, not black).
- [ ] Open MENU, then the stand-up. **See:** the sheet wipes in from Glim's side (0.4 s) as his beam brightens; CLOSE wipes
      it back (0.3 s). The text on the wall's right third reads upright (on captures it leaned: we think it is the capture's
      lens, not the wall). Off: `bp.Wow.WallArrive 0`.
- [ ] On a decision, pinch APPROVE and drift the ray onto HOLD before letting go. **See:** nothing happens (a release taps only
      the control the pinch started on). Then a clean pinch on APPROVE: the stamp lands, the decided room lifts and flashes
      once on the table (off: `bp.Wow.DecisionLands 0`).
- [ ] Point the ray around the plan. **See:** Glim glances toward the dot and back, slowly. Too busy: `bp.Wow.GlimGlance 0`.
- [ ] Enter a room and look at its decision. **See:** the wall's three-column layout ("1 OF 1", SCAN THIS ROOM, the answers),
      Glim beside the sheet, pointing with his beam, his arm off the text. Watch for one stutter the first time each kind of
      sheet opens (his clear-spot search, about 8 ms on the PC once per sheet kind).
- [ ] The near bar is a small nameplate on the table's near rim. Back over the paper: `bp.NearBar.Edge 0`.
- [ ] With the PC linked, hold X and talk: "how's the project doing?", "what should I do next?", "show me Billing",
      "approve this one" (with a decision open), "how do lamps work?", "anyway, where were we?". **See:** he moves the table,
      opens pages on the wall, puts a GLIM ASKS card on the wall for your yes, and offers up to three reply buttons under
      his words (a pinch sends one). Note how long each reply takes to start.
- [ ] Without a headset: `node scripts/glim-talk.mjs` talks to him in text (the Claude Code CLI as the engine).

## 0. Package and install first (PC, about 4 minutes plus the build)

The headset holds the build packaged at 11:44 on 2026-11-10 (through `9f6283bd`: night two's work). Nothing of day two is
on it: the tour's second edition, the TOUR page, the scan theatre, YESTERDAY, the welcome back, ADD A PROJECT, PC LINK's
new words and the 24 kHz clips. Until you install a new build, the steps below that name them will not match what you see.

- [ ] Check free memory: at least 12 GB before each build, editor or packaging start
      (`(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB` in PowerShell). Close the editor first.
- [ ] Build `bpEditor Win64 Development` (UBT, with `apps/vr/tools/start-editor.ps1`'s environment).
- [ ] `apps/vr/tools/package-quest.ps1 -Config Development`.
- [ ] `adb install -r apps/vr/Binaries/Android/bp-arm64.apk`.
- [ ] If the run leaves `supportedDevices` widened in `apps/vr/Config/DefaultEngine.ini`, put it back to `quest3|quest3s`.

## 1. Before you put it on (PC, 1 minute)

- [ ] `adb devices` lists the headset.
- [ ] `adb shell getprop debug.oculus.guardian_pause` prints `0`. If it prints 1: `adb shell setprop debug.oculus.guardian_pause 0`.
- [ ] `node apps/vr/tools/quest-tether.mjs --remove`, then `adb shell am force-stop com.developersblueprint.vr`. The first
      steps are the judge's view: no PC.
- [ ] For a true first launch (the new install keeps the old saved file): send `BpTour.Forget` and `BpStandup.Forget` once
      the app is up, then force-stop it again; or accept that the tour may not start by itself and use
      `BpTour.Start` in step 2.

## 2. First launch and the first tour (hands only: leave the controllers on the desk)

- [ ] Start Developer's Blueprint from the headset's library. **See:** the table seats itself in front of you at your eye,
      a wooden floor under it, Glim (the companion, a drafting lamp) at the table's left, the console's slim bar below your line of sight.
      Off: `BpView.Seat` (or SETTINGS > TABLE > SEAT).
- [ ] **Hear:** Glim's welcome, the music bed softly under it. **See:** a caption for each line. The tour starts by itself
      only on a first launch (or to resume one a quit interrupted). No tour: `BpTour.Start`. Voice missing but captions
      show: `bp.TourVoice 1`.
- [ ] Follow it: tap a wing, tap the glowing room, tap it once more to step in, approve or decline the card, BACK, MENU,
      one stand-up decision, hold to talk. **See:** Glim points at the wing on the first tap step; on the stand-up
      step the caption shows and Glim stands beside the sheet (known on the PC: the caption overlaps the sheet's left
      edge); it ends with "That's the table. It's yours." About 95 s when you follow it (PC). Left alone, Glim shows
      each step after 14 s ("Like this."); about 172 s for the whole tour (PC).
- [ ] Resume: start the tour again (`BpTour.Forget`, force-stop, launch), quit at the BACK step
      (`adb shell am force-stop com.developersblueprint.vr`), launch again. **See:** it resumes at BACK.
- [ ] Launch once more after it has finished. **See:** no tour. Tune: `BpTour.Stat` logs the saved state (Version, Core,
      At, Seen); `BpTour.Forget` to see it again as on a first launch; `BpTour.Start <step>` to start at a step
      (`welcome`, `open-wing`, `open-room`, `step-in`, `decide`, `back`, `menu`, `standup`, `talk`, `hand-off`);
      `bp.Tour 1` runs it at every cold start, `0` never (default `-1`: once).

## 3. The TOUR page and its chapters

- [ ] MENU > TOUR (also SETTINGS > TABLE > TOUR, or TOUR on the wrist). **See:** THE FIRST TOUR (REPLAY) and seven
      chapters, each with NEW until seen: HANDS AND WRIST, SCAN A ROOM, YOUR MORNING, YOUR ROOM, TALK TO GLIM,
      TEXT SIZE, YOUR PC.
- [ ] Open one chapter (TEXT SIZE is short). **See:** it opens the page it teaches, the bar says which chapter runs with
      STOP TOUR, and the table is put back at its end; its NEW chip is gone. A chapter by command:
      `BpTour.Chapter <hands|scan|morning|room|talk|text|pc>`; stop one: `BpTour.Stop` (or STOP TOUR).

## 4. Hands: tap, menu, back

- [ ] Pinch-tap a wing (pinch and let go, no pull). **See:** the wing lifts. Pinch-tap a room: it lifts or you step in.
      Taps miss: `bp.AimAssistDeg 4` (default 2, up to 10). The aim ray too faint: `bp.AimRayWidthCm 0.2` (default 0.12).
- [ ] Pull and push still work: pull a wing toward you, push away to go back.
- [ ] Tap MENU on the bar. **See:** the console opens with pages ROOMS, SCAN, STAND-UP, ASK, PROJECTS, PACKAGES,
      SETTINGS, PC LINK, TOUR. Console missing: `bp.Console 1`; open it by command: `BpConsole.Open home`.
- [ ] Go into a wing, then tap **‹ BACK** on the bar. **See:** one level back. Tap CLOSE: the console folds to its bar.

## 5. Controllers

Pick up both controllers.

- [ ] Thumbstick: the focus steps from one wing or room to the next. Too twitchy: `bp.PadDeadZone 0.7` (default 0.5).
      Repeats too fast when held: `bp.PadRepeatS 0.3` (default 0.18) or `bp.PadRepeatDelayS 0.7` (default 0.45).
- [ ] **A** selects the focus. **B** goes back one level. **Y** or the left menu button opens the console. A thumbstick
      click goes home to the site plan.
- [ ] On a stand-up card, **A** once shows `A AGAIN: APPROVE`; a second A within 6 s approves.
- [ ] **X** held is talk (step 13). Nothing works from the controllers: `bp.Pad 1`.

## 6. The wrist

Put the controllers down.

- [ ] Raise your left hand and look at the wrist. **See:** the panel turns to face your eye without you turning the wrist;
      it holds MENU, TOUR, TALK (now marked) and the waiting decision; the text reads easily.
- [ ] Follows too loosely or too stiffly: `bp.WristFaceRate 20` (default 14; 2 to 60, higher is stiffer). Sits in the
      wrong place: `bp.WristOffsetXCm` (default -2.3), `bp.WristOffsetYCm` (-9.2), `bp.WristOffsetZCm` (1.8). Too bright or
      dark: `bp.WristTint 0.8` (0.4 to 1.5). Prefer the old fixed pose: `bp.WristFace 0` (SETTINGS > WRIST). On the right
      hand: `bp.WristHand 1`.

## 7. Sound

- [ ] MENU > SETTINGS. **See:** VOICE 100 %, MUSIC 35 % (the defaults).
- [ ] Replay a tour line (MENU > TOUR > a chapter). **Hear:** the voice clear at 100 %, the music dipping under it and
      coming back after the line. The clips are 24 kHz again (day two's tour clips were 16 kHz for a few hours on the PC
      only); listen for anything dull or clipped and write it down.
- [ ] Voice too quiet or loud: `bp.VoiceLevel 1.2` (0 to 1.5; 1 = 100 %). Music: `bp.MusicLevel 0.25` (0 to 1; 0 stops it).
      The dip under the voice too small: `bp.MusicDuckDb 12` (default 8 dB; 0 to 30).

## 8. The stand-up on the bundled sample: YESTERDAY (still no PC)

- [ ] MENU > STAND-UP. **See:** the page says SAMPLE. On a first stand-up it opens with the YESTERDAY sheet. **Hear:**
      "Here is what yesterday's approvals became."
- [ ] **See:** one outcome at a time: its title, BUILT with its commit (cyan) or FAILED with its reason (red), who approved it
      and when, and BEFORE and AFTER side by side. The sample has three: two built with both screens, one failed. PREV and
      NEXT step through them; the plan raises each one's room. Known on the PC: the two screens are small on the sheet:
      say whether you can read them.
- [ ] Then the decisions: each card raises its room and shows the finding's screen (stamped SAMPLE SCREEN). APPROVE,
      LATER, HOLD each take, and the next card comes after about a second. PLAN MY DAY and HAND OVER say they need your PC.
- [ ] A later day: send `BpStandup.Last 30` (the last stand-up 30 hours ago), then open STAND-UP again. **Hear:** "Welcome
      back. Here is what your approvals became." **See:** "Welcome back. Since <yesterday's time>:" and, until you hold
      today's stand-up, the bar and the MENU's STAND-UP tile saying what came of yesterday (for example "2 built, 1 failed
      since yesterday").
- [ ] Tune: the next card too fast: `bp.StandupAdvanceS 2.5` (default 1.2; 0 stays). A first morning again:
      `BpStandup.Forget`. On a failed outcome that waits again, its decision sheet: `BpStandup.Act todecision`.

## 9. The scan theatre on the sample (still no PC)

- [ ] Go to the site plan (thumbstick click, or BACK until the whole plan shows). MENU > SCAN, tap **SCAN THIS** once (it
      says PRESS AGAIN), then again. **Hear:** Glim say the start ("Scanning everything." on the site, "Scanning this
      wing." in a wing, "Scanning this room." in a room).
- [ ] **See:** Glim leaves its home and flies to the room being read, its light in the lens's colour; a caption per room
      ("Reading <room>, 3 of 13"); the scan line in the same colour; new findings drop onto their rooms as the walk passes
      them (on the sample, up to six).
- [ ] **See and hear at the end:** the SCAN RESULT sheet (what was read and found by severity, the three most severe as
      rows that raise their room, DECIDE THEM), and Glim's result line, for example "Done. Thirteen rooms read, six new
      findings." If another sheet was open, a chip on the bar opens the result instead.
- [ ] Start one and hold to talk mid-scan. **See:** Glim stays with you, then catches up with the scan after.
- [ ] Start one and cancel it on the SCAN page. **See:** the bar, the wrist and the SCAN page clear at once; "Stopped. Here
      is what it read."
- [ ] Tune: `bp.ScanTheatre 0` shows the scan with its marks only (as before day two), `1` back. `bp.ScanVoice 0` keeps the
      captions and drops the two spoken lines. `bp.Lamp.State 5` forces Glim's scanning light for a look (`-1` back).
      `BpScan.TheatreLines` logs, for the sample, each scope's rooms and the findings it would land. Known on the PC: a
      stop-ship pin lands in the usual colour; a room's count updates once per room; DECIDE THEM opens the stand-up at
      its first card.

## 10. Pair with your PC (on the Headsets page)

On the PC, from the repo root (the server must start in the repo root, or companion turns fail):

- [ ] `npm run server -- --lan` (the PC's server on :3100 and the Wi-Fi door on :3101).
- [ ] In a second terminal: `BP_COMPANION_URL=http://127.0.0.1:3100 npm run dev` (the web app on :3010).
- [ ] `node apps/vr/tools/quest-tether.mjs` (the cable route; it prints whether :3100 answers).
- [ ] Open `http://127.0.0.1:3010/headsets` on the PC (use `127.0.0.1`, not `[::1]`). If it says pairing is off, press
      **PAIR OVER THE CABLE** (or **TURN WI-FI ON**); press **OPEN PAIRING FOR 2 MINUTES** if pairing is closed.
- [ ] In the headset: MENU > PC LINK. If it shows an old pairing, tap UNPAIR. Tap **PAIR**. **See:** a 6-character code, a
      2-minute countdown, and the words "Open Developer's Blueprint on your PC, go to Headsets, and type this code there."
- [ ] On the Headsets page: the request is listed (the name the headset gives, where it came from, what it asks for).
      Type the code from the headset into **Type the 6 characters shown in the headset**. Tick **Decide as you** and
      **Scan** (they start unticked), and **Onboard** only if you will do step 12 (it allows paid runs). Pick how long it
      lasts and press **APPROVE**. **See:** within 2 minutes the headset says paired, over the cable, and the page lists it
      under PAIRED. Five wrong codes cancel every open request: open pairing again and tap PAIR again.
- [ ] Fallback, the CLI (no page): `npm run server -- pair approve <code> --scope standup,place,focus,decide,scan`.
      PAIR refused with no window open: `npm run server -- pair open`. See what is paired: `npm run server -- pair list`.
      End a pairing: `npm run server -- pair revoke <id>` (or REVOKE on the page).
- [ ] Check from the PC: `BpLink.Link`, then `adb logcat -d -s UE | findstr BpLink` (the route and the token's last 4
      characters only).
- [ ] Wi-Fi: `node apps/vr/tools/quest-tether.mjs --remove`, then restart the app (a kept-alive connection survives the
      remove). **See:** PC LINK says Wi-Fi. No Wi-Fi door listed: put the cable back, tap ASK PC on PC LINK (or
      `BpLink.Where`), then remove it again.

## 11. The stand-up live

- [ ] MENU > STAND-UP. **See:** no SAMPLE tag: your real morning. A YESTERDAY sheet shows only if something was approved
      in the last 7 days (on day two, of the owner's products only `kettle-live` had any, read on the PC).
- [ ] APPROVE one card (pinch, or A twice). **See** on the Headsets page, under WHAT THE TABLE DID, filter At the table: a
      row with the words the card showed. Or on the PC: `Get-Content .bp/companion/decisions.jsonl -Tail 1`.
- [ ] Tap **PLAN MY DAY**. **See or hear:** a real companion answer within about 30 s (night two: under 30 s); it may raise
      a card to approve or decline. No answer at all: the server was started outside the repo root.
- [ ] Tap **HAND OVER**. **See:** `HAND OVER FOR TODAY · CONFIRM` with the tools in words, the product and the hours (8),
      and "nothing is granted before GRANT". Tap **GRANT UNTIL <time>**. **See:** an amber **TAKE BACK** on the bar, and the
      grant on the Headsets page.
- [ ] Tap **TAKE BACK** (bar or wrist). **See:** the grant ends; on the Headsets page it is no longer live. (Never run on the device
      yet.)

## 12. PROJECTS > ADD A PROJECT (PC linked, paired with Onboard)

This starts a real, paid agent run on the folder you confirm, which reads that folder with permissions skipped: only
confirm a folder you trust (`table-link-v2.md` section 12, deviation 15). To try it without paying, restart the server
with `BP_CLAUDE_BIN=scripts/fixtures/fake-adopt.mjs` and a scratch `BP_PRODUCTS_FILE`.

- [ ] MENU > PROJECTS. **See:** your projects and, under them, **ADD A PROJECT**: the folders the PC offers (name, hint,
      NEW / READ BEFORE / BEING READ) and one quiet line for folders it holds back. Paired without Onboard: the page says so.
- [ ] Pick one. **See:** "Ask your PC to read <name>? ..." with **ASK** and **CANCEL**. Tap ASK. **See:** "Waiting for your
      click on your PC · Headsets · CONFIRM" with the time left (10 minutes); the bar "Asked your PC · <name>"; the wrist
      ASKED YOUR PC.
- [ ] On the PC's Headsets page, at the top of WHAT THE TABLE DID: "<headset> asks to read <name>: <hint>. ..." Press
      **CONFIRM**. **See** in the headset: the table switches to the new project and draws its build-up as the read runs.
      The page lists it under Projects started from the table, with STOP.
- [ ] Ask again and press **DECLINE** on the page. **See:** the reason with **ASK AGAIN**. Let one wait 10 minutes: "Your PC
      did not answer in time."
- [ ] Tune: `bp.AddProject 0` hides ADD A PROJECT, `1` shows it (default). Never run on the device; on the PC only with a
      stubbed job runner.

## 13. Talk to Glim (PC linked)

- [ ] Hold **X** (or pinch and hold Glim, or hold TALK on the wrist). **See:** the sheet TALK TO GLIM in plain words
      (your voice goes to the PC and from there to a cloud speech service). Tap **ALLOW**.
- [ ] **See:** the Android microphone permission dialog (never seen on the device yet). Allow it.
- [ ] Hold X, say "what should I do first today?", let go. **See:** LISTENING with a level meter that moves with your voice,
      Glim's light change (listening, thinking, answering), your words as a caption. **Hear:** a spoken reply with the
      music dipped. Note how long the reply runs (night two's test reply was 23 s, too long; the spoken part now stops at
      280 characters).
- [ ] Press B (or pinch Glim) while it speaks. **See/hear:** it stops.
- [ ] Ask for something that needs your approval ("plan my day and start the wave"). **See:** a pending card to answer
      (never seen on the device yet).
- [ ] Tune: `BpTalk.Stat` logs the talk's state, the microphone and the consent. Glim's light reacts too little:
      `bp.TalkLightGain 3` (default 1.5; 0 to 4). A light state for a look: `bp.Lamp.State 2` (listening), `3` (thinking),
      `4` (answering), `-1` back. Longer spoken replies: `bp.TalkSpokenMax 400`. The sheet again: `BpTalk.Consent unset`.
      The permission dialog again: `adb shell pm revoke com.developersblueprint.vr android.permission.RECORD_AUDIO`.

## 14. Your room (passthrough) and back

- [ ] Tap **STUDIO** on the bar (or SETTINGS > ROOM). **See:** the studio fades out over about a second, your real room
      around the table; the table, Glim (lit, visible) and the console stay; a soft shadow under the table.
- [ ] Your room too dark or washed out: `bp.Room.Brightness 0.2` (-1 to 1), `bp.Room.Contrast 0.1`, `bp.Room.Saturation 0`,
      `bp.Room.Opacity 1` (below 1 darkens it). The fade too slow: `bp.Room.FadeS 0.6` (default 1.2; 0 is a cut). Glim
      too dim against the room: `bp.Lamp.SelfLight 1.5` (0 to 3), `bp.Lamp.Glow 1.5`. Shadow too strong:
      `bp.Room.Shadow 0.15`; off: `0`.
- [ ] Tap **YOUR ROOM** on the bar. **See:** back to the studio. Then switch to your room again for step 15.

## 15. Relaunch: the settings and the tour stay

- [ ] Set VOICE to 90 % in SETTINGS. Leave the room on YOUR ROOM.
- [ ] `adb shell am force-stop com.developersblueprint.vr`, then start the app again from the headset.
- [ ] **See:** still your room, VOICE 90 %, no consent sheet on a hold, PC LINK still paired, no tour, the chapters you
      opened without NEW.
- [ ] Tune: `BpStore.Dump`, then `adb logcat -d -s UE | findstr BpStore` (the file's path, its last write, key names only);
      `BpTour.Stat` for the tour's part.
- [ ] Put it back: VOICE 100 %, STUDIO.

## 16. Night two's visual rounds (in the 11:44 build, never seen by a person)

- [ ] Lift a room. **See:** one white-on-blue nameplate under its near edge, the other wings stepped back, the bar on one
      line. Glim glides aside if the lifted room would be behind it. Glim in the way: `bp.Lamp.HomeClear 0` to compare.
- [ ] Room names on the site plan read from the seat. Too big or small: `bp.Table.RoomNameArcmin 45` (default 40);
      furniture too loud: `bp.Table.GlyphRest 0`.
- [ ] The desk's front edge has no blown-out spot. Compare: `bp.Frame.StripLights 1`, then `0`. Frame too dark or flat:
      `bp.Frame.Light 0.8`, `bp.Frame.Bevel 0.8`.
- [ ] A stand-up decision: the title leads, the screen is on the right, APPROVE is the largest control and sinks while you
      hold the pinch; the stamp settles. Stamp too quick: `bp.StandupAdvanceS 2`.
- [ ] The wrist: same buttons and chips as the console, the decision's title in full, nothing cut.
- [ ] SETTINGS > ACCESSIBILITY: TEXT SIZE 130 %. **See:** the console, the wrist and the captions grow together and nothing
      breaks. Known: Glim's caption touches the bar's left end at 130 %. Back: `bp.TextSize 1`.
- [ ] The pressed state on controls (could not be captured on the PC).

## After the check

- [ ] For the judge's view again: `node apps/vr/tools/quest-tether.mjs --remove`, `BpTalk.Consent unset`,
      `BpStandup.Forget`, `BpTour.Forget`, `adb shell pm revoke com.developersblueprint.vr android.permission.RECORD_AUDIO`,
      and decide whether to UNPAIR (and REVOKE on the Headsets page).
- [ ] Tell the builder: every step that failed, every console value you changed and kept, how long the spoken reply ran,
      whether the BEFORE and AFTER screens read, how the scan theatre felt, and how your room looked.
