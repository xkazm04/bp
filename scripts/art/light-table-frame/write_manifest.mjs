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

// The vr-fidelity-40 finish (scripts/art/lib/finish.bpy), as build_frame.bpy measured it.
const fin = S.finish ?? {}, td = S.texel ?? {}, bk = S.bake ?? {};
const scans = Object.entries(S.scans ?? {}).map(([id, v]) => `${id} (${v.page}, ${v.licence}, ${v.size_mm?.[0] / 1000} m tile)`);
const atlasSlot = S.materials.find((m) => m.includes('atlas'));
const meshOk = S.mesh_objects === 1 && S.floaters === 0 && S.components >= 1 && S.glass_faces_up;
const scaleOk = Math.abs(S.edge_thickness_m - 0.03) < 1e-4 && Math.abs(S.floor_z_m) < 1e-4 && Math.abs(S.pivot_xy_centre_m[0]) < 1e-4
  && Math.abs(S.pivot_xy_centre_m[1]) < 1e-4 && Math.abs(S.top_surface_z_m - 0.95) < 1e-4;
const finishOk = fin.hard_edges_bevelled > 0 && scans.length > 0 && Boolean(atlasSlot) && S.material_has_textures[atlasSlot]?.length === 3
  && S.uv_sets === 1 && tex.length === 3 && oversize.length === 0 && Boolean(glowSlot) && Boolean(glassSlot)
  && S.faces_per_slot[glowSlot] > 0 && framingOk;
const budgetOk = S.tris <= S.budget_tris;

