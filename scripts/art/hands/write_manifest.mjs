// Fills apps/vr/ArtSource/hands-capture/manifest.json (the build stage; the folder has no concept or decision stage, so the
// build stands in for both) from build_hands.bpy's measurements (<work>/hands.json) and the files on disk.
//   node scripts/art/hands/write_manifest.mjs <work-dir>
// Landing order (the kit stamps lynx_commit from git, so a folder no commit touches cannot be written): commit the folder's
// files first, then run this writer, then commit the manifest; declare the folder in score-assets.mjs ENTRY_POINTS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argsOrUsage, cm, folderDir, gate, inventory, writeStage } from '../lib/manifest-kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [work] = argsOrUsage(1, 'node scripts/art/hands/write_manifest.mjs <work-dir>');
const H = JSON.parse(fs.readFileSync(path.join(work, 'hands.json'), 'utf8'));
const { files: all, oversize } = inventory(folderDir(ROOT, 'hands-capture'));
const BUDGET = 30000;   // the fidelity sprint brief: about 30k tris for the pair
const total = Object.values(H.tris).reduce((a, b) => a + b, 0);
const lens = Object.values(H.hand_length_m), radii = Object.values(H.forearm_radius_m);
const ev = all.filter((f) => f.startsWith('evidence/'));

const O = {
  id: 'hands-capture', class: 'capture-hands', budget_tris: BUDGET,
  budget_note: 'fidelity sprint brief (2026-10-24): about 30k tris for the pair; visual only, for the target capture (no tracking)',
  generator: [{
    method: 'MakeHuman base mesh and default rig through the MPFB 2.0.18 Blender extension (scripts/art/hands/build_hands.bpy): fingers and wrists posed with the rig, armature and helper mask applied, the hand and lower forearm kept per side, a scripted knit sleeve added, then each side moved rigidly into the capture frame',
    mpfb: { version: '2.0.18', zip: 'https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip', sha256: 'c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad' },
    skin: { pack: 'https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip', pack_sha256: 'b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107', file: 'skins/young_caucasian_male/young_lightskinned_male_diffuse.png (2048 px), shipped as textures/hands_skin_albedo.png' },
  }],
  licence: 'CC0. The MakeHuman base mesh, rig and targets: "All core assets (the base mesh, targets, skins...) are shared under CC0" (MPFB FAQ, https://static.makehumancommunity.org/mpfb/faq/can_i_sell_models.html, read 2026-10-24). The skin: the asset pack page lists it CC0 (https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) and its .mhmat says "This asset was explicitly released as CC0 in september 2020". The MPFB add-on code is GPL-3.0-or-later; it is a tool here, none of its code is shipped. The sleeve and the posing are our own.',
  tris: H.tris,
  tris_note: `${total} for the pair against ${BUDGET}`,
  materials: [
    'hands_skin: textures/hands_skin_albedo.png as base colour (MakeHuman UVs, one set), roughness 0.5. UE: subsurface profile or the two-sided foliage-free "wrap" SSS the forward path allows (Subsurface shading model, subsurface colour about #C8584A, opacity 0.6), roughness 0.45 to 0.55, specular 0.35; no normal map shipped (the base mesh carries the knuckle and tendon forms at this size)',
    'hands_sleeve: dark charcoal knit, #030304 linear about 0.013, roughness 0.92, sheen 0.4 (UE: Cloth shading model with fuzz colour #2A2D33, or Default Lit at roughness 0.95)',
  ],
  material_slots: H.slots,
  uv_sets: 1,
  bounds_cm: { x: cm(H.bounds_m.max[0] - H.bounds_m.min[0]), y: cm(H.bounds_m.max[1] - H.bounds_m.min[1]), z: cm(H.bounds_m.max[2] - H.bounds_m.min[2]), note: 'the pair together in the capture frame: X right, Y forward across the table, Z up (Blender); glTF is Y-up' },
  placement: {
    frame: 'capture frame: origin on the table plane at the centre of the near paper edge, X to the player\'s right, Y forward across the table, Z up; the meshes are already in it (no per-mesh transform needed beyond moving the frame onto the table)',
    pose: 'the left hand rests with relaxed fingers on the near edge of the paper, palm down; the right hand points forward and down at a room with the index finger, the other fingers curled; both forearms leave the frame at the bottom corners under dark sleeves',
    place: H.place,
    ue: 'import hands_capture.glb as two static meshes (hand_l, hand_r; 2 sections each, 4 draws), attach both to the capture pawn\'s table frame (not to the camera) at the near edge centre, yaw so +Y runs across the table; hide the SDK hands in the capture. Light them with the scene: they sit in the table\'s cool glow from below and the lamp agent\'s warm light from the far side',
  },
  regenerate: 'blender -b --command extension install-file -r user_default -e <add-on-mpfb-v2.0.18.zip> (once); blender -b -P scripts/art/hands/build_hands.bpy -- <repo> <work> <young_lightskinned_male_diffuse.png>; blender -b -P scripts/art/hands/render_hands.bpy -- <repo> <work>; node scripts/art/hands/write_manifest.mjs <work>  (no --factory-startup: MPFB must load)',
  gates: {
    input: gate(true, 'licence evidence recorded (licence field): MakeHuman core assets and the system-assets skin are CC0; MPFB is a GPL tool, not shipped'),
    mesh_acceptance: gate(Object.keys(H.tris).length === 2 && H.slots.length === 2, `two meshes (hand_l ${H.tris.hand_l}, hand_r ${H.tris.hand_r} tris), each the MakeHuman hand and lower forearm (helpers and joint cubes removed by MPFB's own mask) joined with its sleeve; slots ${H.slots.join(', ')}`),
    scale: gate(lens.every((l) => l > 0.16 && l < 0.21) && radii.every((r) => r > 0.022 && r < 0.032), `wrist joint to farthest fingertip ${lens.map((l) => cm(l)).join(' and ')} cm (adult hand about 17 to 20 cm), forearm radius at the cuff ${radii.map((r) => cm(r)).join(' and ')} cm; the MakeHuman default adult at metre scale`),
    finishing: gate(all.includes('textures/hands_skin_albedo.png') && ev.includes('evidence/target-compare.jpg') && oversize.length === 0, `skin albedo 2048 px, sleeves with a rolled cuff, smooth shading; evidence: the EEVEE check render beside the target (evidence/target-compare.jpg) and a close look (evidence/closeup.png); every file under 10 MB`),
    poly_budget: gate(total <= BUDGET, `${total} tris for the pair against ${BUDGET}`),
  },
};
const written = writeStage(ROOT, 'hands-capture', 'build', O);
let bad = 0;
for (const [k, g] of Object.entries(written.gates)) { console.log(g.pass ? 'PASS' : 'FAIL', k); if (!g.pass) bad++; }
process.exit(bad ? 1 : 0);
