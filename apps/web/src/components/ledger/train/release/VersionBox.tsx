// The Release tab's version box: with no open release, the suggested next version (GET releases/suggest, asked when
// the tab opens and whenever the accepted set or the chosen slice changes, never polled) with what it came from and why,
// editable and checked as semver, and Create draft (POST releases) of the chosen items (all while none is chosen), whose
// answer is read back: how many were drafted of those asked for and what release-add left out; with a release, its
// version, id and branch. Also the suggestion hook the header strip shares.
import { useEffect, useRef, useState } from 'react';
import type { ReleaseCreated, VersionSuggestion } from '@bp/core/scan/types';
import { createRelease, refusalText, suggestRelease, type ScanCtx } from '@/lib/scan/actions';
import { isVersion } from '@bp/core/scan/release';
import { Btn } from '../ui/Controls';
import { STATUS_WORD, draftWords, type ReleaseModel } from './releaseState';

// ------------------------------------------------------------------------------------------- the suggestion
// One request per (product, accepted set, releases): the strip and the version box share it rather than each asking.
// A request cache, not UI state; the version box asks afresh each time the tab opens (`fresh`).
let SUG: { key: string; p: Promise<VersionSuggestion> } | null = null;

/** How long the suggestion may stay pending before the box says so (and offers a retry) instead of asking forever. */
export const SUGGEST_DEADLINE_MS = 20_000;

/** The suggested next version while no release is open (`key` null: none is needed). `retry` asks again after a
 *  refusal or a timeout: a request that failed is not cached, and one that never settled is given up on. */
export function useSuggestion(ctx: ScanCtx, key: string | null, fresh = false, ids?: readonly string[]): { s?: VersionSuggestion; err?: string; retry: () => void } {
  const [st, setSt] = useState<{ key: string; s?: VersionSuggestion; err?: string } | null>(null);
  const [round, setRound] = useState(0);
  const first = useRef(fresh);
  // the ids are part of the key: the request reads the latest through a ref rather than re-running on a new array
  const chosen = useRef(ids);
  chosen.current = ids;
  useEffect(() => {
    if (key === null) return;
    if (first.current || !SUG || SUG.key !== key) { first.current = false; SUG = { key, p: suggestRelease(ctx, chosen.current) }; }
    const mine = SUG;
    let live = true;
    const late = setTimeout(() => {
      if (SUG === mine) SUG = null;
      if (live) setSt({ key, err: 'The server has not answered.' });
    }, SUGGEST_DEADLINE_MS);
    mine.p.then((s) => { clearTimeout(late); if (live) setSt({ key, s }); }, (e: unknown) => {
      clearTimeout(late);
      if (SUG === mine) SUG = null;
      if (live) setSt({ key, err: refusalText(e) });
    });
    return () => { live = false; clearTimeout(late); };
  }, [ctx, key, round]);
  const retry = () => { SUG = null; setSt(null); setRound((n) => n + 1); };
  return key === null || !st ? { retry } : { ...st, retry };
}

/** The suggestion's key: the product, the accepted items a draft would take (the chosen ones, if any), and the versions
 *  already taken. */
export const suggestKey = (m: ReleaseModel, chosen?: readonly string[]): string | null =>
  m.rel ? null : (m.T.slug ?? 'kettle') + '|' + m.items.map((x) => x.p.id).join(',') + '|' + (chosen?.join(',') ?? '*') + '|' + m.T.releases.map((r) => r.version).join(',');

const SKIP: Record<string, string> = {
  'registry-target': 'targets the registry, not the product',
  'in-release': 'already in another release',
  'already-in': 'already in this release',
  'not-found': 'not in the store',
};

/** `chosen`: the ids picked in the package (undefined while none is: the draft takes every accepted item); `onMade`
 *  runs once a draft exists, so the package lets go of its selection. */
export function VersionBox({ m, phone, chosen, onMade }: { m: ReleaseModel; phone: boolean; chosen?: readonly string[]; onMade?: () => void }) {
  const ctx = m.T.ctx, rel = m.rel;
  const sug = useSuggestion(ctx, suggestKey(m, chosen), true, chosen);
  const [edited, setEdited] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [made, setMade] = useState<Pick<ReleaseCreated, 'added' | 'skipped'> & { asked: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const text = rel ? rel.version : edited ?? sug.s?.version ?? '';
  const version = text.trim().replace(/^v/, ''), valid = isVersion(version);
  const create = async () => {
    setErr(null); setCreating(true);
    const asked = chosen?.length ?? m.items.length;
    try { const r = await createRelease(ctx, version, chosen?.length ? [...chosen] : undefined); setMade({ added: r.added, skipped: r.skipped, asked }); setEdited(null); onMade?.(); } catch (e) { setErr(refusalText(e)); } finally { setCreating(false); }
  };
  const canCreate = !phone && !rel && valid && m.items.length > 0 && !creating;
  return (
    <div className="tr-rel-ver" data-role="tr-rel-ver">
      <label htmlFor="tr-rel-v">Version</label>
      <span className="vin">
        <span aria-hidden="true">v</span>
        <input id="tr-rel-v" value={text} disabled={!!rel || phone} spellCheck={false} aria-invalid={!rel && !!text && !valid} aria-describedby="tr-rel-why"
          className={!rel && text && !valid ? 'bad' : undefined} onChange={(e) => setEdited(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) { e.preventDefault(); void create(); } }} />
        {!rel && !phone ? <Btn tone="go" onClick={() => void create()} disabled={!canCreate}
          title={!m.items.length ? 'Accept items in triage first' : !valid ? 'A version is semver: 1.4.0' : chosen?.length ? `A draft release of the ${chosen.length} chosen items; the rest stay accepted` : 'A draft release of every accepted item'}>{creating ? 'Creating…' : 'Create draft'}</Btn> : null}
      </span>
      <span className="why" id="tr-rel-why">
        {rel ? <>Release <code>{rel.id}</code> on <code>{rel.branch}</code> · {STATUS_WORD[rel.status]}{rel.created_by ? ' · by ' + rel.created_by : ''}.</>
          : sug.s ? <>Suggested <b>v{sug.s.version}</b> from {sug.s.from}: {sug.s.reason}.
            {edited !== null && version !== sug.s.version ? <> <button type="button" className="lnk" onClick={() => setEdited(null)}>Use v{sug.s.version}</button></> : null}</>
          : sug.err ? <>No suggestion: {sug.err} <button type="button" className="lnk" onClick={sug.retry}>Try again</button></> : 'Asking for the next version…'}
        {!rel && text && !valid ? <span className="bad"> Not a version: semver without the v, as 1.4.0.</span> : null}
      </span>
      {err ? <span className="why bad" role="alert">Refused · {err}</span> : null}
      {made ? (
        <span className="why" data-role="tr-rel-made">{draftWords(made.asked, made.added.length, made.skipped.map((s) => ({ id: s.id, why: s.reason ? SKIP[s.reason] ?? s.reason : s.status })))}</span>
      ) : null}
    </div>
  );
}
