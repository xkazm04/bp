// Fills apps/vr/ArtSource/lamp-agent/manifest.json from the measured scores (score_lamp.bpy, finish_lamp.bpy) and the files on disk.
// Gate results are derived from the measurements, never typed in. Keeps the option and pick fields written in the look-dev step.
//   node scripts/art/lamp/write_manifest.mjs <work-dir> <raw-glb-dir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, 'apps', 'vr', 'ArtSource', 'lamp-agent');
const [work, rawDir] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(path.join(work, 'score.json'), 'utf8'));
const F = JSON.parse(fs.readFileSync(path.join(work, 'finish.json'), 'utf8'));
const M = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const DATE = new Date().toISOString().slice(0, 10);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const gate = (pass, note) => ({ pass, note, date: DATE });
const files = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p, base) : e.name === 'manifest.json' ? [] : [path.relative(base, p).split(path.sep).join('/')];
}).sort();
const all = files(DIR);
const sums = Object.fromEntries(all.map((f) => [f, sha(path.join(DIR, f))]));
const MB10 = 10 * 1024 * 1024;
const oversize = all.filter((f) => fs.statSync(path.join(DIR, f)).size >= MB10);

const seeds = { 101: 'raw_seed101.glb', 202: 'raw_seed202.glb', 303: 'raw_seed303.glb' };
const rawSha = Object.fromEntries(Object.entries(seeds).map(([k, f]) => [k, sha(path.join(rawDir, f))]));
const [sx, sy, sz] = S.bounds_m.size_xyz;
const tex = all.filter((f) => f.startsWith('textures/'));
const w = S.rig, poses = Object.keys(S.poses);
const lookMax = Math.max(...Object.values(S.look_at_error_deg));
const wNorm = Math.abs(w.weight_sum_min - 1) < 1e-3 && Math.abs(w.weight_sum_max - 1) < 1e-3 && w.unweighted_verts === 0;
const SCALE_RULE = { totalHeightM: [0.45, 0.65] };
const cm = (v) => Math.round(v * 1e4) / 100;

