'use client';
// The per-person queue: questions agents asked, most urgent first. The reader (person, else lens)
// decides what rises; items reorder with a layout animation when the lens changes, and one click
// accepts the agent's recommendation (undo sits in the toast). A live product's questions are its
// scan's open proposals: each card says the metric move it promises (the latest reading, then
// latest + expected delta), the standard it rests on, size and risk, and offers Approve and Decline
// (with an optional note, asked inline). Both are written to the product's store. It lives in the
// rail's decisions flyout.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { fmtWait, metricHistory, morningStats, pname, sheetOf, type SimDecision } from '@/lib/model';
import type { Proposal, ScanSnapshot } from '@/lib/scan/types';
import { shallowEqual, useBp, useEngine, useLive, useVariant } from './hooks';

const fmtN = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : (Math.round(n * 100) / 100).toLocaleString('en-US'));

/** `metric: before → expected unit`, from the latest reading of that feature, lens and metric; null when the proposal names no metric. */
function metricMove(p: Proposal, unitOf: (lens: string, key: string) => string | undefined, scan: Parameters<typeof metricHistory>[0]): string | null {
  if (!p.metric) return null;
  const h = metricHistory(scan, p.feature, p.lens, p.metric), last = h[h.length - 1];
  const unit = last?.unit ?? unitOf(p.lens, p.metric), u = unit ? ' ' + unit : '';
  if (p.expected_delta === undefined) return p.metric + ': ' + (last ? fmtN(last.value) + u : 'not measured yet');
  const d = p.expected_delta, move = (d > 0 ? '+' : '') + fmtN(d) + u;
  return last ? `${p.metric}: ${fmtN(last.value)} → ${fmtN(last.value + d)}${u}` : `${p.metric}: ${move} (not measured yet)`;
}

// ------------------------------------------------------------------------------------ proposal text
/** A proposal's body (markdown) as `## Heading` sections; text before the first heading is the Summary. Plain text only: nothing is rendered as markup or HTML. */
export function bodySections(body: string | undefined): { head: string; text: string }[] {
  const out: { head: string; text: string }[] = [];
  let cur: { head: string; lines: string[] } | null = null;
  const flush = () => { if (cur) { const text = cur.lines.join('\n').trim(); if (text) out.push({ head: cur.head, text }); } };
  for (const line of (body ?? '').split(/\r?\n/)) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) { flush(); cur = { head: m[1], lines: [] }; } else { (cur ??= { head: 'Summary', lines: [] }).lines.push(line); }
  }
  flush();
  return out;
}
const sectionOf = (ss: { head: string; text: string }[], re: RegExp) => ss.find((x) => re.test(x.head))?.text;
const MAX_SUM = 180;
/** The one-line summary: the first sentence of the Summary (else of the body), when it says more than the title. */
export function proposalSummary(p: Proposal): string | null {
  const ss = bodySections(p.body), t = sectionOf(ss, /^summary$/i) ?? ss[0]?.text;
  if (!t) return null;
  const para = t.split('\n')[0].trim(), one = (/^.*?[.!?](?=\s|$)/.exec(para)?.[0] ?? para).replace(/\s+/g, ' ');
  const line = one.length > MAX_SUM ? one.slice(0, MAX_SUM - 1).trimEnd() + '…' : one;
  return !line || line.toLowerCase() === p.title.trim().toLowerCase() ? null : line;
}

/** Details a reviewer needs before approving: Summary, Impact and Evaluation from the body, and the measurement behind the before value. Folded; the button says so. */
function ProposalDetails({ p, scan }: { p: Proposal; scan: ScanSnapshot | undefined }) {
  const [open, setOpen] = useState(false), id = useId();
  const ss = bodySections(p.body);
  const parts = [['Summary', sectionOf(ss, /^summary$/i) ?? (ss.length && !/^(description|flow|(expected )?impact|evaluation)$/i.test(ss[0].head) ? ss[0].text : undefined)], ['Impact', sectionOf(ss, /impact/i)], ['Evaluation', sectionOf(ss, /^evaluation/i)]] as const;
  const h = p.metric ? metricHistory(scan, p.feature, p.lens, p.metric) : [], last = h[h.length - 1];
  const ev = last ? [last.evidence, last.method && 'measured by ' + last.method, last.measured_at && 'on ' + last.measured_at.slice(0, 10), h.length > 1 ? h.length + ' readings' : ''].filter(Boolean) : [];
  const meta = [p.parent_id && 'follows ' + p.parent_id, p.after_value !== undefined && 'after the change: ' + fmtN(p.after_value)].filter(Boolean);
  return (
    <div className="pd" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="pd-t" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><i aria-hidden="true">{open ? '▾' : '▸'}</i> Details</button>
      {open && (
        <div id={id} className="pd-b" role="region" aria-label="Proposal details">
          {parts.map(([head, text]) => <section key={head}><h5>{head}</h5>{text ? text.split('\n').filter(Boolean).map((t, i) => <p key={i}>{t}</p>) : <p className="none">Not stated.</p>}</section>)}
          <section><h5>Evidence for the before value</h5>{ev.length ? <p>{ev.join(' · ')}</p> : <p className="none">{last ? 'The reading carries no evidence.' : 'No reading yet.'}</p>}</section>
          {meta.length ? <p className="meta">{meta.join(' · ')}</p> : null}
        </div>
      )}
    </div>
  );
}

