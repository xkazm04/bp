// GET /api/companion/decisions?surface=vr|web&device=<device:pairing id>&limit=<1..200>: the decision log
// ($BP_HOME/companion/decisions.jsonl, decider.server.ts DecisionRecord) for bp's Headsets page, newest first, each row as it
// was recorded (`shown` included: the words the headset displayed before the pinch). At most DECISIONS_MAX rows; the answer
// says how many matched, the limit it applied and how many lines could not be read, so a capped or empty list says so
// (registry audit-logging, audit-querying). bp's own page only (`Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: cors`,
// door.server.ts fromOwnPage): 403 otherwise. 400 for a filter it does not know. Localhost only. `cache-control: no-store`.
// 200 `{ rows: DecisionRecord[], matched: number, total: number, limit: number, unreadable: number, recorded: boolean,
// filter: { surface?, device? } }`. table-link-v2.md section 13.
import { localHost } from '../../../../scan/local-only.ts';
import { fromOwnPage } from '../door.server.ts';
import { readDecisionLog, type DecisionRecord } from '../../../decider.server.ts';

export const DECISIONS_MAX = 200;
export const DECISIONS_DEFAULT = 100;
const DEVICE = /^[A-Za-z0-9_.-]{1,40}:[0-9a-f]{8}$/;

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  if (!fromOwnPage(req)) return Response.json({ error: "only bp's own page may read the decision log" }, { status: 403 });
  const q = new URL(req.url).searchParams;
  const surface = q.get('surface'), device = q.get('device'), limitText = q.get('limit');
  if (surface !== null && surface !== 'vr' && surface !== 'web') return Response.json({ error: 'surface is vr or web' }, { status: 400 });
  if (device !== null && !DEVICE.test(device)) return Response.json({ error: 'device is <name>:<pairing id>' }, { status: 400 });
  if (limitText !== null && !/^\d{1,3}$/.test(limitText)) return Response.json({ error: `limit is 1..${DECISIONS_MAX}` }, { status: 400 });
  const limit = Math.min(DECISIONS_MAX, Math.max(1, limitText === null ? DECISIONS_DEFAULT : Number(limitText)));
  const log = readDecisionLog();
  const hit = (r: DecisionRecord) => (!surface || r.surface === surface) && (!device || r.device === device);
  const matched = log.rows.filter(hit);
  // newest first by the recorded time; ties keep the file's own order (a later line is newer)
  const rows = matched.map((r, i) => [r, i] as const).sort((a, b) => (a[0].at < b[0].at ? 1 : a[0].at > b[0].at ? -1 : b[1] - a[1])).slice(0, limit).map(([r]) => r);
  return Response.json({
    rows, matched: matched.length, total: log.rows.length, limit, unreadable: log.unreadable, recorded: log.exists,
    filter: { ...(surface ? { surface } : {}), ...(device ? { device } : {}) },
  }, { headers: { 'cache-control': 'no-store' } });
}