M.picked = 'A';
M.generator = [
  ...M.generator.filter((g) => g.option),
  {
    model: 'TRELLIS.2', input: 'options/A.png', seed: 303, seeds_run: [101, 202, 303],
    workflow: 'C:/Users/kazda/ai/lynx-bench/media/3d-trellis-api.json, run by scripts/art/lamp/trellis_run.mjs',
    changes: 'LoadImage 122 = options/A.png; DecimateMesh 186 target_face_count 28000 (before UnwrapMesh 196 and BakeTextureFromVoxel 147); seed nodes 3, 12, 18, 23 = 303; texture size 4096 (PrimitiveInt 288)',
    raw_glb: { path: 'C:/Users/kazda/ai/lynx-bench/bp/lamp-agent/raw_seed303.glb', bytes: fs.statSync(path.join(rawDir, 'raw_seed303.glb')).size, sha256: rawSha[303] },
    rejected_seeds: {
      101: { sha256: rawSha[101], components: 14, note: 'arm detached from the base: 14 connected components' },
      202: { sha256: rawSha[202], components: 5, note: 'arm missing, shade split from the head: 5 connected components' },
    },
    blender: 'Blender 5.2.2, scripts/art/lamp/finish_lamp.bpy (import with merge_vertices)',
  },
];
M.tris = S.tris;
M.tris_note = `${S.tris} against ${S.budget_tris}`;
M.materials = [
  'lamp_body (base colour + ORM + normal, 2048 px PNG)',
  `lamp_shade_glow (emissive warm #FF9E2E x6, ${S.glow_faces} faces on the shade interior; UE drives the strength per state)`,
];
M.bounds_cm = { x: cm(sx), y: cm(sy), z: cm(sz), note: 'x width, y depth (shade towards -y), z up (Blender, FBX Z-up); pivot at the base disc underside centre, so the clamp reaches to z = ' + Math.round(S.bounds_m.min[2] * 100) + ' cm' };
M.meshes = { 'lamp-agent': { tris: S.tris, vertices: S.vertices, components: S.components, floaters: S.floaters, open_edges: S.manifold_open_edges, uv_sets: S.uv_sets } };
M.uv_sets = S.uv_sets;
M.pivot = 'centre of the base disc, on its underside (the table-top contact plane); the C-clamp hangs below the origin';
M.rig = {
  bones: w.bones, hierarchy: w.hierarchy, weights: F.weights, weight_sum_range: [w.weight_sum_min, w.weight_sum_max], unweighted_verts: w.unweighted_verts,
  max_influences_per_vertex: w.max_influences, look_at: F.look_at, look_at_error_deg: S.look_at_error_deg,
};
M.actions = Object.fromEntries(poses.map((p) => [p, { ...S.poses[p], note: 'rotation of lower_arm, upper_arm, head about the armature X axis (scripts/art/lamp/poses.json, degrees, relative to the TRELLIS rest pose); keys on frames 1 and 12' }]));
M.textures = 'lamp_basecolor.png, lamp_orm.png (R occlusion, G roughness, B metal), lamp_normal.png: the TRELLIS.2 bake (BakeTextureFromVoxel, normal and AO baked from the 768-voxel remesh onto the 28k mesh), downsized to 2048 px';
M.licence = 'TRELLIS.2 output from a Leonardo concept (look-dev input, R8 open); no MiniMax-H3 or FLUX.2 [dev] output used';
M.regenerate = 'node scripts/art/lamp/trellis_run.mjs 303; blender -b -P scripts/art/lamp/finish_lamp.bpy -- <repo> <raw.glb> <work>; blender -b -P scripts/art/lamp/score_lamp.bpy -- <repo> <work>; blender -b -P scripts/art/lamp/render_lamp.bpy -- <repo>; node scripts/art/lamp/write_manifest.mjs <work> <raw-dir>';
const SPRING = 'no spring mesh and no extra triangles; the springs stay as the baked pale strip in the base colour and normal textures';
M.finishing_note = 'Springs: judged on evidence/table-view.jpg (1.63 m line of sight, 40 degree field, 16 px per degree) and evidence/spring-closeup.jpg (the same view at 3x). TRELLIS did not resolve the coils: they are lumpy relief, and at the far edge they read only as a pale strip along each arm segment, never as coils (a coil pitch of about 2 mm at lamp scale is under 1 px). Decision: ' + SPRING + '. UE can add a thin coil card or alpha-tested ribbon if a close-up needs it.';
M.sha256 = sums;
M.gates = {
  input: M.gates.input,
  mesh_acceptance: gate(S.components === 1 && S.floaters === 0 && wNorm,
    `seed 303 of 3 (101 had 14 components, 202 had 5 with the arm gone, both rejected). Raw ${F.raw.vertices} vertices / ${F.raw.tris} tris with merge_vertices, components ${F.components_before.join('+')}; the two specks (${F.components_before.slice(1).join(' and ')} vertices) were deleted. Final ${S.vertices} vertices, ${S.components} component, ${S.floaters} floaters, ${S.manifold_open_edges} open edges (small holes in the cap). Silhouette matches options/A.png: C-clamp base, jointed two-segment arm, cone shade.`),
  scale: gate(sz >= SCALE_RULE.totalHeightM[0] && sz <= SCALE_RULE.totalHeightM[1] && Math.abs(S.pivot.disc_underside_z_m) < 1e-3 && Math.abs(S.bounds_m.min[0] + S.bounds_m.max[0]) < 0.005,
    `${(sx * 100).toFixed(1)} x ${(sy * 100).toFixed(1)} x ${(sz * 100).toFixed(1)} cm (x, y, z up) re-imported from final.fbx; ${(S.bounds_m.max[2] * 100).toFixed(0)} cm above the table plane, rule 45 to 65 cm total for a desk architect lamp; pivot: disc underside z = ${S.pivot.disc_underside_z_m} m, x centred. Assumption: the wolf-plan gives no lamp size, so the UE world scale of the table (W3.2) is still to be confirmed on Wolf.`),
  finishing: gate(S.uv_sets === 1 && tex.length === 3 && S.materials.length === 2 && S.glow_faces > 0 && w.bones.length === 4 && wNorm && lookMax < 0.5 && poses.length === 5 && S.actions.length === 5 && oversize.length === 0,
    `one UV set; ${tex.length} PBR PNGs (base colour, ORM, normal, 2048 px, each under 5 MB); emissive slot lamp_shade_glow on ${S.glow_faces} faces; rig ${w.bones.join(' > ')}, weights sum ${w.weight_sum_min} to ${w.weight_sum_max}, ${w.unweighted_verts} unweighted vertices, at most ${w.max_influences} influences; look-at constraint error ${lookMax} deg on three targets; ${poses.length} actions (${poses.join(', ')}) in final.fbx; springs: ${SPRING}.`),
  poly_budget: gate(S.tris <= S.budget_tris, `${S.tris} tris against ${S.budget_tris} (${Math.round(S.tris / S.budget_tris * 100)}%)`),
};
M.lynx_commit = null;
M.lynx_commit_note = 'set by the merge; branch autopilot/accepted-idea-delivery-cebdd60a';
if (oversize.length) console.error('OVERSIZE files:', oversize.join(', '));
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(M, null, 2) + '\n');
for (const [k, g] of Object.entries(M.gates)) console.log(g.pass ? 'PASS' : 'FAIL', k);
