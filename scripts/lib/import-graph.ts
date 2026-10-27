// The web app's static import graph, walked from entry modules: the one walker the chunk laws share
// (scripts/check-train-budget.ts holds the ledger out of `/`, scripts/check-variant-chunk.ts the shaped and bold
// prototypes). Plain node (type stripping); import with the .ts extension. No TypeScript parameter properties.
//
// A module is "reached" when a chain of static value imports or re-exports leads to it (`import type` and
// `export type` erase); a "door" is an `import('./x')` in a reached module - the split point a bundler turns into a
// chunk of its own. The two sides are read differently on purpose:
//   dyn  is an expectation that must MATCH (a door exists), so it reads the source with its comments removed
//        (scripts/lib/source.ts): over raw text a commented-out `import('./ledger/LedgerPage')` is counted as the
//        door, and a check passes for a tree whose only door has been deleted. Both checks carry that control.
//   stat feeds an expectation that must NOT match (nothing reaches X statically), where a comment can only ADD a
//        reach - strictly conservative - and the shared stripper drops the newlines inside a block comment, which
//        would unanchor the per-line regex and HIDE a real static import. So it reads the file as written.
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from './source.ts';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const SRC = path.join(ROOT, 'apps/web/src');

const EXT = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
/** A specifier to a file under the app (`@/` or relative), or null for a package. */
export function resolveSpec(from: string, spec: string, src = SRC): string | null {
  const base = spec.startsWith('@/') ? path.join(src, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;   // a package
  for (const e of EXT) { const p = base + e; if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; }
  return null;
}
/** Static value imports and re-exports (`import type` and `export type` erase); the regex is anchored per line. */
export function statIn(file: string, src: string): string[] {
  const stat: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?([^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
    if (m[2]) continue;
    if (m[1] === 'export' && !m[3]) continue;
    const r = resolveSpec(file, m[4]); if (r) stat.push(r);
  }
  return stat;
}
/** The split points: every `import('./x')` (pass the source with its comments stripped). */
export const dynIn = (file: string, src: string): string[] => [...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].flatMap((m) => resolveSpec(file, m[1]) ?? []);
/** One module's edges: stat over the raw text, dyn over the comment-stripped text (see the header). */
export const staticDeps = (file: string, raw = fs.readFileSync(file, 'utf8')): { stat: string[]; dyn: string[] } =>
  ({ stat: statIn(file, raw), dyn: dynIn(file, stripComments(raw)) });

export interface Graph {
  /** every module a chain of static imports reaches from the entries (the entries included) */
  reached: Set<string>;
  /** door target -> the first reached module that imports it dynamically */
  doors: Map<string, string>;
  /** reached module -> the module that first imported it (entries have none) */
  via: Map<string, string>;
}
/**
 * Walk the static graph from `entries` (absolute paths; missing ones are skipped). `read` stands in for the file
 * system, so a control can walk a synthetic tree: the real one with one file's text replaced.
 */
export function walk(entries: string[], read: (file: string) => string = (f) => fs.readFileSync(f, 'utf8')): Graph {
  const reached = new Set<string>(), doors = new Map<string, string>(), via = new Map<string, string>();
  for (const todo = entries.filter((p) => fs.existsSync(p)); todo.length; ) {
    const f = todo.pop()!;
    if (reached.has(f)) continue;
    reached.add(f);
    const d = staticDeps(f, read(f));
    for (const x of d.stat) if (!reached.has(x)) { if (!via.has(x)) via.set(x, f); todo.push(x); }
    for (const x of d.dyn) if (!doors.has(x)) doors.set(x, f);
  }
  return { reached, doors, via };
}
/** A repo-relative path with forward slashes. */
export const rel = (p: string): string => path.relative(ROOT, p).split(path.sep).join('/');
/** The chain of imports from an entry to `file`, entry first. */
export function chain(g: Graph, file: string): string[] {
  const out = [file];
  for (let f = g.via.get(file); f && out.length < 64; f = g.via.get(f)) out.unshift(f);
  return out;
}
