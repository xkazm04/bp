# Lessons from the last 48 hours before a VR competition submission (2026-11-17/18)

A source for the ai-registry's `/intake` (pasted notes, first-hand, one project). Developer's Blueprint: a web app and a
UE 5.8 Quest 3/3S app (`apps/vr`) that draws a codebase as a building on a light table, with a desk-lamp companion
(Glim); submitted to a VR developer competition on 2026-11-18. Every lesson below names what happened, the evidence in
this tree (file or commit), and the rule we would follow next time. n = 1 project; dates are the evidence's.

## A. Release engineering for a standalone headset build

1. **A project-level user config is packed into the build.** Release signing put the keystore password in
   `apps/vr/Config/UserEngine.ini` (a layer UBT reads). The cook staged it into the pak (`bp/Config/UserEngine.ini` in
   `Manifest_UFSFiles_Android.txt`). The registry's intake (2026-11-18) found the engine's config strip list names
   `KeyStorePassword`, so the password itself was probably removed from the staged file; the safety came from a list that
   only knows the keys it already names. Moved to the per-user
   `%LOCALAPPDATA%\Unreal Engine\Engine\Config\UserEngine.ini` (UBT's `{USERSETTINGS}` layer, never staged). Caught only
   because the packaging script fails when any `Config/User*.ini` is in the staged manifest
   (`apps/vr/tools/package-quest.ps1`, commits 1909d088, then the fix). Rule: secrets for a build go in a layer the
   cooker never stages, and the package step greps its own staged manifest for them.
2. **Development and Shipping are different products.** The store build must be non-debuggable and release-signed
   (`-distribution`; `android:debuggable=false` verified with `aapt2 dump xmltree`, signer with `apksigner`). Shipping
   strips the console and the logs, so every remote-driven test, bench and film take needs the Development build; the two
   are signed by different keys and Android refuses an install over the other (uninstall wipes app data, pairing too).
   Rule: keep both pipelines, name which one each step needs, and back up the release key with its password.
3. **An engine plugin that ships no stub breaks only Shipping.** AndroidFileServer builds a helper project for Shipping
   from `AFSStub`, absent from this engine install (`gradlew.bat` missing, `ueAFSProjectAssembleRelease FAILED`). The data
   is packed inside the APK, so AFS was useless: disabled (`DefaultEngine.ini`, commit "AndroidFileServer off").
4. **A shared workstation's memory is commit charge, not free RAM.** Packaging failed with `UBA FATAL ERROR 9887: Failed to
   create shared memory`, then MSVC `C1060 compiler is out of heap space`, while Task Manager showed 39 GB free: a GPU
   image server held 55 GB of committed memory and the page file was at its limit (1.8 of 80 GB commit free). Rule: before
   a heavy build, read `FreeVirtualMemory`, name the holder, and ask its owner; it was restarted by a supervisor once.

## B. VR on a standalone headset (Quest, UE 5.8, Meta XR)

5. **The headset can be benched and filmed with nobody wearing it.** `am broadcast -a com.oculus.vrpowermanager.prox_close`
   (stay awake), `setprop debug.oculus.guardian_pause 1` (no boundary dialog), console lines over
   `am broadcast -a android.intent.action.RUN -e cmd '<cmd>'` (non-Shipping), a bench pose that moves the pawn so the
   resting headset sees the seated view (`BpView.Bench pitch yaw back up`, `apps/vr/Source/bp/BpHeadset.cpp`), and
   `adb shell screenrecord --size 3664x1920` (both eye buffers at native size; 180 s per file, chain segments, stop by
   PID with SIGINT so the file closes). Re-send `prox_close` before each command: focus drops after a while.
6. **"Worn" is a global switch.** With the proximity sensor held closed, the app's synthetic hand (scripted pinches) does
   nothing, because it only acts with no headset on. Remote takes press controls directly instead; hands never show.
7. **A merged mesh cannot lose a part at runtime.** The side desks were merged into the studio shell. Swapping their
   material slot to a world-position-offset collapse did nothing (the merged component ignores the offset on device); a
   masked discard material hid the legs, but the desk top had been merged under the shell's own material and still drew.
   Rule: keep set dressing that may be cut as separate actors; when merging, keep one material per removable part.
8. **One voice owns the first run.** Ambient narration (the legend's hint, the build-up's "I'm reading your project") fired
   at load, over the guided tour's welcome; the owner heard the welcome "cut in the middle". Narration is now silent until
   the cold start has decided whether the first tour runs, and while its staged table is blank
   (`apps/vr/Source/bp/BpNarrate.cpp`, commit 893b0627). Found by logging every clip played (`BpVoice: plays <id>`).
9. **A permission asked only on the happy path is never asked.** The microphone request lived behind "linked to the PC"
   and "consented"; on the offline sample a hold played a scripted exchange and never asked. Ask on the first use in
   every mode (`BpTalk.cpp` TalkAskMic, commit 586b8b9a).
10. **The first run must follow the product's process, not the UI's anatomy.** The first tour taught wings, rooms and
    cards on a product that was already there; the owner's verdict: it does not reflect the chronology (onboard, then
    scan, then decide). Rebuilt as: blank table -> ADD the tutorial project -> it draws itself (a replayed build-up) ->
    one wing -> scan -> findings become cards -> decide -> talk -> "see you tomorrow" (`BpTour.cpp`, `BpBuildup.cpp`
    TourBlank/TourDraw, commit 0470dec2). Exploring the UI moved to an optional chapter.
11. **Test the first run as a first run.** `pm clear` before each test; an install over an old build keeps the tour's
    "done" and hides the change. A version bump in the tour book only marks chapters NEW, it does not replay.

## C. Filming a demo of a live product, unattended

12. **Cue first, then the take is locked to the cue.** The music was picked before the cut (2:19, 84.8 bpm); its marks
    came from local beat analysis (beats, bars, per-bar intensity: drop 23.4 s, a breath 1:03-1:08, the final peak
    1:53.8). The take driver spaces the three on-camera actions exactly as the cue's marks (SCAN = ADD + 45.2 s, APPROVE =
    SCAN + 45.2 s), so the take lands on the music with one offset at speed 1: measured sync +0.00 / +0.28 / +0.00 s
    (`apps/vr/tools/film/quest-take.mjs`, `auto-edl.mjs`).
13. **Voice from the product's log, not from the capture.** The headset recorder has no audio; every clip the app played
    is logged with device time, and the edit places the clean source WAV there. Clip ids must be unique: the talk
    sample's reply logged under the tour line's id and the edit played the tour line twice (fixed by mapping on duration).
14. **Review stills, not runs.** Each render writes a contact sheet (one frame per caption and per sync point); every
    note in two rounds (dark opening, clipped wall, a desk still drawing, a splash logo before the cut) was found on a
    sheet in seconds (`apps/vr/tools/film/compose.mjs --stills`).
15. **Frame-stepped browser capture.** Real-time page video recorded about 21 distinct frames of 36 during a camera
    flight; freezing the page clock and stepping 1/30 s per screenshot gave 29-30 of 30 and exact action times
    (`apps/vr/tools/film/web_take.py`).
16. **Viewers need the frame before the product.** The owner's notes on the first cut: a web screen with no context is
    confusing (an intro layer now says what it is and what problem it solves); the jump from web to headset needs both
    on screen (a split screen with labels, both channels onboarding the same project in parallel); the voice sat 20 %
    too high and the headset view 20 % too tight. Every one was a parameter of the pipeline, so each round cost minutes.
17. **Reset the stage per take.** A walk leaves the app in a state the story did not plant (a tour done, answers kept).
    Every take starts from a cleared app with the music bed off and the microphone granted.

## D. Working as an agent on a shared machine

18. **Shell text is not file text.** A Bash heredoc turned `\\n` into a newline inside C++ string literals twice; a
    sed pass left stray carriage returns that clang reported 10 builds later. Write edit scripts with a file-writing
    tool, normalise CRLF, and grep the result for lone `\r` before a long build.
19. **An idempotent edit must not re-match its own output.** An anchored replace whose replacement contains the anchor
    applied twice on a re-run (duplicate functions). Restore and apply once, or check for the replacement first.
20. **A hook guarding shared processes reads the whole command.** A pre-tool hook refused any command whose text
    contained a process-kill by name, even inside a string meant for the headset; kill only what you started, by PID.
