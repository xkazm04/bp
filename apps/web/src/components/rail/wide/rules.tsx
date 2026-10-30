'use client';
// Orders on a live product: the owner's standing rules (scan/rules.ts), one surface for what agents may NOT do (orders:
// hold a place, only some lenses' work there, an effort cap) and what they MAY decide alone (grants). The list holds a
// "Write a rule" row, then the live orders and grants, then the ended ones (revoked or expired, kept as the record). A
// rule's detail says where it governs, who set it and when, how long it has left, what it holds right now, and replays it
// over the owner's decided findings now (rules-evidence.tsx), with a one-tap lift / revoke. The writer turns the plan's
// selection (or everything) into a draft from four templates, shows what it would do to the open backlog and replays it
// as it changes; a room where it disagrees with the owner is one tap from being left out. A sticky bar keeps the verdict
// beside the button that sets it as the person (the human token); a grant the replay flags (a stop-ship it would approve,
// every tier) asks for a second, explicit tap.
// The rules live in <root>/.ai/lens-scan/work/bp-rules.json: every agent door honours them, and Personas reads the file.
import { useEffect, useMemo, useState } from 'react';
import { GRANT_TOOLS, TIER_WORD, isLive, isOrder, nextRuleId, ruleText, trustworthy, type DecidedRow, type HeldTally, type Rule, type RuleKind } from '@bp/core/scan/rules';
import type { ScanScope } from '@bp/core/scan/jobs';
import { WRITE_ROW, pickDraft, revokeRule, setRule, usePickedDraft, usePickedRule, useRules, type DraftBody } from '@/lib/rules/client';
import { shallowEqual, useBp, useEngine } from '../../hooks';
import { Evidence, Now, Verdict, useReplay } from './rules-evidence';
import { Fig, Group, Row, Sec, Workbench, useListRef, useWalk } from './shell';

