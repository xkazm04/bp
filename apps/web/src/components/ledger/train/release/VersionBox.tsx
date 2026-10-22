// The Release tab's version box: with no open release, the suggested next version (GET releases/suggest, asked when
// the tab opens and whenever the accepted set changes, never polled) with what it came from and why, editable and
// checked as semver, and Create draft (POST releases), whose answer lists what release-add left out; with a release,
// its version, id and branch. Also the suggestion hook the header strip shares.
import { useEffect, useRef, useState } from 'react';
import type { ReleaseCreated, VersionSuggestion } from '@bp/core/scan/types';
import { createRelease, refusalText, suggestRelease, type ScanCtx } from '@/lib/scan/actions';
import { isVersion } from '@bp/core/scan/release';
import { Btn } from '../ui/Controls';
import { STATUS_WORD, type ReleaseModel } from './releaseState';

// ------------------------------------------------------------------------------------------- the suggestion
// One request per (product, accepted set, releases): the strip and the version box share it rather than each asking.
// A request cache, not UI state; the version box asks afresh each time the tab opens (`fresh`).
let SUG: { key: string; p: Promise<VersionSuggestion> } | null = null;

/** The suggested next version while no release is open (`key` null: none is needed). */
export function useSuggestion(ctx: ScanCtx, key: string | null, fresh = false): { s?: VersionSuggestion; err?: string } {
  const [st, setSt] = useState<{ key: string; s?: VersionSuggestion; err?: string } | null>(null);
  const first = useRef(fresh);
  useEffect(() => {
    if (key === null) return;
    if (first.current || !SUG || SUG.key !== key) { first.current = false; SUG = { key, p: suggestRelease(ctx) }; }
    const mine = SUG;
    let live = true;
    mine.p.then((s) => { if (live) setSt({ key, s }); }, (e: unknown) => {
      if (SUG === mine) SUG = null;
      if (live) setSt({ key, err: refusalText(e) });
    });
    return () => { live = false; };
  }, [ctx, key]);
  return key === null || !st ? {} : st;
}

/** The suggestion's key: the product, the accepted items a draft would take, and the versions already taken. */
export const suggestKey = (m: ReleaseModel): string | null =>
  m.rel ? null : (m.T.slug ?? 'kettle') + '|' + m.items.map((x) => x.p.id).join(',') + '|' + m.T.releases.map((r) => r.version).join(',');

const SKIP: Record<string, string> = {
  'registry-target': 'targets the registry, not the product',
  'in-release': 'already in another release',
  'already-in': 'already in this release',
  'not-found': 'not in the store',
};

export function VersionBox({ m, phone }: { m: ReleaseModel; phone: boolean }) {
  const ctx = m.T.ctx, rel = m.rel;
  const sug = useSuggestion(ctx, suggestKey(m), true);
  const [edited, setEdited] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [made, setMade] = useState<Pick<ReleaseCreated, 'added' | 'skipped'> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const text = rel ? rel.version : edited ?? sug.s?.version ?? '';
  const version = text.trim().replace(/^v/, ''), valid = isVersion(version);
  const create = async () => {
    setErr(null); setCreating(true);
    try { const r = await createRelease(ctx, version); setMade({ added: r.added, skipped: r.skipped }); setEdited(null); } catch (e) { setErr(refusalText(e)); } finally { setCreating(false); }
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
          title={!m.items.length ? 'Accept items in triage first' : !valid ? 'A version is semver: 1.4.0' : 'A draft release of the accepted items'}>{creating ? 'Creating…' : 'Create draft'}</Btn> : null}
      </span>
      <span className="why" id="tr-rel-why">
        {rel ? <>Release <code>{rel.id}</code> on <code>{rel.branch}</code> · {STATUS_WORD[rel.status]}{rel.created_by ? ' · by ' + rel.created_by : ''}.</>
          : sug.s ? <>Suggested <b>v{sug.s.version}</b> from {sug.s.from}: {sug.s.reason}.
            {edited !== null && version !== sug.s.version ? <> <button type="button" className="lnk" onClick={() => setEdited(null)}>Use v{sug.s.version}</button></> : null}</>
          : sug.err ? <>No suggestion: {sug.err}</> : 'Asking for the next version…'}
        {!rel && text && !valid ? <span className="bad"> Not a version: semver without the v, as 1.4.0.</span> : null}
      </span>
      {err ? <span className="why bad" role="alert">Refused · {err}</span> : null}
      {made && made.skipped.length ? (
        <span className="why">Left out: {made.skipped.map((s) => s.id + ' (' + (s.reason ? SKIP[s.reason] ?? s.reason : s.status) + ')').join(', ')}.</span>
      ) : null}
    </div>
  );
}
