// The morning watch resumes where each reader left off (tiger swarm-steer S3). Pins the pure reading in
// src/lib/model/morning.ts: after "caught up" and a reload, exactly the events since the mark come back, grouped by
// place, with older open questions still listed; a mark older than the oldest kept store row says the history is
// incomplete; arrivals while the panel is open leave the window untouched and are only counted; a blocked or
// throwing browser storage costs the mark, never the view. Also reads the sample model end to end.
// Run: node scripts/check-morning-cursor.ts  (scripts/overlays-loader.mjs transpiles src/** on the fly). Exit 1 on any miss.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_OVERLAYS_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const W = await imp('lib/model/morning.ts');
const { buildModel } = await imp('lib/model/sample.ts');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

// a browser storage stand-in (the check runs under Node, which has none by default here)
const store = new Map<string, string>();
const fakeLS = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
Object.defineProperty(globalThis, 'localStorage', { value: fakeLS, configurable: true, writable: true });

const T0 = Date.parse('2026-10-18T06:00:00Z');
let seq = 0;
const ev = (place: string | null, min: number, type = 'commit') => { const ms = T0 + min * 60000; return { k: ++seq, at: new Date(ms).toISOString(), place, type, text: type + ' at ' + place }; };
const q = (id: string, min: number) => ({ id, since: T0 + min * 60000 });

// 1. ack, reload, 12 events over 4 features -> exactly 12 in 4 places; the older open question stays
const before = Array.from({ length: 30 }, (_, i) => ev('f' + (i % 6), i));
const key = W.cursorKey('kettle', 'ines');
const v0 = W.morningView({ events: before, cursor: null, questions: [q('Q-old', 5)] });
expect(W.writeCursor(key, v0.upto) === true, 'writing the mark failed with storage available');
const mark = W.readCursor(key);   // a reload reads it back
expect(!!mark && mark.k === before[before.length - 1].k, `the mark read back is ${JSON.stringify(mark)}, expected the last event seen`);
const twelve = Array.from({ length: 12 }, (_, i) => ev(['pay', 'book', 'auth', 'kiosk'][i % 4], 40 + i, i % 3 ? 'commit' : 'deploy'));
const events = before.concat(twelve), qs = [q('Q-old', 5), q('Q-new', 45)];
const v1 = W.morningView({ events, cursor: mark, questions: qs });
const grouped = v1.places.reduce((s: number, g: Any) => s + g.events.length, 0);
console.log(`after the mark: ${v1.total} events in ${v1.places.length} places (${v1.places.map((g: Any) => g.place + ' ' + g.events.length).join(', ')}); open questions ${v1.open.map((x: Any) => x.id).join(', ')}, ${v1.askedSince} asked since`);
expect(v1.total === 12 && grouped === 12 && v1.places.length === 4, `expected 12 events in 4 places, got ${v1.total} (${grouped} grouped) in ${v1.places.length}`);
expect(v1.places.every((g: Any) => g.events.every((e: Any) => e.place === g.place)) && v1.places.every((g: Any) => g.events[0].k >= g.events[g.events.length - 1].k), 'a place holds another place\'s event, or its events are not newest first');
expect(v1.open.length === 2 && v1.open.some((x: Any) => x.id === 'Q-old') && v1.askedSince === 1, 'the older open question was dropped, or the asked-since count is wrong');
expect(!v1.incomplete && v1.newCount === 0, 'a whole history read as incomplete, or nothing new was counted as new');
expect(/^\d+ code changes · \d+ releases?$/.test(W.kindWords(v1.places[0].events)), `kind words read "${W.kindWords(v1.places[0].events)}"`);

