// Writes apps/vr/ArtSource/{survey-pin,fixture-kit}/manifest.json from the scored final.glb and the files on disk.
// Gate results are derived from score-assets.mjs, never typed in. Run after build_art.bpy and render_art.bpy:
//   node scripts/art/write-manifests.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ASSETS, scoreAsset } from './score-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ART = path.join(ROOT, 'apps', 'vr', 'ArtSource');
const DATE = new Date().toISOString().slice(0, 10);

function files(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p, base));
    else if (e.name !== 'manifest.json') out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const gate = (pass, note) => ({ pass, note, date: DATE });

const NOTES = {
  'survey-pin': {
    generator: 'procedural (Blender 5.2.2, scripts/art/build_art.bpy)',
    scale_reasoning: 'Table top at 95 cm (wolf-plan W3.2). A fixture tile is 5 cm square in the kit and the sheet shows pins standing on fixtures, so the pin is 5.45 cm tall with a 1.3 cm head and a 2.2 x 1.4 cm tag: about one tile tall, so a pin never hides its neighbour. At a standing reach of 0.7 m the tag is about 1.8 degrees wide; UE scales the pin under the finger up (reference-sheet frame 04), so the resting size is the smallest case. Whether the resting tag text is legible is the P3 walk-through reading, not a Lynx claim.',
    pivot: 'the needle tip, where the pin meets the sheet; the pin stands +Y in the GLB (glTF Y-up), +Z in Blender',
    textures: 'pin_body_* and pin_tag_*: 256 x 256 PNG base colour, normal and ORM (R occlusion, G roughness, B metal), authored with numpy in scripts/art/build_art.bpy. No text is baked: the tag card is blank for the UE text layer. UVs are box-projected with overlap (flat colour and grain only, no baked light); the tag faces are fitted to 0..1.',
    slots: ['pin_body (amber #FFB547)', 'pin_tag (blank paper #F3E9D2, UE text layer goes here)'],
  },
  'fixture-kit': {
    generator: 'procedural (Blender 5.2.2, scripts/art/build_art.bpy)',
    scale_reasoning: 'Each primitive stands on a 5.0 x 5.0 cm plinth (one tile on a 95 cm table; the plan-unit to cm constant is set in UE, wolf-plan W3.2) and is 1.6 to 3.0 cm tall.',
    pivot: 'the base centre of the plinth; all five meshes sit at the origin in the file (identity node transforms), so a UE importer that splits them keeps the pivots',
    kinds: 'The web canvas does not branch its drawing on a feature kind (apps/web/src/engine/render/plan.ts and patterns.ts draw by lens and stage; checked 2026-10-21). The kinds in the data are free strings. The 133-tile plan (kettle.app-structure.json, v3) uses user_flow (68), capability (31), ops (24) and integration (10); each gets a primitive, and `generic` is the fallback for any other kind (the older v2 Kettle data uses customer, internal, business and platform).',
    mark: 'Slot 1 is named `mark`: a flat 8-sided badge on the plinth corner. UE drives it as a material parameter from the stage, so the stage is not in the geometry. The body slot is `fixture_body`.',
    slots: ['fixture_body (cyan-white #BFE8FF)', 'mark (amber default, UE overrides per stage)'],
    textures: 'none: flat material factors. Both slots are parameter-driven in UE.',
  },
};

// NOTES is prose a human writes, so it stays typed - but it must cover exactly the assets score-assets.mjs knows, and a gap is named here,
// before any file is hashed or written, rather than surfacing as a TypeError on n.pivot.
{
  const missing = Object.keys(ASSETS).filter((id) => !(id in NOTES)), stale = Object.keys(NOTES).filter((id) => !(id in ASSETS));
  if (missing.length || stale.length) {
    if (missing.length) console.error(`NOTES has no entry for: ${missing.join(', ')} (ASSETS in score-assets.mjs lists it; add its prose to NOTES in write-manifests.mjs)`);
    if (stale.length) console.error(`NOTES has an entry for an asset ASSETS does not list: ${stale.join(', ')}`);
    process.exit(2);
  }
}
for (const id of Object.keys(ASSETS)) {
  const dir = path.join(ART, id), r = scoreAsset(id), c = r.checks, n = NOTES[id];
  const all = files(dir);
  const sums = Object.fromEntries(all.map((f) => [f, sha(path.join(dir, f))]));
  const tex = all.filter((f) => f.startsWith('textures/'));
  const per = Object.fromEntries(r.meshes.map((m) => [m.name, { tris: m.tris, vertices: m.vertices, components: m.components, floaters: m.floaters, bounds_cm: m.bounds_cm }]));
  const overall = r.meshes.reduce((a, m) => ({ x: Math.max(a.x, m.bounds_cm.x), y: Math.max(a.y, m.bounds_cm.y), z: Math.max(a.z, m.bounds_cm.z) }), { x: 0, y: 0, z: 0 });
  const bad = Object.entries(c).filter(([, v]) => !v).map(([k]) => k).join(', ');
  const needTex = id === 'survey-pin';
  const manifest = {
    id, class: r.class, budget_tris: r.budget_tris, budget_note: id === 'fixture-kit' ? 'per mesh (300 each)' : 'instanced',
    tris: id === 'fixture-kit' ? Object.fromEntries(r.meshes.map((m) => [m.name, m.tris])) : r.tris_total,
    tris_total: r.tris_total,
    materials: n.slots, bounds_cm: id === 'fixture-kit' ? { note: 'largest per-mesh extent; x,z ground plane, y up', ...overall, per_mesh: Object.fromEntries(r.meshes.map((m) => [m.name, m.bounds_cm])) } : { ...overall, note: 'x,z ground plane, y up (glTF)' },
    meshes: per, uv_sets: 1, pivot: n.pivot, scale_reasoning: n.scale_reasoning,
    ...(n.kinds ? { kinds: n.kinds } : {}), ...(n.mark ? { mark: n.mark } : {}), textures: n.textures,
    generator: n.generator, licence: 'own procedural work',
    regenerate: 'blender -b -P scripts/art/build_art.bpy -- <repo-root>; blender -b -P scripts/art/render_art.bpy -- <repo-root>; node scripts/art/write-manifests.mjs; node scripts/art/score-assets.mjs',
    sha256: sums,
    gates: {
      input: gate(true, 'procedural, no generated input'),
      mesh_acceptance: gate(c.meshes_present && c.no_floaters && c.one_uv_set && c.pivot, `${r.meshes.map((m) => `${m.name}: ${m.components} components, ${m.floaters} floaters`).join('; ')}; one UV set; pivot ${n.pivot.split(';')[0]}`),
      scale: gate(c.scale && c.pivot, `bounds ${overall.x} x ${overall.y} x ${overall.z} cm (x, y up, z); ${n.scale_reasoning.split('. ')[0]}`),
      finishing: gate(c.one_uv_set && c.materials && (!needTex || tex.length === 6), `one UV set, ${r.materials.length} material slots (${r.materials.join(', ')}); ${needTex ? tex.length + ' PNG textures' : 'no textures by design'}`),
      poly_budget: gate(c.poly_budget, `${id === 'fixture-kit' ? 'max ' + Math.max(...r.meshes.map((m) => m.tris)) + ' per mesh' : r.tris_total + ' tris'} against ${r.budget_tris}`),
    },
    lynx_commit: null,
    lynx_commit_note: 'set by the merge; branch autopilot/accepted-idea-delivery-69480049',
  };
  if (bad) console.error(`WARNING ${id}: failed checks: ${bad}`);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${id}: manifest written, ${all.length} files hashed`);
}
