'use client';
// A · Review: the open proposals (live product) or questions (Kettle) as compact rows on the left; the selected one
// read in full on the right, with the metric move as a large before -> after figure, the body's sections open, and a
// sticky action bar. Deciding selects the next row. Hovering a row marks its feature on the plan.
// v5 (scan-finding/1): a live detail carries what the scan stored (FindingFacts: the score and its breakdown, impact_why, the
// predicted verdict and its precedent, a built change's proof); machine decisions still inside their veto window are listed
// after the open items ("Decided by the machine · veto open") and their detail offers the person's Veto (VetoDetail).
import { useEffect, useMemo, useState } from 'react';
import { dayHhmmUTC, fmtWait, hhmmUTC, metricHistory, pname, sheetOf, type SimDecision } from '@bp/core/model';
import { priorRecord, recordWords } from '@bp/core/scan/record';
import type { Proposal, ScanSnapshot } from '@bp/core/scan/types';
import { STAGE_WORDS } from '../../TrackRecord';
import { LiveEmpty, OriginChip, TierChip, URG, bodySections, declineDrafts, fmtN, metricMove, oncePerProposal, proposalSummary } from '../../Queue';
import { optHover, shallowEqual, useAnswerNote, useBp, useEngine, useLive, useScanCtx, useVariant, useWritesOn } from '../../hooks';
import { vetoable } from '@bp/core/scan/trust';
import { vetoDecision } from '@/lib/scan/actions';
import { Group, Row, Sec, Workbench, useListRef, useWalk } from './shell';
import { BriefFacts, useBrief } from '../../Brief';


/** The list key prefix of a machine decision row (v5): `veto:<proposal id>`. */
const VETO = 'veto:';
/** How long "Decline the repeats" stays armed after its first click. */
const REARM_MS = 5000;

/** The metric move as parts for the big figure; null when the proposal names no metric. */
function moveParts(p: Proposal, unit: string | undefined, label: string | undefined, scan: ScanSnapshot | undefined) {
  if (!p.metric) return null;
  const h = metricHistory(scan, p.feature, p.lens, p.metric), last = h[h.length - 1];
  const u = last?.unit ?? unit ?? '', d = p.expected_delta;
  return {
    name: label ?? p.metric, key: p.metric, unit: u,
    before: last ? fmtN(last.value) : null,
    after: last && d !== undefined ? fmtN(last.value + d) : null,
    delta: d !== undefined ? (d > 0 ? '+' : d < 0 ? '−' : '±') + fmtN(Math.abs(d)) : null,
    readings: h.length,
  };
}

