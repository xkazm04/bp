// The item's commit: fetched (actions.ts commitDiff: the commits route, or Kettle's sample diff) when the compare panel
// shows the item, once per product and sha for the session (a module cache, so walking items back and forth never
// refetches). Shows the files with add/del bars at once (A/1: the file list is part of the evidence), the message with
// its trailers behind a disclosure, and the patch, whose lines mount only while the patch is open (open from the start
// in the wide panel), in chunks of 100 that the browser skips laying out off screen (content-visibility).
import { memo, useEffect, useMemo, useState } from 'react';
import type { CommitDiff as Diff } from '@bp/core/scan/types';
import { commitDiff, refusalText, type ScanCtx } from '@/lib/scan/actions';
import './CommitDiff.css';

const DEV = process.env.NODE_ENV !== 'production';
const cache = new Map<string, Promise<Diff>>();
let fetches = 0;

function load(ctx: ScanCtx, product: string, sha: string): Promise<Diff> {
  const key = product + ':' + sha;
  let p = cache.get(key);
  if (!p) {
    if (DEV) console.debug(`[commit-diff] fetch #${++fetches} ${key}`);
    p = commitDiff(ctx, sha);
    p.catch(() => cache.delete(key)); // a failed fetch is tried again the next time the item is shown
    cache.set(key, p);
  }
  return p;
}

// ------------------------------------------------------------------------------------------- the patch
type Row = { k: 'file'; text: string } | { k: 'hunk' | 'add' | 'del' | 'ctx'; a: string; b: string; text: string };
const CHUNK = 100;

/** The file a `diff --git a/<old> b/<new>` header names, spaces and all: the NEW path, so a rename says where the file
 *  landed. Both sides are the same path unless the commit renamed it, so the symmetric split decides first and the last
 *  ` b/` is the fallback (git quotes a path only when it holds a quote or a control character). */
function headerPath(line: string): string {
  const rest = line.slice('diff --git '.length).trim(), mid = (rest.length - 1) / 2;
  if (Number.isInteger(mid) && rest.slice(mid, mid + 3) === ' b/' && rest.slice(0, mid) === 'a/' + rest.slice(mid + 3)) return rest.slice(mid + 3);
  const i = rest.lastIndexOf(' b/');
  return (i > 0 ? rest.slice(i + 3) : rest.replace(/^a\//, '')).replace(/^"|"$/g, '');
}

/** The patch as rows: a header per file, its hunks, and each line with its old and new line numbers. */
export function patchRows(patch: string): Row[] {
  const out: Row[] = [];
  let ln = 0, rn = 0;
  for (const l of patch.split('\n')) {
    if (l.startsWith('diff --git')) { out.push({ k: 'file', text: headerPath(l) }); continue; }
    if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|\\ No newline)/.test(l)) continue;
    if (l.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
      ln = m ? +m[1] : 0; rn = m ? +m[2] : 0;
      out.push({ k: 'hunk', a: '', b: '', text: l });
    } else if (l.startsWith('+')) out.push({ k: 'add', a: '', b: String(rn++), text: l });
    else if (l.startsWith('-')) out.push({ k: 'del', a: String(ln++), b: '', text: l });
    else if (l || out.length) out.push({ k: 'ctx', a: String(ln++), b: String(rn++), text: l });
  }
  while (out.length && out[out.length - 1].k === 'ctx' && !out[out.length - 1].text) out.pop();
  return out;
}

