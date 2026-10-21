// Writes apps/vr/ArtSource/city-backdrop/manifest.json from the measured scores (build_backdrop.bpy -> score.json,
// render_backdrop.bpy -> evidence.json), lookdev/log.jsonl and the files on disk. Gate results are derived from the measurements.
//   node scripts/art/city-backdrop/write_manifest.mjs <work-dir> <source-frame.jpg>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, 'apps', 'vr', 'ArtSource', 'city-backdrop');
const LOG = path.join(ROOT, 'docs', 'concepts', 'vr-light-table', 'lookdev', 'log.jsonl');
const [work, srcJpg] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(path.join(work, 'score.json'), 'utf8'));
const E = JSON.parse(fs.readFileSync(path.join(work, 'evidence.json'), 'utf8'));
const DATE = new Date().toISOString().slice(0, 10);
const shaOf = (b) => crypto.createHash('sha256').update(b).digest('hex');
const gate = (pass, note) => ({ pass, note, date: DATE });
const files = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p, base) : e.name === 'manifest.json' ? [] : [path.relative(base, p).split(path.sep).join('/')];
}).sort();
const all = files(DIR);
const sums = Object.fromEntries(all.map((f) => [f, shaOf(fs.readFileSync(path.join(DIR, f)))]));
const sizes = Object.fromEntries(all.map((f) => [f, fs.statSync(path.join(DIR, f)).size]));
const oversize = all.filter((f) => sizes[f] >= 10 * 1024 * 1024);

const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
const srcSha = shaOf(fs.readFileSync(srcJpg));
const calls = lines.map((l, i) => ({ n: i + 1, e: JSON.parse(l) })).filter((x) => x.e.prop === 'city-backdrop');
const picked = calls.find((x) => x.e.quality === 'MEDIUM');
if (!picked) {
  // Without this the first use of `picked` is 30 lines below, after every file has been hashed, and it reads
  // "Cannot read properties of undefined (reading 'model')" - which names neither the log nor the filter.
  console.error(`no MEDIUM city-backdrop call in ${path.relative(ROOT, LOG)}: the manifest's generator block is the picked frame, so one is required.`);
  console.error(`  ${calls.length} city-backdrop call(s) in the log: ${calls.map((x) => `line ${x.n} ${x.e.variant} s${x.e.seed} ${x.e.quality}`).join('; ') || 'none'}`);
  process.exit(2);
}
const T = S.texture;
const tileOk = T.seam_jump_after <= 3 * T.neighbour_step && T.seam_jump_after < T.seam_jump_before;
const dimOk = E.backdrop_max_display < 0.6 * E.table_view_max_display && T.max_luminance_encoded < 0.6;
const meshOk = S.mesh_objects === 1 && S.inward_faces === S.faces && S.materials.length === 1 && S.emissive_only && S.uv_sets === 1;
const arcOk = Math.abs(S.arc_deg[0] + 90) < 0.5 && Math.abs(S.arc_deg[1] - 90) < 0.5 && Math.abs(S.radius_m[0] - 10) < 0.01 && Math.abs(S.radius_m[1] - 10) < 0.01;
const BUDGET = 200; // no plan.md P4 row gives a backdrop budget: a sanity cap for a curved matte panel
const bb = S.bounds_m;

