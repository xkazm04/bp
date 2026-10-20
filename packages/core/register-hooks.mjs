// Module hooks installed by ./register.mjs (see there).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const tryFile = (p) => { for (const c of [p, p + '.ts', path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return null; };

export async function resolve(spec, ctx, next) {
  if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL?.startsWith('file:') && !/\.(ts|mjs|js|json|jsonl)$/.test(spec)) {
    const f = tryFile(path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  return next(spec, ctx);
}

export async function load(url, ctx, next) {
  if (url.startsWith('file:') && (url.endsWith('.json') || url.endsWith('.jsonl'))) {
    const text = fs.readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module', source: 'export default ' + (url.endsWith('.json') ? text : JSON.stringify(text)), shortCircuit: true };
  }
  return next(url, ctx);
}
