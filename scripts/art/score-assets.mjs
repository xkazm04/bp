// Scores the final.glb of each asset in apps/vr/ArtSource: triangles, vertices, components, floaters, bounds in cm, UV presence.
// Exits 1 when an asset is over budget, has floaters, lacks one UV set, or breaks its scale/pivot rule.
// Pure Node (no dependency). Adapted from the PoF pofmetrics.py / gate.cjs checks (components by shared vertex, floaters, bounds).
//   node scripts/art/score-assets.mjs [--json] [survey-pin|fixture-kit ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ART = path.join(ROOT, 'apps', 'vr', 'ArtSource');

/** budget_tris is per mesh; footprintCm/heightCm are the scale rule; pivot says where the mesh origin must sit. */
export const ASSETS = {
  'survey-pin': {
    class: 'prop-instanced', budget_tris: 500, materials: 2, meshes: ['survey-pin'],
    // 5.45 cm tall with a 2.2 cm tag, so it stands about as tall as a tile is wide and never covers the next one
    scale: { heightCm: [4, 7], widthCm: [0.5, 6] }, pivot: 'tip',
  },
  'fixture-kit': {
    class: 'prop-instanced-kit', budget_tris: 300, materials: 2, meshes: ['user_flow', 'capability', 'ops', 'integration', 'generic'],
    scale: { heightCm: [1, 4], widthCm: [3, 6] }, pivot: 'base-centre', markSlot: 'mark',
  },
};
const EPS_M = 1e-4; // 0.1 mm

function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + file);
  let off = 12, json = null, bin = null;
  while (off < b.length) {
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  return { json, bin };
}

const COMP = { 5120: [1, Int8Array], 5121: [1, Uint8Array], 5122: [2, Int16Array], 5123: [2, Uint16Array], 5125: [4, Uint32Array], 5126: [4, Float32Array] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor({ json, bin }, idx) {
  const a = json.accessors[idx], bv = json.bufferViews[a.bufferView];
  const [size, Ctor] = COMP[a.componentType], n = NCOMP[a.type], stride = bv.byteStride || size * n;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0), out = new Ctor(a.count * n), dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
    const o = base + i * stride + k * size;
    out[i * n + k] = Ctor === Float32Array ? dv.getFloat32(o, true) : size === 4 ? dv.getUint32(o, true) : size === 2 ? (Ctor === Uint16Array ? dv.getUint16(o, true) : dv.getInt16(o, true)) : dv.getUint8(o);
  }
  return out;
}

function meshMetrics(glb, mesh) {
  const pos = [], tris = [];
  let uvSets = 0, hasUv = true;
  for (const p of mesh.primitives) {
    const P = accessor(glb, p.attributes.POSITION), base = pos.length / 3;
    for (const v of P) pos.push(v);
    const idx = p.indices !== undefined ? accessor(glb, p.indices) : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
    for (let i = 0; i < idx.length; i++) tris.push(base + idx[i]);
    const sets = Object.keys(p.attributes).filter((k) => /^TEXCOORD_\d+$/.test(k)).length;
    uvSets = Math.max(uvSets, sets); if (!p.attributes.TEXCOORD_0) hasUv = false;
  }
  // weld by position (the exporter splits vertices on normal/UV seams)
  const key = new Map(), map = new Int32Array(pos.length / 3);
  for (let i = 0; i < map.length; i++) {
    const k = [0, 1, 2].map((c) => Math.round(pos[i * 3 + c] * 1e6)).join(',');
    if (!key.has(k)) key.set(k, key.size);
    map[i] = key.get(k);
  }
  const nV = key.size, nT = tris.length / 3;
  const parent = Int32Array.from({ length: nV }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < nT; t++) {
    const a = map[tris[t * 3]], b = map[tris[t * 3 + 1]], c = map[tris[t * 3 + 2]];
    parent[find(b)] = find(a); parent[find(c)] = find(a);
  }
  const comps = new Map();
  for (let t = 0; t < nT; t++) {
    const r = find(map[tris[t * 3]]);
    if (!comps.has(r)) comps.set(r, { tris: 0, lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] });
    const c = comps.get(r); c.tris++;
    for (let k = 0; k < 3; k++) { const vi = tris[t * 3 + k]; for (let a = 0; a < 3; a++) { const v = pos[vi * 3 + a]; c.lo[a] = Math.min(c.lo[a], v); c.hi[a] = Math.max(c.hi[a], v); } }
  }
  const cs = [...comps.values()];
  const touch = (a, b) => [0, 1, 2].every((i) => a.lo[i] <= b.hi[i] + EPS_M && b.lo[i] <= a.hi[i] + EPS_M);
  // a floater is a component whose bounding box touches no other component (a part hanging in the air)
  const floaters = cs.length > 1 ? cs.filter((c) => !cs.some((o) => o !== c && touch(c, o))).length : 0;
  const lo = [0, 1, 2].map((i) => Math.min(...cs.map((c) => c.lo[i]))), hi = [0, 1, 2].map((i) => Math.max(...cs.map((c) => c.hi[i])));
  // glTF is Y-up: x width, y height, z depth
  const cm = (v) => Math.round(v * 1e4) / 100;
  return {
    tris: nT, vertices: nV, components: cs.length, floaters,
    bounds_cm: { x: cm(hi[0] - lo[0]), y: cm(hi[1] - lo[1]), z: cm(hi[2] - lo[2]) },
    min_cm: lo.map((v) => cm(v)), max_cm: hi.map((v) => cm(v)),
    uv: hasUv, uv_sets: uvSets,
  };
}

