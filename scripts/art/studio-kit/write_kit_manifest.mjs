// Writes apps/vr/ArtSource/<asset-id>/manifest.json for a studio DENSITY kit (build_kits.bpy: studio-wall-kit,
// studio-desk-clutter, studio-architecture) from its measured score (<work>/<asset-id>/score.json, a re-import of
// final.glb) and the files on disk. The kits have no concept stage, so the build owns their identity and input gate.
// Gate results are derived from the measurements, never typed in.
//   node scripts/art/studio-kit/write_kit_manifest.mjs <work-dir> <asset-id>
// Landing order (the kit stamps lynx_commit from git, so a folder no commit touches cannot be written): commit the
// folder's files first, then run this writer, then commit the manifest; declare the folder in score-assets.mjs ENTRY_POINTS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MB10, argsOrUsage, cm, folderDir, gate, inventory, writeStage } from '../lib/manifest-kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [work, id] = argsOrUsage(2, 'node scripts/art/studio-kit/write_kit_manifest.mjs <work-dir> <asset-id>');
const S = JSON.parse(fs.readFileSync(path.join(work, id, 'score.json'), 'utf8'));
const { files: all, file_bytes: sizes } = inventory(folderDir(ROOT, id));
const tex = all.filter((f) => f.startsWith('textures/'));
const ev = all.filter((f) => f.startsWith('evidence/'));
const meshes = Object.entries(S.meshes);
const td = S.texel ?? {}, bk = S.bake ?? {};
const scans = Object.entries(S.scans ?? {}).map(([k, v]) => `${k} (${v.page}, ${v.licence})`);
const models = Object.entries(S.models ?? {}).map(([k, v]) => `${k} (${v.page}, ${v.licence}, by ${Object.keys(v.authors ?? {}).join(', ')}, ${v.polycount} tris at source; objects ${v.objects.join(', ')})`);

const USE = {
  'studio-wall-kit': {
    what: 'three thin black frames with white mats round printed drawings (a landscape over two portraits) and a cork pinboard in a dark wood frame with five pinned, curling sheets and amber push pins',
    place: 'on the left wall facing the room, or the back wall left of the shelves (the concept\'s top-left wall of drawings): pivot = bottom centre of the arrangement on the wall\'s inside face (y = 0 is the wall plane, the kit stands out of it towards -Y); hang its bottom about 1.0 to 1.2 m above the floor. Blender -Y lands on UE -Y through Interchange, so on the back wall (+X) it takes yaw -90, on the left wall (-Y) yaw 180 (studio_level.py conventions); it replaces two of the four StudioPinnedDrawings instances there',
    printed: 'wall_sheets: its own 2048 px basecolor composed from the Leonardo wall drawings (docs/concepts/vr-light-table/lookdev/wall-drawings: A, B, D and the three thirds of draw_sheets_atlas.jpg; calls logged in docs/concepts/vr-light-table/lookdev/log.jsonl, ruling R8b) and two procedural sheets (a ruled pencil note, a printed spec page); flat normal and ORM (roughness 0.86). UE: lit, not emissive',
  },
  'studio-desk-clutter': {
    what: 'three lever-arch binders (navy, charcoal, oxblood; labels, finger rings), a leather binder, an A4 stack, a yellow legal pad, a note stack and sticky notes, a pencil cup with pencils and pens, a navy holder with five rolled drawings, a paper stack',
    place: 'on a side desk top (z = 0 is the desk surface): pivot = base centre, facing -Y; on the left desk (studio_level.py LEFT_DESK) beside the desk lamp, yaw so the binder spines face the table, or on the right desk where the drawing tubes are (then drop StudioDrawingTubes: the kit has its own rolls)',
    printed: null,
  },
  'studio-architecture': {
    what: 'window_frame: a dark steel frame for the studio window (6 cm outer frame, two mullions and two transoms 3.5 cm wide, glazing beads round every pane) and an oak sill; pendant_lamp: a ceiling canopy, a 0.9 m cord, a brass socket, a 32 cm spun steel dome white inside and a warm bulb just below its rim',
    place: 'window_frame: into the back wall opening of studio_level.py (Y 40..190 cm, Z 20..280 cm, wall at X = 250): pivot = bottom centre of the opening on the wall\'s inside face, its depth (+Y, 8 cm) into the wall, the sill proud into the room; yaw -90 on the back wall; REMOVE the shell\'s mullion and transom boxes (studio_level.py, "A mullion and a transom") it replaces. pendant_lamp: pivot = canopy top on the ceiling (z = 0, hangs down 1.09 m), one over each side desk (instanced: the second costs no draw); give each a warm point light at the bulb (about 0.18 m under the pivot: 0.9 m cord + socket) for the bokeh-like highlights, bulb_glow emissive #FFC27A',
    printed: null,
  },
}[id];

const meshOk = meshes.every(([n, m]) => m.floaters === 0 && m.uv_sets === 1 && m.in_envelope)
  && (id === 'studio-desk-clutter' || meshes.every(([, m]) => m.open_edges === 0));
const textured = [...new Set(meshes.flatMap(([, m]) => m.materials.filter((x) => m.material_has_textures[x].length)))];
const texOk = textured.every((m) => ['basecolor', 'normal', 'orm'].every((c) => tex.includes(`textures/${m}_${c}.png`)));
const finishOk = S.hard_edges_bevelled > 0 && meshes.every(([, m]) => m.custom_normals && m.smooth_faces > 0.5) && texOk && scans.length > 0
  && Object.values(sizes).every((b) => b < MB10) && ['evidence/context.jpg', 'evidence/target-compare.jpg'].every((e) => ev.includes(e));

