# Run the light table from a PC (the fallback route)

This is the PC-first way to run bp's VR table: a Windows PC builds and renders it, the bp server runs beside it, and the
headset is a display (Link, Air Link, Steam Link) or the Meta XR Simulator. It gives the full PC look and the live
companion. The build a judge runs on a Quest alone is [`standalone-plan.md`](standalone-plan.md). Machine-specific
readings are in [`machine.md`](machine.md), and the headset routes in [`headset-plan.md`](headset-plan.md).

## What you need

- **Windows 11.** x64, or ARM64 as Lynx is (UE then runs emulated, as described below).
- **A GPU** for PC VR. Lynx has an RTX Spark N1X.
- **Unreal Engine 5.8** from the Epic Games Launcher, at `C:\Program Files\Epic Games\UE_5.8`, or set `UE_ROOT`.
- **Node 22.18 or later**, and a checkout of bp with `npm install` run at its root.
- **The pof checkout** next to bp (`..\pof`). `bp.uproject` enables pof's editor-only `PoFToolset` plugin, so the editor
  build expects it. If you don't have pof, remove that entry from your local `bp.uproject`.
- **For a headset:** a Quest 3 or 3S with developer mode and hand tracking on (`headset-plan.md`, "owner steps"), plus
  a Link-capable route on the PC. Without a headset, use the Meta XR Simulator (step 2).

## 1. One-time setup (per checkout)

From the repo root, in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/link-schema.ps1      # BpLink's junction to the generated schema
powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/link-pof-toolset.ps1 # the PoFToolset junction (needs ..\pof)
powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/install-xr.ps1       # Meta XR v207 + Interaction SDK + Simulator
```

`install-xr.ps1` downloads the official Meta packages, checks them against pinned SHA-256 hashes, and puts them in
git-ignored folders. It is safe to re-run.

## 2. Build

The safe way is through the editor: `apps/vr/tools/start-editor.ps1`. It opens `bp.uproject` and builds the modules on
first open.

On an ARM64 PC, always start the editor and every build through this script. Its environment makes UE's build tools use
the bundled x64 .NET (see `machine.md`). On x64, double-clicking `bp.uproject` also works.

To build from the command line (as on Lynx):

```bash
E="C:/Program Files/Epic Games/UE_5.8/Engine"
UE_DOTNET_VERSION=10.0 PATH="$E/Binaries/ThirdParty/DotNet/10.0/win-x64:$PATH" \
  "$E/Binaries/ThirdParty/DotNet/10.0/win-x64/dotnet.exe" "$E/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.dll" \
  bpEditor Win64 Development -Project="<repo>\apps\vr\bp.uproject" -WaitMutex
```

## 3. Run

Each line below starts the bp server itself on a free port, runs the table against it, and prints the BpLink lines and
where the full log is:

```bash
node apps/vr/tools/run-bplink.mjs --mode game --game-mode /Script/bp.BpGameMode            # flat, no headset: a smoke test
node apps/vr/tools/run-bplink.mjs --mode game --xr-sim --vr                                 # the Meta XR Simulator
node apps/vr/tools/run-bplink.mjs --mode game --runtime link                                # Quest through Meta Horizon Link
node apps/vr/tools/run-bplink.mjs --mode game --runtime steamvr                             # Quest through Steam Link / SteamVR
node apps/vr/tools/run-bplink.mjs --mode game --product pof                                 # a live product from bp.products.local.json
node apps/vr/tools/run-bplink.mjs --mode game --bundle                                      # no server: the bundled Kettle snapshot
```

`--runtime` picks the OpenXR runtime for that process only. Never switch the system-wide runtime (HKLM).

**To run against a server you already have** (`npm run server`, port 3100): start the editor with `start-editor.ps1`
and use **VR Preview**. BpLink reads `http://127.0.0.1:3100` by default. `-BpLinkUrl=` or the `BP_LINK_URL`
environment variable points it elsewhere.

**The companion (Glim, the lamp):** run `npm run server` and the web app with `BP_COMPANION_URL=http://127.0.0.1:3100`,
so the desk and the headset share one companion (`docs/blueprint-ui.md`, "One companion process").

## 4. What you should see

- **The log.** It shows `BpLink: Kettle wings=5 [Foundations, Studio operations, Money, Members & reach, Frontier]
  rooms=13 bays=29 tiles=133`, then the BpTable lines.
- **In a headset:** the table seats itself at your eye (`BpView: seat headset ...`). Run `BpView.Seat` from the console
  to re-seat after moving the chair, and `BpView.TextCard 1` to show the legibility card.
- **No server answering?** BpLink falls back to the bundled snapshot and says so in the log. Writes (scans, draft
  waves) are refused until a server answers.

## When something fails

- **"Is `npm run server` running?"** The server did not answer. With `run-bplink` it starts its own; read
  `server.log` in the run folder it prints.
- **A build fails on ARM64 with a .NET error.** It was started outside `start-editor.ps1`'s environment.
- **The headset shows nothing.** Check the `LogHMD` line in the run log: it names the OpenXR runtime the app got. Rungs
  and fixes are in `headset-plan.md`.