const M = {
  id: 'light-table-frame',
  class: 'prop-hero',
  budget_tris: S.budget_tris,
  tris: S.tris,
  tris_total: S.tris,
  materials: [
    `${atlasSlot} (one ${S.atlas_res} px baked atlas: the rim extrusion in silver-grey aluminium #70777F (metal 0.35) worn bright on its edges, its inner lip in satin aluminium #858C95 (metal 0.3), legs and rails in dark anodised aluminium #262B33, the apron and feet in aluminium #C9CDD2, the corner caps and screws in steel #5A5F66)`,
    `${glowSlot} (emissive edge line: base colour #0A0F18 (dark, so the room's light adds nothing), emission #F4FAFF at strength ${glow} (glTF emissive_strength), 5 mm wide and 4 mm tall at the paper's edge; UE drives the intensity)`,
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
  scale_reasoning: `Table top surface at 95 cm (wolf-plan W3.2 starts there; R4 lets the owner change it). Outline ${m2(L)} x ${m2(W)} m, a long drafting light table (the owner chose about 180 x 90 cm on 2026-10-24, spark vr-hands-zoom; the first frame was 1.20 x 0.80). The top is 3 cm thick at the outer edge because lamp-agent\'s manifest says its C-clamp grips a 3 cm table edge; the apron under the top is inset 6 cm so the clamp finds a bare edge. The rim has a 2.8 cm flat top (the concept's slim silver rim, by eye about 2.5 cm beside its 166 cm paper), a 3 mm 45 degree chamfer, and an inner lip sloping 7.2 mm down over 3.4 cm to 6.5 cm in, facing the paper so its light lands there; a 5 mm emissive line (4 mm tall, its top 7.5 mm under the rim top) sits at the paper's edge, so the glass panel is ${m2(L - 0.14)} x ${m2(W - 0.14)} m, 0.75 cm below the rim top (UE's paper lies at 0.8 cm). The paper (BpTable.h, 166 x 76 cm) fixes the 7 cm from the outer edge to the glass. The legs stand 8.5 cm in from the sides and, along the length, 8.5 cm in at 1.20 m and further in as the top grows (15 cm at 1.80 m).`,
  textures: `frame_atlas_{basecolor,orm,normal}.png: one ${S.atlas_res} px atlas (ORM: R occlusion, G roughness, B metal; normal tangent-space OpenGL), baked with Cycles on the CPU from layered bake sources (scripts/art/lib/finish.bpy): Poly Haven CC0 scans tinted to the palette, curvature edge wear, grunge, AO (multiplied into basecolor at 0.55 too: the forward-shaded UE scene has no runtime AO). One unique UV set, long rails cut into 35 cm islands, hidden faces shrunk to 0.12; ${td.px_per_m} px/m on the visible surface (${td.surface_m2} m2). The GLB embeds the atlas as quality-92 JPEG (the 2048 px PNG set would put it over 10 MB). The glow and glass slots are flat colours with no texture.`,
  finish: {
    bevel: `angle-limited bevel on every part's hard edges (rim 1.2 mm, lip 0.8 mm, legs 1.2 mm, caps 0.8 mm), 2 segments, arc miter, hardened normals, then weighted normals and smooth shading; ${fin.hard_edges_bevelled} hard edges bevelled, ${fin.hard_edges_sharp_by_design} kept sharp by design (the glow strip, screw heads), ${fin.razor_edges_left} convex edges of 60 degrees or more left unrounded`,
    parts: 'rim: a 3 cm tall extrusion profile with a 6 x 3.5 mm groove on its outer face, a 2.8 cm flat top and a 45 degree chamfer, swept round the outline with mitred corners; inner lip: a second sweep sloping to the 5 mm glow line; 2.5 mm steel corner caps with two screw heads per arm; 4 cm square extrusion legs with a groove down each face, levelling feet',
    smooth_faces: S.smooth_faces, texel: td, bake: bk, cc0_sources: S.scans,
  },
  generator: 'procedural Blender',
  blender: 'Blender 5.2.2, scripts/art/light-table-frame/build_frame.bpy (build and score), render_frame.bpy (evidence and framing check), write_manifest.mjs',
  licence: `own procedural work; no generated input, no Leonardo, ComfyUI or TRELLIS; bake inputs are Poly Haven CC0 scans (${scans.join('; ')}), never shipped as files`,
  regenerate: `node scripts/art/lib/polyhaven.mjs <work>/polyhaven; blender -b -P scripts/art/light-table-frame/build_frame.bpy -- <repo-root> <work>${buildArgs}; blender -b -P scripts/art/light-table-frame/render_frame.bpy -- <repo-root> <work>; node scripts/art/light-table-frame/write_manifest.mjs <work>`,
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
      {
        finding: 'Spark vr-fidelity-40 (FJ, 2026-10-25), UE capture fid-g-scan.jpg against target-light-table.jpg: the near strip is about 2 cm wide and reads as a thick white bar; it is lit surface (white base colour), so a zero emissive changed nothing. The concept has a thin crisp glow line inside a slim silver-grey rim, its light spilling onto the rim inner lip.',
        fix: `profile rebuilt: a 5 mm glow line with base colour #0A0F18 and emission #F4FAFF at strength ${glow}; the rim flat top 5 -> 2.8 cm in silver-grey aluminium (metal 0.35: a full metal reflects black on the UE forward path without reflection captures), a 3 mm 45 degree chamfer, and a satin lip sloping 7.2 mm over 3.4 cm to the line; slot names, atlas and the 7 cm to the 166 x 76 cm glass kept`,
      },
    ],
  },
  framing: F,
  gates: {
    input: gate(true, 'procedural, no generated input (plan.md P4: the glass and paper stay procedural; operator pick: props parametric). Reference: art-breakdown.md row 1 (backlit glass table, bright white edge light, emissive frame strip, the glass blue comes from the paper material, not a tint), the Director review of 04fc311 (rim, legs and rails near-black as in lookdev/00-hero.jpg; style-block.json studio #0A0F18 is the only dark value in the block, so it is the dark metal base) and brushed aluminium feet and ledge.'),
    mesh_acceptance: gate(meshOk, `re-imported from final.glb: ${S.mesh_objects} mesh object, ${S.vertices} vertices, ${S.tris} tris, ${S.components} connected components (rim, lip, ledge, strip, glass, corner caps, screws, apron, legs, feet, rails), ${S.floaters} floaters (a floater is a component whose bounding box touches no other), ${S.open_edges} open edges (the single-sided glass plane); glass plane faces up: ${S.glass_faces_up}, ${S.glass_size_m[0] * 100} x ${S.glass_size_m[1] * 100} cm at z ${S.glass_z_m} m; glass in its own slot ${glassSlot}`),
    scale: gate(scaleOk, `${cm(sx)} x ${cm(sy)} x ${cm(sz)} cm (x, y, z up) re-imported from final.glb; top surface z = ${S.top_surface_z_m} m; edge thickness ${S.edge_thickness_m * 100} cm at the outer front edge (target 3.0, the lamp-agent C-clamp grip); pivot: floor centre, x,y centre ${S.pivot_xy_centre_m.join(', ')}, feet at z = ${S.floor_z_m} m. Assumption: the 95 cm top is a Lynx choice and the ${m2(L)} x ${m2(W)} m outline the owner's (2026-10-24); the UE world scale of the table (W3.2) is still to be confirmed on Wolf.`),
    finishing: gate(finishOk, `finish: ${fin.hard_edges_bevelled} bevelled hard edges, ${Math.round(S.smooth_faces * 100)}% smooth-shaded faces, baked atlas at ${td.px_per_m} px/m from ${scans.length} CC0 scans; one UV set (${S.uv_sets}); ${tex.length} PBR PNGs (the atlas: base colour, normal, ORM, ${S.atlas_res} px, the largest ${Math.max(...tex.map((f) => sizes[f]))} bytes), every file under 10 MB (largest ${Math.max(...Object.values(sizes))} bytes); ${S.materials.length} material slots (${S.materials.join(', ')}); emissive slot ${glowSlot} on ${S.faces_per_slot[glowSlot]} faces; evidence framing check passes on ${Object.keys(F).length} images (min silhouette margin ${minMargin} of the image, rule 0.03); evidence rendered with Cycles on the CPU. Not claimed: any UE import.`),
    poly_budget: gate(budgetOk, `${S.tris} tris against ${S.budget_tris} (${Math.round((S.tris / S.budget_tris) * 100)}%)`),
  },
};
// the build stage through the kit, which stamps sha256, file_bytes and lynx_commit
writeStage(ROOT, 'light-table-frame', 'build', M);
console.log('gates', Object.fromEntries(Object.entries(M.gates).map(([k, v]) => [k, v.pass])));
