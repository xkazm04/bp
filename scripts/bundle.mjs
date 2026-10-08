#!/usr/bin/env node
// Turns each prototype page into a single self-contained file ready to publish as an Artifact.
//
//   node scripts/bundle.mjs [round-dir]     (default: every prototypes/round-* directory)
//
// - inlines every local <script src="..."> (shared data + model) so the page needs no sibling files
// - strips the document skeleton (doctype, html/head/body tags, charset + viewport metas), which the
//   Artifact host adds itself
// - writes dist/<round>/<variant>.html and warns when the <title> is not in the first 8KB
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTO = path.join(ROOT, 'prototypes');
const rounds = process.argv[2]
  ? [path.resolve(process.argv[2])]
  : fs.readdirSync(PROTO).filter((d) => d.startsWith('round-')).map((d) => path.join(PROTO, d));

for (const roundDir of rounds) {
  const round = path.basename(roundDir);
  const outDir = path.join(ROOT, 'dist', round);
  fs.mkdirSync(outDir, { recursive: true });
  for (const variant of fs.readdirSync(roundDir)) {
    const src = path.join(roundDir, variant, 'index.html');
    if (!fs.existsSync(src)) continue;
    let html = fs.readFileSync(src, 'utf8');

    html = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (tag, ref) => {
      if (/^https?:/.test(ref)) return tag;
      const file = path.resolve(path.dirname(src), ref);
      const code = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
      return `<script>/* ${path.relative(ROOT, file)} */\n${code}\n</script>`;
    });

    html = html
      .replace(/<!doctype[^>]*>/i, '')
      .replace(/<\/?html(\s[^>]*)?>/gi, '')
      .replace(/<\/?head(\s[^>]*)?>/gi, '')
      .replace(/<\/?body(\s[^>]*)?>/gi, '')
      .replace(/<meta\s+charset[^>]*>/gi, '')
      .replace(/<meta\s+name="viewport"[^>]*>/gi, '')
      .trim();

    const titleAt = html.search(/<title>/i);
    if (titleAt < 0 || titleAt > 8192) console.warn(`! ${round}/${variant}: <title> missing or past the first 8KB`);
    const out = path.join(outDir, `${variant}.html`);
    fs.writeFileSync(out, html + '\n');
    console.log(`${path.relative(ROOT, out)}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
  }
}
