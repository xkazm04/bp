// Client side of a live product: fetch its structure, follow its scan store over SSE, decide proposals,
// and turn a scan into the swarm feed the canvas already draws. Browser-only; the server half is
// store.server.ts and the routes under src/app/api/products.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AppStructure, LensEntry, LensManifest } from '@bp/core/standard/types';
import { refreshProjects, statusOfStore, storeFromList } from './projects.ts';
import { latestRun } from '@bp/core/scan/derive';
import type { ScanJob, ScanScope } from '@bp/core/scan/jobs';
import type { DispatchResult } from './actions.ts';
import type { Wave, WaveBody, WaveDispatchResult } from '@bp/core/scan/waves';
import { fullScan as full, isEmptyScan as isEmpty, type DecisionBody, type Proposal, type ScanSnapshot } from '@bp/core/scan/types';
import type { CommitDiff, ReleaseCreated, TriageBody, TriageResult, VersionSuggestion } from '@bp/core/scan/types';
import type { ReleaseReady } from '@bp/core/model/scan-sim';
import { errorText, parseCommitDiff, parseJson, parseReleaseCreated, parseScanJob, parseTriageResult, parseVersionSuggestion, parseWaveBody, parseWaveDispatch, parseWaves, type Parsed } from '@bp/core/train/wire';
import { mergeScan } from '@bp/core/scan/merge';

export { mergeScan, upsert } from '@bp/core/scan/merge';
export { parseWave, parseWaveDispatch, parseWavePackage, parseWaves } from '@bp/core/train/wire';

/** `loading` until the structure arrives; `missing` = no store or structure file; `offline` = reconnecting. */
export type LiveStatus = 'loading' | 'live' | 'offline' | 'missing' | 'error';

export interface LiveProduct {
  status: LiveStatus;
  /** The latest map the server answered with. */
  structure?: AppStructure;
  /** Counts the maps taken (1 = the first): the app refreshes its model in place when this moves, never rebuilds it. */
  structureRev?: number;
  /** The product's events log text, '' when it has none. */
  events: string;
  scan?: ScanSnapshot;
  /** The blueprint's scan jobs for this product (the stream's `jobs` event; [] before one). It moves on discrete
   *  changes only (a job added, a status, a run attached); a log line alone reaches `useLiveJobs`, not this. */
  jobs: ScanJob[];
  error?: string;
}

const NO_JOBS: ScanJob[] = [];
const MISSING: LiveProduct = { status: 'missing', events: '', jobs: NO_JOBS };
const BACKOFF_MS = 500, BACKOFF_CAP_MS = 10000;
const api = (slug: string) => '/api/products/' + encodeURIComponent(slug);

/**
 * How long a request to the blueprint server waits for an answer before the client gives up. Every route here
 * answers at once - a scan route with 202 and the queued job, a store route from SQLite - so a request still
 * open after this is a server that will not answer (it died mid-write, or it is wedged on a locked store), and
 * without a bound the promise never settles: the toast never comes, the spinner never stops, and the structure
 * fetch's `fetching` latch never clears, so every later map refresh is swallowed too. The lens-draft chat is
 * the one slow route (its own 504 at 3 minutes) and passes its own bound.
 */
export const REQUEST_TIMEOUT_MS = 20000;
/** `signal` (when the caller has one) and the request bound, as one signal: whichever fires first aborts the fetch. */
const bound = (signal?: AbortSignal, ms: number = REQUEST_TIMEOUT_MS): AbortSignal => {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
};

/** Unreadable stream events seen, per event name: the first of each is warned about, then every 100th, so a noisy server cannot flood the console. */
const unreadable = new Map<string, number>();
const skipped = (event: string, e: unknown) => {
  const n = (unreadable.get(event) ?? 0) + 1;
  unreadable.set(event, n);
  if (n === 1 || n % 100 === 0) console.warn(`scan stream: skipped an unreadable '${event}' event (${n} so far): ${(e as Error)?.message ?? e}`);
};

