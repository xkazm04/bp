// Verifies the mirror that packages/core/src/train/rules.ts TRIAGE_FROM claims: "store.mjs TRIAGE, plus v3 reopen".
// The table's owner is lens-scan's store.mjs (docs/blueprint-ui.md "store.mjs stays the single owner of the transition
// rules"), which lives OUTSIDE this tree. It is found the way release.server.ts finds it (storeScript(): BP_LENS_SCAN_DIR,
// ~/.claude/skills/lens-scan, then <registry.local>/skills/lens-scan from .ai/manifest.yaml), never at a fixed sibling path,
// and its `const TRIAGE = {...}` is READ out of the source (comments blanked first, so a comment cannot stand in for the
// table) and compared decision by decision with TRIAGE_FROM:
//   - the same set of decisions, and for each the same set of statuses it may start from.
// A decision store.mjs has and the mirror lacks (or the reverse), or one status more or less, is red, and the failure names the
// decision and both lists. When no store.mjs resolves: BP_LENS_SCAN_DIR set, BP_REQUIRE_LENS_SCAN=1 or CI -> FAIL (an
// operator who names a place must see it fail); otherwise a bare checkout without its registry prints a SKIP line, which
// the runner (scripts/check-all.mjs) tallies, so the gap is visible and not green. BP_REQUIRE_LENS_SCAN=0 waives.
// Run: node scripts/check-store-triage.ts   (Node type stripping; exit 1 on any failure)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { blankComments } from './lib/source.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = ''): void => { if (ok) passed++; else failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

/** `const TRIAGE = { decision: [target, [from...]], ... };` out of store.mjs's source: decision -> the statuses it starts from. Null when not found or not a literal. */
export function triageOf(source: string): Record<string, string[]> | null {
  const code = blankComments(source);
  const m = /\bconst\s+TRIAGE\s*=\s*(\{[\s\S]*?\n\})\s*;/.exec(code);
  if (!m) return null;
  try {
    const table = new Function(`"use strict"; return (${m[1]});`)() as Record<string, [unknown, unknown]>;
    const out: Record<string, string[]> = {};
    for (const [d, v] of Object.entries(table)) {
      if (!Array.isArray(v) || !Array.isArray(v[1]) || !v[1].every((s) => typeof s === 'string')) return null;
      out[d] = v[1] as string[];
    }
    return out;
  } catch { return null; }
}

/** The disagreements between the store's table and the mirror, as strings ([] when they agree as sets). */
export function triageProblems(store: Record<string, string[]>, mirror: Readonly<Record<string, readonly string[]>>): string[] {
  const out: string[] = [];
  for (const d of new Set([...Object.keys(store), ...Object.keys(mirror)])) {
    if (!(d in mirror)) { out.push(`store.mjs has decision "${d}" (from ${store[d].join('|')}) and TRIAGE_FROM has none`); continue; }
    if (!(d in store)) { out.push(`TRIAGE_FROM has decision "${d}" (from ${mirror[d].join('|')}) and store.mjs has none`); continue; }
    const a = [...new Set(store[d])].sort(), b = [...new Set(mirror[d])].sort();
    if (a.join() !== b.join()) out.push(`"${d}": store.mjs starts it from [${store[d].join(', ')}], TRIAGE_FROM from [${mirror[d].join(', ')}]`);
  }
  return out;
}

if (import.meta.main) {
  // release.server.ts imports extensionless; the hooks resolve them
  const HOOKS = './lib/src-hooks.mjs';
  ((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
  const { TRIAGE_FROM } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/train/rules.ts')).href) as typeof import('../packages/core/src/train/rules.ts');
  const RS = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/release.server.ts')).href) as typeof import('../packages/core/src/server/release.server.ts');
  const script = RS.storeScript();
  const named = process.env.BP_LENS_SCAN_DIR;
  const required = process.env.BP_REQUIRE_LENS_SCAN !== '0' && (process.env.BP_REQUIRE_LENS_SCAN === '1' || !!process.env.CI || named !== undefined);

  // The comparison logic is shown to see a difference without store.mjs at all, so a missing install cannot hide a vacuous differ.
  const base = { accept: ['done', 'failed'], reopen: ['accepted'] };
  check('control: the differ accepts equal tables (order-free)', triageProblems(base, { accept: ['failed', 'done'], reopen: ['accepted'] }).length === 0);
  check('control: the differ refuses a status more, a status fewer and a decision missing on either side',
    triageProblems(base, { ...base, accept: ['done'] }).length === 1 && triageProblems(base, { ...base, accept: ['done', 'failed', 'x'] }).length === 1
    && triageProblems(base, { accept: base.accept }).length === 1 && triageProblems({ accept: base.accept }, base).length === 1);
  check('control: the reader refuses a source with no TRIAGE literal, and reads one past a comment that fakes it',
    triageOf('const NOT = 1;') === null && JSON.stringify(triageOf('// const TRIAGE = { accept: [1, ["z"]] };\nconst TRIAGE = {\n  accept: [\'accepted\', [\'done\']],\n};\n')) === '{"accept":["done"]}');

  if (!script) {
    check('lens-scan store.mjs is found (BP_LENS_SCAN_DIR, ~/.claude/skills/lens-scan or the manifest\'s registry.local)', !required,
      'searched ' + (named !== undefined ? `BP_LENS_SCAN_DIR=${named}` : RS.lensScanDirs().join(' and ')) + ' - none holds scripts/store.mjs; BP_REQUIRE_LENS_SCAN=0 waives');
    if (!required) console.log('SKIP TRIAGE_FROM against store.mjs (lens-scan not installed here and nothing requires it; set BP_LENS_SCAN_DIR)');
  } else {
    const store = triageOf(fs.readFileSync(script, 'utf8'));
    check(`store.mjs's TRIAGE table is readable (${script})`, store !== null && Object.keys(store).length > 0);
    if (store) {
      const bad = triageProblems(store, TRIAGE_FROM);
      check(`TRIAGE_FROM mirrors store.mjs TRIAGE: ${Object.keys(store).length} decisions, each with the same starting statuses`, bad.length === 0, bad.join(' | '));
    }
  }
  console.log(`\ncheck-store-triage: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
