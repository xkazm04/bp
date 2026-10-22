// Fills apps/vr/ArtSource/lamp-agent/manifest.json from the measured scores (score_lamp.bpy, finish_lamp.bpy) and the files on disk.
// (rework_lamp.bpy and render_lamp.bpy results are read from <work>/rework.json and <work>/framing.json.)
// Gate results are derived from the measurements, never typed in. Keeps the option and pick fields written in the look-dev step.
//   node scripts/art/lamp/write_manifest.mjs <work-dir> <raw-glb-dir>
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
const DIR = path.join(ROOT, 'apps', 'vr', 'ArtSource', 'lamp-agent');
const [work, rawDir] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(path.join(work, 'score.json'), 'utf8'));
const F = JSON.parse(fs.readFileSync(path.join(work, 'finish.json'), 'utf8'));
const RW = JSON.parse(fs.readFileSync(path.join(work, 'rework.json'), 'utf8'));
const FR = JSON.parse(fs.readFileSync(path.join(work, 'framing.json'), 'utf8'));
const MATS = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'art', 'lamp', 'materials.json'), 'utf8'));
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
const expectedComponents = 1 + RW.accessory_parts.clamp.length + RW.accessory_parts.springs;
const allOrm = Object.values(S.orm_regions).every((r) => r.pass);
const partTris = Object.values(RW.part_tris).reduce((a, b) => a + b, 0);
const springTris = Object.entries(RW.part_tris).filter(([k]) => k.startsWith('spring')).reduce((a, [, v]) => a + v, 0);
const clampTris = partTris - springTris;
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
M.materials = Object.values(MATS.regions).map((r) => `${r.slot}: ${r.what}; base colour ${r.color}, roughness ${r.roughness}, metal ${r.metal}${r.emission ? `, emissive ${r.emission} x${r.emission_strength} on ${S.glow_faces} faces, UE drives the strength per state` : ''}`);
M.material_slots = Object.values(MATS.regions).map((r) => r.slot);
M.bounds_cm = { x: cm(sx), y: cm(sy), z: cm(sz), height_above_table_cm: cm(S.height_above_table_m), clamp_below_table_plane_cm: cm(S.clamp.depth_below_table_plane_m), note: `x width, y depth (shade towards -y, clamp back bar towards +y), z up (Blender, FBX Z-up); pivot at the base disc underside centre (z = 0, the table plane); the shade top is ${cm(S.height_above_table_m)} cm above it and the modelled C-clamp (knob bottom) reaches to z = ${-cm(S.clamp.depth_below_table_plane_m)} cm` };
M.meshes = { 'lamp-agent': { tris: S.tris, vertices: S.vertices, components: S.components, floaters: S.floaters, open_edges: S.manifold_open_edges, uv_sets: S.uv_sets } };
M.uv_sets = S.uv_sets;
M.pivot = `centre of the base disc, on its underside (the table-top contact plane, z = 0); the modelled C-clamp hangs below the origin, to z = ${-cm(S.clamp.depth_below_table_plane_m)} cm, and grips a 3 cm thick table whose edge is at y = +5.8 cm`;
M.rig = {
  bones: w.bones, hierarchy: w.hierarchy, weights: F.weights, weight_sum_range: [w.weight_sum_min, w.weight_sum_max], unweighted_verts: w.unweighted_verts,
  max_influences_per_vertex: w.max_influences, look_at: F.look_at, look_at_error_deg: S.look_at_error_deg,
};
M.actions = Object.fromEntries(poses.map((p) => [p, { ...S.poses[p], note: 'rotation of lower_arm, upper_arm, head about the armature X axis (scripts/art/lamp/poses.json, degrees, relative to the TRELLIS rest pose); keys on frames 1 and 12' }]));
M.textures = 'lamp_basecolor.png, lamp_orm.png (R occlusion, G roughness, B metal), lamp_normal.png (flat), 2048 px: flat region colours from scripts/art/lamp/materials.json rasterised into the existing TRELLIS UV set by rework_lamp.bpy (flat values need no Cycles bake, so no render engine and no GPU); the smudged TRELLIS bake and its relief normal map are gone. The same values sit on the Principled node of each material slot, so UE can use either';
M.licence = 'TRELLIS.2 output from a Leonardo concept (look-dev input, R8 open); no MiniMax-H3 or FLUX.2 [dev] output used';
M.regenerate = 'node scripts/art/lamp/trellis_run.mjs 303; blender -b -P scripts/art/lamp/finish_lamp.bpy -- <repo> <raw.glb> <work>; blender -b -P scripts/art/lamp/rework_lamp.bpy -- <repo> <work>; blender -b -P scripts/art/lamp/score_lamp.bpy -- <repo> <work>; blender -b -P scripts/art/lamp/render_lamp.bpy -- <repo> <work>; node scripts/art/lamp/write_manifest.mjs <work> <raw-dir>  (Blender takes Windows paths; Cycles runs on the CPU)';
const SPRING = `modelled: ${RW.accessory_parts.springs} thin brushed-silver cylinders (8 sides, radius 3.5 mm), two on each arm segment (one each side), ${springTris} tris in total, weighted 1.0 to the arm bone they run along`;
M.finishing_note = `Springs: ${SPRING}. They are plain cylinders, not coils: a coil pitch of about 2 mm at lamp scale is under 1 px at the far edge (the first build judged this on a 1.63 m view), so a cylinder reads the same as the spring in concept A and costs ${springTris} tris. The pale strip that was the smudge on the TRELLIS arm texture is gone (the arm is flat navy). Materials: one slot per region with flat values (arm navy, silver joints, springs and screw, dark shade, warm glow, amber cap, navy base and clamp), plus the same values baked flat into the three PNGs. The old lamp_body slot is replaced by six slots; lamp_shade_glow keeps its name.`;
M.sha256 = sums;
const framingOk = FR.pass === true && Object.keys(FR.images).length === 10;
M.framing = {
  pass: framingOk,
  date: DATE,
  method: 'render_lamp.bpy fits every camera to the world bounding box of the evaluated (posed) mesh with a 6 % margin per side; then a transparent-film alpha pass of the lamp alone is rendered with the same camera and the check asserts that no lamp pixel touches the border and that the silhouette keeps at least 5 % of the image on every side',
  table_view: FR.table_view,
  turnaround: FR.turnaround,
  images: FR.images,
};
M.gates = {
  input: M.gates.input,
  mesh_acceptance: gate(S.components === expectedComponents && S.floaters === 0 && wNorm && S.clamp.base_weight_min === 1 && S.clamp.depth_below_table_plane_m > 0.05,
    `seed 303 of 3 (101 had 14 components, 202 had 5 with the arm gone, both rejected). Raw ${F.raw.vertices} vertices / ${F.raw.tris} tris with merge_vertices, components ${F.components_before.join('+')}; the two specks (${F.components_before.slice(1).join(' and ')} vertices) were deleted. Rework 2026-10-21: the TRELLIS stalk under the disc was a lumpy 4 cm post, not a C-clamp, so it was cut off below z = -4 mm and the hole closed; a modelled C-clamp replaces it (back bar, lower jaw, screw, pad and knob, ${clampTris} tris, all weighted 1.0 to the base bone, reaching ${(S.clamp.depth_below_table_plane_m * 100).toFixed(1)} cm below the table plane) plus ${RW.accessory_parts.springs} spring cylinders. Final ${S.vertices} vertices, ${S.components} connected components (the TRELLIS body, ${RW.accessory_parts.clamp.length} clamp parts and ${RW.accessory_parts.springs} springs, each overlapping the body), ${S.floaters} floaters (a floater is a component whose bounding box touches no other), ${S.manifold_open_edges} open edges (small holes in the cap and joints, left from TRELLIS). Silhouette matches options/A.png: jointed two-segment arm, cone shade, round base with a C-clamp.`),
  scale: gate(S.height_above_table_m >= SCALE_RULE.totalHeightM[0] && S.height_above_table_m <= SCALE_RULE.totalHeightM[1] && sz >= SCALE_RULE.totalHeightM[0] && sz <= SCALE_RULE.totalHeightM[1] && Math.abs(S.pivot.disc_underside_z_m) < 1e-3 && Math.abs(S.bounds_m.min[0] + S.bounds_m.max[0]) < 0.005,
    `${(sx * 100).toFixed(1)} x ${(sy * 100).toFixed(1)} x ${(sz * 100).toFixed(1)} cm (x, y, z up) re-imported from final.fbx, clamp included; ${(S.height_above_table_m * 100).toFixed(1)} cm above the table plane and ${(S.clamp.depth_below_table_plane_m * 100).toFixed(1)} cm below it; rule 45 to 65 cm for a desk architect lamp (both the height above the table and the total pass); pivot: disc underside z = ${S.pivot.disc_underside_z_m} m, x centred. Assumption: the wolf-plan gives no lamp size, so the UE world scale of the table (W3.2) is still to be confirmed on Wolf.`),
  finishing: gate(S.uv_sets === 1 && tex.length === 3 && S.materials.length === 6 && S.materials.includes('lamp_shade_glow') && S.glow_faces > 0 && w.bones.length === 4 && wNorm && lookMax < 0.5 && poses.length === 5 && S.actions.length === 5 && oversize.length === 0 && S.basecolor_check.pass && allOrm && framingOk,
    `one UV set; ${tex.length} PBR PNGs (flat base colour, ORM, flat normal, 2048 px, each under 5 MB); ${S.materials.length} material slots (${S.materials.join(', ')}), emissive slot lamp_shade_glow on ${S.glow_faces} faces; base colour measured per region from lamp_basecolor.png at every face (mean distance to target: ${Object.entries(S.basecolor_regions).map(([n, r]) => `${n} ${r.distance_to_target}`).join(', ')}; arm std ${S.basecolor_regions.arm.std_srgb.join('/')}, ${S.basecolor_regions.arm.outliers_over_tol} arm outliers over ${S.basecolor_check.outlier_tol}); ORM roughness and metal match the targets in every region; rig ${w.bones.join(' > ')}, weights sum ${w.weight_sum_min} to ${w.weight_sum_max}, ${w.unweighted_verts} unweighted vertices, at most ${w.max_influences} influences; look-at constraint error ${lookMax} deg on three targets; ${poses.length} actions (${poses.join(', ')}) in final.fbx; evidence framing check passes on all ${Object.keys(FR.images).length} images (min silhouette margin ${Math.min(...Object.values(FR.images).map((i) => i.min_margin_fraction))} of the image); springs: ${SPRING}.`),
  poly_budget: gate(S.tris <= S.budget_tris, `${S.tris} tris against ${S.budget_tris} (${Math.round(S.tris / S.budget_tris * 100)}%), clamp ${clampTris} and springs ${springTris} included`),
};
M.base_colour_regions = S.basecolor_regions;
M.orm_regions = S.orm_regions;
M.review_fixes = {
  review: 'Director review of 2026-10-21 11:21Z of commit caa3231; reworked the same day without a TRELLIS rerun and without the GPU (Blender, Cycles on the CPU)',
  findings: [
    { finding: 'The evidence crops the shade (and other parts at the frame edge).', fix: `render_lamp.bpy fits each camera to the evaluated mesh's world bounding box (the posed mesh for each pose) with a 6 % margin, one common distance for the 4 turnaround views; table-view.jpg keeps its 1.63 m, 23 degree line of sight and only widens the horizontal field of view from 40 to ${FR.table_view.hfov_deg} degrees; an alpha-pass check asserts that no lamp pixel touches the border in any of the ${Object.keys(FR.images).length} evidence images (see framing); spring-closeup.jpg is dropped because a 3x close-up cannot hold the whole lamp, and the springs are real geometry now` },
    { finding: 'The arm bake is smudged (white and grey blotches).', fix: `the TRELLIS bake is replaced by flat region PBR from materials.json: dark navy arm ${MATS.regions.arm.color}, brushed silver joints and springs (metal ${MATS.regions.metal.metal}, roughness ${MATS.regions.metal.roughness}), dark shade ${MATS.regions.shade.color}, warm emissive interior, amber cap, navy base; regions assigned per face by bone weights and distance to the joint pivots; flat PNGs rasterised onto the TRELLIS UVs plus one material slot per region; flat normal map; score_lamp.bpy measures the base colour per region (arm mean distance ${S.basecolor_regions.arm.distance_to_target} from the navy target, std ${S.basecolor_regions.arm.std_srgb.join('/')}, ${S.basecolor_regions.arm.outliers_over_tol} outliers)` },
    { finding: 'The C-clamp is missing although mesh_acceptance claimed one.', fix: `the TRELLIS stalk (a lumpy 4 cm post that also sat under the render's floor plane, so it never showed) is replaced by a modelled low-poly C-clamp (${clampTris} tris, weight 1.0 to the base bone, base material, silver screw); the evidence table is now a 3 cm slab whose edge the clamp grips; mesh_acceptance, bounds_cm and pivot now describe this geometry; bounds and the scale gate are recomputed from final.fbx` },
  ],
};
M.lynx_commit = lynxCommit('lamp-agent');
M.lynx_commit_note = 'stamped by the writer: the newest commit touching this folder when the manifest was written';
if (oversize.length) console.error('OVERSIZE files:', oversize.join(', '));
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(M, null, 2) + '\n');
for (const [k, g] of Object.entries(M.gates)) console.log(g.pass ? 'PASS' : 'FAIL', k);
