#!/usr/bin/env node
// Writes apps/vr/ArtSource/<id>/manifest.json for the P4 concept sheets (lamp-agent and the studio kit): generator refs
// into lookdev/log.jsonl, sha256 of every file in the folder, gates. Run after the images are in place.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// lynx_commit is the writer's field: the newest commit that touches this asset folder, so check:art can trace the
// manifest to a real tree. It throws when nothing has committed the folder yet (there is no honest hash to stamp).
function lynxCommit(folder) {
  const r = spawnSync('git', ['log', '-1', '--format=%H', '--', 'apps/vr/ArtSource/' + folder], { cwd: ROOT, encoding: 'utf8' });
  const h = (r.stdout ?? '').trim();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error('lynx_commit: no commit touches apps/vr/ArtSource/' + folder + ' yet; commit the folder first so the manifest can name it');
  return h;
}
const ART = path.join(ROOT, 'apps/vr/ArtSource');
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
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)).map((f) => `${d.name}/${f}`) : d.name === 'manifest.json' ? [] : [d.name]));
const sha = (id) => Object.fromEntries(files(path.join(ART, id)).sort().map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ART, id, f))).digest('hex')]));
const write = (id, m) => fs.writeFileSync(path.join(ART, id, 'manifest.json'), JSON.stringify({ ...m, licence: LICENCE, sha256: sha(id), lynx_commit: lynxCommit(id), lynx_commit_note: 'stamped by the writer: the newest commit touching this folder when the manifest was written' }, null, 2) + '\n');

write('lamp-agent', {
  id: 'lamp-agent', class: 'character-prop', budget_tris: 30000,
  generator: ['A', 'B', 'C', 'D'].map((v) => gen('lamp-agent', v, 11, `options/${v}.png`)),
  contact_sheet: 'options/contact.png, built by scripts/lookdev/contact-sheet.ps1 (labels in the margin only)',
  option_input_check: 'All four first-seed images pass the sheet rules (one object, whole, plain grey ground, readable silhouette, no text, no claw, no legs, no face), so no second seed was made. A and C show a coil spring and a dome shade; B a pantograph disc; D a box shade with a counterweight.',
  gates: { input: { pass: false, note: 'awaiting owner design pick among A-D' }, mesh_acceptance: notRun, scale: notRun, finishing: notRun, poly_budget: notRun },
});

// plan.md P4: studio kit 80k total, split 24k + 16k + 8k + 20k + 12k.
const kit = {
  'studio-shelves': { keep: 'B', drop: 'A', budget: 24000, note: 'B kept: wide and simple, books and roll sit clear of the frame. A also passes but its roll hides behind a post and it is taller and busier.', pass: true },
  'studio-desk-lamp': { keep: 'A', drop: 'B', budget: 16000, note: 'A kept: one stem and a cone shade reads as set dressing and cannot be mistaken for the two-joint lamp agent. B passes the sheet rules but its two-joint arm is too close to the agent.', pass: true },
  'studio-mug': { keep: 'A', drop: 'B', budget: 8000, note: 'A kept: straight-sided, plain, no print. B also passes.', pass: true },
  'studio-drawing-tubes': { keep: 'B', drop: 'A', budget: 20000, note: 'B kept: plain grey ground, round holder, five tubes with two rolls. A fails: saturated blue ground, not plain grey, and a strapped holder with rivets.', pass: true },
  'studio-pinned-drawings': { keep: 'B', drop: 'A', budget: 12000, note: 'Fails the grey-ground rule: both options are a blue wall panel, not a plain grey ground. B kept as the cleaner layout (three equal sheets in a row). The input gate is moot if this is built as a textured plane.', pass: false,
    extra: { recommendation: 'Build as a textured plane (three quads with the sheet art as base colour on a thin frame), not a TRELLIS mesh. The asset is flat linework on paper: a mesh would bake the lines into noisy geometry and spend triangles on nothing. Expected size: under 200 tris, so the 12000 budget is a ceiling. Crop the three sheets out of concept.png; the linework is abstract, with no readable text.' } },
};
for (const [id, k] of Object.entries(kit)) {
  write(id, {
    id, class: 'set-dressing', budget_tris: k.budget,
    budget_note: `plan.md P4 studio kit total 80k, split across 5 as 24000 shelves, 16000 desk lamp, 8000 mug, 20000 drawing tubes, 12000 pinned drawings`,
    generator: [gen(id, 'A', 21, k.keep === 'A' ? 'concept.png' : 'rejected/A.png'), gen(id, 'B', 21, k.keep === 'B' ? 'concept.png' : 'rejected/B.png')],
    generator_note: 'log.jsonl file fields name candidates/<A|B>.png, the place each image was written before grading; they were then moved to concept.png or rejected/.',
    kept_option: k.keep,
    ...(k.extra ?? {}),
    gates: { input: { pass: k.pass, note: k.note, date }, mesh_acceptance: notRun, scale: notRun, finishing: notRun, poly_budget: notRun },
  });
}
