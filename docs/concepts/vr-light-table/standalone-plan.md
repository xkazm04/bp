# Standalone plan: the light table on a Quest with no PC

Written 2026-10-27. The owner's goal for `apps/vr` is the
[Meta VR Start Developer Competition 2026](https://start-developer-competition-26.devpost.com) (entries close
**2026-11-18, 12:00 PT**). This plan takes the table from PC-tethered to a build that a judge installs and runs on their
own headset. The PC-tethered route stays as a fallback for us, with its own guide: [`run-locally.md`](run-locally.md).

## The owner's answers (2026-10-27)

- **The quality bar stays PC-first.** The art concept and the PC-tethered experience remain the main plan. The Quest
  tier (S4) runs as optimization waves in parallel, and a wave that fails is folded rather than allowed to pull the PC
  look down. The catch: judges run only the APK, so whatever the Quest tier reaches is what is judged.
- **D1: a scripted tour.** The lamp plays scripted lines and focus moves over the bundled Kettle (S6).
- **D2: package on Lynx.** Researched and done: no Android Studio, a native ARM64 JDK, and Google's x64 SDK and NDK
  tools under Prism emulation (S2).
- **D3: "Developer's Blueprint".** Package `com.developersblueprint.vr`. The package name is permanent after the first
  upload to the Meta dashboard.
- **D4: yes.** The headset reaching the bp server over the home network, for a daily stand-up at the table. The design is
  in S8.

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

### S1. The Android target in the engine (owner) - done 2026-10-27

**Read 2026-10-27:** the installed UE 5.8 has no Android target libraries. `Engine/Platforms/Android` holds only
`Plugins`, and the engine plugins' `Intermediate/Build` holds only `Win64`.

In the Epic Games Launcher: Library → UE 5.8 → the arrow → **Options** → Target Platforms → tick **Android**, then
Apply.

**Pass:** `Engine/Platforms/Android` gains its build files, and the Android `Intermediate/Build` folders appear.

### S2. The Android toolchain on Lynx - done 2026-10-27

**The research (D2).** Google ships no Windows ARM64 build of Android Studio, the SDK tools or the NDK. Linaro lists
Android Studio on Windows on Arm as still under investigation, and Google has no plans for the emulator there. But
nothing a UE package needs is tied to Android Studio:

- **The JDK.** Microsoft's Build of OpenJDK 21 ships a native `windows-aarch64` zip, so Gradle runs natively.
- **The SDK tools.** Google's command-line tools are Java, so they are host-neutral. In 2026 `sdkmanager` forwards to the
  new `android` CLI, whose `android sdk install` names packages with `/` (`ndk/27.2.12479018`) where `sdkmanager` used
  `;`.
- **The NDK, build-tools, CMake and adb.** These are x64 Windows binaries, and they run under Prism emulation, as the UE
  editor already does.

**`apps/vr/tools/setup-android.ps1`** does all of it with no admin rights:

- It downloads into `%LOCALAPPDATA%` and checks each download against a pinned hash.
- It installs the versions UE 5.8 pins in `Engine/Config/Android/Android_SDK.json`: android-36, build-tools 36.0.0,
  CMake 3.22.1 and NDK r27c (27.2.12479018). `SetupAndroid.bat`'s build-tools 36.1.0 is newer than the json's.
- It sets `ANDROID_HOME`, `JAVA_HOME`, `NDKROOT` and `NDK_ROOT` for the user.

`SetupAndroid.bat` is not used, because it refuses without Android Studio.

**Measured on Lynx, 2026-10-27:**

- `java -version` reports 21.0.13 (an ARM64 binary).
- The NDK's clang 18.0.3 (x64, emulated) compiles a C file to an `ELF 64-bit ARM aarch64` object in 0.3 s.
- adb 37.0.1 and CMake 3.22.1 both run.

**Still open on ARM64:** USB adb to the Quest. Windows' built-in WinUSB usually serves it, but Meta's ADB driver is
x64-only. If USB adb fails, use wireless adb (`adb connect <quest-ip>:5555` after one pairing).

### S3. The project's Quest settings - written 2026-10-27

All of these are config in `apps/vr/Config`, committed:

