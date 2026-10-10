// Client side of a live product: fetch its structure, follow its scan store over SSE, decide proposals,
// and turn a scan into the swarm feed the canvas already draws. Browser-only; the server half is
// store.server.ts and the routes under src/app/api/products.
import { useEffect, useState } from 'react';
import type { AppStructure } from '@/lib/standard/types';
import type { Agent, AgentStatus, Decision, ReplayEvent, ReplayType, Squad, Swarm } from '@/lib/data/types';
import { fullScan as full, isEmptyScan as isEmpty, type Activity, type ActivityKind, type Coverage, type DecisionBody, type Measurement, type Proposal, type ProductInfo, type Run, type ScanDelta, type ScanSnapshot } from './types.ts';

/** `loading` until the structure arrives; `missing` = no store or structure file; `offline` = reconnecting. */
export type LiveStatus = 'loading' | 'live' | 'offline' | 'missing' | 'error';

export interface LiveProduct {
  status: LiveStatus;
  structure?: AppStructure;
  /** The product's events log text, '' when it has none. */
  events: string;
  scan?: ScanSnapshot;
  error?: string;
}

const MISSING: LiveProduct = { status: 'missing', events: '' };
const ACTIVITY_KEEP = 200;
const BACKOFF_MS = 500, BACKOFF_CAP_MS = 10000;
const api = (slug: string) => '/api/products/' + encodeURIComponent(slug);

/** Rows of `ys` replace rows of `xs` with the same key, the rest are appended; `xs` is returned as is when nothing came. */
function upsert<T>(xs: T[], ys: T[] | undefined, key: (t: T) => string | number): T[] {
  if (!ys?.length) return xs;
  const at = new Map<string | number, number>(), out = xs.slice();
  out.forEach((x, i) => at.set(key(x), i));
  for (const y of ys) { const k = key(y), i = at.get(k); if (i === undefined) { at.set(k, out.length); out.push(y); } else out[i] = y; }
  return out;
}
const byId = (r: { id: string | number }) => r.id;
/** Apply a delta; tables the delta does not touch keep their identity (cheap change checks downstream). */
function mergeScan(s: ScanSnapshot, d: ScanDelta): ScanSnapshot {
  let activity = upsert<Activity>(s.activity, d.activity, byId);
  if (activity !== s.activity) { activity.sort((a, b) => a.id - b.id); if (activity.length > ACTIVITY_KEEP) activity = activity.slice(-ACTIVITY_KEEP); }
  return {
    runs: upsert<Run>(s.runs, d.runs, byId),
    measurements: upsert<Measurement>(s.measurements, d.measurements, byId),
    proposals: upsert<Proposal>(s.proposals, d.proposals, byId),
    activity,
    shots: upsert(s.shots, d.shots, byId),
    coverage: upsert<Coverage>(s.coverage, d.coverage, (c) => c.feature + '\u0000' + c.standard),
  };
}

/**
 * Follows one live product. `slug` null = no live product (Kettle): returns `{ status: 'missing' }` at once.
 * The structure is fetched once per slug; the scan follows the SSE stream (snapshot, then deltas). On a
 * stream error the native EventSource is closed and reopened here with exponential backoff capped at
 * 10 s (its own retry has no cap we control); status reads `offline` meanwhile. A product whose repo has
 * no store yet reads `missing` with its structure, and turns `live` when the store appears.
 */
