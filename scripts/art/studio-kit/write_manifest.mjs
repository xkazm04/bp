// Writes apps/vr/ArtSource/<asset-id>/manifest.json for a studio kit prop from the measured scores (build_studio.bpy -> score.json,
// render_studio.bpy -> framing.json) and the files on disk. Gate results are derived from the measurements, never typed in.
// The concept stage's fields (id, class, budget, Leonardo options, kept option) are the kit's to keep: this is the build
// stage, and the input gate's procedural route is recorded as a decision (the build chose image-free input).
//   node scripts/art/studio-kit/write_manifest.mjs <work-dir> <asset-id>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MB10, argsOrUsage, cm, folderDir, gate, inventory, readManifest, writeStage } from '../lib/manifest-kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [work, id] = argsOrUsage(2, 'node scripts/art/studio-kit/write_manifest.mjs <work-dir> <asset-id>');
const S = JSON.parse(fs.readFileSync(path.join(work, id, 'score.json'), 'utf8'));
const F = JSON.parse(fs.readFileSync(path.join(work, id, 'framing.json'), 'utf8'));
const old = readManifest(ROOT, id);
if (!old?.gates?.input) { console.error(`${id}: no concept-stage manifest with an input gate; run scripts/lookdev/write-prop-manifests.mjs ${id} first`); process.exit(2); }
const { files: all, file_bytes: sizes } = inventory(folderDir(ROOT, id));
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

// The procedural route is a decision about the input (no image-to-3D), so it is written as the decision stage, stamped
// `by`; a rerun finds the note it wrote and leaves the gate alone.
const done = old.gates.input.note.includes('procedural');
const inputGate = done ? null : id === 'studio-pinned-drawings'
  ? gate(true, `procedural, no generated input: the mesh is built in Blender (scripts/art/studio-kit/build_studio.bpy) and concept.png is a shape reference only, not a TRELLIS input. Earlier note, kept: "${old.gates.input.note}" The grey-ground rule applies to image-to-3D input, which this asset does not use.`)
  : { ...old.gates.input, note: `${old.gates.input.note} Built procedurally instead of through TRELLIS (GPU held by the mage-arena run); concept.png is the shape reference.` };
if (old.budget_tris !== S.budget_tris) { console.error(`${id}: score.json budget_tris ${S.budget_tris} is not the concept stage's ${old.budget_tris}; the budget is the concept's to change`); process.exit(2); }

const M = {
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
  licence: 'own procedural work; concept.png is a Leonardo concept used as a shape reference only (R8 open); no ComfyUI or TRELLIS run, no GPU job, no Leonardo call',
  regenerate: `blender -b -P scripts/art/studio-kit/build_studio.bpy -- <repo-root> <work> ${id}; blender -b -P scripts/art/studio-kit/render_studio.bpy -- <repo-root> <work> ${id}; node scripts/art/studio-kit/write_manifest.mjs <work> ${id}`,
  framing: F,
  gates: {
    mesh_acceptance: gate(meshOk, `re-imported from final.glb: ${S.mesh_objects} mesh object, ${S.vertices} vertices, ${S.tris} tris, ${S.components} connected components, ${S.floaters} floaters (a floater is a component whose bounding box touches no other), ${S.open_edges} open edges, signed volume ${S.signed_volume_m3} m3 (positive: normals face out)`),
    scale: gate(scaleOk, `${cm(sx)} x ${cm(sy)} x ${cm(sz)} cm (x, y, z up) re-imported from final.glb, inside the planned envelope (${S.expected_why}); pivot: base centre ${S.pivot_xy_base_centre_m.join(', ')} m, floor at z = ${S.floor_z_m} m. Assumption: the sizes are Lynx choices from the concept; the UE world scale is still to be confirmed on Wolf.`),
    finishing: gate(finishOk, `one UV set (${S.uv_sets}); ${tex.length} PBR PNGs (base colour, normal, ORM for ${textured.length} slots${flat.length ? `; ${flat.join(', ')} flat emissive` : ''}); every file under 10 MB (largest ${Math.max(...Object.values(sizes))} bytes); ${S.materials.length} material slots (${S.materials.join(', ')}); evidence turnaround.jpg and table-view.jpg rendered with Cycles on the CPU, framing check passes on ${Object.keys(F).length} images (min silhouette margin ${minMargin} of the image, rule 0.03). Not claimed: any UE import.`),
    poly_budget: gate(budgetOk, `${S.tris} tris against ${S.budget_tris} (${Math.round((S.tris / S.budget_tris) * 100)}%)`),
  },
};
// both stages through the kit, which stamps sha256, file_bytes and lynx_commit
if (inputGate) writeStage(ROOT, id, 'decision', { gates: { input: { ...inputGate, by: 'build route (scripts/art/studio-kit/write_manifest.mjs)' } } });
const written = writeStage(ROOT, id, 'build', M);
console.log(id, S.tris, '/', S.budget_tris, Object.fromEntries(Object.entries(written.gates).map(([k, v]) => [k, v.pass])));
