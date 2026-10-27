// The checks' one module loader. It resolves the `@/` alias and extensionless relative imports to
// .ts/.tsx/index.ts, and loads .json/.jsonl as default-export modules (a .json is parsed first, so a broken one
// fails naming the file). Two modes:
//   - strip (default): Node's own type stripping loads .ts; no .tsx, no parameter properties.
//   - transpile: .ts/.tsx go through the repo's own `typescript` (JSX, parameter properties, enums), .css imports
//     load as an empty module, and `mutate` ([file suffix, find, replace] literals) rewrites a source before it is
//     transpiled - how the BP_*_MUTATE seeded controls turn a check red.
// scripts/overlays-loader.mjs is a shim over this file in transpile mode, kept for its 29 register() call sites.
// packages/core/register-hooks.mjs (apps/server's loader) stays separate on purpose; see packages/core/register.mjs.
// Use: registerSrcHooks(ROOT[, { transpile, mutate, src }]) from scripts/lib/src-hooks.mjs, before the first
// import of src/. One registration per process: the hook state is this module's, shared by the shim.
import fs from 'node:fs';
import path from 'node:path';
import { register, createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

let ROOT = '', SRC = '', ts = null, MUTATE = [];
/** data: { root, src? (the `@/` target, default <root>/apps/web/src), transpile?, mutate? } */
export function initialize(data) {
  ROOT = data.root;
  SRC = data.src || path.join(ROOT, 'apps/web/src');
  MUTATE = data.mutate || [];
  if (MUTATE.length && !data.transpile) throw new Error('src-hooks: mutate needs { transpile: true }');
  ts = data.transpile ? createRequire(path.join(ROOT, 'package.json'))('typescript') : null;
}

const tryFile = (p) => { for (const c of [p, p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return null; };
const HAS_EXT = /\.(ts|tsx|js|mjs|cjs|json|jsonl|css)$/;
export async function resolve(spec, ctx, next) {
  let base = null;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL?.startsWith('file:')) base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
  else if (ts && spec.startsWith('file:') && !HAS_EXT.test(spec)) base = fileURLToPath(spec); // overlays-loader parity
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
  if (ts && url.endsWith('.css')) return { format: 'module', source: 'export default {}', shortCircuit: true };
  if (ts && url.startsWith('file:') && /\.tsx?$/.test(url)) {
    const file = fileURLToPath(url);
    let src = fs.readFileSync(file, 'utf8');
    for (const [suffix, find, repl] of MUTATE) if (url.endsWith(suffix) && src.includes(find)) src = src.split(find).join(repl);
    const out = ts.transpileModule(src, {
      fileName: file, // a .ts file parses as TypeScript, not TSX (`<T>(x) =>` is a generic there, not a tag)
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false },
    });
    return { format: 'module', source: out.outputText, shortCircuit: true };
  }
  return next(url, { ...ctx, importAttributes: {} });
}

/** Install the hooks for `root` (the repo root); opts: { transpile?, mutate?, src? } as initialize() takes them. */
export const registerSrcHooks = (root, opts = {}) => register(import.meta.url, { data: { root, ...opts } });
