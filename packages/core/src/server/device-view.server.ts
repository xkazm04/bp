// What a paired device reads of a job or a product (S4, 2026-11-10; registry device-pairing, verb-allowlists: "reads are a
// projection"). A request a paired headset made carries its device mark (x-bp-device, set by apps/server's device auth from
// the token on both listeners; deviceOf). To such a request, a job answers without `log_tail` (tool names, assistant text and
// paths of the product being read) and with `error` replaced by fixed plain words by kind, and a product answers without
// its `root` (an absolute path). The page's own requests (no device mark) are unchanged. A loopback program that names a
// device itself only ever gets less.
import type { ScanJob } from '../scan/jobs.ts';
import { deviceOf } from './api/session/baton.server.ts';

if (typeof window !== 'undefined') throw new Error('device-view.server.ts is server-only');

/** The words a device reads in place of a job's own error. */
export const DEVICE_JOB_ERROR = { failed: 'the run failed', stopped: 'the run was stopped', timedOut: 'the run timed out' } as const;

export const fromDevice = (req: Request): boolean => deviceOf(req) !== null;

/** A job as a device reads it: no log tail, the error in fixed words. */
export function deviceJob(j: ScanJob): ScanJob {
  const { log_tail: _tail, error, ...rest } = j;
  void _tail;
  if (error === undefined) return rest;
  const words = j.status === 'cancelled' ? DEVICE_JOB_ERROR.stopped
    : /timed? ?out|timeout/i.test(error) ? DEVICE_JOB_ERROR.timedOut : DEVICE_JOB_ERROR.failed;
  return { ...rest, error: words };
}
/** `job` as `req` may read it: unchanged for the page, projected for a device. */
export const jobFor = <J extends ScanJob | null>(req: Request, j: J): J => (j && fromDevice(req) ? (deviceJob(j) as J) : j);
/** A product row as `req` may read it: without `root` for a device. */
export function productFor<P extends { root?: string }>(req: Request, p: P): P | Omit<P, 'root'> {
  if (!fromDevice(req)) return p;
  const { root: _root, ...rest } = p;
  void _root;
  return rest;
}
