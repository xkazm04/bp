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
    const file = fileURLToPath(url), text = fs.readFileSync(file, 'utf8');
    // Parse first: inlined as source, an empty or truncated .json fails as a SyntaxError about the generated module, with no file in it.
    if (url.endsWith('.json')) { try { JSON.parse(text); } catch (e) { throw new Error(file + ': ' + e.message, { cause: e }); } }
    return { format: 'module', source: 'export default ' + (url.endsWith('.json') ? text : JSON.stringify(text)), shortCircuit: true };
  }
  return next(url, ctx);
}