// 2. a mark older than the oldest kept store row -> incomplete, with the time history starts
const rows = Array.from({ length: W.LIVE_ACTIVITY_KEPT }, (_, i) => ({ id: 1001 + i, run_id: 'r1', at: new Date(T0 + i * 60000).toISOString(), feature: 'f' + (i % 5), kind: 'measured', text: 'measured' }));
const live = W.liveWatchEvents(rows, 1);
const old = W.morningView({ events: live.events, cursor: { k: 500, at: '2026-10-17T20:00:00Z' }, questions: [] });
const oldLive = W.morningView({ events: live.events, cursor: { k: 500, at: '2026-10-17T20:00:00Z' }, questions: [], oldest: live.oldest });
console.log(`mark at row 500, store keeps rows ${rows[0].id}..${rows[rows.length - 1].id}: incomplete=${oldLive.incomplete}, history from ${oldLive.retainedFrom}`);
expect(oldLive.incomplete === true && oldLive.retainedFrom === rows[0].at && oldLive.total === rows.length, 'a mark older than the oldest kept row did not read as incomplete');
expect(old.incomplete === false, 'without a cut history the view claimed incompleteness');
const inside = W.morningView({ events: live.events, cursor: { k: 1100, at: rows[99].at }, questions: [], oldest: live.oldest });
expect(!inside.incomplete && inside.total === 100, `a mark inside the kept rows: incomplete=${inside.incomplete}, ${inside.total} events (expected 100)`);
const few = W.liveWatchEvents(rows.slice(0, 150), 1);
expect(few.oldest === null, 'a store holding fewer rows than it keeps was treated as cut');
const none = W.morningView({ events: live.events, cursor: null, questions: [], oldest: live.oldest });
expect(none.incomplete && none.total === rows.length, 'no mark over a cut history: not flagged incomplete');

// 3. 50 arrivals while open: the acknowledged window is unchanged, 50 counted as new
const open = W.morningView({ events, cursor: mark, questions: qs });
const arrivals = Array.from({ length: 50 }, (_, i) => ev('f' + (i % 7), 60 + i));
const later = W.morningView({ events: events.concat(arrivals), cursor: mark, upto: open.upto, questions: qs.concat([q('Q-late', 70)]) });
const same = JSON.stringify(later.places) === JSON.stringify(open.places) && later.total === open.total && JSON.stringify(later.open.map((x: Any) => x.id)) === JSON.stringify(open.open.map((x: Any) => x.id));
console.log(`50 arrivals: window ${same ? 'unchanged' : 'CHANGED'}, newCount ${later.newCount}`);
expect(same && later.newCount === 50, `arrivals moved the window (${same}) or newCount is ${later.newCount}`);
const taken = W.morningView({ events: events.concat(arrivals), cursor: mark, questions: qs });
expect(taken.total === 62 && taken.newCount === 0, `taking the new ones in shows ${taken.total} events, expected 62`);

// 4. blocked storage costs the mark, never the view
Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError: storage blocked'); }, configurable: true });
let threw = false, r: Any = 'unset', w: Any = 'unset';
try { r = W.readCursor(key); w = W.writeCursor(key, mark); } catch { threw = true; }
expect(!threw && r === null && w === false, `blocked storage: threw=${threw}, read ${JSON.stringify(r)}, write ${w}`);
Object.defineProperty(globalThis, 'localStorage', { value: fakeLS, configurable: true, writable: true });
store.set(key, '{not json');
expect(W.readCursor(key) === null, 'a corrupt mark was not ignored');

// 5. the sample end to end: no mark -> the evening before (AWAY_SINCE), as the overnight count was; the hour plays on behind "N new"
store.clear();
const M = buildModel(1, () => 0, null);
const c0 = W.cursorFor(M, 'ines');
const s0 = W.watchFor(M, undefined, 'ines', 'general', c0);
const overnight = M.P.base.activity.filter((a: Any) => a.at >= c0.at).length;
console.log(`sample, no mark: since ${c0.at}, ${s0.total} events in ${s0.places.length} places, ${s0.open.length} open for ines`);
expect(c0.at === W.defaultCursor(false).at && s0.total === overnight && overnight > 0, `sample default window has ${s0.total} events, the overnight activity has ${overnight}`);
M.sim.seek(900);
const s1 = W.watchFor(M, undefined, 'ines', 'general', c0, s0.upto);
expect(JSON.stringify(s1.places) === JSON.stringify(s0.places) && s1.newCount > 0, `the played hour moved the frozen window, or counted ${s1.newCount} new`);
W.writeCursor(W.watchKey(M, 'ines'), W.watchFor(M, undefined, 'ines', 'general', c0).upto);
expect(W.watchFor(M, undefined, 'ines', 'general', W.cursorFor(M, 'ines')).total === 0 && W.cursorFor(M, 'mara').at === c0.at, 'caught up for ines did not empty her view, or leaked into mara\'s');
const M2 = buildModel(1, () => 0, null);   // a reload: the hour starts over, so a mark later than its clock is dropped
expect(W.cursorFor(M2, 'ines').at === c0.at, 'a sample mark later than the restarted clock was kept');
expect(W.defaultCursor(true) === null, 'a live product got the sample\'s away mark as its default');

if (failures.length) { console.error(`check-morning-cursor: ${failures.length} failed (${held} held)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log(`check-morning-cursor: ${held} expectations held`);
