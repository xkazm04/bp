// Fetches the Poly Haven CC0 texture scans the finished props are layered from, into a cache folder outside the repo.
// The scans are bake INPUT only: each prop ships its own baked basecolor, ORM and normal maps, never a scan file, and
// its manifest records the scan's page URL and licence (CC0, https://polyhaven.com/license). The API is free for
// commercial use (https://github.com/Poly-Haven/Public-API).
//   node scripts/art/lib/polyhaven.mjs <cache-dir> [<resolution 1k|2k>] [--models]
// Writes <cache-dir>/<id>/{diff,rough,nor_gl}.jpg and <cache-dir>/polyhaven.json (id -> source URLs, size in mm, authors).
// A file already in the cache is not fetched again.
// With --models, it fetches the CC0 MODELS the studio kits are dressed from instead (glTF at the given resolution, with
// its textures): <cache-dir>/models/<id>/<id>_<res>.gltf and its includes, plus <cache-dir>/models/models.json. Like the
// scans they are bake input: a kit re-bakes their surfaces into its own atlas and ships no Poly Haven file.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { argsOrUsage } from './manifest-kit.mjs';

/** The scans, by what they are used for. `size_mm` comes from the API (the real-world width of one tile). */
export const SCANS = {
  fine_grained_wood: 'stained wood: shelf boards, frame mouldings, the lamp base insert',
  blue_metal_plate: 'painted and bare metal: the colour breakup, roughness smudges and micro normal under every metal (2.5 m tile)',
  fabric_leather_02: 'book cloth and leather spines',
};
/** The models, by where the studio kits use them (scripts/art/studio-kit/build_kits.bpy). */
export const MODELS = {
  binder_notebook: 'studio-desk-clutter: a leather binder with a paper stack and a pen',
  office_notepads: 'studio-desk-clutter: notepads',
  stationery_supplies: 'studio-desk-clutter: pens, a stapler and supplies',
};
export const pageUrl = (id) => `https://polyhaven.com/a/${id}`;
export const LICENCE = 'CC0 1.0 (Poly Haven, https://polyhaven.com/license)';

const isMain = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
async function fetchModels(cache, res) {
  const dir0 = path.join(cache, 'models');
  const index = {};
  for (const id of Object.keys(MODELS)) {
    const info = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
    const g = (await (await fetch(`https://api.polyhaven.com/files/${id}`)).json()).gltf?.[res]?.gltf;
    if (!g?.url) throw new Error(`${id}: no ${res} glTF`);
    const dir = path.join(dir0, id);
    fs.mkdirSync(path.join(dir, 'textures'), { recursive: true });
    const files = { [path.basename(new URL(g.url).pathname)]: g.url, ...Object.fromEntries(Object.entries(g.include ?? {}).map(([k, v]) => [k, v.url])) };
    for (const [rel, url] of Object.entries(files)) {
      const out = path.join(dir, rel);
      if (!fs.existsSync(out)) fs.writeFileSync(out, Buffer.from(await (await fetch(url)).arrayBuffer()));
    }
    index[id] = { page: pageUrl(id), licence: LICENCE, authors: info.authors ?? null, date_published: info.date_published ?? null,
      polycount: info.polycount ?? null, dimensions_mm: info.dimensions ?? null, use: MODELS[id], gltf: path.basename(new URL(g.url).pathname), files };
    console.log(id, 'ok', info.polycount);
  }
  fs.writeFileSync(path.join(dir0, 'models.json'), JSON.stringify(index, null, 2) + '\n');
}

if (isMain && process.argv.includes('--models')) {
  const [cache, res = '1k'] = argsOrUsage(1, 'node scripts/art/lib/polyhaven.mjs <cache-dir> [1k|2k] --models').filter((a) => a !== '--models');
  await fetchModels(cache, res);
} else if (isMain) {
  const [cache, res = '2k'] = argsOrUsage(1, 'node scripts/art/lib/polyhaven.mjs <cache-dir> [1k|2k]');
  fs.mkdirSync(cache, { recursive: true });
  const index = {};
  const all = await (await fetch('https://api.polyhaven.com/assets?t=textures')).json();
  for (const id of Object.keys(SCANS)) {
    const meta = all[id];
    const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
    const pick = { diff: files.Diffuse, rough: files.Rough, nor_gl: files.nor_gl };
    const dir = path.join(cache, id);
    fs.mkdirSync(dir, { recursive: true });
    index[id] = { page: pageUrl(id), licence: LICENCE, size_mm: meta?.dimensions ?? null, authors: meta?.authors ?? null, use: SCANS[id], files: {} };
    for (const [k, v] of Object.entries(pick)) {
      const url = v?.[res]?.jpg?.url;
      if (!url) throw new Error(`${id}: no ${res} jpg for ${k}`);
      const out = path.join(dir, `${k}.jpg`);
      if (!fs.existsSync(out)) fs.writeFileSync(out, Buffer.from(await (await fetch(url)).arrayBuffer()));
      index[id].files[k] = url;
    }
    console.log(id, 'ok', index[id].size_mm);
  }
  fs.writeFileSync(path.join(cache, 'polyhaven.json'), JSON.stringify(index, null, 2) + '\n');
}