/** A live proposal once: at ?scale>1 the feed makes one decision per product line for each proposal (deciding one closes them all). */
export function oncePerProposal(ds: SimDecision[]): SimDecision[] {
  const seen = new Set<string>();
  return ds.filter((d) => !seen.has(d.base) && !!seen.add(d.base));
}

/** What a question's urgency reads as on its card. */
const URG: Record<SimDecision['urg'], string> = { high: 'Urgent', medium: 'Soon', low: 'When you can' };

/** Where focus goes when a card is answered and leaves: the next card, else the previous, else the list's heading. Resolved before the answer
 * (the leaving card stays in the DOM through its exit); `go` runs after it, once the DOM has the optimistic state. */
function focusHeir(from: Element | null): () => void {
  const li = from?.closest('li.qi'), ul = li?.parentElement;
  const heir = (e: Element | null | undefined) => (e?.matches('li.qi') ? (e as HTMLElement) : null);
  const t = heir(li?.nextElementSibling) ?? heir(li?.previousElementSibling) ?? (ul?.previousElementSibling as HTMLElement | null) ?? null;
  return () => requestAnimationFrame(() => {
    if (!t?.isConnected) return;
    if (!t.matches('li.qi')) t.tabIndex = -1;
    t.focus({ preventScroll: false });
  });
}

/** The shell both queue cards share: entrance and exit, emphasis by the reader, open on click or Enter/Space,
 * and the hover highlight on the plan. `cls` adds the card's own class. */
function CardShell({ d, on, emph, cls, children, liRef }: { d: SimDecision; on: boolean; emph: boolean; cls?: string; children: ReactNode; liRef?: React.Ref<HTMLLIElement> }) {
  const E = useEngine();
  return (
    <motion.li ref={liRef}
      layout="position" initial={{ opacity: 0, x: 18 }} animate={{ opacity: emph ? 1 : 0.55, x: 0 }} exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className={'qi' + (cls ? ' ' + cls : '') + ' u-' + d.urg + (on ? ' on' : '')} tabIndex={0} aria-current={on}
      // the key that opens the card ends here. The engine's keys listen on document, the same node React's root
      // listens on, so only stopImmediatePropagation keeps them from reading this Enter as "accept the open question"
      // and this Space as "pause the swarm" (React's listener is registered first, at hydration)
      onClick={() => E.openDecision(d.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); E.openDecision(d.id); } }}
      onPointerEnter={() => !E.S.dec && E.setHlDec(d.id)} onPointerLeave={() => E.setHlDec(null)}
    >
      {children}
    </motion.li>
  );
}

/** A decline note survives a refused write: the card remounts when the decision reopens, so the draft lives outside it. */
const declineDrafts = new Map<string, string>();

