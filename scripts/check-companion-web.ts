// Pins the companion web host's pure halves (apps/web/src/components/companion/, docs/blueprint-ui.md "Companion"):
//   1. state derivation: every LampState from the store, in the documented precedence, and the caption
//   2. the store: a turn read from its own POST body and the stream is never shown twice; a focus id runs once; a decided
//      card leaves after CARD_FADE_MS; a 409 notice expires
//   3. the focus mapping table, kind by kind, the cross-product notice and the duplicate skip
//   4. SSE parsing across split chunks (every split point, CRLF split between \r and \n, comments, multi-line data) and
//      the stream reconnect (a fake EventSource: down -> offline, reopened after the backoff)
//   5. the companion's CSS: no font under 12 px, motion on transform and opacity only
//   6. the voice: what a reply is reduced to before it is spoken, the mute's precedence, the tremolo's range
//   7. a failed approved card says why (DW-109): store.ts failedWords(card) is the card's stored result, bounded, null unless
//      it failed; Cards.tsx and the Glim lamp, rendered with react-dom/server in a child process (this gate strips types and
//      cannot load .tsx), show it, and the lamp no longer says "Approved. Glim carries it to the builders." for such a card
// Run: node scripts/check-companion-web.ts   (Node's type stripping; the modules import siblings with extensions)
import fs from 'node:fs';
import path from 'node:path';
import type { Card, CompanionEvent, FocusCommand, TurnEvent } from '../packages/core/src/companion/contract.ts';
import * as STORE from '../apps/web/src/components/companion/store.ts';
import { BUSY, CARD_FADE_MS, INITIAL, NOTICE_MS, OFFLINE, POINT_MS, createStore, deriveLamp, reduce, type CompanionState, type LampInputs } from '../apps/web/src/components/companion/store.ts';
import { connect, readEvent, readTurnEvent, sseParser, type SseMessage } from '../apps/web/src/components/companion/stream.ts';
import { FOCUS_TABLE, placeHash, planFocus } from '../apps/web/src/components/companion/focus.ts';
import { fxGain, voiceStatus } from '../apps/web/src/components/companion/voice.ts';
import { readVoicePref, speakable, VOICE, VOICE_DEFAULT_ON, VOICE_DESIGN, VOICE_FX, VOICE_MAX_CHARS } from '../packages/core/src/companion/voice.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const HELD = "useState<Record<string, 'approve' | 'decline'>>({})";
/** The child of section 7: renders Cards and GlimLamp under the transpiling loader, one JSON line out. */
const CHILD = String.raw`
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const ROOT = process.argv[2];
try {
  const req = createRequire(path.join(ROOT, 'apps/web/package.json'));
  const url = (p) => pathToFileURL(path.join(ROOT, p)).href;
  const { registerSrcHooks } = await import(url('scripts/lib/src-hooks.mjs'));
  registerSrcHooks(ROOT, { transpile: true, mutate: [['Lamp.tsx', "useState<Record<string, 'approve' | 'decline'>>({})", "useState<Record<string, 'approve' | 'decline'>>({ c1: 'approve' })"]] });
  const React = req('react'), { renderToStaticMarkup: html } = req('react-dom/server');
  const { Cards } = await import(url('apps/web/src/components/companion/Cards.tsx'));
  const { GlimLamp } = await import(url('apps/web/src/components/companion/lamps/glim/Lamp.tsx'));
  const S = await import(url('apps/web/src/components/companion/store.ts'));
  const failed = { id: 'c1', tool: 'release.build', args: { slug: 'x' }, summary: 'Build the release', state: 'failed', createdAt: '2026-11-06T00:00:00.000Z', result: '412 {"error":"gh is not logged in"}' };
  const fns = { onCard() {}, onSubmit() {} };
  // as the host feeds a lamp: the store holds the card it saw pending, then failed; deriveLamp says the state and caption
  let s = S.reduce(S.INITIAL, { type: 'online', on: true }, 0);
  s = S.reduce(s, { type: 'event', e: { type: 'card', card: { ...failed, state: 'pending', result: undefined } } }, 1);
  s = S.reduce(s, { type: 'event', e: { type: 'card', card: failed } }, 2);
  const d = S.deriveLamp(s, { now: 3, composerFocused: false, composerEmpty: true, jobsRunning: false, product: 'x' });
  console.log(JSON.stringify({
    cards: html(React.createElement(Cards, { cards: [failed], onCard() {} })),
    doneCards: html(React.createElement(Cards, { cards: [{ ...failed, state: 'done' }], onCard() {} })),
    lampAsking: html(React.createElement(GlimLamp, { state: 'asking', cards: [failed], ...fns })),
    lampDerived: html(React.createElement(GlimLamp, { ...d, cards: s.cards, ...fns })),
    lampHeld: html(React.createElement(GlimLamp, { state: 'asking', cards: [{ ...failed, state: 'pending', result: undefined }], ...fns })),
  }));
} catch (e) { console.log(JSON.stringify({ error: String(e && e.stack || e) })); }
`;
let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) console.log('ok  ' + name);
  else { failed++; console.log('FAIL  ' + name + (got === undefined ? '' : ' (got ' + JSON.stringify(got) + ')')); }
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------------- 1. state derivation
const T0 = 1_000_000;
const ui = (o: Partial<LampInputs> = {}): LampInputs => ({ now: T0, composerFocused: false, composerEmpty: true, jobsRunning: false, product: 'kettle', ...o });
const card = (id: string, state: Card['state'] = 'pending'): Card => ({ id, tool: 'wave.dispatch', args: { slug: 'kettle', wave: 'w1' }, summary: 'Dispatch wave w1', state, createdAt: '2026-10-26T09:00:00Z' });
const focusCmd = (id: string, o: Partial<FocusCommand> = {}): FocusCommand => ({ id, product: 'kettle', target: { kind: 'feature', id: 'checkout' }, say: 'This one', ...o });
const run = (acts: Parameters<typeof reduce>[1][], s: CompanionState = INITIAL, now = T0) => acts.reduce((x, a) => reduce(x, a, now), s);
const on = run([{ type: 'online', on: true }]);
const tv = (conv: string, e: TurnEvent): CompanionEvent => ({ type: 'turn', conversationId: conv, event: e });

