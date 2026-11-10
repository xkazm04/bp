# Competition compliance pass: what ships in the Quest APK

Date: 2026-11-04, updated 2026-11-10 ("Night two update" and "Day two update" below). Scope: the Quest APK of `apps/vr` (UE 5.8, Meta XR v207) entered in the Meta VR Start Developer
Competition 2026 (deadline 2026-11-18). It does not cover the repository, the web app or the demo video.

The rules checked (official rules, section 4):

- **R-ad:** no commercial or corporate advertising (corporate logos, brand names, slogans), no recognizable branded
  products, and no commercial artwork.
- **R-person:** no mention or depiction of an identifiable person other than the Entrants.
- **R-assoc:** no created or implied association between the Sponsor and any individual or entity.
- **R-licence:** third-party tools, code and assets must be used under their terms. The Sponsor may ask for written
  proof of ownership or licence.
- **R-en:** the project is entirely in English.

How this was checked. The app and art were not changed, and no editor or build was run. Two levels of evidence are used:

- **Seen:** I opened the file or image, or scanned its bytes or strings.
- **Record:** a manifest, log or doc says so, and I did not check it independently.

The strongest single piece of evidence is the staged manifest of the last Quest package:
`apps/vr/Saved/StagedBuilds/Android_ASTC/Manifest_UFSFiles_Android.txt` (2026-10-28, local and not in git, 2951 files).
It lists exactly what went into that APK.

## Night two update (2026-11-10)

Night two (2026-11-09 evening to 2026-11-10 morning, run note
[`runs/2026-11-10-night-two.md`](runs/2026-11-10-night-two.md)) added a microphone, a PC link over Wi-Fi, passthrough, a
music bed, more voice clips and generated sample screens. Evidence level as above: **Record** unless marked **Seen**. The
staged manifest of the night's APKs was not re-read for this update.

### The APK's permissions and features

| Entry | Where it comes from | When it is asked | Status |
|---|---|---|---|
| `android.permission.RECORD_AUDIO` | New, `Config/DefaultEngine.ini` `+ExtraPermissions` (**Seen**), for talk to the lamp | At run time, at the first hold to talk after the consent sheet's ALLOW; never at launch (`BpTalk.cpp`). The APK packaged with it on 2026-11-10 (record) | ok; the dialog itself has not been seen on the device |
| `com.oculus.feature.PASSTHROUGH` | The Meta XR plugin, because `bInsightPassthroughEnabled=True`; `Source/bp/bp_APL.xml` makes it `android:required="false"` (**Seen**) | Not a permission; a headset without passthrough still installs the app and stays in the studio | ok |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` | UE's manifest (table-link-v2.md section 10) | Install time | ok: the PC link needs them. No `usesCleartextTraffic` was added |
| `EYE_TRACKING`, `BILLING`, `CHECK_LICENSE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS` | Engine or plugin defaults, not added tonight (record). Whether they were in earlier APKs was not checked | Mixed | **check** (P11) |

### What leaves the headset, and when

- **On the bundled sample (no PC linked): nothing.** The stand-up, the scans and the talk play the build's sample; the
  talk sample opens no microphone (seen on the device, 2026-11-10) and sends nothing.
- **To the owner's PC, once it is linked** (USB cable through `adb reverse`, or Wi-Fi to the PC's LAN door after pairing):
  reads of the product, the person's decisions with the words the card showed and the paired device id, scan starts and
  cancels, policy grants and revokes, companion questions. Over Wi-Fi this is plain HTTP on the home network with a bearer
  token (a recorded deviation in table-link-v2.md section 11). The token is kept in the app's own file
  `Saved/BpTable.json` in plain text.
- **Voice, only after ALLOW:** what the wearer records while holding to talk, one WAV of at most 30 s, goes to the owner's
  PC. The PC sends it once to ElevenLabs speech-to-text (Scribe v2), unless it measures it as silence; the words come back
  and are not written to a file. The PC sends the reply's text to ElevenLabs to be spoken. NOT NOW, or no consent, means
  nothing is recorded or sent. The PC can turn transcription off (`BP_CLOUD_SPEECH=off`). Full terms: voice-link.md
  "Privacy, in plain words".
- **Not checked:** whether the engine or the platform plugins send anything of their own (telemetry, crash reports).

### Assets added or changed tonight

| Asset | How made | Licence | Status |
|---|---|---|---|
| Music bed `BpData/music/bed.wav` | ElevenLabs music API, 2026-11-09 (row below) | Eleven Music terms (P2) | **check** (P2). Now plays under the voice in the app (af8e8333) |
| Tour clip `voice/tour/standup.wav` (new) and `hand-off.wav` (re-rendered) | ElevenLabs `eleven_v3`, the Vintage Tin voice, `tools/tour-voice.ts`, 2026-11-10 (commit c9041a89) | ElevenLabs terms (P2) | **check** (P2) |
| Talk sample clips `voice/talk/{next,plan,scan}.wav`, `sample.json` | Rendered through the PC's `say` route (ElevenLabs `eleven_v3`, the same voice and level), 2026-11-10 (commit 6b4b9402). **Seen:** the three lines are English, name no brand or person | ElevenLabs terms (P2) | **check** (P2) |
| Kettle finding screens `BpData/kettle/shots/` | Codex CLI image generation, 2026-11-09 (row below) | OpenAI terms for the owner's ChatGPT plan | **check** (owner: plan terms). Now shown on stand-up cards in the app |
| `M_QuestLit` and 36 `MI_QL_*` instances, `M_QuestUnlit`, `M_QuestLamp`, `M_StudioFloor`, `T_StudioFloor` | Editor-scripted materials (`tools/mcp-steps/py/quest_lit.py`, `v1_scene.py`); the floor texture is drawn by that script in pure Python (dark oak planks); the lamp material reuses the lamp's own textures | Own work | ok |

### Proof the owner should keep (the Sponsor may ask)

1. ElevenLabs: the invoices covering 2026-10-27 (voice designed), 2026-11-04 (tour clips), 2026-11-09 (music bed, song
   `rhW4mZtPHG9pDv9JGTA6`) and 2026-11-10 (the stand-up clip and the talk clips), showing a paid plan on each date.
2. OpenAI / ChatGPT: the plan receipt covering 2026-11-09 (the eight Kettle screens).
3. Leonardo: the receipts covering 2026-10-24 and 2026-10-25, and that the generations were private (P3).
4. The generation records already in the repo: `apps/vr/Content/BpData/music/bed.json`,
   `scripts/fixtures/kettle-finding-shots.manifest.json`, `voice/tour/lines.json`, `voice/talk/sample.json`, the art
   `manifest.json` files, `lookdev/log.jsonl`.
5. The free licences: Barlow's `OFL.txt`, the Poly Haven and MakeHuman CC0 pages (sources below).

**P11. Manifest permissions to look at before store review.** Risk: low to medium (store review asks why each permission
is there). Who: agent to read the merged manifest, owner to decide.

- Read the packaged `AndroidManifest.xml` of the next APK and list every `uses-permission` and `uses-feature`.
- `EYE_TRACKING`: no code in `apps/vr/Source` mentions eye tracking (grep, 2026-11-10). If no plugin setting needs it,
  remove it, since a reviewer will ask.
- `BILLING`, `CHECK_LICENSE`: the app sells nothing and no code in `Source/` mentions billing, licence checks or
  entitlements (same grep); remove unless the store's entitlement check needs `CHECK_LICENSE`.
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS`: the app runs no background service and posts
  no notification; remove if nothing needs them.
