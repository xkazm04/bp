#!/usr/bin/env node
// The concept stage of apps/vr/ArtSource/<id>/manifest.json for the P4 concept sheets (lamp-agent and the studio kit):
// generator_options refs into lookdev/log.jsonl, the contact sheet, the kept option and the identity, written through
// scripts/art/lib/manifest-kit.mjs. A rerun over a decided or built manifest keeps the pick, the rig and every gate: the
// input gate is written only while undecided, and the other gates are seeded "not run" only where absent.
// Run after the images are in place:   node scripts/lookdev/write-prop-manifests.mjs [asset-id ...]   (default: all six)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeStage } from '../art/lib/manifest-kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const log = fs.readFileSync(path.join(ROOT, 'docs/concepts/vr-light-table/lookdev/log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const LICENCE = 'Leonardo concept, TRELLIS input only; R8 open';
const notRun = { pass: false, note: 'not run' };
const date = '2026-10-21';

const lineOf = (prop, variant, seed) => {
  const i = log.findIndex((e) => e.prop === prop && e.variant === variant && e.seed === seed);
  if (i < 0) throw new Error(`no log line for ${prop} ${variant} s${seed}`);
  return { line: i + 1, e: log[i] };
};
const gen = (prop, variant, seed, file) => {
  const { line, e } = lineOf(prop, variant, seed);
  return { option: variant, file, model: e.model, seed, quality: e.quality, size: `${e.width}x${e.height}`, credits: e.credits, log: `docs/concepts/vr-light-table/lookdev/log.jsonl line ${line}`, generationId: e.generationId, prompt: `node scripts/lookdev/leonardo.mjs prompt --prop ${prop} --variant ${variant}` };
};
const ifOwned = (input) => ({ gates: { input } });
const defaults = { gates: { mesh_acceptance: notRun, scale: notRun, finishing: notRun, poly_budget: notRun } };

// The lamp agent's concept was redone on 2026-10-24 (props.json lamp-agent.brief_note): a turnaround of the target's white
// robot lamp character, H against the target crop and the other views against H (or E). Options are named <variant>-s<seed>.
const LAMP_OPTIONS = [['H', 41], ['E', 41], ['F', 42], ['G', 41], ['G', 42]];
const lamp = () => writeStage(ROOT, 'lamp-agent', 'concept', {
  id: 'lamp-agent', class: 'character-prop', budget_tris: 15000,
  budget_note: 'fidelity sprint brief (2026-10-24): the lamp agent at no more than 15k tris; plan.md P4 gave 30000',
  generator_options: LAMP_OPTIONS.map(([v, seed]) => ({ ...gen('lamp-agent', v, seed, `options/${v}-s${seed}.png`), option: `${v}-s${seed}`, reference: lineOf('lamp-agent', v, seed).e.reference })),
  contact_sheet: 'none: evidence/target-compare.jpg sets the target crop beside the build, which is the comparison that decides',
  option_input_check: 'H-s41 (front three-quarter, referenced on reference/target-crop.png) matches the target figure: hood head with a glowing orb, tapered cone body with the amber slit and pin, two jointed capsule arms ending in wire loops, one arm reaching sideways and one hanging. E-s41 is the clean front view. F-s42 and G-s41 came back as multi-view sheets on a blue ground (they break the grey-ground rule but give the side and back silhouettes); G-s42 is the profile. F-s41 (log) was paid for but its download failed, so it has no file. The figure is about 15 rounded primitives, so the views are modelling reference for a scripted build, not image-to-3D input.',
  concept_licence: 'Leonardo API output (rights assigned to the account holder, public:false); modelling reference only, no generated pixels or geometry are shipped; the target crop is cut from docs/concepts/vr-light-table/target-light-table.jpg',
}, { ifOwned: ifOwned({ pass: false, note: 'awaiting a pick among the 2026-10-24 turnaround' }), defaults });

// plan.md P4: studio kit 80k total, split 24k + 16k + 8k + 20k + 12k.
const kit = {
  'studio-shelves': { keep: 'B', drop: 'A', budget: 24000, note: 'B kept: wide and simple, books and roll sit clear of the frame. A also passes but its roll hides behind a post and it is taller and busier.', pass: true },
  'studio-desk-lamp': { keep: 'A', drop: 'B', budget: 16000, note: 'A kept: one stem and a cone shade reads as set dressing and cannot be mistaken for the two-joint lamp agent. B passes the sheet rules but its two-joint arm is too close to the agent.', pass: true },
  'studio-mug': { keep: 'A', drop: 'B', budget: 8000, note: 'A kept: straight-sided, plain, no print. B also passes.', pass: true },
  'studio-drawing-tubes': { keep: 'B', drop: 'A', budget: 20000, note: 'B kept: plain grey ground, round holder, five tubes with two rolls. A fails: saturated blue ground, not plain grey, and a strapped holder with rivets.', pass: true },
  'studio-pinned-drawings': { keep: 'B', drop: 'A', budget: 12000, note: 'Fails the grey-ground rule: both options are a blue wall panel, not a plain grey ground. B kept as the cleaner layout (three equal sheets in a row). The input gate is moot if this is built as a textured plane.', pass: false,
    extra: { recommendation: 'Build as a textured plane (three quads with the sheet art as base colour on a thin frame), not a TRELLIS mesh. The asset is flat linework on paper: a mesh would bake the lines into noisy geometry and spend triangles on nothing. Expected size: under 200 tris, so the 12000 budget is a ceiling. Crop the three sheets out of concept.png; the linework is abstract, with no readable text.' } },
};
const studio = (id) => {
  const k = kit[id];
  return writeStage(ROOT, id, 'concept', {
    id, class: 'set-dressing', budget_tris: k.budget,
    budget_note: `plan.md P4 studio kit total 80k, split across 5 as 24000 shelves, 16000 desk lamp, 8000 mug, 20000 drawing tubes, 12000 pinned drawings`,
    generator_options: [gen(id, 'A', 21, k.keep === 'A' ? 'concept.png' : 'rejected/A.png'), gen(id, 'B', 21, k.keep === 'B' ? 'concept.png' : 'rejected/B.png')],
    generator_note: 'log.jsonl file fields name candidates/<A|B>.png, the place each image was written before grading; they were then moved to concept.png or rejected/.',
    kept_option: k.keep,
    ...(k.extra ?? {}),
    concept_licence: LICENCE,
  }, { ifOwned: ifOwned({ pass: k.pass, note: k.note, date }), defaults });
};

const WRITERS = { 'lamp-agent': lamp, ...Object.fromEntries(Object.keys(kit).map((id) => [id, () => studio(id)])) };
const ids = process.argv.slice(2);
const unknown = ids.filter((id) => !(id in WRITERS));
if (unknown.length) {
  console.error(`unknown asset id: ${unknown.join(', ')} (one of ${Object.keys(WRITERS).join(', ')})`);
  console.error('usage: node scripts/lookdev/write-prop-manifests.mjs [asset-id ...]');
  process.exit(2);
}
for (const id of ids.length ? ids : Object.keys(WRITERS)) { WRITERS[id](); console.log(`${id}: concept stage written`); }
