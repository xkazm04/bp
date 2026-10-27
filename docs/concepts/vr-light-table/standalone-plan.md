# Standalone plan: the light table on a Quest with no PC

Written 2026-10-27. The owner's goal for `apps/vr` is the
[Meta VR Start Developer Competition 2026](https://start-developer-competition-26.devpost.com) (entries close
**2026-11-18, 12:00 PT**). This plan takes the table from PC-tethered to a build that a judge installs and runs on their
own headset. The PC-tethered route stays as a fallback for us, with its own guide: [`run-locally.md`](run-locally.md).

## Why this changes the quality bar

The README chose a **PC-tethered** quality bar (2026-10-20), and `tech-stack.md` says no APK is built. The competition
cannot judge that:

- **What to submit.** For an Unreal app, the APK goes to a release channel named "Competition" in the Meta VR Developer
  Dashboard, with an invite URL, plus a public video under 3 minutes. Judges launch the build themselves, and judging
  uses the build as it stood at the deadline.
- **Hands-first.** The app must be fully usable with hands, end to end, with no controller.
- **Seated.** Design for a two-foot radius, a fast cold start and a complete moment within 10 minutes.
- **Not a wrapper.** If you take the third-party services away, is there still a project?

So the build we submit runs on the headset alone: **no PC, and no bp server**.

- **Division.** bp's first commit is 2026-10-09 and `apps/vr`'s is 2026-10-20. Both are inside the window that opened
  on 2026-09-24, so the entry fits the **New Experience** division, as long as nothing older was copied in.
- **Track.** Productivity.
- **Special awards in reach.** Best Agentic Interaction and Best Accessibility Forward. For voice, see
  [`voice-sdk-plan.md`](voice-sdk-plan.md).

## Done in this session: the data no longer needs a server (S0)

Until now, BpLink read everything from `apps/server` on `127.0.0.1:3100`:

- the product (`/structure`);
- the plan (`/plan?layout=islands`);
- the scan side, polled every 4 s (`/scans`, `/scan`, `/waves`).

On a headset with no PC, every one of those reads fails.

- **The bundled snapshot.** `apps/vr/tools/bundle-data.mjs --product kettle` saves those five answers, exactly as the
  server gives them, to `apps/vr/Content/BpData/kettle/`, plus `bundle.json` (when they were saved, and the rev).
  `Config/DefaultGame.ini` stages `BpData` into the pak (`+DirectoriesToAlwaysStageAsUFS`).
- **How BpLink uses it.** BpLink reads the bundle in two cases:
  - **`-BpLinkUrl=bundle`:** no request is made at all.
  - **Fallback:** the server does not answer the structure read.

  After that the session stays on the bundle. The scan side reads its saved answers once instead of polling. Every
  write (a scan, a draft wave) is refused with a log line, because there is no server to keep it.
- **Only Kettle is committed.** It is the public sample. A live product's bundle stays local (`.gitignore`).
- **Checked on Lynx, 2026-10-27, `bpEditor` game mode:**
  - `run-bplink --mode game --no-server`: the structure read failed, then `reading kettle from the build's bundled
    snapshot`, then `Kettle wings=5 ... rooms=13 bays=29 tiles=133 lenses=8 events=566`.
  - `run-bplink --mode game --bundle`: the same plan with no request at all, and `/scan read: proposals=68
    activity=20`, so the pins and the decision card have their data.
  - **Not yet checked:** a cooked, paked build. Nothing has read `BpData` from a pak yet; S5 is that check.

## What runs without a PC, and what does not

| Part | On the headset alone | Why |
|---|---|---|
| The plan, levels, rooms, pins, decision card, wrist | **Yes**, from the bundle | S0 |
| Hands (pinch, hold, lasso, dive and lift) | **Yes** | All on-device (Meta XR and Isdk) |
| Seated calibration, the text card, the frame meter | **Yes** | `BpHeadset.cpp`, on-device |
| Approve into a draft wave, start a Kettle scan | **No**, refused with a log line | The writes need the server. In the bundle they read as a demo: the card can still show the decision |
| Glim, the companion (turns, focus, voice) | **No**, the lamp stands as a static prop | The companion is `claude -p` behind the bp server. A judged build cannot depend on our PC (the "take it away" test) |
| Live scans (the Kettle sim) | **No**, frozen at bundle time | The sim lives in `apps/server` |

**Decision for the owner (D1):** what the lamp does in the judged build. Three options:

- **(a)** A static prop that answers a hold with "offline".
- **(b)** Scripted lines and focus moves from the bundle (a guided tour of Kettle). This is probably the strongest
  "first five minutes".
- **(c)** A cloud companion. That needs a hosted server, which brings secrets and cost.

## The steps

Each step has a pass line. Steps marked **owner** need the owner's hands, accounts or GUI.

### S1. The Android target in the engine (owner, about 30 minutes plus the download)

**Read 2026-10-27:** the installed UE 5.8 has no Android target libraries. `Engine/Platforms/Android` holds only
`Plugins`, and the engine plugins' `Intermediate/Build` holds only `Win64`.

In the Epic Games Launcher: Library → UE 5.8 → the arrow → **Options** → Target Platforms → tick **Android**, then
Apply.

**Pass:** `Engine/Platforms/Android` gains its build files, and the Android `Intermediate/Build` folders appear.

### S2. The Android toolchain on Lynx (about one session, time-boxed)

UE 5.8 pins its versions in `Engine/Extras/Android/SetupAndroid.bat`: platform **android-36**, build-tools **36.1.0**,
CMake **3.22.1**, NDK **27.2.12479018**. The JDK is Android Studio's bundled `jbr`.

