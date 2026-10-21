// Checks the release train's parser door (src/lib/train/wire.ts) on real route answers: each validator takes a good
// sample (copied from what scripts/check-scan-jobs.ts's routes answered, BP_SHOW_EXAMPLES=1) and answers it typed,
// with an unknown extra field left out and an absent one still absent; and refuses a bad one, naming the field
// (`<field>: <what>`). Plus parseJson (the train's only JSON.parse) and errorText.
// Run: node scripts/check-train-wire.ts  (Node's type stripping; no build step). Exit 1 on any failure.
import { errorText, parseCommitDiff, parseJson, parseReleaseCreated, parseScanJob, parseTriageResult, parseVersionSuggestion, parseWave, parseWaveBody, parseWaveDispatch, parseWavePackage, parseWaves, type Parsed } from '../packages/core/src/train/wire.ts';

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const clone = <T,>(x: T): T => structuredClone(x);
const good = <T,>(name: string, r: Parsed<T>, ok: (v: T) => boolean) => check(name + ' accepts the route answer', r.ok && ok(r.value), r.ok ? JSON.stringify(r.value).slice(0, 300) : r.error);
const bad = <T,>(name: string, r: Parsed<T>, field: RegExp) => check(name + ' refuses, naming ' + field.source, !r.ok && field.test(r.error), r.ok ? 'accepted' : r.error);

// ---- the samples (route answers)
const REOPENED = { decision: 'reopened', by: 'user:octocat', triaged: ['a3', 'a1'], skipped: [], packs_triaged: [], packs_reopened: ['k-dev-1'] };
const IN_RELEASE = { decision: 'reopened', by: 'user:octocat', triaged: [], skipped: [{ id: 'a1', status: 'accepted', reason: 'in-release' }], packs_triaged: [], packs_reopened: [] };
const SUGGEST = { version: '2.3.0', from: 'package.json', reason: 'no v* tag yet: the version package.json states' };
const ITEM = {
  id: 'a1', run_id: 'r0', feature: 'a', lens: 'development', metric: 'cov', title: 'item a1', standard: 'none', kind: 'fix', status: 'accepted',
  created_at: '2026-10-13T10:00:01.000Z', updated_at: '2026-10-15T16:48:14.200Z', pack_id: 'k-dev-1', commit_sha: 'a1'.repeat(20),
  release_id: 'rel-2.3.0', triaged_by: 'user:octocat', triaged_at: '2026-10-15T16:48:13.816Z', triaged_from: 'done',
};
const CREATED = {
  release: { id: 'rel-2.3.0', version: '2.3.0', branch: 'release/2.3.0', status: 'draft', created_by: 'user:octocat', created_at: '2026-10-15T16:48:14.018Z',
    updated_at: '2026-10-15T16:48:14.200Z', items: [ITEM, { ...ITEM, id: 'a2', title: 'item a2', commit_sha: 'a2'.repeat(20) }] },
  added: ['a1', 'a2'], skipped: [],
};
const JOB = { id: 'j-mv9rvv4u-00b1', kind: 'release', release: 'rel-2.3.0', version: '2.3.0', step: 'build', status: 'running', queued_at: '2026-10-15T16:48:14.430Z', started_at: '2026-10-15T16:48:14.430Z' };
const DIFF = {
  sha: '80e50d3d2702410843b346475c4cb6abdf179d8e', message: 'feat: x and a logo\n\nLens-Item: g1',
  stat: ' logo.png | Bin 0 -> 9 bytes\n src/x.ts |   3 +++\n 2 files changed, 3 insertions(+)',
  files: [{ path: 'logo.png', add: 0, del: 0 }, { path: 'src/x.ts', add: 3, del: 0 }],
  patch: 'diff --git a/src/x.ts b/src/x.ts\n+export const a = 1;', lines: 13, truncated: false,
};

// ---- parseJson, errorText
{
  const j = parseJson(JSON.stringify(REOPENED));
  check('parseJson parses a body', j.ok && JSON.stringify(j.value) === JSON.stringify(REOPENED));
  const n = parseJson('<html>502 Bad Gateway</html>');
  check('parseJson refuses a non-JSON body, saying so', !n.ok && /^body: not JSON/.test(n.error), n.ok ? 'accepted' : n.error);
  check('errorText reads { error }', errorText({ error: 'gh not authenticated' }) === 'gh not authenticated');
  check('errorText: none for a result, an empty error, a non-object', errorText(REOPENED) === undefined && errorText({ error: '' }) === undefined && errorText('x') === undefined && errorText(null) === undefined);
}

