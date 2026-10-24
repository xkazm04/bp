// Writes apps/vr/ArtSource/light-table-frame/manifest.json from the measured scores (build_frame.bpy -> score.json,
// render_frame.bpy -> framing.json) and the files on disk. Gate results are derived from the measurements, never typed in.
//   node scripts/art/light-table-frame/write_manifest.mjs <work-dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argsOrUsage, cm, folderDir, gate, inventory, writeStage } from '../lib/manifest-kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [work] = argsOrUsage(1, 'node scripts/art/light-table-frame/write_manifest.mjs <work-dir>');
const S = JSON.parse(fs.readFileSync(path.join(work, 'score.json'), 'utf8'));
const F = JSON.parse(fs.readFileSync(path.join(work, 'framing.json'), 'utf8'));
const { files: all, file_bytes: sizes, oversize } = inventory(folderDir(ROOT, 'light-table-frame'));
const [sx, sy, sz] = S.bounds_m.size_xyz;
const tex = all.filter((f) => f.startsWith('textures/'));
const framingOk = Object.values(F).every((v) => v.pass);
const minMargin = Math.min(...Object.values(F).map((v) => v.min_margin));
const glowSlot = S.materials.find((m) => m.includes('glow'));
const glassSlot = S.materials.find((m) => m.includes('glass'));
// The outline and strip strength build_frame.bpy was given (its defaults, 1.20 x 0.80 m and 25, for a score.json without them)
const [L, W] = S.outline_m ?? [1.2, 0.8];
const glow = S.glow_strength ?? 25;
const m2 = (x) => x.toFixed(2);
const c0 = (x) => Math.round(x * 100);
const buildArgs = S.outline_m ? ` ${m2(L)} ${m2(W)} ${glow}` : '';

const meshOk = S.mesh_objects === 1 && S.floaters === 0 && S.components >= 1 && S.glass_faces_up;
const scaleOk = Math.abs(S.edge_thickness_m - 0.03) < 1e-4 && Math.abs(S.floor_z_m) < 1e-4 && Math.abs(S.pivot_xy_centre_m[0]) < 1e-4
  && Math.abs(S.pivot_xy_centre_m[1]) < 1e-4 && Math.abs(S.top_surface_z_m - 0.95) < 1e-4;
const finishOk = S.uv_sets === 1 && tex.length === 6 && oversize.length === 0 && Boolean(glowSlot) && Boolean(glassSlot)
  && S.faces_per_slot[glowSlot] > 0 && framingOk;
const budgetOk = S.tris <= S.budget_tris;