// ------------------------------------------------------------------------------------------- jobs
/** Every jobs event per slug, log lines included, for the views that show them (useLiveJobs). */
const jobStore = new Map<string, { jobs: ScanJob[]; subs: Set<() => void> }>();
const jobsOf = (slug: string) => { let s = jobStore.get(slug); if (!s) jobStore.set(slug, (s = { jobs: NO_JOBS, subs: new Set() })); return s; };
function setJobs(slug: string, jobs: ScanJob[]): void { const s = jobsOf(slug); s.jobs = jobs; for (const fn of s.subs) fn(); }
/** What a job list says apart from its log lines: when this does not move, LiveProduct.jobs keeps its identity. */
const jobsKey = (js: ScanJob[]): string => js.map((j) => [j.id, j.status, j.run_id ?? '', j.exit_code ?? '', j.error ?? ''].join('|')).join('\n');

/** The live product's jobs with every log line (re-renders on each `jobs` event; [] for Kettle or before one). */
export function useLiveJobs(slug: string | null): ScanJob[] {
  return useSyncExternalStore(
    (fn) => { if (!slug) return () => {}; const s = jobsOf(slug); s.subs.add(fn); return () => { s.subs.delete(fn); }; },
    () => (slug ? jobsOf(slug).jobs : NO_JOBS),
    () => NO_JOBS,
  );
}

/**
 * Follows one live product. `slug` null = no live product (Kettle): returns `{ status: 'missing' }` at once.
 * The structure is fetched on open and again when the stream says the map files changed (`map` event) or a run
 * ends (the skill writes the metrics back into the map, spec 15), a changed answer replacing `structure`;
 * the scan follows the SSE stream (snapshot, then deltas). On a
 * stream error the native EventSource is closed and reopened here with exponential backoff capped at
 * 10 s (its own retry has no cap we control); status reads `offline` meanwhile. A product whose repo has
 * no store yet reads `missing` with its structure, and turns `live` when the store appears. A store that
 * exists but cannot be read reads `error` with the server's text (`error` event) until the next snapshot.
 */
