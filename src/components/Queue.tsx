'use client';
// The review queue's shared words and helpers: a proposal's metric move (the latest reading, then latest + expected
// delta), its body sections and one-line summary, urgency words, one decision per proposal, the decline-note drafts,
// the live empty state and the morning watch's entry. The Review flyout itself is rail/wide/review.tsx; the phone
// list (Phone.tsx) and the plan's decision card (Overlays.tsx) read the same helpers.
import { cursorFor, metricHistory, watchFor, type SimDecision } from '@/lib/model';
import type { Proposal } from '@/lib/scan/types';
import { useBp, useEngine, useLive } from './hooks';

const fmtN = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : (Math.round(n * 100) / 100).toLocaleString('en-US'));

/** `metric: before → expected unit`, from the latest reading of that feature, lens and metric; null when the proposal names no metric. */
export function metricMove(p: Proposal, unitOf: (lens: string, key: string) => string | undefined, scan: Parameters<typeof metricHistory>[0]): string | null {
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

/** A live proposal once: at ?scale>1 the feed makes one decision per product line for each proposal (deciding one closes them all). */
export function oncePerProposal(ds: SimDecision[]): SimDecision[] {
  const seen = new Set<string>();
  return ds.filter((d) => !seen.has(d.base) && !!seen.add(d.base));
}

/** What a question's urgency reads as on its card. */
export const URG: Record<SimDecision['urg'], string> = { high: 'Urgent', medium: 'Soon', low: 'When you can' };

/** A decline note survives a refused write: the card remounts when the decision reopens, so the draft lives outside it. */
export const declineDrafts = new Map<string, string>();

/** The morning watch's entry ("While you were away"), in the decisions flyout's header: what is new since this reader's mark. */
export function MorningButton() {
  const E = useEngine(), M = E.M, rows = useLive()?.product.scan?.activity;
  useBp((s) => s.simV);
  const who = useBp((s) => s.who), view = useBp((s) => s.view);
  const v = watchFor(M, rows, who, view, cursorFor(M, who));
  return (
    <button type="button" className="bt morning-btn" title="Morning watch (M)" onClick={() => { E.setDockTab(null); E.toggleMorning(true); }}>
      <span>While you were away</span><span className="am">{v.total} event{v.total === 1 ? '' : 's'} · {v.askedSince} asked</span>
    </button>
  );
}

/** What the live review list says when it is empty: only a connected stream can say the scan has nothing open. */
export function LiveEmpty() {
  const st = useLive()?.product;
  const [head, text] = !st || st.status === 'live' ? ['Nothing to review', 'The scan has no open proposal. New ones appear here as it proposes them.']
    : st.status === 'loading' ? ['Connecting', 'Waiting for the scan store. Proposals appear here once it answers.']
    : st.status === 'missing' ? ['Product not found', 'This product is not registered, so there is nothing to review.']
    : st.status === 'offline' ? ['Scan stream offline', 'Reconnecting. Open proposals may exist; they cannot be shown until the stream is back.']
    : ['Scan unreadable', (st.error ?? 'The scan store could not be read') + '. Open proposals may exist.'];
  return <div className="qempty"><b>{head}</b>{text}</div>;
}