check('derive: stream down -> idle, caption "companion offline"', eq(deriveLamp(INITIAL, ui()), { state: 'idle', caption: OFFLINE }));
check('derive: stream down wins over a pending card', deriveLamp(run([{ type: 'event', e: { type: 'card', card: card('c1') } }]), ui()).state === 'idle');
check('derive: a pending card -> asking (caption: its summary)', eq(deriveLamp(run([{ type: 'event', e: { type: 'card', card: card('c1') } }], on), ui()), { state: 'asking', caption: 'Dispatch wave w1' }));
const pointed = run([{ type: 'event', e: { type: 'focus', focus: focusCmd('f1') } }], on);
check('derive: focus within POINT_MS (6 s) -> pointing, caption = say', eq(deriveLamp(pointed, ui({ now: T0 + POINT_MS - 1 })), { state: 'pointing', caption: 'This one' }));
check('derive: focus after POINT_MS -> no longer pointing', deriveLamp(pointed, ui({ now: T0 + POINT_MS })).state === 'idle');
check('derive: focus for another product -> not pointing', deriveLamp(run([{ type: 'event', e: { type: 'focus', focus: focusCmd('f2', { product: 'pof' }) } }], on), ui()).state === 'idle');
const started = run([{ type: 'event', e: tv('c', { type: 'start', turnId: 't1', conversationId: 'c' }) }], on);
check('derive: a turn awaiting its first text -> thinking', deriveLamp(started, ui()).state === 'thinking');
const speaking = run([{ type: 'event', e: tv('c', { type: 'text', delta: 'Three decisions' }) }], started);
check('derive: streaming text -> speaking, caption = the text', eq(deriveLamp(speaking, ui()), { state: 'speaking', caption: 'Three decisions' }));
const tooling = run([{ type: 'event', e: tv('c', { type: 'tool', name: 'inbox.list', args: {}, callId: 'k1' }) }], speaking);
check('derive: a tool running -> working', deriveLamp(tooling, ui()).state === 'working');
check('derive: the tool answered -> back to speaking', deriveLamp(run([{ type: 'event', e: tv('c', { type: 'tool_result', callId: 'k1', ok: true, summary: '3' }) }], tooling), ui()).state === 'speaking');
check('derive: a scan job running -> working', deriveLamp(on, ui({ jobsRunning: true })).state === 'working');
check('derive: composer focused and empty -> listening', deriveLamp(on, ui({ composerFocused: true })).state === 'listening');
check('derive: composer focused with text -> idle', deriveLamp(on, ui({ composerFocused: true, composerEmpty: false })).state === 'idle');
const ended = run([{ type: 'event', e: tv('c', { type: 'end', outcome: 'done', costUsd: null }) }], speaking);
check('derive: otherwise idle, caption = what it last said', eq(deriveLamp(ended, ui()), { state: 'idle', caption: 'Three decisions' }));
check('derive: precedence asking > pointing > thinking', deriveLamp(run([{ type: 'event', e: { type: 'card', card: card('c9') } }], run([{ type: 'event', e: { type: 'focus', focus: focusCmd('f9') } }], started)), ui()).state === 'asking'
  && deriveLamp(run([{ type: 'event', e: { type: 'focus', focus: focusCmd('f9') } }], started), ui()).state === 'pointing');

