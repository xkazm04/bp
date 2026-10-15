// The release train's one parser door (WP2 implements): every JSON payload of the triage, releases and commits routes
// enters the client through these, and `JSON.parse` lives nowhere else in the train's code. A validator answers the
// typed value or what was wrong with it; the fetch helpers in client.ts turn a failure into an Error.
import type { CommitDiff, ReleaseCreated, TriageResult, VersionSuggestion } from '../scan/types.ts';
import type { ScanJob } from '../scan/jobs.ts';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const todo = <T,>(): Parsed<T> => ({ ok: false, error: 'not implemented' });

/** Parse a response body's text: the only JSON.parse of the train. */
export function parseJson(text: string): Parsed<unknown> { void text; return todo(); }
export function parseTriageResult(x: unknown): Parsed<TriageResult> { void x; return todo(); }
export function parseVersionSuggestion(x: unknown): Parsed<VersionSuggestion> { void x; return todo(); }
export function parseReleaseCreated(x: unknown): Parsed<ReleaseCreated> { void x; return todo(); }
export function parseCommitDiff(x: unknown): Parsed<CommitDiff> { void x; return todo(); }
export function parseScanJob(x: unknown): Parsed<ScanJob> { void x; return todo(); }
/** A route's `{ error }` text, if the body is one. */
export function errorText(x: unknown): string | undefined { void x; return undefined; }