1. Install Android Studio. Open it once, and in the SDK Manager add "Android SDK Command-line Tools (latest)".
2. Run `SetupAndroid.bat` with start-editor's environment. It installs the versions above and sets `ANDROID_HOME`,
   `NDKROOT` and `JAVA_HOME` for the user.
3. Restart the editor through `start-editor.ps1`. In Project Settings → Platforms → Android SDK, the paths should be
   filled.

- **The ARM64 risk.** Lynx is Windows on ARM64. Android Studio, the JDK and the NDK host tools ship for x86-64 Windows,
  so they run under emulation, as the UE editor already does. Nothing has been measured yet.
- **If S2 fails:** we need an x64 Windows box for packaging only. Wolf is retired, so the owner would decide (D2).

**Pass:** `RunUAT BuildCookRun -platform=Android` gets past toolchain detection.

### S3. The project's Quest settings

All of these are config in `apps/vr/Config`, committed:

- **Android:**
  - package name `com.<owner>.bp` (owner D3: the name);
  - minimum and target SDK as the Meta store requires [verify in the Meta docs at S3: Horizon OS asks for a recent
    target SDK];
  - arm64 only, Vulkan only, landscape.
- **Meta XR:** package for Meta Quest, with Quest 3 and 3S as target devices.
- **Hands:** hand tracking set to controllers and hands in the manifest. This is already set (`272f20f`); today
  it matters only for this Android manifest. Add the high-frequency hand tracking flag too.
- **Rendering:**
  - the mobile forward renderer, multiview, MSAA 4x;
  - no Lumen, no rect lights and no virtual shadow maps on Android;
  - baked or static lighting where possible.
- **Start-up:** the start map is `LightTable`. The open item "the LightTable map is not cooked into the staged exe"
  must be closed here, by listing the map in the cook settings.

**Pass:** the settings are saved, and a Win64 game run is unchanged.

### S4. A Quest fidelity tier

The PC look (Kettle about 34/45 blind) leans on the GPU workstation, and the XR2 Gen 2 has a fraction of it. Rather than
fork the scene, we make one scene with a mobile tier:

- **Budget.** Draws under about 100 and triangles under about 200k. Measure them on the device first.
- **Studio.** Swap the studio props and the city for cheaper variants on Android (the `BpRoom` placement already
  decides what is placed). Cut textures to 1k with ASTC.
- **Materials.** Fully rough, no translucency stacks, and the scan line as one additive card.
- **Text.** Keep every text class at or above the headset plan's floor. Text matters more than the look for
  Productivity judges.
- **Pass:** 72 Hz held, a GPU frame at or under 13.9 ms on the device (OVR Metrics Tool), and the text card graded "reads
  easily" for the deck body.

### S5. Package, install and run (the first APK)

```
RunUAT.bat BuildCookRun -project=<repo>/apps/vr/bp.uproject -platform=Android -cookflavor=ASTC -clientconfig=Development \
  -build -cook -stage -pak -package -archive -archivedirectory=<dir> -unattended
adb install -r <dir>/Android_ASTC/bp-arm64.apk
adb logcat -s UE   # look for the BpLink lines
```

**Pass:**

- The app starts on the Quest with no PC.
- `logcat` shows `BpLink: reading kettle from the build's bundled snapshot`, then `Kettle wings=5`.
- The table draws, and every gesture in the headset plan's list works with hands.

This is also the first check that `BpData` is read from inside a pak.

### S6. The judged experience

- **Cold start in seconds.** It opens on the seated table, already calibrated (`BpView.Seat` runs at start).
- **A complete moment in 10 minutes.** Owner D1 decides what the lamp does. A short "what am I looking at" opening helps
  for the Best First Five Minutes award.
- **Hands-first audit.** Walk every action with hands only, and list any action that only a controller or the console
  reaches.

### S7. Submit (owner)

1. Meta VR Start program membership, and a developer account with an organization.
2. Create the app in the Meta VR Developer Dashboard.
3. Upload the APK to a release channel named **Competition**, create the invite URL, and test it from a second account.
4. Make the video: under 3 minutes, public on YouTube or Vimeo, recorded on the device or in the XR Simulator.
5. Fill in the Devpost form: track Productivity, division New Experience, the description, and the hand interactions.
   Keep the app available until winners are announced (about 2026-12-11).

### S8. Optional: the headset against the PC over the LAN

Point `-BpLinkUrl=http://<lynx-lan-ip>:3100` at a live server, through the APK's `UECommandLine.txt` or a settings
field.

- **The blocker:** `apps/server` binds `127.0.0.1` only, and every route checks for a loopback Host
  (`scan/local-only.ts`).
- **Owner D4:** whether to open a read-only, LAN-only door. It is not needed for the competition, and the bundle covers
  the judged build.

## Order and time

| When | Step | Who |
|---|---|---|
| Now | S1 (the Android target), then S2 (the toolchain) | Owner, then a session |
| Next session | S3 and the first S5 (an ugly APK is fine) | Agent |
| Then | S4 (the mobile tier, measured on device) and S6 | Agent with the owner in the headset |
| By about 2026-11-14 | S7, so there is slack before the deadline | Owner |

The headset plan's PC route ladder (rungs 1 to 4) still serves our own reading sessions, but it no longer decides the
product. Rung 5 is now the main path.

## Decisions for the owner

- **D1:** What the lamp does with no server: a static prop, a scripted tour from the bundle, or a hosted companion.
- **D2:** If the Android toolchain cannot run on ARM64, where to package.
- **D3:** The package name, and the app's title in the store listing.
- **D4:** Whether to open a LAN-only, read-only door on `apps/server` (S8).