export function useLiveProduct(slug: string | null): LiveProduct {
  const [state, setState] = useState<{ slug: string | null; live: LiveProduct }>(() => ({ slug, live: slug ? { status: 'loading', events: '' } : MISSING }));

  useEffect(() => {
    if (!slug) { setState({ slug, live: MISSING }); return; }
    let dead = false, es: EventSource | null = null, timer: ReturnType<typeof setTimeout> | undefined, attempt = 0;
    let scan: ScanSnapshot | undefined, hasStore = false;
    const ac = new AbortController(), base = api(slug);
    const put = (f: (l: LiveProduct) => LiveProduct) => { if (!dead) setState((s) => ({ slug, live: f(s.slug === slug ? s.live : { status: 'loading', events: '' }) })); };
    const shown = (): LiveProduct['status'] => (hasStore ? 'live' : 'missing');

    const open = () => {
      if (dead) return;
      const src = new EventSource(base + '/stream');
      es = src;
      src.addEventListener('snapshot', (ev) => {
        attempt = 0;
        scan = full(JSON.parse((ev as MessageEvent<string>).data) as Partial<ScanSnapshot>);
        if (!isEmpty(scan)) hasStore = true;
        const s = scan;
        put((l) => ({ ...l, status: shown(), scan: s, error: undefined }));
      });
      src.addEventListener('delta', (ev) => {
        if (!scan) return;
        scan = mergeScan(scan, full(JSON.parse((ev as MessageEvent<string>).data) as Partial<ScanSnapshot>));
        hasStore = true;
        const s = scan;
        put((l) => ({ ...l, status: 'live', scan: s }));
      });
      src.onerror = () => {
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
          fetch(base + '/structure', { signal: ac.signal, cache: 'no-store' }),
          fetch('/api/products', { signal: ac.signal, cache: 'no-store' }).then((x) => (x.ok ? (x.json() as Promise<ProductInfo[]>) : [])).catch(() => [] as ProductInfo[]),
        ]);
        if (r.status === 404) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          put(() => ({ status: 'missing', events: '', error: j.error }));
          return;
        }
        if (!r.ok) throw new Error(`structure: HTTP ${r.status}`);
        const j = (await r.json()) as { structure: AppStructure; events?: string };
        hasStore = !!list.find((p) => p.slug === slug)?.live;
        put((l) => ({ ...l, status: 'loading', structure: j.structure, events: j.events ?? '' }));
        open();
      } catch (e) {
        if (dead || (e as Error).name === 'AbortError') return;
        put((l) => ({ ...l, status: 'error', error: (e as Error).message }));
      }
    })();

    return () => { dead = true; ac.abort(); clearTimeout(timer); es?.close(); es = null; };
  }, [slug]);

  // Until the effect for a new slug has run, do not hand out the previous product's data.
  if (!slug) return MISSING;
  return state.slug === slug ? state.live : { status: 'loading', events: '' };
}

/** Approve or decline a proposal; resolves to the updated row, rejects on any non-2xx (409 = already decided). */
export async function decideProposal(slug: string, id: string, body: DecisionBody): Promise<Proposal> {
  const r = await fetch(api(slug) + '/proposals/' + encodeURIComponent(id), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
  });
  const j = (await r.json().catch(() => null)) as (Proposal & { error?: string }) | { error?: string } | null;
  if (!r.ok) {
    const msg = r.status === 409 ? `proposal ${id} was already decided (${(j as Proposal | null)?.status ?? 'unknown'})` : (j as { error?: string } | null)?.error ?? `HTTP ${r.status}`;
    throw Object.assign(new Error(msg), { status: r.status, proposal: r.status === 409 ? (j as Proposal) : undefined });
  }
  return j as Proposal;
}

// ------------------------------------------------------------------------------------------- swarm
const REPLAY_OF: Partial<Record<ActivityKind, ReplayType>> = { measured: 'scan-clean', proposed: 'finding', committed: 'commit', error: 'alert' };
const ms = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The Approve option's consequence: the metric move the proposal promises, from its latest reading when there is one. */
function expectedText(p: Proposal, readings: Measurement[]): string {
  if (!p.metric || p.expected_delta === undefined) return 'Queued for the next execute phase';
  let last: Measurement | undefined;
  for (const m of readings) if (m.feature === p.feature && m.lens === p.lens && m.metric === p.metric && (!last || m.measured_at >= last.measured_at)) last = m;
  const unit = last?.unit ? ' ' + last.unit : '', d = p.expected_delta;
  const move = (d > 0 ? '+' : '') + fmt(d) + unit;
  return last ? `${p.metric}: ${fmt(last.value)} → ${fmt(last.value + d)}${unit} (${move})` : `${p.metric} ${move}`;
}

/**
 * The scan as a swarm: one squad and one agent per lens in the latest run, each on the feature of its
 * latest activity row (`error` -> failed); open proposals (`proposed`) become decisions whose options
 * are Approve / Decline; activity rows become the replay.
 */