const M = {
  id: 'city-backdrop',
  class: 'backdrop-matte',
  budget_tris: BUDGET,
  tris: S.tris,
  tris_total: S.tris,
  materials: ['city_backdrop_emissive (emissive-only: base colour black, the matte strip as the emission texture at strength 1.0; unlit in effect, no light response)'],
  bounds_cm: {
    x: Math.round((bb.max[0] - bb.min[0]) * 100),
    y: Math.round((bb.max[2] - bb.min[2]) * 100),
    z: Math.round((bb.max[1] - bb.min[1]) * 100),
    note: 'x, y up, z depth (glTF); a 180 degree arc of radius 10 m: 2000 wide, 600 high, 1000 deep (the half circle); height runs from -1.0 m to +5.0 m about the pivot',
  },
  meshes: { city_backdrop: { tris: S.tris, vertices: S.vertices, faces: S.faces, inward_faces: S.inward_faces } },
  uv_sets: S.uv_sets,
  pivot: 'the arc centre on the floor plane (the centre of the half circle, height 0). The arc lies on +Y in Blender (+Z in the GLB), behind a viewer at the near edge of the table. Put the pivot at the light table pivot; the panel bottom is 1.0 m below it so the horizon band sits near 1.4 m.',
  scale_reasoning: 'No plan gives a window size (wolf-plan.md and plan.md only say "a matte panorama behind the windows"), so the panel is the fallback: a 180 degree arc. Radius 10 m (far enough that head motion has little parallax against a table of 1.2 x 0.8 m), 6 m tall. The strip shows rows 0.05 to 0.65 of the picture (the sky above and the dark ground below are cut), about 1.75 x 1.3 cm per texel. Wolf may rescale to the real windows.',
  textures: `textures/city_backdrop_basecolor.png: ${T.size[0]} x ${T.size[1]} PNG, the wide matte strip. The picked frame's last ${T.seam_columns} columns are cross-faded into its first ${T.seam_columns}, so the right edge continues into the left (tileable horizontally; edge step ${T.seam_jump_after} against ${T.neighbour_step} for a typical neighbouring column pair, ${T.seam_jump_before} before the fade). Dimmed by a factor ${T.dim} in encoded sRGB (max luminance ${T.max_luminance_encoded}, 99th percentile ${T.p99_luminance_encoded}, mean ${T.mean_luminance_encoded}). Wire it as the emissive colour; no normal or ORM map (a matte painting has no surface).`,
  generator: {
    tool: 'Leonardo API',
    model: picked.e.model,
    quality: picked.e.quality,
    size: `${picked.e.width}x${picked.e.height}`,
    seed: picked.e.seed,
    variant: picked.e.variant,
    prop: 'city-backdrop (docs/concepts/vr-light-table/lookdev/props.json, "rules" mode)',
    prompt: picked.e.prompt,
    log_line: `docs/concepts/vr-light-table/lookdev/log.jsonl line ${picked.n}`,
    generation_id: picked.e.generationId,
    credits: picked.e.credits,
    source_sha256: srcSha,
    source_note: 'the downloaded JPEG stays out of the repo (temp folder); concept.png is its lossless re-encode',
    trial_calls: calls.map((x) => ({ log_line: x.n, variant: x.e.variant, seed: x.e.seed, quality: x.e.quality, size: `${x.e.width}x${x.e.height}`, credits: x.e.credits, status: x.e.status, picked: x === picked })),
  },
  blender: 'Blender 5.2.2, scripts/art/city-backdrop/build_backdrop.bpy (concept, strip, panel and score), render_backdrop.bpy (evidence), write_manifest.mjs',
  licence: "Leonardo API output, generated 2026-10-21 on the owner's Leonardo account with public:false. Shipping it rests on the Director's ruling for the operator of 2026-10-21 (Leonardo for the backdrop, because FLUX.2 [klein] is not installed and will not be; wolf-plan.md R8, tech-stack.md section 5). The post-processing (seam fade, dim, mesh) is our own work. Check the Leonardo terms of service for commercial use before a public release.",
  lynx_commit: null,
  lynx_commit_note: 'null until the merge sets it',
  regenerate: 'node scripts/lookdev/leonardo.mjs gen --prop city-backdrop --variant A --seed 3 --quality MEDIUM --size 2048x768 --stop-at 200 (spends credits); blender -b -P scripts/art/city-backdrop/build_backdrop.bpy -- <repo-root> <work> <frame.jpg>; blender -b -P scripts/art/city-backdrop/render_backdrop.bpy -- <repo-root> <work>; node scripts/art/city-backdrop/write_manifest.mjs <work> <frame.jpg>',
  evidence_stats: E,
  file_bytes: sizes,
  sha256: sums,
  gates: {
    input: gate(true, `Leonardo ${picked.e.model}, 2048x768 (the model accepts wide sizes; log line ${picked.n}), picked from ${calls.length} frames (3 LOW trials at 8 credits, 1 MEDIUM at ${picked.e.credits}). The prompt uses the backdrop rules (wide night skyline from a high studio window, low contrast, dim, no foreground, no window frame, no text or logos, seamless horizon band) and restates the style block palette and finish. The picked frame is a dim blueprint-blue night skyline with sparse amber window lights, no frame and no text, like the city seen through the windows in lookdev/00-hero.jpg.`),
    mesh_acceptance: gate(meshOk, `trivial for a matte panel (no generated mesh): re-imported from final.glb, ${S.mesh_objects} mesh object, ${S.vertices} vertices, ${S.tris} tris, ${S.inward_faces} of ${S.faces} faces point at the arc centre, ${S.uv_sets} UV set, one emissive-only slot (${S.materials[0]}); no floaters or holes by construction (one strip of quads).`),
    scale: gate(arcOk, `fallback scale (no window size in wolf-plan.md or plan.md): a ${S.panel.arc_deg} degree arc (measured ${S.arc_deg[0]} to ${S.arc_deg[1]}), radius ${S.radius_m[0]} m, ${S.panel.z_m[1] - S.panel.z_m[0]} m tall, pivot at the arc centre on the floor. Wolf confirms against the real window layout.`),
    finishing: gate(tileOk && dimOk && oversize.length === 0, `strip ${T.size[0]} x ${T.size[1]} PNG, edge-matched (edge step ${T.seam_jump_after} against ${T.neighbour_step} typical, ${T.seam_jump_before} before the fade); dimmed x${T.dim} (strip max luminance ${T.max_luminance_encoded}); in the evidence render the backdrop's brightest pixel is ${E.backdrop_max_display} display luminance and the table's edge strip clips at ${E.table_view_max_display}, so the backdrop does not outshine the strip; every file under 10 MB (largest ${Math.max(...Object.values(sizes))} bytes); evidence rendered with Cycles on the CPU. Not claimed: any UE import.`),
    poly_budget: gate(S.tris <= BUDGET, `trivial: ${S.tris} tris for a curved panel against ${BUDGET} (plan.md P4 gives no backdrop row; the figure is a sanity cap)`),
  },
};
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(M, null, 2) + '\n');
console.log('gates', Object.fromEntries(Object.entries(M.gates).map(([k, v]) => [k, v.pass])));