export function useLiveProduct(slug: string | null): LiveProduct {
  const [state, setState] = useState<{ slug: string | null; live: LiveProduct }>(() => ({ slug, live: slug ? { status: 'loading', events: '', jobs: NO_JOBS } : MISSING }));

  useEffect(() => {
    if (!slug) { setState({ slug, live: MISSING }); return; }
    let dead = false, es: EventSource | null = null, timer: ReturnType<typeof setTimeout> | undefined, attempt = 0;
    let jobs: ScanJob[] = NO_JOBS;
    let scan: ScanSnapshot | undefined, hasStore: boolean | undefined = undefined, listTimer: ReturnType<typeof setTimeout> | undefined, mapText = '', mapRev = '', rev = 0, fetching = false, again = false, retry: ReturnType<typeof setTimeout> | undefined;
    const ac = new AbortController(), base = api(slug);
    const put = (f: (l: LiveProduct) => LiveProduct) => { if (!dead) setState((s) => ({ slug, live: f(s.slug === slug ? s.live : { status: 'loading', events: '', jobs: NO_JOBS }) })); };
    const shown = (): LiveProduct['status'] => statusOfStore(hasStore);

    /** Fetch the map; a body equal to the one held changes nothing. Returns false on a failed fetch (the old map stays). */
    const refetch = async (): Promise<boolean> => {
      if (fetching) { again = true; return true; }
      fetching = true;
      try {
        const r = await fetch(base + '/structure', { signal: bound(ac.signal), cache: 'no-store' });
        if (!r.ok) return false;
        const text = await r.text();
        if (dead) return true;
        const j = JSON.parse(text) as { structure: AppStructure; events?: string; rev?: string };
        mapRev = j.rev ?? mapRev;
        if (text === mapText) return true;
        mapText = text;
        const s = j.structure, ev = j.events ?? '', n = ++rev;
        put((l) => ({ ...l, structure: s, structureRev: n, events: ev }));
        return true;
      } catch { return false; } finally {
        fetching = false;
        if (again && !dead) { again = false; void refetch(); }
      }
    };
    const refresh = () => { clearTimeout(retry); void refetch().then((ok) => { if (!ok && !dead) retry = setTimeout(refresh, 3000); }); };

    const open = () => {
      if (dead) return;
      const src = new EventSource(base + '/stream');
      es = src;
      // every listener parses inside a guard: an unreadable event is skipped, never thrown out of the
      // listener, where it would leave the stream open and the page's readings frozen with no sign of it
      src.addEventListener('snapshot', (ev) => {
        attempt = 0;
        let sent: Partial<ScanSnapshot>;
        try { sent = JSON.parse((ev as MessageEvent<string>).data) as Partial<ScanSnapshot>; } catch (e) { skipped('snapshot', e); return; }
        scan = full(sent);
        if (!isEmpty(scan)) hasStore = true;
        const s = scan;
        // a (re)connect: the server follows the snapshot with its jobs when it has any, so until then there are none
        if (jobs.length) { jobs = NO_JOBS; setJobs(slug, jobs); }
        put((l) => ({ ...l, status: shown(), scan: s, jobs, error: undefined }));
      });
      src.addEventListener('jobs', (ev) => {
        let next: ScanJob[];
        try { next = JSON.parse((ev as MessageEvent<string>).data) as ScanJob[]; } catch (e) { skipped('jobs', e); return; }
        if (!Array.isArray(next)) return;
        setJobs(slug, next);
        const discrete = jobsKey(next) !== jobsKey(jobs);
        jobs = next;
        if (discrete) { const j = next; put((l) => ({ ...l, jobs: j })); }
      });
      // the map files changed under the page (the skill wrote its metrics back): take the new map
      src.addEventListener('map', (ev) => {
        let r = '';
        try { r = String((JSON.parse((ev as MessageEvent<string>).data) as { rev?: unknown }).rev ?? ''); } catch (e) { skipped('map', e); return; }
        if (r && r !== mapRev) refresh();
      });
      src.addEventListener('delta', (ev) => {
        if (!scan) return;
        let sent: Partial<ScanSnapshot>;
        try { sent = JSON.parse((ev as MessageEvent<string>).data) as Partial<ScanSnapshot>; } catch (e) { skipped('delta', e); return; }
        const was = latestRun(scan);
        scan = mergeScan(scan, full(sent));
        hasStore = true;
        const now = latestRun(scan);
        if (was && now && was.id === now.id && was.status === 'running' && now.status !== 'running') refresh(); // a run ended: its metrics are in the map
        const s = scan;
        put((l) => ({ ...l, status: 'live', scan: s, error: undefined }));
      });
      // A named server `error` event (the store exists and cannot be read) is a MessageEvent; the connection stays up.
      src.addEventListener('error', (ev) => {
        const data = (ev as MessageEvent<unknown>).data;
        if (typeof data !== 'string') return; // a dropped connection: onerror below
        let message = 'The scan store cannot be read';
        try { message = String((JSON.parse(data) as { message?: unknown }).message ?? message); } catch (e) { skipped('error', e); /* keep the generic text */ }
        put((l) => ({ ...l, status: 'error', error: message }));
      });
      src.onerror = (ev) => {
        if (ev instanceof MessageEvent) return; // the server's `error` event, handled above
        src.close();
        if (es === src) es = null;
        if (dead) return;
        put((l) => ({ ...l, status: 'offline' }));
        const ms = Math.min(BACKOFF_CAP_MS, BACKOFF_MS * 2 ** attempt++);
        timer = setTimeout(open, ms);
      };
    };

    (async () => {
      try {
        const [r, list] = await Promise.all([
          fetch(base + '/structure', { signal: bound(ac.signal), cache: 'no-store' }),
          refreshProjects(), // the one request for the list: the header's store shares it. null = it did not answer
        ]);
        if (r.status === 404) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          put(() => ({ status: 'missing', events: '', jobs: NO_JOBS, error: j.error }));
          return;
        }
        if (!r.ok) throw new Error(`structure: HTTP ${r.status}`);
        mapText = await r.text();
        const j = JSON.parse(mapText) as { structure: AppStructure; events?: string; rev?: string };
        mapRev = j.rev ?? '';
        // a list that did not answer leaves the store unknown (status stays `loading`, never `missing`): a snapshot
        // with rows or a delta settles it, else the list is asked again until it answers
        hasStore = storeFromList(list, slug);
        if (hasStore === undefined) {
          const ask = () => { void refreshProjects(true).then((l) => {
            if (dead || hasStore !== undefined) return;
            hasStore = storeFromList(l, slug);
            if (hasStore === undefined) { listTimer = setTimeout(ask, 3000); return; }
            put((x) => (x.status === 'loading' ? { ...x, status: shown() } : x));
          }); };
          listTimer = setTimeout(ask, 3000);
        }
        put((l) => ({ ...l, status: 'loading', structure: j.structure, structureRev: ++rev, events: j.events ?? '' }));
        open();
      } catch (e) {
        if (dead || (e as Error).name === 'AbortError') return;
        put((l) => ({ ...l, status: 'error', error: (e as Error).message }));
      }
    })();

    return () => { dead = true; ac.abort(); clearTimeout(timer); clearTimeout(retry); clearTimeout(listTimer); es?.close(); es = null; };
  }, [slug]);

  // Until the effect for a new slug has run, do not hand out the previous product's data.
  if (!slug) return MISSING;
  return state.slug === slug ? state.live : { status: 'loading', events: '', jobs: NO_JOBS };
}