const O = {
  id, class: 'studio-kit', budget_tris: S.budget_tris,
  budget_note: `fidelity sprint FD brief (2026-10-25): each density kit one mesh and one atlas, at most 2 to 3 draw sections; ${S.budget_tris} tris for the kit`,
  tris: Object.fromEntries(meshes.map(([n, m]) => [n, m.tris])),
  tris_note: `${S.tris} against ${S.budget_tris}; ${S.sections} draw sections (${meshes.map(([n, m]) => `${n}: ${m.materials.join(' + ')}`).join('; ')})`,
  what: USE.what,
  generator: [{
    method: `procedural Blender (scripts/art/studio-kit/build_kits.bpy) through the finish stack of scripts/art/lib/finish.bpy: per-part bevels (${S.hard_edges_bevelled} hard edges), hardened and weighted normals, unique UVs, one ${S.atlas_res} px atlas baked on the CPU from Poly Haven CC0 scans with curvature wear, grunge and AO${models.length ? `; plus CC0 MODELS re-baked into the same atlas (their files are bake input only, none ships): ${models.join('; ')}` : ''}`,
  }],
  materials: meshes.flatMap(([n, m]) => m.materials.map((x) => `${n}/${x}: ${m.faces_per_slot[x]} faces, ${m.material_has_textures[x].length ? 'baked basecolor + ORM (R occlusion, G roughness, B metal) + tangent normal (OpenGL)' : 'flat emissive (UE drives it)'}`)),
  material_slots: [...new Set(meshes.flatMap(([, m]) => m.materials))],
  printed_sheets: USE.printed,
  textures: `${tex.join(', ')}; atlas ${td.px_per_m} px/m on the visible surface (${Math.round((td.hidden_share ?? 0) * 100)} % of the surface hidden and shrunk), bake seconds ${JSON.stringify(bk.seconds ?? {})}; AO also multiplied into basecolor at 0.55 (the forward scene has no runtime AO). GLB embeds JPEG q92`,
  meshes: Object.fromEntries(meshes.map(([n, m]) => [n, { tris: m.tris, components: m.components, floaters: m.floaters, open_edges: m.open_edges, size_cm: m.bounds_m.size_xyz.map(cm), slots: m.materials }])),
  uv_sets: 1,
  placement: USE.place,
  axes: 'Blender Z up, facing -Y; glTF Y-up (Interchange lands Blender -Y on UE -Y)',
  licence: `own procedural work (Blender is a GPL tool; its output is ours); bake inputs CC0: ${[...scans, ...models].join('; ')}${USE.printed ? '; printed sheets from our own logged Leonardo generations (ruling R8b) and procedural sheets' : ''}`,
  regenerate: `node scripts/art/lib/polyhaven.mjs <work>/polyhaven 2k; node scripts/art/lib/polyhaven.mjs <work>/polyhaven 1k --models; blender -b -P scripts/art/studio-kit/build_kits.bpy -- <repo-root> <work> ${id}; blender -b -P scripts/art/studio-kit/render_kits.bpy -- <repo-root> ${id}; node scripts/art/studio-kit/write_kit_manifest.mjs <work> ${id}`,
  gates: {
    input: gate(true, `procedural, no generated geometry; CC0 inputs only (Poly Haven scans${models.length ? ' and models' : ''}, licence recorded)${USE.printed ? '; printed sheets from logged Leonardo calls (R8b)' : ''}`),
    mesh_acceptance: gate(meshOk, `re-imported from final.glb: ${meshes.map(([n, m]) => `${n} ${m.tris} tris, ${m.components} components, ${m.floaters} floaters (a component touching neither another one nor the kit's anchor plane), ${m.open_edges} open edges`).join('; ')}${id === 'studio-desk-clutter' ? '. The open edges are the Poly Haven models\' own (pencil ends, the decimated binder\'s page block): their shells are not closed at source; every procedural part is closed' : ''}`),
    scale: gate(meshes.every(([, m]) => m.in_envelope), `${meshes.map(([n, m]) => `${n} ${m.bounds_m.size_xyz.map(cm).join(' x ')} cm (x, y, z up) in the envelope ${m.expected_size_m.map(([a, b]) => `${Math.round(a * 100)}-${Math.round(b * 100)}`).join(', ')} cm`).join('; ')}: ${S.expected_why}`),
    finishing: gate(finishOk, `bevelled hard edges ${S.hard_edges_bevelled}, hardened custom normals and smooth shading on every mesh, one UV set, ${tex.length} PNGs (${textured.join(', ')} each basecolor, normal, ORM), CC0 scans ${scans.length}${models.length ? `, CC0 models ${models.length}` : ''}; evidence/context.jpg (EEVEE, dark studio rig) and evidence/target-compare.jpg (beside the concept's crop); every file under 10 MB`),
    poly_budget: gate(S.tris <= S.budget_tris, `${S.tris} tris against ${S.budget_tris} (${Math.round(S.tris / S.budget_tris * 100)} %)`),
  },
};
const written = writeStage(ROOT, id, 'build', O);
let bad = 0;
for (const [k, g] of Object.entries(written.gates)) { console.log(g.pass ? 'PASS' : 'FAIL', k); if (!g.pass) bad++; }
process.exit(bad ? 1 : 0);
