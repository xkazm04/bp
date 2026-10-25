// Fills apps/vr/ArtSource/lamp-agent/manifest.json (the build stage) for the scripted lamp agent of 2026-10-24: the
// measurements come from score_agent.bpy (<work>/score.json, read back from final_working.glb and final.fbx) and
// build_agent.bpy (<work>/build.json: part triangles, bake figures); gate results are derived from them, never typed in.
// The concept fields (the turnaround options) and the decision (picked, the input gate) belong to the other stages.
//   node scripts/art/lamp/write_manifest.mjs <work-dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argsOrUsage, cm, folderDir, gate, inventory, readManifest, writeStage } from '../lib/manifest-kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [work] = argsOrUsage(1, 'node scripts/art/lamp/write_manifest.mjs <work-dir>');
const S = JSON.parse(fs.readFileSync(path.join(work, 'score.json'), 'utf8'));
const B = JSON.parse(fs.readFileSync(path.join(work, 'build.json'), 'utf8'));
const POSES = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'art', 'lamp', 'agent_poses.json'), 'utf8'));
const M = readManifest(ROOT, 'lamp-agent');
const { files: all, oversize } = inventory(folderDir(ROOT, 'lamp-agent'));

if (!M?.picked || !(M.generator_options ?? []).some((g) => g.option === M.picked)) {
  console.error(`lamp-agent: no recorded pick among the concept options (${(M?.generator_options ?? []).map((g) => g.option).join(', ')}); record it with scripts/art/record-pick.mjs first`);
  process.exit(2);
}
const BUDGET = M.budget_tris;
const SLOTS = ['agent_shell', 'agent_hood_inner', 'agent_joint', 'agent_glow', 'agent_glow_card'];
const BONES = ['body', 'head', 'arm_l_upper', 'arm_l_lower', 'arm_r_upper', 'arm_r_lower'];
const PARTS = Object.keys(B.part_tris).length;           // closed parts (each one loose piece), plus the glow card
const [sx, sy, sz] = S.bounds_m.size_xyz;
const RS = B.rest;                                       // rest pose: pin tip to hood top, hood and body widths
const actions = S.actions.map((a) => a.split('|').pop()).sort();
const tex = all.filter((f) => f.startsWith('textures/'));
const ev = all.filter((f) => f.startsWith('evidence/'));

