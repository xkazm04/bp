'use client';
// Orders on a live product: the owner's standing rules (scan/rules.ts), one surface for what agents may NOT do (orders:
// hold a place, only some lenses' work there, an effort cap) and what they MAY decide alone (grants). The list holds a
// "Write a rule" row, then the live orders and grants, then the ended ones (revoked or expired, kept as the record). A
// rule's detail says where it governs, who set it and when, how long it has left, and replays it over the owner's
// decided findings now (Evidence), with a one-tap revoke. The writer turns the plan's selection (or everything) into a
// draft from four templates, replays the draft as it changes, and sets it as the person (the human token). A grant whose
// replay is flagged (a stop-ship it would approve, every tier) asks for a second, explicit tap.
// The rules live in <root>/.ai/lens-scan/work/bp-rules.json: every agent door honours them, and Personas reads the file.
import { useEffect, useMemo, useState } from 'react';
import { GRANT_TOOLS, TIER_WORD, isLive, isOrder, ruleText, trustworthy, type Backtest, type Rule, type RuleKind } from '@bp/core/scan/rules';
import type { ScanScope } from '@bp/core/scan/jobs';
import { previewRule, revokeRule, setRule, useRules, type DraftBody } from '@/lib/rules/client';
import { shallowEqual, useBp, useEngine } from '../../hooks';
import { Evidence } from './rules-evidence';
import { Fig, Group, Row, Sec, Workbench, useListRef, useWalk } from './shell';

