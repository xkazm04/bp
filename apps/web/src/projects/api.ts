// The /projects page's one door to the server: the product list, the registry writes, the folder check, a product's latest
// onboarding job, starting one and cancelling one, and removing a product with its purge choices. The page calls nothing else.
//
// `?fixture=1` (or `?fixture=empty`) swaps every call for an in-memory fake, so each state of the page can be seen and
// screenshotted without a server that has the onboarding routes, or a real adopt run: four products (one onboarding, one
// stopped, one done, one never onboarded), a folder check that answers by the path typed (`...registered...` is already in
// bp, `...bad...` is not a git work tree), and writes that change the fake list. The real fetches are the default.
//
// The onboarding wire types mirror the shared contract (packages/core/src/scan/onboarding.ts and the `adopt` job fields
// on ScanJob, which the server half adds); they live here until that module lands, and are the same shapes.
import type { ProductInfo } from '@bp/core/scan/types';
import type { ScanJob } from '@bp/core/scan/jobs';
import type { Readiness } from '@bp/core/scan/readiness';
import type { Phase } from '@/buildup/contract';
import { addProject, patchProject, projectsError, refreshProjects, removeProject } from '@/lib/scan/projects';
import { REQUEST_TIMEOUT_MS } from '@/lib/scan/client';
import { causeWords } from '@/lib/scan/refusal';

export interface OnboardCheckItem { id: string; state: 'ok' | 'missing' | 'stale' | 'partial' | string; detail: string | null }
export interface OnboardCheck {
  root: string;
  git: boolean;
  slug: string;
  name: string;
  registered: string | null;
  items: OnboardCheckItem[];
  need: number;
}
/** An adopt job as GET /onboarding answers it: a ScanJob of kind `adopt`, with the phase it last started. */
export type OnboardJob = Omit<ScanJob, 'kind'> & { kind: ScanJob['kind'] | 'adopt'; resume?: boolean; adopt_phase?: Phase | null };
export type PurgeWord = 'store' | 'companion';

/** A refusal or failure, said in words a person reads (the route's own text when it sent one). */
class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

async function call<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: init.method ?? 'GET', cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
    });
  } catch (e) { throw new ApiError(causeWords(e)); }
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok) throw new ApiError(causeWords(Object.assign(new Error(j?.error ?? ''), { status: r.status })), r.status);
  if (j === null) throw new ApiError(causeWords(Object.assign(new Error(''), { status: 0 })));
  return j;
}
const one = (slug: string) => '/api/products/' + encodeURIComponent(slug);

export interface ProjectsApi {
  fixture: boolean;
  list(): Promise<ProductInfo[]>;
  check(root: string): Promise<OnboardCheck>;
  add(p: { slug: string; name: string; root: string }): Promise<void>;
  patch(slug: string, p: { name?: string; root?: string }): Promise<void>;
  onboarding(slug: string): Promise<OnboardJob | null>;
  onboard(slug: string, resume: boolean): Promise<OnboardJob>;
  cancel(slug: string, job: string): Promise<void>;
  remove(slug: string, purge: PurgeWord[]): Promise<void>;
}

const real: ProjectsApi = {
  fixture: false,
  async list() {
    const l = await refreshProjects(true);
    if (!l) throw new ApiError(projectsError() ?? 'Could not read the project list');
    return l;
  },
  check: (root) => call<OnboardCheck>('/api/onboarding/check', { method: 'POST', body: { root } }),
  add: async (p) => { try { await addProject(p); } catch (e) { throw new ApiError(causeWords(e)); } },
  patch: async (slug, p) => { try { await patchProject(slug, p); } catch (e) { throw new ApiError(causeWords(e)); } },
  onboarding: async (slug) => (await call<{ job: OnboardJob | null }>(one(slug) + '/onboarding')).job,
  onboard: async (slug, resume) => (await call<{ job: OnboardJob }>(one(slug) + '/onboard', { method: 'POST', body: resume ? { resume: true } : {} })).job,
  cancel: async (slug, job) => { await call(one(slug) + '/scans/' + encodeURIComponent(job), { method: 'DELETE' }); },
  remove: async (slug, purge) => { try { await removeProject(slug, purge); } catch (e) { throw new ApiError(causeWords(e)); } },
};

// ------------------------------------------------------------------------------------------------ the fixture
const READY: Readiness = { rootExists: true, map: true, mapVersion: 3, events: true, store: true, features: 42, lenses: 4, measuredFacets: 136, proposals: 7, lastRunAt: '2026-11-01T16:20:00.000Z' };
const PARTIAL: Readiness = { ...READY, events: false, store: false, features: 18, measuredFacets: 0, proposals: null, lastRunAt: null };
const NONE: Readiness = { rootExists: true, map: false, mapVersion: null, events: false, store: false, features: 0, lenses: 0, measuredFacets: 0, proposals: null, lastRunAt: null };
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const LOG = (lines: string[]) => lines.join('\n');