const O = {};
O.generator = [{
  method: 'scripted Blender build, no image-to-3D: scripts/art/lamp/build_agent.bpy (Blender 5.2.2 arm64, bpy, headless)',
  reference: `the picked concept option ${M.picked} and the turnaround in options/, matched by eye in evidence/target-compare.jpg against reference/target-crop.png`,
  why_not_trellis: 'The figure is about 15 rounded primitives (a hood cup, an orb, a cone, capsules, balls, wire loops). The 2026-10-21 TRELLIS.2 run of the old lamp needed 3 seeds (two lost or split the arm), left 26 open edges and a ragged per-face glow edge, and its texture was thrown away; thin arms and a 1 mm wire loop are what image-to-3D fuses or drops. A script gives exact rigid parts per bone, a clean separate emissive orb and a unique UV for the AO bake. TRELLIS.2 was therefore not run for this build (research r1, r2 and r5 of 2026-10-24 expect the same).',
}];
O.tris = S.tris;
O.tris_note = `${S.tris} against ${BUDGET} (static working pose; the rigged final.fbx carries the same ${S.fbx_tris})`;
O.materials = [
  `agent_shell: white clear-coat plastic (hood outside and its rolled lip, body cone, arm capsules, the wire loops); base colour 0.80/0.79/0.77 linear, roughness 0.35 with a smudge-noise breakup of ±${B.breakup.agent_shell.roughness_pm} (albedo ±${B.breakup.agent_shell.albedo_pm * 100} %) baked into ORM.G, clear coat 1.0 at roughness 0.08 (r4: albedo about 0.8, a second specular lobe)`,
  `agent_hood_inner: the inside of the hood, the concept's dark glossy bowl round the orb; base 0.035/0.03/0.026 linear, roughness 0.12 ±${B.breakup.agent_hood_inner.roughness_pm} (baked), clear coat; no self-glow in the bake. UE: roughness from ORM.G (or the Roughness parameter at 0.12), GlowStrength x 0.15 adds the warm bounce`,
  `agent_joint: dark metal joint hardware (axle drums with caps and domed screw heads at shoulder, elbow and wrist; shoulder brackets; collar rings at the capsule ends; neck rings and collar; the cable); #3A3D42, roughness 0.38 ±${B.breakup.agent_joint.roughness_pm}, metal 1`,
  'agent_glow: amber emissive orb in the hood, the front slit and the pin; #FFA94D x3 (UE drives GlowStrength per state)',
  'agent_glow_card: the additive card in the hood opening, textures/agent_glow_card.png (radial falloff, white on black) tinted by the glow colour; UE: unlit additive, two-sided, no depth write',
];
O.material_slots = S.slots;
O.slot_tris = S.slot_tris;
O.textures = `${tex.join(', ')}: agent_basecolor.png (diffuse colour bake, sRGB) and agent_orm.png (R ambient occlusion, G roughness, B metal; linear), ${B.ao.px} px, baked with Cycles on the CPU at ${B.ao.samples} samples in ${B.bake_seconds} s (AO mean ${B.ao.mean}, self-occlusion only: hood over orb and collar, joints into capsules, the seam grooves). ORM.G carries the roughness breakup. No normal map: seams, lip, drums and screws are real geometry with smooth shading. agent_glow_card.png 256 px. UE: BaseColor x lerp(1, AO, 0.6), because the forward path's SSAO is weak and there is no reflection capture (r4); the Blender materials of final.fbx are wired that way.`;
O.bounds_cm = { x: cm(sx), y: cm(sy), z: cm(sz), note: `final_working.glb in Blender axes (x width, y depth with the figure facing -y, z up), WORKING pose: the right arm hangs below the pin tip and the left arm reaches 22 cm out to +x and 14 cm forward, so the box is not centred; rest pose height pin tip to hood top ${cm(RS.height_m)} cm` };
O.meshes = { 'lamp-agent': { tris: S.tris, vertices: S.vertices_welded, loose_parts: S.loose_parts, open_edges: S.open_edges, uv_sets: S.uv_sets, note: `${PARTS} rigid parts plus the glow card (a single quad, whose 4 boundary edges are the open edges)` } };
O.uv_sets = S.uv_sets;
O.pivot = 'the tip of the pin under the body (rest pose z = 0), on the body axis (x = y = 0); the figure hovers, so placement sets the pivot height above the table';
O.axes = 'Blender Z up, the figure faces -Y (the hood opening looks -Y and 40 degrees down). glTF (final_working.glb) is Y-up with the figure facing +Z; UE Interchange turns either into Z-up with the figure facing UE +Y (as the old lamp-agent FBX landed: Blender -Y onto UE +Y). Yaw it 90 degrees less than "facing +X" needs; check one frame.';
O.rig = {
  bones: S.bones, hierarchy: S.hierarchy, weights: `rigid: every vertex weight 1.0 to the one bone of its part (one rigid part per bone), except the cable's ${B.cable.verts} vertices, blended body -> arm_r_upper along its length (smoothstep) so a pose bends it instead of tearing it`,
  max_influences_per_vertex: S.max_influences, blended_verts: S.blended_verts, unweighted_verts: S.unweighted_verts,
  contract_change: 'The 2026-10-21 contract was base > lower_arm > upper_arm > head (one arm, a desk lamp). The target character has two arms, so the contract is now body > head, body > arm_l_upper > arm_l_lower, body > arm_r_upper > arm_r_lower; arm_l is the figure\'s left (+X, the viewer\'s right). The UE AnimBP aims the head bone, as before.',
};
O.actions = Object.fromEntries(actions.map((a) => [a, { degrees: POSES.poses[a], note: 'rotations about the armature axes at each bone head (scripts/art/lamp/agent_poses.json), keys on frames 1 and 12' }]));
O.static_pose = POSES.static_pose;
O.regenerate = 'blender -b --factory-startup -P scripts/art/lamp/build_agent.bpy -- <repo> <work>; blender -b --factory-startup -P scripts/art/lamp/render_agent.bpy -- <repo> <work>; blender -b --factory-startup -P scripts/art/lamp/score_agent.bpy -- <repo> <work>; node scripts/art/lamp/write_manifest.mjs <work>  (Blender takes Windows paths; the bakes run on the CPU, the renders on the GPU with EEVEE). The concept views came from node scripts/lookdev/leonardo.mjs gen --prop lamp-agent --variant <E|F|G|H> (spends credits; see generator_options)';
O.licence = 'Our own scripted geometry, materials and bakes (Blender is a GPL tool; its output is ours). No generated pixels or geometry are shipped: the Leonardo turnaround is modelling reference only.';
O.placement = {
  ue_choice: 'place final_working.glb as a STATIC mesh (5 sections = 5 draws, no skinning) for the capture; keep final.fbx (skeletal, 6 bones, 4 actions) for L5.7 states. The old SK_LampAgent placement drew 6 sections.',
  where: `hovering above the far edge of the table, centred a little left of the table centre, the hood facing the player (a yaw so the figure's -Y looks at the camera); in the 1600 x 900 target capture the head sits in the upper third, at about 46 % of the width, the hood about 7.6 % of the frame width across (the target crop: 1376 x 768 frame, hood centre at x = 645, y = 55, hood about 105 px wide). The target pose's frame top is only 1.6 degrees below its eye (43 cm over the table top, pitch -31, hfov 90), so the hood top must stay under the eye: with the figure about 103 cm in front of the eye, scale 1.05 and the pin tip 12.8 cm over the table put the hood top 3 % below the frame top, the orb centre 10 % down and the hood 7.6 % across (at scale 1.2 the pin tip goes to 9.3 cm). Working-pose hood top: ${cm(B.working.top_z_m)} cm over the pin tip`,
  light: 'a warm point light inside the hood, just in front of the orb (build.json orb_centre_rest_m + 4.5 cm along open_axis, carried by the head bone), about #FFA85A, small source radius, short attenuation (about 40 cm) so it lights the hood inside, the body top and the arms, plus the card; and a faint cool rim from behind so the white silhouette separates from the dark room (r5: the old lamp dissolved into the background)',
  orb_centre_rest_m: B.orb_centre_rest_m, open_axis: B.open_axis,
  working_pose: { orb_centre_m: B.working.orb_centre_m, open_axis: B.working.open_axis, light_m: B.working.light_m, note: 'the static working pose (final_working.glb), Blender axes: the orb centre, the opening axis and the warm light 4.5 cm in front of the orb' },
};
const rigOk = JSON.stringify(S.bones) === JSON.stringify(BONES) && S.max_influences <= 2 && S.blended_verts <= B.cable.verts && S.unweighted_verts === 0 && actions.length === 4;
const slotsOk = SLOTS.every((s) => S.slots.includes(s)) && S.slots.length === SLOTS.length && S.slot_tris.agent_glow > 0;
const evOk = ['evidence/target-compare.jpg', 'evidence/turnaround.jpg', 'evidence/poses.jpg'].every((f) => ev.includes(f));
O.gates = {
  mesh_acceptance: gate(S.loose_parts === PARTS + 1 && S.open_edges === 4 && S.fbx_tris === S.tris && rigOk,
    `scripted, so acceptance is the build's own structure: ${S.loose_parts} loose parts (${PARTS} rigid parts, each closed, plus the 1-quad glow card), ${S.open_edges} open edges (the card's border, nothing else), the same ${S.tris} triangles in final_working.glb and final.fbx; silhouette against the target in evidence/target-compare.jpg (hood head with a glowing orb, tapered cone body with slit and pin, two jointed arms ending in loops, one reaching sideways, one hanging)`),
  scale: gate(RS.height_m >= 0.2 && RS.height_m <= 0.32 && Math.abs(RS.min_z_m) < 1e-3 && RS.hood_width_m >= 0.11 && RS.hood_width_m <= 0.15,
    `rest height (pin tip to hood top, body and head) ${cm(RS.height_m)} cm, pin tip z ${RS.min_z_m} m (the pivot), hood ${cm(RS.hood_width_m)} cm across, body cone ${cm(RS.body_top_width_m)} cm wide at the top (rule: 20 to 32 cm tall, hood 11 to 15 cm); working-pose box ${cm(sx)} x ${cm(sy)} x ${cm(sz)} cm. Sized from the target: the hood is about 105 px of the 1376 px frame where the far edge of a table about 1.2 m wide spans about 1200 px, so about 11 to 14 cm; the decision card beside it is about 28 cm. The UE builder may scale uniformly (the rig is rigid).`),
  finishing: gate(S.uv_sets === 1 && tex.length === 3 && slotsOk && evOk && oversize.length === 0,
    `one UV set (smart project over every part, the card on its own 0-1); ${tex.length} PNGs (AO, roughness and metal in ORM, a diffuse-colour base, the glow card); ${S.slots.length} slots (${S.slots.join(', ')}): the orb is its own sphere with a clean edge (no texture mask), the glow card has its own slot; panel seams (${(B.seams ?? '0.6 mm grooves')}) round a front panel on the body and round the hood, a rolled half-round hood lip, axle drums with caps and screw heads at every joint, bevels on the collar, rings, slit and drums, smooth shading with weighted normals on the joints; rig ${S.bones.join(', ')} rigid, ${actions.length} actions (${actions.join(', ')}); evidence rendered with EEVEE under a dark studio rig (cool table light from below, warm point light inside the hood, warm practical, cool rim) with a bloom pass and no depth of field; every file under 10 MB`),
  poly_budget: gate(S.tris <= BUDGET, `${S.tris} tris against ${BUDGET} (${Math.round(S.tris / BUDGET * 100)} %): hood ${B.part_tris.hood}, orb ${B.part_tris.orb}, body ${B.part_tris.body}, each arm ${Object.entries(B.part_tris).filter(([k]) => k.endsWith('_l')).reduce((n, [, t]) => n + t, 0)} (hardware included), cable ${B.part_tris.cable}`),
};
if (oversize.length) console.error('OVERSIZE files:', oversize.join(', '));
const written = writeStage(ROOT, 'lamp-agent', 'build', O);
let bad = 0;
for (const [k, g] of Object.entries(written.gates)) { console.log(g.pass ? 'PASS' : 'FAIL', k); if (!g.pass) bad++; }
process.exit(bad ? 1 : 0);