const WRITE = WRITE_ROW;
/** The last agent draft the writer took (a rule.propose card's "Open in Rules"), so a remount does not take it again. */
let tookDraft = 0;
const KINDS: { k: RuleKind; head: string; sub: string }[] = [
  { k: 'hold', head: 'Hold', sub: 'No builds or scans start here' },
  { k: 'only', head: 'Only', sub: 'Only some lenses’ work here' },
  { k: 'cap', head: 'Cap', sub: 'No build above an effort' },
  { k: 'grant', head: 'Let agents decide', sub: 'They approve findings alone' },
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
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
const draftOf = (r: Rule): DraftBody => ({ kind: r.kind, scope: r.scope, ...(r.lenses ? { lenses: r.lenses } : {}), ...(r.maxEffort ? { maxEffort: r.maxEffort } : {}), ...(r.model ? { model: r.model } : {}), ...(r.minTier !== undefined ? { minTier: r.minTier } : {}), ...(r.cautious ? { cautious: true } : {}) });
const kindWord = (r: Pick<Rule, 'kind'>) => (isOrder(r.kind) ? 'order · ' + r.kind : 'grant');

export function LiveRules({ slug }: { slug: string }) {
  const E = useEngine(), v = useRules(slug), now = useNow();
  // a deep link's rule (?dock=orders&rule=O-3, engine/deep-link.ts), taken once
  const [sel, setSel] = useState<string | null>(() => { const r = E.linkedRule; E.linkedRule = null; return r; });
  const picked = usePickedRule();
  useEffect(() => { if (picked) setSel(picked.id); }, [picked]);
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
    <Row key={r.id} id={r.id} on={cur === r.id} onPick={() => setSel(r.id)} cls={'rl-k-' + r.kind + (isLive(r, now) ? '' : ' rl-ended') + (v.breaches[r.id]?.length ? ' u-high' : '')} label={r.id + ': ' + r.text}>
      <span className="rk"><span>{r.id}</span><span>{kindWord(r)}</span></span>
      <span className="rt">{r.text}</span>
      <span className="rm"><span>{r.scope.label}{v.held[r.id] ? ' · held ' + v.held[r.id].items + (v.held[r.id].refused ? ', refused ' + v.held[r.id].refused : '') : ''}{v.breaches[r.id]?.length ? ' · ' + v.breaches[r.id].length + ' breach' + (v.breaches[r.id].length === 1 ? '' : 'es') : ''}</span><span>{leftOf(r, now)}</span></span>
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
      {v.suggestions.length > 0 && (
        <Group head="Suggested by your record" n={v.suggestions.length} label="Rules your decisions already follow">
          {v.suggestions.map((x) => (
            <Row key={'sg:' + x.kind + ':' + x.scope.id} id={null} on={false} cls={'rl-sug rl-k-' + x.kind} label={'Suggested: ' + x.kind + ' ' + x.scope.label}
              onPick={() => pickDraft({ kind: x.kind, scope: x.scope, ...(x.minTier !== undefined ? { minTier: x.minTier } : {}), ...(x.hours ? { hours: x.hours } : {}) })}>
              <span className="rk"><span>suggested</span><span>{x.kind === 'grant' ? 'grant' : 'order · ' + x.kind}</span></span>
              <span className="rt">{x.kind === 'grant' ? 'Let agents approve backlog in ' : 'Hold '}{x.scope.label}</span>
              <span className="rm"><span>{x.why}</span><span>{Math.round((100 * x.follow) / x.n)}%</span></span>
            </Row>
          ))}
        </Group>
      )}
      {ended.length > 0 && <Group head="Ended" n={ended.length} label="Revoked and expired rules">{ended.map(row)}</Group>}
      {!v.rules.length && <p className="wb-none">{v.loaded ? 'No standing rules yet: every agent door is open.' : 'Reading the rules…'}</p>}
    </>
  );
  const r = v.rules.find((x) => x.id === cur);
  return (
    <Workbench cls="wb-orders wb-rules" list={list} listLabel="Standing rules" listRef={listRef} onKey={onKey} detailKey={cur} detailLabel="Selected rule"
      strip={(
        <>
          <div className={'wb-count' + (orders.length ? ' t-amber' : '')}><b>{orders.length}</b><span>{orders.length === 1 ? 'order' : 'orders'} holding</span></div>
          <div className={'wb-count' + (grants.length ? ' t-mint' : '')}><b>{grants.length}</b><span>{grants.length === 1 ? 'grant' : 'grants'} live</span></div>
          <div className="wb-count"><b>{v.record.decided}</b><span>of your decisions on record{v.record.synthetic ? ' (' + v.record.synthetic + ' synthetic)' : ''}</span></div>
          <span className="wb-src" title="<root>/.ai/lens-scan/work/bp-rules.json: every agent door reads it, and so can Personas">bp-rules.json · every agent door</span>
        </>
      )}
      detail={r ? <RuleDetail slug={slug} r={r} now={now} held={v.held[r.id]} breaches={v.breaches[r.id] ?? []} all={v.rules} onSet={setSel} /> : <Writer slug={slug} all={v.rules} onSet={setSel} />} />
  );
}

