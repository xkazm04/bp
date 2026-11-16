'use client';
// /projects: every project bp can open, with what its repo holds and its latest onboarding job; add one (check the folder,
// confirm, onboard), rename or re-root it, re-run or resume its onboarding, read its log, cancel it, remove it. All server
// calls go through ./api (the fixture under ?fixture=1). While a job runs the page asks for it every 3 s, and stops asking
// when none runs.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductInfo } from '@bp/core/scan/types';
import { ThemeToggle } from '@/components/ThemeToggle';
import { markStale } from '@/lib/scan/projects';
import { projectsApi, type OnboardJob, type ProjectsApi } from './api';
import { AddPanel } from './AddPanel';
import { ProjectRow, type RowJob } from './ProjectRow';
import { RemoveDialog } from './RemoveDialog';
import { blueprintHref, onboardingHref } from './links';
import s from './projects.module.css';

const POLL_MS = 3000;
type List = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ok'; list: ProductInfo[] };
const live = (j: RowJob | undefined) => j?.state === 'ok' && !!j.job && (j.job.status === 'running' || j.job.status === 'queued');

export function ProjectsPage() {
  const [api, setApi] = useState<ProjectsApi | null>(null);
  const [list, setList] = useState<List>({ state: 'loading' });
  const [jobs, setJobs] = useState<Record<string, RowJob>>({});
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ProductInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [current, setCurrent] = useState<string | null>(null);
  const addBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => { setApi(projectsApi()); setCurrent(new URLSearchParams(location.search).get('product')); }, []);

  const readJobs = useCallback(async (a: ProjectsApi, slugs: string[]) => {
    const got = await Promise.all(slugs.map(async (slug): Promise<[string, RowJob]> => {
      try { return [slug, { state: 'ok', job: await a.onboarding(slug) }]; } catch (e) { return [slug, { state: 'error', error: (e as Error).message }]; }
    }));
    setJobs((prev) => ({ ...prev, ...Object.fromEntries(got) }));
  }, []);
  const load = useCallback(async (a: ProjectsApi) => {
    try {
      const l = await a.list();
      setList({ state: 'ok', list: l });
      if (!l.length) setAdding(true);
      await readJobs(a, l.map((p) => p.slug));
    } catch (e) { setList({ state: 'error', error: (e as Error).message }); }
  }, [readJobs]);
  useEffect(() => { if (api) void load(api); }, [api, load]);

  // poll only while a job runs; the clock ticks for the elapsed time on the same condition
  const running = list.state === 'ok' ? list.list.filter((p) => live(jobs[p.slug])).map((p) => p.slug) : [];
  const runKey = running.join(',');
  useEffect(() => {
    if (!api || !runKey) return;
    const slugs = runKey.split(',');
    const poll = setInterval(() => void readJobs(api, slugs), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [api, runKey, readJobs]);
  // a job that just ended changes what the repo holds: read the list again
  const wasRunning = useRef('');
  useEffect(() => {
    const ended = wasRunning.current.split(',').filter((x) => x && !running.includes(x));
    wasRunning.current = runKey;
    if (api && ended.length) void api.list().then((l) => setList({ state: 'ok', list: l }), () => { /* the rows keep what they had */ });
  }, [api, runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (href: string) => { location.assign(href); };
  const setJob = (slug: string, job: OnboardJob | null) => setJobs((prev) => ({ ...prev, [slug]: { state: 'ok', job } }));

  if (!api) return <main className={s.main} aria-busy="true" />;
  const products = list.state === 'ok' ? list.list : [];
  const empty = list.state === 'ok' && products.length === 0;
  const act = (p: ProductInfo) => ({
    rename: async (name: string) => { await api.patch(p.slug, { name }); await load(api); },
    reroot: async (root: string) => { await api.patch(p.slug, { root }); if (p.slug === current) markStale('root'); await load(api); },
    onboard: async (resume: boolean) => { const j = await api.onboard(p.slug, resume); setJob(p.slug, j); go(onboardingHref(p.slug, j.id)); },
    cancel: async (id: string) => { await api.cancel(p.slug, id); await readJobs(api, [p.slug]); },
    remove: () => setRemoving(p),
  });

  return (
    <main className={s.main}>
      <header className={s.head}>
        <div>
          <div className={s.kicker}><a href={blueprintHref(current)}>‹ Blueprint</a>{api.fixture ? ' · sample data (fixture)' : ''}</div>
          <h1 className={s.h1}>Projects</h1>
          <p className={s.lead}>The repositories bp can draw. Add one and bp onboards it: it maps the code, reads its history and takes the first readings.</p>
        </div>
        <div className={s.headActs}>
          <ThemeToggle />
          <button ref={addBtn} type="button" className={`${s.bt} ${s.go} ${s.big}`} aria-expanded={adding} onClick={() => setAdding((x) => !x)}>Add project</button>
        </div>
      </header>

      {adding && (
        <AddPanel api={api} go={go} onAdded={() => void load(api)}
          onClose={empty ? undefined : () => { setAdding(false); addBtn.current?.focus(); }} />
      )}

      <div className={s.sec}>
        <span>{list.state === 'ok' ? `${products.length} project${products.length === 1 ? '' : 's'}` : 'Projects'}</span>
        {running.length > 0 && <span role="status">{running.length} onboarding now</span>}
      </div>
      {list.state === 'loading' && <p className={s.note} role="status">Reading the project list…</p>}
      {list.state === 'error' && (
        <div role="alert">
          <p className={s.err}>{list.error}</p>
          <p><button type="button" className={s.bt} onClick={() => { setList({ state: 'loading' }); void load(api); }}>Try again</button></p>
        </div>
      )}
      {empty && <p className={s.empty}>No projects yet besides the Kettle sample. Add a repository to begin.</p>}
      <ul className={s.list}>
        <li className={`${s.row} ${s.sample}`} aria-label="Kettle sample">
          <span className={s.id}><span className={s.name}>Kettle</span><span className={s.slug}>built-in sample · always here</span></span>
          <a className={s.bt} href={blueprintHref(null)}>Open blueprint</a>
        </li>
        {products.map((p) => (
          <ProjectRow key={p.slug} p={p} job={jobs[p.slug] ?? { state: 'loading' }} now={now} act={act(p)} current={p.slug === current} />
        ))}
      </ul>

      {removing && (
        <RemoveDialog p={removing} onClose={() => setRemoving(null)}
          onRemove={async (purge) => {
            await api.remove(removing.slug, purge);
            if (removing.slug === current) markStale('removed');
            setRemoving(null);
            setJobs((prev) => { const n = { ...prev }; delete n[removing.slug]; return n; });
            await load(api);
          }} />
      )}
    </main>
  );
}
