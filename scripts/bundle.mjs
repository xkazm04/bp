#!/usr/bin/env node
// Turns each prototype page into a single self-contained file ready to publish as an Artifact.
//
//   node scripts/bundle.mjs [round-dir] [variant]   (default: every prototypes/round-* directory, every variant)
//
// - inlines every local <script src="..."> (shared data + model) so the page needs no sibling files
// - strips the document skeleton (doctype, html/head/body tags, charset + viewport metas), which the
//   Artifact host adds itself
// - writes dist/<round>/<variant>.html and warns when the <title> is not in the first 8KB
// - writes dist/<round>/<variant>.host-preview.html: the same page inside a copy of the host's skeleton
//   and reset, so the publishable file can be screenshot-tested as the viewer will render it
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Approximation of the skeleton and reset the Artifact host wraps around a published page.
const HOST_SKELETON = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px/1.45 system-ui,-apple-system,sans-serif;background:#f7f7f5}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
%CONTENT%
</body></html>
`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTO = path.join(ROOT, 'prototypes');
const rounds = process.argv[2]
  ? [path.resolve(process.argv[2])]
  : fs.readdirSync(PROTO).filter((d) => d.startsWith('round-')).map((d) => path.join(PROTO, d));

for (const roundDir of rounds) {
  const round = path.basename(roundDir);
  const outDir = path.join(ROOT, 'dist', round);
  fs.mkdirSync(outDir, { recursive: true });
  const only = process.argv[3];
  for (const variant of fs.readdirSync(roundDir)) {
    if (only && variant !== only) continue;
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
    fs.writeFileSync(out.replace(/\.html$/, '.host-preview.html'), HOST_SKELETON.replace('%CONTENT%', () => html));
    console.log(`${path.relative(ROOT, out)}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
  }
}