// ------------------------------------------------------------------------- 2. the store
{
  // a turn this page posted: the stream's copy of the same deltas is dropped, the POST's start rebuilds it
  let s = run([{ type: 'posting', conversationId: '' }], on);
  check('store: a new posted turn reads thinking before the server answers', deriveLamp(s, ui()).state === 'thinking');
  s = run([{ type: 'event', e: tv('c7', { type: 'start', turnId: 't7', conversationId: 'c7' }) }, { type: 'event', e: tv('c7', { type: 'text', delta: 'Hel' }) }], s);
  s = run([{ type: 'local', e: { type: 'start', turnId: 't7', conversationId: 'c7' } }, { type: 'local', e: { type: 'text', delta: 'Hel' } }, { type: 'event', e: tv('c7', { type: 'text', delta: 'lo' }) }, { type: 'local', e: { type: 'text', delta: 'lo' } }], s);
  check('store: a delta on both the POST body and the stream shows once', s.turns.c7?.text === 'Hello' && s.local === 'c7' && !('' in s.turns), s.turns);
  s = run([{ type: 'posting', conversationId: null }], s);
  check('store: a POST body that closed without end reads interrupted', s.turns.c7.done && s.turns.c7.outcome === 'interrupted' && s.local === null);
  const b = run([{ type: 'notice', text: BUSY }], on);
  check('store: 409 thread_busy -> "still answering the last one"', deriveLamp(b, ui()).caption === BUSY && deriveLamp(reduce(b, { type: 'prune' }, T0 + NOTICE_MS), ui({ now: T0 + NOTICE_MS })).caption === undefined);
  const f2 = run([{ type: 'event', e: { type: 'focus', focus: focusCmd('fx') } }], on);
  check('store: a duplicate focus id is ignored', reduce(f2, { type: 'event', e: { type: 'focus', focus: focusCmd('fx') } }, T0 + 5000) === f2);
  let c = run([{ type: 'event', e: { type: 'card', card: card('a') } }, { type: 'event', e: { type: 'card', card: card('b') } }], on);
  c = reduce(c, { type: 'event', e: { type: 'card', card: { ...card('a', 'approved'), decidedBy: 'human' } } }, T0 + 100);
  check('store: pending cards first', c.cards.map((x) => x.id).join() === 'b,a', c.cards.map((x) => x.id));
  check('store: a decided card stays until CARD_FADE_MS', reduce(c, { type: 'prune' }, T0 + 100 + CARD_FADE_MS - 1).cards.length === 2 && reduce(c, { type: 'prune' }, T0 + 100 + CARD_FADE_MS).cards.length === 1);
  check('store: a card first seen decided is not shown', run([{ type: 'event', e: { type: 'card', card: card('z', 'done') } }], on).cards.length === 0);
  const st = createStore(() => T0); let n = 0; st.subscribe(() => n++);
  st.dispatch({ type: 'online', on: false }); st.dispatch({ type: 'online', on: true });
  check('store: a no-op action notifies nobody', n === 1);
}

