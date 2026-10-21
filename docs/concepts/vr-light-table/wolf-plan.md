# VR Light Table: the Wolf execution plan

Written 2026-10-21 on Lynx (Windows ARM64, no Unreal Engine, no clang) for a Claude Code session on **Wolf**, the x64
Windows box with Unreal Engine 5.8. It takes `apps/vr` from source to a running greybox (P3), then through P4 to P7 of
[`plan.md`](plan.md). **Nothing in this file has been run on Wolf.** Every UE fact below comes from reading source and
docs. Items marked **[verify on Wolf]** are things this plan could not check from Lynx.

Inputs this plan was written from: [`plan.md`](plan.md) (P0 to P7, the dated readings, the 2026-10-21 decisions),
[`tech-stack.md`](tech-stack.md), [`art-breakdown.md`](art-breakdown.md), [`reference-sheet.md`](reference-sheet.md)
(approved 2026-10-20, the art bible for P3 to P6), [`../../architecture-review-2026-10-21.md`](../../architecture-review-2026-10-21.md),
[`../../../apps/vr/README.md`](../../../apps/vr/README.md), [`../../../apps/vr/WP3.1.md`](../../../apps/vr/WP3.1.md),
`apps/vr/Source/BpLink/**`, [`../../../packages/schema/README.md`](../../../packages/schema/README.md),
`packages/schema/generated/ue/*`, `scripts/check-bplink.mjs` and `scripts/check-server.mjs`.

Master tip when this was written: `4e2dfd1`. On that tip, as read on Lynx:

- `GET /api/products/kettle/plan` is on master (`421e340`). Kettle is 5 wings, 13 rooms, 29 bays and 133 tiles, with
  8 lenses. Read from a live server on Lynx, the wings in `order` are `A Foundations`, `B Studio operations`, `C Money`,
  `D Members & reach` and `E Frontier`, and the lens ids are `business, design, development, operations, security,
  quality, performance, com.kettle.cost`. `kettle.events.jsonl` has 566 lines.
- `FBpPlan` and its parts are already generated in `packages/schema/generated/ue/BpSchema.h` (`ddac55e`).
- `apps/vr/Source/BpLink/Private/BpLink.cpp` **does not call `/plan` yet.** It still logs the 13 `structure.domains`
  as "wings" (`LogKettle`, `BpLink.cpp:129-135`). Step W3.1-6 below adds the call.
- Review findings 1, 2 and 4 are closed (`421e340`, `ff8a73a`, `d031a1a`). Finding 3 (the wire schema) is open.
  Finding 5 has a decision (`326be3c`: apps/server hosts the Kettle sims) and no code yet.

---

## (a) How a Wolf session uses this file

- [ ] **Read first, in this order:** this file; `apps/vr/WP3.1.md`; `apps/vr/README.md` (BpLink contract);
      `plan.md` P3 to P7; `packages/schema/README.md`. Read `art-breakdown.md` and `reference-sheet.md` before P4 or P6.
- [ ] **Follow the steps in order.** Each step names what it depends on. Do not start a step whose dependencies are
      not ticked. Steps tagged **Lynx** belong to a Lynx session. A Wolf session skips them, and checks that they are
      ticked on master before it starts any Wolf step that depends on them.
- [ ] **Tick a box only when its proof exists.** A proof is a command plus its verbatim output line, or a file at the
      named path. "It built" without the line is not a proof. A blocked or skipped run is recorded as **not evaluated**,
      with the reason. It is never a pass.
- [ ] **Commit the evidence with the host name.** Every evidence commit:
  - ticks the box(es) in this file;
  - adds the verbatim lines to the step's run note
    `docs/concepts/vr-light-table/runs/<YYYY-MM-DD>-wolf-<step>.md` (a new folder: create it on the first run);
  - puts `Host: Wolf` and the UE version on a line of the commit body, for example
    `Host: Wolf (UE 5.8.3-<changelist>, MSVC 14.xx, Node v22.x)`;
  - uses a conventional subject, for example `feat(vr): WP3.1 BpLink logs Kettle's 5 wings from /plan (Wolf)`.
- [ ] **Keep heavy and machine-specific output local.** Full UE logs (`apps/vr/Saved/Logs/`), `Binaries/`,
      `Intermediate/`, `DerivedDataCache/`, `.sln`, the Meta plugin trees and the zip cache are git-ignored
      (`.gitignore:44-55`). Commit the excerpt in the run note, not the whole log. Captures go to
      `docs/concepts/vr-light-table/captures/` as JPEG, 1 MB or less each.
- [ ] **Machine facts** (GPU, VRAM, RAM, CPU, UE version and changelist, MSVC, Windows SDK, Meta plugin BuildId,
      Link runtime version) go to `docs/concepts/vr-light-table/machine.md`. plan.md P0 and WP3.6 already name that
      file. It does not exist yet.
- [ ] **Push verified work, never force.** After `npm run check` is green, `git fetch`, rebase onto (or merge) `origin/master` and push to `origin master` (owner, 2026-10-21; CLAUDE.md "Git"). Stage only the step's paths. Other sessions may share the checkout.

---

## (b) Wolf machine setup (P0 for this repo)

### Step 0: register this app on Wolf (do this first)

Wolf's tooling only sees a project that is registered. Before any other step:

- [ ] **Fleet registry.** In Wolf's `kiro/ai-registry` checkout (clean tree, `git pull --rebase` first), run
  `node scripts/register-project.mjs --slug bp --path <this checkout> --dry-run`, read it, then run it without
  `--dry-run`. Commit `projects.json` with a `fleet:` subject and push to `origin main`. The script refuses when the
  slug already points at a different checkout on Wolf; re-pointing is a decision, so ask the owner if it refuses. bp has no Wolf entry yet (risk R13 below); this step closes R13.
- [ ] **Personas.** If the Personas app runs on Wolf, register the checkout as a dev project (Dev Tools, or
  `POST /dev-tools/projects` with name and root path) and run a context scan. The headless App Masters for this
  project run on Lynx: Wolf does not run a second master for it. It reports back through commits on `origin/master`.
- [ ] Proof: `projects.json` lists the Wolf checkout for `bp`, and the registry commit is on `origin/main`.


Owner and agent, about half a day if mage-arena-vr's toolchain is still on the box (`mage-arena-vr` on Wolf is at
`kiro/mage-arena-vr`, per the ai-registry fleet file). Record each verify output in
`runs/<date>-wolf-p0.md` and the facts in `machine.md`.

