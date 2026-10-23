# VR Light Table: tech stack research

Researched 2026-10-20 for the spark `vr-light-table`. Facts about other repositories cite the file
they came from. Facts about third-party models are from public sources listed at the end; they move
fast, so phase P0 re-checks each against its model card before anything is downloaded.

## 1. The shape of the system

```
GPU workstation (one box)
├── bp monorepo
│   ├── packages/core      the logic, once: app-structure v3, lenses and health rules, the derived
│   │                      model, scans, waves, release train (today src/lib/{standard,model,scan})
│   ├── packages/schema    JSON Schemas + generators: TS types and UE C++ structs
│   ├── apps/web           the Next.js canvas app as it is today (its own dev loop: npm run dev)
│   ├── apps/server        headless Node server: the same route handlers as apps/web, JSON + SSE
│   └── apps/vr            the Unreal 5.8 project (its own loop: the editor, UBT, the headset)
├── athena daemon          the voice agent: /manifest, /run (SSE), /decisions, /voice (websocket)
├── ComfyUI + TRELLIS.2    local image and image-to-3D services, used offline during production
└── Quest 3                tethered over Link or Air Link
```

Runtime data flow, all on localhost:

- The UE app reads the product from `apps/server`: structure, lens readings, findings, waves and jobs,
  plus the live stream for job and scan progress. It never computes a health rule or a layout rule.
- The UE app streams microphone audio to athena's `/voice` socket and plays the reply; athena runs
  the turn, calls bp's tools, and files decision cards. The UE app draws the lamp and the cards and
  sends the answer to `POST /decisions/<id>`.
- `apps/server` is athena's host for bp: it registers bp's tools through `POST /manifest` and
  executes an approved action when the decision returns `execute`.

## 2. Runtime: Unreal 5.8 + Meta XR v207

Chosen by the owner. mage-arena-vr already proved the route on the same GPU box
(`mage-arena/docs/XR-TOOLCHAIN.md`): UE 5.8.2, the Meta XR plugin v207 and Meta Interaction SDK v207
installed project-local by a repeatable script (`apps/vr/tools/install-xr.ps1` in that repo), Win64
boots against the Meta XR Simulator's Quest 3 profile. bp reuses that script and that decision record
rather than re-investigating. The Android APK path is not needed: the quality bar is PC-tethered.

What UE buys for this concept, element by element, is in `art-breakdown.md`. The short version: real
emissive light from the table onto the hands, translucent extrusions with edge glow, fog with light
in it, compositor layers for crisp text, and Meta's hand tracking with interaction poses.

Rendering path, to be settled by a spike in P3 (measured, not assumed):

| Option | Gives | Costs |
|---|---|---|
| Forward shading + MSAA (the VR default) | sharp edges on thin linework, cheapest per eye | no Lumen; light from the table is faked with rect lights and baked bounce |
| Deferred + Lumen + TSR | the concept's soft bounce light on hands and props | heavy at Quest 3's 2064x2208 per eye at 90 Hz; temporal blur on thin lines |

The plan starts on forward + MSAA and adds Lumen only if the P6 fidelity score needs it and the frame
budget allows it.

**Text.** Any text the person must read (pin tags, the decision card, the wrist panel) is drawn as a
Meta XR compositor layer or a high-resolution world-space widget, never as a texture on a mesh, so
it stays legible. bp's 12 px floor becomes an angular-size floor, measured in P3.

## 3. The monorepo: one logic, three channels

The owner's rule: extract shared primitives and logic so nothing is developed twice, while each
channel keeps its own stack and its own way to run.

**What moves to `packages/core`** (measured on master `2310923`):

| Today | Files | LOC | DOM or React imports | Server-only imports |
|---|---|---|---|---|
| `src/lib/standard` | 5 | 1,287 | 0 | 0 |
| `src/lib/model` | 18 | 3,543 | 0 | 0 |
| `src/lib/scan` | 25 | 3,454 | 2 | 8 (`*.server.ts`, the store and jobs) |
| `src/engine` | 22 | 4,447 | 14 | 0 |

`standard` and `model` move whole. `scan` splits: its pure half joins `core`, its `*.server.ts` half
becomes `core/server` (Node only), and its two client files stay in `apps/web`. `src/engine` is the
web canvas and stays in `apps/web`; the VR channel has its own renderer.

