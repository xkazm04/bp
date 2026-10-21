// The one place that knows what a route module exports: the HTTP methods of a core handler, read from the handler source
// itself (the real ground truth - a web mount's own re-export list is the thing being checked, never the thing checked
// against). Shared by scripts/check-route-guards.mjs (mount vs handler, both directions) and scripts/check-server.mjs (the
// running server's route table vs handler). Plain node (type stripping, no parameter properties); import with the .ts
// extension. `node scripts/lib/mounts.ts` runs the self-proof: the matcher must skip comments, strings and look-alikes.
import fs from 'node:fs';
import path from 'node:path';
import { blankComments } from './source.ts';

export const METHOD_NAMES = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const EXPORTED = new RegExp(String.raw`export\s+(?:async\s+)?function\s+(${METHOD_NAMES.join('|')})\b`, 'g');

/** HTTP methods a route module exports as functions, in source order. Comments are blanked first. */
export function exportedMethods(src: string): string[] {
  return [...blankComments(src).matchAll(EXPORTED)].map((m) => m[1]);
}

/** Every route.ts under a handler tree: rel path (forward slashes) -> its exported methods. */
export function routeMethods(root: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name === 'route.ts') out.set(path.relative(root, path.join(d, e.name)).split(path.sep).join('/'), exportedMethods(fs.readFileSync(path.join(d, e.name), 'utf8')));
    }
  };
  walk(root);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const cases: [string, string, string[]][] = [
    ['plain', 'export async function GET(req) {}\nexport function POST() {}', ['GET', 'POST']],
    ['in a line comment', '// export function DELETE() {}\nexport function GET() {}', ['GET']],
    ['in a block comment', '/* export async function PATCH() {} */\nexport function GET() {}', ['GET']],
    ['not a method name', 'export function GETX() {}\nexport function get() {}', []],
    ['not exported', 'function GET() {}', []],
  ];
  let bad = 0;
  for (const [what, src, want] of cases) {
    const got = exportedMethods(src);
    if (got.join() !== want.join()) { bad++; console.error(`FAIL ${what}: got [${got}] want [${want}]`); }
  }
  console.log(`mounts: ${cases.length - bad}/${cases.length} matcher cases hold`);
  process.exit(bad ? 1 : 0);
}