function fixtureApi(empty: boolean): ProjectsApi {
  const products: ProductInfo[] = empty ? [] : [
    { slug: 'atlas', name: 'Atlas', root: 'C:/code/atlas', live: false, readiness: PARTIAL, setup: [] },
    { slug: 'harbor', name: 'Harbor', root: 'C:/code/harbor', live: false, readiness: { ...PARTIAL, map: false, features: 0, lenses: 0 }, setup: [] },
    { slug: 'personas', name: 'Personas', root: 'C:/code/personas', live: true, readiness: READY, setup: [{ lens: 'performance', need: 'probes', why: 'the overlay has no ## Probes entries' }] },
    { slug: 'ledgerly', name: 'Ledgerly', root: 'D:/work/ledgerly', live: false, readiness: NONE, setup: [] },
  ];
  const jobs = new Map<string, OnboardJob>(empty ? [] : [
    ['atlas', { id: 'j-atlas-1', kind: 'adopt', status: 'running', queued_at: ago(7), started_at: ago(6.5), adopt_phase: 'judge',
      log_tail: LOG(['[check] 3 of 7 items to produce', '[context-map] 31 areas', '[product-tree] 6 wings, 18 rooms, 42 tiles', '[events] 1,204 commits read', '[judge] batch 3 of 6: billing, invoices, export']) }],
    ['harbor', { id: 'j-harbor-1', kind: 'adopt', status: 'failed', queued_at: ago(48), started_at: ago(47), ended_at: ago(41), adopt_phase: 'product-tree', exit_code: 1,
      error: 'claude exited 1: the usage limit was reached; try again after 18:00', log_tail: LOG(['[check] 7 of 7 items to produce', '[context-map] 12 areas', '[product-tree] reading src/, 40 files', 'error: the usage limit was reached; try again after 18:00']) }],
    ['personas', { id: 'j-personas-1', kind: 'adopt', status: 'done', queued_at: ago(1500), started_at: ago(1499), ended_at: ago(1484), adopt_phase: 'register', exit_code: 0, log_tail: LOG(['[judge] batch 6 of 6', '[register] registered as personas']) }],
  ]);
  let seq = 0;
  const pause = (ms = 250) => new Promise<void>((r) => setTimeout(r, ms));
  const find = (slug: string) => products.find((p) => p.slug === slug);
  return {
    fixture: true,
    async list() { await pause(); return products.map((p) => ({ ...p })); },
    async check(root) {
      await pause(500);
      const r = root.trim().replace(/\\/g, '/').replace(/\/+$/, '');
      if (!r) throw new ApiError('Type the folder path first');
      if (/bad/i.test(r)) throw new ApiError(`${r} is not a git work tree`, 400);
      const folder = r.split('/').pop() ?? r;
      const reg = /registered/i.test(r) ? 'personas' : null;
      const slug = folder.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
      const items: OnboardCheckItem[] = [
        { id: 'git', state: 'ok', detail: 'main, clean' },
        { id: 'config', state: 'ok', detail: '.claude/lens-scan/config.md' },
        { id: 'context-map', state: 'missing', detail: null },
        { id: 'app-structure', state: 'missing', detail: null },
        { id: 'events', state: 'stale', detail: 'older than the last 120 commits' },
        { id: 'store', state: 'missing', detail: null },
        { id: 'gitignore', state: 'partial', detail: '.ai/lens-scan/ not ignored yet' },
      ];
      return { root: r, git: true, slug: find(slug) ? slug + '-2' : slug, name: folder, registered: reg, items, need: items.filter((i) => i.state !== 'ok').length };
    },
    async add(p) {
      await pause();
      if (find(p.slug)) throw new ApiError(`slug "${p.slug}" is already registered`, 409);
      products.push({ ...p, live: false, readiness: NONE, setup: [] });
    },
    async patch(slug, p) { await pause(); const x = find(slug); if (!x) throw new ApiError(`unknown product ${slug}`, 404); Object.assign(x, p); },
    async onboarding(slug) { await pause(100); const j = jobs.get(slug); return j ? { ...j } : null; },
    async onboard(slug, resume) {
      await pause();
      const cur = jobs.get(slug);
      if (cur && (cur.status === 'running' || cur.status === 'queued')) throw new ApiError(`an onboarding job is already running for ${slug}`, 409);
      const j: OnboardJob = { id: `j-${slug}-${++seq + 1}`, kind: 'adopt', status: 'running', queued_at: ago(0), started_at: ago(0), adopt_phase: 'check', ...(resume ? { resume: true } : {}), log_tail: '[check] reading the repo' };
      jobs.set(slug, j);
      return { ...j };
    },
    async cancel(slug, id) {
      await pause();
      const j = jobs.get(slug);
      if (j?.id === id) jobs.set(slug, { ...j, status: 'cancelled', ended_at: ago(0), log_tail: (j.log_tail ?? '') + '\n# cancelled from the blueprint' });
    },
    async remove(slug) { await pause(600); const i = products.findIndex((p) => p.slug === slug); if (i < 0) throw new ApiError(`unknown product ${slug}`, 404); products.splice(i, 1); jobs.delete(slug); },
  };
}

let api: ProjectsApi | null = null;
/** The door for this page load: the fixture when the URL asks for it, else the server. */
export function projectsApi(): ProjectsApi {
  if (api) return api;
  const f = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('fixture');
  api = f ? fixtureApi(f === 'empty') : real;
  return api;
}
