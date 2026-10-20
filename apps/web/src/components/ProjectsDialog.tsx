'use client';
// Manage projects: add a product repo to bp.products.local.json, rename it, change its root, or remove it
// from the list (the repo itself is never touched). Each row shows the readiness checklist the server
// computed. Every error the API answers is shown inline next to what caused it.
import { useEffect, useRef, useState } from 'react';
import { LEVEL_LABEL, RESERVED_SLUGS, SLUG_RE, readinessLevel, type Readiness } from '@bp/core/scan/readiness';
import { addProject, markStale, patchProject, projectHref, refreshProjects, removeProject, useProjects } from '@/lib/scan/projects';
import type { ProductInfo } from '@bp/core/scan/types';
import { LevelIcon } from './ProjectSwitcher';

const MAP_HINT = 'Run /adopt-bp in that repo to create .ai/lens-scan/app-structure.json';

function fmtDate(iso: string | null): string {
  if (!iso) return '–';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : iso;
}

function Checklist({ r }: { r: Readiness }) {
  const rows: [string, boolean, string?][] = [
    ['Repo root found', r.rootExists],
    ['Map', r.map, r.map ? (r.mapVersion ? 'v' + r.mapVersion : 'version unknown') : undefined],
    ['Events log', r.events],
    ['Scan store', r.store],
    ['Features', r.features > 0, String(r.features)],
    ['Lenses', r.lenses > 0, String(r.lenses)],
    ['Measured facets', r.measuredFacets > 0, String(r.measuredFacets)],
    ['Open proposals', (r.proposals ?? 0) > 0, r.proposals == null ? '–' : String(r.proposals)],
    ['Last run', !!r.lastRunAt, fmtDate(r.lastRunAt)],
  ];
  return (
    <ul className="pj-check" aria-label="Readiness">
      {rows.map(([k, ok, v]) => (
        <li key={k} className={ok ? 'ok' : ''}>
          <span className="mk" aria-hidden="true">{ok ? '✓' : '–'}</span>
          <span className="k">{k}<span className="sr">{ok ? ': yes' : ': no'}</span></span>
          {v !== undefined && <span className="v">{v}</span>}
        </li>
      ))}
    </ul>
  );
}

type Edit = { kind: 'name' | 'root'; value: string } | { kind: 'remove' } | null;