// ------------------------------------------------------------------------- 3. focus mapping
const steps = (kind: Exclude<FocusCommand['target']['kind'], 'page'>) => FOCUS_TABLE[kind]('x1');
check('focus: a console page (the table\'s, G1) is skipped by the page', planFocus({ id: 'fp', product: 'kettle', target: { kind: 'page', id: 'standup' } }, 'kettle', new Set()).kind === 'skip');
check('focus: feature -> plan page, flyToFeature, rect from the camera', eq(steps('feature'), { steps: [{ op: 'page', page: 'plan' }, { op: 'flyToFeature', id: 'x1' }], rect: { from: 'feature', id: 'x1' } }));
check('focus: room -> the hash route, rect from the room box', eq(steps('room'), { steps: [{ op: 'place', kind: 'room', id: 'x1' }], rect: { from: 'place', kind: 'room', id: 'x1' } }));
check('focus: wing -> the hash route, rect from the wing box', eq(steps('wing'), { steps: [{ op: 'place', kind: 'wing', id: 'x1' }], rect: { from: 'place', kind: 'wing', id: 'x1' } }));
check('focus: decision -> plan page, openDecision, rect of #dcard', eq(steps('decision'), { steps: [{ op: 'page', page: 'plan' }, { op: 'openDecision', id: 'x1' }], rect: { from: 'dom', selector: '#dcard' } }));
check('focus: wave -> ledger triage + showWave', eq(steps('wave'), { steps: [{ op: 'page', page: 'ledger', lv: 'triage' }, { op: 'wave', id: 'x1' }], rect: { from: 'dom', selector: '[data-wave="x1"]' } }));
check('focus: release -> ledger release + focus', eq(steps('release'), { steps: [{ op: 'page', page: 'ledger', lv: 'release' }, { op: 'ledgerFocus', id: 'x1', clear: false }], rect: { from: 'dom', selector: '[data-fid="x1"]' } }));
check('focus: ledger-row -> ledger triage + focus, filters cleared', eq(steps('ledger-row'), { steps: [{ op: 'page', page: 'ledger', lv: 'triage' }, { op: 'ledgerFocus', id: 'x1', clear: true }], rect: { from: 'dom', selector: '[data-fid="x1"]' } }));
check('focus: lens -> setView', eq(steps('lens'), { steps: [{ op: 'lens', id: 'x1' }] }));
check('focus: every FocusKind has a row', ['feature', 'room', 'wing', 'decision', 'wave', 'release', 'ledger-row', 'lens'].every((k) => k in FOCUS_TABLE) && Object.keys(FOCUS_TABLE).length === 8);
check('focus: a selector quotes the id', FOCUS_TABLE.wave('a"b').rect?.from === 'dom' && (FOCUS_TABLE.wave('a"b').rect as { selector: string }).selector === '[data-wave="a\\"b"]');
const away = planFocus(focusCmd('f5', { product: 'pof', say: 'The retry has no timeout' }), 'kettle', new Set());
check('focus: another product -> a notice "<say> - in <product>", no steps', eq(away, { kind: 'elsewhere', product: 'pof', text: 'The retry has no timeout - in pof' }));
check('focus: another product without say names the target', (planFocus(focusCmd('f6', { product: 'pof', say: undefined }), 'kettle', new Set()) as { text: string }).text === 'feature checkout - in pof');
check('focus: a duplicate id is skipped', planFocus(focusCmd('f7'), 'kettle', new Set(['f7'])).kind === 'skip');
check('focus: this product runs the table row', eq(planFocus(focusCmd('f8'), 'kettle', new Set()), { kind: 'run', ...FOCUS_TABLE.feature('checkout') }));
check('focus: placeHash keeps lens and time, drops open/page/lv/at', placeHash('#lens=security&open=f1&t=2026-10-01&page=ledger&lv=matrix&at=w0', 'room 2') === '#lens=security&t=2026-10-01&at=room%202');
check('focus: placeHash on an empty hash', placeHash('', 'w1') === '#at=w1');

