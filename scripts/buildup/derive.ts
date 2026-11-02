// What an onboarding run already knows between its big steps, turned into the anti-stale build-up events
// (apps/web/src/buildup/contract.ts: survey, outline, activity, progress, provisional health). Pure functions over the
// documents adopt-bp writes, shared by the live harness (onboard-live.ts, reading files) and the tape replayer
// (replay-tape.ts, reading the copies a tape carries). docs/concepts/onboarding/feasibility.md section 5 is the design.
import type { ActivityVerb, Health, OutlineDomain, SurveyArea } from '../../apps/web/src/buildup/contract';

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A code area with the file paths it owns (the paths stay server-side: they only attribute activity). */
export interface AreaIndex { area: SurveyArea; paths: string[] }

/**
 * Code areas, in the order the run learns them: the curated context map and work/context-supplement.json (names,
 * groups, file lists) from the first minute, then work/inventory.json (files, lines, first and last commit) after seed.
 * An area the inventory has not reached keeps `lines`, `first` and `last` null.
 */
export function surveyFrom(contextMap: unknown, supplement: unknown, inventory: unknown): AreaIndex[] {
  const out = new Map<string, AreaIndex>();
  const add = (c: Json) => {
    const name = str(c.name); if (!name) return;
    const paths = arr(c.file_paths ?? c.filePaths).map(String);
    const prev = out.get(name);
    const all = prev ? [...new Set([...prev.paths, ...paths])] : paths;
    out.set(name, { area: { id: name, name, group: str(c.group) ?? prev?.area.group ?? null, files: all.length, lines: null, first: null, last: null }, paths: all });
  };
  for (const c of arr((contextMap as Json | null)?.contexts)) add(c);
  for (const g of arr((contextMap as Json | null)?.groups)) for (const c of arr(g.contexts)) add({ ...c, group: c.group ?? g.name });
  for (const c of arr((supplement as Json | null)?.contexts)) add(c);
  for (const c of arr((inventory as Json | null)?.contexts)) {
    const name = str(c.name); if (!name) continue;
    const prev = out.get(name);
    out.set(name, {
      area: { id: name, name, group: str(c.group) ?? prev?.area.group ?? null, files: num(c.files) ?? prev?.area.files ?? 0,
        lines: num(c.loc), first: str(c.first_commit), last: str(c.last_commit) },
      paths: prev?.paths ?? [],
    });
  }
  return [...out.values()];
}