// ---- TriageResult
{
  good('parseTriageResult (reopen 200)', parseTriageResult(REOPENED), (v) => v.decision === 'reopened' && v.triaged.join() === 'a3,a1' && v.packs_reopened?.join() === 'k-dev-1');
  good('parseTriageResult (reopen 409 in-release)', parseTriageResult(IN_RELEASE), (v) => v.skipped[0].reason === 'in-release');
  good('parseTriageResult (no reason stays absent)', parseTriageResult({ ...IN_RELEASE, skipped: [{ id: 'a1', status: 'done' }] }), (v) => !('reason' in v.skipped[0]));
  bad('parseTriageResult (decision)', parseTriageResult({ ...REOPENED, decision: 'reopen' }), /^decision: expected one of/);
  const s = clone(IN_RELEASE) as { skipped: { status: unknown }[] }; s.skipped[0].status = 3;
  bad('parseTriageResult (skipped[0].status)', parseTriageResult(s), /^skipped\[0\]\.status: expected a string/);
  const { packs_triaged: _drop, ...noPacks } = REOPENED; void _drop;
  bad('parseTriageResult (packs_triaged)', parseTriageResult(noPacks), /^packs_triaged: missing/);
  bad('parseTriageResult (an array)', parseTriageResult([REOPENED]), /^body: expected an object/);
}

// ---- VersionSuggestion
good('parseVersionSuggestion', parseVersionSuggestion({ ...SUGGEST, extra: 1 }), (v) => v.version === '2.3.0' && !('extra' in v));
bad('parseVersionSuggestion (version)', parseVersionSuggestion({ ...SUGGEST, version: 230 }), /^version: expected a string/);

// ---- ReleaseCreated
{
  good('parseReleaseCreated', parseReleaseCreated(CREATED), (v) => v.release.items.length === 2 && v.release.items[0].triaged_from === 'done' && v.release.status === 'draft' && !('pr_url' in v.release));
  const s = clone(CREATED); s.release.items[1].status = 'shipped';
  bad('parseReleaseCreated (an item status)', parseReleaseCreated(s), /^release\.items\[1\]\.status: expected one of/);
  const t = clone(CREATED) as { release: { status: unknown } }; t.release.status = 'open';
  bad('parseReleaseCreated (release status)', parseReleaseCreated(t), /^release\.status: expected one of/);
  const r = clone(CREATED) as { release: { items: { risk?: unknown }[] } }; r.release.items[0].risk = 'high';
  bad('parseReleaseCreated (an item risk)', parseReleaseCreated(r), /^release\.items\[0\]\.risk: expected a finite number/);
  bad('parseReleaseCreated (release)', parseReleaseCreated({ ...CREATED, release: null }), /^release: expected an object/);
}

// ---- ScanJob
{
  good('parseScanJob (release build 202)', parseScanJob(JOB), (v) => v.kind === 'release' && v.step === 'build' && v.release === 'rel-2.3.0' && !('proposals' in v));
  good('parseScanJob (a measure job with its scope)', parseScanJob({ id: 'j1', kind: 'measure', lens: 'design', status: 'done', queued_at: 'x', exit_code: 0,
    scope: { kind: 'room', id: 'r1', label: 'Room', features: ['a'] } }), (v) => v.scope?.features[0] === 'a' && v.exit_code === 0);
  bad('parseScanJob (step)', parseScanJob({ ...JOB, step: 'cut' }), /^step: expected one of build, finish/);
  bad('parseScanJob (scope.features)', parseScanJob({ ...JOB, scope: { kind: 'all', label: 'Everything', features: [1] } }), /^scope\.features\[0\]: expected a string/);
  bad('parseScanJob (status)', parseScanJob({ ...JOB, status: undefined }), /^status: missing/);
}

// ---- CommitDiff
{
  good('parseCommitDiff', parseCommitDiff(DIFF), (v) => v.files[0].add === 0 && v.truncated === false && v.lines === 13);
  const f = clone(DIFF) as { files: { add: unknown }[] }; f.files[0].add = '-';
  bad('parseCommitDiff (files[0].add)', parseCommitDiff(f), /^files\[0\]\.add: expected a finite number/);
  bad('parseCommitDiff (truncated)', parseCommitDiff({ ...DIFF, truncated: 'no' }), /^truncated: expected true or false/);
  bad('parseCommitDiff (patch)', parseCommitDiff({ ...DIFF, patch: undefined }), /^patch: missing/);
}