**`apps/server`.** The API routes under `src/app/api/products/[slug]/` (`structure`, `stream`,
`scan`, `scans`, `proposals`, `triage`, `waves`, `dispatch`, `releases`, `lenses`, `shots`,
`commits`) become handler functions in `core/server`. `apps/web` mounts them in Next route files,
as now; `apps/server` mounts the same functions in a small Node HTTP server, so the VR channel does
not need Next running. The routes' local-only and JSON-only guards move with the handlers, and the
existing route-guard and local-only checks then cover both mounts.

**`packages/schema`.** app-structure v3 already has JSON Schemas (`docs/standard/schema/`: app-structure, event and lens-manifest). One generator
emits the TypeScript types (as today) and a second emits UE `USTRUCT`s with `UPROPERTY` fields, so
`FJsonObjectConverter` fills them with no hand-written parsing. A field added to a schema reaches
both channels in one change; a parity check fails the build when the generated C++ is stale.

*Decided 2026-10-20 (WP1.5 follow-up).*
- **TS types.** `packages/core/src/standard/types.ts` stays the hand-written source the code imports.
  The generated `packages/schema/generated/ts/app-structure.ts` is a parity artifact that nothing
  imports. `npm run check:schema` fails when the two disagree on a field's presence or optionality in
  the structure, event and lens-manifest shapes and every object type they hold. Why: the hand-written
  types carry what the schema-to-TS mapping cannot, such as the recursive condition grammar,
  discriminated unions and the open event type, and presence and optionality are what drift.
- **Fields a `USTRUCT` cannot hold.** `short`, `default` and `$schema` become renamed `UPROPERTY`s
  (`Short_`, `Default_`, `Schema_`) of the mapped type. The string-or-object `glyph` and the untyped
  `cross_refs` become an `FString` that holds the value as JSON text. The generated `BpSchemaFixups.h`
  fills these after `FJsonObjectConverter`, and BpLink reads through `BpSchema::FromJson`. `taxonomy`
  is an `FJsonObjectWrapper` under its own key. `check:schema` fails when a schema field is neither
  mapped nor carried. The headers have only been parsed with `clang++ -fsyntax-only` against stand-in
  Unreal declarations. They have not been through UHT or a UE build.

**Tooling.** npm workspaces, because bp is already an npm project. Known trap: bp's repo law says
Turbopack refuses the `node_modules` junction in a worktree, and a workspace layout changes how
Next resolves packages, so P1 proves `next build` and the 60 fps perf budget from the new layout
before anything else moves.

**Kettle-only tables.** Repo law lists the model's Kettle-only constants (`WING_DEFS`,
`GA_MILESTONE`, `LATER_MILESTONES`, `BLAST_DEFAULT`). They move into `core` unchanged, and the VR
channel inherits the same behaviour for non-Kettle products, which P5 smoke-tests on a live product.

## 4. The agent: the Athena daemon

The voice agent is athena-portable's daemon, not a copy of it (`athena-portable/docs/daemon.md`):

| Route | Used for |
|---|---|
| `POST /manifest` | `apps/server` registers bp's tools as one host app (`app_id: "bp"`) |
| `POST /run` (SSE) | a typed turn, as a fallback to voice |
| `GET /voice` (websocket, PCM16 in, events and audio out) | the UE client's microphone and the lamp's voice; Kokoro speaks locally by default (ADR 0028) |
| `GET /decisions`, `POST /decisions/<id>` | the floating card at the lamp, answered by voice or by a pinch |
| `GET /ledger` | the ledger page on the wrist |

bp's tools, with the class athena's gate derives from `reversible` and `side_effects`
(AUTO only when reversible and not external):

