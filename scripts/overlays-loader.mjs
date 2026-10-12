// Module hooks for scripts/check-overlays.ts: lets Node load src/components (TSX, the `@/` alias, CSS and JSON
// imports) so an overlay can be server-rendered without a bundler. TypeScript is transpiled with the repo's own
// `typescript` (Node's type stripping cannot load parameter properties such as the ones in src/lib/model/aggregates.ts).
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

let SRC = '', ts = null, MUTATE = [];
export function initialize(data) {
  SRC = data.src; MUTATE = data.mutate || [];   // MUTATE: [file suffix, find, replace] literals, for seeding a control red
  ts = createRequire(path.join(data.root, 'package.json'))('typescript');
}

const isFile = (s) => s.startsWith('file:');
export async function resolve(spec, ctx, next) {
  let s = spec;
  if (s.startsWith('@/')) s = pathToFileURL(path.join(SRC, s.slice(2))).href;
  if ((isFile(s) || s.startsWith('.')) && !/\.(ts|tsx|js|mjs|json|jsonl|css)$/.test(s)) {
    const p0 = fileURLToPath(isFile(s) ? s : new URL(s, ctx.parentURL).href);
    for (const ext of ['.ts', '.tsx', path.sep + 'index.ts']) { if (fs.existsSync(p0 + ext)) return next(pathToFileURL(p0 + ext).href, ctx); }
  }
  if (/\.(jsonl|json|css)$/.test(s) && (isFile(s) || s.startsWith('.'))) return { url: isFile(s) ? s : new URL(s, ctx.parentURL).href, shortCircuit: true };
  return next(s, ctx);
}

export async function load(url, ctx, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {}', shortCircuit: true };
  if (url.endsWith('.jsonl')) return { format: 'module', source: 'export default ' + JSON.stringify(fs.readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
  if (url.endsWith('.json')) return { format: 'module', source: 'export default ' + fs.readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true };
  if (/\.tsx?$/.test(url)) {
    let src = fs.readFileSync(fileURLToPath(url), 'utf8');
    for (const [suffix, find, repl] of MUTATE) if (url.endsWith(suffix) && src.includes(find)) src = src.split(find).join(repl);
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false },
    });
    return { format: 'module', source: out.outputText, shortCircuit: true };
  }
  return next(url, ctx);
}
