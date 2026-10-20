# VR Light Table: bp at a backlit drafting table

![The target: Light Table concept art (generated, stylised)](target-light-table.jpg)

*The target. A generated concept image, not a render of anything that exists. Its labels are
image-model text and mean nothing; the build uses Kettle's real names.*

## The idea

You stand at a waist-high, backlit light table in a dark studio at night and look down at a whole
software product. bp's drawing set lies on the glass as a blueprint: wings left to right in the
order their work began, each wing's rooms rising off the paper as thin translucent extrusions,
features as small fixtures inside. A scan line sweeps a wing and amber survey pins rise where it
finds something. Your left wrist carries the wave composer: packages of findings, each with a model
and an effort. Above the far edge of the table hangs the agent, a drafting lamp with a warm head,
and beside it floats the one decision it needs from you, approve or decline. You talk to it.

This is bp's third channel after the web canvas and the phone view: the same product, model,
lenses, scans and waves, drawn for a headset.

## Decisions that shape everything (spark `vr-light-table`, 2026-10-20)

| Decision | Chosen | Rejected |
|---|---|---|
| Runtime | **Unreal Engine 5.8 + Meta XR v207**, the route mage-arena-vr verified on the GPU box | WebXR inside bp; Unity 6 |
| Sharing | bp becomes a **monorepo**. The logic lives once, in TypeScript (`packages/core`), and a headless server serves it; the UE app is a thin renderer and interaction client. Each channel keeps its own stack and dev loop | Porting the core to C++ (two copies of every rule); hybrid layout port |
| Quality bar | **PC-tethered** Quest 3 (Link / Air Link) rendered by the GPU workstation | Standalone Quest; two tiers from day one |
| Agent | **The Athena daemon itself**: its voice socket (local Kokoro TTS, Whisper), the AUTO/GATED gate, decision cards and ledger. bp registers its actions as tools | Re-implementing the gate in bp |
| Generation | Local, on the GPU box: look-dev style frames, 3D props via image-to-3D, studio environment and materials, the agent's voice | Cloud generation by default |
| Execution | Agent sessions on the GPU box drive UE through UE 5.8's editor MCP toolsets plus pof's gap-fillers; ComfyUI and TRELLIS.2 run as local services; the owner judges in the headset | An owner-only editor roadmap |

## The documents

- [`tech-stack.md`](tech-stack.md): the research. Runtime, monorepo layout, the server contract,
  the Athena integration, the local generation stack with VRAM and licences, the GPU box spec,
  and the registry subjects consulted.
- [`art-breakdown.md`](art-breakdown.md): the target image taken apart element by element, each
  with how it is built (from data, procedural, generated, or shader), and the style block that
  locks the look.
- [`plan.md`](plan.md): seven phases with gates, work packages and acceptance, the fidelity
  method that measures a capture against the target, risks, and the steps only the owner can do.

## Status

Planned, not started. Nothing in this folder is built. Execution happens on the GPU workstation;
this checkout only holds the plan.
