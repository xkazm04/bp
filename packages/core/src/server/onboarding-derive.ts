// What an onboarding run already knows between its big steps, turned into the anti-stale build-up events
// (apps/web/src/buildup/contract.ts: survey, outline, activity, progress, provisional health, narration).
// Pure: functions over the documents adopt-bp writes, shared by the server's adopt job (onboarding-feed.server.ts, reading files), the live
// harness (scripts/buildup/onboard-live.ts) and the tape replayer (scripts/buildup/replay-tape.ts, reading the copies a
// tape carries); scripts/buildup/derive.ts re-exports this file. docs/concepts/onboarding/feasibility.md section 5 is the design.
import { isBuildupPhase, type ActivityVerb, type BuildupPhase, type Health, type OutlineDomain, type SurveyArea } from '../scan/onboarding.ts';

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

// ------------------------------------------------------------------------------------ the narration channel
// adopt-bp (1.6.0) appends `work/progress.jsonl` as it works, one JSON object per line, never rewritten:
//   {"kind":"domain","slug","name","summary","capabilities":[{"slug","name"}]}   the moment a domain is decided
//   {"kind":"step","phase","text","next"}                                        what it is doing now, what comes next
//   {"kind":"batch","n","of","features":[<slug>...]}                             a judgement batch dispatched
// ProgressTail reads what was appended since the last look (a byte offset), so a watcher polling once a second sees each
// line once; a last line without its newline is kept for the next look unless it already parses (an agent that writes
// its last line without one). A file that shrank was rewritten: it is read again from the start, and a line seen before
// is not reported twice (a model that rewrites the whole file instead of appending sends nothing twice).

/** What one progress line says, in the build-up's words: a decided domain (an `outline`) or a narration line. */
export type ProgressItem =
  | { kind: 'domain'; domain: OutlineDomain }
  | { kind: 'narration'; phase: BuildupPhase; text: string; next: string | null; features: string[] | null };

const line1 = (v: unknown, max = 240): string | null => {
  const s = str(v); if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

/** One parsed progress record as a ProgressItem; null for a line it cannot use. `order`: the domain's place in the outline;
 *  `phase`: the run's phase now, for a step line whose own phase is missing or not a contract phase. */
export function progressItem(rec: unknown, order: number, phase: BuildupPhase): ProgressItem | null {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const r = rec as Json;
  if (r.kind === 'domain') {
    const slug = str(r.slug); if (!slug) return null;
    return { kind: 'domain', domain: outlineFrom(`${slug}.json`, { slug, name: r.name, summary: r.summary, capabilities: arr(r.capabilities).filter((c) => str(c.slug) || str(c.id)) }, order) };
  }
  if (r.kind === 'step') {
    const text = line1(r.text); if (!text) return null;
    return { kind: 'narration', phase: isBuildupPhase(r.phase) ? r.phase : phase, text, next: line1(r.next), features: null };
  }
  if (r.kind === 'batch') {
    const n = num(r.n), of = num(r.of);
    const features = arr(r.features as unknown).map((f) => (typeof f === 'string' ? f : str((f as Json)?.slug))).filter((f): f is string => !!f && !!f.trim()).slice(0, 64);
    if (n === null && !features.length) return null;
    return { kind: 'narration', phase: 'judge', text: n === null ? 'Judging a batch' : of !== null ? `Judging batch ${n} of ${of}` : `Judging batch ${n}`, next: null, features };
  }
  return null;
}

/** The unread tail of work/progress.jsonl. `offset`: bytes already read (start a job's tail at the file's size then, so an
 *  earlier run's lines stay unread). */
export class ProgressTail {
  offset: number;
  private seen = new Set<string>();
  private domains = 0;
  constructor(offset = 0) { this.offset = Math.max(0, offset); }
  /**
   * The items appended since the last call. `size`: the file's size now (0 when absent); `read(from, to)`: its bytes in
   * [from, to). `phase`: the run's phase now (for a step line that names none).
   */
  next(size: number, read: (from: number, to: number) => Uint8Array, phase: BuildupPhase): ProgressItem[] {
    if (size < this.offset) this.offset = 0; // rewritten shorter: read again, `seen` drops the repeats
    if (size === this.offset) return [];
    const buf = read(this.offset, size);
    const nl = buf.lastIndexOf(0x0a) + 1; // up to the last whole line
    const dec = new TextDecoder();
    const whole = dec.decode(buf.subarray(0, nl)), tail = dec.decode(buf.subarray(nl)).trim();
    let tailRec: unknown = undefined;
    if (tail) { try { tailRec = JSON.parse(tail); } catch { /* half-written: the next look */ } }
    this.offset += tailRec === undefined ? nl : buf.length;
    const out: ProgressItem[] = [];
    const take = (raw: string, rec: unknown) => {
      const key = raw.trim();
      if (!key || this.seen.has(key)) return;
      this.seen.add(key);
      const it = progressItem(rec, this.domains, phase);
      if (!it) return;
      if (it.kind === 'domain') this.domains++;
      out.push(it);
    };
    for (const l of whole.split('\n')) {
      if (!l.trim()) continue;
      let rec: unknown; try { rec = JSON.parse(l); } catch { continue; } // a broken line in the middle: skipped
      take(l, rec);
    }
    if (tailRec !== undefined) take(tail, tailRec);
    return out;
  }
}