// ---- the five wave parsers (parseWavePackage, parseWave, parseWaveBody, parseWaves, parseWaveDispatch)
// Frozen route answers (waves.server.ts: every wave carries its packages; a dispatched one its jobs). Each rejection row
// names the field it breaks; `kept` rows are malformed entries a parser takes WITHOUT saying so, counted rather than assumed.
{
  const PKG = { id: 'pk-1', name: 'Core', model: 'sonnet', effort: 'high', ids: ['a1', 'a2'] };
  const WAVE = { id: 'w-mv9rvv4u-00b1', name: 'Wave 1', status: 'dispatched', created_at: '2026-10-15T16:48:14.018Z', dispatched_at: '2026-10-15T16:50:00.000Z',
    packages: [PKG], jobs: [{ package: 'pk-1', job: 'j-mv9rvv4u-00b1' }] };
  const DISPATCH = { wave: WAVE, jobs: [{ ...JOB, kind: 'execute', step: undefined, release: undefined, version: undefined }], approved: ['a1'], skipped: [{ id: 'a2', status: 'failed' }] };
  good('parseWavePackage', parseWavePackage({ ...PKG, extra: 1 }), (v) => v.id === 'pk-1' && v.ids.join() === 'a1,a2' && !('extra' in v));
  good('parseWave', parseWave(WAVE), (v) => v.status === 'dispatched' && v.jobs?.[0].job === 'j-mv9rvv4u-00b1' && v.packages[0].model === 'sonnet');
  good('parseWave (a draft has no jobs and no dispatched_at)', parseWave({ ...WAVE, status: 'draft', dispatched_at: undefined, jobs: undefined }), (v) => !('jobs' in v) && !('dispatched_at' in v));
  good('parseWaveBody', parseWaveBody({ wave: WAVE }), (v) => v.id === WAVE.id);
  good('parseWaves', parseWaves({ waves: [WAVE, { ...WAVE, id: 'w-2' }] }), (v) => v.length === 2 && v[1].id === 'w-2');
  good('parseWaves (none)', parseWaves({ waves: [] }), (v) => v.length === 0);
  good('parseWaveDispatch', parseWaveDispatch(DISPATCH), (v) => v.jobs.length === 1 && v.approved.join() === 'a1' && v.skipped[0].status === 'failed');
  const without = (o: object, k: string) => { const c = clone(o) as Record<string, unknown>; delete c[k]; return c; };
  bad('parseWavePackage (id)', parseWavePackage(without(PKG, 'id')), /^id: missing/);
  bad('parseWavePackage (ids)', parseWavePackage({ ...PKG, ids: ['a1', 2] }), /^ids\[1\]: expected a string/);
  bad('parseWavePackage (model)', parseWavePackage({ ...PKG, model: 'haiku' }), /^model: expected one of sonnet, opus/);
  bad('parseWavePackage (effort)', parseWavePackage({ ...PKG, effort: 'max' }), /^effort: expected one of low, medium, high, xhigh/);
  bad('parseWave (status)', parseWave({ ...WAVE, status: 'done' }), /^status: expected one of draft, dispatched/);
  bad('parseWave (created_at)', parseWave(without(WAVE, 'created_at')), /^created_at: missing/);
  bad('parseWave (a package)', parseWave({ ...WAVE, packages: [{ ...PKG, model: 'haiku' }] }), /^packages\[0\]\.model: expected one of/);
  bad('parseWave (packages)', parseWave({ ...WAVE, packages: 'pk-1' }), /^packages: expected an array/);
  bad('parseWave (a jobs entry)', parseWave({ ...WAVE, jobs: [{ package: 'pk-1', job: 7 }] }), /^jobs\[0\]\.job: expected a string/);
  bad('parseWaveBody (wave)', parseWaveBody({ wave: null }), /^wave: expected an object/);
  bad('parseWaveBody (an array)', parseWaveBody([WAVE]), /^body: expected an object/);
  bad('parseWaves (waves)', parseWaves({ waves: 'none' }), /^waves: expected an array/);
  bad('parseWaves (one wave)', parseWaves({ waves: [WAVE, { ...WAVE, status: 'done' }] }), /^waves\[1\]\.status: expected one of/);
  bad('parseWaveDispatch (approved)', parseWaveDispatch({ ...DISPATCH, approved: [1] }), /^approved\[0\]: expected a string/);
  bad('parseWaveDispatch (a skipped status)', parseWaveDispatch({ ...DISPATCH, skipped: [{ id: 'a2', status: 3 }] }), /^skipped\[0\]\.status: expected a string/);
  bad('parseWaveDispatch (a job)', parseWaveDispatch({ ...DISPATCH, jobs: [{ id: 'j1' }] }), /^jobs\[0\]\.kind: missing/);
  bad('parseWaveDispatch (jobs)', parseWaveDispatch(without(DISPATCH, 'jobs')), /^jobs: missing/);
}

console.log(failed ? `check-train-wire: ${failed} failed, ${passed} passed` : `check-train-wire: ${passed} checks passed`);
process.exit(failed ? 1 : 0);