| # | Item | Version | Verify command (PowerShell) | Expected | Machine |
|---|---|---|---|---|---|
| S1 | bp checkout | master, at or after this plan's commit | `git -C <bp> log -1 --format=%h; git -C <bp> status --short` | the SHA; empty status. bp is not in the ai-registry fleet file for Wolf yet. Clone with `git clone https://github.com/xkazm04/bp kiro/bp`, (this plan is on `origin/master` since 2026-10-21). | Wolf |
| S2 | Node | >= 22.18 (`package.json` `engines`) | `node --version` | `v22.18.0` or later (Lynx runs `v24.22.0`) | Wolf |
| S3 | Root install | from `package-lock.json` | `npm ci` at the repo root, then `npm run check` | `npm ci` exit 0; `N passed, 0 failed, 0 skipped of N` (Lynx: 45 of 45; `check:python-deps` is skipped when Python is not on PATH, which still counts as green) | Wolf |
| S4 | Unreal Engine | 5.8.x. plan.md names 5.8.2. mage-arena-vr's `docs/XR-TOOLCHAIN.md` records the box at **5.8.3** (Changelist 58210709, CompatibleChangelist 55116800) on 2026-10-07 | `Get-Content 'C:\Program Files\Epic Games\UE_5.8\Engine\Build\Build.version'` | `MajorVersion 5`, `MinorVersion 8`; record `PatchVersion`, `Changelist` and `CompatibleChangelist` **[verify on Wolf]** | Wolf |
| S5 | Visual Studio for UE C++ | VS 2022 17.x with the MSVC v143 toolset and a Windows 10/11 SDK, at the versions UE 5.8's release notes ask for **[verify on Wolf]** | `& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Workload.NativeGame Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json` | one installation. The workloads are "Game development with C++" and "Desktop development with C++". The components are MSVC v143 x64/x86 (latest), Windows 11 SDK (10.0.22621 or later), "C++ profiling tools" and "IDE support for Unreal Engine". The proof that counts is UBT's own line in the S9 build log: `Using Visual Studio 2022 14.xx.xxxxx toolchain ... and Windows 10.0.xxxxx SDK` | Wolf |
| S6 | Meta XR plugin v207 and Interaction SDK v207 | `UnrealMetaXRPlugin.207.0.zip`, `MetaXRInteractionPackage.207.0.0.zip` (`OculusXR.uplugin` and `OculusInteraction.uplugin`, VersionName `1.207.0`, EngineVersion `5.8.0`) | `apps/vr/tools/install-xr.ps1` (adapted, see below), then `Select-String -Path apps\vr\Plugins\MetaXR\OculusXR.uplugin,apps\vr\Plugins\MetaXRInteraction\OculusInteraction.uplugin -Pattern '"VersionName"'` | the script prints `SHA256_OK=` for both zips, `PLUGIN_EXTRACTED=` or `PLUGIN_PRESENT=`, `UPROJECT_ENABLED=OculusXR` and `UPROJECT_ENABLED=OculusInteraction`, and `PLUGIN_BUILD_ID=55116800` equal to `ENGINE_COMPATIBLE_CHANGELIST` (no `PLUGIN_BUILD_ID_MISMATCH`) | Wolf. Runs after W3.1-2, because it edits `bp.uproject` |
| S7 | Meta XR Simulator v207 | v207.0 | `Test-Path "$env:LOCALAPPDATA\MetaXRSimulatorExtract\PFiles\MetaXRSimulator\v207.0\meta_openxr_simulator.json"` | `True` (mage-arena-vr extracted it there). Use it per process with `$env:XR_RUNTIME_JSON` pointed at that json. Do not run `activate_simulator.ps1`: it rewrites `HKLM\SOFTWARE\Khronos\OpenXR\1`, which Quest Link needs | Wolf |
| S8 | Quest Link and developer mode for a PC-tethered Quest 3 | the current Meta Quest Link PC app; Quest 3 on a USB-C 3 cable | `Get-ItemProperty 'HKLM:\SOFTWARE\Khronos\OpenXR\1' -Name ActiveRuntime` | `...\oculus-runtime\oculus_openxr_64.json` (Link is the active OpenXR runtime) **[verify on Wolf]**. **Owner only:** sign in to the Link app, enable developer mode on the headset (Meta Horizon phone app, Devices, Developer Mode), in the Link app turn on Settings, General, Unknown sources and "Set Meta Quest Link as active OpenXR Runtime", and set the refresh rate to 90 Hz under Devices, Graphics preferences. Proof: the headset shows the Link home, and the run note records the Link app version | Wolf + owner |
| S9 | Engine sanity build | the empty project from W3.1-2 | `& 'C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat' bpEditor Win64 Development "-Project=$PWD\apps\vr\bp.uproject" -WaitMutex` | exit 0, and the UBT toolchain line (S5). Run once before BpLink is added, so that an engine or toolchain fault is not blamed on BpLink | Wolf |
| S10 | Athena daemon (needed from P5) | athena-portable on Wolf, `kiro/athena-portable` | `uv run athena serve`, then `curl http://127.0.0.1:<port>/manifest` | 200. `/voice/install` installs Kokoro and Whisper. Proof: `/voice/preview` speaks one line (plan.md P0 tool check) | Wolf |
| S11 | pof gap-fillers and the UE 5.8 editor MCP (needed from P4) | pof on Wolf, `kiro/pof` | per `pof/docs/ue58-mcp-phase2-tool-map.md` **[verify on Wolf]** | the session can list editor actors and call `capture_viewport` | Wolf |

**`apps/vr/tools/install-xr.ps1` (new, Wolf).** Adapt mage-arena-vr's `apps/vr/tools/install-xr.ps1` by reading it in
that repository, not by copying it blind. Keep:

- the two official Meta download pages, and `curl.exe -fL --retry 3`;
- the pinned SHA-256 table (`PinnedSha256`), which refuses an unknown file name before download and a hash mismatch
  after it;
- the `OWNER_ACTION` refusals for a login or licence wall (the script never logs in or clicks through);
- `Install-PluginZip` with its `1.207.0` / `5.8.0` presence check, and the BuildId against CompatibleChangelist report.

Change:

- `VrRoot` is `apps/vr`, `PluginsDir` is `apps/vr/Plugins`, `CacheDir` is `apps/vr/.cache/xr`, and `Uproject` is
  `apps/vr/bp.uproject`;
