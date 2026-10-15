// The release train's one parser door: every JSON payload of the triage, releases and commits routes enters the client
// through these, and `JSON.parse` lives nowhere else in the train's code. A validator answers the typed value or what
// was wrong with it (`<field>: <what>`); the fetch helpers in client.ts turn a failure into an Error. A value carries
// only the fields its type names (an unknown extra field stays out) and omits an absent one, never null.
import type { CommitDiff, Proposal, ProposalKind, ProposalSize, ProposalStatus, Release, ReleaseCreated, ReleaseStatus, TriageResult, VersionSuggestion } from '../scan/types.ts';
import type { JobKind, JobStatus, ReleaseStep, ScanJob, ScanScope, ScanScopeKind } from '../scan/jobs.ts';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// ------------------------------------------------------------------------------------------- readers
type Obj = Record<string, unknown>;
/** A field that is not what its type says; caught at the door and answered as `{ ok: false, error }`. */
class WireError extends Error {}
function fail(at: string, what: string): never { throw new WireError(at + ': ' + what); }
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const join = (at: string, k: string): string => (at ? at + '.' + k : k);

/** Runs a reader; a WireError becomes the failure, anything else is a bug and is rethrown. */
function door<T>(read: () => T): Parsed<T> {
  try { return { ok: true, value: read() }; } catch (e) {
    if (e instanceof WireError) return { ok: false, error: e.message };
    throw e;
  }
}

/** An enum as a record of its members: the type checks the list is complete. */
type Members<T extends string> = Record<T, true>;
function isMember<T extends string>(set: Members<T>, v: unknown): v is T {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(set, v);
}

function obj(x: unknown, at: string): Obj {
  if (!isObj(x)) fail(at || 'body', 'expected an object');
  return x;
}
function str(o: Obj, k: string, at: string): string {
  const v = o[k];
  if (typeof v !== 'string') fail(join(at, k), v === undefined ? 'missing' : 'expected a string');
  return v;
}
function optStr(o: Obj, k: string, at: string): string | undefined {
  return o[k] === undefined ? undefined : str(o, k, at);
}
function num(o: Obj, k: string, at: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(join(at, k), v === undefined ? 'missing' : 'expected a finite number');
  return v;
}
function optNum(o: Obj, k: string, at: string): number | undefined {
  return o[k] === undefined ? undefined : num(o, k, at);
}
function bool(o: Obj, k: string, at: string): boolean {
  const v = o[k];
  if (typeof v !== 'boolean') fail(join(at, k), v === undefined ? 'missing' : 'expected true or false');
  return v;
}
function member<T extends string>(set: Members<T>, o: Obj, k: string, at: string): T {
  const v = o[k];
  if (!isMember(set, v)) fail(join(at, k), v === undefined ? 'missing' : `expected one of ${Object.keys(set).join(', ')} (got ${JSON.stringify(v)})`);
  return v;
}
function optMember<T extends string>(set: Members<T>, o: Obj, k: string, at: string): T | undefined {
  return o[k] === undefined ? undefined : member(set, o, k, at);
}
function list<T>(o: Obj, k: string, at: string, item: (x: unknown, at: string) => T): T[] {
  const v = o[k], here = join(at, k);
  if (!Array.isArray(v)) fail(here, v === undefined ? 'missing' : 'expected an array');
  return v.map((x, i) => item(x, `${here}[${i}]`));
}
function optList<T>(o: Obj, k: string, at: string, item: (x: unknown, at: string) => T): T[] | undefined {
  return o[k] === undefined ? undefined : list(o, k, at, item);
}
const aString = (x: unknown, at: string): string => { if (typeof x !== 'string') fail(at, 'expected a string'); return x; };
/** Sets an optional field only when it has a value: absent stays absent. */
function put<T, K extends keyof T>(t: T, k: K, v: T[K] | undefined): void { if (v !== undefined) t[k] = v; }

// ------------------------------------------------------------------------------------------- enums
const PROPOSAL_STATUS: Members<ProposalStatus> = {
  proposed: true, approved: true, declined: true, executing: true, done: true, failed: true, accepted: true, rework: true, descoped: true, released: true,
};
const PROPOSAL_KIND: Members<ProposalKind> = { fix: true, 'baseline-upgrade': true, propagation: true };
const PROPOSAL_SIZE: Members<ProposalSize> = { XS: true, S: true, M: true, L: true, XL: true };
const RELEASE_STATUS: Members<ReleaseStatus> = { draft: true, building: true, 'pr-open': true, merged: true, tagged: true, failed: true };
const TRIAGED: Members<TriageResult['decision']> = { accepted: true, rework: true, descoped: true, reopened: true };
const JOB_KIND: Members<JobKind> = { measure: true, execute: true, release: true };
const JOB_STATUS: Members<JobStatus> = { queued: true, running: true, done: true, failed: true, cancelled: true };
const RELEASE_STEP: Members<ReleaseStep> = { build: true, finish: true };
const SCOPE_KIND: Members<ScanScopeKind> = { feature: true, bay: true, room: true, wing: true, all: true, selection: true };

// ------------------------------------------------------------------------------------------- shapes
type Skipped = { id: string; status: string; reason?: string };
function skipped(x: unknown, at: string): Skipped {
  const o = obj(x, at);
  const s: Skipped = { id: str(o, 'id', at), status: str(o, 'status', at) };
  put(s, 'reason', optStr(o, 'reason', at));
  return s;
}