- **Android** (`DefaultEngine.ini`, `AndroidRuntimeSettings`):
  - package `com.developersblueprint.vr`, title "Developer's Blueprint";
  - minimum SDK 32 and target SDK 34: Meta requires target 34 for apps created after 2026-03-01
    ([Meta's blog](https://developers.meta.com/horizon/blog/meta-quest-apps-android-14-march-1));
  - arm64 only, Vulkan only, landscape, and the data inside the APK.
- **Meta XR:** `bPackageForMetaQuest`, and `SupportedDevices` set to Quest 3 and 3S.
- **Hands:** hand tracking set to controllers and hands in the manifest. This is already set (`272f20f`); today
  it matters only for this Android manifest. Add the high-frequency hand tracking flag too.
- **Rendering** (`Config/Android/AndroidEngine.ini`, so the PC settings are untouched):
  - the mobile forward renderer, multiview, MSAA 4x, no mobile HDR;
  - no Lumen, no rect lights and no virtual shadow maps on Android;
  - baked or static lighting where possible.
- **Start-up:** the start map is `LightTable`, now listed in `MapsToCook` (`DefaultGame.ini`). This closes the open
  item "the LightTable map is not cooked into the staged exe".

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
powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/package-quest.ps1 [-Install]
adb logcat -s UE   # look for the BpLink lines
```

`package-quest.ps1` runs `BuildCookRun` for Android (ASTC) with start-editor's .NET environment. It archives to
`apps/vr/.cache/quest` and keeps the full log there as `uat.log`.

**The first APK was built on Lynx on 2026-10-28.** `bp-arm64.apk` is 284 MB in Development, including a 24 MB Vulkan
validation layer that Shipping drops. `BuildCookRun` took 33 minutes and cooked 923 packages. Three fixes got it there:

- **Clang `-Werror`.** Android's compiler refuses unreachable code that Windows' compiler accepts. Three
  first-actor `for` loops, and one `?:` on a constant recipe, were rewritten.
- **`-NoUBA`.** Under UBA's executor, the NDK's x64 `ld.lld` crashed with 0xc0000374 (heap corruption) under Prism.
  UBT's plain executor links it.
- **`Start-Process` without `-Wait`.** UAT leaves an adb server running, and `-Wait` waited for that too.

`UnrealPak -List` shows `bp/Content/BpData/kettle/` (structure, plan, scan, scans, waves, bundle) inside the pak.
**Not yet run on a headset:** no Quest was connected to adb.

**Pass:**

- The app starts on the Quest with no PC.
- `logcat` shows `BpLink: reading kettle from the build's bundled snapshot`, then `Kettle wings=5`.
- The table draws, and every gesture in the headset plan's list works with hands.

This is also the first check that `BpData` is read from inside a pak.

### S6. The judged experience

- **Cold start in seconds.** It opens on the seated table, already calibrated (`BpView.Seat` runs at start).
- **A complete moment in 10 minutes: the lamp's tour (D1).** `BpTour` is a list of steps. Each step is a caption line,
  one table action through the API the hands already call, and a hold time.
  - **The steps come from the plan.** They are worked out from the bundled plan and scan, not written for Kettle, so a
    re-bundled product gets its own tour.
  - **The script, about 90 s:**
    1. The site: the product's name, its wing, room and feature counts, and "every block is a feature of the code".
    2. The wing with the most open findings lifts (`EnterWing`): its name and its open findings.
    3. Its most urgent room opens (`EnterRoomMode`): "the pins are what the last scan found".
    4. The lamp asks about that room's top feature (`AskLamp`): open findings, health by lens, the last scan.
    5. The decision card (`ShowCard`): what the finding asks. In the bundle, approving adds to a draft that is never
       sent.
    6. Home, and the hand-off: "hold me for the next room; pinch a wing to lift it".
  - **The rules.**
    - It plays once at a cold start in bundle mode.
    - A hold on the lamp at the site plan replays it.
    - Any pinch or hold by the person ends it at once. Their hands always win.
    - The caption must show at every level, not only in room mode as it does today.
  - **Voice.** Glim's ElevenLabs voice can be pre-rendered per line into the bundle (`voice-sdk-plan.md`, V-D3). The
    tour is written so every line reads alone as a caption first.
- **Hands-first audit.** Walk every action with hands only, and list any action that only a controller or the console
  reaches.

### S7. Submit (owner)

1. Meta VR Start program membership, and a developer account with an organization.
2. Create the app in the Meta VR Developer Dashboard.
3. Upload the APK to a release channel named **Competition**, create the invite URL, and test it from a second account.
4. Make the video: under 3 minutes, public on YouTube or Vimeo, recorded on the device or in the XR Simulator.
5. Fill in the Devpost form: track Productivity, division New Experience, the description, and the hand interactions.
   Keep the app available until winners are announced (about 2026-12-11).

### S8. The headset against the PC over the LAN (owner D4: yes; the daily stand-up)

**The use.** Every morning the owner sits at the table in the headset. The table reads the live products from Lynx's bp
server, and the stand-up compares what moved with what is next. The judged APK does not need this, because it runs on
the bundle. It is the same APK, though: with a pairing it reads live, and without one it reads the bundle.

**Why it is not just a bind address.** `apps/server` binds `127.0.0.1`. The mount refuses any non-loopback socket peer,
and every handler's guard checks for a loopback Host (`scan/local-only.ts`). That boundary is deliberate. The registry's
`device-pairing` subject governs opening it:

- the human approval is the only mint gate;
- tokens are born bound, scoped and expiring;
- admission is scoped before authentication runs;
- refusals leak nothing;
- capability is granted per verb.

**The design: a separate door, not a looser guard.**

1. **Opt-in.** A `--lan` flag on `apps/server` starts a second listener on the LAN address, port 3101. Without the flag
   nothing changes. The listener stays off until a pairing exists, except during the pairing window.
2. **Admission before anything else.** Only private-range socket peers are admitted: 10/8, 172.16/12, 192.168/16, and
   100.64/10 for Tailscale. Anything else gets the same bare 403 every refusal gets.
3. **The pairing ceremony.**
   - The headset (BpLink) posts a pairing request.
   - The door makes a pending record with a 2-minute TTL and shows a 6-character code on the lamp's tag.
   - The owner approves on the PC, in a surface the headset cannot reach: `npm run server -- pair approve <code>` or the
     web lamp. They can narrow the scope and the lifetime there.
   - The headset claims the token once. The server keeps only its SHA-256 fingerprint in
     `$BP_HOME/lan/paired.json`, with the device, scope and expiry (30 days by default). `pair revoke` removes it.
4. **Per-verb scope.**
   - `read`, the default: the GET routes BpLink already reads (structure, plan, scans, scan, waves).
   - `standup`, opt-in at approval: also the companion turn and focus routes, so Glim can run the stand-up.
   - Each allowed request is forwarded in-process to the loopback mount, so the existing guards still run unchanged
     behind the door.
5. **Constant-time checks.** Fingerprints are compared in constant time. Every refusal has the same shape and body.
6. **The APK side.** BpLink sends `Authorization: Bearer` from a token stored under the app's `Saved/`. `-BpLinkUrl`
   points at `http://<lynx>:3101`, and the bundle stays the fallback.
   - **A recorded deviation:** Android blocks cleartext HTTP by default, so the APK sets `usesCleartextTraffic`, and the
     token travels unencrypted on the home network. That is acceptable for a home LAN or a tailnet, but not for a café.
     TLS on the door is the follow-up.

**Order.** After the first APK (S5) and the tour (S6). The door is about a session of server work and a session of
BpLink work.

**The `place` scope (2026-10-28).** The crossing from the web app into the table adds a third scope, `place`, for the place
baton's three verbs (`GET /api/session/place?claim=1`, `POST /api/session/place`, `POST /api/session/place/return`). The door
sets `x-bp-device` from the paired fingerprint and drops any value the client sent. The routes and the page's half are on
master, and the door is built on Lynx as an optional phase before the deadline: [`../desk-to-table/plan.md`](../desk-to-table/plan.md),
D1 and L2-L3.

**The server half is built (2026-10-29, desk-to-table D1).** It lives in `apps/server/src/lan-door.ts` and `lan-pair.ts`
and is gated by `check:lan-door`.
- Start: `npm run server -- --lan`. Owner commands: `npm run server -- pair list|open|approve <code>|deny <code>|revoke <id>`.
- The design above holds as written.
- The deviations from `device-pairing` are recorded in D1: possession-only binding, cleartext, CLI-only approval, and
  IPv4-only admission.

## Order and time

| When | Step | Who |
|---|---|---|
| Now | S1 (the Android target), then S2 (the toolchain) | Owner, then a session |
| Next session | S3 and the first S5 (an ugly APK is fine) | Agent |
| Then | S4 (the mobile tier, measured on device) and S6 | Agent with the owner in the headset |
| By about 2026-11-14 | S7, so there is slack before the deadline | Owner |

The headset plan's PC route ladder (rungs 1 to 4) still serves our own reading sessions, but it no longer decides the
product. Rung 5 is now the main path.

## Decisions (answered 2026-10-27; see "The owner's answers" at the top)

- **D1:** The scripted tour.
- **D2:** Package on Lynx (S2).
- **D3:** Developer's Blueprint, `com.developersblueprint.vr`.
- **D4:** Yes, through the paired door in S8.