| Tool | reversible | side_effects | Class |
|---|---|---|---|
| `navigate` (fly to a wing, room or feature) | yes | internal | AUTO |
| `lens.set` | yes | internal | AUTO |
| `scan.place` (start a lens scan of a scope) | yes | internal | AUTO |
| `wave.compose` (group findings into packages with model and effort) | yes | internal | AUTO |
| `wave.dispatch` (queue build jobs that spend money and edit code) | no | external | GATED |
| `decision.answer` (answer one of the swarm's questions) | no | internal | GATED |
| `finding.decline` | yes | internal | AUTO |

Open seam, settled in P5: athena's gate treats every new origin as GATED on first sight, and its
host model assumes a web page. `apps/server` registers with a `page_origin` such as
`http://127.0.0.1:<port>`; P5 confirms the daemon accepts a non-browser host and that `execute`
reaches `apps/server`, with a smoke test across the real seam.

Answered 2026-10-22 on Lynx (wolf-plan L5.3, `node scripts/smoke-athena.mjs`, athena-portable 9beaef31). The daemon
accepts a non-browser host: it cannot tell what a page is and has no browser check. It does refuse two spellings, and
both are fixed on bp's side, with nothing changed in athena:

- `page_origin: http://127.0.0.1:<port>` is refused whole, `400 manifest_invalid`, with "page_origin must be https with a
  host, or http on localhost". Plain http is admitted only on the host `localhost`, by exact name (athena's
  `page_origin_admitted`, ADR 0119). `apps/server` registers as `http://localhost:<port>`, and that origin is the
  session key `/run` uses.
- A dotted tool name is refused: "tool name 'wave.dispatch' is not a slug; the catalog namespaces it as
  <kind>.<id>.<name>". The tools travel as `navigate`, `lens_set`, `scan_place`, `wave_compose`, `wave_dispatch`,
  `decision_answer` and `finding_decline`, and the catalog names them `host.bp.<name>`.

The classes came back as the table states them. `execute` reaches `apps/server`: an approved `wave_dispatch` card ran
Kettle's wave dispatch once (202, one execute job). A second approve of the same card is refused with
`409 pending_approval` ("is approved, not pending"), and the host also runs each `call_id` at most once.

## 5. Local generation stack (production time, not run time)

Generation is used to make the art, not while the person is in the headset. It runs on the GPU box,
one job at a time, never while UE is rendering to the headset (both want the whole GPU).

| Job | Primary | Alternatives | Licence note |
|---|---|---|---|
| Host for image pipelines | ComfyUI | Diffusers scripts | open source |
| Look-dev style frames | FLUX.2 [dev] (strongest prompt adherence; about 24 GB as a Q4 GGUF, 32 GB FP8) | Qwen-Image (Apache 2.0, best legible text) | FLUX.2 [dev] is **non-commercial**: look-dev only, never in a shipped asset |
| Anything that ships (textures, decals, the city backdrop) | FLUX.2 [klein] 9B (Apache 2.0, about 8 GB) | Qwen-Image | Apache 2.0. Ruling 2026-10-21 (the Director, for the operator): FLUX.2 [klein] is not installed and will not be, so the city backdrop is made with the Leonardo API within the nightly 400-credit window |
| Look-dev and the city backdrop, as built | Leonardo API (`openai/gpt-image-2.5-flare`; operator 2026-10-20, 400 credits a night, every call in `lookdev/log.jsonl`) | none installed: FLUX.2 [klein] will not be, per the ruling above | Ruling 2026-10-21 (the Director, for the operator, `223a93d`; wolf-plan R8, closed): Leonardo is the look-dev generator and may ship the city backdrop. A Leonardo image as image-to-3D input for a shipped mesh (`lamp-agent`): **allowed** (R8b, owner 2026-10-23): Leonardo images may be image-to-3D input for shipped meshes; the image stays in ArtSource as provenance, and the shipped bytes are TRELLIS.2 output (MIT) plus Lynx's own finishing |
| Image-to-3D props | TRELLIS.2 (4B, MIT, GLB with PBR up to 4096², 24 GB minimum) | TripoSR (about 6 GB, lower quality) | MIT |
| Excluded | Hunyuan3D 2.1 | | its licence excludes the EU, the UK and South Korea, so it is out if the owner works from the EU |
| Mesh finishing | Blender, headless Python: decimate, retopology, UV unwrap of the low poly only, scale normalisation | Instant Meshes | open source |
| Grading and input gating | a local vision-language model, chosen in P0 by a small bake-off | the session's own model reading screenshots | per model |
| Agent voice | Kokoro (local TTS) and Whisper (listener), installed through athena's `/voice/install` | a cloud listener key, sealed by athena | per model |

The registry's rules apply to every generated asset (section 7). The ones that change this stack:
an image is gated for reconstructability before TRELLIS.2 sees it; a generated mesh passes an
acceptance gate and a poly budget before UE imports it; the style block is restated in every call.

## 6. The GPU workstation

