// What already landed on the base branch: a built item whose change is on main, read from git and never from the store
// (no column, no write; the store's status stays the store's). Pure, so the server hands it git's text
// (release.server.ts landings) and Node checks run it as-is (scripts/check-landed.ts).
//   trailer   a `Lens-Item: <id>` line anywhere in a commit message: git's own trailer parser skips one in a body
//             paragraph, and a landed commit carries it there too
//   patch-id  an item commit whose `git patch-id --stable` equals a base commit's: a cherry-pick or a squash whose
//             message lost the line (the server computes the ids; this only matches them)
//   revert    a later commit saying `This reverts commit <sha>` clears the landing it reverts; a revert of that revert
//             restores it. A revert's own message never lands anything.
// An id lands at its earliest commit still in effect. A root with no git, or a base git cannot read, is `unknown`:
// never "nothing landed".
import type { Measurement, Pack, Proposal } from './types.ts';

/** The `git log` format landedOf parses: sha, committer date, message; fields split by US, commits by RS. */
export const LOG_FORMAT = '%H%x1f%cI%x1f%B%x1e';
/** The most base commits read (and patch-id'd) per answer, and the most item commits matched by patch-id. */
export const LOG_CAP = 5000, PATCH_CAP = 200;

export interface LogCommit { sha: string; at: string; body: string }
export interface Landing {
  /** The commit on the base branch that carries the change. */
  sha: string;
  /** Its committer date (ISO). */
  at: string;
  /** How it was matched: its message names the item, or its patch equals the item commit's. */
  by: 'trailer' | 'patch-id';
}
export type LandedMap = Readonly<Record<string, Landing>>;
/** What git says landed: `known` with the base ref, the sha it was read at and the landings by proposal id, or `unknown`
 *  with why (no git, not a repository, no such ref). */
export type Landings = { state: 'known'; ref: string; head: string; items: LandedMap; ancestry?: Ancestry } | { state: 'unknown'; why: string };
/** Measured commit -> landing commit -> whether the first contains the second (`git merge-base --is-ancestor`), for the
 *  readings that could judge a landed item (ancestryAsks). A pair git could not answer is absent: never "contains". */
export type Ancestry = Readonly<Record<string, Readonly<Record<string, boolean>>>>;
/** The most ancestry pairs asked of git per answer (each answer is cached for good: ancestry never changes). */
export const ANCESTRY_CAP = 400;
/** Pre-computed patch-ids: proposal id -> its item commit's, and base commit sha -> its own. */
export interface PatchIds { items: ReadonlyMap<string, string>; base: ReadonlyMap<string, string> }

const ITEM = /^Lens-Item:[ \t]*(\S+)/gm;
const REVERTS = /This reverts commit ([0-9a-f]{7,40})/gi;

/** `git log --format=LOG_FORMAT` text as commits, in git's order (newest first). A record without a sha is dropped. */
export function parseLog(text: string): LogCommit[] {
  const out: LogCommit[] = [];
  for (const rec of text.split('\x1e')) {
    const [sha = '', at = '', body = ''] = rec.replace(/^\s+/, '').split('\x1f');
    if (/^[0-9a-f]{40}$/i.test(sha)) out.push({ sha: sha.toLowerCase(), at: at.trim(), body });
  }
  return out;
}

/** Proposal id -> where it landed, from the base branch's log (text or parsed) and, for ids no message names, patch-ids. */
export function landedOf(log: string | readonly LogCommit[], patch?: PatchIds): Record<string, Landing> {
  const commits = typeof log === 'string' ? parseLog(log) : log;
  const full = commits.map((c) => c.sha);
  const resolve = (s: string): string | undefined => { const x = s.toLowerCase(); return full.find((f) => f.startsWith(x)); };
  // who reverts whom (a revert names a commit before it; a prefix resolves against the log)
  const revertedBy = new Map<string, string[]>(), isRevert = new Set<string>();
  for (const c of commits) {
    for (const m of c.body.matchAll(REVERTS)) {
      const t = resolve(m[1]);
      if (!t || t === c.sha) continue;
      isRevert.add(c.sha);
      const a = revertedBy.get(t); if (a) a.push(c.sha); else revertedBy.set(t, [c.sha]);
    }
  }
  const memo = new Map<string, boolean>();
  const inEffect = (sha: string, depth = 0): boolean => {
    const k = memo.get(sha);
    if (k !== undefined) return k;
    const v = depth > 64 || !(revertedBy.get(sha) ?? []).some((r) => inEffect(r, depth + 1));
    memo.set(sha, v);
    return v;
  };
  const out: Record<string, Landing> = {};
  // oldest first: the first commit still in effect is where an id landed
  for (let i = commits.length - 1; i >= 0; i--) {
    const c = commits[i];
    if (isRevert.has(c.sha) || !inEffect(c.sha)) continue;
    for (const m of c.body.matchAll(ITEM)) if (!out[m[1]]) out[m[1]] = { sha: c.sha, at: c.at, by: 'trailer' };
  }
  if (patch?.items.size) {
    const byPid = new Map<string, LogCommit>();
    for (let i = commits.length - 1; i >= 0; i--) {
      const c = commits[i], pid = patch.base.get(c.sha);
      if (pid && !byPid.has(pid) && !isRevert.has(c.sha) && inEffect(c.sha)) byPid.set(pid, c);
    }
    for (const [id, pid] of patch.items) {
      const c = byPid.get(pid);
      if (c && !out[id]) out[id] = { sha: c.sha, at: c.at, by: 'patch-id' };
    }
  }
  return out;
}

