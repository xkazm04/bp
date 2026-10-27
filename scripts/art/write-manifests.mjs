// Writes apps/vr/ArtSource/{survey-pin,fixture-kit}/manifest.json from the scored final.glb and the files on disk.
// Gate results are derived from score-assets.mjs, never typed in. Run after build_art.bpy and render_art.bpy:
//   node scripts/art/write-manifests.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, scoreAsset } from './score-assets.mjs';
import { folderDir, gate, inventory, writeStage } from './lib/manifest-kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const NOTES = {
  'survey-pin': {
    generator: 'procedural (Blender 5.2.2, scripts/art/build_art.bpy)',
    scale_reasoning: 'Table top at 95 cm (wolf-plan W3.2). The concept (target-light-table.jpg, R-11 and R-12) draws a finding as an amber bead on the plan, a thin amber stem and a paper tag on top, so the pin is a 7.6 mm bead, a 1.2 mm stem with a collar and a 2.2 x 1.4 cm tag centred on the stem, 6.4 cm tall in all: the tag stands clear of a 3 cm furniture glyph. At a standing reach of 0.7 m the tag is about 1.8 degrees wide; UE scales the pin under the finger up (reference-sheet frame 04), so the resting size is the smallest case. Whether the resting tag text is legible is the P3 walk-through reading, not a Lynx claim.',
    pivot: 'the bottom of the bead, where the pin meets the sheet; the pin stands +Y in the GLB (glTF Y-up), +Z in Blender',
    textures: 'pin_body_* and pin_tag_*: 256 x 256 PNG base colour, normal and ORM (R occlusion, G roughness, B metal), authored with numpy in scripts/art/build_art.bpy. No text is baked: the tag card is blank for the UE text layer. Geometry finished by scripts/art/lib/finish.bpy (bevelled hard edges, hardened and weighted normals, smooth shading); one unique UV set, the tag faces fitted to 0..1. The bead glows in the concept: UE adds the emission (the GLB carries none).',
    slots: ['pin_body (amber #FFB547)', 'pin_tag (blank paper #F3E9D2, UE text layer goes here)'],
  },
  'fixture-kit': {
    generator: 'procedural (Blender 5.2.2, scripts/art/build_art.bpy)',
    scale_reasoning: 'Each glyph is a 2:1 furniture vignette about 4.3 to 5.1 cm across, 0.8 to 2.6 cm deep and 1.3 to 2.3 cm tall: UE fits it to 0.8 of a Kettle tile (5.92 x 2.81 cm at 0.037 cm per plan unit) by its footprint, so it fills the tile at about 1:40, with heights and thin members (legs, uprights, chair backs) exaggerated as in an architectural maquette. Judged in EEVEE at that size from the target pose under the additive cyan M_Glyph look (spark vr-fidelity-40 FN); no plinth, the glyph stands on the room floor as in the concept.',
    pivot: 'the base centre of the glyph; all five meshes sit at the origin in the file (identity node transforms), so a UE importer that splits them keeps the pivots',
    kinds: 'The web canvas does not branch its drawing on a feature kind (apps/web/src/engine/render/plan.ts and patterns.ts draw by lens and stage; checked 2026-10-21). The kinds in the data are free strings. The 133-tile plan (kettle.app-structure.json, v3) uses user_flow (68), capability (31), ops (24) and integration (10); each gets a furniture glyph (art-breakdown row 5, the concept\'s furnished rooms): user_flow a bench of two workstations (a long desk on panel legs, two monitors, two task chairs), capability an oval meeting table on two pedestals with six chairs, ops two open shelving units with binders and archive boxes, integration a lounge (a three-seat sofa on legs, an armchair and a coffee table); `generic` (any other kind) three potted plants. The mapping is a look choice of spark vr-fidelity-40, not data: VR still reads only the kind.',
    mark: 'Slot 1 is named `mark`: a flat 6-sided amber badge lying on a top surface of the glyph (desk top, table top, shelf top, coffee table, soil). UE drives it as a material parameter from the stage, so the stage is not in the geometry. The body slot is `fixture_body`.',
    slots: ['fixture_body (cyan-white #BFE8FF)', 'mark (amber default, UE overrides per stage)'],
    textures: 'none: flat material factors. Both slots are parameter-driven in UE (the concept draws the furniture as cyan-white linework glass). Designed low-poly for its size (250 to 450 triangles a glyph, so UE must not decimate it): plain sharp-edged boxes, prisms and eight-sided lathes with air between the parts, because the additive fresnel look lights the faces seen edge-on and the silhouette reads by them. Through scripts/art/lib/finish.bpy without chamfers (weighted normals, one unique UV set).',
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
  const r = scoreAsset(id), c = r.checks, n = NOTES[id];
  const all = inventory(folderDir(ROOT, id)).files;
  const tex = all.filter((f) => f.startsWith('textures/'));
  const per = Object.fromEntries(r.meshes.map((m) => [m.name, { tris: m.tris, vertices: m.vertices, components: m.components, floaters: m.floaters, bounds_cm: m.bounds_cm }]));
  const overall = r.meshes.reduce((a, m) => ({ x: Math.max(a.x, m.bounds_cm.x), y: Math.max(a.y, m.bounds_cm.y), z: Math.max(a.z, m.bounds_cm.z) }), { x: 0, y: 0, z: 0 });
  const bad = Object.entries(c).filter(([, v]) => !v).map(([k]) => k).join(', ');
  const needTex = id === 'survey-pin';
  const fields = {
    id, class: r.class, budget_tris: r.budget_tris, budget_note: id === 'fixture-kit' ? 'per mesh (800 each; spark vr-fidelity-40 raised it from 300 for furniture glyphs that read by silhouette)' : 'instanced',
    tris: id === 'fixture-kit' ? Object.fromEntries(r.meshes.map((m) => [m.name, m.tris])) : r.tris_total,
    tris_total: r.tris_total,
    materials: n.slots, bounds_cm: id === 'fixture-kit' ? { note: 'largest per-mesh extent; x,z ground plane, y up', ...overall, per_mesh: Object.fromEntries(r.meshes.map((m) => [m.name, m.bounds_cm])) } : { ...overall, note: 'x,z ground plane, y up (glTF)' },
    meshes: per, uv_sets: 1, pivot: n.pivot, scale_reasoning: n.scale_reasoning,
    ...(n.kinds ? { kinds: n.kinds } : {}), ...(n.mark ? { mark: n.mark } : {}), textures: n.textures,
    generator: n.generator, licence: 'own procedural work',
    regenerate: 'blender -b -P scripts/art/build_art.bpy -- <repo-root>; blender -b -P scripts/art/render_art.bpy -- <repo-root>; node scripts/art/write-manifests.mjs; node scripts/art/score-assets.mjs',
    gates: {
      input: gate(true, 'procedural, no generated input'),
      mesh_acceptance: gate(c.meshes_present && c.no_floaters && c.one_uv_set && c.pivot, `${r.meshes.map((m) => `${m.name}: ${m.components} components, ${m.floaters} floaters`).join('; ')}; one UV set; pivot ${n.pivot.split(';')[0]}`),
      scale: gate(c.scale && c.pivot, `bounds ${overall.x} x ${overall.y} x ${overall.z} cm (x, y up, z); ${n.scale_reasoning.split('. ')[0]}`),
      finishing: gate(c.one_uv_set && c.materials && (!needTex || tex.length === 6), `one UV set, ${r.materials.length} material slots (${r.materials.join(', ')}); ${needTex ? tex.length + ' PNG textures' : 'no textures by design'}`),
      poly_budget: gate(c.poly_budget, `${id === 'fixture-kit' ? 'max ' + Math.max(...r.meshes.map((m) => m.tris)) + ' per mesh' : r.tris_total + ' tris'} against ${r.budget_tris}`),
    },
  };
  // The manifest is still written (it records the failing gate), but the run reports it: score-assets.mjs exits 1 on the same
  // information, and a && chain must not carry on over a manifest check:art will reject.
  if (bad) { console.error(`WARNING ${id}: failed checks: ${bad}`); process.exitCode = 1; }
  // the build stage through the kit: it stamps sha256, file_bytes and lynx_commit, and refuses before writing if no commit names the folder
  writeStage(ROOT, id, 'build', fields);
  console.log(`${id}: manifest written, ${all.length} files hashed`);
}
