# Competition compliance pass: what ships in the Quest APK

Date: 2026-11-04. Scope: the Quest APK of `apps/vr` (UE 5.8, Meta XR v207) entered in the Meta VR Start Developer
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
| Tour voice (`BpData/voice/tour/*.wav`, 9 clips, `lines.json`) | **ElevenLabs** TTS, model `eleven_v3`. Voice "Vintage Tin" (`SVlo1tpEuzf5ilPRxsRZ`) is an ElevenLabs Voice Design voice (`eleven_ttv_v3`), designed 2026-10-27 from a text description ("retro 1950s tin-can male robot"). Rendered 2026-11-04 by `tools/tour-voice.ts`. | ElevenLabs terms: commercial use only for content made on a **paid** plan (P2) | `packages/core/src/companion/voice.ts`, `docs/voice/glim.md`, file dates. **Seen:** all lines in `lines.json` are English, name no brand, and cast no real person's voice. | Yes. `DirectoriesToAlwaysStageAsUFS=BpData`. The clips are newer than the 10-28 build. | **check** (P2) |
| Kettle sample (`BpData/kettle/*.json`) | Generated by `tools/bundle-data.mjs` from `apps/server` over `packages/core/data`. Kettle is a fictional fitness-studio booking product. | Own content | **Seen:** string scan of all 6 files (below) | Yes (staged 10-28) | **problem** (P4), **check** (P5) |
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
- ElevenLabs voice
- Leonardo images
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
packaging machine, with a real product's names and findings. Fix: stage `BpData/kettle` and `BpData/voice` (and
`BpData/licenses`, P6) explicitly instead of `BpData`.

## Owner confirmations needed

1. The ElevenLabs plan was paid (Starter or higher) on 2026-10-27 and on 2026-11-04, and `eleven_v3` and
   `eleven_ttv_v3` were not beta in the account. Keep the invoice. (P2)
2. The Leonardo Studio account and the API key were on a paid plan or paid credit on 2026-10-24 and 2026-10-25, with
   private generations. Keep the receipts. (P3)
3. Approve neutral wording for the Kettle feature names and summaries in the VR bundle. (P4)
4. Look at the binder and pencils in the headset (P7), and decide on the Epic MetaHuman engine plugins (P9).

## Sources (fetched 2026-11-04)

- ElevenLabs, "Can I publish the content I generate on the platform?":
  https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform
- ElevenLabs, "What is Eleven v3 (Alpha)?" (Beta Services Addendum, no commercial use during alpha):
  https://help.elevenlabs.io/hc/en-us/articles/35869054119057-What-is-Eleven-v3-Alpha
- ElevenLabs blog, Eleven v3 (out of alpha, GA): https://elevenlabs.io/blog/eleven-v3
- Leonardo.Ai help, "Can I use my image generations for commercial purposes?":
  https://intercom.help/leonardo-ai/en/articles/8044018-commercial-usage
- Tripo, "How to Use Tripo Models Commercially" (Terms 5.2.1: Tripo keeps the rights in free-user outputs):
  https://www.tripo3d.ai/help/privacy-policy/how-to-use-tripo-models-commercially
- MakeHuman / MPFB FAQ (CC0 core assets): https://static.makehumancommunity.org/mpfb/faq/can_i_sell_models.html
- Poly Haven licence (CC0): https://polyhaven.com/license