function RuleDetail({ slug, r, now, held, breaches, all, onSet }: { slug: string; r: Rule; now: number; held?: HeldTally; breaches: DecidedRow[]; all: Rule[]; onSet: (id: string) => void }) {
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
  // an ended rule is set again as a new one (a new id, a fresh author line and the evidence as it reads today)
  const renew = () => setRule(slug, { ...draft, text: r.text, ...(r.kind === 'grant' || r.expiresAt ? { hours: 24 } : {}) })
    .then((x) => { E.toast((isOrder(x.kind) ? 'Order ' : 'Grant ') + x.id + ' set again', x.text + ' · ' + x.scope.label + ' (was ' + r.id + ')'); onSet(x.id); }, (e: Error) => setErr(e.message));
  const revoke = () => revokeRule(slug, r.id).then((x) => E.toast((isOrder(x.kind) ? 'Lifted ' : 'Ended ') + x.id, x.text + ' · ' + x.scope.label), (e: Error) => setErr(e.message));
  return (
    <>
      <div className="wb-scroll">
        <div className="wb-kick"><span className={on ? 'st done' : 'st cancelled'}>{on ? (isOrder(r.kind) ? 'holding' : 'granted') : r.revokedAt ? 'revoked' : 'expired'}</span><span>{r.id}</span><span>{kindWord(r)}</span><span>{leftOf(r, now)}</span></div>
        <h3 className="wb-title">{r.text}</h3>
        <p className="wb-lede">
          {isOrder(r.kind) ? 'Governs ' : 'Covers '}<b>{r.scope.label}</b> ({n} feature{n === 1 ? '' : 's'}). Set by {r.by}, {when(r.at)}{r.revokedBy ? '; ended by ' + r.revokedBy : ''}.
          {r.kind === 'grant' ? ' Agents may run ' + (r.tools ?? GRANT_TOOLS).join(' and ') + ' there without asking you' + (r.minTier !== undefined ? ', on ' + TIER_WORD[r.minTier] + ' findings or milder' : '') + '; their decisions are signed ' + r.id + ', never your name.' : ' Every agent door (wave compose and dispatch, build, scan) refuses what it holds and cites it.'}
        </p>
        {r.evidence && <p className="wb-meta">Set on the evidence of {r.evidence.decided} decisions: it agreed on {r.evidence.matched}, differed on {r.evidence.differed}.</p>}
        <div className="wb-inline">
          <button type="button" className="bt" onClick={show}>Show its places</button>
          <span className="wb-meta">The plan outlines its places while it is selected.</span>
        </div>
        {err && <p className="wb-err">{err}</p>}
        {isOrder(r.kind) && (
          <Sec head="What it has done" aside={held ? 'last ' + when(held.last) : 'nothing yet'}>
            <div className="wb-figs">
              <Fig n={held?.items ?? 0} label={'items held out of agents’ work'} tone={held?.items ? 'amber' : undefined} />
              <Fig n={held?.refused ?? 0} label="acts refused whole" />
              <Fig n={breaches.length} label={breaches.length === 1 ? 'breach' : 'breaches'} tone={breaches.length ? 'red' : 'mint'} title="Findings approved in its place against it since it was set: only something that went around bp's doors can make one" />
            </div>
            {held && <p className="wb-meta">Held at {held.tools.join(', ')}; every door that refused cited {r.id} and its author.</p>}
            {breaches.length > 0 ? (
              <ul className="rl-rows" aria-label={'Breaches of ' + r.id}>
                {breaches.map((b) => (
                  <li key={b.id} className="rl-row stop"><button type="button" onClick={() => P.F[b.feature] && E.flyToFeature(b.feature)}>
                    <span className="tx"><small>{P.F[b.feature]?.name ?? b.feature} · approved by {b.by} · {when(b.at)}</small>{b.title}</span>
                    <span className="vs"><b className="t-red">breach</b></span>
                  </button></li>
                ))}
              </ul>
            ) : <p className="none">No finding has been approved in its place against it since it was set.</p>}
          </Sec>
        )}
        {on && <Sec head={r.kind === 'grant' ? 'What agents may decide alone now' : 'What it holds now'} aside="the open backlog"><Now now={rp.r?.now} kind={r.kind} busy={rp.busy} live /></Sec>}
        <Sec head="Replayed over your decisions now" aside="the same replay as when it was set">
          <Evidence bt={rp.r?.backtest} busy={rp.busy} error={rp.error} />
        </Sec>
      </div>
      <div className="wb-act rl-act">
        <Verdict bt={rp.r?.backtest} />
        <span className="sp" />
        {on ? <button type="button" className="bt rl-revoke" onClick={revoke}>{isOrder(r.kind) ? 'Lift ' + r.id : 'Revoke ' + r.id}</button>
          : <button type="button" className="bt go" onClick={renew} disabled={!rp.r}>{'Set it again as ' + nextRuleId(all, r.kind) + (r.kind === 'grant' || r.expiresAt ? ' for 24 h' : '')}</button>}
      </div>
    </>
  );
}

/** The place a selection names: a whole wing or room keeps its kind and id, otherwise a selection of features. */
function scopeOf(P: ReturnType<typeof useEngine>['M']['P'], ids: Record<string, 1>, label: string): ScanScope {
  const fs = Object.keys(ids).filter((id) => P.F[id]), set = new Set(fs);
  const same = (xs: string[]) => xs.length === set.size && xs.every((x) => set.has(x));
  if (fs.length === 1) return { kind: 'feature', id: fs[0], label: P.F[fs[0]].name, features: fs };
  for (const d of P.domains) if (same(d.capabilities.flatMap((c) => P.C[c]?.features ?? []))) return { kind: 'wing', id: d.id, label: d.name, features: fs };
  for (const c of P.capabilities) if (same(c.features)) return { kind: 'room', id: c.id, label: c.name, features: fs };
  return { kind: 'selection', label: label || fs.length + ' features', features: fs };
}
/** The place less the rooms left out: "Everything except Billing". */
function without(P: ReturnType<typeof useEngine>['M']['P'], s: ScanScope, out: { name: string; features: string[] }[]): ScanScope {
  if (!out.length) return s;
  const drop = new Set(out.flatMap((x) => x.features)), base = s.kind === 'all' ? P.features.map((f) => f.id) : s.features;
  return { kind: 'selection', label: s.label + ' except ' + out.map((x) => x.name).join(', '), features: base.filter((f) => !drop.has(f)) };
}