export function scoreAsset(id) {
  const spec = ASSETS[id], file = path.join(ART, id, 'final.glb');
  if (!fs.existsSync(file)) return { id, error: 'final.glb missing', pass: false, checks: {} };
  const glb = readGlb(file), j = glb.json;
  const nodes = j.nodes.filter((n) => n.mesh !== undefined);
  const meshes = nodes.map((n) => ({ name: n.name, ...meshMetrics(glb, j.meshes[n.mesh]), slots: j.meshes[n.mesh].primitives.map((p) => j.materials[p.material]?.name) }));
  const names = meshes.map((m) => m.name);
  const total = meshes.reduce((s, m) => s + m.tris, 0);
  const slotNames = [...new Set(meshes.flatMap((m) => m.slots))];
  const [h0, h1] = spec.scale.heightCm, [w0, w1] = spec.scale.widthCm;
  const checks = {
    meshes_present: spec.meshes.every((n) => names.includes(n)) && names.length === spec.meshes.length,
    poly_budget: meshes.every((m) => m.tris <= spec.budget_tris),
    no_floaters: meshes.every((m) => m.floaters === 0),
    one_uv_set: meshes.every((m) => m.uv && m.uv_sets === 1),
    materials: slotNames.length === spec.materials && (!spec.markSlot || slotNames.includes(spec.markSlot)),
    scale: meshes.every((m) => m.bounds_cm.y >= h0 && m.bounds_cm.y <= h1 && Math.max(m.bounds_cm.x, m.bounds_cm.z) >= w0 && Math.max(m.bounds_cm.x, m.bounds_cm.z) <= w1),
  };
  if (spec.pivot === 'tip') checks.pivot = meshes.every((m) => Math.abs(m.min_cm[1]) < 0.01 && m.min_cm[0] <= 0 && m.max_cm[0] >= 0 && m.min_cm[2] <= 0 && m.max_cm[2] >= 0);
  else checks.pivot = meshes.every((m) => Math.abs(m.min_cm[1]) < 0.01 && Math.abs(m.min_cm[0] + m.max_cm[0]) < 1.5 && Math.abs(m.min_cm[2] + m.max_cm[2]) < 1.5);
  const bytes = fs.statSync(file).size;
  checks.file_size = bytes < 10 * 1024 * 1024;
  return { id, class: spec.class, budget_tris: spec.budget_tris, tris_total: total, meshes, materials: slotNames, checks, bytes, pass: Object.values(checks).every(Boolean) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), json = args.includes('--json');
  const ids = args.filter((a) => !a.startsWith('--')), list = ids.length ? ids : Object.keys(ASSETS);
  const res = list.map(scoreAsset);
  if (json) console.log(JSON.stringify(res, null, 2));
  else for (const r of res) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id}: ${r.error ?? `${r.tris_total} tris total, budget ${r.budget_tris} per mesh, materials ${r.materials.join('+')}`}`);
    for (const m of r.meshes ?? []) console.log(`  ${m.name}: tris ${m.tris}, verts ${m.vertices}, components ${m.components}, floaters ${m.floaters}, bounds ${m.bounds_cm.x}x${m.bounds_cm.y}x${m.bounds_cm.z} cm (x,y up,z), uv ${m.uv ? m.uv_sets + ' set' : 'none'}`);
    for (const [k, v] of Object.entries(r.checks)) if (!v) console.log(`  FAILED ${k}`);
  }
  process.exit(res.every((r) => r.pass) ? 0 : 1);
}