function LiveItem({ d }: { d: SimDecision }) {
  const E = useEngine(), M = E.M, sim = M.sim, live = useLive();
  const s = useBp((s) => ({ dec: s.dec, who: s.who, view: s.view }), shallowEqual);
  const [declining, setDeclining] = useState(() => declineDrafts.has(d.base)), [note, setNote] = useState(() => declineDrafts.get(d.base) ?? '');
  const cancelDecline = () => { declineDrafts.delete(d.base); setNote(''); setDeclining(false); requestAnimationFrame(() => (liRef.current?.querySelector('button.answer:not(.go)') as HTMLElement | null)?.focus()); };
  const liRef = useRef<HTMLLIElement>(null);
  const f = M.P.F[d.f], on = s.dec === d.id, scan = live?.product.scan;
  const p = scan?.proposals.find((x) => x.id === d.base);
  const field = (lens: string, key: string) => M.P.LENS[lens]?.F[key];
  const mv = p ? metricMove(p, (l, k) => field(l, k)?.unit, scan) : null;
  const label = p?.metric ? field(p.lens, p.metric)?.label : undefined, sum = p ? proposalSummary(p) : null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <CardShell d={d} on={on} emph={sim.emph(d, s.who, s.view)} cls="lq" liRef={liRef}>
      <div className="k"><span>{URG[d.urg]} · <span className="lz">{sheetOf(M.P, d.lens).no}</span></span><span>{p?.kind && p.kind !== 'fix' ? p.kind + ' · ' : ''}{d.base}{M.P.scale > 1 ? ' · ' + M.P.buildings[d.b].short : ''}{d.isNew ? ' · NEW' : ''}</span></div>
      <h4>{d.q}</h4>
      {sum && <div className="sm">{sum}</div>}
      {mv && <div className="mv" title={label ? label + (p?.expected_delta !== undefined ? ', expected after the change' : '') : undefined}>{mv}</div>}
      <div className="tags">
        {p && <span className="std" title="The standard this item rests on">{p.standard === 'none' ? 'no standard' : p.standard}</span>}
        {p?.size && <span title="Size">{p.size}</span>}
        {p?.risk !== undefined && <span title="Risk, 1 to 10" className={p.risk >= 7 ? 'hi' : ''}>risk {p.risk}</span>}
      </div>
      <div className="mt">{f.name} · {M.P.D[f.domain]?.name ?? f.domain} · waiting <b>{fmtWait(sim.waitMin(d))}</b></div>
      {p && <ProposalDetails p={p} scan={scan} />}
      {declining ? (
        <form className="dn" onClick={stop} onSubmit={(e) => { e.preventDefault(); declineDrafts.set(d.base, note.trim()); const go = focusHeir(e.currentTarget); E.decide(d.id, 1, note.trim() || undefined); go(); }}>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not? (optional)" aria-label="Decline note (optional)" maxLength={500} autoFocus
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); cancelDecline(); } }} />
          <button type="submit" className="bt">Decline</button>
          <button type="button" className="bt" onClick={cancelDecline}>Cancel</button>
        </form>
      ) : (
        <div className="row" style={{ marginTop: 7 }}>
          <button type="button" className="bt go answer" title="Approve: the scan executes it in its next execute phase" onClick={(e) => { stop(e); const go = focusHeir(e.currentTarget); E.decide(d.id, 0); go(); }}>✓ Approve</button>
          <button type="button" className="bt answer" title="Decline, with an optional note" onClick={(e) => { stop(e); setDeclining(true); }}>Decline…</button>
        </div>
      )}
    </CardShell>
  );
}

function Item({ d }: { d: SimDecision }) {
  const E = useEngine(), V = useVariant(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ dec: s.dec, who: s.who, view: s.view }), shallowEqual);
  const f = M.P.F[d.f], on = s.dec === d.id;
  const emph = sim.emph(d, s.who, s.view), bn = sim.blocksNow(d);
  const note = V.ui?.queueNote?.(d, s.view, M) ?? null;
  return (
    <CardShell d={d} on={on} emph={emph}>
      <div className="k"><span>{URG[d.urg]} · <span className="lz">{sheetOf(M.P, d.lens).no}</span></span><span>{d.base}{M.P.scale > 1 ? ' · ' + M.P.buildings[d.b].short : ''}{d.isNew ? ' · NEW' : ''}</span></div>
      <h4>{d.q}</h4>
      <div className="mt">{f.name} · {M.P.D[f.domain].name}<br />{pname(M.P, d.decider)} decides · waiting <b>{fmtWait(sim.waitMin(d))}</b> · holds <b>{bn}</b> agent{bn === 1 ? '' : 's'}</div>
      {note && <div className="note">{note}</div>}
      <div style={{ marginTop: 7 }}>
        <button type="button" className="bt go answer" title="Accept the agent’s recommendation (Enter)" onClick={(e) => { e.stopPropagation(); const go = focusHeir(e.currentTarget); E.decide(d.id, d.rec); go(); }}>✓ {d.opts[d.rec].label}</button>
      </div>
    </CardShell>
  );
}

