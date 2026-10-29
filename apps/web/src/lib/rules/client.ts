// The owner's standing rules of a live product, browser side (the server half is packages/core/src/server/rules.server.ts,
// the routes /api/products/<slug>/rules). One small store per slug, so the Orders panel, the rail's count and the plan's
// governed-place drawing read the same list: it loads on first use, re-reads every POLL_MS while anything watches it,
// and again after every write. Setting and revoking a rule is a person's act: those carry the human token
// (components/companion/stream.ts humanToken), which only bp's own page can fetch.
import { useEffect, useSyncExternalStore } from 'react';
import type { Backtest, Rule, RuleKind } from '@bp/core/scan/rules';
import type { ScanScope } from '@bp/core/scan/jobs';
import { humanToken } from '@/components/companion/stream';

export const POLL_MS = 10000;
const HUMAN_HEADER = 'x-bp-human'; // contract.ts HUMAN_HEADER, as stream.ts keeps it

export interface RulesView { rules: Rule[]; record: { decided: number; synthetic: number }; loaded: boolean; error?: string }
const EMPTY: RulesView = { rules: [], record: { decided: 0, synthetic: 0 }, loaded: false };

/** A draft the writer sends: preview it, then set it. */
export interface DraftBody { kind: RuleKind; scope: ScanScope; lenses?: string[]; maxEffort?: string; model?: string; minTier?: number; hours?: number; text?: string }

interface Slot { view: RulesView; subs: Set<() => void>; timer: ReturnType<typeof setInterval> | null; inflight: boolean }
const slots = new Map<string, Slot>();
const slotOf = (slug: string): Slot => {
  let s = slots.get(slug);
  if (!s) slots.set(slug, (s = { view: EMPTY, subs: new Set(), timer: null, inflight: false }));
  return s;
};
const api = (slug: string) => '/api/products/' + encodeURIComponent(slug) + '/rules';

/** Re-read the product's rules now (a write calls it; the poll calls it). */
export async function refreshRules(slug: string): Promise<void> {
  const s = slotOf(slug);
  if (s.inflight) return;
  s.inflight = true;
  try {
    const r = await fetch(api(slug), { signal: AbortSignal.timeout(15000) });
    const j = (await r.json().catch(() => null)) as { rules?: Rule[]; record?: RulesView['record']; error?: string } | null;
    s.view = r.ok && j?.rules ? { rules: j.rules, record: j.record ?? EMPTY.record, loaded: true } : { ...s.view, loaded: true, error: j?.error ?? 'rules unavailable (' + r.status + ')' };
  } catch (e) { s.view = { ...s.view, loaded: true, error: (e as Error).message }; }
  finally { s.inflight = false; }
  for (const fn of s.subs) fn();
}

/** The product's rules, kept fresh while a component watches them; null slug = Kettle (its orders are the sim's). */
export function useRules(slug: string | null): RulesView {
  const view = useSyncExternalStore(
    (fn) => { if (!slug) return () => {}; const s = slotOf(slug); s.subs.add(fn); return () => { s.subs.delete(fn); }; },
    () => (slug ? slotOf(slug).view : EMPTY), () => EMPTY,
  );
  useEffect(() => {
    if (!slug) return;
    const s = slotOf(slug);
    if (!s.view.loaded) void refreshRules(slug);
    if (!s.timer) s.timer = setInterval(() => { if (s.subs.size) void refreshRules(slug); }, POLL_MS);
    return () => { if (!s.subs.size && s.timer) { clearInterval(s.timer); s.timer = null; } };
  }, [slug]);
  return view;
}

const failed = async (r: Response): Promise<Error> => {
  const j = (await r.json().catch(() => null)) as { error?: string } | null;
  return Object.assign(new Error(j?.error ?? 'refused (' + r.status + ')'), { status: r.status });
};

/** Replay a draft over the owner's decided findings; nothing is written. */
export async function previewRule(slug: string, d: DraftBody, signal?: AbortSignal): Promise<Backtest> {
  const r = await fetch(api(slug), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...d, preview: true }), signal });
  if (!r.ok) throw await failed(r);
  return ((await r.json()) as { backtest: Backtest }).backtest;
}

/** A human write: retried once with a fresh token (a restarted server mints a new one). */
async function asHuman(url: string, init: RequestInit): Promise<Response> {
  const go = async (fresh: boolean) => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), [HUMAN_HEADER]: await humanToken(fresh) } });
  const r = await go(false);
  return r.status === 403 ? go(true) : r;
}

/** Set the rule: the person's act, written with its author and the evidence. */
export async function setRule(slug: string, d: DraftBody): Promise<Rule> {
  const r = await asHuman(api(slug), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
  if (!r.ok) throw await failed(r);
  const rule = ((await r.json()) as { rule: Rule }).rule;
  await refreshRules(slug);
  return rule;
}

/** Revoke it (one tap): it stays in the record, ended. */
export async function revokeRule(slug: string, id: string): Promise<Rule> {
  const r = await asHuman(api(slug) + '/' + encodeURIComponent(id), { method: 'DELETE' });
  if (!r.ok) throw await failed(r);
  const rule = ((await r.json()) as { rule: Rule }).rule;
  await refreshRules(slug);
  return rule;
}