const WRITE = 'rules:write';
const KINDS: { k: RuleKind; head: string; sub: string }[] = [
  { k: 'hold', head: 'Hold this place', sub: 'No builds or scans start here until you lift it' },
  { k: 'only', head: 'Only some work here', sub: 'Only the lenses you pick may build or scan here' },
  { k: 'cap', head: 'Cap the effort', sub: 'No build here above an effort you set' },
  { k: 'grant', head: 'Let agents decide', sub: 'Agents may approve findings here on their own' },
];
const HOURS = [{ h: 0, w: 'until I lift it' }, { h: 24, w: '24 hours' }, { h: 72, w: '3 days' }, { h: 168, w: 'a week' }];

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
/** "2 d 4 h left", "41 min left", or the end it reached. */
export function leftOf(r: Rule, now: number): string {
  if (r.revokedAt) return 'revoked ' + when(r.revokedAt);
  if (!r.expiresAt) return 'until lifted';
  const ms = Date.parse(r.expiresAt) - now;
  if (ms <= 0) return 'expired ' + when(r.expiresAt);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return (h >= 24 ? Math.floor(h / 24) + ' d ' + (h % 24) + ' h' : h ? h + ' h ' + m + ' min' : m + ' min') + ' left';
}
function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
/** The replay of a draft, re-asked 250 ms after it last changed. */
function useReplay(slug: string, d: DraftBody | null): { bt: Backtest | null; busy: boolean; error?: string } {
  const [st, setSt] = useState<{ bt: Backtest | null; busy: boolean; error?: string }>({ bt: null, busy: false });
  const key = d ? JSON.stringify(d) : '';
  useEffect(() => {
    if (!d) { setSt({ bt: null, busy: false }); return; }
    const ac = new AbortController();
    setSt((s) => ({ ...s, busy: true }));
    const t = setTimeout(() => previewRule(slug, d, ac.signal).then((bt) => setSt({ bt, busy: false }), (e: Error) => { if (!ac.signal.aborted) setSt({ bt: null, busy: false, error: e.message }); }), 250);
    return () => { clearTimeout(t); ac.abort(); };
  }, [slug, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return st;
}
const draftOf = (r: Rule): DraftBody => ({ kind: r.kind, scope: r.scope, ...(r.lenses ? { lenses: r.lenses } : {}), ...(r.maxEffort ? { maxEffort: r.maxEffort } : {}), ...(r.model ? { model: r.model } : {}), ...(r.minTier !== undefined ? { minTier: r.minTier } : {}) });

export function LiveRules({ slug }: { slug: string }) {
  const E = useEngine(), v = useRules(slug), now = useNow();
  const [sel, setSel] = useState<string | null>(null);
  const listRef = useListRef();
  const live = useMemo(() => v.rules.filter((r) => isLive(r, now)), [v.rules, now]);
  const orders = live.filter((r) => isOrder(r.kind)), grants = live.filter((r) => !isOrder(r.kind));
  const ended = useMemo(() => v.rules.filter((r) => !isLive(r, now)).reverse(), [v.rules, now]);
  const ids = useMemo(() => [WRITE, ...orders.map((r) => r.id), ...grants.map((r) => r.id), ...ended.map((r) => r.id)], [orders, grants, ended]);
  const cur = sel && ids.includes(sel) ? sel : orders[0]?.id ?? grants[0]?.id ?? WRITE;
  const onKey = useWalk(ids, cur, setSel, listRef);
  const hi = cur !== WRITE ? cur : null;
  useEffect(() => { E.setOrdHi(hi); }, [E, hi]);
  useEffect(() => () => E.setOrdHi(null), [E]);

  const row = (r: Rule) => (
    <Row key={r.id} id={r.id} on={cur === r.id} onPick={() => setSel(r.id)} cls={'rl-k-' + r.kind + (isLive(r, now) ? '' : ' rl-ended')} label={r.id + ': ' + r.text}>
      <span className="rk"><span>{r.id}</span><span>{isOrder(r.kind) ? 'order · ' + r.kind : 'grant'}</span></span>
      <span className="rt">{r.text}</span>
      <span className="rm"><span>{r.scope.label}</span><span>{leftOf(r, now)}</span></span>
    </Row>
  );
  const list = (
    <>
      <ul role="listbox" aria-label="Write a rule" className="wb-solo">
        <Row id={WRITE} on={cur === WRITE} onPick={() => setSel(WRITE)} cls="ov">
          <span className="rt">Write a rule</span>
          <span className="rm"><span>for the places you selected, or everything</span></span>
        </Row>
      </ul>
      {orders.length > 0 && <Group head="Orders · agents may not" n={orders.length} label="Live orders">{orders.map(row)}</Group>}
      {grants.length > 0 && <Group head="Grants · agents may decide" n={grants.length} label="Live grants">{grants.map(row)}</Group>}
      {ended.length > 0 && <Group head="Ended" n={ended.length} label="Revoked and expired rules">{ended.map(row)}</Group>}
      {!v.rules.length && <p className="wb-none">{v.loaded ? 'No standing rules yet. Every agent door is open.' : 'Reading the rules…'}</p>}
    </>
  );
  const r = v.rules.find((x) => x.id === cur);
  return (
    <Workbench cls="wb-orders wb-rules" list={list} listLabel="Standing rules" listRef={listRef} onKey={onKey} detailKey={cur} detailLabel="Selected rule"
      strip={(
        <>
          <div className="wb-count"><b>{orders.length}</b><span>{orders.length === 1 ? 'order' : 'orders'} holding</span></div>
          <div className={'wb-count' + (grants.length ? ' t-mint' : '')}><b>{grants.length}</b><span>{grants.length === 1 ? 'grant' : 'grants'} live</span></div>
          <div className="wb-count"><b>{v.record.decided}</b><span>decisions on record{v.record.synthetic ? ' (' + v.record.synthetic + ' synthetic)' : ''}</span></div>
          <span className="wb-src" title={'<root>/.ai/lens-scan/work/bp-rules.json'}>bp-rules.json · every agent door</span>
        </>
      )}
      detail={<div className="wb-scroll">{v.error && <p className="wb-err">{v.error}</p>}{r ? <RuleDetail slug={slug} r={r} now={now} /> : <Writer slug={slug} all={v.rules} onSet={setSel} />}</div>} />
  );
}

function RuleDetail({ slug, r, now }: { slug: string; r: Rule; now: number }) {
  const E = useEngine(), P = E.M.P;
  const draft = useMemo(() => draftOf(r), [r]);
  const rp = useReplay(slug, draft);
  const [err, setErr] = useState<string>();
  const on = isLive(r, now), n = r.scope.kind === 'all' ? P.features.length : r.scope.features.length;
  const show = () => {
    E.setOrdHi(r.id);
    const ids = r.scope.kind === 'all' ? P.features.map((f) => f.id) : r.scope.features.filter((f) => P.F[f]);
    if (ids.length) { E.setTarget(Object.fromEntries(ids.map((id) => [id, 1])) as Record<string, 1>, r.scope.label); E.lookAtTarget(); }
  };
  const revoke = () => revokeRule(slug, r.id).then((x) => E.toast((isOrder(x.kind) ? 'Lifted ' : 'Ended ') + x.id, x.text), (e: Error) => setErr(e.message));
  return (
    <>
      <div className="wb-kick"><span className={on ? 'st done' : 'st cancelled'}>{on ? (isOrder(r.kind) ? 'holding' : 'granted') : r.revokedAt ? 'revoked' : 'expired'}</span><span>{r.id}</span><span>{isOrder(r.kind) ? 'order · ' + r.kind : 'grant'}</span><span>{leftOf(r, now)}</span></div>
      <h3 className="wb-title">{r.text}</h3>
      <p className="wb-lede">
        {isOrder(r.kind) ? 'Governs ' : 'Covers '}<b>{r.scope.label}</b> ({n} feature{n === 1 ? '' : 's'}). Set by {r.by}, {when(r.at)}.
        {r.kind === 'grant' ? ' Agents may run ' + (r.tools ?? GRANT_TOOLS).join(' and ') + ' there without asking you' + (r.minTier !== undefined ? ', on ' + TIER_WORD[r.minTier] + ' findings or milder.' : '.') : ' Every agent door (wave compose and dispatch, build, scan) refuses what it holds and cites it.'}
      </p>
      {r.evidence && <p className="wb-meta">Set on the evidence of {r.evidence.decided} decisions: it agreed on {r.evidence.matched}, differed on {r.evidence.differed}.</p>}
      <div className="wb-inline">
        <button type="button" className="bt" onClick={show}>Show its places</button>
        {on && <button type="button" className="bt rl-revoke" onClick={revoke}>{isOrder(r.kind) ? 'Lift this order' : 'Revoke this grant'}</button>}
        <span className="wb-meta">The plan outlines its places while it is selected.</span>
      </div>
      {err && <p className="wb-err">{err}</p>}
      <Sec head="Replayed over your decisions now" aside="the same replay as when it was set">
        <Evidence bt={rp.bt} busy={rp.busy} error={rp.error} />
      </Sec>
    </>
  );
}

/** The place a selection names: a whole wing or room keeps its kind and id, otherwise a selection of features. */
function scopeOf(E: ReturnType<typeof useEngine>, ids: Record<string, 1>, label: string): ScanScope {
  const P = E.M.P, fs = Object.keys(ids).filter((id) => P.F[id]), set = new Set(fs);
  const same = (xs: string[]) => xs.length === set.size && xs.every((x) => set.has(x));
  if (fs.length === 1) return { kind: 'feature', id: fs[0], label: P.F[fs[0]].name, features: fs };
  for (const d of P.domains) if (same(d.capabilities.flatMap((c) => P.C[c]?.features ?? []))) return { kind: 'wing', id: d.id, label: d.name, features: fs };
  for (const c of P.capabilities) if (same(c.features)) return { kind: 'room', id: c.id, label: c.name, features: fs };
  return { kind: 'selection', label: label || fs.length + ' features', features: fs };
}

function Writer({ slug, all, onSet }: { slug: string; all: Rule[]; onSet: (id: string) => void }) {
  const E = useEngine(), P = E.M.P;
  const s = useBp((s) => ({ tgt: s.tgt }), shallowEqual);
  const [kind, setKind] = useState<RuleKind | null>(null);
  const [everything, setEverything] = useState(false);
  const [lenses, setLenses] = useState<string[]>([]);
  const [effort, setEffort] = useState('medium');
  const [model, setModel] = useState('');
  const [tier, setTier] = useState(3);
  const [hours, setHours] = useState(0);
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string>();
  const scope = useMemo<ScanScope | null>(() => (everything ? { kind: 'all', label: 'Everything', features: [] } : s.tgt.n ? scopeOf(E, s.tgt.ids, s.tgt.label) : null), [E, everything, s.tgt]);
  const lensIds = Object.keys(P.LENS);
  const draft = useMemo<DraftBody | null>(() => {
    if (!scope || !kind || (kind === 'only' && !lenses.length)) return null;
    const d: DraftBody = { kind, scope };
    if (kind === 'only') d.lenses = lenses;
    if (kind === 'cap') { d.maxEffort = effort; if (model) d.model = model; }
    if (kind === 'grant') { if (tier >= 0) d.minTier = tier; d.hours = hours || 24; } else if (hours) d.hours = hours;
    d.text = ruleText({ kind, lenses: d.lenses, maxEffort: d.maxEffort as Rule['maxEffort'], model: d.model as Rule['model'], minTier: d.minTier }, (id) => P.LENS[id]?.name ?? id);
    return d;
  }, [scope, kind, lenses, effort, model, tier, hours, P]);
  const rp = useReplay(slug, draft);
  useEffect(() => setArmed(false), [draft]);
  const risky = kind === 'grant' && !!rp.bt && !trustworthy(rp.bt);
  const set = () => {
    if (!draft) return;
    if (risky && !armed) { setArmed(true); return; }
    setRule(slug, draft).then((r) => { E.toast((isOrder(r.kind) ? 'Order ' : 'Grant ') + r.id + ' set', r.text + ' · ' + r.scope.label); onSet(r.id); }, (e: Error) => setErr(e.message));
  };
  const nextId = (isOrder(kind ?? 'hold') ? 'O-' : 'G-') + (1 + all.reduce((n, r) => (r.id[0] === (isOrder(kind ?? 'hold') ? 'O' : 'G') ? Math.max(n, Number(r.id.slice(2)) || 0) : n), 0));
  const pill = (on: boolean, label: string, fn: () => void, key?: string) => <button key={key ?? label} type="button" aria-pressed={on} onClick={fn}>{label}</button>;
  return (
    <>
      <div className="wb-kick"><span>New rule</span><span>{scope ? (scope.kind === 'all' ? 'everything' : scope.features.length + ' features') : 'no place yet'}</span></div>
      <h3 className="wb-title">{draft?.text ?? 'Write a rule'}</h3>
      <p className="wb-lede">A rule steers every agent at once until you lift it. Before you set one, it is replayed over your own past decisions, so you can see where it would have disagreed with you.</p>
      <Sec head="Place" aside={scope ? scope.kind : 'plan'}>
        {scope ? <p><b>{scope.label}</b>{scope.kind === 'all' ? ' · every feature' : ' · ' + scope.features.length + ' features'}</p>
          : <p>Shift-click a wing, room or fixture on the plan, or shift-drag a box. Or govern the whole product.</p>}
        <div className="wb-filter">
          {pill(everything, 'Everything', () => setEverything(!everything))}
          {s.tgt.n > 0 && !everything && <button type="button" onClick={() => E.lookAtTarget()}>Look at it</button>}
        </div>
      </Sec>
      <Sec head="Rule" aside="replayed before it applies">
        <ul className="wb-tpl rl-kinds" aria-label="Rule templates">
          {KINDS.map((x) => <li key={x.k}><button type="button" aria-pressed={kind === x.k} onClick={() => setKind(x.k)}><b>{x.head}</b><span>{x.sub}</span></button></li>)}
        </ul>
        {kind === 'only' && <div className="wb-filter rl-opts" aria-label="Lenses allowed">{lensIds.map((id) => pill(lenses.includes(id), P.LENS[id]?.name ?? id, () => setLenses(lenses.includes(id) ? lenses.filter((x) => x !== id) : [...lenses, id]), id))}</div>}
        {kind === 'cap' && <div className="wb-filter rl-opts" aria-label="Highest effort">{['low', 'medium', 'high'].map((e) => pill(effort === e, 'up to ' + e, () => setEffort(e), e))}{pill(model === '', 'any model', () => setModel(''))}{pill(model === 'opus', 'opus only', () => setModel('opus'))}</div>}
        {kind === 'grant' && <div className="wb-filter rl-opts" aria-label="Tier floor">{[3, 2, 1].map((t) => pill(tier === t, TIER_WORD[t] + (t < 3 ? ' or milder' : ' only'), () => setTier(t), 't' + t))}{pill(tier === -1, 'any tier', () => setTier(-1))}</div>}
        {kind && <div className="wb-filter rl-opts" aria-label="How long">{HOURS.filter((x) => kind !== 'grant' || x.h).map((x) => pill((hours || (kind === 'grant' ? 24 : 0)) === x.h, x.w, () => setHours(x.h), 'h' + x.h))}</div>}
      </Sec>
      <Sec head="Replayed over your decisions" aside={rp.bt ? rp.bt.decided + ' decisions' : ''}>
        <Evidence bt={rp.bt} busy={rp.busy} error={rp.error} />
      </Sec>
      {err && <p className="wb-err">{err}</p>}
      <div className="wb-inline rl-set">
        <button type="button" className={'bt go' + (armed ? ' rl-armed' : '')} disabled={!draft || !rp.bt} onClick={set}>
          {!draft ? 'Pick a place and a rule' : armed ? 'Grant it anyway, against these flags' : kind === 'grant' ? 'Grant ' + nextId + ' for ' + (hours || 24) + ' h' : 'Set order ' + nextId}
        </button>
        {risky && !armed && <span className="wb-meta t-red">The replay flags this grant: the first tap arms it, the second sets it.</span>}
      </div>
    </>
  );
}