function proposal(x: unknown, at: string): Proposal {
  const o = obj(x, at);
  const p: Proposal = {
    id: str(o, 'id', at), run_id: str(o, 'run_id', at), feature: str(o, 'feature', at), lens: str(o, 'lens', at),
    title: str(o, 'title', at), standard: str(o, 'standard', at), kind: member(PROPOSAL_KIND, o, 'kind', at),
    status: member(PROPOSAL_STATUS, o, 'status', at), created_at: str(o, 'created_at', at), updated_at: str(o, 'updated_at', at),
  };
  const texts = ['metric', 'body', 'parent_id', 'decided_by', 'decided_at', 'decision_note', 'result_sha', 'pack_id', 'commit_sha',
    'attempt_of', 'release_id', 'triage_note', 'triaged_by', 'triaged_at'] as const;
  for (const k of texts) put(p, k, optStr(o, k, at));
  for (const k of ['expected_delta', 'risk', 'after_value'] as const) put(p, k, optNum(o, k, at));
  put(p, 'size', optMember(PROPOSAL_SIZE, o, 'size', at));
  put(p, 'triaged_from', optMember(PROPOSAL_STATUS, o, 'triaged_from', at));
  return p;
}

function release(o: Obj, at: string): Release {
  const r: Release = {
    id: str(o, 'id', at), version: str(o, 'version', at), branch: str(o, 'branch', at), status: member(RELEASE_STATUS, o, 'status', at),
    created_at: str(o, 'created_at', at), updated_at: str(o, 'updated_at', at),
  };
  for (const k of ['base_sha', 'pr_url', 'tag', 'notes', 'error', 'created_by'] as const) put(r, k, optStr(o, k, at));
  return r;
}

function scope(x: unknown, at: string): ScanScope {
  const o = obj(x, at);
  const s: ScanScope = { kind: member(SCOPE_KIND, o, 'kind', at), label: str(o, 'label', at), features: list(o, 'features', at, aString) };
  put(s, 'id', optStr(o, 'id', at));
  return s;
}

function file(x: unknown, at: string): CommitDiff['files'][number] {
  const o = obj(x, at);
  return { path: str(o, 'path', at), add: num(o, 'add', at), del: num(o, 'del', at) };
}

// ------------------------------------------------------------------------------------------- the door
/** Parse a response body's text: the only JSON.parse of the train. */
export function parseJson(text: string): Parsed<unknown> {
  try { return { ok: true, value: JSON.parse(text) }; } catch (e) {
    return { ok: false, error: 'body: not JSON (' + (e instanceof Error ? e.message : String(e)) + ')' };
  }
}

/** store.mjs `triage` as the triage route answers it (200, or 409 when nothing moved). */
export function parseTriageResult(x: unknown): Parsed<TriageResult> {
  return door(() => {
    const o = obj(x, '');
    const r: TriageResult = {
      decision: member(TRIAGED, o, 'decision', ''), by: str(o, 'by', ''), triaged: list(o, 'triaged', '', aString),
      skipped: list(o, 'skipped', '', skipped), packs_triaged: list(o, 'packs_triaged', '', aString),
    };
    put(r, 'packs_reopened', optList(o, 'packs_reopened', '', aString));
    return r;
  });
}

/** `GET releases/suggest`. */
export function parseVersionSuggestion(x: unknown): Parsed<VersionSuggestion> {
  return door(() => {
    const o = obj(x, '');
    return { version: str(o, 'version', ''), from: str(o, 'from', ''), reason: str(o, 'reason', '') };
  });
}

/** `POST releases` (201): the draft with its items, what was added and what was left out. */
export function parseReleaseCreated(x: unknown): Parsed<ReleaseCreated> {
  return door(() => {
    const o = obj(x, ''), r = obj(o.release, 'release');
    return {
      release: { ...release(r, 'release'), items: list(r, 'items', 'release', proposal) },
      added: list(o, 'added', '', aString), skipped: list(o, 'skipped', '', skipped),
    };
  });
}

/** `GET commits/[sha]`. */
export function parseCommitDiff(x: unknown): Parsed<CommitDiff> {
  return door(() => {
    const o = obj(x, '');
    return {
      sha: str(o, 'sha', ''), message: str(o, 'message', ''), stat: str(o, 'stat', ''), files: list(o, 'files', '', file),
      patch: str(o, 'patch', ''), lines: num(o, 'lines', ''), truncated: bool(o, 'truncated', ''),
    };
  });
}

/** A job the release build and finish routes answer (202). */
export function parseScanJob(x: unknown): Parsed<ScanJob> {
  return door(() => {
    const o = obj(x, '');
    const j: ScanJob = { id: str(o, 'id', ''), kind: member(JOB_KIND, o, 'kind', ''), status: member(JOB_STATUS, o, 'status', ''), queued_at: str(o, 'queued_at', '') };
    for (const k of ['lens', 'release', 'version', 'started_at', 'ended_at', 'run_id', 'error', 'log_tail'] as const) put(j, k, optStr(o, k, ''));
    put(j, 'scope', o.scope === undefined ? undefined : scope(o.scope, 'scope'));
    put(j, 'proposals', optList(o, 'proposals', '', aString));
    put(j, 'step', optMember(RELEASE_STEP, o, 'step', ''));
    put(j, 'exit_code', optNum(o, 'exit_code', ''));
    return j;
  });
}

/** A route's `{ error }` text, if the body is one. */
export function errorText(x: unknown): string | undefined {
  return isObj(x) && typeof x.error === 'string' && x.error ? x.error : undefined;
}