function Row({ p, current }: { p: ProductInfo; current: string | null }) {
  const [edit, setEdit] = useState<Edit>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const level = readinessLevel(p.readiness);
  const run = async (f: () => Promise<void>, stale?: 'removed' | 'root') => {
    setBusy(true); setErr(null);
    // the open product's page keeps what it loaded: say so, and let the person reload when ready
    try { await f(); if (stale && p.slug === current) markStale(stale); setEdit(null); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const save = () => {
    if (!edit || edit.kind === 'remove') return;
    const v = edit.value.trim();
    if (!v) { setErr(edit.kind === 'name' ? 'The name cannot be empty' : 'The root cannot be empty'); return; }
    void run(() => patchProject(p.slug, edit.kind === 'name' ? { name: v } : { root: v }), edit.kind === 'root' ? 'root' : undefined);
  };
  const field = (kind: 'name' | 'root', label: string) => edit && edit.kind === kind && (
    <form className="pj-edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label><span>{label}</span>
        <input autoFocus value={edit.value} spellCheck={false} disabled={busy} onChange={(e) => setEdit({ kind, value: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEdit(null); setErr(null); } }} />
      </label>
      <button type="submit" className="pj-bt go" disabled={busy}>Save</button>
      <button type="button" className="pj-bt" disabled={busy} onClick={() => { setEdit(null); setErr(null); }}>Cancel</button>
    </form>
  );
  return (
    <li className="pj-row">
      <div className="pj-top">
        <div className="pj-id">
          {edit?.kind === 'name' ? field('name', 'Name') : <b>{p.name}</b>}
          <code>{p.slug}{p.slug === current ? ' · open now' : ''}</code>
        </div>
        <span className="pj-lv" title={LEVEL_LABEL[level]}><LevelIcon level={level} />{LEVEL_LABEL[level]}</span>
      </div>
      {edit?.kind === 'root' ? field('root', 'Root path') : <div className="pj-root" title="Repo root">{p.readiness.rootExists ? '' : 'not found: '}{p.root}</div>}
      <Checklist r={p.readiness} />
      {!p.readiness.map && <p className="pj-hint">{MAP_HINT}</p>}
      {p.readiness.error && <p className="pj-hint">{p.readiness.error}</p>}
      {err && <p className="pj-err" role="alert">{err}</p>}
      {edit?.kind === 'remove' ? (
        <div className="pj-confirm" role="group" aria-label={'Remove ' + p.name}>
          <span>Remove <b>{p.name}</b> from the list? The repo and its scan files stay on disk.</span>
          <button type="button" className="pj-bt warn" autoFocus disabled={busy} onClick={() => void run(() => removeProject(p.slug), 'removed')}>Remove</button>
          <button type="button" className="pj-bt" disabled={busy} onClick={() => setEdit(null)}>Keep</button>
        </div>
      ) : !edit && (
        <div className="pj-acts">
          {p.slug !== current && <a className="pj-bt" href={projectHref(p.slug)}>Open</a>}
          <button type="button" className="pj-bt" onClick={() => { setErr(null); setEdit({ kind: 'name', value: p.name }); }}>Rename</button>
          <button type="button" className="pj-bt" onClick={() => { setErr(null); setEdit({ kind: 'root', value: p.root }); }}>Change root</button>
          <button type="button" className="pj-bt" onClick={() => { setErr(null); setEdit({ kind: 'remove' }); }}>Remove…</button>
        </div>
      )}
    </li>
  );
}
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

function AddForm() {
  const [slug, setSlug] = useState(''), [slugTouched, setSlugTouched] = useState(false), [slugSeen, setSlugSeen] = useState(false);
  const [name, setName] = useState(''), [root, setRoot] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const s = slugTouched ? slug : slugify(name);
  const local = !s ? null : !SLUG_RE.test(s) ? 'Slug: lower-case letters, digits and hyphens, starting with a letter or digit' : RESERVED_SLUGS.includes(s) ? '“' + s + '” is the built-in sample' : null;
  const dirty = !!(name || slug || root);
  const reset = () => { setSlug(''); setSlugTouched(false); setSlugSeen(false); setName(''); setRoot(''); setErr(null); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!s || !name.trim() || !root.trim()) { setErr('Slug, name and root path are all needed'); return; }
    if (local) { setSlugSeen(true); setErr(local); return; }
    setBusy(true); setErr(null);
    try { await addProject({ slug: s, name: name.trim(), root: root.trim() }); reset(); }
    catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  };
  // Esc in a form with typed text clears the form first (the dialog stays); a second Esc closes the dialog
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Escape' && dirty && !busy) { e.preventDefault(); e.stopPropagation(); reset(); } };
  return (
    <form className="pj-add" onSubmit={submit} onKeyDown={onKey} aria-label="Add a project">
      <h3 className="pj-sec">Add a project</h3>
      <label><span>Name</span><input value={name} disabled={busy} placeholder="Personas" onChange={(e) => setName(e.target.value)} /></label>
      <label><span>Slug</span><input value={s} disabled={busy} spellCheck={false} placeholder="personas" aria-invalid={slugSeen && !!local} aria-describedby={slugSeen && local ? 'pj-slug-err' : undefined}
        onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); setErr(null); }} onBlur={() => setSlugSeen(true)} /></label>
      <label className="wide"><span>Root path</span><input value={root} disabled={busy} spellCheck={false} placeholder="C:/code/personas" onChange={(e) => setRoot(e.target.value)} /></label>
      <p className="pj-note">The repo folder (absolute, or relative to where bp runs). bp reads its <code>.ai/lens-scan/</code>.</p>
      {slugSeen && local && !err && <p className="pj-err" id="pj-slug-err" role="status">{local}</p>}
      {err && <p className="pj-err" role="alert">{err}</p>}
      <div className="pj-acts"><button type="submit" className="pj-bt go" disabled={busy}>{busy ? 'Adding…' : 'Add project'}</button></div>
    </form>
  );
}

export function ProjectsDialog({ current, onClose }: { current: string | null; onClose: () => void }) {
  const { list, error, stale } = useProjects();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { void refreshProjects(); box.current?.querySelector<HTMLElement>('.pj-x')?.focus(); }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    // keep Tab inside the dialog
    const els = Array.from(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])') ?? []);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="pj-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="pj-dlg" role="dialog" aria-modal="true" aria-labelledby="pj-title" data-keys="own" onKeyDown={onKey}>
        <div className="pj-head">
          <h2 id="pj-title">Projects</h2>
          <button type="button" className="pj-bt pj-x" onClick={onClose}>Close · Esc</button>
        </div>
        <p className="pj-note">The products bp can open, from <code>bp.products.local.json</code>. Removing one only takes it off this list.</p>
        {stale && (
          <p className="pj-hint pj-stale" role="status">
            {stale === 'removed' ? 'The open project was removed from the list; this page still shows it.' : 'The open project’s root changed; this page still reads the old one.'}
            <button type="button" className="pj-bt go" onClick={() => location.reload()}>Reload</button>
          </p>
        )}
        {error && <p className="pj-err" role="alert">{error}</p>}
        <ul className="pj-list">
          <li className="pj-row sample">
            <div className="pj-top">
              <div className="pj-id"><b>Kettle (sample)</b><code>built in{current ? '' : ' · open now'}</code></div>
              <span className="pj-lv"><LevelIcon level="sample" />Sample</span>
            </div>
            {current && <div className="pj-acts"><a className="pj-bt" href={projectHref(null)}>Open</a></div>}
          </li>
          {(list ?? []).map((p) => <Row key={p.slug} p={p} current={current} />)}
        </ul>
        <AddForm />
      </div>
    </div>
  );
}