export function swarmFromScan(scan: ScanSnapshot, featureSlugs: readonly string[]): Swarm {
  const run = scan.runs.reduce<Run | undefined>((b, r) => (!b || r.started_at > b.started_at ? r : b), undefined);
  const known = new Set(featureSlugs), first = featureSlugs[0] ?? '';
  const empty: Swarm = { asOf: run?.started_at ?? new Date().toISOString(), note: 'Live lens scan: no run yet.', squads: [], agents: [], decisions: [], orders: [], replay: [], totals: {} };
  if (!run) return empty;
  const t0 = ms(run.started_at), running = run.status === 'running';
  const open = scan.proposals.filter((p) => p.status === 'proposed').sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const inRun = scan.activity.filter((a) => a.run_id === run.id);
  const agentOf = (lens: string) => `scan-${lens}.1`;

  const squads: Squad[] = [], agents: Agent[] = [];
  for (const lens of run.lenses) {
    const sq = `scan-${lens}`, role = 'research' as const; // scanners are research crews whatever their lens (lenses are data: no branch on a lens id)
    squads.push({ id: sq, name: `${title(lens)} scan`, role, focus: `measures the ${lens} lens`, size: 1, lenses: [lens] });
    // This run's rows first; a lens the run has not reached yet sits where an earlier run left it.
    const own = inRun.filter((a) => a.lens === lens), rows = own.length ? own : scan.activity.filter((a) => a.lens === lens);
    const last = rows[rows.length - 1];
    let placed: Activity | undefined;
    for (let i = rows.length - 1; i >= 0 && !placed; i--) if (rows[i].feature && known.has(rows[i].feature!)) placed = rows[i];
    const wait = open.find((p) => p.lens === lens);
    const status: AgentStatus = !running ? 'idle' : last?.kind === 'error' ? 'failed' : wait ? 'waiting' : 'working';
    const measured = new Set(scan.measurements.filter((m) => m.run_id === run.id && m.lens === lens).map((m) => m.feature));
    const pct = featureSlugs.length ? Math.min(99, Math.round((measured.size / featureSlugs.length) * 100)) : 0;
    const a: Agent = {
      id: agentOf(lens), squad: sq, role, status, feature: placed?.feature ?? first,
      task: last?.text ?? (running ? `starting the ${lens} scan` : `${lens} scan ${run.status}`),
      progressPct: pct, since: last?.at ?? run.started_at, tokensPerMin: 0, costUsdToday: 0, doneToday: measured.size,
    };
    if (status === 'waiting' && wait) a.waitingOn = wait.id;
    agents.push(a);
  }
  const agentIds = new Set(agents.map((a) => a.id)), byLens = new Map(run.lenses.map((l, i) => [l, agents[i]]));

  const decisions: Decision[] = open.map((p) => ({
    id: p.id, feature: p.feature, domain: '', lens: p.lens, decider: '', askedBy: agentIds.has(agentOf(p.lens)) ? agentOf(p.lens) : '',
    question: p.title,
    options: [{ label: 'Approve', consequence: expectedText(p, scan.measurements) }, { label: 'Decline', consequence: 'Stays in the backlog as declined' }],
    recommended: 0, urgency: (p.risk ?? 0) >= 7 ? 'high' : (p.risk ?? 0) >= 4 ? 'medium' : 'low',
    waitingSince: p.created_at, blocksAgents: 0, affects: [p.feature],
  }));

  const replay: ReplayEvent[] = inRun.map((e) => {
    const ag = (e.lens && byLens.get(e.lens)) || agents[0];
    return {
      t: Math.max(0, Math.round((ms(e.at) - t0) / 1000)), at: e.at, agent: ag?.id ?? '', feature: e.feature ?? ag?.feature ?? first,
      type: REPLAY_OF[e.kind] ?? 'note', text: e.text,
    };
  });

  return {
    asOf: run.started_at, note: `Live lens scan ${run.id} (${run.status}, ${run.phase}).`,
    squads, agents, decisions, orders: [], replay, totals: {},
  };
}