/** The morning watch's entry ("While you were away"), in the decisions flyout's header (Kettle only). */
export function MorningButton() {
  const E = useEngine(), M = E.M;
  useBp((s) => s.simV);
  const ms = morningStats(M);
  return (
    <button type="button" className="bt morning-btn" title="Morning watch (M)" onClick={() => { E.setDockTab(null); E.toggleMorning(true); }}>
      <span>While you were away</span><span className="am">{ms.changes} changes · {ms.asked} asked</span>
    </button>
  );
}

/** What the live review list says when it is empty: only a connected stream can say the scan has nothing open. */
function LiveEmpty() {
  const st = useLive()?.product;
  const [head, text] = !st || st.status === 'live' ? ['Nothing to review', 'The scan has no open proposal. New ones appear here as it proposes them.']
    : st.status === 'loading' ? ['Connecting', 'Waiting for the scan store. Proposals appear here once it answers.']
    : st.status === 'missing' ? ['Product not found', 'This product is not registered, so there is nothing to review.']
    : st.status === 'offline' ? ['Scan stream offline', 'Reconnecting. Open proposals may exist; they cannot be shown until the stream is back.']
    : ['Scan unreadable', (st.error ?? 'The scan store could not be read') + '. Open proposals may exist.'];
  return <div className="qempty"><b>{head}</b>{text}</div>;
}

/** The decisions flyout: the reader's queue, most urgent first. */
export function AsksTab() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ who: s.who, view: s.view, simV: s.simV, askAll: s.askAll }), shallowEqual);
  const proposals = useLive()?.product.scan?.proposals;
  // a draft lives until its proposal is decided: a refused write keeps it, a stream that shows the row decided drops it
  useEffect(() => {
    if (!proposals || !declineDrafts.size) return;
    const open = new Set(proposals.filter((p) => p.status === 'proposed').map((p) => p.id));
    for (const id of [...declineDrafts.keys()]) if (!open.has(id)) declineDrafts.delete(id);
  }, [proposals]);
  if (!sim.has) return <div className="qempty"><b>No swarm data</b>The swarm file did not load.</div>;
  const q = sim.queueFor(s.who, s.view);
  const first = s.who ? pname(M.P, s.who).split(' ')[0] : '';
  const more = (total: number) => total > (s.who ? 4 : 8) && (
    <button type="button" className="qmore" onClick={() => E.patch({ askAll: !s.askAll })}>{s.askAll ? 'Show fewer' : 'Show all ' + total}</button>
  );
  const Card = sim.live ? LiveItem : Item;
  const list = (ds: SimDecision[]) => (
    <ul className="qlist"><AnimatePresence initial={false} mode="popLayout">{ds.map((d) => <Card key={d.id} d={d} />)}</AnimatePresence></ul>
  );
  if (sim.live) {
    // a scan's proposals wait for whoever reviews (no person, no overnight digest); the reader's lens still sorts them
    const all = oncePerProposal(s.view === 'general' ? q.all : q.rest);
    return (
      <>
        <h3 className="dsec-h"><span>{s.view === 'general' ? 'Proposals to review' : 'Sheet ' + sheetOf(M.P, s.view).no + ' first'}</span><span>{oncePerProposal(q.all).length}</span></h3>
        {all.length ? list(!s.askAll && all.length > 8 ? all.slice(0, 8) : all) : <LiveEmpty />}
        {more(all.length)}
      </>
    );
  }
  return (
    <>
      {s.who ? (
        <>
          <h3 className="dsec-h"><span>Waiting for {first}</span><span>{q.mine.length}</span></h3>
          {q.mine.length ? list(q.mine) : <div className="qempty"><b>Nothing waits for you</b>Every agent that needs {first} has what it needs. The swarm is working.</div>}
          <h3 className="dsec-h"><span>Everyone else</span><span>{q.rest.length}</span></h3>
          {list(s.askAll ? q.rest : q.rest.slice(0, 4))}
          {more(q.rest.length)}
        </>
      ) : (
        <>
          <h3 className="dsec-h"><span>{s.view === 'general' ? 'Waiting for a person' : 'Sheet ' + sheetOf(M.P, s.view).no + ' first'}</span><span>{q.all.length}</span></h3>
          {list((() => { const all = s.view === 'general' ? q.all : q.rest; return !s.askAll && all.length > 8 ? all.slice(0, 8) : all; })())}
          {more(q.all.length)}
        </>
      )}
    </>
  );
}