// ------------------------------------------------------------------------- 4. SSE parsing and the stream
const wire = 'event: start\r\ndata: {"turnId":"t1","conversationId":"c1"}\r\n\r\n: a comment\n'
  + 'event: text\ndata: {"type":"text",\ndata: "delta":"héllo"}\n\n'
  + 'data: {"type":"end","outcome":"done","costUsd":null}\r\r'
  + 'event: text\ndata: {"delta":"never ended"}';
const parse = (chunks: string[]) => { const out: SseMessage[] = []; const p = sseParser((m) => out.push(m)); for (const c of chunks) p.push(c); p.end(); return out; };
const whole = parse([wire]);
check('sse: whole body -> three events (the unterminated one is not an event)', whole.length === 3, whole);
check('sse: multi-line data joins with \\n', whole[1]?.data === '{"type":"text",\n"delta":"héllo"}');
check('sse: an unnamed event is "message"', whole[2]?.event === 'message');
let splitsOk = true;
for (let i = 0; i <= wire.length; i++) for (let j = i; j <= wire.length; j += 7) if (!eq(parse([wire.slice(0, i), wire.slice(i, j), wire.slice(j)]), whole)) { splitsOk = false; break; }
check('sse: every split point (inside lines, between \\r and \\n) gives the same events', splitsOk);
check('sse: one char at a time gives the same events', eq(parse([...wire]), whole));
const evs = whole.map(readTurnEvent);
check('sse: turn events typed by their own type or the event name', eq(evs.map((e) => e?.type), ['start', 'text', 'end']) && (evs[1] as { delta?: string })?.delta === 'héllo');
check('sse: an unknown or malformed event is skipped', readTurnEvent({ event: 'bogus', data: '{}' }) === null && readTurnEvent({ event: 'text', data: 'not json' }) === null);
check('stream: a turn event reads', eq(readEvent({ event: 'turn', data: JSON.stringify({ conversationId: 'c', event: { type: 'text', delta: 'x' } }) }), { conversationId: 'c', event: { type: 'text', delta: 'x' }, type: 'turn' }));
check('stream: a focus without a target is skipped', readEvent({ event: 'focus', data: JSON.stringify({ focus: { id: 'f' } }) }) === null);

await (async () => {
  const st = createStore();
  const opened: FakeES[] = [];
  class FakeES {
    onopen: ((e: Event) => void) | null = null; onerror: ((e: Event) => void) | null = null; closed = false;
    l = new Map<string, (e: Event) => void>();
    addEventListener(t: string, f: (e: Event) => void) { this.l.set(t, f); }
    close() { this.closed = true; }
  }
  const close = connect(st, { open: () => { const e = new FakeES(); opened.push(e); return e as never; } });
  opened[0].onopen?.({} as Event);
  check('stream: open -> online', st.get().online);
  opened[0].l.get('focus')?.({ type: 'focus', data: JSON.stringify({ focus: focusCmd('s1') }) } as unknown as Event);
  check('stream: a named event reaches the store', st.get().lastFocus?.focus.id === 's1');
  opened[0].onerror?.({} as Event);
  check('stream: an error -> offline, the source closed', !st.get().online && opened[0].closed);
  await new Promise((r) => setTimeout(r, 650));
  check('stream: reopened after the 0.5 s backoff', opened.length === 2);
  close();
  check('stream: closing stops it', opened[1].closed && !st.get().online);
})();

