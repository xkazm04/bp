# Headset morning check (after night two, 2026-11-10)

About 15 minutes, wearing the Quest 3S. Each line is one action and what you should see or hear. Go in order: the early
steps fail fastest and block the later ones. Tick the box or write what you saw beside it; the night's record
([`runs/2026-11-10-night-two.md`](runs/2026-11-10-night-two.md)) says what was only proven on the PC.

**How to tune.** Every fix line is a console command sent from the PC while the app runs (Development APK on USB):

```
adb shell am broadcast -a android.intent.action.RUN -e cmd "'<command>'"
```

for example `adb shell am broadcast -a android.intent.action.RUN -e cmd "'bp.VoiceLevel 1.2'"`. Six of them are saved in
`Saved/BpTable.json` when changed this way too: `bp.VoiceLevel`, `bp.MusicLevel`, `bp.WristFace`, `bp.WristHand`,
`bp.ReducedMotion`, `bp.Room`. Every other value lasts until the app quits: write down the one that works and tell the
builder, so it becomes the default.

## 0. Before you put it on (PC, 1 minute)

- [ ] `adb devices` lists the headset.
- [ ] `adb shell getprop debug.oculus.guardian_pause` prints `0` (the night set it to 1 for the bench and back to 0). If it
      prints 1: `adb shell setprop debug.oculus.guardian_pause 0`.
- [ ] `node apps/vr/tools/quest-tether.mjs --remove`, then `adb shell am force-stop com.developersblueprint.vr`. The first
      steps are the judge's view: no PC.
- [ ] The microphone permission and the talk consent were reset at the end of the night, so you meet the first-run flow.

## 1. First launch and the tour (hands only: leave the controllers on the desk)

- [ ] Start Developer's Blueprint from the headset's library. **See:** the table seats itself in front of you at your eye,
      a wooden studio floor under it, the lamp at the table's left, the console's slim bar below your line of sight.
      Off: `BpView.Seat` (or SETTINGS > TABLE > SEAT).
- [ ] **Hear:** Glim's welcome; the music bed softly under it. **See:** a caption for each line. The tour asks for one
      gesture at a time and waits. No tour: `BpTour.Start`. Voice missing but captions show: `bp.TourVoice 1`.
- [ ] Follow the tour to its end. **See:** it ends on the morning's first stand-up decision (APPROVE or LATER), then a
      hand-off line.

## 2. Hands: tap, menu, back

- [ ] Pinch-tap a wing (pinch and let go, no pull). **See:** the wing lifts. Pinch-tap a room: it lifts or you step in.
      Taps miss: `bp.AimAssistDeg 4` (default 2, up to 10). The aim ray too faint: `bp.AimRayWidthCm 0.2` (default 0.12).
- [ ] Pull and push still work: pull a wing toward you, push away to go back.
- [ ] Tap MENU on the bar. **See:** the console opens with pages ROOMS, SCAN, STAND-UP, ASK, PROJECTS, PACKAGES,
      SETTINGS, PC LINK. Console missing: `bp.Console 1`; open it by command: `BpConsole.Open home`.
- [ ] Go into a wing, then tap **‹ BACK** on the bar. **See:** one level back. Tap CLOSE: the console folds to its bar.

## 3. Controllers

Pick up both controllers.

- [ ] Thumbstick: the focus steps from one wing or room to the next. Too twitchy: `bp.PadDeadZone 0.7` (default 0.5).
      Repeats too fast when held: `bp.PadRepeatS 0.3` (default 0.18) or `bp.PadRepeatDelayS 0.7` (default 0.45).
- [ ] **A** selects the focus. **B** goes back one level. **Y** or the left menu button opens the console. A thumbstick
      click goes home to the site plan.
- [ ] On a stand-up card, **A** once shows `A AGAIN: APPROVE`; a second A within 6 s approves.
- [ ] **X** held is talk (tested in step 9). Nothing works from the controllers: `bp.Pad 1`.

