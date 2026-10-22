// Writes apps/vr/ArtSource/<asset-id>/manifest.json for a studio kit prop from the measured scores (build_studio.bpy -> score.json,
// render_studio.bpy -> framing.json) and the files on disk. Gate results are derived from the measurements, never typed in.
// The concept bookkeeping already in the manifest (id, class, budget, Leonardo options, kept option, input gate) is kept.
//   node scripts/art/studio-kit/write_manifest.mjs <work-dir> <asset-id>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// lynx_commit is the writer's field: the newest commit that touches this asset folder, so check:art can trace the
// manifest to a real tree. It throws when nothing has committed the folder yet (there is no honest hash to stamp).
function lynxCommit(folder) {
  const r = spawnSync('git', ['log', '-1', '--format=%H', '--', 'apps/vr/ArtSource/' + folder], { cwd: ROOT, encoding: 'utf8' });
  const h = (r.stdout ?? '').trim();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error('lynx_commit: no commit touches apps/vr/ArtSource/' + folder + ' yet; commit the folder first so the manifest can name it');
  return h;
}
const [work, id] = process.argv.slice(2);
const DIR = path.join(ROOT, 'apps', 'vr', 'ArtSource', id);
const S = JSON.parse(fs.readFileSync(path.join(work, id, 'score.json'), 'utf8'));
const F = JSON.parse(fs.readFileSync(path.join(work, id, 'framing.json'), 'utf8'));
const old = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const DATE = new Date().toISOString().slice(0, 10);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const gate = (pass, note) => ({ pass, note, date: DATE });
const files = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p, base) : e.name === 'manifest.json' ? [] : [path.relative(base, p).split(path.sep).join('/')];
}).sort();
const all = files(DIR);
const sums = Object.fromEntries(all.map((f) => [f, sha(path.join(DIR, f))]));
const sizes = Object.fromEntries(all.map((f) => [f, fs.statSync(path.join(DIR, f)).size]));
const MB10 = 10 * 1024 * 1024;
const cm = (v) => Math.round(v * 1e4) / 100;
const [sx, sy, sz] = S.bounds_m.size_xyz;
const tex = all.filter((f) => f.startsWith('textures/'));
const evidence = ['evidence/turnaround.jpg', 'evidence/table-view.jpg'];
const framingOk = Object.values(F).every((v) => v.pass);
const minMargin = Math.min(...Object.values(F).map((v) => v.min_margin));
const textured = S.materials.filter((m) => S.material_has_textures[m].length > 0);
const flat = S.materials.filter((m) => S.material_has_textures[m].length === 0);
const texComplete = textured.every((m) => ['basecolor', 'normal', 'orm'].every((c) => tex.includes(`textures/${m}_${c}.png`)));
const inRange = S.expected_size_m.every(([lo, hi], i) => S.bounds_m.size_xyz[i] >= lo && S.bounds_m.size_xyz[i] <= hi);

const meshOk = S.mesh_objects === 1 && S.floaters === 0 && S.open_edges === 0 && S.signed_volume_m3 > 0;
const scaleOk = inRange && Math.abs(S.floor_z_m) < 1e-4 && S.pivot_xy_base_centre_m.every((v) => Math.abs(v) < 1e-3);
const finishOk = S.uv_sets === 1 && texComplete && textured.length > 0 && Object.values(sizes).every((b) => b < MB10)
  && evidence.every((e) => all.includes(e)) && framingOk && S.materials.every((m) => S.faces_per_slot[m] > 0);
const budgetOk = S.tris <= S.budget_tris;

const done = old.gates.input.note.includes('procedural');   // a rerun keeps the note it wrote
const inputGate = done ? old.gates.input : id === 'studio-pinned-drawings'
  ? gate(true, `procedural, no generated input: the mesh is built in Blender (scripts/art/studio-kit/build_studio.bpy) and concept.png is a shape reference only, not a TRELLIS input. Earlier note, kept: "${old.gates.input.note}" The grey-ground rule applies to image-to-3D input, which this asset does not use.`)
  : { ...old.gates.input, note: `${old.gates.input.note} Built procedurally instead of through TRELLIS (GPU held by the mage-arena run); concept.png is the shape reference.` };