function Writer({ slug, all, onSet }: { slug: string; all: Rule[]; onSet: (id: string) => void }) {
  const E = useEngine(), P = E.M.P;
  const s = useBp((s) => ({ tgt: s.tgt }), shallowEqual);
  const [kind, setKind] = useState<RuleKind | null>(null);
  const [everything, setEverything] = useState(false);
  const [out, setOut] = useState<{ name: string; features: string[] }[]>([]);
  const [lenses, setLenses] = useState<string[]>([]);
  const [effort, setEffort] = useState('medium');
  const [model, setModel] = useState('');
  const [tier, setTier] = useState(3);
  const [cautious, setCautious] = useState(false);
  const [hours, setHours] = useState(0);
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string>();
  // an agent's proposed rule (a rule.propose card): the writer takes it whole, for the person to replay, change or set
  const pd = usePickedDraft();
  useEffect(() => {
    if (!pd || pd.n === tookDraft) return;
    tookDraft = pd.n;
    const d = pd.d;
    setKind(d.kind);
    if (d.scope.kind === 'all') setEverything(true);
    else { setEverything(false); E.setTarget(Object.fromEntries(d.scope.features.filter((f) => P.F[f]).map((f) => [f, 1])) as Record<string, 1>, d.scope.label); }
    if (d.lenses) setLenses(d.lenses);
    if (d.maxEffort) setEffort(d.maxEffort);
    setModel(d.model ?? '');
    setTier(d.minTier ?? -1);
    setCautious(!!d.cautious);
    setHours(d.hours ?? 0);
  }, [pd, E, P]);
  const base = useMemo<ScanScope | null>(() => (everything ? { kind: 'all', label: 'Everything', features: [] } : s.tgt.n ? scopeOf(P, s.tgt.ids, s.tgt.label) : null), [P, everything, s.tgt]);
  useEffect(() => setOut([]), [base]);
  const scope = useMemo(() => (base ? without(P, base, out) : null), [P, base, out]);
  const lensIds = Object.keys(P.LENS);
  const draft = useMemo<DraftBody | null>(() => {
    if (!scope || !kind || (kind === 'only' && !lenses.length) || (scope.kind !== 'all' && !scope.features.length)) return null;
    const d: DraftBody = { kind, scope };
    if (kind === 'only') d.lenses = lenses;
    if (kind === 'cap') { d.maxEffort = effort; if (model) d.model = model; }
    if (kind === 'grant') { if (tier >= 0) d.minTier = tier; if (cautious) d.cautious = true; d.hours = hours || 24; } else if (hours) d.hours = hours;
    d.text = ruleText({ kind, lenses: d.lenses, maxEffort: d.maxEffort as Rule['maxEffort'], model: d.model as Rule['model'], minTier: d.minTier, cautious: d.cautious }, (id) => P.LENS[id]?.name ?? id);
    return d;
  }, [scope, kind, lenses, effort, model, tier, cautious, hours, P]);
  const rp = useReplay(slug, draft), bt = rp.r?.backtest;
  useEffect(() => setArmed(false), [draft]);
  const risky = kind === 'grant' && !!bt && !trustworthy(bt);
  const set = () => {
    if (!draft) return;
    if (risky && !armed) { setArmed(true); return; }
    setRule(slug, draft).then((r) => { E.toast((isOrder(r.kind) ? 'Order ' : 'Grant ') + r.id + ' set', r.text + ' · ' + r.scope.label); onSet(r.id); }, (e: Error) => setErr(e.message));
  };
  const nextId = nextRuleId(all, kind ?? 'hold');
  const pill = (on: boolean, label: string, fn: () => void, key?: string) => <button key={key ?? label} type="button" aria-pressed={on} onClick={fn}>{label}</button>;
  return (
    <>
      <div className="wb-scroll">
        <div className="wb-kick"><span>New rule</span><span>{scope ? (scope.kind === 'all' ? 'everything' : scope.features.length + ' features') : 'no place yet'}</span>{kind && <span>{nextId}</span>}</div>
        <h3 className="wb-title">{draft?.text ?? 'Write a rule'}{scope && <small className="rl-where"> · {scope.label}</small>}</h3>
        <p className="wb-lede">A rule steers every agent at once until you lift it. Before you set it, see what it does to the open backlog now, and where it would have disagreed with your own past decisions.</p>
        <Sec head="Place" aside={scope ? scope.kind : 'plan'}>
          {!base && <p>Shift-click a wing, room or fixture on the plan, or shift-drag a box. Or govern the whole product.</p>}
          <div className="wb-filter">
            {pill(everything, 'Everything', () => setEverything(!everything))}
            {s.tgt.n > 0 && !everything && <button type="button" onClick={() => E.lookAtTarget()}>Look at {s.tgt.label || 'the selection'}</button>}
            {out.map((x) => <button key={x.name} type="button" className="rl-out" onClick={() => setOut(out.filter((y) => y !== x))} title="Put it back">{x.name} left out ×</button>)}
          </div>
        </Sec>
        <Sec head="Rule" aside="replayed before it applies">
          <ul className="wb-tpl rl-kinds" aria-label="Rule templates">
            {KINDS.map((x) => <li key={x.k}><button type="button" aria-pressed={kind === x.k} onClick={() => setKind(x.k)}><b>{x.head}</b><span>{x.sub}</span></button></li>)}
          </ul>
          {kind === 'only' && <div className="wb-filter rl-opts" aria-label="Lenses allowed">{lensIds.map((id) => pill(lenses.includes(id), P.LENS[id]?.name ?? id, () => setLenses(lenses.includes(id) ? lenses.filter((x) => x !== id) : [...lenses, id]), id))}</div>}
          {kind === 'cap' && <div className="wb-filter rl-opts" aria-label="Highest effort">{['low', 'medium', 'high'].map((e) => pill(effort === e, 'up to ' + e, () => setEffort(e), e))}{pill(model === '', 'any model', () => setModel(''))}{pill(model === 'opus', 'opus only', () => setModel('opus'))}</div>}
          {kind === 'grant' && <div className="wb-filter rl-opts" aria-label="Tier floor">{[3, 2, 1].map((t) => pill(tier === t, TIER_WORD[t] + (t < 3 ? ' or milder' : ' only'), () => setTier(t), 't' + t))}{pill(tier === -1, 'any tier', () => setTier(-1))}</div>}
          {kind === 'grant' && <div className="wb-filter rl-opts" aria-label="Caution">{pill(cautious, 'only where it has agreed with me (90%+)', () => setCautious(!cautious))}</div>}
          {kind && <div className="wb-filter rl-opts" aria-label="How long">{HOURS.filter((x) => kind !== 'grant' || x.h).map((x) => pill((hours || (kind === 'grant' ? 24 : 0)) === x.h, x.w, () => setHours(x.h), 'h' + x.h))}</div>}
        </Sec>
        {draft && <Sec head="What it does now" aside="the open backlog"><Now now={rp.r?.now} kind={draft.kind} busy={rp.busy} /></Sec>}
        <Sec head="Replayed over your decisions" aside={bt ? bt.decided + ' decisions' : ''}>
          <Evidence bt={bt} busy={rp.busy} error={rp.error} onLeaveOut={scope ? (name, features) => setOut([...out, { name, features }]) : undefined} />
        </Sec>
        {err && <p className="wb-err">{err}</p>}
      </div>
      <div className="wb-act rl-act">
        {draft ? <Verdict bt={bt} /> : <span className="rl-vd">Pick a place and a rule</span>}
        <span className="sp" />
        <button type="button" className={'bt go' + (armed ? ' rl-armed' : '')} disabled={!draft || !bt || rp.busy} onClick={set} title={risky && !armed ? 'The replay flags this grant: the first tap arms it, the second sets it' : undefined}>
          {armed ? 'Tap again: grant despite the flags' : !draft ? 'Set' : kind === 'grant' ? 'Grant ' + nextId + ' for ' + (hours || 24) + ' h' : 'Set order ' + nextId}
        </button>
      </div>
    </>
  );
}
