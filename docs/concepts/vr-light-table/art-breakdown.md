# VR Light Table: the target, taken apart

The target image (`target-light-table.jpg`) is the bar. This file lists every element in it, says
what it means in bp, and decides how it is built. There are four ways to build an element:

- **data**: generated at run time from the product (`apps/server`).
- **procedural**: built in UE from parameters, no authored asset.
- **generated**: made offline on the GPU box (ComfyUI or TRELLIS.2), gated, finished, imported.
- **shader**: a material or post effect.

## The elements

| # | In the image | In bp | Built as | Notes |
|---|---|---|---|---|
| 1 | Backlit glass table, bright white edge light | the drawing board | procedural mesh + shader | emissive frame strip; a rect light under the glass lights the hands; the glass's blue comes from the paper material, not a tint |
| 2 | Deep blue blueprint paper with a faint grid, a compass rose, a scale bar, "SITE PLAN, LEVEL 1" | the L0 site sheet | shader + data | grid and wing outlines drawn into a runtime render target from the layout; the title block carries the product name and the active lens |
| 3 | A row of wings left to right, labelled WING 01... | the 13 domains, oldest work first | data | wing order and footprint from `core`'s layout; labels are real (IAM Identity & Access, ...) |
| 4 | Rooms as thin translucent extrusions with bright cyan edges | capabilities (29) | data + procedural + shader | one instanced box per room; an edge-glow material (fresnel plus an edge mask) and low-opacity faces; heights carry stage or lens reading, never position (spatial stability) |
| 5 | Small furniture inside rooms | features (133) as fixtures | data + procedural | instanced primitives per feature kind; stage drives the mark, as on the web canvas |
| 6 | The room under the finger lifted taller and brighter | the selected room, the open level | procedural animation | semantic zoom: pinch-pull lifts a room off the sheet into a bay (L2 to L3); the feature sheet (L4) opens as a card |
| 7 | Amber pins with paper tags ("R-11 TEMP 28 °C") | scan findings at their fixtures | data + generated + text layer | pin mesh generated once; tag text is a compositor layer with the finding's title, lens and size |
| 8 | The cyan scan line sweeping across a wing | `scan.place` running | shader | a material parameter collection drives the band; pins rise as results stream in |
| 9 | The lamp agent with a warm glowing head and jointed arm | the Athena daemon's presence | generated (TRELLIS.2) + finished + rigged | states from athena's events: resting, reading, working, asking, speaking; the head tracks the wing it is talking about |
| 10 | The floating decision card with Approve and Decline | a GATED action or a swarm decision | data + text layer | athena's decision payload: action, params, rationale; answered by voice or pinch |
| 11 | The wrist panel: Package A/B/C with a progress ring | the wave composer and running jobs | data + text layer | packages with model (Sonnet 5.5 or Opus 5.5) and effort; rings are job progress; up to 3 running |
| 12 | Real hands, one pointing | Meta hand tracking | engine | Meta Interaction SDK poses; pointing is gaze-free selection; pinch is the act |
| 13 | Dark studio: shelves, drawings on walls, desk lamp, mug, rolled drawings | the place you work in | generated props + generated textures | a small kit, static, baked lighting; never competes with the table |
| 14 | Night city through tall windows | mood and depth | generated (FLUX.2 [klein]) | a matte panorama outside the windows; its own light kept dim |
| 15 | Soft volumetric haze, bloom on bright edges | atmosphere | shader / post | exponential height fog with low volumetric scattering; bloom tuned so edges glow without smearing text |

## Where the image cheats, and what the build does instead

- **The labels are invented.** The build uses Kettle's real names and finding titles, and every
  string a person reads is a text layer.
- **The table holds more than a dozen wings, all furnished, at one zoom.** At L0 the build shows wing
  footprints, aggregate counts and pins; rooms rise only on approach, so the sheet never shrinks
  text to fit (the web canvas's L0 rule).
- **The wrist panel's percentages are decoration.** In the build they are job progress from
  `apps/server`'s stream.
- **The light is a painting.** The concept has bounce light everywhere. P3 decides how much of it
  forward shading plus rect lights can fake before Lumen is considered (see `tech-stack.md` §2).

## The style block

Per the registry's `visual-style-locking`: style is a project artifact with fixed slots, restated in
every generation call and never left for the model to remember. It is the source of truth for
style frames, generated textures and the prop concept sheets fed to TRELLIS.2.

| Slot | Value |
|---|---|
| Technique | photographic concept render, first-person, shallow depth of field at the far edge |
| Subject treatment | architectural drafting: thin luminous linework, translucent paper-thin volumes, physical drafting objects |
| Palette with roles | ground: blueprint blue `#0B2A6B` to `#123A8C`; linework and volumes: cyan-white `#BFE8FF`; attention (pins, scan, agent head): amber `#FFB547`; decision accents: warm paper `#F3E9D2`; studio: near-black blue `#0A0F18` |
| Finish | soft bloom on edges, light haze, warm practical lights against a cool table, slight film grain |
| Never | galaxy or star imagery, neon cyberpunk clutter, fisheye, readable fake text, purple gradients |

Prop sheets for image-to-3D follow the registry's input gating, not the style block: one object,
plain neutral background, canonical pose, even light, no text on the object, the object whole and
uncropped. A beautiful prop image that breaks those rules is rejected before TRELLIS.2 runs.

## Fidelity: how close is close

The P6 gate compares a headset capture with the target, taken from the same pose (standing,
looking about 45° down at the table's near edge, the lamp in the upper third). Each element above
is scored 0 to 3 by the owner, with a vision-model pre-score as advice only:

0. missing
1. present, reads as a placeholder
2. reads as the concept's element
3. matches or beats the concept

Pass: no element below 2, and elements 1, 4, 7, 9, 10 and 11 at 3. These six carry the concept: the
lit table, the volumes, the pins, the agent, the card and the wrist.