/** Approve or decline a proposal; resolves to the updated row, rejects on any non-2xx (409 = already decided). */
export async function decideProposal(slug: string, id: string, body: DecisionBody): Promise<Proposal> {
  const r = await fetch(api(slug) + '/proposals/' + encodeURIComponent(id), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: bound(),
  });
  const j = (await r.json().catch(() => null)) as (Proposal & { error?: string }) | { error?: string } | null;
  if (!r.ok) {
    const msg = r.status === 409 ? `proposal ${id} was already decided (${(j as Proposal | null)?.status ?? 'unknown'})` : (j as { error?: string } | null)?.error ?? `HTTP ${r.status}`;
    throw Object.assign(new Error(msg), { status: r.status, proposal: r.status === 409 ? (j as Proposal) : undefined });
  }
  return j as Proposal;
}

/** The lens-draft chat runs Claude Code and its route gives up at 3 minutes; the client waits a little longer. */
export const LENS_DRAFT_TIMEOUT_MS = 200000;
/** An answer of the lens-draft chat (POST /api/lens-draft). */
export interface LensDraftAnswer { session?: string; reply: string; draft?: LensManifest; done: boolean; error?: string }

/** One JSON request to a scan route; rejects on any non-2xx with an Error carrying `status` and the parsed `body`. */
async function send<T>(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, timeoutMs?: number, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, {
    method, cache: 'no-store', signal: bound(signal, timeoutMs),
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const j = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) throw Object.assign(new Error((j as { error?: string } | null)?.error ?? `HTTP ${r.status}`), { status: r.status, body: j });
  return j as T;
}

