// The onboarding screen's calls to the server: the product's adopt job (GET onboarding), resume (POST onboard) and cancel
// (DELETE scans/<job>). Client-safe: types only from core, every request a plain fetch.
import type { ScanJob } from '@bp/core/scan/jobs';
import type { Phase } from '@/buildup/contract';

/** An adopt job as the onboarding routes answer it: a ScanJob with the build-up phase it last started. */
export type AdoptJob = Pick<ScanJob, 'id' | 'status' | 'error' | 'started_at' | 'ended_at'> & { adopt_phase?: Phase | null; resume?: boolean };

export const productApi = (slug: string) => '/api/products/' + encodeURIComponent(slug);
export const onboardingFeed = (slug: string) => productApi(slug) + '/onboarding';
export const onboardingHref = (slug: string, job?: string | null) =>
  '/projects/' + encodeURIComponent(slug) + '/onboarding' + (job ? '?job=' + encodeURIComponent(job) : '');

export const isRunning = (j: Pick<AdoptJob, 'status'> | null | undefined) => !!j && (j.status === 'queued' || j.status === 'running');

async function errorOf(r: Response): Promise<string> {
  try { return ((await r.json()) as { error?: string }).error ?? `The server answered ${r.status}`; } catch { return `The server answered ${r.status}`; }
}

/** The product's latest adopt job, or null when it never had one. Throws when the server cannot be asked. */
export async function fetchOnboarding(slug: string, signal?: AbortSignal): Promise<AdoptJob | null> {
  const r = await fetch(onboardingFeed(slug), { cache: 'no-store', signal });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(await errorOf(r));
  return ((await r.json()) as { job: AdoptJob | null }).job;
}

/** Enqueue a new adopt job that produces only what is missing (adopt-bp's check). */
export async function resumeOnboarding(slug: string): Promise<AdoptJob> {
  const r = await fetch(productApi(slug) + '/onboard', {
    method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resume: true }),
  });
  if (r.status !== 202 && !r.ok) throw new Error(await errorOf(r));
  return ((await r.json()) as { job: AdoptJob }).job;
}

export async function cancelOnboarding(slug: string, job: string): Promise<void> {
  const r = await fetch(productApi(slug) + '/scans/' + encodeURIComponent(job), { method: 'DELETE', cache: 'no-store' });
  if (!r.ok) throw new Error(await errorOf(r));
}