- Keep `RECORD_AUDIO` (asked at use, with the consent sheet's plain words) and the optional passthrough feature.

## Day two update (2026-11-10)

Day two (2026-11-10, daytime, run note [`runs/2026-11-10-day-two.md`](runs/2026-11-10-day-two.md)) added two generated
screens, 47 voice clips and a pairing scope. None of it is on the headset yet: the installed APK was packaged at 11:44
through `9f6283bd` (night two's work). Evidence level as above: **Record** unless marked **Seen**. No staged manifest was
read for this update.

**Permissions and features: no change.** No day-two commit touches `apps/vr/Config/` or `Source/bp/bp_APL.xml` (seen in
`git log --stat 9f6283bd..029aaaf2`); the permission table above stands.

### Assets added or changed on day two

| Asset | How made | Licence | Status |
|---|---|---|---|
| Kettle after-screens `BpData/kettle/shots/finding-kf-011-after.png` and `finding-kf-041-after.png` (and the same files in `apps/web/public/sample-shots/`), 1280x720, 289,278 and 214,844 bytes | The same generator and rules as the eight before-screens: `scripts/fixtures/kettle-finding-shots.mjs --generate --after`, `codex-cli 0.166.0 exec` with its built-in image generation (model not reported), 2026-11-10 (commit `00bdcfb6`). Each is the same screen as its before-screen with the finding fixed, stamped SAMPLE SCREEN. Prompt, tool, date, bytes and SHA-256 are in `scripts/fixtures/kettle-finding-shots.manifest.json`; `npm run check:finding-shots` verifies them. **Seen** (both, at full size): the fictional "Kettle" wordmark as text, "Riverside studio", a paper invoice from a fictional supplier, an instructor form; no real brand, logo, face, person or personal data | OpenAI's terms for the owner's ChatGPT plan, as the before-screens | The owner said receipts are not needed (2026-11-10), so no plan proof is being collected for these either; the licence position is the before-screens' and stays **check** (owner: plan terms) |
| Tour clips `BpData/voice/tour/*.wav`: 31 new clips, per the commit (the tour's second edition: the core tour and seven chapters), then every clip re-rendered at 24 kHz | ElevenLabs `eleven_v3`, the Vintage Tin voice (`SVlo1tpEuzf5ilPRxsRZ`), the same seed, settings, effect chain and loudness as before, `tools/tour-voice.ts`, 2026-11-10 (commits `655209bf`, then `5f55fc9d`). The words are in `BpTourBook.cpp` and `voice/tour/lines.json`. 33 clips now | ElevenLabs terms (P2) | **check** (P2). Receipts not collected (owner) |
| Scan clips `BpData/voice/scan/*.wav`: 14 lines (the scan's start for the site, a wing, a room or a place; done; stopped; eight "Done. N rooms read, M new findings." results for the sample's scopes) | Same voice, model and tool (`tour-voice.ts --scan`), 2026-11-10 (commit `5f55fc9d`); `voice/scan/lines.json` | ElevenLabs terms (P2) | **check** (P2) |
| Stand-up clips `voice/scan/standup-welcome.wav`, `standup-yesterday.wav` ("Welcome back. Here is what your approvals became."; "Here is what yesterday's approvals became.") | Same voice, model and tool, 2026-11-10 (commit `029aaaf2`) | ElevenLabs terms (P2) | **check** (P2) |

**Seen:** every line in `voice/tour/lines.json` and `voice/scan/lines.json` is English, names no brand and no person, and
the voice is the designed one (no cloned voice).

### The `onboard` scope: what a paired headset may now ask for

- A new pairing scope `onboard` (table-link-v2.md section 14). It is named only: the headset may ask for it when it pairs
  (the app does since `029aaaf2`), but only the owner's tick on the PC's Headsets page grants it; it starts unticked, like
  Decide and Scan. The CLI fallback never adds it unless the owner types it.
- With it, the headset may read a list of folders the PC offers (an opaque id, the folder's name, a hint of at most 60
  characters: the last commit's subject or the repository's name; never a path), and **ask** the PC to read one. The ask
  carries the folder's id and the words the headset showed. Nothing runs until the owner presses CONFIRM on the Headsets
  page; the agent run that follows is on the owner's PC and account. Bounds: one at a time, three confirmed a day per
  pairing, six asks an hour, an ask expires after 10 minutes. Folders with their own agent settings are never offered.
- The headset may then watch that read through the routes it already had under `read` (the job's state and the build-up
  feed). To a device, jobs come without their log tail and products without their root path.
- Open (section 12, deviation 15): the agent reads the confirmed folder with permissions skipped, so a planted instruction
  in that folder's files can steer it. The PC confirm is the human gate; it does not make the run safe on a hostile folder.

### What leaves the headset: nothing new beyond the owner's PC

Everything above goes only to the owner's PC, over the same link as before (cable, or the paired Wi-Fi door). New on that
link: the onboarding list, ask and status calls, and, on a linked scan, the scan's two spoken lines sent as text to the
PC's existing `say` route (which renders them as it renders the lamp's answers). On the bundled sample nothing leaves the
headset: the scan theatre, YESTERDAY and the welcome back play bundled clips and screens. The Headsets page itself is on
the PC and receives nothing from the headset that the pairing did not already carry (it never receives the code).

## Inventory

"Staged 10-28" means the asset is listed in that manifest. "Ships" is whether it ships in the next build, given the
current map and config.

| Asset family (Content path) | How made | Licence / terms | Evidence | Ships | Status |
| --- | --- | --- | --- | --- | --- |
| BlueprintPaper (`Bp/Art/BlueprintPaper`) | Procedural Blender bake (`mat-blueprint-paper`). The Leonardo `paper-albedo` trial (log line 84) was never imported. | Own work | `ArtSource/mat-blueprint-paper/manifest.json`; import path seen in `tools/mcp-steps` | Yes, through `M_BlueprintPaper` (C++ hard reference, `BpTable.cpp:408`). Not in the staged 10-28 manifest: see P8. | ok |
| CityBackdrop | **Leonardo Studio (web)**, model `openai/gpt-image-2.5-sunburst`, 2026-10-25 (log line 89). Seam fade, dim and mesh are our own Blender work. | Leonardo output, owner's account. Rights depend on the plan (P3). | `ArtSource/city-backdrop/manifest.json`. **Seen:** `concept.png` shows a generic night skyline with no signage, logos, billboards or recognisable landmark. The prompt forbids text, signage, logos and billboards. | Yes (staged 10-28) | **check** (P3) |
| FixtureKit | Procedural Blender (`scripts/art/build_art.bpy`) | Own work | `ArtSource/fixture-kit/manifest.json` | Yes (C++ path `BpTable.cpp:422`). Not staged 10-28 (P8). | ok |
| HandsCapture | MakeHuman base mesh and rig through MPFB 2.0.18. The skin is the CC0 `young_lightskinned_male_diffuse` re-baked, plus a scripted sleeve and watch. | CC0 (MakeHuman core assets and skin). MPFB is GPL but is a tool only and is not shipped. | `ArtSource/hands-capture/manifest.json`. **Seen:** the albedo atlas is generic skin with no tattoo, mark or text. | Yes. The map references `HandsCapture/.../hand_l` and `hand_r` (strings seen in `LightTable.umap`), staged 10-28. | ok |
| LampAgent (skinned, `SK_LampAgent` and poses) | Scripted Blender (`scripts/art/lamp/build_agent.bpy`). Leonardo concepts were used as modelling reference only. | Own work | `ArtSource/lamp-agent/manifest.json` | No. Nothing references it, and it is not staged 10-28. | ok |
| LampAgentStatic (`SM_LampAgent`, Glim) | Same build, static `final_working`. Glow card texture is own work. | Own work. No generated pixels shipped (record). | lamp-agent manifest `licence`, `concept_licence` | Yes (map; `BpSwitch.cpp:51`) | ok |
| LightTableFrame | Procedural Blender. Bake inputs are Poly Haven `blue_metal_plate` (CC0), which is not shipped as a file. | Own work plus CC0 | `ArtSource/light-table-frame/manifest.json` | Yes | ok |
| StudioArchitecture (window, pendant) | Procedural Blender with a Poly Haven CC0 bake (`fine_grained_wood`) | Own work plus CC0 | manifest | Yes | ok |
| StudioDeskClutter | Procedural Blender, plus Poly Haven CC0 **models** re-baked: `binder_notebook` (DaDrood), `office_notepads` (Ulan Cabanilla), `stationery_supplies` (Mateusz Sadek) | CC0 1.0 | manifest. **Seen** (atlas zoomed): the binder carries a small embossed round emblem, and the pencils carry a tiny script imprint, illegible at 2048 px. | Yes | **check** (P7) |
| StudioDeskLamp | Procedural Blender with a CC0 bake. The Leonardo concept was a shape reference only. | Own work plus CC0 | manifest | Yes | ok |
| StudioDrawingTubes | Same as StudioDeskLamp | Own work plus CC0 | manifest | Yes | ok |
| StudioMug | Same as StudioDeskLamp. **Seen:** plain glazes, no print. | Own work plus CC0 | manifest | Yes | ok |
| StudioPinnedDrawings, incl. `T_WallDrawings_Atlas` | Mesh and materials are procedural. `T_WallDrawings_Atlas` is `docs/concepts/vr-light-table/lookdev/wall-drawings/draw_sheets_atlas.jpg`, made from **Leonardo API** generations (`gpt-image-2.5-flare`, 2026-10-24, log lines 80, 82 and 83). | Leonardo output (P3), plus own work and CC0 | Import seen in `tools/mcp-steps/*.jsonl`. **Seen:** abstract plan, section and site drawings with no text, numbers or logos. Prompts say "no text, no letters, no numbers, no logos". | Yes (staged 10-28) | **check** (P3) |
| StudioShelves | Procedural Blender with a CC0 bake. **Seen:** the book spines are plain colour bands with no titles. | Own work plus CC0 | manifest | Yes | ok |
| StudioWallKit (`wall_sheets`) | Procedural, plus "printed sheets from our own logged Leonardo generations" (ruling R8b) and procedural sheets | Leonardo output (P3), plus own work and CC0 | manifest `licence`. **Seen:** `wall_sheets_basecolor.png` holds the same Leonardo drawings and placeholder grey bars, with no readable text. | Yes | **check** (P3) |
| SurveyPin | Procedural Blender | Own work | manifest | Yes (C++ `BpTable.cpp:411`). Not staged 10-28 (P8). | ok |
| `Bp/Studio/SM_StudioShell`, `Bp/Materials/*`, `Bp/Look/T_FidGradeLUT` | Hand-written UE materials and an editor-scripted shell. The LUT was fitted by `scripts/lookdev/fit_grade_lut.py` from our own renders. | Own work | `tools/mcp-steps/py/*`, `lookdev/grade/` | Yes | ok |
| **MetaHuman, MetaHumanHands** (`MHC_CaptureHands`, `MI_CaptureHands_Skin`, `hands_metahuman/*`) | MetaHuman Creator in the local engine (`ft_metahuman.py`, `build_mh_hands.bpy`, `import_mh_hands.py`) | UE EULA. **The owner ruled it must not ship.** It is git-ignored. | `.gitignore:66-67`, `apps/vr/README.md` "MetaHuman hands" | **Not today:** neither the map nor the staged 10-28 manifest has a `/Game/Bp/Art/MetaHuman*` path (seen). It is **one script run away** from shipping, with no guard. | **problem** (P1) |
| Engine MetaHuman plugin bits (`MetaHumanSDK.uplugin`, `MetaHumanCoreTechLib/.../FaceDetector`, `DefaultSmoothing`) | Epic engine plugins enabled by default | UE EULA | 4 manifest lines (seen) | Yes (staged 10-28) | ok. This is Epic engine content, not the owner's character. Optional trim in P9. |
| Fonts: Barlow Semi Condensed Medium and SemiBold (`Bp/Fonts`) | github.com/google/fonts `ofl/barlowsemicondensed` | SIL OFL 1.1. The licence must travel with the font. | `apps/vr/Fonts/BarlowSemiCondensed/OFL.txt`, `Source/bp/BpType.h` | Yes (C++ `BpTable.cpp:416-417`). Not staged 10-28 (P8). | **check** (P6) |
| Engine fonts: Roboto, DroidSansFallback | Engine content | Redistributable under the UE EULA (Apache 2.0 upstream) | staged 10-28 | Yes | ok |
| Meta XR v207 (`OculusXR`) and Interaction SDK (`OculusInteraction`). Shipped content includes Quest Touch Plus, Touch Pro and Quest 2 controller meshes and `SK_OpenXRHand_*`. | Meta Platforms. Installed by `tools/install-xr.ps1` from Meta's CDN after the owner accepts the Oculus SDK licence. | Oculus / Meta Platform SDK licence | `Plugins/MetaXR/OculusXR.uplugin` (1.207.0), staged 10-28 | Yes | ok. The controllers are the Sponsor's own products, shipped by its SDK for its platform. |
| PoFToolset, ModelContextProtocol, ToolsetRegistry, EditorToolset, PythonScriptPlugin, GameplayAbilities, ModelingToolsEditorMode, MetaHumanCharacter | Editor tooling | n/a | `bp.uproject` `TargetAllowList: ["Editor"]` for all eight. `PoFToolset.uplugin` is `"EditorOnly": true` and content-only Python. | **No.** No `PoFToolset` or `Python` path is in the staged manifest (seen). | ok |
| Tour voice (`BpData/voice/tour/*.wav`, 10 clips on the morning of 2026-11-10 (`standup.wav` added, `hand-off.wav` re-rendered), 33 since day two, plus `voice/scan/` (16): see "Day two update", `lines.json`); talk sample clips (`BpData/voice/talk/*.wav`, 3 clips, 2026-11-10) | **ElevenLabs** TTS, model `eleven_v3`. Voice "Vintage Tin" (`SVlo1tpEuzf5ilPRxsRZ`) is an ElevenLabs Voice Design voice (`eleven_ttv_v3`), designed 2026-10-27 from a text description ("retro 1950s tin-can male robot"). Rendered 2026-11-04 by `tools/tour-voice.ts`. | ElevenLabs terms: commercial use only for content made on a **paid** plan (P2) | `packages/core/src/companion/voice.ts`, `docs/voice/glim.md`, file dates. **Seen:** all lines in `lines.json` are English, name no brand, and cast no real person's voice. | Yes. `DirectoriesToAlwaysStageAsUFS=BpData`. The clips are newer than the 10-28 build. | **check** (P2) |
| Music bed (`BpData/music/bed.wav`, `bed.json`) | **ElevenLabs** music API (`POST /v1/music`, model `music_v1`, `force_instrumental`), generated 2026-11-09 (song id `rhW4mZtPHG9pDv9JGTA6`) by `tools/music-bed.ts`, then looped and levelled there. The prompt names no artist, song, label or brand (s. 2.1 of the music terms). | Eleven Music model-specific terms (last updated 2026-10-09), see P2 | `bed.json` holds the prompt, model, date and the original's SHA-256. The untouched MP3 is under `.bp/companion/music/` (git-ignored). | Yes: committed 2026-11-09 and staged with `BpData`; the app plays it under the voice since `af8e8333` (2026-11-09) | **check** (P2) |
| Kettle sample (`BpData/kettle/*.json`) | Generated by `tools/bundle-data.mjs` from `apps/server` over `packages/core/data`. Kettle is a fictional fitness-studio booking product. | Own content | **Seen:** string scan of all 6 files (below) | Yes (staged 10-28) | **problem** (P4), **check** (P5) |
| Kettle finding screens (`BpData/kettle/shots/finding-<id>.png`, 8 files, plus 2 after-screens since day two (see "Day two update"), 1280x720, 151 to 266 KB each; the same files as `apps/web/public/sample-shots/`) | **Codex CLI** (`codex-cli 0.166.0`, `codex exec`, its built-in image generation tool; the model is not reported by `codex exec`), signed in with the owner's ChatGPT account, generated 2026-11-09 by `scripts/fixtures/kettle-finding-shots.mjs`, then resized and palette-compressed there. Each is a flat UI screen of the fictional Kettle studio app showing one sample finding's problem (a half-rendered invoice form, unescaped markup in a payout table, a blank mandate list, a promo code that does not change the total, a slow SMS report, a sign-in link that never arrives, a janky class-pack grid, a nine-step setup wizard), each stamped "SAMPLE SCREEN". | OpenAI's terms for ChatGPT plans assign the output to the user; the owner confirms the plan (as P3 for Leonardo). | `scripts/fixtures/kettle-finding-shots.manifest.json` holds each prompt, the tool, the date, the bytes and the SHA-256; `npm run check:finding-shots` verifies the web and bundle files against it. **Seen** (all 8, at full size): no real brand, product or company name, no logo, no face, photo or person (no avatar is drawn at all), no real personal data (member numbers such as M-1042 only; no email address or phone number). The prompts forbid all three. | Yes: committed 2026-11-09 and staged with `BpData`; shown on the stand-up's cards since `c9041a89` (2026-11-10) | **check** (owner: plan terms) |
| Other `BpData/*` folders | Live-product bundles, git-ignored and machine-local | Could hold a real product's names | `DefaultGame.ini` stages all of `BpData` | Only if one exists locally when packaging. Lynx today has `kettle` and `voice` only (seen). | **check** (P10) |
| App identity: "Developer's Blueprint", `com.developersblueprint.vr`; companion "Glim" | Owner's title (D3, 2026-10-27) | Own | `Config/DefaultEngine.ini:287-288` | Yes | ok. Low risk: "Blueprint" is a common word, and no Epic mark or logo is used. |
| Tripo3D experiments (meeting table, sofa, desk, frame) | Tripo API, 2026-10-25 | Tripo free tier keeps the rights. Paid tier needed for commercial use. | `lookdev/tripo-log.jsonl` (18 calls) | **No.** No Tripo-derived asset is in `Content` or the staged manifest (seen). | ok |
| Leonardo look-dev frames, lamp and prop concepts | Leonardo API | Reference only | `lookdev/log.jsonl` lines 1-79 and 85-94 | No. They live in `docs/` and `ArtSource/`, outside `Content`. | ok |

### Kettle text: what the headset shows

`BpDeck.cpp` draws these on the deck: feature names, feature summaries (`FindFeatureSummary`), proposal titles and
full proposal bodies (lines 676-782), and room and wing names. Seen in the bundle:

- **Brand and product names in displayed fields:**
  - Feature names "Google sign-in", "Apple sign-in" and "Wallet pass".
  - Feature summaries "Sign in with a Google account.", "Sign in with Apple, required for the iOS app store." and
    "Membership card in Apple and Google Wallet."
  - Proposal title "Put Google sign-in behind a kill-switch flag", plus its body.
  - KPI "Apple sign-in end-to-end pass rate".
  - "Bank debit (SEPA)". SEPA is a payments scheme, not a brand, so this is ok.
  - "Fix the 3 axe violations". axe is Deque's accessibility engine. Low risk.
- **Brand names in fields that ship but that I did not confirm are drawn:**
  - Context descriptions name "Next.js", "React Native, iOS + Android", "Node.js", "TypeScript", "Redis" and
    "PostgreSQL".
  - `probeEnv` holds "Pixel 7 emulator" and "Chrome 1600x1000".
  - The bank variations name "Multibanco", a real Portuguese payment network.
  - "QR Platba (SPD)" is a real Czech standard. "Platba" is Czech, which matters for R-en.
  - "Vltava Bank", "Nordhavn Sparebank" and "Banco Alameda" are marked fictional in the data.
- **People:** `structure.json` `people[]` lists 8 named team members (Mara Ilić, Dev Okafor, Tomás Reyes, Priya Nair,
  Jonas Berg, Lea Novak, Sam Adeyemi, Ines Costa) and "Forge-1..4". They are fictional by intent, but the names
  ship in the APK. No VR code reads `people`, so they are not drawn (inferred from a grep of `Source/`).
- **No slogans and no corporate logos** in the data. The rest of the text is English.
- **On-screen strings in `Source/`:** `BpWords*.h`, the tour captions and the deck labels are English. The only
  Sponsor names (`Quest`) appear in console-variable help text, which is not on screen. No third-party brand appears
  in a drawn literal (grep of `TEXT("...")`).

## Problems and actions (ranked by risk)

**P1. MetaHuman content can be cooked into the APK silently.** Risk: high, because it breaks an owner ruling and the
UE EULA position the owner chose. Who: agent.

- Today the map is clean, and so was the 10-28 APK. Both were seen: `LightTable.umap` references only
  `HandsCapture/.../hand_l|hand_r`, and the staged manifest has no `/Game/Bp/Art/MetaHuman*`.
- The hazard is how the map gets rebuilt:
  - `tools/mcp-steps/py/studio_level.py:114` picks `HANDS = "metahuman"` whenever
    `/Game/Bp/Art/MetaHumanHands/hands_metahuman/StaticMeshes/hand_l` exists on disk. It exists on Lynx.
  - `tools/mcp-steps/py/ft2_hands.py:9` hard-codes `HANDS = "metahuman"`.
- So the next `studio_level.py` run on Lynx places the MetaHuman forearms in `LightTable`. The cook then follows
  the map's references into `MetaHumanHands/*` and `MetaHuman/MI_CaptureHands_Skin`, and that material's parent is
  `/MetaHumanCharacter/Materials/MI_Skin_Body_MHC`.
- Nothing in `DefaultGame.ini` or `tools/package-quest.ps1` stops it.
- What the cook would do with the editor-only `MetaHumanCharacter` plugin content is inferred, not verified. Either
  the cook fails, or it ships the content. Neither outcome is acceptable.

Recommended fix (not applied):

1. In `apps/vr/Config/DefaultGame.ini`, under `[/Script/UnrealEd.ProjectPackagingSettings]`:

   ```ini
   ; MetaHuman content is local-only and never ships (owner, 2026-10-26; compliance.md P1)
   +DirectoriesToNeverCook=(Path="/Game/Bp/Art/MetaHuman")
   +DirectoriesToNeverCook=(Path="/Game/Bp/Art/MetaHumanHands")
   ```

2. In `studio_level.py`, make `hands-capture` the default, and choose `metahuman` only on an explicit opt-in (for
   example an env var for local captures). Do the same for `ft2_hands.py`.
3. In `package-quest.ps1`, after staging, fail the package if `Manifest_UFSFiles_Android.txt` has a line matching
   `bp/Content/Bp/Art/MetaHuman`.
4. If a map ever does reference these folders, step 1 turns the leak into a cook warning plus missing hands, not a
   silent ship. Check the cook log for it.

**P2. ElevenLabs voice clips: the commercial licence depends on the plan.** Risk: high until confirmed. Who: owner.

- ElevenLabs' help centre says the free plan "does not include a commercial license and cannot be used for any
  commercial purpose", and free-plan content must carry an "elevenlabs.io" credit.
- Content made during a paid subscription "can be used commercially, and indefinitely". Beta Services are excluded.
- `eleven_v3` was alpha (a Beta Service, no commercial use) until it went GA in February 2026, per ElevenLabs' blog
  and a secondary source. The clips were rendered 2026-11-04, after GA.

The owner confirms:

1. The ElevenLabs account was on a **paid plan** (Starter or higher) on 2026-11-04, when the clips were rendered,
   and on 2026-10-27, when the voice was designed.
2. Neither `eleven_v3` nor the Voice Design model `eleven_ttv_v3` is marked alpha or beta in the account at render
   time.
3. The invoice is kept as the "proof of proper license" the Sponsor may ask for.

If any of these fails, re-render on a paid plan with `node apps/vr/tools/tour-voice.ts` after upgrading, or ship
captions only (`BpTour.cpp` has the 0 = captions-only switch). The voice is designed and not cloned, so R-person is
not engaged.

The music bed (added 2026-11-09) falls under ElevenLabs' separate **Eleven Music model-specific terms** (page last
updated 09 October 2026, read 2026-11-09). What they state, and nothing more:

- Exhibit A: API access is "No" on Free and "Yes" on Starter and above, and the API generated the track, so the account
  was on a paid plan at 2026-11-09 20:03 UTC (an inference from the table, not a receipt). Starter: "No Attribution
  Required"; Free requires the Eleven Music credit.
- Media rights on every self-serve plan: "All online and offline commercial use permitted, except film, TV, radio, and
  Studio Games". A Studio Game is "a video game or other interactive or playable experience made available to the
  public ... and commercialized by sale, advertising, or any other form of monetization, but does not include an Indie
  Game" (revenue under $500,000, publisher's game revenue under $1,000,000). "You are responsible for determining
  whether a game you develop or publish qualifies as an Indie Game." (s. 4.7)
- Music streaming distribution is prohibited on Free and Starter. Shipping the track inside the app is not streaming
  distribution as we read it, but the terms do not address apps directly.

Owner: keep the 2026-11 invoice with the song id above, and confirm the app is either not monetized or an Indie Game.
If not, regenerate on a plan that allows Studio Games, or ship without the bed (the playback builder's volume at 0).

**P3. Leonardo-generated pixels ship in three places.** Risk: medium. Who: owner.

- The city backdrop (Leonardo Studio, 2026-10-25).
- `T_WallDrawings_Atlas` (Leonardo API, 2026-10-24, generations `1f1cfe77-…`, `1f1cfe79-2e78…` and `1f1cfe79-f62e…`).
- StudioWallKit `wall_sheets`.

Leonardo's help centre gives full ownership, copyright and IP to **paid** users for private generations. For free or
public generations, Leonardo keeps perpetual rights and other users get a licence. The model is OpenAI's GPT image
model served by Leonardo, so Leonardo's terms govern.

The owner confirms:

1. Both the Studio web account and the API key were on a **paid** plan or paid API credit when these were made.
2. The generations were **private**. The lamp concepts record `public:false`. The backdrop's generation was deleted
   from the account after download.
3. The billing receipts are kept as proof.

Content risk was checked by looking: no logos, readable text, signage or recognisable landmark in any of the three.
If paid status cannot be shown, the fallback is to regenerate the skyline and drawings procedurally in Blender. The
agent can do that, but it costs a look regression.

**P4. Real brand names are drawn on the deck from the Kettle sample.** Risk: medium (R-ad, "brand names"). Who: agent
to propose, owner to approve the wording.

- "Google sign-in", "Apple sign-in", "Apple and Google Wallet", "iOS app store" and the Google kill-switch proposal
  are shown as feature names, summaries and proposal text.
- These are nominative and descriptive, not advertising. The rule's text still bars brand names "without limitation".

Fix: give the VR bundle neutral wording, either in the Kettle sample source (`packages/core/data`), which also
changes the web, or as a substitution pass in `tools/bundle-data.mjs` for the VR copy only. For example:

- "Google sign-in" becomes "Social sign-in".
- "Apple sign-in" becomes "Platform sign-in".
- "Wallet pass" stays.
- The wallet summary becomes "Membership card in the phone's wallet app."
- "required for the iOS app store" becomes "required by the phone app stores".

Also neutralise these, which ship even if they are not drawn:

- "Pixel 7 emulator" and "Chrome" in `probeEnv`.
- The framework names in context descriptions, for example "React Native" becomes "mobile app" and "Next.js"
  becomes "web".
- "Multibanco" and "QR Platba". This also clears the one non-English word (R-en).

Re-run `check:bplink` afterwards, since that script's counts read the same data.

**P5. Named people in the Kettle bundle.** Risk: low to medium (R-person). Who: agent.

The eight fictional team names ship in `structure.json`. They are not drawn (inferred). A real person could share a
name, and a judge could open the APK. Fix: replace them with role labels ("Founder", "Engineer 1", …) in the VR
bundle, or strip `people[]` in `bundle-data.mjs`, since VR does not use it.

**P6. The OFL notice does not travel with the fonts.** Risk: low (R-licence). Who: agent.

- SIL OFL 1.1 requires each copy of the font to carry the copyright notice and the licence.
- Barlow is cooked into the APK, but `apps/vr/Fonts/BarlowSemiCondensed/OFL.txt` is not staged.

Fix: copy `OFL.txt` into a staged folder, for example `Content/BpData/licenses/OFL-Barlow.txt` (already UFS-staged).
Also add a short `CREDITS.txt` there listing:

- Barlow (OFL)
- MakeHuman (CC0)
- Poly Haven sources (CC0)
- ElevenLabs voice and music
- Leonardo images
- The Kettle sample screens (generated with OpenAI's image tool through Codex CLI)
- Meta XR SDK

A credits line on the wrist panel is optional.

**P7. Desk-clutter atlas carries third-party marks from the CC0 Poly Haven models.** Risk: low (R-ad). Who: owner to
eyeball in the headset, agent to paint out if wanted.

Seen at atlas resolution:

- A small embossed round emblem on the binder cover (`desk_clutter_atlas_basecolor.png` around x 380-420, y 150-200).
- A script imprint on the pencils (around x 1830-1950, y 1545-1720).

Both are illegible at 2048 px and smaller at Quest's 1k cap. They are not identifiable as a real brand, and the
source models are CC0. To remove any doubt, flat-fill the two regions in the bake (`scripts/art/studio-kit`) and
re-import.

**P8. The last APK was missing the C++-referenced assets (functional, and it affects what this audit can see).** Risk:
low for compliance. Who: agent.

- The 10-28 staged manifest has none of `Bp/Fonts/*`, `SurveyPin`, `FixtureKit`, `M_BlueprintPaper` or `M_Pin*`.
  These are loaded by `ConstructorHelpers` in `BpTable.cpp`.
- It also has no `BpData/voice` (the clips are newer than the build).
- Either the cook misses C++-only references, so the APK draws in Roboto with no pins, or the manifest is
  incomplete. Not verified.

Fix: add `+DirectoriesToAlwaysCook=(Path="/Game/Bp")`, excluding the MetaHuman folders per P1. NeverCook wins over
AlwaysCook. Then re-check the next staged manifest against this inventory.

**P9. Epic MetaHuman engine plugins are staged.** Risk: very low (R-licence is fine under the UE EULA). Who: owner to
decide, agent to apply.

`MetaHumanSDK` and `MetaHumanCoreTechLib` ship a face-detector model and a smoothing asset. This is Epic engine
content, not the owner's character, so the owner's ruling is not breached. If the owner wants "no MetaHuman anything"
in the APK, disable those engine plugins for Android in `bp.uproject` (`PlatformDenyList: ["Android"]`) and confirm
nothing needs them.

**P10. `BpData` is staged wholesale.** Risk: low today, high if a live bundle is on disk. Who: agent.

`+DirectoriesToAlwaysStageAsUFS=(Path="BpData")` would also ship any git-ignored live-product bundle present on the
packaging machine, with a real product's names and findings. Fix: stage `BpData/kettle`, `BpData/voice` and `BpData/music` (and
`BpData/licenses`, P6) explicitly instead of `BpData`.

## Owner confirmations needed

1. The ElevenLabs plan was paid (Starter or higher) on 2026-10-27 and on 2026-11-04, and `eleven_v3` and
   `eleven_ttv_v3` were not beta in the account. Keep the invoice. (P2)
   For the 2026-11-10 tour and talk clips: the same paid plan on that date. (P2)
   For the music bed: keep the November 2026 invoice (song `rhW4mZtPHG9pDv9JGTA6`, 2026-11-09), and confirm the app
   is not a monetized "Studio Game" under the Eleven Music terms (unmonetized, or an Indie Game). (P2)
2. The Leonardo Studio account and the API key were on a paid plan or paid credit on 2026-10-24 and 2026-10-25, with
   private generations. Keep the receipts. (P3)
3. Approve neutral wording for the Kettle feature names and summaries in the VR bundle. (P4)
4. Look at the binder and pencils in the headset (P7), and decide on the Epic MetaHuman engine plugins (P9).
5. The ChatGPT plan on 2026-11-09 (the Kettle screens), and keep its receipt. (night two update)
6. Decide which of the default manifest permissions to remove before store review. (P11)

## Sources (fetched 2026-11-04)

- ElevenLabs, "Can I publish the content I generate on the platform?":
  https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform
- ElevenLabs, "What is Eleven v3 (Alpha)?" (Beta Services Addendum, no commercial use during alpha):
  https://help.elevenlabs.io/hc/en-us/articles/35869054119057-What-is-Eleven-v3-Alpha
- ElevenLabs blog, Eleven v3 (out of alpha, GA): https://elevenlabs.io/blog/eleven-v3
- ElevenLabs, Eleven Music model-specific terms (last updated 2026-10-09; read 2026-11-09 for the music bed):
  https://elevenlabs.io/eleven-music-model-specific-terms
- ElevenLabs API reference, music compose (`POST /v1/music`; read 2026-11-09):
  https://elevenlabs.io/docs/api-reference/music/compose
- Leonardo.Ai help, "Can I use my image generations for commercial purposes?":
  https://intercom.help/leonardo-ai/en/articles/8044018-commercial-usage
- Tripo, "How to Use Tripo Models Commercially" (Terms 5.2.1: Tripo keeps the rights in free-user outputs):
  https://www.tripo3d.ai/help/privacy-policy/how-to-use-tripo-models-commercially
- MakeHuman / MPFB FAQ (CC0 core assets): https://static.makehumancommunity.org/mpfb/faq/can_i_sell_models.html
- Poly Haven licence (CC0): https://polyhaven.com/license

## Owner's decisions, 2026-11-10 (after night two)

- **Cloud speech is allowed.** Voice audio goes from the headset to the owner's PC and from there to a cloud speech
  service, only after ALLOW on the consent sheet; the deviation from the registry's `voice-io` standard stays recorded in
  `voice-link.md`. How it works is in `apps/vr/README.md` ("How Glim speaks and listens").
- **The table's grant bound keeps `wave.dispatch`.** A hand-over from the headset may let the companion dispatch waves
  (real builds) within the bound in `table-link-v2.md`.
- **Receipts for the generated music, voice and sample screens are not needed** (owner). The licence rows above keep
  their status; no proof is being collected.
- **The manifest's default permissions** (eye tracking, billing, licence check, foreground service, notifications) are
  acknowledged; no change asked.
- **The tour runs once** at first launch and can be started again from SETTINGS (built in `655209bf`, 2026-11-10: also
  MENU > TOUR and the wrist).
