// Writes apps/vr/ArtSource/city-backdrop/manifest.json from the measured scores (build_backdrop.bpy -> score.json,
// render_backdrop.bpy -> evidence.json), lookdev/log.jsonl and the files on disk. Gate results are derived from the measurements.
//   node scripts/art/city-backdrop/write_manifest.mjs <work-dir> <source-frame.jpg>
// The picked frame is the log call whose logged file is <source-frame.jpg>'s name: an API call of the backdrop props
// (city-backdrop, and city-night since 2026-10-24) or a Leonardo Studio call of a city-night state (2026-10-25, logged
// with "provider": "leonardo-studio"). When no call names the file, the newest MEDIUM API call, as before.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { argsOrUsage, folderDir, gate, inventory, writeStage } from '../lib/manifest-kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [work, srcJpg] = argsOrUsage(2, 'node scripts/art/city-backdrop/write_manifest.mjs <work-dir> <source-frame.jpg>');
const LOG = path.join(ROOT, 'docs', 'concepts', 'vr-light-table', 'lookdev', 'log.jsonl');
const S = JSON.parse(fs.readFileSync(path.join(work, 'score.json'), 'utf8'));
const E = JSON.parse(fs.readFileSync(path.join(work, 'evidence.json'), 'utf8'));
const shaOf = (b) => crypto.createHash('sha256').update(b).digest('hex');
const { file_bytes: sizes, oversize } = inventory(folderDir(ROOT, 'city-backdrop'));

const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
const srcSha = shaOf(fs.readFileSync(srcJpg));
const PROPS = ['city-backdrop', 'city-night'];
const isStudio = (e) => e.provider === 'leonardo-studio';
const calls = lines.map((l, i) => ({ n: i + 1, e: JSON.parse(l) }))
  .filter((x) => (isStudio(x.e) ? /^city-night/.test(x.e.state ?? '') : PROPS.includes(x.e.prop)) && x.e.status === 'COMPLETE');
