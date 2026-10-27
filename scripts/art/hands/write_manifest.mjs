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
    method: `MakeHuman base mesh and default rig through the MPFB 2.0.18 Blender extension (scripts/art/hands/build_hands.bpy): fingers and wrists posed with the rig, armature and helper mask applied, the hand and lower forearm kept per side; a high-poly copy (subdivided ${H.detail.L.hi_faces} faces per hand) displaced by script from the posed finger bones (joint and knuckle wrinkle lines, raised nail plates with their grooves, veins on the back of the hand: ${H.detail.L.height_mm[0]} to ${H.detail.L.height_mm[1]} mm) and baked onto the low mesh's own ${H.atlas.px} px atlas (albedo, normal, ORM); a scripted knit sleeve with a closed rolled cuff, ribbing and compression folds, running ${cm(H.sleeve_len_m)} cm up the arm so no end is in frame; a smartwatch on the left wrist; each side scaled ${H.hand_scale}, moved rigidly into the capture frame and dropped until its lowest fingertip rests on the paper`,
    mpfb: { version: '2.0.18', zip: 'https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip', sha256: 'c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad' },
    skin_source_note: 'the MakeHuman albedo is sampled through its own UVs and re-baked (tinted by the detail fields) into textures/hands_skin_albedo.png on the new atlas',
    skin: { pack: 'https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip', pack_sha256: 'b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107', file: 'skins/young_caucasian_male/young_lightskinned_male_diffuse.png (2048 px), the bake source of textures/hands_skin_albedo.png' },
  }],
  licence: 'CC0. The MakeHuman base mesh, rig and targets: "All core assets (the base mesh, targets, skins...) are shared under CC0" (MPFB FAQ, https://static.makehumancommunity.org/mpfb/faq/can_i_sell_models.html, read 2026-10-24). The skin: the asset pack page lists it CC0 (https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) and its .mhmat says "This asset was explicitly released as CC0 in september 2020". The MPFB add-on code is GPL-3.0-or-later; it is a tool here, none of its code is shipped. The sleeve and the posing are our own.',
  tris: H.tris,
  tris_note: `${total} for the pair against ${BUDGET}`,
  materials: [
    `hands_skin: textures/hands_skin_albedo.png (sRGB), hands_skin_normal.png (tangent, OpenGL/glTF: UE flips green on import or set the texture's flip green) and hands_skin_orm.png (R 1, G roughness ${H.rough_range ? H.rough_range.join(' / ') : ''} at the 5th/50th/95th percentile: glossy nails, drier creases; B 0) on the new atlas (one UV set, ${H.atlas.px_per_m} px/m). UE: Preintegrated Skin or the Substrate wrap SSS (import_hands.py), roughness from ORM.G, specular 0.35`,
    'hands_sleeve: dark charcoal knit, #030304 linear about 0.013, roughness 0.92, sheen 0.4 (UE: Cloth shading model with fuzz colour #2A2D33, or Default Lit at roughness 0.95); folds, ribbing and the rolled cuff are geometry',
    'hands_watch (left mesh only): near-black glossy, linear 0.010/0.011/0.013, roughness 0.22, metallic 0.3, clear coat 0.6: band, case and glass face in one slot (UE: a new M_HandsWatch, see import_hands.py)',
  ],
  material_slots: H.slots,
  uv_sets: 1,
  textures: H.textures,
  atlas: H.atlas,
  detail: H.detail,
  watch: H.watch,
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
    mesh_acceptance: gate(Object.keys(H.tris).length === 2 && H.slots.length === 3 && H.min_z_m >= 0 && H.min_z_m < 0.003, `two meshes (hand_l ${H.tris.hand_l}, hand_r ${H.tris.hand_r} tris), each the MakeHuman hand and lower forearm (helpers and joint cubes removed by MPFB's own mask) joined with its closed-cuff sleeve, the left with its watch; slots ${H.slots.join(', ')}; lowest skin point ${cm(H.min_z_m)} cm over the paper (fingertips rest on it)`),
    scale: gate(lens.every((l) => l > 0.16 && l < 0.21) && radii.every((r) => r > 0.022 && r < 0.036), `wrist joint to farthest fingertip ${lens.map((l) => cm(l)).join(' and ')} cm (adult hand about 17 to 20 cm; the MakeHuman default adult scaled ${H.hand_scale}, a large adult), forearm radius at the cuff ${radii.map((r) => cm(r)).join(' and ')} cm`),
    finishing: gate(['albedo', 'normal', 'orm'].every((k) => all.includes(`textures/hands_skin_${k}.png`)) && ev.includes('evidence/target-compare.jpg') && oversize.length === 0, `skin albedo, normal and ORM at ${H.atlas.px} px baked from the displaced high poly (${H.atlas.px_per_m} px/m), sleeves with a closed rolled cuff and folds, smooth shading; evidence: the EEVEE check render beside the target (evidence/target-compare.jpg) and a close look (evidence/closeup.png); every file under 10 MB`),
    poly_budget: gate(total <= BUDGET, `${total} tris for the pair against ${BUDGET}`),
  },
};
const written = writeStage(ROOT, 'hands-capture', 'build', O);
let bad = 0;
for (const [k, g] of Object.entries(written.gates)) { console.log(g.pass ? 'PASS' : 'FAIL', k); if (!g.pass) bad++; }
process.exit(bad ? 1 : 0);