// ------------------------------------------------------------------------- 6. the voice: what is spoken, the mute, the effect
check('voice: markdown, code and links reduce to their words', speakable('**Wave three** is `ready`. See [the ledger](http://x/y) and https://a.b/c now.') === 'Wave three is ready. See the ledger and now.');
check('voice: a code block and list markers are not read', speakable('Two checks:\n- lint\n- types\n```sh\nnpm run check\n```') === 'Two checks: lint types');
const sent = 'The nightly scan finished across all four projects and coverage moved up a little. ';
check('voice: a long reply is cut at the last sentence end that fits', speakable(sent.repeat(6)) === sent.repeat(3).trim(), speakable(sent.repeat(6)));
check('voice: a sentence end in the first third is too early to cut at (the last word instead)', speakable('Yes. ' + 'word '.repeat(80)).endsWith('word…'));
const words = 'word '.repeat(100);
check('voice: no sentence end in reach -> the last whole word, an ellipsis', speakable(words).endsWith('word…') && speakable(words).length <= VOICE_MAX_CHARS + 1);
check('voice: a short reply is kept whole', speakable('Done. Nice work.') === 'Done. Nice work.');
check('voice: the preference defaults on, reads on/off, ignores junk', readVoicePref(null) === true && readVoicePref('off') === false && readVoicePref('on') === true && readVoicePref('x') === VOICE_DEFAULT_ON);
const vs = (o: Partial<Parameters<typeof voiceStatus>[0]>) => voiceStatus({ on: true, playing: false, blocked: false, reason: null, ...o });
check('voice: off wins over every other status (the mute is absolute)', vs({ on: false, playing: true, blocked: true, reason: 'x' }) === 'off');
check('voice: unavailable, speaking, blocked, on in that order', vs({ reason: 'x', playing: true }) === 'unavailable' && vs({ playing: true, blocked: true }) === 'speaking' && vs({ blocked: true }) === 'blocked' && vs({}) === 'on');
check('voice: the tremolo swings between 1 - depth and 1', Math.abs(fxGain(0) - (1 - VOICE_FX.tremolo.depth / 2)) < 1e-9 && Math.abs(fxGain(1 / (4 * VOICE_FX.tremolo.hz)) - 1) < 1e-9 && Math.abs(fxGain(3 / (4 * VOICE_FX.tremolo.hz)) - (1 - VOICE_FX.tremolo.depth)) < 1e-9);
check('voice: the design record\'s reference clips are all in the repo', VOICE_DESIGN.reference.every((r) => fs.existsSync(path.join(ROOT, r.file))), VOICE_DESIGN.reference.filter((r) => !fs.existsSync(path.join(ROOT, r.file))).map((r) => r.file));
check('voice: every reference line fits one spoken line, and only the design read has no text', VOICE_DESIGN.reference.filter((r) => r.text === null).length === 1 && VOICE_DESIGN.reference.every((r) => r.text === null || (r.text.length > 0 && speakable(r.text) === r.text)));
check('voice: the design record stays out of the cache key (VOICE carries no design field)', !('design' in VOICE) && !JSON.stringify(VOICE).includes(VOICE_DESIGN.description));

// ------------------------------------------------------------------------- 5. CSS: 12 px floor, transform/opacity motion
const DIR = path.join(ROOT, 'apps/web/src/components/companion');
const cssFiles = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? cssFiles(path.join(d, e.name)) : e.name.endsWith('.css') ? [path.join(d, e.name)] : []));
for (const f of cssFiles(DIR)) {
  const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const small = [...css.matchAll(/font(?:-size)?\s*:[^;}]*?(\d+(?:\.\d+)?)px/g)].filter((m) => +m[1] < 12).map((m) => m[0]);
  check(rel + ': no font under 12 px', small.length === 0, small);
  const trans = [...css.matchAll(/transition\s*:([^;}]*)/g)].flatMap((m) => m[1].split(/,(?![^(]*\))/).map((p) => p.trim().split(/\s+/)[0])).filter((p) => p !== 'transform' && p !== 'opacity' && p !== 'none');
  const frames = [...css.matchAll(/@keyframes[^{]*\{((?:[^{}]*\{[^}]*\})*)[^}]*\}/g)].flatMap((m) => [...m[1].matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1])).filter((p) => p !== 'transform' && p !== 'opacity');
  check(rel + ': motion on transform and opacity only', !trans.length && !frames.length, [...trans, ...frames]);
}

