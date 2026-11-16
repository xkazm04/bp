'use client';
// Add a project: type the repo folder, Check (POST /api/onboarding/check) shows what onboarding will produce and proposes
// a name and a slug, both editable; Start onboarding registers the project first, then starts its onboarding job and opens
// the build-up. A folder already in bp offers Open and Re-run instead. Every refusal shows inline, next to its cause.
import { useState } from 'react';
import { RESERVED_SLUGS, SLUG_RE } from '@bp/core/scan/readiness';
import type { OnboardCheck, ProjectsApi } from './api';
import { blueprintHref, onboardingHref } from './links';
import s from './projects.module.css';

const ITEM_WORDS: Record<string, string> = {
  git: 'Git repository', config: 'lens-scan settings', 'context-map': 'Context map', seed: 'Seed', 'app-structure': 'Product map',
  'product-tree': 'Product tree', events: 'History', store: 'Scan store', measure: 'Measurements', gitignore: 'Git ignore line',
};
const itemName = (id: string) => ITEM_WORDS[id] ?? id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function AddPanel({ api, onClose, onAdded, go }: { api: ProjectsApi; onClose?: () => void; onAdded: () => void; go: (href: string) => void }) {
  const [root, setRoot] = useState('');
  const [checking, setChecking] = useState(false), [checkErr, setCheckErr] = useState<string | null>(null);
  const [res, setRes] = useState<OnboardCheck | null>(null);
  const [name, setName] = useState(''), [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);

  const check = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!root.trim()) { setCheckErr('Type the folder path first'); return; }
    setChecking(true); setCheckErr(null); setRes(null); setErr(null);
    try { const r = await api.check(root.trim()); setRes(r); setName(r.name); setSlug(r.slug); }
    catch (x) { setCheckErr((x as Error).message); }
    finally { setChecking(false); }
  };
  const slugProblem = !slug ? 'The slug cannot be empty'
    : !SLUG_RE.test(slug) ? 'Slug: lower-case letters, digits and hyphens, starting with a letter or digit'
    : RESERVED_SLUGS.includes(slug) ? `“${slug}” is the built-in sample` : null;
  const start = async () => {
    if (!res) return;
    if (!name.trim()) { setErr('The name cannot be empty'); return; }
    if (slugProblem) { setErr(slugProblem); return; }
    setBusy(true); setErr(null);
    try { await api.add({ slug, name: name.trim(), root: res.root }); }
    catch (x) { setErr((x as Error).message); setBusy(false); return; }
    onAdded();
    try { const job = await api.onboard(slug, false); go(onboardingHref(slug, job.id)); }
    catch (x) { setErr(`${name.trim()} is in the list, but its onboarding did not start: ${(x as Error).message}`); setBusy(false); }
  };
  const rerun = async (reg: string) => {
    setBusy(true); setErr(null);
    try { const job = await api.onboard(reg, false); go(onboardingHref(reg, job.id)); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  };

  return (
    <section className={s.panel} aria-labelledby="add-title">
      <div className={s.panelHead}>
        <h2 id="add-title">Add a project</h2>
        {onClose && <button type="button" className={s.bt} onClick={onClose}>Close</button>}
      </div>
      <p className={s.note}>Point bp at a git repository on this machine. It checks the folder first; nothing runs until you start.</p>
      <form className={s.pathRow} onSubmit={(e) => void check(e)}>
        <label className={s.field}><span>Folder path</span>
          <input value={root} spellCheck={false} placeholder="C:/code/my-app" disabled={checking || busy} aria-invalid={!!checkErr}
            aria-describedby={checkErr ? 'add-check-err' : undefined} onChange={(e) => { setRoot(e.target.value); setCheckErr(null); }} />
        </label>
        <button type="submit" className={`${s.bt} ${s.big}`} disabled={checking || busy}>{checking ? 'Checking…' : 'Check'}</button>
      </form>
      {checkErr && <p className={s.err} id="add-check-err" role="alert">{checkErr}</p>}
      {res && (
        <div className={s.result} aria-live="polite">
          <div className={s.sec}><span>What onboarding finds in {res.root}</span><span>{res.need === 0 ? 'nothing to produce' : `${res.need} to produce`}</span></div>
          <ul className={s.items}>
            <li className={res.git ? s.itemOk : s.itemTodo}>
              <span className={s.mk} aria-hidden="true">{res.git ? '✓' : '–'}</span>
              <span>Git work tree</span><span className={s.state}>{res.git ? 'ok' : 'not a git repository'}</span>
            </li>
            {res.items.map((it) => {
              const ok = it.state === 'ok';
              return (
                <li key={it.id} className={ok ? s.itemOk : s.itemTodo}>
                  <span className={s.mk} aria-hidden="true">{ok ? '✓' : '+'}</span>
                  <span>{itemName(it.id)}</span>
                  <span className={s.state}>{ok ? 'ok' : it.state === 'missing' ? 'to produce' : it.state === 'stale' ? 'to refresh' : 'to finish'}</span>
                  {it.detail && <span className={s.detail}>{it.detail}</span>}
                </li>
              );
            })}
          </ul>
          {res.registered ? (
            <div className={s.already} role="status">
              <span>Already in bp as <b className={s.code}>{res.registered}</b>.</span>
              <a className={s.bt} href={blueprintHref(res.registered)}>Open</a>
              <button type="button" className={s.bt} disabled={busy} onClick={() => void rerun(res.registered as string)}>{busy ? 'Starting…' : 'Re-run onboarding'}</button>
            </div>
          ) : (
            <>
              <div className={s.names}>
                <label className={s.field}><span>Name</span><input value={name} disabled={busy} onChange={(e) => { setName(e.target.value); setErr(null); }} /></label>
                <label className={s.field}><span>Slug</span>
                  <input value={slug} disabled={busy} spellCheck={false} aria-invalid={!!slugProblem} aria-describedby={slugProblem ? 'add-slug-err' : undefined}
                    onChange={(e) => { setSlug(e.target.value); setErr(null); }} />
                </label>
              </div>
              {slugProblem && !err && <p className={s.hint} id="add-slug-err" role="status">{slugProblem}</p>}
              <div className={s.startRow}>
                <button type="button" className={`${s.bt} ${s.go} ${s.big}`} disabled={busy || !!slugProblem} onClick={() => void start()}>{busy ? 'Starting…' : 'Start onboarding'}</button>
                <span className={s.note}>About 15 minutes for a mid-size repo. You can leave; the job keeps running.</span>
              </div>
            </>
          )}
          {err && <p className={s.err} role="alert">{err}</p>}
        </div>
      )}
    </section>
  );
}