const byFile = calls.filter((x) => path.basename(String(x.e.file ?? '')) === path.basename(srcJpg)).at(-1);
const picked = byFile ?? calls.filter((x) => !isStudio(x.e) && x.e.quality === 'MEDIUM').at(-1);
if (!picked) {
  // Without this the first use of `picked` is 30 lines below, after every file has been hashed, and it reads
  // "Cannot read properties of undefined (reading 'model')" - which names neither the log nor the filter.
  console.error(`no MEDIUM city-backdrop call in ${path.relative(ROOT, LOG)}: the manifest's generator block is the picked frame, so one is required.`);
  console.error(`  ${calls.length} city-backdrop call(s) in the log: ${calls.map((x) => `line ${x.n} ${x.e.variant} s${x.e.seed} ${x.e.quality}`).join('; ') || 'none'}`);
  process.exit(2);
}
// The input gate note's figures come from the log, not from typing: size from the picked call, the other trials grouped by quality.
const pickedSize = `${picked.e.width}x${picked.e.height}`;
const trialMix = [...new Set(calls.filter((x) => x !== picked).map((x) => x.e.quality))].map((q) => {
  const t = calls.filter((x) => x !== picked && x.e.quality === q);
  return `${t.length} ${q} ${t.length === 1 ? 'trial' : 'trials'} at ${[...new Set(t.map((x) => x.e.credits))].join('/')} credits`;
}).join(', ');
const studio = isStudio(picked.e);
const T = S.texture;
const P = S.panel;
const Z = S.scene; // the strip in the UE scene: x EmissiveStrength against the bloom threshold
// the build arguments after the frame, as build_backdrop.bpy reads them (the later ones only when the build had them)
const buildArgs = [T.dim, P.v_range[0], P.v_range[1], ...(T.gamma !== undefined ? [T.gamma, P.repeat, T.roll, P.z_m[0], P.z_m[1], T.pad] : [])].join(' ');
// the scene check: the lit windows cross the bloom threshold, and the sky stays near black, at the scene's EmissiveStrength
const sceneOk = !Z || (Z.shown_over_bloom >= 0.01 && Z.sky_median_peak <= 0.05);
const shownRows = Math.round(T.size[1] * (P.v_range[1] - P.v_range[0]));
const repeat = P.repeat ?? 1;
const tall = (P.z_m[1] - P.z_m[0]).toFixed(1);
const tileOk = T.seam_jump_after <= 3 * T.neighbour_step && T.seam_jump_after < T.seam_jump_before;
const dimOk = E.backdrop_max_display < 0.6 * E.table_view_max_display && T.max_luminance_encoded < 0.6 && sceneOk;
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
    note: `x, y up, z depth (glTF); a 180 degree arc of radius 10 m: 2000 wide, ${Math.round((P.z_m[1] - P.z_m[0]) * 100)} high, 1000 deep (the half circle); height runs from ${P.z_m[0].toFixed(1)} m to +${P.z_m[1].toFixed(1)} m about the pivot`,
  },
  meshes: { city_backdrop: { tris: S.tris, vertices: S.vertices, faces: S.faces, inward_faces: S.inward_faces } },
  uv_sets: S.uv_sets,
  pivot: `the arc centre on the floor plane (the centre of the half circle, height 0). The arc lies on +Y in Blender (+Z in the GLB), behind a viewer at the near edge of the table (in UE, CityBackdrop at the origin with yaw 90 puts it on +X behind the back wall's window, u running from UE -Y to +Y). Put the pivot at the light table pivot; the panel bottom is ${-P.z_m[0]} m below it.`,
  scale_reasoning: `No plan gives a window size (wolf-plan.md and plan.md only say "a matte panorama behind the windows"), so the panel is the fallback: a 180 degree arc. Radius 10 m (far enough that head motion has little parallax against a table of 1.2 x 0.8 m), ${tall} m tall. The panel shows rows ${P.v_range[0]} to ${P.v_range[1]} of the strip (UV v, bottom up)${repeat > 1 ? `, and the strip runs ${repeat} times across the arc (${180 / repeat} degrees each, about the frame's own spread; the back wall's window shows about 36 degrees of the arc, so a repeat is never seen twice at once)` : ''}, so each copy is ${T.size[0]} x ${shownRows} px on ${(31.4 / repeat).toFixed(1)} x ${tall} m (${(T.size[0] / (31.4 / repeat)).toFixed(0)} px/m across, ${(shownRows / (P.z_m[1] - P.z_m[0])).toFixed(0)} px/m up).${T.gamma !== undefined ? ' From the target pose (eye 1.38 m, pitch -31, the frame\'s top edge about 1.6 degrees below level) the window shows the arc from about 6 to 42 degrees right of centre, and from about 20 degrees down to 24 up; the far skyline sits just under the frame\'s top edge, as the concept\'s towers do, and the panel runs past what the lowest and highest panes show.' : ''} Wolf may rescale to the real windows.`,
  textures: `textures/city_backdrop_basecolor.png: ${T.size[0]} x ${T.size[1]} PNG, the wide matte strip. The picked frame's last ${T.seam_columns} columns are cross-faded into its first ${T.seam_columns}, so the right edge continues into the left (tileable horizontally; edge step ${T.seam_jump_after} against ${T.neighbour_step} for a typical neighbouring column pair, ${T.seam_jump_before} before the fade).${T.roll ? ` Its columns are rolled left by ${T.roll} of the width (lossless on a tileable strip), so the cross-faded columns fall on the wall, not in the window.` : ''}${T.pad_rows ? ` ${T.pad_rows} rows of sky are added above the frame (its top rows blurred along the row, darkening by a third upwards), so the window's top panes show sky, not the panel's edge.` : ''}${T.gamma !== undefined && T.gamma !== 1 ? ` Darks pressed down (encoded sRGB ** ${T.gamma}) so the sky stays near black under the scene's EmissiveStrength while the lit windows keep their value.` : ''} Dimmed by a factor ${T.dim} in encoded sRGB (max luminance ${T.max_luminance_encoded}, 99th percentile ${T.p99_luminance_encoded}, mean ${T.mean_luminance_encoded}). Wire it as the emissive colour; no normal or ORM map (a matte painting has no surface).${Z ? ` In the scene (x EmissiveStrength ${Z.emissive}, bloom threshold ${Z.bloom_threshold}): ${(Z.shown_over_bloom * 100).toFixed(1)} % of the shown pixels bloom (the lit windows); the shown median peaks at ${Z.shown_median_peak} and the sky's at ${Z.sky_median_peak} (90th percentile ${Z.sky_p90_peak}), a near-black blue.` : ''}`,
  generator: {
    tool: studio ? 'Leonardo Studio (web)' : 'Leonardo API',
    model: picked.e.model,
    quality: picked.e.quality,
    size: `${picked.e.width}x${picked.e.height}`,
    ...(picked.e.aspect ? { aspect: picked.e.aspect } : {}),
    seed: picked.e.seed,
    variant: picked.e.variant,
    ...(studio
      ? { state: `${picked.e.state} (the prompt was written for the call and is in the log line; no props.json entry)` }
      : { prop: `${picked.e.prop} (docs/concepts/vr-light-table/lookdev/props.json, "rules" mode)` }),
    prompt: picked.e.prompt,
    log_line: `docs/concepts/vr-light-table/lookdev/log.jsonl line ${picked.n}`,
    generation_id: picked.e.generationId,
    credits: picked.e.credits,
    source_sha256: srcSha,
    source_note: 'the downloaded JPEG stays out of the repo (temp folder); concept.png is its lossless re-encode',
    trial_calls: calls.map((x) => ({ log_line: x.n, ...(isStudio(x.e) ? { provider: 'leonardo-studio' } : {}), variant: x.e.variant, seed: x.e.seed, quality: x.e.quality, size: `${x.e.width}x${x.e.height}`, credits: x.e.credits, status: x.e.status, picked: x === picked })),
  },
  blender: 'Blender 5.2.2, scripts/art/city-backdrop/build_backdrop.bpy (concept, strip, panel and score), render_backdrop.bpy (evidence), write_manifest.mjs',
  licence: `${studio ? "Leonardo Studio output (the owner's signed-in web studio and its credit pool; the generation was deleted from the account once downloaded)" : 'Leonardo API output'}, generated ${picked.e.time.slice(0, 10)} on the owner's Leonardo account${studio ? '' : ' with public:false'}. Shipping it rests on the Director's ruling for the operator of 2026-10-21 (Leonardo for the backdrop, because FLUX.2 [klein] is not installed and will not be; wolf-plan.md R8, tech-stack.md section 5). The post-processing (seam fade, dim, mesh) is our own work. Check the Leonardo terms of service for commercial use before a public release.`,
  regenerate: `${studio
    ? `node scripts/lookdev/leonardo-studio.mjs gen --prompt-file <prompt.txt, the prompt of log line ${picked.n}> --aspect ${picked.e.aspect} --state ${picked.e.state} --variant ${picked.e.variant} --quality ${String(picked.e.quality).toLowerCase()} --out <frame.jpg> (spends studio credits in the owner's signed-in browser; the model takes no seed, so it makes a new frame)`
    : `node scripts/lookdev/leonardo.mjs gen --prop ${picked.e.prop} --variant ${picked.e.variant} --seed ${picked.e.seed} --quality ${picked.e.quality} --size ${picked.e.width}x${picked.e.height} (spends credits)`}; blender -b -P scripts/art/city-backdrop/build_backdrop.bpy -- <repo-root> <work> <frame.jpg> ${buildArgs}; blender -b -P scripts/art/city-backdrop/render_backdrop.bpy -- <repo-root> <work>; node scripts/art/city-backdrop/write_manifest.mjs <work> <frame.jpg>`,
  evidence_stats: E,
  gates: {
    input: gate(true, studio
      ? `Leonardo Studio ${picked.e.model} (the owner's signed-in web studio, scripts/lookdev/leonardo-studio.mjs), ${pickedSize} (${picked.e.aspect}; log line ${picked.n}), picked from ${calls.length} frames (${trialMix}, 1 ${picked.e.quality} at ${picked.e.credits}). The prompt (in the log line) asks for a deep near-black night sky, towers at clearly varied depth with haze between the layers, many warm and some cool lit windows, and no foreground, window frame, interior, text, signage or logos, and restates the never list. Variant ${picked.e.variant} of the two studio frames was picked behind the back wall's mullioned window at the target pose (EEVEE comparison, 2026-10-25): its near towers carry big warm window grids with a cool-white core of far towers behind them, so the panes read near, middle and far; the other frame's towers are one even mid-rise texture. It replaces the 2026-10-24 API frame, whose blue sky and haze bloomed as one flat blue dusk under the scene's EmissiveStrength (the judges on element 14).`
      : `Leonardo ${picked.e.model}, ${pickedSize} (the model accepts wide sizes; log line ${picked.n}), picked from ${calls.length} frames (${trialMix}, 1 ${picked.e.quality} at ${picked.e.credits}). The prompt uses the ${picked.e.prop} rules (props.json: a wide night city from a high studio, no foreground, no window frame or mullions, no text, signs or logos, a skyline band that continues at both edges) and restates the style block palette and finish. ${picked.e.prop === 'city-night' ? 'The picked frame (2026-10-24, fidelity sprint) is a dense blue night city of towers with many small warm and cool window lights, no frame and no readable text; it replaces the dim, sparse 2026-10-21 frame that read too dark (r5, element 14).' : 'The picked frame is a dim blueprint-blue night skyline with sparse amber window lights, no frame and no text, like the city seen through the windows in lookdev/00-hero.jpg.'}`),
    mesh_acceptance: gate(meshOk, `trivial for a matte panel (no generated mesh): re-imported from final.glb, ${S.mesh_objects} mesh object, ${S.vertices} vertices, ${S.tris} tris, ${S.inward_faces} of ${S.faces} faces point at the arc centre, ${S.uv_sets} UV set, one emissive-only slot (${S.materials[0]}); no floaters or holes by construction (one strip of quads).`),
    scale: gate(arcOk, `fallback scale (no window size in wolf-plan.md or plan.md): a ${S.panel.arc_deg} degree arc (measured ${S.arc_deg[0]} to ${S.arc_deg[1]}), radius ${S.radius_m[0]} m, ${S.panel.z_m[1] - S.panel.z_m[0]} m tall, pivot at the arc centre on the floor. Wolf confirms against the real window layout.`),
    finishing: gate(tileOk && dimOk && oversize.length === 0, `strip ${T.size[0]} x ${T.size[1]} PNG, edge-matched (edge step ${T.seam_jump_after} against ${T.neighbour_step} typical, ${T.seam_jump_before} before the fade); dimmed x${T.dim} (strip max luminance ${T.max_luminance_encoded}); in the evidence render the backdrop's brightest pixel is ${E.backdrop_max_display} display luminance and the table's edge strip clips at ${E.table_view_max_display}, so the backdrop does not outshine the strip;${Z ? ` in the UE scene (x EmissiveStrength ${Z.emissive}) ${(Z.shown_over_bloom * 100).toFixed(1)} % of the shown pixels cross the bloom threshold ${Z.bloom_threshold} (at least 1 % asked, so the lit windows bloom) and the sky's median peak is ${Z.sky_median_peak} (at most 0.05 asked, so the sky stays near black);` : ''} every file under 10 MB (largest ${Math.max(...Object.values(sizes))} bytes); evidence rendered with Cycles on the CPU. Not claimed: any UE import.`),
    poly_budget: gate(S.tris <= BUDGET, `trivial: ${S.tris} tris for a curved panel against ${BUDGET} (plan.md P4 gives no backdrop row; the figure is a sanity cap)`),
  },
};
// the build stage through the kit, which stamps sha256, file_bytes and lynx_commit
writeStage(ROOT, 'city-backdrop', 'build', M);
console.log('gates', Object.fromEntries(Object.entries(M.gates).map(([k, v]) => [k, v.pass])));