// ------------------------------------------------------------------------- 7. a failed approved card says why (DW-109)
{
  const failedWords = (STORE as unknown as { failedWords?: (c: Pick<Card, 'state' | 'result'>) => string | null }).failedWords;
  const WHY = '412 {"error":"gh is not logged in"}';
  check('failed: store.ts exports failedWords(card): string | null', typeof failedWords === 'function');
  if (typeof failedWords === 'function') {
    const w = failedWords({ ...card('c9', 'failed'), result: WHY }) ?? '';
    check('failed: the words keep the HTTP status and the message', w.includes('412') && w.includes('gh is not logged in'), w);
    check('failed: null unless the card failed', (['pending', 'approved', 'declined', 'expired', 'done'] as Card['state'][]).every((s) => failedWords({ ...card('c9', s), result: WHY }) === null));
    const long = failedWords({ ...card('c9', 'failed'), result: '503 ' + 'x'.repeat(5000) }) ?? '';
    check('failed: a long result is bounded (at most 600 characters) and keeps its status', long.startsWith('503') && long.length <= 600, long.length);
    let threw = false; try { failedWords(card('c9', 'failed')); } catch { threw = true; }
    check('failed: a failed card with no stored result does not throw', !threw);
  }
  // the components: the lamp's "held" answer is state only a click sets, so the child seeds that one useState as approved
  const childDir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'bp-check-companion-web-'));
  try {
    const child = path.join(childDir, 'render.mjs');
    fs.writeFileSync(child, CHILD);
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [child, ROOT], { encoding: 'utf8', timeout: 60000 });
    const out = (() => { try { return JSON.parse(r.stdout.trim().split('\n').pop() ?? '') as Record<string, string>; } catch { return { error: r.stderr + r.stdout } as Record<string, string>; } })();
    check('failed: the components render in the child', !out.error, out.error?.slice(0, 600));
    const has = (h: string) => (h ?? '').includes('412') && (h ?? '').includes('gh is not logged in');
    const lampSrc = fs.readFileSync(path.join(ROOT, 'apps/web/src/components/companion/lamps/glim/Lamp.tsx'), 'utf8');
    check('failed: Lamp.tsx keeps the line the render seeds (the held useState, literally)', lampSrc.includes(HELD));
    check('failed: Cards.tsx shows the reason on a failed card', has(out.cards), out.cards);
    check('failed: Cards.tsx still says Failed', /Failed/.test(out.cards ?? ''), out.cards);
    check('failed: Cards.tsx shows no result on a done card', !/gh is not logged in/.test(out.doneCards ?? '') && /Done/.test(out.doneCards ?? ''), out.doneCards);
    for (const k of ['lampAsking', 'lampDerived']) {
      check('failed: the Glim lamp (' + k + ') shows the reason', has(out[k]), (out[k] ?? '').slice(-400));
      check('failed: the Glim lamp (' + k + ') does not say Approved for a failed card', !/Glim carries it to the builders/.test(out[k] ?? ''), (out[k] ?? '').slice(-400));
    }
    check('failed: GUARD the lamp still says Approved while an approved card has not answered', /Glim carries it to the builders/.test(out.lampHeld ?? ''), (out.lampHeld ?? '').slice(-400));
  } finally { fs.rmSync(childDir, { recursive: true, force: true }); }
}

console.log(failed ? `\n${failed} companion web check(s) failed` : '\ncompanion web ok');
process.exit(failed ? 1 : 0);
