// Fetches the Poly Haven CC0 texture scans the finished props are layered from, into a cache folder outside the repo.
// The scans are bake INPUT only: each prop ships its own baked basecolor, ORM and normal maps, never a scan file, and
// its manifest records the scan's page URL and licence (CC0, https://polyhaven.com/license). The API is free for
// commercial use (https://github.com/Poly-Haven/Public-API).
//   node scripts/art/lib/polyhaven.mjs <cache-dir> [<resolution 1k|2k>]
// Writes <cache-dir>/<id>/{diff,rough,nor_gl}.jpg and <cache-dir>/polyhaven.json (id -> source URLs, size in mm, authors).
// A file already in the cache is not fetched again.
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
export const pageUrl = (id) => `https://polyhaven.com/a/${id}`;
export const LICENCE = 'CC0 1.0 (Poly Haven, https://polyhaven.com/license)';

const isMain = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
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