const M = {
  id: 'light-table-frame',
  class: 'prop-hero',
  budget_tris: S.budget_tris,
  tris: S.tris,
  tris_total: S.tris,
  materials: [
    'frame_dark_metal (rim, trestle legs and rails: dark metal on the style block studio near-black #0A0F18, metal 0.85, roughness about 0.42, PBR textures)',
    'frame_aluminium (brushed aluminium #C9CDD2, PBR textures)',
    `${glowSlot} (emissive edge strip #F4FAFF, emission strength ${glow} (glTF emissive_strength), 2 cm wide and 8 mm tall on the whole ledge; UE drives the intensity)`,
    `${glassSlot} (placeholder plane, base #BFD8F0, alpha 0.15: UE replaces it with the procedural glass and paper)`,
  ],
  bounds_cm: { x: cm(sx), y: cm(sz), z: cm(sy), note: `x,z ground plane, y up (glTF); length ${c0(L)}, depth ${c0(W)}, height 95` },
  meshes: {
    'light-table-frame': {
      tris: S.tris, vertices: S.vertices, components: S.components, floaters: S.floaters, open_edges: S.open_edges,
      faces_per_slot: S.faces_per_slot,
    },
  },
  uv_sets: S.uv_sets,
  pivot: `floor centre (x and y at the middle of the ${m2(L)} x ${m2(W)} m outline, z = 0 at the feet); the table stands +Y in the GLB (glTF Y-up), +Z in Blender`,
  scale_reasoning: `Table top surface at 95 cm (wolf-plan W3.2 starts there; R4 lets the owner change it). Outline ${m2(L)} x ${m2(W)} m, a long drafting light table (the owner chose about 180 x 90 cm on 2026-10-24, spark vr-hands-zoom; the first frame was 1.20 x 0.80). The top is 3 cm thick at the outer edge because lamp-agent\'s manifest says its C-clamp grips a 3 cm table edge; the apron under the top is inset 6 cm so the clamp finds a bare edge. The rim is 5 cm wide; the glass opening is ${m2(L - 0.1)} x ${m2(W - 0.1)} m with a 2 cm ledge, and the ledge carries the emissive strip (2 cm wide, 8 mm tall, its top 6 mm under the rim top, so the 45 degree camera sees it), so the glass panel is ${m2(L - 0.14)} x ${m2(W - 0.14)} m, recessed 0.8 cm below the rim top. The legs stand 8.5 cm in from the sides and, along the length, 8.5 cm in at 1.20 m and further in as the top grows (15 cm at 1.80 m).`,
  textures: 'frame_dark_metal_* and frame_aluminium_*: 512 x 512 seamless PNG base colour, normal and ORM (R occlusion, G roughness, B metal), authored with numpy in scripts/art/light-table-frame/build_frame.bpy. Box-projected UVs in world metres, 1 uv unit = 0.4 m, repeating. Flat colour and brushed grain, no baked light. The glow and glass slots are flat colours with no texture.',
  generator: 'procedural Blender',
  blender: 'Blender 5.2.2, scripts/art/light-table-frame/build_frame.bpy (build and score), render_frame.bpy (evidence and framing check), write_manifest.mjs',
  licence: 'own procedural work; no generated input, no Leonardo, ComfyUI or TRELLIS',
  regenerate: `blender -b -P scripts/art/light-table-frame/build_frame.bpy -- <repo-root> <work>${buildArgs}; blender -b -P scripts/art/light-table-frame/render_frame.bpy -- <repo-root> <work>; node scripts/art/light-table-frame/write_manifest.mjs <work>`,
  review_fixes: {
    review: 'Director review of 04fc311 (evidence/turnaround.jpg), 2026-10-21: "the geometry is clean and cheap, but the look departs from the art bible. The table in docs/concepts/vr-light-table/lookdev/00-hero.jpg has a dark, near-black frame with a bright white emissive light strip along the glass edge. The build is warm wood and shows no visible emissive edge." Reworked the same day on the CPU only (Blender, Cycles on the CPU; no ComfyUI, TRELLIS, GPU job or external API).',
    findings: [
      {
        finding: 'The frame is warm wood; the reference has a dark, near-black frame.',
        fix: 'rim, four trestle legs and lower rails move from slot frame_wood (#B07A45) to slot frame_dark_metal on #0A0F18, the style block palette role "studio" (near-black blue; the block has no separate dark-metal value); metal 0.85, roughness about 0.42; textures/frame_dark_metal_{basecolor,normal,orm}.png (512 px, brushed grain) replace the three frame_wood_* PNGs; the aluminium feet, ledge and apron and the glass placeholder slot are unchanged',
      },
      {
        finding: 'The emissive edge does not show in the render.',
        fix: 'frame_edge_glow now covers the whole 2 cm ledge (was 1 cm) and is 8 mm tall (was 3 mm), so its top sits 6 mm under the rim top and clears the near rim wall at the 45 degree view; colour stays #F4FAFF; emission strength 25 (was 1.0), the brightest element of the evidence; the glass placeholder is 1.06 x 0.66 m to sit inside the strip',
      },
      {
        finding: 'No comparison against the art bible.',
        fix: 'render_frame.bpy writes evidence/vs-hero.jpg, the new table view beside lookdev/00-hero.jpg; turnaround.jpg and table-view.jpg re-rendered',
      },
    ],
  },
  framing: F,
  gates: {
    input: gate(true, 'procedural, no generated input (plan.md P4: the glass and paper stay procedural; operator pick: props parametric). Reference: art-breakdown.md row 1 (backlit glass table, bright white edge light, emissive frame strip, the glass blue comes from the paper material, not a tint), the Director review of 04fc311 (rim, legs and rails near-black as in lookdev/00-hero.jpg; style-block.json studio #0A0F18 is the only dark value in the block, so it is the dark metal base) and brushed aluminium feet and ledge.'),
    mesh_acceptance: gate(meshOk, `re-imported from final.glb: ${S.mesh_objects} mesh object, ${S.vertices} vertices, ${S.tris} tris, ${S.components} connected components (rim, ledge, strip, glass, apron, legs, feet, rails), ${S.floaters} floaters (a floater is a component whose bounding box touches no other), ${S.open_edges} open edges (the single-sided glass plane); glass plane faces up: ${S.glass_faces_up}, ${S.glass_size_m[0] * 100} x ${S.glass_size_m[1] * 100} cm at z ${S.glass_z_m} m; glass in its own slot ${glassSlot}`),
    scale: gate(scaleOk, `${cm(sx)} x ${cm(sy)} x ${cm(sz)} cm (x, y, z up) re-imported from final.glb; top surface z = ${S.top_surface_z_m} m; edge thickness ${S.edge_thickness_m * 100} cm at the outer front edge (target 3.0, the lamp-agent C-clamp grip); pivot: floor centre, x,y centre ${S.pivot_xy_centre_m.join(', ')}, feet at z = ${S.floor_z_m} m. Assumption: the 95 cm top is a Lynx choice and the ${m2(L)} x ${m2(W)} m outline the owner's (2026-10-24); the UE world scale of the table (W3.2) is still to be confirmed on Wolf.`),
    finishing: gate(finishOk, `one UV set (${S.uv_sets}); ${tex.length} PBR PNGs (dark metal and aluminium: base colour, normal, ORM, 512 px, the largest ${Math.max(...tex.map((f) => sizes[f]))} bytes), every file under 10 MB (largest ${Math.max(...Object.values(sizes))} bytes); ${S.materials.length} material slots (${S.materials.join(', ')}); emissive slot ${glowSlot} on ${S.faces_per_slot[glowSlot]} faces; evidence framing check passes on ${Object.keys(F).length} images (min silhouette margin ${minMargin} of the image, rule 0.03); evidence rendered with Cycles on the CPU. Not claimed: any UE import.`),
    poly_budget: gate(budgetOk, `${S.tris} tris against ${S.budget_tris} (${Math.round((S.tris / S.budget_tris) * 100)}%)`),
  },
};
// the build stage through the kit, which stamps sha256, file_bytes and lynx_commit
writeStage(ROOT, 'light-table-frame', 'build', M);
console.log('gates', Object.fromEntries(Object.entries(M.gates).map(([k, v]) => [k, v.pass])));