/** Queue a lens scan over a scope (202 = the job). Errors: 400 unknown-lens / no-scan-method / bad-scope, 429 queue full. */
export const postScan = (slug: string, lens: string, scope: ScanScope): Promise<ScanJob> => send(api(slug) + '/scans', 'POST', { lens, scope });
/** Approve the proposed ones among `ids` and build them all in one execute job. 409 = none could go (`body.skipped`). */
export const postDispatch = (slug: string, ids: string[]): Promise<DispatchResult> => send(api(slug) + '/dispatch', 'POST', { ids });
/** Cancel a queued or running job. */
export const deleteJob = (slug: string, id: string): Promise<ScanJob> => send(api(slug) + '/scans/' + encodeURIComponent(id), 'DELETE');
/** Retire (false) or restore (true) a temporary lens. 403 = not temporary. */
export const patchLens = (slug: string, id: string, enabled: boolean): Promise<LensEntry> => send(api(slug) + '/lenses/' + encodeURIComponent(id), 'PATCH', { enabled });
/** Delete a temporary lens's entry (its facets stay). 403 = not temporary. */
export const deleteLens = (slug: string, id: string): Promise<{ id: string }> => send(api(slug) + '/lenses/' + encodeURIComponent(id), 'DELETE');
/** Add a permanent project lens (reverse-DNS id) or, with `temporary`, a tmp.* lens. 400 says what failed; 409 = the id exists. */
export const postProjectLens = (slug: string, manifest: LensManifest, temporary = false): Promise<LensEntry> => send(api(slug) + '/lenses', 'POST', temporary ? { manifest, temporary: true } : { manifest });
/** What executing a lens's backlog answered: the execute jobs (batches of 50), the ids it approved, and what it skipped. */
export type { LensExecuteResult } from '@bp/core/scan/jobs';
import type { LensExecuteResult } from '@bp/core/scan/jobs';
/** Approve the lens's proposed findings and build them with its approved ones, in execute jobs of at most 50. 409 = nothing to build. */
export const executeLens = (slug: string, lens: string): Promise<LensExecuteResult> => send(api(slug) + '/lenses/' + encodeURIComponent(lens) + '/execute', 'POST', {});
/** Queue a prepare job: the CLI makes the lens measurable in the product repo (probes + the overlay's `## Probes`). 400 not-preparable, 409 one runs. */
export const postPrepare = (slug: string, lens: string): Promise<ScanJob> => send(api(slug) + '/lenses/' + encodeURIComponent(lens) + '/prepare', 'POST', {});

// The release train's routes, each answer through the one parser door (src/lib/train/wire.ts). A rejection carries
// `status` and `body`: a non-2xx has the route's status and its body (the validated value when it is one, as triage's
// 409 TriageResult; else the parsed JSON); an answer that fails its validator has status 0 and the field in the message.
type Validate<T> = (x: unknown) => Parsed<T>;
async function call<T>(url: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', parse: Validate<T>, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method, cache: 'no-store', signal: bound(),
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await r.text();
  const j = parseJson(text);
  const json = j.ok ? j.value : undefined;
  if (!r.ok) {
    const v = j.ok ? parse(json) : undefined;
    throw Object.assign(new Error(errorText(json) ?? `HTTP ${r.status}`), { status: r.status, body: v?.ok ? v.value : json });
  }
  if (!j.ok) throw Object.assign(new Error(j.error), { status: 0, body: text });
  const v = parse(json);
  if (!v.ok) throw Object.assign(new Error(`${url} answered an unexpected shape: ${v.error}`), { status: 0, body: json });
  return v.value;
}
/** Triage built items (POST triage). 409 = nothing moved (the result is in `body`). */
export const postTriage = (slug: string, body: TriageBody): Promise<TriageResult> => call(api(slug) + '/triage', 'POST', parseTriageResult, body);
/** The suggested next version (GET releases/suggest). */
export const getReleaseSuggestion = (slug: string): Promise<VersionSuggestion> => call(api(slug) + '/releases/suggest', 'GET', parseVersionSuggestion);
/** A draft release of accepted items (POST releases, 201). 409 = nothing to ship or the version exists. */
export const postRelease = (slug: string, version: string, ids?: string[]): Promise<ReleaseCreated> =>
  call(api(slug) + '/releases', 'POST', parseReleaseCreated, ids === undefined ? { version } : { version, ids });
/** Start the release job that builds `id` (202 = the job). 412 = gh not authenticated; 409 = wrong status or busy. */
export const postReleaseBuild = (slug: string, id: string): Promise<ScanJob> => call(api(slug) + '/releases/' + encodeURIComponent(id) + '/build', 'POST', parseScanJob, {});
/** The build's pre-flight (POST build `{"dry":true}`): 200 `{ ready: true }` with nothing queued, else the refusal the
 *  build would give (409 state or busy, 429 queue full). It never checks gh: the dry run reads local state only. */