| Part | Minimum | Recommended | Why |
|---|---|---|---|
| GPU | 24 GB VRAM (RTX 4090 class) | 32 GB (RTX 5090 class) | TRELLIS.2 needs 24 GB; FLUX.2 [dev] FP8 about 32 GB; PC VR at 2x 2064x2208 at 90 Hz |
| RAM | 64 GB | 128 GB | UE editor with shader compile; model offloading |
| CPU | 12 cores | 16+ cores | UE shader and C++ compile times |
| Storage | 1 TB NVMe | 2 TB NVMe | UE 5.8 (about 100 GB with DDC), model weights (FLUX.2 alone 60+ GB across variants) |
| Headset link | Quest 3 + USB-C 3 Link cable | plus a Wi-Fi 6E access point for Air Link | the tethered quality bar |

mage-arena-vr's machine facts (UE 5.8.2 installed, Meta XR v207 cached) suggest that box is the
intended one; P0 confirms the GPU and RAM on it.

*2026-10-23 (owner): the GPU workstation is **Lynx**, the only build host; Wolf, the box the paragraph above meant, is
retired. Lynx is Windows 11 Pro on ARM64 with an NVIDIA RTX Spark N1X (`nvidia-smi`: `64000 MiB`; whether that is
memory shared with the CPU is not measured), 64 GB and UE 5.8.4 run as emulated x64 ([`machine.md`](machine.md)). The
headset link row is deferred: Meta's Link requirements list Intel and AMD CPUs only, and the Meta XR Simulator v207
stands in until a headset route is decided ([`lynx-plan.md`](lynx-plan.md), section f).*

## 7. Registry subjects consulted (ai-registry, branch `contest-1.12.0`)

Routed with `scripts/research-map.mjs`; the golden paths were read before the plan was written.

| Bundle / subject | What it puts into this plan |
|---|---|
| media-generation / `visual-style-locking` | the style block is a project artifact with fixed slots (technique, subject treatment, palette with roles, finish), restated in every call, never remembered |
| media-generation / `image-prompt-composition` | two blocks per prompt (style and action), assigned colour roles, negative prompts |
| media-generation / `generative-provider-routing` | callers name a capability, one router picks the model per environment, refusals re-route |
| media-generation / `generated-output-grading` | trial matrices and a grading schema for style frames; regrade without regenerating |
| game-production / `image-to-3d-input-gating` | judge reconstructability, not beauty, before the paid stage: one subject, plain background, no text as geometry, canonical pose |
| game-production / `generated-mesh-acceptance`, `generated-asset-world-scale`, `mesh-finishing-for-engine-readiness`, `asset-class-poly-budgeting` | the gates between TRELLIS.2 and UE: accept, normalise scale, finish, budget |
| game-production / `immersive-interaction` (`hand-tracked-timing-windows`, `drawn-gesture-command-recognition`) | pinch and sweep are judged from motion onset; tracking loss is a state the app handles on purpose |

The registry has no subject for WebXR or for UE VR rendering; its immersive-interaction subject was
raised by mage-arena and is young. Lessons this project learns about tethered VR and generated
props are candidates to send back as registry leads.

## Sources

- [TRELLIS.2 vs Hunyuan3D 2.1 vs TripoSR (2026)](https://triposr.org/blog/hunyuan3d-vs-trellis)
- [Best Image to 3D Models on Hugging Face (2026)](https://trellis2.app/blog/best-image-to-3d-models-huggingface)
- [AI 3D Model Generation in 2026: every major release, dated](https://app.cinevva.com/guides/ai-3d-model-generation-timeline-2026)
- [Best Local Image Generation Models 2026: VRAM](https://vdf.ai/blog/best-local-image-generation-models/)
- [The Best Open-Source Image Generation Models in 2026](https://www.bentoml.com/blog/a-guide-to-open-source-image-generation-models)
- [Local image models in 2026: Qwen vs FLUX vs SDXL on VRAM](https://botmonster.com/ai/best-local-image-generation-models-2026/)
- [WebGPU on WebXR, three.js issue #32858](https://github.com/mrdoob/three.js/issues/32858) (why WebXR on Quest could not reach this look)
- Local: `mage-arena/docs/XR-TOOLCHAIN.md`, `mage-arena/docs/PROJECT-PLAN.md`, `pof/docs/ue58-mcp-phase2-tool-map.md`, `athena-portable/docs/daemon.md`