const Patch = memo(function Patch({ d }: { d: Diff }) {
  const rows = useMemo(() => patchRows(d.patch), [d.patch]);
  const chunks = useMemo(() => { const c: Row[][] = []; for (let i = 0; i < rows.length; i += CHUNK) c.push(rows.slice(i, i + CHUNK)); return c; }, [rows]);
  return (
    <div className="tr-diff">
      {chunks.map((c, i) => (
        <div key={i} className="tr-dchunk">
          {c.map((r, j) => r.k === 'file'
            ? <div key={j} className="dfh">{r.text}</div>
            : <div key={j} className={'dl ' + r.k}><i>{r.a}</i><i>{r.b}</i><span>{r.text}</span></div>)}
        </div>
      ))}
      {d.truncated ? <div className="dl cut"><i /><i /><span>… truncated at {d.patch.split('\n').length} of {d.lines} lines</span></div> : null}
    </div>
  );
});

/** The message, its trailers (`Key: value` lines closing it) set apart. */
function Message({ text }: { text: string }) {
  const lines = text.replace(/\s+$/, '').split('\n');
  let t = lines.length;
  while (t > 0 && /^[A-Za-z][\w-]*: \S/.test(lines[t - 1])) t--;
  if (t === lines.length || t === 0) return <pre className="tr-msg">{text.trim()}</pre>;
  return <pre className="tr-msg">{lines.slice(0, t).join('\n').trim()}{'\n\n'}<span className="trl">{lines.slice(t).join('\n')}</span></pre>;
}

const Files = memo(function Files({ d }: { d: Diff }) {
  return (
    <div className="tr-files">
      {d.files.map((f) => {
        const t = Math.max(1, f.add + f.del);
        return [
          <span key={f.path + ':p'} className="fp" title={f.path}>{'‎' + f.path}</span>,
          <span key={f.path + ':n'} className="fn">+{f.add} −{f.del}</span>,
          <span key={f.path + ':b'} className="fb" aria-hidden="true"><b style={{ width: (f.add / t) * 100 + '%' }} /><s style={{ width: (f.del / t) * 100 + '%' }} /></span>,
        ];
      })}
    </div>
  );
});

// ------------------------------------------------------------------------------------------- the section
export interface CommitDiffProps {
  ctx: ScanCtx;
  /** The product (its slug, 'kettle' for the sample): the cache key's first half. */
  product: string;
  sha: string;
  /** The patch open at mount (the wide panel shows everything). */
  initiallyOpen?: boolean;
}

type Got = { sha: string; d: Diff } | { sha: string; error: string };

export const CommitDiff = memo(function CommitDiff({ ctx, product, sha, initiallyOpen = false }: CommitDiffProps) {
  const [patch, setPatch] = useState(initiallyOpen);
  const [got, setGot] = useState<Got | null>(null);
  useEffect(() => {
    let live = true;
    load(ctx, product, sha).then((d) => { if (live) setGot({ sha, d }); }, (e: unknown) => { if (live) setGot({ sha, error: refusalText(e) }); });
    return () => { live = false; };
  }, [ctx, product, sha]);
  const cur = got && got.sha === sha ? got : null, d = cur && 'd' in cur ? cur.d : null;
  const add = d ? d.files.reduce((n, f) => n + f.add, 0) : 0, del = d ? d.files.reduce((n, f) => n + f.del, 0) : 0;
  return (
    <section className="tr-sec" data-role="tr-cmp-diff">
      <h4>Commit <code className="c">{sha.slice(0, 7)}</code>{d ? <span className="n">· {d.files.length} {d.files.length === 1 ? 'file' : 'files'} · +{add} −{del}</span> : null}</h4>
      {!cur ? <p className="tr-dim">loading the commit…</p> : 'error' in cur ? <p className="tr-dim" role="alert">The commit did not load: {cur.error}</p> : (
        <>
          <Files d={cur.d} />
          <details className="tr-det"><summary>Commit message</summary><Message text={cur.d.message} /></details>
          <details className="tr-det" open={patch} onToggle={(e) => setPatch(e.currentTarget.open)}>
            <summary>The patch · {cur.d.lines} lines{cur.d.truncated ? ' (truncated)' : ''}</summary>
            {patch ? <Patch d={cur.d} /> : null}
          </details>
        </>
      )}
    </section>
  );
});