## 4. The wrist

Put the controllers down.

- [ ] Raise your left hand and look at the wrist. **See:** the panel turns to face your eye without you turning the wrist;
      it holds MENU, TOUR, TALK and the waiting decision; the text reads easily.
- [ ] Follows too loosely or too stiffly: `bp.WristFaceRate 20` (default 14; 2 to 60, higher is stiffer). Sits in the
      wrong place: `bp.WristOffsetXCm` (default -2.3), `bp.WristOffsetYCm` (-9.2), `bp.WristOffsetZCm` (1.8). Too bright or
      dark: `bp.WristTint 0.8` (0.4 to 1.5). Prefer the old fixed pose: `bp.WristFace 0` (SETTINGS > WRIST). On the right
      hand: `bp.WristHand 1`.

## 5. Sound

- [ ] MENU > SETTINGS. **See:** VOICE 100 %, MUSIC 35 % (the defaults).
- [ ] Start a tour line (SETTINGS > TABLE > TOUR). **Hear:** the voice clear at 100 %, the music dipping under it and
      coming back after the line.
- [ ] Voice too quiet or loud: `bp.VoiceLevel 1.2` (0 to 1.5; 1 = 100 %). Music: `bp.MusicLevel 0.25` (0 to 1; 0 stops it).
      The dip under the voice too small: `bp.MusicDuckDb 12` (default 8 dB; 0 to 30).

## 6. The stand-up on the bundled sample (still no PC)

- [ ] MENU > STAND-UP. **See:** the page says SAMPLE. Each card raises its room on the plan and shows the finding's screen
      (a Kettle screen stamped SAMPLE SCREEN). APPROVE, LATER, HOLD each take, and the next card comes after about a second.
- [ ] PLAN MY DAY and HAND OVER say they need your PC.
- [ ] The next card comes too fast: `bp.StandupAdvanceS 2.5` (default 1.2; 0 stays). See a first morning again:
      `BpStandup.Forget`. See the "since your last stand-up" replay: `BpStandup.Last 20`.

## 7. Pair with your PC

On the PC, from the repo root (the server must start in the repo root, or companion turns fail):