const M = {
  id: old.id,
  class: old.class,
  budget_tris: S.budget_tris,
  budget_note: old.budget_note,
  tris: S.tris,
  tris_total: S.tris,
  materials: S.materials.map((m) => `${m} (${S.faces_per_slot[m]} tris${S.material_has_textures[m].length ? ', PBR textures' : ', emissive flat colour, no texture'})`),
  bounds_cm: { x: cm(sx), y: cm(sz), z: cm(sy), note: 'x,z ground plane, y up (glTF)' },
  meshes: {
    [id]: { tris: S.tris, vertices: S.vertices, components: S.components, floaters: S.floaters, open_edges: S.open_edges, faces_per_slot: S.faces_per_slot },
  },
  uv_sets: S.uv_sets,
  pivot: `base centre (x and y at the middle of the footprint, z = 0 at the floor); measured ${S.pivot_xy_base_centre_m.join(', ')} m; the prop stands +Y in the GLB (glTF Y-up), +Z in Blender`,
  scale_reasoning: `${S.expected_why}. Measured ${cm(sx)} x ${cm(sz)} x ${cm(sy)} cm (x, up, y); the planned envelope per axis is ${S.expected_size_m.map(([a, b]) => `${a * 100}-${b * 100} cm`).join(', ')} (x, y, z up).`,
  textures: `${tex.length} PNGs, 256 px seamless tiles (the printed sheets: 384 x 576, mapped once): base colour, normal, ORM (R occlusion, G roughness, B metal), authored with numpy in scripts/art/studio-kit/build_studio.bpy. One UV set, box-projected in world metres (printed sheets: planar 0..1). Flat colour plus grain, no baked light.${flat.length ? ` Flat colour, no texture: ${flat.join(', ')} (emissive).` : ''}`,
  generator: 'procedural Blender',
  blender: 'Blender 5.2.2, scripts/art/studio-kit/build_studio.bpy (build and score), render_studio.bpy (evidence and framing check), write_manifest.mjs',
  concept_reference: old.generator_options ?? old.concept_reference ?? old.generator,
  concept_note: old.generator_note ?? old.concept_note,
  kept_option: old.kept_option,
  licence: 'own procedural work; concept.png is a Leonardo concept used as a shape reference only (R8 open); no ComfyUI or TRELLIS run, no GPU job, no Leonardo call',
  lynx_commit: lynxCommit(id),
  lynx_commit_note: 'stamped by the writer: the newest commit touching this folder when the manifest was written',
  regenerate: `blender -b -P scripts/art/studio-kit/build_studio.bpy -- <repo-root> <work> ${id}; blender -b -P scripts/art/studio-kit/render_studio.bpy -- <repo-root> <work> ${id}; node scripts/art/studio-kit/write_manifest.mjs <work> ${id}`,
  framing: F,
  file_bytes: sizes,
  sha256: sums,
  gates: {
    input: inputGate,
    mesh_acceptance: gate(meshOk, `re-imported from final.glb: ${S.mesh_objects} mesh object, ${S.vertices} vertices, ${S.tris} tris, ${S.components} connected components, ${S.floaters} floaters (a floater is a component whose bounding box touches no other), ${S.open_edges} open edges, signed volume ${S.signed_volume_m3} m3 (positive: normals face out)`),
    scale: gate(scaleOk, `${cm(sx)} x ${cm(sy)} x ${cm(sz)} cm (x, y, z up) re-imported from final.glb, inside the planned envelope (${S.expected_why}); pivot: base centre ${S.pivot_xy_base_centre_m.join(', ')} m, floor at z = ${S.floor_z_m} m. Assumption: the sizes are Lynx choices from the concept; the UE world scale is still to be confirmed on Wolf.`),
    finishing: gate(finishOk, `one UV set (${S.uv_sets}); ${tex.length} PBR PNGs (base colour, normal, ORM for ${textured.length} slots${flat.length ? `; ${flat.join(', ')} flat emissive` : ''}); every file under 10 MB (largest ${Math.max(...Object.values(sizes))} bytes); ${S.materials.length} material slots (${S.materials.join(', ')}); evidence turnaround.jpg and table-view.jpg rendered with Cycles on the CPU, framing check passes on ${Object.keys(F).length} images (min silhouette margin ${minMargin} of the image, rule 0.03). Not claimed: any UE import.`),
    poly_budget: gate(budgetOk, `${S.tris} tris against ${S.budget_tris} (${Math.round((S.tris / S.budget_tris) * 100)}%)`),
  },
};
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(M, null, 2) + '\n');
console.log(id, S.tris, '/', S.budget_tris, Object.fromEntries(Object.entries(M.gates).map(([k, v]) => [k, v.pass])));
