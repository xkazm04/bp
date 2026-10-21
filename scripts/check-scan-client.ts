// Pins the scan launcher's half of the seam between the plan's right-click menu (src/components/ScanMenu.tsx)
// and the scan API: what the UI SAYS when a scan does not start, and what it DRAWS when one ends.
//
//   1. refusalText (src/lib/scan/actions.ts), run for every rejection shape the routes, the Kettle sim and
//      `fetch` itself can throw at it. ScanMenu's run() puts the reply straight into a toast
//      (`name + ': ' + refusalText(reason)`), so a shape with no sentence of its own used to put the fetch
//      implementation's words on screen: "Failed to fetch" on Chrome, "Load failed" on Safari, a NetworkError
//      sentence on Firefox, a bare "HTTP 500", the internal route URL of a status-0 answer, or the literal
//      "undefined". The forbidden list is engine/copy.ts's DEV_WORDS, the same registry the canvas's
//      saveFailWords is held to - one rule, now with both implementations pinned.
// Run: node scripts/check-scan-client.ts   (Node's type stripping; actions.ts imports its siblings with
//      extensions so Node loads it as-is, as client.ts and scan-views.ts already did)
// Control: BP_SCAN_CLIENT_SEED=refusal restores the old one-line `REFUSAL[msg] ?? msg`, so assertion 1 is
//      seen red on the exact strings the reader used to be shown.
import { DEV_WORDS } from '../apps/web/src/engine/copy.ts';
import { refusalText as fixed } from '../apps/web/src/lib/scan/actions.ts';

const SEED = process.env.BP_SCAN_CLIENT_SEED ?? '';
const REFUSAL_SEED: Record<string, string> = {
  'unknown-lens': 'that lens is not enabled in the map',
  'no-scan-method': 'that lens has no scan method (no built-in and no manifest scan block)',
  'bad-scope': 'the scope names a place or feature the map does not have',
  'queue-full': '16 scans are already queued',
};
const old = (e: unknown): string => {
  const msg = (e as Error | undefined)?.message || String(e);
  return REFUSAL_SEED[msg] ?? msg;
};
const refusalText = SEED === 'refusal' ? old : fixed;

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string, got?: string) => { if (ok) held++; else failures.push(what + (got === undefined ? '' : ` (got ${JSON.stringify(got)})`)); };

// --------------------------------------------- 1. every rejection shape that reaches a toast gets a sentence
const err = (message: string, extra: Record<string, unknown> = {}): unknown => Object.assign(new Error(message), extra);
const SHAPES: { name: string; e: unknown }[] = [
  { name: 'the fetch never left the browser (Chrome)', e: new TypeError('Failed to fetch') },
  { name: 'the fetch never left the browser (Safari)', e: new TypeError('Load failed') },
  { name: 'the fetch never left the browser (Firefox)', e: new TypeError('NetworkError when attempting to fetch resource.') },
  { name: 'the request timed out', e: err('The operation was aborted due to timeout', { name: 'TimeoutError' }) },
  { name: 'the page aborted the request', e: err('signal is aborted without reason', { name: 'AbortError' }) },
  { name: 'the route refused with a known code', e: err('bad-scope', { status: 400 }) },
  { name: 'the queue is full', e: err('queue-full', { status: 429 }) },
  { name: 'the route refused and said why in words', e: err('that lens has no manifest scan block on disk', { status: 400 }) },
  { name: 'the route refused and sent no body', e: err('HTTP 500', { status: 500 }) },
  { name: 'the answer was a shape the client could not read', e: err('/api/products/kettle/scans answered an unexpected shape: id', { status: 0 }) },
  { name: 'nothing to scan with (no product, no sim)', e: err('Nothing to scan with: no live product and no sample sim', { status: 503 }) },
  { name: 'something threw that is not an Error', e: 'boom' },
  { name: 'a rejection with no reason at all', e: undefined },
];
for (const s of SHAPES) {
  const text = refusalText(s.e);
  const dev = DEV_WORDS.filter((d) => text.includes(d));
  expect(dev.length === 0, `"${s.name}": the toast shows a developer string (${dev.join(', ')})`, text);
  expect(text.length > 12, `"${s.name}": the toast has no sentence to show`, text);
  expect(!/^HTTP \d+$/.test(text), `"${s.name}": the toast is a bare HTTP status`, text);
  expect(!text.includes('/api/'), `"${s.name}": the toast leaks an internal route URL`, text);
}
// the shapes that carry no usable words of their own must name a cause and a remedy
const lost = refusalText(new TypeError('Failed to fetch'));
expect(/never reached/.test(lost) && /server/.test(lost), 'a request that never left the browser does not name the connection as the cause', lost);
const late = refusalText(err('The operation was aborted due to timeout', { name: 'TimeoutError' }));
expect(/in time/.test(late) && /may still/.test(late), 'a timeout does not say the scan may have been queued anyway', late);
const unreadable = refusalText(err('x', { status: 0 }));
expect(/could not read/.test(unreadable), 'an unreadable answer does not say so', unreadable);
expect(refusalText(err('HTTP 500', { status: 500 })).includes('500'), 'a refusal with no words of its own does not name its status');
// the words someone wrote for a reader must survive untouched
for (const [code, words] of Object.entries(REFUSAL_SEED)) expect(refusalText(err(code, { status: 400 })) === words, `the explanation of "${code}" was lost`, refusalText(err(code, { status: 400 })));
expect(refusalText(err('that lens has no manifest scan block on disk', { status: 400 })) === 'that lens has no manifest scan block on disk', 'the route\'s own refusal text was discarded');
expect(refusalText(err('Nothing to scan with: no live product and no sample sim', { status: 503 })).startsWith('Nothing to scan with'), 'actions.ts\' own 503 sentence was discarded');

if (failures.length) { console.log(failures.map((f) => 'FAIL ' + f).join('\n')); console.log(`check-scan-client: ${failures.length} failed, ${held} held`); process.exit(1); }
console.log(`check-scan-client: ${held} expectations held (${SHAPES.length} rejection shapes, ${DEV_WORDS.length} developer strings forbidden)`);