- [ ] `npm run server -- --lan` (the PC's server on :3100 and the Wi-Fi door on :3101).
- [ ] `node apps/vr/tools/quest-tether.mjs` (the cable route; it prints whether :3100 answers).
- [ ] In the headset: MENU > PC LINK. If it shows a pairing from the night, tap UNPAIR. Tap **PAIR**. **See:** a
      6-character code and a countdown (2 minutes).
- [ ] On the PC, type the code the headset shows:
      `npm run server -- pair approve <code> --scope standup,place,focus,decide,scan`.
      PAIR refused with no window open: `npm run server -- pair open`, then PAIR again. See what is paired:
      `npm run server -- pair list`. End a pairing: `npm run server -- pair revoke <id>`.
- [ ] **See:** PC LINK says paired, over the cable. Check from the PC: `BpLink.Link` command, then
      `adb logcat -d -s UE | findstr BpLink` (it shows the route and the token's last 4 characters only).
- [ ] Wi-Fi: `node apps/vr/tools/quest-tether.mjs --remove`, then restart the app (a kept-alive connection survives the
      remove; only a relaunch or a server restart makes "no cable" true). **See:** PC LINK says Wi-Fi. No Wi-Fi door listed:
      put the cable back, tap ASK PC on PC LINK (or `BpLink.Where`), then remove it again.

## 8. The stand-up live

- [ ] MENU > STAND-UP. **See:** no SAMPLE tag: your real morning, a card per decision, its finding's screen.
- [ ] APPROVE one card (pinch, or A twice). On the PC: `Get-Content .bp/companion/decisions.jsonl -Tail 1`. **See:** a row
      with `"surface":"vr"`, your device id and the words the card showed.
- [ ] Tap **PLAN MY DAY**. **See or hear:** a real companion answer within about 30 s (the night's run: under 30 s); it
      may raise a card for you to approve or decline. No answer at all: the server was started outside the repo root.
- [ ] Tap **HAND OVER**. **See:** `HAND OVER FOR TODAY · CONFIRM` with the tools in words, the product and the hours (8),
      and "nothing is granted before GRANT". Tap **GRANT UNTIL <time>**. **See:** an amber **TAKE BACK** on the bar.
- [ ] Tap **TAKE BACK** (bar or wrist). **See:** the grant ends. On the PC the last two rows of `decisions.jsonl` are
      `policy-grant` and `policy-revoke`. (Never run on the device before this morning.)

## 9. Talk to the lamp (PC linked)

- [ ] Hold **X** (or pinch and hold the lamp, or hold TALK on the wrist). **See:** the sheet TALK TO THE LAMP in plain words
      (your voice goes to the PC and from there to a cloud speech service). Tap **ALLOW**.
- [ ] **See:** the Android microphone permission dialog (never seen on the device yet). Allow it.
- [ ] Hold X, say "what should I do first today?", let go. **See:** LISTENING with a level meter that moves with your voice,
      the lamp's light change (listening, thinking, answering), your words as a caption. **Hear:** a spoken reply with the
      music dipped. Note how long the reply runs: the night's test reply was 23 s, too long.
- [ ] Press B (or pinch the lamp) while it speaks. **See/hear:** it stops.
- [ ] Ask for something that needs your approval ("plan my day and start the wave"). **See:** a pending card to answer
      (never seen on the device yet).
- [ ] Off: `BpTalk.Stat` logs the talk's state, whether the microphone is open and the consent. The lamp's light reacts too
      little: `bp.TalkLightGain 3` (default 1.5; 0 to 4). See the sheet again: `BpTalk.Consent unset`. See the permission
      dialog again: `adb shell pm revoke com.developersblueprint.vr android.permission.RECORD_AUDIO`.

## 10. Your room (passthrough) and back

- [ ] Tap **STUDIO** on the bar (or SETTINGS > ROOM). **See:** the studio fades out over about a second, your real room
      around the table; the table, the lamp (lit, visible) and the console stay.
- [ ] Your room too dark or washed out: `bp.Room.Brightness 0.2` (-1 to 1), `bp.Room.Contrast 0.1`, `bp.Room.Saturation 0`,
      `bp.Room.Opacity 1` (below 1 darkens it). The fade too slow: `bp.Room.FadeS 0.6` (default 1.2; 0 is a cut). The lamp
      too dim against the room: `bp.Lamp.SelfLight 1.5` (0 to 3), `bp.Lamp.Glow 1.5`.
- [ ] Tap **YOUR ROOM** on the bar. **See:** back to the studio. Then switch to your room again for step 11.

## 11. Relaunch: the settings stay

- [ ] Set VOICE to 90 % in SETTINGS. Leave the room on YOUR ROOM.
- [ ] `adb shell am force-stop com.developersblueprint.vr`, then start the app again from the headset.
- [ ] **See:** still your room, VOICE 90 %, no consent sheet on a hold, PC LINK still paired.
- [ ] Off: `BpStore.Dump`, then `adb logcat -d -s UE | findstr BpStore` (the file's path, its last write, key names only).
- [ ] Put it back: VOICE 100 %, STUDIO.

## After the check

- [ ] For the judge's view again: `node apps/vr/tools/quest-tether.mjs --remove`, `BpTalk.Consent unset`, `BpStandup.Forget`,
      `adb shell pm revoke com.developersblueprint.vr android.permission.RECORD_AUDIO`, and decide whether to UNPAIR.
- [ ] Tell the builder: every step that failed, every console value you changed and kept, how long the spoken reply ran,
      and how your room looked.
