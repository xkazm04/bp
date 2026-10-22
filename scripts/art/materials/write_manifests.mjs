// Writes apps/vr/ArtSource/mat-<id>/manifest.json for the four tiling materials from the measured seam scores
// (build_materials.bpy -> score.json) and the files on disk. Gate results are derived from the measurements, never typed in.
//   node scripts/art/materials/write_manifests.mjs <work-dir>
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
const [work] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(path.join(work, 'score.json'), 'utf8'));
const DATE = new Date().toISOString().slice(0, 10);
const MB10 = 10 * 1024 * 1024;
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const gate = (pass, note) => ({ pass, note, date: DATE });
const files = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p, base) : e.name === 'manifest.json' ? [] : [path.relative(base, p).split(path.sep).join('/')];
}).sort();

const INFO = {
  vellum: {
    tile_m: 0.5, look: 'warm translucent drafting vellum, base #E8DFC8 to #F4ECD8 (warm paper family), soft cloudiness and fine fibre, roughness 0.55 to 0.70, no metal',
    input: 'procedural, no generated input. Reference: art-breakdown.md (drafting objects; the warm paper palette role #F3E9D2) and plan.md P4 materials row.',
  },
  'blueprint-paper': {
    tile_m: 0.5, look: 'deep blue blueprint paper, base #0B2A6B to #123A8C (the style block ground), fibre and cloud variation, a faint cyan-white grid (16 cells per tile, every 4th line a little stronger, 10 to 20 percent line weight, blended 0.55 toward #BFE8FF). No wing outlines, compass rose, scale bar or text: those are drawn at runtime into a render target (art-breakdown.md element 2)',
    input: 'procedural, no generated input. Reference: art-breakdown.md element 2 (deep blue blueprint paper with a faint grid) and lookdev/style-block.json palette ground.',
  },
  'brushed-aluminium': {
    tile_m: 0.25, look: 'brushed aluminium #C9CDD2 (the light-table-frame aluminium value), directional brush grain along x, metal 1.0, roughness 0.32 to 0.43',
    input: 'procedural, no generated input. Reference: the light-table-frame manifest (frame_aluminium #C9CDD2) and plan.md P4 materials row.',
  },
  'warm-wood': {
    tile_m: 0.5, look: 'warm wood, flat-sawn grain running along x, tones #C48B54 to #8A5A2B, 9 growth rings per tile, pores and fine streaks, roughness 0.55 to 0.72, no metal',
    input: 'procedural, no generated input. Reference: plan.md P4 materials row (warm wood) and the earlier frame_wood #B07A45 of light-table-frame.',
  },
};

for (const [id, info] of Object.entries(INFO)) {
  const dir = path.join(ROOT, 'apps', 'vr', 'ArtSource', 'mat-' + id);
  const M = S.materials[id];
  const all = files(dir);
  const sums = Object.fromEntries(all.map((f) => [f, sha(path.join(dir, f))]));
  const sizes = Object.fromEntries(all.map((f) => [f, fs.statSync(path.join(dir, f)).size]));
  const tex = all.filter((f) => f.startsWith('textures/'));
  const ev = all.filter((f) => f.startsWith('evidence/'));
  const oversize = all.filter((f) => sizes[f] >= MB10);
  const seamOk = Object.values(M).every((m) => m.pass) && tex.length === 3;
  const worst = Math.max(...Object.values(M).flatMap((m) => Object.values(m.seam).map((s) => s.ratio)));
  const largest = Math.max(...tex.map((f) => sizes[f]));
  const n = 'n/a for a material';
  const out = {
    id: 'mat-' + id,
    class: 'material',
    materials: [`${id}: PBR set, textures/${id}_basecolor.png (sRGB), ${id}_normal.png (OpenGL, +Y up, tangent space), ${id}_orm.png (R occlusion, G roughness, B metal)`],
    look: info.look,
    texture_size: S.size,
    tile_size_m: info.tile_m,
    tile_size_note: `one tile covers ${info.tile_m} m on a side at the intended scale; the repeat is the UE material's choice`,
    generator: 'procedural Blender',
    blender: 'Blender 5.2.2 (CPU, Cycles for the evidence), scripts/art/materials/build_materials.bpy (bake and seam check), render_materials.bpy (evidence), write_manifests.mjs',
    licence: 'own procedural work; no generated input, no Leonardo, ComfyUI or TRELLIS',
    lynx_commit: lynxCommit('mat-' + id),
    lynx_commit_note: 'stamped by the writer: the newest commit touching this folder when the manifest was written',
    regenerate: 'blender -b -P scripts/art/materials/build_materials.bpy -- <repo-root> <work>; blender -b -P scripts/art/materials/render_materials.bpy -- <repo-root> <work>; node scripts/art/materials/write_manifests.mjs <work>',
    files: sums,
    sha256: sums,
    gates: {
      input: gate(true, info.input),
      tiling: gate(seamOk, `seam check on the stored PNGs, per file and per axis: wrap = mean abs difference between the first and last pixel row/column (the pair that touches when the tile repeats), inner = mean abs difference between neighbouring pixels over the tile; pass when wrap / inner <= ${S.ratio_max}. Worst ratio over ${tex.length} files and 2 axes: ${worst}. Per-file values: ${JSON.stringify(M)}. Also evidence/tiled-2x2.jpg, a 2 x 2 repeat with the wrap seams through the middle of the image. Method: fields are periodic by construction (FFT-filtered noise, integer stripe counts, wrapped finite differences for the normal map).`),
      mesh_acceptance: gate(true, n),
      scale: gate(true, n),
      finishing: gate(seamOk && oversize.length === 0 && ev.length === 2, `3 PNGs at ${S.size} x ${S.size} (base colour, normal, ORM), largest ${largest} bytes, every file under 10 MB (limit ${MB10}); evidence: ${ev.join(', ')}, rendered with Cycles on the CPU (no GPU, no EEVEE); the evidence folder has the 2 x 2 tiled render and the lit swatch on a plane. Not claimed: any UE import.`),
      poly_budget: gate(true, n),
    },
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(id, seamOk, 'worst', worst);
}
