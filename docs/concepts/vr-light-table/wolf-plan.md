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
FLUX.2 [klein] or Qwen-Image (tech-stack.md §5), unless the owner rules on Leonardo (section f); the backdrop is ruled: Leonardo, 2026-10-21 (FLUX.2 [klein] is not installed and will not be; R8, closed). A Leonardo image as TRELLIS.2 input for a shipped mesh (`lamp-agent`) is R8b, still open.

- [x] **L4.0 Lamp design lock (Lynx + owner, 1 to 2 days).** The reference sheet's weakest element. Make a lamp prop
      sheet with a **jointed arm**, hanging above the far edge (reference-sheet.md, "Across all frames" and the open
      questions). Proof: the owner's approval line in `ArtSource/lamp-agent/manifest.json` `gates.input.note`.
      Done 2026-10-21: owner picked option A, the spring-arm cone; proof is `gates.input.note` (`pass: true`) and
      `picked: "A"` in `ArtSource/lamp-agent/manifest.json`.
- [x] **L4.1 Props (Lynx, about 1 to 2 days per asset).** Lamp agent (30k triangles, rigged look-at and state poses,
      emissive head slot), light table frame (10k), survey pin (500, instanced), studio kit (80k total), city backdrop
      (a Leonardo panorama, ruling 2026-10-21: FLUX.2 [klein] is not installed and will not be), and the materials vellum, blueprint paper, brushed aluminium and warm wood.
      Proof per asset: a manifest with every gate `pass: true`, committed with `Host: Lynx`.
      Lamp agent, 2026-10-21: `ArtSource/lamp-agent/` has `final.fbx` (26,035 tris against 30,000, 4 bones,
      5 pose actions), 3 PBR PNGs and evidence; all five gates `pass: true`, `lynx_commit` is `2dad0ad`. Reworked the same day
      after the Director review of 11:21Z (no TRELLIS rerun, no GPU): the arm is flat navy PBR in six material slots (silver joints,
      dark shade, `lamp_shade_glow` kept, amber cap, navy base) instead of the smudged TRELLIS bake; the C-clamp is modelled (the TRELLIS
      stalk was not one) and reaches 11.2 cm below the table plane; the springs are 4 silver cylinders on the arms; all evidence is
      fitted to the lamp's bounding box and checked by an alpha pass (manifest `framing`, `review_fixes`). The lamp is 45 cm above the
      table plane, 56.2 cm with the clamp.
      Director review of the reworked lamp (2dad0ad), 2026-10-21: it reads correctly (whole lamp framed, clean navy and silver arm,
      clamp on the table edge).
      Light table frame, 2026-10-21: `ArtSource/light-table-frame/` has
      `final.glb` (586 tris against 10,000, 1.20 x 0.80 x 0.95 m, pivot at the floor centre, 3.0 cm top edge for the lamp clamp),
      6 PBR PNGs, evidence (turnaround, the 45-degree table view and `vs-hero.jpg`, the view beside `00-hero.jpg`; Cycles on the CPU)
      and a manifest with all five gates `pass: true` (14 components, 0 floaters, one UV set, 4 slots: `frame_dark_metal`,
      aluminium, `frame_edge_glow` emissive strip, `frame_glass_placeholder_REPLACE_IN_UE`). Reworked after the Director review of
      04fc311 (warm wood, no visible edge): rim, legs and rails are dark metal on the style block's studio near-black `#0A0F18`
      (slot renamed from `frame_wood`), and the edge strip is `#F4FAFF`, 2 cm wide and 8 mm tall at emission strength 25. Procedural Blender, `scripts/art/light-table-frame/`; `lynx_commit` is `60db9b6`.
      Studio kit, 2026-10-21 (procedural Blender on Cycles CPU, `scripts/art/studio-kit/`, kit total 7,176 of 80,000 tris; `lynx_commit` is `ca2fa38` shelves, `dea248c` desk lamp, `a74a648` mug, `13018a0` drawing tubes, `6d95122` pinned drawings):
      `studio-shelves` 2026-10-21: 1,092 of 24,000 tris, 88 x 30.8 x 126 cm, steel rack with navy-stained boards, books and a roll; all five gates `pass: true`.
      `studio-desk-lamp` 2026-10-21: 1,296 of 16,000 tris, 23.7 x 18.4 x 39.1 cm, cone shade with an emissive inner slot; all five gates `pass: true`.
      `studio-mug` 2026-10-21: 1,008 of 8,000 tris, 11.9 x 8.0 x 9.5 cm, cream glaze, pale blue inside, navy handle; all five gates `pass: true`.
      `studio-drawing-tubes` 2026-10-21: 2,976 of 20,000 tris, 16.3 x 17.5 x 52.9 cm, round holder, five capped tubes and two rolls; all five gates `pass: true`.
      `studio-pinned-drawings` 2026-10-21: 804 of 12,000 tris, 114 x 3.2 x 52 cm, three framed blueprint sheets on a mounting board (input gate set true because it is procedural, not TRELLIS input); all five gates `pass: true`.
      Survey pin, 2026-10-21: `survey-pin` 420 of 500 tris (instanced), 3.7 x 5.45 x 1.3 cm, pivot at the needle tip, blank tag card for the UE text layer; procedural Blender 5.2.2, `scripts/art/build_art.bpy`; all gates pass: true; `lynx_commit` `474731d`.
      Fixture kit, 2026-10-21: `fixture-kit` five tile meshes, 452 tris in all, the largest 164 (ops) against 300 per mesh, 5 x 3 x 5 cm largest extent; procedural Blender 5.2.2, `scripts/art/build_art.bpy`; all gates pass: true; `lynx_commit` `474731d`.
      City backdrop, 2026-10-21: `city-backdrop` 72 of 200 tris (a curved panel), a 180 degree arc 2000 x 600 x 1000 cm; the panorama is Leonardo `openai/gpt-image-2.5-flare`, MEDIUM, 2048x768, seed 3 (ruling 2026-10-21); all gates pass: true; `lynx_commit` `47230b9`.
      `mat-vellum` 2026-10-21: tiling pass, worst seam ratio 1.0644 (limit 1.25), 3 PNGs at 2048, one tile 0.5 m; procedural Blender 5.2.2 (`scripts/art/materials/`); all gates pass: true; `lynx_commit` `b31a649`.
      `mat-blueprint-paper` 2026-10-21: tiling pass, worst seam ratio 1.0427 (limit 1.25), 3 PNGs at 2048, one tile 0.5 m; procedural Blender 5.2.2 (`scripts/art/materials/`); all gates pass: true; `lynx_commit` `b31a649`.
      `mat-brushed-aluminium` 2026-10-21: tiling pass, worst seam ratio 1.0536 (limit 1.25), 3 PNGs at 2048, one tile 0.25 m; procedural Blender 5.2.2 (`scripts/art/materials/`); all gates pass: true; `lynx_commit` `b31a649`.
      `mat-warm-wood` 2026-10-21: tiling pass, worst seam ratio 1.0076 (limit 1.25), 3 PNGs at 2048, one tile 0.5 m; procedural Blender 5.2.2 (`scripts/art/materials/`); all gates pass: true; `lynx_commit` `b31a649`.
      Done 2026-10-21: all 14 hand-off folders have every gate `pass: true` and `lynx_commit` set to the last commit that changed the folder (corrected 2026-10-22: no `lynx_commit` carries a parsed Host: Lynx trailer, see plan.md 'P4 Lynx-side back-measure (2026-10-22)' gap 1; nothing is rewritten). `npm run check:art` passes (ids, gates, budgets, sha256, 50 MB cap, `lynx_commit` in history and touching its folder; its seeded control fails as expected) and is part of `npm run check`. ArtSource holds 59.6 MB committed, no file over 10 MB. Wolf work (W4.1, P4 gate) stays open.
      Back-measure 2026-10-22 (Lynx side, master `a9bfe8f`): `npm run check` 69 of 69 pass and `npm run check:art` 0 violations through `isolated-gate.mjs`; the 14 folders, the 34,741 summed Lynx-side triangles against the 350k scene budget (draw calls and in-scene tris are not measured here) and the open trailer gap are in plan.md 'P4 Lynx-side back-measure (2026-10-22)'. Wolf's W4.1 and the P4 gate stay open.
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
- [x] **L5.3 Athena host (WP5.4 Node half; 3 days).** apps/server registers bp's tools (tech-stack.md §4 table) with
      athena's `POST /manifest` (`app_id: "bp"`, `page_origin: http://127.0.0.1:<port>`) and executes an approved
      action when a decision returns `execute`. Proof: a seam smoke script (for example `scripts/smoke-athena.mjs`)
      against a real daemon. A spoken or typed "dispatch the wave" files one GATED card, and "approve" runs exactly
      that wave once. The daemon runs on Wolf (S10), so the smoke's real run is a **Wolf** reading, unless Lynx gets an
      athena-portable checkout.
      Done 2026-10-22 on Lynx, against athena-portable at HEAD 9beaef31 (operator 2026-10-22, R10).
      `apps/server/src/athena-host.ts`, attached by `npm run server -- --athena <url> --athena-token-file <daemon.json>`.
      `npm run check:athena-host` is offline and joins `npm run check`; each of its five assertions has a seeded control
      shown red. `node scripts/smoke-athena.mjs` ran green, 22 passed and 0 failed. Its output: the manifest gave
      `host.bp.navigate=AUTO, lens_set=AUTO, scan_place=AUTO, wave_compose=AUTO, wave_dispatch=GATED,
      decision_answer=GATED, finding_decline=AUTO`. One live turn `dispatch the wave` (claude_code, 1 of at most 2,
      cost_usd 0.136584) filed one GATED card `apr_944fc564ad95` (`apr_` + 12 hex). Approved through the host, its
      execute ran wave.dispatch with a 202, and `one wave dispatched: job sim-1 (execute, model sonnet, effort low)`, jobs
      0 -> 1. The replay was refused with `409 {"ok":false,"reason":"pending_approval","detail":"approval apr_944fc564ad95 is
      approved, not pending"}`, and the job count stayed 1 -> 1. `GET /ledger` shows the turn (origin host:bp).
      Afterwards netstat shows no LISTENING row on either port. Two spellings differ from the text above (tech-stack.md section 4,
      "Open seam"): the page origin is `http://localhost:<port>`, because athena refuses `http://127.0.0.1:<port>`, and the
      tools travel as `wave_dispatch` and so on.
      **The smoke stays a hand-run (decided 2026-10-22, not to be re-opened).** `scripts/smoke-athena.mjs` (`40327a1`)
      is not a `package.json` script and not in `npm run check`, on purpose. It starts a real athena daemon in a fresh
      `ATHENA_HOME` under the OS temp dir and spends one live model turn, and an offline check chain can carry neither.
      - Command, from the repo root: `node scripts/smoke-athena.mjs`. The offline subset, `node scripts/smoke-athena.mjs --no-turn`,
        runs the daemon, the manifest, the seam probe and the draft wave, then tears down before the live turn, so it spends nothing.
        It needs athena-portable and `uv` on the box (`BP_SMOKE_ATHENA_DIR`, `BP_SMOKE_UV`; the defaults are Lynx's paths).
      - When: before and after any change to `apps/server/src/athena-host.ts` or the athena seam (the manifest, the tool
        names and classes in tech-stack.md section 4, the decision and execute path, `--athena` in `npm run server`). Run the
        full form at least once after such a change. `--no-turn` is the quick form while iterating.
      - Green: the last line reads `smoke-athena: 22 passed, 0 failed` for the full run (the Lynx reading above), with exit 0.
        `--no-turn` stops earlier with fewer checks and `0 failed`. Any `FAIL` line, or a port left LISTENING afterwards, is red.
      - The offline gate in the chain is `npm run check:athena-host`, which is part of `npm run check` and runs on every
        commit. The smoke does not replace it, and it does not replace the smoke.

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

| # | Risk or decision | Owner? | State (2026-10-22), and the default if nobody decides |
|---|---|---|---|
| R1 | UHT refuses the junctioned header (E1). The only remaining route is a generated copy under `apps/vr`, which needs a new parity check (copy equals source). | **owner** | **ASK, open** (below). Until answered: stop at W3.1-4 if the junction fails; never hand-copy |
| R2 | The UE patch version. plan.md says 5.8.2; the box read 5.8.3 on 2026-10-07. Meta v207's BuildId still matched (55116800), but plugin loading on 5.8.3 was "not re-proven" by mage-arena-vr. | owner | **CLOSED 2026-10-22, default stands:** use the installed 5.8.x and record it. Proof on Wolf: S4's `Build.version` lines and S6's `PLUGIN_BUILD_ID=` equal to `ENGINE_COMPATIBLE_CHANGELIST` (below) |
| R3 | Blank versus VR template (W3.1-2). | agent | Blank C++, plus the S6 plugins |
| R4 | The table height, the text floor in degrees (P3 gate), and the comfort defaults. | **owner** | **ASK, open** (below). Until answered: 95 cm; the floor is whatever the owner reads at the P3 walk |
| R5 | The 90 Hz measure. Is the p95 GPU and game thread at 11.1 ms the bar, or p50? (The web budget left the same question open; plan.md, "Milestone 1 idle re-measure".) | **owner** | **ASK, open** (below). Until answered: measure p50, p95 and max; the P3 gate verdict waits |
| R6 | Scan line colour, cyan (art-breakdown #8, the target) versus amber (the style block's attention role). Open in reference-sheet.md, which now points here. | **owner** | **ASK, open** (below). Until answered: cyan, as the target and frame 03 show. Blocks nothing in P3 |
| R7 | The lamp design (L4.0) before P4 props or more style frames. | owner | **CLOSED 2026-10-21 by the owner:** option A, the spring-arm cone. Proof: `apps/vr/ArtSource/lamp-agent/manifest.json` `"picked": "A"` (line 4) and `gates.input` `"pass": true` with the approval note (lines 89-93), `fa7bfb1`; L4.0 ticked |
| R8 | Leonardo output in shipped assets. tech-stack.md §5 keeps shipped art to FLUX.2 [klein] or Qwen-Image; the reference sheet was made with Leonardo. | owner | **CLOSED 2026-10-21 for look-dev and the backdrop** (the Director, for the operator, `223a93d`): Leonardo for look-dev; the city backdrop ships from Leonardo (FLUX.2 [klein] is not installed and will not be). One remainder, not covered by that ruling, is split out as R8b |
| R8b | A Leonardo image as image-to-3D input for a shipped mesh. `lamp-agent`'s mesh is TRELLIS.2 output made from `options/A.png`, a Leonardo `openai/gpt-image-2.5-flare` image (`ArtSource/lamp-agent/manifest.json` `generator`, lines 6-18). The R8 ruling names the backdrop only. | **owner** | **ASK, open** (below). Until answered: the lamp is not imported in W4.1. Blocks nothing in P3 |
| R9 | Large binaries. The ArtSource rule commits files of 50 MB or less and keeps raw meshes on Lynx; Git LFS is not set up in bp. | owner | **CLOSED, no LFS, decided:** the 50 MB rule and the sha256-in-manifest rule (hand-off rules, this file, under the ArtSource table) are enforced by `npm run check:art` (`scripts/check-art.mjs:14`, `:103`), which is in `npm run check` |
| R10 | Where the athena daemon runs for L5.3's smoke (Wolf has athena-portable; Lynx is not in its fleet entry). | owner | Lynx (operator 2026-10-22), athena-portable checkout |
| R11 | The L5.2 contract change (Kettle's `/stream` stops answering 405) lands on Lynx while Wolf's BpLink still expects 405. | agent | one window: land L5.2 and BpLink's SSE change back to back, and `check-bplink` pins the new answer |
| R12 | GPU contention. With generation on Lynx, the "one at a time" rule on Wolf (plan.md risks) only applies if ComfyUI or TRELLIS.2 also run on Wolf. | agent | check that no UE VR session is running before any generation job on Wolf |
| R13 | bp is not in the ai-registry fleet file for Wolf (`projects.json`). Hygiene and fleet tooling will not see the Wolf checkout. | owner | **CLOSED 2026-10-22 as a decision, default stands:** register `bp` with checkout `kiro/bp` on Wolf. The action is still open: Step 0 does it. Proof: the `projects.json` entry on ai-registry `origin/main` |
| R14 | The forward path cannot fake the concept's bounce light well enough for the fidelity score (plan.md risks). | owner, at P6 | rect lights and baked bounce first; Lumen only if the score needs it and the frame fits |

How to read this table: a row is either **CLOSED** with the source that decided it, or an **ASK** below that the owner can
answer in one sitting. R3, R11, R12 and R14 are agent or P6 rows and are not owner asks today; R10 was decided by the
operator on 2026-10-22. Picking an option is enough: the agent that reads the answer makes the repo change listed under
it, in one commit that also flips the row to CLOSED with the date.

### Closed by the record

- **R2, UE patch version: default stands (closed 2026-10-22).** No owner ruling exists and none is needed, because the
  choice is checked by a machine rather than made by taste. The decision is the installed UE 5.8.x on Wolf, recorded,
  not a re-install to 5.8.2. What proves it on Wolf: S4 prints `MajorVersion 5`, `MinorVersion 8` and the
  `PatchVersion`/`Changelist`/`CompatibleChangelist` lines, and S6 prints `PLUGIN_BUILD_ID=55116800` equal to
  `ENGINE_COMPATIBLE_CHANGELIST` with no `PLUGIN_BUILD_ID_MISMATCH`. If S6 prints the mismatch, that is a new blocker for
  the owner (a plugin or engine reinstall), not this row. plan.md P0 now says 5.8.x.
- **R7, lamp design: closed 2026-10-21 by the owner.** Option A, the spring-arm cone. Proof:
  `apps/vr/ArtSource/lamp-agent/manifest.json` `"picked": "A"` (line 4) and `gates.input` `"pass": true` with the note
  "Owner picked option A, the spring-arm cone ... Approved 2026-10-21." (lines 89-93), committed in `fa7bfb1`. L4.0 is
  ticked. reference-sheet.md's open questions record the same answer.
- **R8, Leonardo in shipped assets: closed 2026-10-21 for look-dev and the backdrop.** The Director's ruling for the
  operator (`223a93d`): Leonardo is the look-dev generator, and the city backdrop ships from Leonardo because FLUX.2
  [klein] is not installed and will not be. It is carried in this file (the ArtSource hand-off rules; L4.1;
  `city-backdrop`, `47230b9`) and in tech-stack.md §5. What the ruling does not name is a Leonardo image used as
  TRELLIS.2 input for a shipped mesh, which is how `lamp-agent` was made. That is R8b, an ask.
- **R9, large binaries: closed, no LFS, decided.** The standing answer is the hand-off rule in this file (no committed
  file of 50 MB or more; the raw TRELLIS.2 GLB stays on Lynx and its sha256 is in the manifest). `npm run check:art`
  enforces it (`scripts/check-art.mjs:14` and `:103` refuse a 50 MB file; every manifest's sha256 is checked), and
  `check:art` is part of `npm run check`. ArtSource holds 59.6 MB across 14 folders with no file over 10 MB (L4.1).
  Git LFS is reopened only if a single asset needs a file of 50 MB or more, and none does.
- **R13, Wolf fleet registration: decided 2026-10-22, default stands; the action is still open.** Register `bp` with
  the Wolf checkout `kiro/bp`, by Step 0's `register-project.mjs` run. On Lynx's ai-registry checkout, read on
  2026-10-22, `projects.json` has no `bp` entry. The row is done when the entry is on ai-registry `origin/main`.
  If the script refuses because the slug points at another checkout, re-pointing goes to the owner (Step 0).

### Asks for the owner

**R1. If UHT will not process the junctioned `BpSchema.h`, how does BpLink get a header UHT will process?**
This only comes up if W3.1-4's E1 junction fails on Wolf. Answering now means a Wolf session does not stop there.

| Option | What happens | Effect on the P3 gate |
|---|---|---|
| **A (recommended).** A generated copy, with a check | `packages/schema/generate.mjs` writes the UE headers to `packages/schema/generated/ue/` as now **and** to `apps/vr/Source/BpLink/Public/Schema/`. A new parity step in `check:schema` fails when the two differ by a byte. Both copies are committed, and no one edits either by hand. | W3.1-4 goes on as soon as the Lynx commit lands. That is about half a day on Lynx; nothing on Wolf waits for the owner. |
| B. Move the single source into `apps/vr` | The generator writes the UE headers only into `apps/vr/Source/BpLink/Public/Schema/`. `packages/schema/generated/ue/` goes away, and `check:schema`, `check:bplink` and `packages/schema/ue-standin` follow the new path. | It unblocks the same way, with no copy, but a larger Lynx change touches three checks. |
| C. Stop at W3.1-4 and ask then | Nothing is decided now. | P3 waits at W3.1-4 for an owner sitting. W3.2 to the gate cannot start. |

Repo change when picked: A or B means one Lynx commit to `generate.mjs` and `check:schema` (plus, for B, the checks
above), the regenerated headers, and section (d)'s parity rule and E1 reworded to match. C changes nothing.

**R4. Table height, the text floor and the comfort defaults.** What is decided: the starting table height, how the
VR text floor in degrees is set, and which comfort defaults are on from the first build.

| Option | What happens | Effect on the P3 gate |
|---|---|---|
| **A (recommended).** Measure, then fix | W3.2 starts the table top at 95 cm behind one named constant (and a console variable such as `bp.TableHeightCm`), and the owner tunes it in the headset. The floor is the angular height of the smallest label the owner reads without leaning at the P3 walk, and it becomes the floor from then on. W7.1's comfort list (no artificial locomotion, a seated mode that lowers the table, snap re-centre, reduced motion honoured) is the default set. | The text-legibility bullet stays a measurement. The gate records the number and the owner's height. |
| B. Owner's height first | Before W3.2 the owner's standing elbow height is measured in the headset at S8, and the table top is set a fixed amount below it. The floor and comfort defaults are as in A. | As A, plus one owner step at S8. |
| C. Fix the floor now | The owner names a floor in degrees today. W3.2 sizes every label to it, and the P3 gate checks it (pass or fail) instead of measuring it. Height and comfort are as in A. | The legibility bullet becomes pass/fail against the named number. |

Repo change when picked: the W3.2 and P3-gate text in this file. For A or B, the P3-gate run note writes the measured
floor into this file and plan.md P3. For C, the number goes into both now.

**R5. The 90 Hz bar: p95 or p50 at 11.1 ms?** What is decided: which statistic of app GPU time and game-thread time over
the 60 s scripted walk has to be at 11.1 ms or less for P3 (and again at P6) to pass. Precedent: for the web canvas the
operator ruled p50 only, with p95 reported (plan.md, 'Ruling (operator, 2026-10-21): goal 1 passed'). That ruling is
about the 60 fps canvas budget and does not decide the headset.

| Option | What happens | Effect on the P3 gate |
|---|---|---|
| **A (recommended).** p95 at 11.1 ms | Both threads at p95 ≤ 11.1 ms, with p50 and max recorded. In a headset a missed frame is a visible judder or a reprojection, not just a slow frame. | The strictest bar: forward + MSAA probably has to hold with headroom. W3.6's Lumen check uses the same bar. |
| B. p50 at 11.1 ms, p95 reported | It matches the web ruling. | Easiest to pass. A tail of dropped frames can pass the gate and then show up as judder at the P7 hour. |
| C. p50 at P3, p95 at P6 | The greybox gate takes p50, and the P6 beauty-pass re-run (W6.3) takes p95. | P3 passes sooner. P6 carries the full bar, when it costs most to fix. |

Repo change when picked: the P3-gate bullet and W3.6's last sentence in this file, W6.3's "(11.1 ms p95)", and plan.md
P3's gate line.

**R6. Scan line colour: cyan or amber?** What is decided: the colour of the scan band in W5.1, and which of two docs
changes so that they agree. The pins stay amber either way (art-breakdown #7).

| Option | What happens | Effect on the P3 gate |
|---|---|---|
| **A (recommended).** Cyan | It follows the target image, art-breakdown #8 and frame 03. The style block's palette (`art-breakdown.md:53`) moves "scan" out of the amber attention role, which keeps pins and the agent head. | None: the scan line is W5.1 (P5). It blocks nothing in P3. |
| B. Amber | It follows the style block. Art-breakdown #8 (`art-breakdown.md:22`) becomes "the amber scan line", and frame 03 stops being the scan reference. | None in P3. W5.1's band and the P6 fidelity score take amber. |

Repo change when picked: one line in `art-breakdown.md` (`:53` for A, `:22` for B), the reference-sheet bullet changed
to "answered", and this row closed.

**R8b. May a Leonardo image be the image-to-3D input for a shipped mesh?** What is decided: whether `lamp-agent` as built
(TRELLIS.2 from Leonardo `options/A.png`, then flat PBR and modelled clamp and springs on Lynx) can ship. The owner's
2026-10-21 pick approved the design. It did not rule on the generator. Leonardo's terms for the account in use were
not read in this run.

| Option | What happens | Effect on the P3 gate |
|---|---|---|
| **A (recommended).** Allowed | Leonardo images may be TRELLIS.2 input for shipped meshes. The image stays in ArtSource as provenance, and the shipped bytes are TRELLIS.2 output (MIT) plus Lynx's own finishing. | None. W4.1 imports the lamp as it stands. |
| B. Backdrop only | The lamp's concept is redrawn on a local model (Qwen-Image, which has to be installed first), TRELLIS.2 is re-run, and the lamp's gates go back to `pass: false` until they pass again. | None in P3. W4.1 for the lamp waits on the Lynx rework, and the P4 gate moves. |
| C. Model the lamp procedurally | The lamp is rebuilt in Blender like the studio kit, with option A as the reference only. | None in P3. The same wait as B, and the rig and pose work is redone. |

Repo change when picked: for A, the hand-off rule under the ArtSource table and tech-stack.md §5 gain "Leonardo images
may be image-to-3D input for shipped meshes", and this row closes. For B or C, a Lynx plan item under L4.1, with
`lamp-agent`'s gates reset in its manifest.