export const postReleaseBuildDry = (slug: string, id: string): Promise<ReleaseReady> => call(api(slug) + '/releases/' + encodeURIComponent(id) + '/build', 'POST', parseReady, { dry: true });
const parseReady = (x: unknown): Parsed<ReleaseReady> => {
  const o = (x ?? {}) as { ready?: unknown; gh?: unknown };
  return o.ready === true && (o.gh === 'signed-in' || o.gh === 'unchecked') ? { ok: true, value: { ready: true, gh: o.gh } } : { ok: false, error: 'ready: not true, or gh: not signed-in | unchecked' };
};
/** Start the release job that finishes `id` after its PR merged (202 = the job). 412 / 409 as build. */
export const postReleaseFinish = (slug: string, id: string): Promise<ScanJob> => call(api(slug) + '/releases/' + encodeURIComponent(id) + '/finish', 'POST', parseScanJob, {});
/** One item commit's diff (GET commits/[sha]). 400 = not a sha; 404 = not an item commit of this store. */
export const getCommitDiff = (slug: string, sha: string): Promise<CommitDiff> => call(api(slug) + '/commits/' + encodeURIComponent(sha), 'GET', parseCommitDiff);

// The ledger waves' routes (waves.ts), through the same door: a body that is not a wave is a status-0 rejection naming the field.
const inWave = parseWaveBody;
/** The product's waves (GET waves). */
export const getWaves = (slug: string): Promise<Wave[]> => call(api(slug) + '/waves', 'GET', parseWaves);
/** A draft wave (POST waves, 201). 400 bad body; 409 a finding is in another draft wave (`body.taken`); 429 at 50 waves. */
export const postWave = (slug: string, body: WaveBody): Promise<Wave> => call(api(slug) + '/waves', 'POST', inWave, body);
/** Rename a draft wave and/or replace its packages (PATCH). 409 = not a draft, or taken. */
export const patchWaveReq = (slug: string, id: string, patch: Partial<WaveBody>): Promise<Wave> => call(api(slug) + '/waves/' + encodeURIComponent(id), 'PATCH', inWave, patch);
/** Delete a draft wave. 409 = not a draft. */
export const deleteWaveReq = (slug: string, id: string): Promise<{ id: string }> => send(api(slug) + '/waves/' + encodeURIComponent(id), 'DELETE');
/** Build a wave (202), or only the named packages. 409 = none could go (`body.skipped`); 429 = the queue cap stopped it (`body` = the result so far). */
export const postWaveDispatch = (slug: string, id: string, packages?: string[]): Promise<WaveDispatchResult> =>
  call(api(slug) + '/waves/' + encodeURIComponent(id) + '/dispatch', 'POST', parseWaveDispatch, packages === undefined ? {} : { packages });

/** One turn of the lens onboarding chat: `product` is a slug or 'kettle'; `session` from the previous answer; `kind`
 *  asks for a permanent project lens (the default) or a temporary one. 504 after 3 minutes. `signal` cancels the turn
 *  (the request rejects with an AbortError); an answer with no `reply` rejects with status 502. */
export const postLensDraft = async (product: string, message: string, session?: string, kind: 'project' | 'temporary' = 'project', signal?: AbortSignal): Promise<LensDraftAnswer> => {
  const a = await send<LensDraftAnswer>('/api/lens-draft', 'POST', { product, message, ...(session ? { session } : {}), kind }, LENS_DRAFT_TIMEOUT_MS, signal);
  if (!a || typeof a !== 'object' || typeof a.reply !== 'string') throw Object.assign(new Error('the server answered no reply'), { status: 502 });
  return a;
};

// ------------------------------------------------------------------------------------------- swarm
// The scan as a swarm lives in core (pure); re-exported here for the web's importers.
export { swarmFromScan, type SwarmFeature } from '@bp/core/scan/swarm';
