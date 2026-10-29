// The shared focus this server keeps (session/focus.ts decides every move; this keeps the record). Durable: the record is
// $BP_HOME/session/focus.json (default <repo>/.bp, git-ignored), written whole and atomically on every change and read
// once per process, so a restart keeps every reader's place and whom it follows. On globalThis because Next bundles each
// route apart and they must agree. Every change that a client can see (the shared place moved, a reader came, went, or
// started or stopped following) is published on the companion bus as `event: shared` with the whole view: it is small,
// and a client never has to merge.
import fs from 'node:fs';
import path from 'node:path';
import { EMPTY_RECORD, LIVE_MS, focusStep, viewOf, type FocusMove, type FocusRecord, type FocusStep } from '../../../session/focus.ts';
import { publish } from '../../companion/bus.server.ts';
import { repoRoot } from '../../companion/home.server.ts';
import { warnOnce, writeAtomic } from '../../products.server.ts';

if (typeof window !== 'undefined') throw new Error('focus.server.ts is server-only');

export const focusFile = (): string => path.join(process.env.BP_HOME ? path.resolve(process.env.BP_HOME) : path.join(repoRoot(), '.bp'), 'session', 'focus.json');

const g = globalThis as unknown as { __bpSharedFocus?: { file: string; record: FocusRecord } };

export function readFocus(): FocusRecord {
  const file = focusFile();
  if (g.__bpSharedFocus?.file === file) return g.__bpSharedFocus.record;
  let record = EMPTY_RECORD;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as FocusRecord;
    if (j && typeof j.rev === 'number' && Array.isArray(j.readers)) record = j;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnOnce(file, e); }
  g.__bpSharedFocus = { file, record };
  return record;
}

function writeFocus(record: FocusRecord): void {
  const file = focusFile();
  g.__bpSharedFocus = { file, record };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeAtomic(file, JSON.stringify(record, null, 1) + '\n');
  } catch (e) { warnOnce(file, e); } // the record still holds in memory; the next write tries the disk again
}

/** Whether a client would see a difference: who is there, who is live, and whom each follows. */
const presence = (r: FocusRecord, now: number): string =>
  r.readers.map((x) => `${x.id}|${x.label}|${x.follows ?? ''}|${now - Date.parse(x.seenAt) < LIVE_MS ? 1 : 0}`).sort().join('\n');

/** Apply one move now: keep it, and publish the view when anything a client shows changed. */
export function moveFocus(m: FocusMove, now = Date.now()): FocusStep {
  const before = readFocus(), r = focusStep(before, m, now);
  if (r.error) return r;
  writeFocus(r.record);
  if (r.moved || presence(before, now) !== presence(r.record, now)) publish({ type: 'shared', shared: viewOf(r.record, now) });
  return r;
}
