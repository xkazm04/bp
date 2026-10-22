// Module hooks shared by check-stream-status.mjs and check-legacy-unmeasured.mjs: resolve the `@/` alias and
// extensionless relative imports to .ts/.tsx/index.ts, and load .json/.jsonl as default-export modules.
// (scripts/overlays-loader.mjs is a different loader: it also transpiles TSX and can mutate source.)
// Use: registerSrcHooks(ROOT) from scripts/lib/src-hooks.mjs, before the first import of src/.
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

let ROOT = '';
export function initialize(data) { ROOT = data.root; }

const tryFile = (p) => { for (const c of [p, p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return null; };
export async function resolve(spec, ctx, next) {
  let base = null;
  if (spec.startsWith('@/')) base = path.join(ROOT, 'apps/web/src', spec.slice(2));
  else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL?.startsWith('file:')) base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
  if (base) { const f = tryFile(base); if (f) return { url: pathToFileURL(f).href, shortCircuit: true, format: f.endsWith('.json') || f.endsWith('.jsonl') ? 'module' : undefined }; }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.endsWith('.json') || url.endsWith('.jsonl')) {
    const file = fileURLToPath(url), text = fs.readFileSync(file, 'utf8');
    // Parse first: inlined as source, an empty or truncated .json fails as a SyntaxError about the generated module, with no file in it.
    if (url.endsWith('.json')) { try { JSON.parse(text); } catch (e) { throw new Error(file + ': ' + e.message, { cause: e }); } }
    return { format: 'module', source: url.endsWith('.json') ? 'export default ' + text : 'export default ' + JSON.stringify(text), shortCircuit: true };
  }
  return next(url, { ...ctx, importAttributes: {} });
}

/** Install the hooks for `root` (the repo root). */
export const registerSrcHooks = (root) => register(import.meta.url, { data: { root } });