- add `OculusXR` and `OculusInteraction` to the `.uproject` with `"Optional": true`, so that a fresh clone without
  the git-ignored plugin trees still opens (mage-arena-vr's hardening note);
- remove the Android SDK, NDK and JDK half (`Set-MageAndroidToolchain` and the functions it calls). The quality bar is
  PC-tethered, so no APK is built.

To skip the 1.1 GB download, first copy the two zips from `kiro/mage-arena-vr/apps/vr/.cache/xr/` into
`apps/vr/.cache/xr/`. The pinned hash still checks them. Commit the script. Never commit the plugin trees or the cache.

---

## (c) Phased run order

Effort is agent time, plus the owner's time where named. Order: S1 to S9, then WP3.1, W3.2 to W3.6, the P3 gate, P4,
P5 (Lynx Node work first), P6, P7. P4's Lynx asset work can run alongside P3 on Wolf.

### P3 WP3.1: the `apps/vr` project and BpLink (Wolf, 1 to 2 days)

Depends on S1 to S5 and S9's toolchain. This expands `apps/vr/WP3.1.md`. Where the two differ, this file is newer
(5 wings from `/plan`, not 13 domains).

- [ ] **W3.1-1 Server up and contract green.** From the repo root: `npm run check:bplink`, then `npm run server` in its
      own shell, then `curl.exe -s http://127.0.0.1:3100/api/products/kettle/plan`.
      Proof: `check-bplink: 12 passed, 0 failed` (the count on Lynx, `4e2dfd1`); the server prints
      `listening on http://127.0.0.1:3100`; the curl answers JSON with 5 `wings`. Note: apps/server answers 403 to a
      non-loopback Host or peer (`packages/core/src/scan/local-only.ts:2-3`). UE and the server must run on the same
      box, and `-BpLinkUrl` stays `http://127.0.0.1:3100`.
- [ ] **W3.1-2 Create the UE project, with the editor, never by hand.** The editor's New Project dialog always writes
      `<Location>\<Name>\`, and the plan wants `apps\vr\bp.uproject` next to the existing `apps\vr\Source\BpLink`. So:
  1. Start `C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe` with no project. In the
     Unreal Project Browser choose **Games**, then **Blank**, **C++**, target platform **Desktop**, quality preset
     **Maximum**, **no Starter Content**, **no raytracing**.
     Project location `%TEMP%\bp-ue` (outside the repo). Project name **`bp`**. Create, then close the editor.
     (Blank, not the VR template: the VR template enables the stock OpenXR plugins and content. Meta XR v207 is added
     by S6 the way mage-arena-vr verified it. Whether the template's OpenXR plugin would conflict is untested and
     **[verify on Wolf]**.)
  2. Move what the editor made into `apps/vr`, leaving the build output behind:
     `robocopy "$env:TEMP\bp-ue\bp" apps\vr bp.uproject /COPY:DAT; robocopy "$env:TEMP\bp-ue\bp\Config" apps\vr\Config /E; robocopy "$env:TEMP\bp-ue\bp\Content" apps\vr\Content /E; robocopy "$env:TEMP\bp-ue\bp\Source" apps\vr\Source /E /XD BpLink`.
     `Source\bp\` (the game module) and `Source\bp.Target.cs` / `Source\bpEditor.Target.cs` join the existing
     `Source\BpLink\`, and `BpLink` is never overwritten. Then delete `%TEMP%\bp-ue`.
  3. Run S6 (`install-xr.ps1`), then open `apps\vr\bp.uproject` in the editor.
  Proof: `apps/vr/bp.uproject` exists and its `EngineAssociation` is `5.8`; the editor opens it; Edit, Plugins shows
  Meta XR and Meta Interaction SDK enabled; `git status` shows only the new `apps/vr/bp.uproject`, `Config/`,
  `Content/` (if any), `Source/bp/` and the two `*.Target.cs` files, and no `Binaries/`, `Intermediate/`, `Saved/`
  or `.sln`.
- [ ] **W3.1-3 Add BpLink to the project.** In `apps/vr/bp.uproject`, `Modules`, add
      `{ "Name": "BpLink", "Type": "Runtime", "LoadingPhase": "PostEngineInit" }` after the `bp` entry the template
      wrote. In both `Source/bp.Target.cs` and `Source/bpEditor.Target.cs`, use
      `ExtraModuleNames.AddRange(new string[] { "bp", "BpLink" });`. Editing the editor-made `.uproject` to add a module
      is the WP3.1 step 4 edit; it is not "adding a `.uproject` by hand". Regenerate project files:
      `& 'C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat' -projectfiles "-project=$PWD\apps\vr\bp.uproject" -game -engine` **[verify on Wolf]** (or right-click `bp.uproject`, Generate Visual Studio project files).
      Proof: the generated `bp.sln` (git-ignored) shows `BpLink` under `Games\bp\Source`.
- [ ] **W3.1-4 Settle the UHT question first (gap E1 below).** UHT must process `BpSchema.h` and write
      `BpSchema.generated.h`. Run the editor build (W3.1-5) once as it is, and read the UHT output.
  - If it fails with `Cannot open include file: 'BpSchema.generated.h'` (expected), apply E1's junction fix and
    build again.
  Proof: the UHT step lists `BpSchema.h` and the build passes the UHT phase; the run note records which variant held.
- [ ] **W3.1-5 Build both targets.**
      `Build.bat bpEditor Win64 Development "-Project=$PWD\apps\vr\bp.uproject" -WaitMutex` and
      `Build.bat bp Win64 Development "-Project=$PWD\apps\vr\bp.uproject" -WaitMutex`.
      Proof: both exit 0; the run note has the UBT toolchain line and each build's last `Total execution time` line.
      Fix each compile error with the smallest change, working through the list in section (e). A fix inside
      `packages/schema/generated/ue` is made in `packages/schema/generate.mjs`, never in the header (section d).
- [ ] **W3.1-6 Make BpLink read `/plan` (code change, Wolf, compiled here).** In `Private/BpLink.cpp` and
      `Public/BpLink.h`:
  - add `FBpPlan Plan; bool bHasPlan = false;` to `FBpLinkSnapshot`;
  - after the structure answer, `GET {Root}/plan` with `Accept: application/json`, read through
    `BpSchema::FromJson(..., Snapshot.Plan)`, then the stream request;
  - change `LogKettle` to print the plan's levels:
    `BpLink: Kettle wings=%d [%s] rooms=%d bays=%d tiles=%d lenses=%d events=%d rev=%s`, with the wing names joined
    in `order`;
  - a failed plan read logs `BpLink: GET %s/plan failed ...` and still logs the structure counts, labelled
    `domains=` (review finding 2: domains are not wings);
  - update the `WP3.1.md` "requests BpLink makes" table (drop "(planned)").
  Rebuild both targets. Proof: exit 0 on both.
- [ ] **W3.1-7 Acceptance: the log line.** With `npm run server` up, start
      `UnrealEditor.exe "$PWD\apps\vr\bp.uproject" -log`, or the game:
      `UnrealEditor-Cmd.exe "$PWD\apps\vr\bp.uproject" -game -windowed -log -abslog="$PWD\apps\vr\Saved\Logs\wp31.log"`.
      Wait for the line; do not pass `-ExecCmds=Quit`, which can quit before the HTTP answer. Or type `BpLink.Fetch`
      in the console. Expected, in `LogBpLink`:
      `BpLink: Kettle wings=5 [Foundations, Studio operations, Money, Members & reach, Frontier] rooms=13 bays=29 tiles=133 lenses=8 events=566 rev=<16 hex>`
      then `BpLink: kettle has no live stream (405); using rev <same> read once from structure`.
      The rev must equal `curl.exe -s http://127.0.0.1:3100/api/products/kettle/plan` `.rev`.
      Any `skipped an events line` warning means `events` is below 566: record it as a finding, not a pass.
      Proof: both lines copied verbatim into the run note and into the commit body (`WP3.1.md`: "Copy it into the
      commit that records the first real run").
- [ ] **W3.1-8 Server down.** Stop the server, then `BpLink.Fetch`. Proof: one `LogBpLink: Error: BpLink: GET .../structure failed (connected=0, status=0). Is `npm run server` running?`
      and no crash.
- [ ] **W3.1-9 Simulator boot.** `$env:XR_RUNTIME_JSON="$env:LOCALAPPDATA\MetaXRSimulatorExtract\PFiles\MetaXRSimulator\v207.0\meta_openxr_simulator.json"; UnrealEditor-Cmd.exe "$PWD\apps\vr\bp.uproject" -game -unattended -nosplash -RenderOffScreen -log -abslog="$PWD\apps\vr\Saved\Logs\sim-boot.log"`.
      Proof: `LogHMD: Initialized OpenXR on Meta XR Simulator runtime version 207.0.0` and the W3.1-7 line in the same
      log (the plan.md P0 tool check, "the Meta XR Simulator ... showing a test level").
- [ ] **W3.1-10 Record and tick.** `machine.md` (S4, S5, S6 facts, GPU and RAM); flip `apps/vr/README.md` and
      `WP3.1.md` from "not compiled" to the dated reading, with what was and was not run; tick here. Commit
      `Host: Wolf`.

### P3 W3.2 to W3.6 and the gate (Wolf, about 1.5 to 2 weeks)

All of these depend on WP3.1. The geometry always comes from `FBpPlan` (wing, room, bay and tile boxes in world
units; `parentId` links). VR never computes a layout or health rule (tech-stack.md §1). If a number is needed and
`/plan` lacks it, that is a **Lynx** change to the plan handler and `plan-1.schema.json`, not C++ logic.

- [ ] **W3.2 The table (3 to 4 days).** Table mesh (greybox), a blueprint-paper material, and the wing footprints drawn
      into a runtime render target from `Plan.wings[*].box`, in `order` left to right, with the names as text (a
      high-resolution world-space widget or a Meta compositor layer, never text baked onto the mesh; tech-stack.md §2).
      The table top is at a natural standing height: start at 95 cm and let the owner set it **[owner]**. Map plan
      units to centimetres with one named constant.
      Proof: a capture `captures/w32-<date>-wolf.jpg` from the target pose (standing, about 45° down at the near edge)
      showing A to E left to right with readable names; a log line
      `BpTable: wings=5 order=A,B,C,D,E height_cm=<n>`.
- [ ] **W3.3 Volumes (2 to 3 days).** Instanced rooms (13), bays (29) and tiles/fixtures (133), one
      `UInstancedStaticMeshComponent` (or HISM) per kind, and an edge-glow v0 material (fresnel plus edge mask, low
      face opacity). Heights carry stage or lens reading, never position.
      Proof: `BpTable: instances rooms=13 bays=29 tiles=133`; `stat scenerendering` (Mesh draw calls) shows one draw
      per instance batch per eye pass, numbers in the run note; a capture.
- [ ] **W3.4 Hands and zoom (3 to 5 days).** Meta Interaction SDK hand tracking (OculusInteraction poses). Point to
      highlight; pinch-pull lifts a room (L0 to L2); a breadcrumb and a way back. Tracking loss is a state (registry
      `hand-tracked-timing-windows`): pinch is judged from motion onset, and controllers are the fallback.
      Proof: log lines `BpLevel: L0 -> L1 wing=<id>`, `L1 -> L2 room=<id>` and the reverse for every level;
      `BpHands: tracking lost -> held` / `tracking back` when the owner hides the hands; the owner's note in the run
      file (headset, Link).
- [ ] **W3.5 Lenses (1 to 2 days).** A lens switch on the wrist over `Plan.lenses` (8 ids). A lens changes what places
      say (tile `health[<lens>]`, `general`), never where they are.
      Proof: an automation test or console command `BpLens.Cycle` that switches all 8 and logs
      `BpLens: <id> moved=0` for each (wing, room, bay and tile transforms compared before and after); a capture of two
      lenses side by side.
- [ ] **W3.6 Render spike (2 days).** Forward + MSAA (`r.ForwardShading=1`, `r.AntiAliasingMethod=3`,
      `r.MSAACount=4`, `vr.InstancedStereo=1` in `apps/vr/Config/DefaultEngine.ini` **[verify on Wolf]** the 5.8
      names) against deferred + Lumen + TSR, at Quest 3 resolution (2064x2208 per eye), on the full Kettle plan.
      Proof: GPU and Game/Draw frame times for both in `machine.md` (from `stat unit` and `stat gpu`, plus an Unreal
      Insights trace `-trace=default,gpu` of a 60 s scripted look-around, with p50 and p95). Forward stays chosen
      unless Lumen fits 11.1 ms.
- [ ] **P3 gate (Wolf + owner, half a day).** All of these, recorded in `runs/<date>-wolf-p3-gate.md`:
  - **90 Hz on the forward path with the full Kettle plan.** Link refresh at 90 Hz and ASW off (Oculus Debug Tool)
    while measuring. Over a 60 s scripted walk the app GPU time and the game thread are each **11.1 ms or less at
    p95**, with dropped frames read from the Link Performance HUD or Oculus Debug Tool **[verify on Wolf]** the tool.
    Record p50, p95 and max.
  - **Draw calls and triangles** from `stat rhi` / `stat scenerendering`, recorded as the baseline for P4's budget
    (150 draw calls, 350k visible triangles).
  - **Text legibility.** The owner reads every wing name and the smallest label at standing distance without leaning.
    Record that label's angular height in degrees (2·atan(h / 2d)). That number becomes the VR equivalent of bp's
    12 px floor **[owner]**.
  - **Owner walk-through** in the headset: L0 to L2 and back, 8 lenses. Owner verdict line in the note.

### P4 Assets through the gated pipeline (Lynx makes, Wolf imports; 2 to 3 weeks, can start beside P3)

Chain per asset (plan.md P4, registry `image-to-3d-input-gating`, `generated-mesh-acceptance`,
`generated-asset-world-scale`, `mesh-finishing-for-engine-readiness`, `asset-class-poly-budgeting`): concept sheet, input
gate, TRELLIS.2, mesh acceptance, scale normalisation, finishing (retopology, UV, baked PBR), poly budget, then UE
import through the editor MCP.

**The hand-off folder: `apps/vr/ArtSource/<asset-id>/`** (new; outside `Content/`, so UE never auto-imports it).
Lynx writes it and commits it; Wolf reads it from master. One folder per asset id (`lamp-agent`, `table-frame`,
`survey-pin`, `studio-shelves`, ..., `city-backdrop`, `mat-vellum`, ...):

| File | Written by | What |
|---|---|---|
| `concept.png` | Lynx | the prop sheet: one object, plain neutral background, canonical pose, even light, no text, whole and uncropped |
| `final.glb` (or `final.fbx`) | Lynx (Blender headless) | the finished low-poly mesh, real-world scale in metres, pivot at the base centre, one UV set |
| `textures/*.png` | Lynx | baked PBR: base colour, normal, ORM. Tiling materials pass `tiling-texture-acceptance` |
| `manifest.json` | Lynx, then Wolf appends | `id`, `class`, `budget_tris` (plan.md P4 table), `tris`, `materials`, `bounds_cm`, the generator (Leonardo model / FLUX.2 [klein] / Qwen-Image / TRELLIS.2) with `seed` and `prompt` (or a `log.jsonl` line ref), `licence`, `sha256` of every file, `gates` (`input`, `mesh_acceptance`, `scale`, `finishing`, `poly_budget`, each `{ "pass": bool, "note": "", "date": "" }`), `lynx_commit`; then Wolf's `import` block (`ue_path`, `in_scene_tris`, `draw_calls`, `date`, `host: "Wolf"`) |

Rules: no file larger than 50 MB is committed (GitHub warns at 50 MB and refuses at 100 MB). The raw TRELLIS.2 GLB
stays on Lynx; its sha256 goes in the manifest. Look-dev frames stay in `docs/concepts/vr-light-table/lookdev/` as
today. Leonardo and FLUX.2 [dev] output is look-dev only. Anything that ships (textures, decals, the backdrop) is
FLUX.2 [klein] or Qwen-Image (tech-stack.md §5), unless the owner rules on Leonardo (section f); the backdrop is ruled: Leonardo, 2026-10-21 (FLUX.2 [klein] is not installed and will not be).

- [x] **L4.0 Lamp design lock (Lynx + owner, 1 to 2 days).** The reference sheet's weakest element. Make a lamp prop
      sheet with a **jointed arm**, hanging above the far edge (reference-sheet.md, "Across all frames" and the open
      questions). Proof: the owner's approval line in `ArtSource/lamp-agent/manifest.json` `gates.input.note`.
      Done 2026-10-21: owner picked option A, the spring-arm cone; proof is `gates.input.note` (`pass: true`) and
      `picked: "A"` in `ArtSource/lamp-agent/manifest.json`.
- [ ] **L4.1 Props (Lynx, about 1 to 2 days per asset).** Lamp agent (30k triangles, rigged look-at and state poses,
      emissive head slot), light table frame (10k), survey pin (500, instanced), studio kit (80k total), city backdrop
      (a Leonardo panorama, ruling 2026-10-21: FLUX.2 [klein] is not installed and will not be), and the materials vellum, blueprint paper, brushed aluminium and warm wood.
      Proof per asset: a manifest with every gate `pass: true`, committed with `Host: Lynx`.
      Lamp agent, 2026-10-21 (not ticked, the other props are open): `ArtSource/lamp-agent/` has `final.fbx` (26,035 tris, 4 bones,
      5 pose actions), 3 PBR PNGs and evidence; all five gates `pass: true`, `lynx_commit` is set at the merge. Reworked the same day
      after the Director review of 11:21Z (no TRELLIS rerun, no GPU): the arm is flat navy PBR in six material slots (silver joints,
      dark shade, `lamp_shade_glow` kept, amber cap, navy base) instead of the smudged TRELLIS bake; the C-clamp is modelled (the TRELLIS
      stalk was not one) and reaches 11.2 cm below the table plane; the springs are 4 silver cylinders on the arms; all evidence is
      fitted to the lamp's bounding box and checked by an alpha pass (manifest `framing`, `review_fixes`). The lamp is 45 cm above the
      table plane, 56.2 cm with the clamp.
      Director review of the reworked lamp (2dad0ad), 2026-10-21: it reads correctly (whole lamp framed, clean navy and silver arm,
      clamp on the table edge).
      Light table frame, 2026-10-21 (not ticked, the studio kit, backdrop and materials are open): `ArtSource/light-table-frame/` has
      `final.glb` (586 tris against 10,000, 1.20 x 0.80 x 0.95 m, pivot at the floor centre, 3.0 cm top edge for the lamp clamp),
      6 PBR PNGs, evidence (turnaround, the 45-degree table view and `vs-hero.jpg`, the view beside `00-hero.jpg`; Cycles on the CPU)
      and a manifest with all five gates `pass: true` (14 components, 0 floaters, one UV set, 4 slots: `frame_dark_metal`,
      aluminium, `frame_edge_glow` emissive strip, `frame_glass_placeholder_REPLACE_IN_UE`). Reworked after the Director review of
      04fc311 (warm wood, no visible edge): rim, legs and rails are dark metal on the style block's studio near-black `#0A0F18`
      (slot renamed from `frame_wood`), and the edge strip is `#F4FAFF`, 2 cm wide and 8 mm tall at emission strength 25. Procedural Blender, `scripts/art/light-table-frame/`; `lynx_commit` is set at the merge.
      Studio kit, 2026-10-21 (not ticked, the materials, backdrop and the other props are open; procedural Blender on Cycles CPU, `scripts/art/studio-kit/`, kit total 7,176 of 80,000 tris, `lynx_commit` set at the merge):
      `studio-shelves` 2026-10-21: 1,092 of 24,000 tris, 88 x 30.8 x 126 cm, steel rack with navy-stained boards, books and a roll; all five gates `pass: true`.
      `studio-desk-lamp` 2026-10-21: 1,296 of 16,000 tris, 23.7 x 18.4 x 39.1 cm, cone shade with an emissive inner slot; all five gates `pass: true`.
      `studio-mug` 2026-10-21: 1,008 of 8,000 tris, 11.9 x 8.0 x 9.5 cm, cream glaze, pale blue inside, navy handle; all five gates `pass: true`.
      `studio-drawing-tubes` 2026-10-21: 2,976 of 20,000 tris, 16.3 x 17.5 x 52.9 cm, round holder, five capped tubes and two rolls; all five gates `pass: true`.
      `studio-pinned-drawings` 2026-10-21: 804 of 12,000 tris, 114 x 3.2 x 52 cm, three framed blueprint sheets on a mounting board (input gate set true because it is procedural, not TRELLIS input); all five gates `pass: true`.
- [ ] **W4.1 Import (Wolf, half a day per asset).** Import each `final.*` through the editor MCP (pof's gap-fillers)
      into `apps/vr/Content/Bp/Art/<asset-id>/`. **Nothing is imported without its gate results** (the plan.md P4 gate).
      Proof: the manifest's `import` block; `stat rhi` and `stat scenerendering` with the asset in the greybox.
- [ ] **P4 gate (Wolf).** Every asset carries its gate results, and the whole slice stays at **150 draw calls and
      350k visible triangles or fewer** at the target pose, with the P3 frame time still held. Proof:
      `runs/<date>-wolf-p4-gate.md` with the `stat` lines and the frame times.

### P5 The loop: scan, wave, voice (Lynx Node first, then Wolf UE; 3 to 4 weeks)

The rule: anything that is a rule, a route or a wire shape is Lynx-side Node or TS work in `packages/*` or `apps/server`,
gated by `npm run check`. Wolf only draws, gestures, streams audio and calls routes.

**Lynx side (Node, before the matching Wolf step):**

- [x] **L5.1 Wire schema (review finding 3; 3 to 4 days).** Add a schema to `packages/schema/schema/` for the structure
      envelope `{ structure, events, rev }`, the six SSE events (`snapshot | delta | map | ping | error | jobs`,
      `packages/core/src/scan/types.ts:299`), `ScanSnapshot`, `ScanDelta`, `ScanJob` (`scan/jobs.ts:25`), `Proposal`
      (`types.ts:70`) and `Wave` with its packages (`scan/waves.ts:22`). Extend `parity.mjs` to these core types
      (presence and optionality), and emit their USTRUCTs. Proof: `npm run check:schema` green with a new seeded
      control that fails; `BpSchema.h` holds the new structs. Blocks W5.1.
- [x] **L5.2 Kettle sim host in apps/server (finding 5, decided 2026-10-21; 4 to 5 days).** Host `SwarmSim`
      (`packages/core/src/model/sim.ts:158`) and `ScanSim` (`model/scan-sim.ts:65`) per server process, in memory,
      never written to disk, behind the same routes (`scan`, `scans`, `waves`, `dispatch`, `stream`). This **changes
      a pinned contract**: Kettle's `/stream` stops answering 405, and Kettle writes stop being 4xx. Update
      `scripts/check-bplink.mjs`, `scripts/check-server.mjs` ("a Kettle write: 4xx", the 405 stream pin), the
      `apps/vr/README.md` BpLink contract and `products.server.ts:57-70` in one commit, with a check that nothing
      under `packages/core/data` or the working directory is written. Proof: `npm run check` green; a new check
      shows Kettle's `/stream` emitting `snapshot` then `delta` after a scan POST. W5.1 must change BpLink's 405
      fallback in step with this commit.
      Done 2026-10-21 (61181b2). Proof, from plan.md 'Milestone 1 re-measure after L5.2' (1443c3b): `46 passed, 0 failed, 0 skipped of 46`,
      `PASS check:kettle-sim`, `Kettle stream: 200 SSE, a snapshot first`.
- [ ] **L5.3 Athena host (WP5.4 Node half; 3 days).** apps/server registers bp's tools (tech-stack.md §4 table) with
      athena's `POST /manifest` (`app_id: "bp"`, `page_origin: http://127.0.0.1:<port>`) and executes an approved
      action when a decision returns `execute`. Proof: a seam smoke script (for example `scripts/smoke-athena.mjs`)
      against a real daemon. A spoken or typed "dispatch the wave" files one GATED card, and "approve" runs exactly
      that wave once. The daemon runs on Wolf (S10), so the smoke's real run is a **Wolf** reading, unless Lynx gets an
      athena-portable checkout.

**Wolf side (UE):**

- [ ] **W5.1 Scan (4 to 5 days; needs L5.1, L5.2).** A sweep gesture or voice starts `scan.place` for the pointed scope
      (core's `scopesAt` gives the scope, via a route or the wire). The scan-line band is a material parameter
      collection. Pins rise from the SSE stream: a BpLink SSE reader over the UE HTTP module's streaming response
      **[verify on Wolf]** the 5.8 API, parsed through the wire USTRUCTs. Proof: findings appear at their fixtures
      (log `BpScan: pin <finding> at tile <id>`); a sweep with no scope is a visible reject (`BpScan: reject ...`).
- [ ] **W5.2 Packages (3 days).** Pinch a pin onto the wrist; set model (Sonnet 5.5 or Opus 5.5) and effort (low to
      xhigh). BpLink writes with `Content-Type: application/json` and a loopback Host (`local-only.ts`). Proof: the
      server's wave contract holds (`npm run check:waves` stays green; one finding in one draft wave at most, shown
      by trying to add it twice).
- [ ] **W5.3 Dispatch and jobs (3 days).** Dispatch is athena's GATED `wave.dispatch`; at most 3 jobs run at once;
      progress shows on the wrist and as light in the room. Proof: a wave dispatched by voice and one by pinch land
      as the same job shape (`GET /api/products/<slug>/scans` or the jobs event).
- [ ] **W5.4 Voice and cards (4 to 5 days; needs L5.3, S10).** UE streams the microphone as PCM16 to athena's
      `/voice` websocket (UE `WebSockets` module) and plays the reply. The lamp's states follow athena's events. The
      cards come from `/decisions` and are answered by `POST /decisions/<id>`. Proof: the L5.3 seam smoke run from the
      headset, with log lines.
- [ ] **W5.5 Live product (2 days).** The loop on a product in `bp.products.local.json` (git-ignored), not only Kettle.
      Proof: `node scripts/smoke-live.mjs` green against `npm run server`, plus the headset run.
- [ ] **P5 gate.** The full loop by voice alone and by hand alone, on Kettle and on a live product
      (`runs/<date>-wolf-p5-gate.md`).

### P6 Beauty pass (Wolf, with Lynx textures; 2 to 3 weeks)

- [ ] **W6.1 Light, materials, post and text** per plan.md P6: the table as key light (rect lights and baked bounce on
      the forward path), edge glow v1, glass, paper fibre, the lamp's warm head; fog and bloom tuned against text
      legibility; every readable string a compositor layer or a high-resolution widget.
- [ ] **W6.2 Fidelity capture.** pof's `capture_viewport` from the target pose (standing, about 45° down at the near
      edge, lamp in the upper third). Save it as `captures/p6-<date>-wolf.jpg`, next to `target-light-table.jpg`.
- [ ] **W6.3 Score.** Score all 15 elements in `art-breakdown.md` 0 to 3, with a vision-model pre-score as advice only,
      in `runs/<date>-wolf-p6-fidelity.md`. **Pass:** no element below 2, and elements 1, 4, 7, 9, 10 and 11 at 3;
      the owner's verdict in the headset; the P3 frame-time gate re-run and still held (11.1 ms p95).

### P7 Comfort and hardening (Wolf + owner; 1 to 2 weeks)

- [ ] **W7.1 Comfort.** No artificial locomotion; a seated mode that lowers the table; snap re-centre; reduced motion
      honoured; a session timer and a rest pose.
- [ ] **W7.2 Failure states drawn on purpose.** Server down (W3.1-8 extended to a drawn state), Athena down, voice not
      ready, tracking lost, a job failed, the token cap reached. Proof: one capture and one log line each.
- [ ] **W7.3 Docs.** `apps/vr/README.md` ("run it", replacing the placeholder text), bp's `README.md` channel table, and
      a registry lead for what tethered VR and generated props taught (Lynx can file the lead).
- [ ] **P7 gate (owner).** The owner works one hour in it and wants to come back.

---

## (d) Gates on Wolf before merging, and the schema parity rule

Run before every Wolf commit that touches code (`apps/vr`, `packages/*`, `apps/server`, `scripts/`):

- [ ] `npm run check` at the repo root: `N passed, 0 failed, 0 skipped of N` (only `check:python-deps` may be skipped).
      This includes `typecheck`, `check:schema` (generated TS and UE headers current; every schema field mapped or
      carried; parity), `check:bplink` (the BpLink contract) and `check:server` (apps/server mounts and guards).
- [ ] `Build.bat bpEditor Win64 Development "-Project=$PWD\apps\vr\bp.uproject" -WaitMutex`: exit 0.
- [ ] `Build.bat bp Win64 Development "-Project=$PWD\apps\vr\bp.uproject" -WaitMutex`: exit 0.
- [ ] If BpLink or the schema changed: W3.1-7's line again, verbatim.
- [ ] `git status --short` shows only the step's paths: no `Binaries/`, `Intermediate/`, `Saved/`, `.sln`, plugin
      trees, or files under the schema junction (E1).

**The parity rule for `packages/schema/generated/ue`.**

- Both headers are generated by `packages/schema/generate.mjs` from `packages/schema/schema/*.schema.json`. They are
  never edited by hand, never copied into `apps/vr`, and never patched to make UHT or MSVC happy.
- A UE-side fault in a generated header is fixed in `generate.mjs` (or the schema). Then run `npm run schema:generate`
  and `npm run check:schema`, and commit the generator, the schema and both regenerated files (TS and UE) in **one**
  commit, with the UE build that proves it.
- BpLink reaches the headers by the include path in `BpLink.Build.cs`, or through the git-ignored junction from E1.
  Either way the bytes compiled are the bytes `check:schema` checks.
- Any UE-only header BpLink needs (wrappers, helpers) lives in `apps/vr/Source/BpLink/`, never in
  `packages/schema/generated/`.

---

## (e) Known gaps to resolve first on Wolf

**The BpLink source has never been compiled or syntax-checked** (`apps/vr/README.md`, `WP3.1.md`). The generated
headers were only parsed by `clang++ -fsyntax-only` against stand-ins (`packages/schema/ue-standin/`). Risks seen by
reading the source, most likely first. Each one is **[verify on Wolf]**.

- [ ] **E1 UHT never sees `BpSchema.h`.** It sits in `packages/schema/generated/ue/`, outside the module. `BpLink.Build.cs:18-19`
      only adds it to `PublicIncludePaths`. UHT scans a module's own folders, so `#include "BpSchema.generated.h"`
      (`BpSchema.h:13`) is expected to fail. Fix that keeps a single source: a directory junction
      `cmd /c mklink /J apps\vr\Source\BpLink\Public\Schema ..\..\..\..\..\packages\schema\generated\ue` (use the
      absolute target if the relative form fails). Then:
  - point `SchemaUe` in `BpLink.Build.cs` at `Path.Combine(ModuleDirectory, "Public", "Schema")`, or drop it, so that
    there is **one** path to the header (two paths to one file can defeat `#pragma once` and define every USTRUCT
    twice);
  - add `apps/vr/Source/BpLink/Public/Schema/` to `.gitignore` **before** any `git add`. Git does not store a junction:
    it would commit copies of the headers, which breaks the single source;
  - add a small `apps/vr/tools/link-schema.ps1` that creates the junction idempotently, and call it from the README's
    setup steps.
  If UHT still skips the junctioned file, record that, and take it to the owner (section f) before copying anything.
- [ ] **E2 `override` as a field name.** `FBpFacet` holds `FBpFacetOverride override;` (`BpSchema.h:797`). It is
      contextual in C++, but UHT's tokenizer may reject it. The fix is a `<Key>_` rename plus a `FixUp` copy, in
      `generate.mjs`, the same way `short` and `default` are carried.
- [ ] **E3 Module name and API macro.** The UBT module is `BpLink` (`BpLink.Build.cs:5`, `IMPLEMENT_MODULE(FBpLinkModule, BpLink)`
      at `BpLink.cpp:15`), so `BPLINK_API` is defined for it. Every generated struct is `BPLINK_API`. That is correct
      while the headers compile inside BpLink only; any other module including them would import the symbols, and
      must depend on `BpLink`. The template's game module is `bp`, so its macro is `BP_API`: check that no engine or
      plugin header already uses that name.
- [ ] **E4 Module dependencies.** `Json` (`Dom/JsonObject.h`, `Serialization/JsonSerializer.h`,
      `Policies/CondensedJsonPrintPolicy.h`), `JsonUtilities` (`JsonObjectConverter.h`, `JsonObjectWrapper.h`, the
      latter included by `BpSchema.h:12`) and `HTTP` (`HttpModule.h`, `Interfaces/IHttpRequest.h`,
      `Interfaces/IHttpResponse.h`) are all listed as public dependencies (`BpLink.Build.cs:13`). Expect strict
      include-what-you-use errors for anything that leaned on `CoreMinimal.h`. W5.4 adds `WebSockets`.
- [ ] **E5 `FJsonObjectConverter` usage.**
  - `BpSchemaFixups.h:40` calls `JsonValueToUProperty(Value, Property, Ptr, 0, 0)`, and `:161` calls
    `JsonObjectToUStruct(Json, &Out, 0, 0)`. Check both signatures and the `int64` flag parameters in 5.8.
  - `CopyRaw` (`:50`) calls `FJsonSerializer::Serialize(Value, FString(), Writer)` on a bare value. A string glyph
    (`"bars"`) at the writer's root may hit a `check` at run time even if it compiles. Exercise it: Kettle's 8 lens
    manifests carry `glyph` (`FixUp carries ... Presentation.Glyph_ 23`, plan.md P1 table).
  - The converter maps keys to property names case-insensitively, so the lowercase UPROPERTYs (`name`, `id`, `min`,
    `max`, `x`, `y`, `w`, `h`) depend on that. `min` and `max` also need Windows' `NOMINMAX`, which UE normally sets.
  - Check how a JSON `null` lands on an `FString` or struct field: if `FromJson` returns false on Kettle, the error is
    `did not parse into FBpAppStructure` (`BpLink.cpp:94`).
- [ ] **E6 The fix-up header.** `BpSchemaFixups.h` forward-declares every `FixUp` overload (`:23-31`) before the
      templates that call them. Two-phase lookup should resolve them at instantiation; MSVC conformance mode
      (`/permissive-`) is the check. `GET_MEMBER_NAME_CHECKED(FBpAppStructure, Schema_)` and the like need the
      renamed fields to exist, which `check:schema` guards on the Node side.
- [ ] **E7 BpLink.cpp details.**
  - `UE_LOG` passes `bool bConnected` to `%d` (`BpLink.cpp:81-82`), and `%.80s` takes `*Line` (`:44`): UE 5.x
    format-string validation may reject either.
  - The completion lambda signature `(FHttpRequestPtr, FHttpResponsePtr, bool)` and the `mutable` lambda in
    `BindLambda` (`:105`).
  - `FPlatformMisc::GetEnvironmentVariable` returning `FString`, and `FParse::Value` on `-BpLinkUrl=http://...`
    (stopping at a separator).
  - `FHttpModule::Get()` from `StartupModule` at `PostEngineInit`. If no line appears on boot, `BpLink.Fetch` is the
    manual trigger.
  - `FAutoConsoleCommand` as a static in an anonymous namespace (`:144`).
- [ ] **E8 PCH and include path.** `PCHUsage = UseExplicitOrSharedPCHs` with no private PCH is standard. Check that UBT
      accepts an absolute `PublicIncludePaths` entry outside the project. E1 may remove it.

**The review's open findings** (`docs/architecture-review-2026-10-21.md`):

- [ ] **Finding 3, the wire schema** (blocks P5, not P3): L5.1, Lynx. Until it lands, W5.1 to W5.3 would need
      hand-written C++ structs, which the parity rule forbids. Do not start W5.1 before L5.1 is ticked.
      L5.1 landed in `73d5dec`.
- [ ] **Finding 5, the sim host** (blocks the P5 Kettle gate): decided 2026-10-21 (apps/server hosts SwarmSim and
      ScanSim in memory), not built. L5.2, Lynx. It changes the pinned 405 stream contract, so BpLink's fallback and
      `check-bplink` must change in the same window.
- Closed, for the record: finding 1 (the plan endpoint, `421e340`), finding 2 (the level words, `ff8a73a`), finding 4
  (pure rules into core, `d031a1a`).

---

## (f) Risks and owner decisions still open

| # | Risk or decision | Owner? | Default if nobody decides |
|---|---|---|---|
| R1 | UHT refuses the junctioned header (E1). The only remaining route is a generated copy under `apps/vr`, which needs a new parity check (copy equals source). | **owner** | stop at W3.1-4 and ask; never hand-copy |
| R2 | The UE patch version. plan.md says 5.8.2; the box read 5.8.3 on 2026-10-07. Meta v207's BuildId still matched (55116800), but plugin loading on 5.8.3 was "not re-proven" by mage-arena-vr. | owner | use the installed 5.8.x and record it; S6's BuildId line is the check |
| R3 | Blank versus VR template (W3.1-2). | agent | Blank C++, plus the S6 plugins |
| R4 | The table height, the text floor in degrees (P3 gate), and the comfort defaults. | **owner** | 95 cm; the floor is whatever the owner reads at the P3 walk |
| R5 | The 90 Hz measure. Is the p95 GPU and game thread at 11.1 ms the bar, or p50? (The web budget left the same question open; plan.md, "Milestone 1 idle re-measure".) | **owner** | p95 at 11.1 ms, with p50 and max recorded |
| R6 | Scan line colour, cyan (art-breakdown #8, the target) versus amber (the style block's attention role). Open in reference-sheet.md. | **owner** | cyan, as the target and frame 03 show |
| R7 | The lamp design (L4.0) before P4 props or more style frames. | **owner** | the jointed drafting arm from frames 06 and 08 |
| R8 | Leonardo output in shipped assets. tech-stack.md §5 keeps shipped art to FLUX.2 [klein] or Qwen-Image; the reference sheet was made with Leonardo. | **owner** | Leonardo for look-dev only; ruling 2026-10-21 (the Director, for the operator): the city backdrop ships from Leonardo (FLUX.2 [klein] is not installed and will not be) |
| R9 | Large binaries. The ArtSource rule commits files of 50 MB or less and keeps raw meshes on Lynx; Git LFS is not set up in bp. | **owner** | no LFS; the sha256 is in the manifest |
| R10 | Where the athena daemon runs for L5.3's smoke (Wolf has athena-portable; Lynx is not in its fleet entry). | owner | Wolf |
| R11 | The L5.2 contract change (Kettle's `/stream` stops answering 405) lands on Lynx while Wolf's BpLink still expects 405. | agent | one window: land L5.2 and BpLink's SSE change back to back, and `check-bplink` pins the new answer |
| R12 | GPU contention. With generation on Lynx, the "one at a time" rule on Wolf (plan.md risks) only applies if ComfyUI or TRELLIS.2 also run on Wolf. | agent | check that no UE VR session is running before any generation job on Wolf |
| R13 | bp is not in the ai-registry fleet file for Wolf (`projects.json`). Hygiene and fleet tooling will not see the Wolf checkout. | owner | register `bp` with checkout `kiro/bp` on Wolf |
| R14 | The forward path cannot fake the concept's bounce light well enough for the fidelity score (plan.md risks). | owner, at P6 | rect lights and baked bounce first; Lumen only if the score needs it and the frame fits |
