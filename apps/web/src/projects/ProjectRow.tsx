'use client';
// One project on the /projects page: who it is, what its repo holds (readiness facts), and its latest onboarding job with
// the actions that job allows (running: Open, Cancel; stopped: Resume, Open; done or none: Open blueprint, Re-run). The
// row menu holds Rename, Change folder, Re-run onboarding, Show log and Remove.
import { useEffect, useRef, useState } from 'react';
import type { ProductInfo } from '@bp/core/scan/types';
import { PHASE_LABEL } from '@/buildup/contract';
import type { OnboardJob } from './api';
import { blueprintHref, onboardingHref } from './links';
import s from './projects.module.css';

export type RowJob = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ok'; job: OnboardJob | null };

export interface RowActions {
  rename(name: string): Promise<void>;
  reroot(root: string): Promise<void>;
  onboard(resume: boolean): Promise<void>;
  cancel(job: string): Promise<void>;
  remove(): void;
}

const live = (j: OnboardJob | null): boolean => !!j && (j.status === 'running' || j.status === 'queued');
const phaseWord = (j: OnboardJob): string => (j.adopt_phase ? PHASE_LABEL[j.adopt_phase] : 'starting');

function when(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : iso;
}
function elapsed(from: string | undefined, now: number): string {
  const t = from ? Date.parse(from) : NaN;
  if (!Number.isFinite(t)) return '';
  const sec = Math.max(0, Math.round((now - t) / 1000)), m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m}:${String(sec % 60).padStart(2, '0')}`;
}
const lastLine = (t: string | undefined): string | null => t?.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? null;

function Facts({ p }: { p: ProductInfo }) {
  const r = p.readiness;
  const gap = p.setup.length;
  return (
    <ul className={s.facts} aria-label="What the repo holds">
      <li>{r.map ? <><b>{r.features}</b> feature{r.features === 1 ? '' : 's'} on the map</> : 'No map yet'}</li>
      <li><b>{r.lenses}</b> lens{r.lenses === 1 ? '' : 'es'}, <b>{r.measuredFacets}</b> reading{r.measuredFacets === 1 ? '' : 's'}</li>
      <li>Last scan: <b>{when(r.lastRunAt)}</b></li>
      <li>Scan store: <b>{r.store ? 'present' : 'none'}</b></li>
      <li>Coverage gap: <b>{gap ? `${gap} lens${gap === 1 ? '' : 'es'} cannot measure` : 'none'}</b></li>
      {!r.rootExists && <li><b>The folder is missing</b></li>}
    </ul>
  );
}

function Menu({ items, label }: { items: { label: string; run: () => void; warn?: boolean; off?: boolean }[]; label: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);
  const focusAt = (i: number) => pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[i]?.focus();
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => focusAt(0));
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const els = Array.from(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement), n = els.length;
    let j = -1;
    if (e.key === 'ArrowDown') j = (i + 1) % n;
    else if (e.key === 'ArrowUp') j = (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); return; }
    else if (e.key === 'Tab') { setOpen(false); return; }
    else return;
    e.preventDefault();
    els[j]?.focus();
  };
  return (
    <div className={s.menuWrap}>
      <button ref={btn} type="button" className={s.bt} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}>
        More <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div ref={pop} className={s.menu} role="menu" aria-label={label} onKeyDown={onKey}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" tabIndex={-1} className={`${s.menuIt}${it.warn ? ' ' + s.warnIt : ''}`} aria-disabled={it.off || undefined}
              onClick={() => { if (it.off) return; setOpen(false); btn.current?.focus(); it.run(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

type Edit = { kind: 'name' | 'root'; value: string } | null;

export function ProjectRow({ p, job, now, act, current }: { p: ProductInfo; job: RowJob; now: number; act: RowActions; current: boolean }) {
  const [edit, setEdit] = useState<Edit>(null);
  const [log, setLog] = useState(false);
  const [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const j = job.state === 'ok' ? job.job : null;
  const run = async (what: string, f: () => Promise<void>) => {
    setBusy(what); setErr(null);
    try { await f(); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(null); }
  };
  const save = async () => {
    if (!edit) return;
    const v = edit.value.trim();
    if (!v) { setErr(edit.kind === 'name' ? 'The name cannot be empty' : 'The folder cannot be empty'); return; }
    if (await run('save', () => (edit.kind === 'name' ? act.rename(v) : act.reroot(v)))) setEdit(null);
  };
  const field = (kind: 'name' | 'root', label: string) => edit?.kind === kind && (
    <form className={s.edit} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className={s.field}><span>{label}</span>
        <input autoFocus value={edit.value} spellCheck={false} disabled={!!busy} onChange={(e) => setEdit({ kind, value: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEdit(null); setErr(null); } }} />
      </label>
      <button type="submit" className={`${s.bt} ${s.go}`} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
      <button type="button" className={s.bt} disabled={!!busy} onClick={() => { setEdit(null); setErr(null); }}>Cancel</button>
    </form>
  );
  const running = live(j);
  const stopped = j?.status === 'failed' || j?.status === 'cancelled';
  const open = j ? onboardingHref(p.slug, j.id) : onboardingHref(p.slug);
  const menu = [
    { label: 'Rename', run: () => { setErr(null); setEdit({ kind: 'name', value: p.name }); } },
    { label: 'Change folder', run: () => { setErr(null); setEdit({ kind: 'root', value: p.root }); } },
    { label: 'Re-run onboarding', run: () => void run('onboard', () => act.onboard(false)), off: running },
    { label: log ? 'Hide log' : 'Show log', run: () => setLog((x) => !x), off: !j },
    { label: 'Remove…', run: act.remove, warn: true },
  ];

  /** A repo already mapped by hand (adopt-bp run in a terminal) has no adopt job here but is onboarded all the same. */
  const mapped = p.readiness.mapVersion === 3 && p.readiness.features > 0;
  let status: React.ReactNode;
  if (job.state === 'loading') status = <div className={s.job}><span className={s.jobLine}>Reading the onboarding job…</span></div>;
  else if (j && running) {
    status = (
      <div className={`${s.job} ${s.running}`} role="status">
        <span className={s.spin} aria-hidden="true" />
        <span className={s.jobWord}>
          <b>{j.status === 'queued' ? 'Onboarding · waiting to start' : `Onboarding · ${phaseWord(j)}`}</b>
          <span className={s.jobLine}>{j.started_at ? `Running for ${elapsed(j.started_at, now)}` : 'Queued'}{j.resume ? ' · resumed' : ''}</span>
        </span>
        <span className={s.acts}>
          <a className={`${s.bt} ${s.go}`} href={open}>Open</a>
          <button type="button" className={s.bt} disabled={!!busy} onClick={() => void run('cancel', () => act.cancel(j.id))}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel'}</button>
        </span>
      </div>
    );
  } else if (j && stopped) {
    status = (
      <div className={`${s.job} ${s.failed}`}>
        <span className={s.jobWord}>
          <b>{j.status === 'cancelled' ? 'Cancelled at' : 'Stopped at'} {phaseWord(j)}</b>
          {(j.error ?? lastLine(j.log_tail)) && <span className={s.jobErr}>{j.error ?? lastLine(j.log_tail)}</span>}
          <span className={s.jobLine}>What was made so far is kept. Resume picks up from there.</span>
        </span>
        <span className={s.acts}>
          <button type="button" className={`${s.bt} ${s.go}`} disabled={!!busy} onClick={() => void run('onboard', () => act.onboard(true))}>{busy === 'onboard' ? 'Starting…' : 'Resume'}</button>
          <a className={s.bt} href={open}>Open</a>
        </span>
      </div>
    );
  } else {
    status = (
      <div className={`${s.job}${j ? ' ' + s.done : ''}`}>
        <span className={s.jobWord}>
          <b>{j || mapped ? 'Onboarded' : job.state === 'error' ? 'Onboarding state unknown' : 'Not onboarded in bp yet'}</b>
          {job.state === 'error' ? <span className={s.jobErr}>Could not read the onboarding job: {job.error}</span>
            : <span className={s.jobLine}>{j ? `Finished ${when(j.ended_at)}` : mapped ? 'Mapped outside this page (the adopt-bp skill or an earlier scan).' : 'Onboarding draws the map and takes the first readings.'}</span>}
        </span>
        <span className={s.acts}>
          <a className={`${s.bt}${p.readiness.map ? ' ' + s.go : ''}`} href={blueprintHref(p.slug)}>Open blueprint</a>
          <button type="button" className={`${s.bt}${p.readiness.map ? '' : ' ' + s.go}`} disabled={!!busy} onClick={() => void run('onboard', () => act.onboard(false))}>
            {busy === 'onboard' ? 'Starting…' : j || mapped ? 'Re-run onboarding' : 'Start onboarding'}
          </button>
        </span>
      </div>
    );
  }

  return (
    <li className={`${s.row}${current ? ' ' + s.on : ''}`} aria-label={p.name}>
      <div className={s.top}>
        <div className={s.id}>
          {edit?.kind === 'name' ? field('name', 'Name') : <span className={s.name}>{p.name}</span>}
          <span className={s.slug}>{p.slug}{current ? ' · open now' : ''}</span>
        </div>
        <Menu label={'More for ' + p.name} items={menu} />
      </div>
      {edit?.kind === 'root' ? field('root', 'Folder') : <div className={s.root} title="Repo folder">{p.root}</div>}
      <Facts p={p} />
      {p.readiness.error && <p className={s.hint}>{p.readiness.error}</p>}
      {status}
      {err && <p className={s.err} role="alert">{err}</p>}
      {log && j && (
        <pre className={s.log} tabIndex={0} aria-label={'Onboarding log of ' + p.name}>{j.log_tail?.trim() || 'The log is empty so far.'}</pre>
      )}
    </li>
  );
}
