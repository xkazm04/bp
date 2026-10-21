// Pins the sentences the canvas engine says to a reader (src/engine/copy.ts) and the two Engine.ts doors that
// must agree about them. Three source-scanning checks read Engine.ts as text; none of them executes a line of
// it, and before copy.ts existed its user-facing strings were built inline where no gate could reach them - so
// `'Not saved: ' + e.message` shipped a developer's words ("Failed to fetch") onto a tile for a year.
//
//   1. saveFailWords, run for every rejection shape scan/client.ts can throw (no status = the fetch never
//      arrived, 0 = a shape we could not read, 409 = settled elsewhere, any other = the product's own words),
//      asserting no reply carries a developer string and every retryable one says the question is open again.
//   2. Engine.decide's rollback takes its words from saveFailWords and no longer interpolates e.message.
// Run: node scripts/check-engine-copy.ts   (Node's type stripping; copy.ts imports nothing)
// Control: BP_ENGINE_COPY_SEED=message puts a developer string through assertion 1; =inline makes 2 read the
// old inline form, so each half can be seen red.
import path from 'node:path';
import { readStripped } from './lib/source.ts';
import { DEV_WORDS, saveFailWords } from '../apps/web/src/engine/copy.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
const SEED = process.env.BP_ENGINE_COPY_SEED ?? '';

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string, got?: string) => { if (ok) held++; else failures.push(what + (got === undefined ? '' : ` (got ${got})`)); };

// ------------------------------------------------------------------ 1. every rejection shape the routes can throw
// scan/client.ts: decideProposal throws Object.assign(new Error(msg), { status: r.status }) for a non-2xx, status 0
// for a body it could not read, and a bare fetch TypeError (no status) when the request never left the browser.
const CASES: { name: string; e: { status?: number; message?: string } }[] = [
  { name: 'the fetch never reached the product', e: { message: 'Failed to fetch' } },
  { name: 'Safari says it differently', e: { message: 'Load failed' } },
  { name: 'Firefox says it differently again', e: { message: 'NetworkError when attempting to fetch resource.' } },
  { name: 'the product answered an unreadable shape', e: { status: 0, message: 'answered an unexpected shape: decision' } },
  { name: 'the product refused it and said why', e: { status: 422, message: 'that proposal is withdrawn' } },
  { name: 'the product refused it and said nothing', e: { status: 500, message: '' } },
  { name: 'another reader answered it first', e: { status: 409, message: 'proposal p1 was already decided (approved)' } },
];
for (const c of CASES) {
  const e = SEED === 'message' ? { ...c.e, status: undefined } : c.e;
  const w = SEED === 'message' ? { text: 'Not saved: ' + (e.message ?? ''), retry: true } : saveFailWords(e);
  const dev = DEV_WORDS.filter((d) => w.text.includes(d));
  expect(dev.length === 0, `"${c.name}": the reader is shown a developer string (${dev.join(', ')})`, w.text);
  expect(w.text.length > 12 && /^[A-Z]/.test(w.text), `"${c.name}": the reply is not a sentence`, w.text);
  if (c.e.status === 409) expect(w.retry === false, 'a 409 must not put the question back on the queue', String(w.retry));
  else expect(w.retry === true, `"${c.name}": a failure the reader can retry must put the question back`, String(w.retry));
}
// the two shapes that carry no usable words of their own must say what to do about it
const lost = saveFailWords({ message: 'Failed to fetch' }), unreadable = saveFailWords({ status: 0, message: 'x' });
expect(/connection/i.test(lost.text) && /open again/i.test(lost.text), 'a lost connection does not name the cause and the remedy', lost.text);
expect(/open again/i.test(unreadable.text), 'an unreadable answer does not say the question is open again', unreadable.text);
// the product's own refusal is the most useful sentence there is: it must survive
expect(saveFailWords({ status: 422, message: 'that proposal is withdrawn' }).text.includes('that proposal is withdrawn'), 'the product\'s own refusal text was discarded');
expect(saveFailWords({ status: 500, message: '' }).text.includes('500'), 'a refusal with no words of its own does not name its status');

// ------------------------------------------------------------------ 2. Engine.decide's rollback reads copy.ts
let eng = readStripped(path.join(SRC, 'engine/Engine.ts')).replace(/\r\n/g, '\n');
if (SEED === 'inline') eng = eng.replace(/const w = saveFailWords\(e\);\s*\n\s*sim\.settle\(pid, w\.text, w\.retry\);/, "sim.settle(pid, e.status === 409 ? 'Already decided elsewhere' : 'Not saved: ' + e.message, e.status !== 409);");
expect(/saveFailWords/.test(eng), 'Engine.ts no longer reads its save-failure words from engine/copy.ts');
expect(/sim\.settle\(pid, w\.text, w\.retry\)/.test(eng), 'Engine.decide\'s rollback does not settle with saveFailWords\' reply');
expect(!/'Not saved: '\s*\+/.test(eng), 'Engine.ts builds a "Not saved:" sentence inline again, where no gate can read it');
expect(!/\+\s*e\.message/.test(eng), 'Engine.ts interpolates an Error.message into a sentence a reader sees');

if (failures.length) { console.log(failures.map((f) => 'FAIL ' + f).join('\n')); console.log(`check-engine-copy: ${failures.length} failed, ${held} held`); process.exit(1); }
console.log(`check-engine-copy: ${held} expectations held (${CASES.length} rejection shapes, ${DEV_WORDS.length} developer strings forbidden)`);