const titleOf = (slug: string) => { const s = slug.replace(/[-_]+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : slug; };

/**
 * One decided domain from a work/product-tree.d/<NN>-<slug>.json file. The file is "one entry of the tree", which an
 * agent writes either as the domain itself or as a slice of the tree (`domain`/`domains`, `capabilities`); both are read.
 * The ids follow bp's plan projection: a wing is `0:<domain slug>`, a room is the capability slug.
 */
export function outlineFrom(file: string, doc: unknown, order: number): OutlineDomain {
  const base = file.replace(/\.json$/, '');
  const fileSlug = base.replace(/^\d+[-_]?/, '');
  const j = (doc ?? {}) as Json;
  const d = ((j.domain as Json | undefined) ?? arr(j.domains)[0] ?? j) as Json;
  const slug = str(d.slug) ?? fileSlug;
  const caps = arr(j.capabilities ?? d.capabilities).filter((c) => !str(c.domain) || c.domain === slug);
  return {
    id: `0:${slug}`, name: str(d.name) ?? titleOf(slug), order, summary: str(d.summary),
    capabilities: caps.map((c) => ({ id: str(c.slug) ?? String(c.id), name: str(c.name) ?? titleOf(String(c.slug ?? c.id)) })),
  };
}

/**
 * What one tool call touched, repo-relative. Paths outside the repo, the run's own .ai/lens-scan files, node_modules and
 * (when `exists` is given) paths the repo does not have are left out: a token in a shell command is only a guess.
 */
export function activityOf(tool: string, input: unknown, root: string, exists?: (rel: string) => boolean): { verb: ActivityVerb; path: string }[] {
  return activityRaw(tool, input, root).filter((h) => !/(^|\/)node_modules(\/|$)/.test(h.path) && (!exists || exists(h.path)));
}
function activityRaw(tool: string, input: unknown, root: string): { verb: ActivityVerb; path: string }[] {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\/([a-z])\//i, (_, d: string) => `${d.toUpperCase()}:/`);
  const R = norm(root).replace(/\/$/, '');
  const rel = (p: string): string | null => {
    let q = norm(p.replace(/^["']|["']$/g, ''));
    if (/^[a-z]:\//i.test(q)) { if (!q.toLowerCase().startsWith(R.toLowerCase() + '/')) return null; q = q.slice(R.length + 1); }
    q = q.replace(/^\.\//, '');
    if (!q || q.startsWith('..') || q.startsWith('.ai/') || q.startsWith('.git/') || /^[a-z]:/i.test(q)) return null;
    return q.replace(/[:;,)]+$/, '');
  };
  const i = (input ?? {}) as Json;
  const one = (v: unknown, verb: ActivityVerb) => { const p = typeof v === 'string' ? rel(v) : null; return p ? [{ verb, path: p }] : []; };
  if (tool === 'Read') return one(i.file_path, 'read');
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') return one(i.file_path, 'write');
  if (tool === 'Grep' || tool === 'Glob') return one(i.path, 'read');
  if (tool === 'Bash' && typeof i.command === 'string') {
    // `cd <dir>` sets the base for the relative tokens that follow; a token counts when it looks like a path with a slash
    const cmd = i.command;
    const cd = /(?:^|[;&|]\s*)cd\s+("[^"]+"|\S+)/.exec(cmd);
    const base = cd ? rel(cd[1]) ?? '' : '';
    const seen = new Set<string>();
    const out: { verb: ActivityVerb; path: string }[] = [];
    for (const m of cmd.matchAll(/(?:^|[\s"'=])((?:[A-Za-z]:|\/[a-z])?[\w.@-]*\/[\w./@*-]+)/g)) {
      const tok = m[1].replace(/\*.*$/, '').replace(/\/$/, '');
      if (!tok || /^\/(dev|tmp|usr|bin)\b/.test(tok) || tok.includes('lens-scan')) continue;
      const p = /^([A-Za-z]:|\/[a-z]\/)/.test(tok) ? rel(tok) : rel(base ? `${base}/${tok}` : tok);
      if (p && !seen.has(p)) { seen.add(p); out.push({ verb: 'run', path: p }); }
    }
    if (!out.length && base) out.push({ verb: 'run', path: base });
    return out;
  }
  return [];
}

/** The area that owns a path: the area listing it, else the one whose files share the longest directory prefix. */
export function areaOf(p: string, areas: AreaIndex[]): string | null {
  let best: string | null = null, bestLen = 0;
  for (const a of areas) for (const f of a.paths) {
    if (f === p) return a.area.id;
    const fd = f.split('/'), pd = p.split('/');
    let k = 0; while (k < fd.length - 1 && k < pd.length && fd[k] === pd[k]) k++;
    if (k > bestLen) { bestLen = k; best = a.area.id; }
  }
  return best;
}

/**
 * A provisional health reading per feature from one work/judgement/NN.json, before `adopt.mjs judge` merges it with the
 * static metrics. It reads only the judgement's own findings (security severities, development debt, design gaps), so
 * it can disagree with the final reading; the final, non-provisional health event replaces it.
 */
export function provisionalHealth(judgement: unknown): { id: string; general: Health }[] {
  const fs = ((judgement as Json | null)?.features ?? {}) as Record<string, Json>;
  return Object.entries(fs).map(([id, f]) => {
    const sec = (f.security ?? {}) as Json, dev = (f.development ?? {}) as Json, des = (f.design ?? {}) as Json;
    const n = (v: unknown) => num(v) ?? 0;
    const bad = n(sec.findingsCritical) + n(sec.findingsHigh) > 0 || n(dev.techDebt) >= 3;
    const watch = n(sec.findingsMedium) > 0 || n(dev.techDebt) >= 2 || n(dev.dupSites) >= 3 || n(des.undesignedStates) >= 3;
    return { id, general: bad ? 'bad' : watch ? 'watch' : 'good' };
  });
}
