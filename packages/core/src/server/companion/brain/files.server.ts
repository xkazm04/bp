// The brain's source of truth: one markdown file per memory, frontmatter first (each value one JSON literal, so it is also
// valid YAML and parses back exactly), the text as the body. Writes are atomic (a temp file beside the target, fsync, rename),
// so a killed write leaves the old file whole plus an orphan `*.tmp-*` that every reader ignores and a rebuild sweeps.
// The index is derived from what this file reads; nothing here touches it.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { episodePath, episodesDir, factPath, factsDir, FACT_KINDS, nowMs, proceduralsDir } from './paths.server.ts';

if (typeof window !== 'undefined') throw new Error('files.server.ts is server-only');

export type RecType = 'episode' | 'fact' | 'procedural';
/** One memory as stored. An episode's `text` is its reply and `input` the person's words; a fact's `text` is the claim. */
export interface Rec {
  id: string; type: RecType; kind: string; space: string; at: string; text: string;
  sources: string[]; importance: number; confidence: number; uses: number; lastUsed?: string; supersededBy?: string; device: string;
  input?: string; conversationId?: string; tools?: string[];
  slept?: string; sleepFails?: number; quarantined?: boolean; fadedAt?: string;
}

const ORDER: (keyof Rec)[] = ['id', 'type', 'kind', 'space', 'at', 'sources', 'importance', 'confidence', 'uses', 'lastUsed', 'supersededBy', 'device',
  'conversationId', 'tools', 'input', 'slept', 'sleepFails', 'quarantined', 'fadedAt'];

export function mintId(prefix: 'e' | 'f' | 'p'): string {
  const d = new Date(nowMs()).toISOString().replace(/[-:]/g, '');
  return `${prefix}-${d.slice(0, 8)}T${d.slice(9, 15)}-${randomBytes(3).toString('hex')}`;
}

export function render(meta: Record<string, unknown>, body: string): string {
  const lines = Object.entries(meta).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n${body.replace(/\s+$/, '')}\n`;
}

export function parse(src: string): { meta: Record<string, unknown>; body: string } | null {
  const s = src.replace(/\r\n/g, '\n');
  if (!s.startsWith('---\n')) return null;
  const end = s.indexOf('\n---\n', 3);
  if (end < 0) return null;
  const meta: Record<string, unknown> = {};
  for (const line of s.slice(4, end).split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const raw = line.slice(i + 1).trim();
    try { meta[line.slice(0, i).trim()] = JSON.parse(raw); } catch { meta[line.slice(0, i).trim()] = raw; }
  }
  return { meta, body: s.slice(end + 5).replace(/\n$/, '') };
}

/** Temp file in the same directory, fsync, rename over the target: a reader sees the old file or the new, never half. */
export function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* the orphan is swept later */ } throw e; }
}

export function recPath(r: Pick<Rec, 'id' | 'type' | 'kind'>): string {
  if (r.type === 'episode') { const p = episodePath(r.id); if (!p) throw new Error(`bad episode id ${r.id}`); return p; }
  return factPath(r.type === 'procedural' ? 'procedural' : r.kind, r.id);
}

export function writeRec(r: Rec): void {
  const meta: Record<string, unknown> = {};
  for (const k of ORDER) meta[k] = r[k];
  atomicWrite(recPath(r), render(meta, r.text));
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A file back to a memory; null when it is not one (no frontmatter, no id, an unknown type). */
export function readRec(file: string): Rec | null {
  let src: string;
  try { src = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const d = parse(src);
  if (!d) return null;
  const m = d.meta, id = str(m.id), type = str(m.type) as RecType | undefined;
  if (!id || (type !== 'episode' && type !== 'fact' && type !== 'procedural') || path.basename(file) !== `${id}.md`) return null;
  return {
    id, type, kind: str(m.kind) ?? (type === 'episode' ? 'episode' : 'project'), space: str(m.space) ?? 'core', at: str(m.at) ?? new Date(0).toISOString(),
    text: d.body.trim(), sources: Array.isArray(m.sources) ? m.sources.filter((x): x is string => typeof x === 'string') : [],
    importance: num(m.importance, 0), confidence: num(m.confidence, 0.7), uses: num(m.uses, 0), lastUsed: str(m.lastUsed),
    supersededBy: str(m.supersededBy), device: str(m.device) ?? '', input: typeof m.input === 'string' ? m.input : undefined,
    conversationId: str(m.conversationId), tools: Array.isArray(m.tools) ? m.tools.filter((x): x is string => typeof x === 'string') : undefined,
    slept: str(m.slept), sleepFails: typeof m.sleepFails === 'number' ? m.sleepFails : undefined, quarantined: m.quarantined === true || undefined,
    fadedAt: str(m.fadedAt),
  };
}

const mdFiles = (dir: string, deep: boolean): string[] => {
  let ents: fs.Dirent[];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return ents.flatMap((e) => (e.isDirectory() ? (deep ? mdFiles(path.join(dir, e.name), false) : []) : /\.md$/.test(e.name) ? [path.join(dir, e.name)] : []));
};

/** Every memory on disk, episodes then facts then procedurals; unreadable files are skipped and counted. */
export function readAll(): { recs: Rec[]; skipped: number } {
  const files = [...mdFiles(episodesDir(), true), ...FACT_KINDS.flatMap((k) => mdFiles(factsDir(k), false)), ...mdFiles(proceduralsDir(), false)];
  const recs: Rec[] = [];
  let skipped = 0;
  for (const f of files) { const r = readRec(f); if (r) recs.push(r); else skipped++; }
  return { recs, skipped };
}

/** Orphan temp files of killed writes older than a minute (a live write is milliseconds old). */
export function sweepTemps(dir: string, olderMs = 60_000): number {
  let n = 0;
  const walk = (d: string): void => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tmp-\d+-[0-9a-f]+$/.test(e.name)) {
        try { if (Date.now() - fs.statSync(p).mtimeMs > olderMs) { fs.rmSync(p, { force: true }); n++; } } catch { /* raced */ }
      }
    }
  };
  walk(dir);
  return n;
}