/** The ref to read and where to start: the oldest pack's base_ref and base_sha (every pack forks from main after it);
 *  with no pack, HEAD from the top (LOG_CAP bounds it). */
export function baseOf(packs: readonly Pick<Pack, 'base_ref' | 'base_sha' | 'created_at' | 'id'>[]): { ref: string; since?: string } {
  let o: (typeof packs)[number] | undefined;
  for (const k of packs) if (!o || k.created_at < o.created_at || (k.created_at === o.created_at && k.id < o.id)) o = k;
  if (!o) return { ref: 'HEAD' };
  const ref = o.base_ref || 'HEAD';
  return o.base_sha && /^[0-9a-f]{7,40}$/i.test(o.base_sha) ? { ref, since: o.base_sha } : { ref };
}

/** The item commits worth a patch-id: a commit, and no message names the item. At most PATCH_CAP, newest rows first. */
export function patchCandidates(proposals: readonly Pick<Proposal, 'id' | 'commit_sha' | 'updated_at'>[], landed: LandedMap): { id: string; sha: string }[] {
  return proposals.filter((p) => !!p.commit_sha && /^[0-9a-f]{7,40}$/i.test(p.commit_sha) && !landed[p.id])
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
    .slice(0, PATCH_CAP).map((p) => ({ id: p.id, sha: p.commit_sha!.toLowerCase() }));
}

/** `git patch-id --stable` output ("<patch-id> <commit sha>" per line) as commit sha -> patch-id. */
export function parsePatchIds(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{40})\s+([0-9a-f]{40})\s*$/i.exec(line);
    if (m) out.set(m[2].toLowerCase(), m[1].toLowerCase());
  }
  return out;
}

/** The (landing, measured) commit pairs worth asking git about: each landed item's metric's current readings that record
 *  a commit (any reading on its feature + lens + metric with no proposal of its own), at most ANCESTRY_CAP, deduplicated. */
export function ancestryAsks(items: LandedMap, scan: { proposals: readonly Pick<Proposal, 'id' | 'feature' | 'lens' | 'metric'>[]; measurements?: readonly Pick<Measurement, 'feature' | 'lens' | 'metric' | 'commit_sha' | 'proposal_id'>[] }): { landing: string; measured: string }[] {
  if (!scan.measurements?.length) return [];
  const shas = new Map<string, Set<string>>();
  for (const m of scan.measurements) {
    if (!m.commit_sha || m.proposal_id || !/^[0-9a-f]{7,40}$/i.test(m.commit_sha)) continue;
    const k = m.feature + '|' + m.lens + '|' + m.metric;
    let s = shas.get(k); if (!s) shas.set(k, (s = new Set())); s.add(m.commit_sha.toLowerCase());
  }
  const out: { landing: string; measured: string }[] = [], seen = new Set<string>();
  for (const p of scan.proposals) {
    const l = landedIn(items, p.id), s = p.metric ? shas.get(p.feature + '|' + p.lens + '|' + p.metric) : undefined;
    if (!l || !s) continue;
    for (const measured of s) {
      const k = measured + ' ' + l.sha;
      if (seen.has(k)) continue;
      seen.add(k); out.push({ landing: l.sha, measured });
      if (out.length >= ANCESTRY_CAP) return out;
    }
  }
  return out;
}
/** The ancestry an answer carries as trackOf's lookup (TrackOpts.contains); undefined when it carries none. */
export function containsOf(l: Landings | null | undefined): ((landing: string, measured: string) => boolean | undefined) | undefined {
  const a = l?.state === 'known' ? l.ancestry : undefined;
  if (!a) return undefined;
  return (landing, measured) => { const r = a[measured.toLowerCase()]; return r && Object.prototype.hasOwnProperty.call(r, landing) ? r[landing] : undefined; };
}

/** Where an item landed in a map of landings (an own key only: ids are keys). */
export const landedIn = (m: LandedMap | undefined, id: string): Landing | undefined => (m && Object.prototype.hasOwnProperty.call(m, id) ? m[id] : undefined);
/** Where an item landed, when git was read and says so; undefined while unknown or not answered. */
export const landingOf = (l: Landings | null | undefined, id: string): Landing | undefined => (l?.state === 'known' ? landedIn(l.items, id) : undefined);
