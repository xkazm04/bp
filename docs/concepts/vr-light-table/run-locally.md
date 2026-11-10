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

## Over the cable (a real directed scan from the Quest)

The standalone APK (`standalone-plan.md`) defaults to `http://127.0.0.1:3100` and falls back to the bundled snapshot when
nothing answers there. With the Quest on USB, `adb reverse` makes that address the PC's server, so the table reads the
server and a directed scan started on the wrist runs for real, with nothing paired and no manifest change.

Why no `usesCleartextTraffic` is needed: UE's Android HTTP is libcurl over native sockets
(`Runtime/Online/HTTP/Private/Android/AndroidPlatformHttp.cpp`, `FCurlHttpRequest`). Android's cleartext switch is honoured by
the Java network stack only; the packaged manifest has `android.permission.INTERNET` and no cleartext attribute. (By code
reading; a first real run on the device is the check.) The reverse's connection arrives at the server from the PC's own
loopback, so the server's loopback-only door applies and the LAN door is not involved.

```bash
npm run server                                 # on the PC, port 3100
node apps/vr/tools/quest-tether.mjs            # adb reverse tcp:3100 tcp:3100, then prints the device, the reverses and whether :3100 answers
adb shell am force-stop com.developersblueprint.vr   # optional since 2026-11-10: the app notices the PC within about 5 s without a restart
adb logcat -d -s UE | findstr BpLink           # which source it read (Development APK)
```

`node apps/vr/tools/quest-tether.mjs --remove` takes the reverse down again: while it stands and a server runs, the APK reads
that server instead of the bundled snapshot, so remove it before checking the build as a judge will see it.

**Which source it read.** In a Development APK, logcat shows `BpLink: reading kettle from http://127.0.0.1:3100`, and then
either `BpLink: Kettle wings=5` alone (the server answered) or `BpLink: GET .../structure failed`, `BpLink: reading kettle
from the build's bundled snapshot`, `BpLink: kettle's bundle lists 2 sample focuses` (the fallback). A Shipping APK compiles
UE's logs out: there, the console's SCAN page (MENU > SCAN) says it (`Sample scan · <place>` from the bundle; `N saved · would scan <place>` and a
real scan from the server), and a bundle's table never lists the PC's saved focuses.

## Pairing and Wi-Fi (night two, 2026-11-10)

The contract is [`table-link-v2.md`](table-link-v2.md). A person's decisions from the headset (stand-up answers, card
answers, a hand-over) need a pairing, over the cable too. The headset's side is on the console's **PC LINK** page.

```bash
npm run server -- --lan                     # from the repo root: :3100 plus the Wi-Fi door on :3101 and the pairing ceremony
node apps/vr/tools/quest-tether.mjs         # the cable route
# in the headset: MENU > PC LINK > PAIR shows a 6-character code for 2 minutes
npm run server -- pair approve <code> --scope standup,place,focus,decide,scan
npm run server -- pair open                 # a new 2-minute window, when PAIR is refused for lack of one
npm run server -- pair list                 # pairings and open requests (never the code)
npm run server -- pair revoke <id>          # ends a pairing on the PC; UNPAIR on the headset only forgets it there
```

Then remove the cable route and relaunch the app (or restart the server): `adb reverse --remove` leaves kept-alive
connections working, so the headset only moves to Wi-Fi after one of the two. The app picks the cable, then the saved
Wi-Fi door, then the bundled sample, and moves between them without a restart. Over Wi-Fi the door refuses the event
stream (403), so the app polls. Start the server from the repo root: from another folder the companion's tool server is
not found and every companion turn fails.

**The console** (the main menu, in front of you below the line of sight): MENU opens the pages ROOMS, SCAN, STAND-UP, ASK,
PROJECTS, PACKAGES, SETTINGS and PC LINK; TALK TO THE LAMP opens from a first hold to talk or SETTINGS > TALK. SETTINGS
holds VOICE and MUSIC levels, TABLE (SEAT, TOUR), WRIST, MOTION, ROOM and TALK.

**The app's saved settings** live in its own file, `Saved/BpTable.json` (`FBpStore`): the pairing token, the Wi-Fi door,
the talk consent, both volumes, the wrist, reduced motion, the room mode and the last stand-up's time. Not
GameUserSettings.ini: on the Quest the engine deleted that file at every launch (found 2026-11-10).

**Console commands added on night two** (on the Quest, a Development APK:
`adb shell am broadcast -a android.intent.action.RUN -e cmd "'<command>'"`):

| Command | Does |
|---|---|
| `BpConsole.Open <home\|rooms\|scan\|standup\|ask\|projects\|packages\|settings\|close>` | Opens a console page, or folds it to its bar |
| `BpConsole.Rows`, `BpConsole.Stat` | Logs the open page's rows; the console's state |
| `BpPad.Press <A\|B\|X\|Y\|Menu\|Up\|Down\|Left\|Right\|Home>` | A controller press through the real handler |
| `BpStandup.Act <next\|prev\|approve\|defer\|hold\|decline\|plan\|handover\|grant\|revoke\|...>`, `BpStandup.Line` | Drives the stand-up; logs its card |
| `BpStandup.Forget`, `BpStandup.Last <hours>` | A first morning again; a returning morning |
| `BpTalk.Say <text>`, `BpTalk.Hold <s>`, `BpTalk.Consent allow\|notnow\|unset`, `BpTalk.Cancel`, `BpTalk.Stat` | Talk to the lamp without or with the microphone |
| `BpLink.Pair [cancel]`, `BpLink.Unpair`, `BpLink.Where`, `BpLink.Link` | Pairing and the route (the token shows as its last 4 characters) |
| `BpStore.Dump` | Logs the saved file's path and key names, never values (non-Shipping) |
| `BpView.Bench [pitch] [yaw]` | A headset lying on the desk renders the seated view (non-Shipping) |
| `bp.Room 0\|1`, `bp.VoiceLevel`, `bp.MusicLevel`, `bp.WristFace` | The studio or your room; the two volumes; the wrist facing the eye |

What to tune when something is off on the headset: [`headset-morning-check.md`](headset-morning-check.md).

## When something fails

- **"Is `npm run server` running?"** The server did not answer. With `run-bplink` it starts its own; read
  `server.log` in the run folder it prints.
- **A build fails on ARM64 with a .NET error.** It was started outside `start-editor.ps1`'s environment.
- **The headset shows nothing.** Check the `LogHMD` line in the run log: it names the OpenXR runtime the app got. Rungs
  and fixes are in `headset-plan.md`.