export function Review() {
  const E = useEngine(), M = E.M, sim = M.sim, live = useLive();
  const s = useBp((s) => ({ who: s.who, view: s.view, simV: s.simV }), shallowEqual);
  const proposals = live?.product.scan?.proposals;
  const [lens, setLens] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  // "Decline the repeats" asks twice: a live decision is final (no route reopens it). The first click takes the ids it
  // names, and the second declines only those (a scan delta in between adds nothing unseen); the arm lapses after
  // REARM_MS and drops when the lens filter or the reader changes
  const [armRepeats, setArmRepeats] = useState<string[] | null>(null), writes = useWritesOn();
  useEffect(() => { if (!armRepeats) return; const t = setTimeout(() => setArmRepeats(null), REARM_MS); return () => clearTimeout(t); }, [armRepeats]);
  useEffect(() => setArmRepeats(null), [lens, s.who]);
  const listRef = useListRef();

  // a decline draft lives until its proposal is decided (as in the classic list)
  useEffect(() => {
    if (!proposals || !declineDrafts.size) return;
    const open = new Set(proposals.filter((p) => p.status === 'proposed').map((p) => p.id));
    for (const id of [...declineDrafts.keys()]) if (!open.has(id)) declineDrafts.delete(id);
  }, [proposals]);
  useEffect(() => () => E.setHlDec(null), [E]);

  // the queue, in the order J/K walk it on the plan; read once per sim version and reader
  const all = useMemo(() => {
    if (!sim.has) return [] as SimDecision[];
    const o = sim.cardOrder(s.who, s.view);
    return sim.live ? oncePerProposal(o) : o;
  }, [sim, s.who, s.view, s.simV]); // eslint-disable-line react-hooks/exhaustive-deps
  const lenses = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of all) c.set(d.lens, (c.get(d.lens) ?? 0) + 1);
    return [...c.entries()];
  }, [all]);
  const fl = lens && lenses.some(([l]) => l === lens) ? lens : null;
  const items = useMemo(() => (fl ? all.filter((d) => d.lens === fl) : all), [all, fl]);
  const ids = useMemo(() => items.map((d) => d.id), [items]);
  // a live row's proposal, for its tier and origin chips (Kettle's questions have none)
  const propOf = useMemo(() => new Map((proposals ?? []).map((p) => [p.id, p])), [proposals]);
  // v5: machine decisions a person may still veto (decided_by machine:*, inside veto_until), listed after the open items
  const vetos = useMemo(() => { const now = new Date().toISOString(); return sim.live ? (proposals ?? []).filter((p) => vetoable(p, now)) : []; }, [proposals, sim.live]);
  const curVeto = selId?.startsWith(VETO) ? vetos.find((p) => VETO + p.id === selId) ?? null : null;
  const walkIds = useMemo(() => [...ids, ...vetos.map((p) => VETO + p.id)], [ids, vetos]);
  const cur = curVeto ? null : items.find((d) => d.id === selId) ?? items[0] ?? null;
  const onKey = useWalk(walkIds, curVeto ? VETO + curVeto.id : cur?.id ?? (vetos[0] ? VETO + vetos[0].id : null), setSelId as (id: string | null) => void, listRef);

  if (!sim.has) return <div className="wb-empty"><b>No swarm data</b>The swarm file did not load, so there is nothing to review.</div>;

  const urgent = all.filter((d) => d.urg === 'high').length;
  const short = (l: string) => M.P.LENS[l]?.short ?? sheetOf(M.P, l).no;
  /** Decide, then select the row after it (else the one before). */
  const decide = (d: SimDecision, oi: number, note?: string, keep?: boolean) => {
    const i = items.findIndex((x) => x.id === d.id), next = items[i + 1] ?? items[i - 1] ?? null;
    setSelId(next?.id ?? null);
    E.setHlDec(null);
    if (keep) E.keepAnswer(d.id, oi); else E.decide(d.id, oi, note);
    requestAnimationFrame(() => {
      const row = next && listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(next.id)}"]`);
      if (row) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); return; }
      // nothing left to take over: the list pane takes focus. Deciding the last open item unmounts the action bar
      // the reader pressed, and a live write can be REFUSED (Engine.decide rolls it back and reopens the card) -
      // without this, focus is on <body> when the card comes back and the keys reach nothing.
      listRef.current?.focus({ preventScroll: true });
    });
  };

  const first = s.who ? pname(M.P, s.who).split(' ')[0] : '';
  const row = (d: SimDecision) => {
    const f = M.P.F[d.f], on = cur?.id === d.id, p = sim.live ? propOf.get(d.base) : undefined;
    return (
      <Row key={d.id} id={d.id} on={on} onPick={() => setSelId(d.id)} cls={'u-' + d.urg}
        onEnter={() => !E.S.dec && E.setHlDec(d.id)} onLeave={() => E.setHlDec(null)}>
        <i className="urg" aria-hidden="true" />
        <span className="rk"><span>{URG[d.urg]}</span><span className="lz">{short(d.lens)}</span>{d.isNew && <span className="nw">New</span>}{p && <TierChip p={p} />}{p && <OriginChip p={p} link={false} />}{p && d.recNote && <span className="db" title={'The decision brief: ' + d.recNote}>declined before</span>}</span>
        <span className="rt">{d.q}</span>
        <span className="rm"><span>{f?.name ?? d.f}</span><span>{fmtWait(sim.waitMin(d))}</span></span>
      </Row>
    );
  };
  const mine = s.who ? items.filter((d) => d.decider === s.who) : null; // live too: the map names deciders (live-feed.ts liveDecider)
  const vetoGroup = vetos.length ? (
    <Group head="Decided by the machine · veto open" n={vetos.length} label="Machine decisions you can still veto">
      {vetos.map((p) => (
        <Row key={p.id} id={VETO + p.id} on={curVeto?.id === p.id} onPick={() => setSelId(VETO + p.id)} cls="u-low">
          <i className="urg" aria-hidden="true" />
          <span className="rk"><span>{p.status === 'approved' ? 'Approved' : 'Declined'}</span><span className="lz">{short(p.lens)}</span><span className="nw" title={'Veto until ' + p.veto_until}>machine</span></span>
          <span className="rt">{p.title}</span>
          <span className="rm"><span>{M.P.F[p.feature]?.name ?? p.feature}</span><span>veto until {hhmmUTC(p.veto_until)}</span></span>
        </Row>
      ))}
    </Group>
  ) : null;
  const main = !items.length ? (sim.live ? (vetos.length ? null : <LiveEmpty />) : <div className="wb-empty"><b>Nothing waiting</b>Every agent has what it needs. The swarm is working.</div>)
    : mine ? (
      <>
        <Group head={'Waiting for ' + first} n={mine.length} label={'Questions waiting for ' + first}>{mine.length ? mine.map(row) : <li className="wb-none">Nothing waits for {first}.</li>}</Group>
        <Group head="Everyone else" n={items.length - mine.length} label="Questions for everyone else">{items.filter((d) => d.decider !== s.who).map(row)}</Group>
      </>
    ) : (
      <Group head={sim.live ? 'Proposals' : 'Questions'} n={items.length} label={sim.live ? 'Open proposals, most urgent first' : 'Open questions, most urgent first'}>{items.map(row)}</Group>
    );
  const list = <>{main}{vetoGroup}</>;

  const batches = sim.batchGroups();
  // live: the listed open proposals (under the lens filter) the decision brief found repeating a standing decline
  // (live-feed.ts recommends Decline on them)
  const repeats = sim.live && writes ? items.filter((d) => d.recNote) : [];
  // what the second click would decline: the armed ids still listed as repeats (none left = not armed, never "decline 0")
  const stillArmed = armRepeats ? repeats.filter((d) => armRepeats.includes(d.id)) : [], armed = stillArmed.length ? stillArmed : null;
  const declineRepeats = () => {
    if (!armed) { setArmRepeats(repeats.map((d) => d.id)); return; }
    setArmRepeats(null); setSelId(null); E.setHlDec(null);
    for (const d of armed) E.decide(d.id, 1, d.recNote);
  };
  const strip = (
    <>
      <div className="wb-count"><b>{all.length}</b><span>{sim.live ? 'open proposals' : 'open questions'}</span></div>
      <div className="wb-count t-amber"><b>{urgent}</b><span>urgent</span></div>
      {repeats.length > 0 && (
        <div className="wb-filter wb-repeats" role="group" aria-label="Decline the repeats">
          <button type="button" aria-pressed={!!armed} onClick={declineRepeats}
            title={'Each repeats an idea you declined: ' + (armed ?? repeats).map((d) => d.base).join(', ') + '. Each is declined with a note naming the decision it repeats. Final: no route reopens a decision.'}>
            <i aria-hidden="true" />{armed ? `Click again: decline ${armed.length}, each naming its decline` : `Decline ${repeats.length} repeat${repeats.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
      {batches.length > 0 && (
        <div className="wb-filter" role="group" aria-label="Batch-decide like questions">
          {batches.map((g) => (
            <button key={g.key} type="button" title={'Decide ' + g.ids.length + ' ' + (M.P.LENS[g.lens]?.name ?? g.lens) + ' questions at their recommendation (' + g.label + '), with one undo'}
              onClick={() => { setSelId(null); E.decideBatch(g.key); }} {...optHover(E, 'batch:' + g.key, 0)} style={{ '--lens': E.lensAccent(g.lens) } as React.CSSProperties}>
              <i aria-hidden="true" />Batch-decide {g.ids.length} · {short(g.lens)}
            </button>
          ))}
        </div>
      )}
      {lenses.length > 1 && (
        <div className="wb-filter" role="group" aria-label="Filter by lens">
          <button type="button" aria-pressed={!fl} onClick={() => setLens(null)}>All <small>{all.length}</small></button>
          {lenses.map(([l, n]) => (
            <button key={l} type="button" aria-pressed={fl === l} title={M.P.LENS[l]?.name ?? l} onClick={() => setLens(fl === l ? null : l)}
              style={{ '--lens': E.lensAccent(l) } as React.CSSProperties}><i aria-hidden="true" />{short(l)} <small>{n}</small></button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <Workbench cls="wb-review" strip={strip} list={list} listLabel={sim.live ? 'Proposals to review' : 'Questions to answer'} listRef={listRef} onKey={onKey}
      detailKey={curVeto ? VETO + curVeto.id : cur?.id ?? 'none'} detailLabel="Selected item"
      detail={curVeto ? <VetoDetail p={curVeto} onDone={() => setSelId(null)} />
        : cur ? (sim.live ? <LiveDetail d={cur} decide={decide} /> : <SimDetail d={cur} decide={decide} />) : <div className="wb-empty"><b>Nothing selected</b>Pick an item on the left.</div>} />
  );
}

/** The kicker over a detail title: urgency, lens, id, newness. */
function Kicker({ d, extra }: { d: SimDecision; extra?: string }) {
  const E = useEngine(), M = E.M, ld = M.P.LENS[d.lens];
  return (
    <div className={'wb-kick u-' + d.urg}>
      <span className="urg">{URG[d.urg]}</span>
      <span className="lz" style={{ '--lens': E.lensAccent(d.lens) } as React.CSSProperties} title={ld?.name ?? d.lens}><i aria-hidden="true" />{ld?.short ?? sheetOf(M.P, d.lens).no} · {ld?.name ?? 'General'}</span>
      {extra && <span>{extra}</span>}
      {d.ord && <span>asked because of {d.ord}</span>}
      <span>{d.base}</span>
      {d.isNew && <span className="nw">New</span>}
    </div>
  );
}

function PlaceActions({ d }: { d: SimDecision }) {
  const E = useEngine();
  return (
    <span className="wb-place">
      <button type="button" className="bt" onClick={() => E.openDecision(d.id)} title="Fly to the feature and open the question on the plan">Show on plan</button>
    </span>
  );
}

function LiveDetail({ d, decide }: { d: SimDecision; decide: (d: SimDecision, oi: number, note?: string) => void }) {
  const E = useEngine(), M = E.M, sim = M.sim, live = useLive(), scan = live?.product.scan, writes = useWritesOn();
  const p = scan?.proposals.find((x) => x.id === d.base);
  const brief = useBrief(d);
  const f = M.P.F[d.f];
  const [declining, setDeclining] = useState(() => declineDrafts.has(d.base)), [note, setNote] = useState(() => declineDrafts.get(d.base) ?? '');
  useAnswerNote(d.id);   // Approve previews its expected move on the plan; this clears it when the detail goes
  const field = p?.metric ? M.P.LENS[p.lens]?.F[p.metric] : undefined;
  const mv = p ? moveParts(p, field?.unit, field?.label, scan) : null;
  const mvText = p && !mv ? metricMove(p, (l, k) => M.P.LENS[l]?.F[k]?.unit, scan) : null;
  const sum = p ? proposalSummary(p) : null;
  const ss = useMemo(() => bodySections(p?.body), [p?.body]);
  const h = p?.metric ? metricHistory(scan, p.feature, p.lens, p.metric) : [], last = h[h.length - 1];
  const ev = last ? [last.evidence, last.method && 'measured by ' + last.method, last.measured_at && 'on ' + last.measured_at.slice(0, 10), h.length > 1 ? h.length + ' readings' : ''].filter(Boolean) : [];
  const meta = p ? [p.parent_id && 'follows ' + p.parent_id, p.after_value !== undefined && 'after the change: ' + fmtN(p.after_value), 'proposed ' + p.created_at.slice(0, 10)].filter(Boolean) : [];
  const cancel = () => { declineDrafts.delete(d.base); setNote(''); setDeclining(false); };
  // what earlier decisions on this feature + lens (and the attempts this one follows) came to; live only
  const rec = useMemo(() => (scan && p ? priorRecord(scan, p) : null), [scan, p]);
  const rw = rec && p ? recordWords(rec, M.P.LENS[p.lens]?.name ?? p.lens, (st) => STAGE_WORDS[st]) : null;
  return (
    <>
      <div className="wb-scroll">
        <Kicker d={d} extra={p?.kind && p.kind !== 'fix' ? p.kind : undefined} />
        {p && (p.tier !== undefined || p.origin === 'ado') && <div className="wb-tier"><TierChip p={p} /><OriginChip p={p} /></div>}
        <h3 className="wb-title">{d.q}</h3>
        {sum && <p className="wb-lede">{sum}</p>}
        <div className="wb-where">{f?.name ?? d.f} · {M.P.D[f?.domain ?? '']?.name ?? f?.domain} · waiting <b>{fmtWait(sim.waitMin(d))}</b>{M.P.scale > 1 ? ' · ' + M.P.buildings[d.b].short : ''}</div>
        {brief && <BriefFacts b={brief} d={d} />}
        {mv && (
          <div className="wb-move" aria-label={`${mv.name}: ${mv.before ?? 'not measured'}${mv.after ? ' to ' + mv.after : ''} ${mv.unit}`}>
            <span className="nm">{mv.name}{mv.name !== mv.key && <small>{mv.key}</small>}</span>
            <span className="fg">
              <span className="bf"><b>{mv.before ?? '—'}</b><small>{mv.before ? 'now' : 'not measured yet'}</small></span>
              {(mv.after || mv.delta) && <span className="ar" aria-hidden="true">→</span>}
              {mv.after ? <span className="af"><b>{mv.after}</b><small>expected</small></span> : mv.delta ? <span className="af"><b>{mv.delta}</b><small>expected change</small></span> : null}
              {mv.unit && <span className="un">{mv.unit}</span>}
              {mv.after && mv.delta && <span className="dl">{mv.delta}</span>}
            </span>
          </div>
        )}
        {mvText && <div className="wb-movetx">{mvText}</div>}
        {rec && rw && (
          <Sec head="Before you decide" aside={rec.same.length ? rec.same.length + ' earlier decision' + (rec.same.length === 1 ? '' : 's') : undefined}>
            {rec.same.length > 0 && (
              <ul className="wb-prior">
                {rec.same.map((e, i) => (
                  <li key={e.id} className={'s-' + e.stage}>{M.tracks?.T[e.id]
                    ? <button type="button" onClick={() => E.openTrack(e.id)} title={'Open the track record of ' + e.id}>{rw.same[i]}</button>
                    : <span>{rw.same[i]}</span>}<small>{e.id}</small></li>
                ))}
              </ul>
            )}
            <p className={rec.lens.n ? 'wb-help' : 'none'}>{rw.lens}</p>
          </Sec>
        )}
        {p && (
          <div className="wb-chips">
            <span title="The standard this item rests on"><small>Standard</small>{p.standard === 'none' ? 'none' : p.standard}</span>
            {p.size && <span title="Size"><small>Size</small>{p.size}</span>}
            {p.risk !== undefined && <span className={p.risk >= 7 ? 'hi' : ''} title="Risk, 1 to 10"><small>Risk</small>{p.risk} / 10</span>}
          </div>
        )}
        {p ? <FindingFacts p={p} /> : null}
        {p ? (
          <>
            {ss.length ? ss.map((x, i) => (
              <Sec key={i + x.head} head={x.head}>{x.text.split('\n').filter((t) => t.trim()).map((t, j) => <p key={j} className={/^\s*[-*]\s/.test(t) ? 'li' : undefined}>{t.replace(/^\s*[-*]\s+/, '')}</p>)}</Sec>
            )) : <Sec head="Summary"><p className="none">The proposal has no body.</p></Sec>}
            <Sec head="Evidence for the before value">{ev.length ? <p>{ev.join(' · ')}</p> : <p className="none">{last ? 'The reading carries no evidence.' : 'No reading yet.'}</p>}</Sec>
            {meta.length ? <p className="wb-meta">{meta.join(' · ')}</p> : null}
          </>
        ) : <p className="none">The proposal’s row is not in the scan snapshot yet.</p>}
      </div>
      <div className="wb-act">
        {declining ? (
          <form className="wb-decl" onSubmit={(e) => { e.preventDefault(); declineDrafts.set(d.base, note.trim()); decide(d, 1, note.trim()); }}>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not? (optional)" aria-label="Decline note (optional)" maxLength={500} autoFocus
              onKeyDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); if (e.key === 'Escape') { e.preventDefault(); cancel(); } }} />
            <button type="submit" className="bt">Decline</button>
            <button type="button" className="bt" onClick={cancel}>Cancel</button>
          </form>
        ) : (
          <>
            {writes && d.recNote ? <button type="button" className="bt go" title={'Decline, noting: ' + d.recNote} onClick={() => decide(d, 1, d.recNote)}>✓ Decline · a repeat</button> : null}
            {writes ? <button type="button" className={'bt' + (d.recNote ? '' : ' go')} title="Approve: the scan executes it in its next execute phase" onClick={() => decide(d, 0)} {...optHover(E, d.id, 0)}>{d.recNote ? 'Approve anyway' : '✓ Approve'}</button> : null}
            {writes ? <button type="button" className="bt" title="Decline, with an optional note" onClick={() => setDeclining(true)}>{d.recNote ? 'My own note…' : 'Decline…'}</button> : null}
            <span className="sp" />
            <PlaceActions d={d} />
          </>
        )}
      </div>
    </>
  );
}

/** v5 (scan-finding/1): what the scan stored about a finding, said as it stored it - the score and its breakdown (never
 *  recomputed here), why the impact, the predicted verdict and its precedent, and a built change's proof (before -> after
 *  under one method, the verdict, and whether a red control proved the gate bites). Nothing for a pre-v5 row. */
function FindingFacts({ p }: { p: Proposal }) {
  const sp = p.score_parts, pr = p.proof, fmt = (x: number | undefined) => (x === undefined ? '—' : fmtN(x));
  if (p.score === undefined && p.impact === undefined && !p.predicted_verdict && !pr) return null;
  return (
    <>
      <Sec head="Score" aside={p.score !== undefined ? (sp?.formula ?? 'scan-score/1') : 'unscored'}>
        <div className="wb-chips">
          <span title="Stored by the scan, never recomputed"><small>Score</small>{p.score !== undefined ? p.score.toFixed(1) : 'unscored'}</span>
          {p.impact !== undefined && <span title="Impact 1-10"><small>Impact</small>{p.impact}{sp?.impact !== undefined && sp.impact !== p.impact ? ' (' + sp.impact + ')' : ''}</span>}
          {p.confidence && <span title={'Confidence weight ' + fmt(sp?.confidence_w)}><small>Confidence</small>{p.confidence}{sp?.confidence_w !== undefined ? ' ×' + fmtN(sp.confidence_w) : ''}</span>}
          {p.effort !== undefined && <span title={'Effort divisor ' + fmt(sp?.effort_div)}><small>Effort</small>{p.effort}{sp?.effort_div !== undefined ? ' ÷' + fmtN(sp.effort_div) : ''}</span>}
          {sp?.risk_factor !== undefined && <span title="Risk of the change, as a factor"><small>Risk factor</small>×{fmtN(sp.risk_factor)}</span>}
          {p.band === 'reserve' && <span title="Verified and scored, over the run's cap: filed, not ranked"><small>Band</small>reserve</span>}
          {p.mvp && <span title={p.mvp_rule === 'override' ? 'MVP by override' : 'The top score of its lens in its run'}><small>MVP</small>{p.mvp_rule ?? 'yes'}</span>}
        </div>
        {p.impact_why ? <p>{p.impact_why}</p> : null}
        {p.mvp_why ? <p className="wb-help">MVP: {p.mvp_why}</p> : null}
      </Sec>
      {p.predicted_verdict && (
        <Sec head="Predicted" aside={p.predicted_by}>
          <p><b>{p.predicted_verdict}</b>{p.predicted_at ? ' · recorded ' + dayHhmmUTC(p.predicted_at) + ', before anyone decided' : ''}</p>
          {p.predicted_why ? <p className="wb-help">{p.predicted_why}</p> : null}
        </Sec>
      )}
      {pr && (
        <Sec head="Proof" aside={pr.verdict}>
          <p>{pr.metric ?? 'metric'}: <b>{fmt(pr.before)}</b> → <b>{fmt(pr.after)}</b>{pr.unit ? ' ' + pr.unit : ''}{pr.method ? ' · ' + pr.method : ''}</p>
          <p className={pr.control === 'red' ? 'wb-help' : 'none'}>{pr.control === 'red' ? 'Control red: the gate was shown to bite.' : 'No red control: the measurement is not proven to discriminate.'}{pr.base_sha || pr.head_sha ? ' · ' + (pr.base_sha ?? '?').slice(0, 7) + '..' + (pr.head_sha ?? '?').slice(0, 7) : ''}</p>
        </Sec>
      )}
    </>
  );
}

/** A machine decision inside its veto window: what the machine decided and why, and the person's Veto (seam B2: the store's
 *  CAS puts it back to proposed with the note `veto: <reason>`; lens-scan's trust verb counts it as a reversal). A reason is
 *  required. Hidden while BP_WRITES=off (the route answers 403 then). */
function VetoDetail({ p, onDone }: { p: Proposal; onDone: () => void }) {
  const E = useEngine(), M = E.M, ctx = useScanCtx(), writes = useWritesOn();
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false);
  const f = M.P.F[p.feature], ld = M.P.LENS[p.lens];
  const send = () => {
    const r = reason.trim();
    if (!r || busy) return;
    setBusy(true);
    vetoDecision(ctx, p.id, r).then(
      () => { E.toast('Vetoed', p.id + ' is back to proposed: ' + r); onDone(); },
      (e: Error & { status?: number }) => { setBusy(false); E.toast(e.status === 409 ? 'Not vetoable any more' : 'Veto failed', e.status === 409 ? 'the window passed, or someone decided first' : e.message, undefined, undefined, 'warn'); },
    );
  };
  return (
    <>
      <div className="wb-scroll">
        <div className="wb-kick u-low"><span className="urg">Machine</span><span className="lz" title={ld?.name ?? p.lens}><i aria-hidden="true" />{ld?.short ?? p.lens} · {ld?.name ?? p.lens}</span><span>{p.id}</span></div>
        <h3 className="wb-title">{p.title}</h3>
        <div className="wb-where">{f?.name ?? p.feature} · {p.status} by <b>{p.decided_by}</b>{p.decided_at ? ' at ' + dayHhmmUTC(p.decided_at) : ''} · veto until <b>{dayHhmmUTC(p.veto_until)}</b></div>
        <FindingFacts p={p} />
        {p.decision_note ? <Sec head="The machine's note"><p>{p.decision_note}</p></Sec> : null}
      </div>
      <div className="wb-act">
        {writes ? (
          <form className="wb-decl" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why veto? (required)" aria-label="Veto reason (required)" maxLength={500}
              onKeyDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }} />
            <button type="submit" className="bt go" data-veto={p.id} disabled={!reason.trim() || busy} title="Put it back to proposed: a person decides it, and the slice's trust drops">{busy ? 'Vetoing…' : 'Veto'}</button>
          </form>
        ) : <span className="wb-help">Decisions are read-only here (BP_WRITES=off).</span>}
      </div>
    </>
  );
}

function SimDetail({ d, decide }: { d: SimDecision; decide: (d: SimDecision, oi: number, note?: string, keep?: boolean) => void }) {
  const [keep, setKeep] = useState(false), tl = useBp((s) => (s.tgt.n ? s.tgt.label : ''));
  const E = useEngine(), V = useVariant(), M = E.M, sim = M.sim;
  const view = useBp((s) => s.view);
  const f = M.P.F[d.f], bn = sim.blocksNow(d);
  const note = V.ui?.queueNote?.(d, view, M) ?? null, hn = useAnswerNote(d.id);
  const affects = d.affects.filter((id) => id !== d.f && M.P.F[id]).slice(0, 8);
  const brief = useBrief(d);
  return (
    <>
      <div className="wb-scroll">
        <Kicker d={d} />
        <h3 className="wb-title">{d.q}</h3>
        <div className="wb-where">{f?.name ?? d.f} · {M.P.D[f?.domain ?? '']?.name ?? f?.domain}{M.P.scale > 1 ? ' · ' + M.P.buildings[d.b].short : ''}</div>
        <div className="wb-figs">
          <div className="wb-fig"><b className="mid">{fmtWait(sim.waitMin(d))}</b><span>waiting</span></div>
          <div className={'wb-fig' + (bn ? ' t-amber' : '')}><b>{bn}</b><span>agent{bn === 1 ? '' : 's'} held</span></div>
          <div className="wb-fig"><b className="wd">{pname(M.P, d.decider)}</b><span>decides</span></div>
          <div className="wb-fig"><b className="wd">{pname(M.P, d.by)}</b><span>asked</span></div>
        </div>
        {brief && <BriefFacts b={brief} d={d} />}
        {note && <div className="wb-note">{note}</div>}
        <Sec head="Answers" aside={d.opts.length + ' options · 1–' + d.opts.length + ' on the plan'}>
          <ol className="wb-opts">
            {d.opts.map((o, i) => (
              <li key={i}>
                <button type="button" className={'wb-opt' + (i === d.rec ? ' rec' : '')} onClick={() => decide(d, i, undefined, keep)} {...optHover(E, d.id, i)}>
                  <i className="no">{i + 1}</i>
                  <b>{o.label}{i === d.rec && <em>{d.recBy ? d.recBy + ' recommends' : 'Recommended'}</em>}</b>
                  <span>{o.consequence}</span>
                </button>
              </li>
            ))}
          </ol>
          <label className="wb-keep"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Answer and keep as an order · {tl || M.P.D[f?.domain ?? '']?.name || d.dom}</label>
          {d.recBy && <p className="wb-help">{d.recBy} recommends “{d.opts[d.rec]?.label}”: an answer kept as an order. It does not answer for you.</p>}
          {hn && <p className="wb-help" aria-live="polite">{hn}</p>}
        </Sec>
        {affects.length > 0 && (
          <Sec head="Also affects" aside={affects.length + ' feature' + (affects.length === 1 ? '' : 's')}>
            <div className="wb-links">{affects.map((id) => <button key={id} type="button" onClick={() => E.flyToFeature(id)}>{M.P.F[id].name}</button>)}</div>
          </Sec>
        )}
      </div>
      <div className="wb-act">
        <button type="button" className="bt go" title="Accept the agent’s recommendation" onClick={() => decide(d, d.rec)} {...optHover(E, d.id, d.rec)}>✓ {d.opts[d.rec]?.label ?? 'Accept'}</button>
        {d.opts.map((o, i) => i === d.rec ? null : <button key={i} type="button" className="bt" onClick={() => decide(d, i)} {...optHover(E, d.id, i)}>{o.label}</button>)}
        <span className="sp" />
        <PlaceActions d={d} />
      </div>
    </>
  );
}


