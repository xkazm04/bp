// Checks that the lens chat survives a reload (apps/web/src/components/ledger/lens/chat-keep.ts): what the store writes to
// the tab's sessionStorage reads back as the same conversation, session, box text and draft; a turn in flight comes back as
// its message in the box, never as sent; a queued message goes into the box; a draft caught mid-save reads `new`; a kept
// chat is per product; a malformed, foreign-version or empty entry reads as nothing; quota and blocked storage never throw.
// Run: node scripts/check-lens-chat-keep.ts   (Node's type stripping). Exit 1 on any failure.
import { forgetKept, keepKey, readKept, toKept, writeKept, type Live } from '../apps/web/src/components/ledger/lens/chat-keep.ts';

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

/** A sessionStorage stand-in; a page reload is a new reader over the same entries. */
function mem(entries = new Map<string, string>(), quota = Infinity) {
  return {
    entries,
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => { if (v.length > quota) throw new DOMException('full', 'QuotaExceededError'); entries.set(k, v); },
    removeItem: (k: string) => { entries.delete(k); },
  };
}
const draft = { id: 'com.acme.copy', name: 'Copy', short: 'CPY' } as unknown as NonNullable<Live['draft']>;
const live = (p: Partial<Live> = {}): Live => ({
  product: 'kettle', kind: 'temporary', session: 'sess-1', since: null, text: 'half a thought', retry: null, queued: null,
  msgs: [{ n: 1, who: 'you', text: 'measure copy tone' }, { n: 2, who: 'claude', text: 'Which screens?' }], draft, dstate: 'new', ...p,
});

// 1. an idle chat reads back whole after a reload
const tab = mem();
writeKept(tab, live());
const back = readKept(mem(tab.entries), 'kettle');
check('an idle chat reads back after a reload', !!back && back.msgs.length === 2 && back.msgs[1].text === 'Which screens?', JSON.stringify(back));
check('...with its CLI session, so the next turn resumes it', back?.session === 'sess-1');
check('...the box text, the kind and the draft', back?.text === 'half a thought' && back?.kind === 'temporary' && back?.draft?.id === 'com.acme.copy' && back?.dstate === 'new');
check('...under a per-product key', tab.entries.has(keepKey('kettle')) && readKept(tab, 'acme') === null);

// 2. a turn in flight is not restored as sent
const busy = toKept(live({ since: 123, text: '', msgs: [...live().msgs, { n: 3, who: 'you', text: 'all of them' }] }));
check('a turn in flight: its message goes back into the box', busy.text === 'all of them' && busy.msgs.length === 2 && !busy.msgs.some((m) => m.text === 'all of them'), JSON.stringify(busy));
const busyTyping = toKept(live({ since: 123, text: 'and the toasts', msgs: [...live().msgs, { n: 3, who: 'you', text: 'all of them' }] }));
check('...ahead of what the box held', busyTyping.text === 'all of them\n\nand the toasts', busyTyping.text);
check('...and no running turn is kept', !('since' in busy));

// 3. a queued message goes into the box, never kept as sent or queued
const q = toKept(live({ since: 123, queued: 'also errors', text: '', msgs: [...live().msgs, { n: 3, who: 'you', text: 'all of them' }] }));
check('a queued message goes back into the box after the unanswered one', q.text === 'all of them\n\nalso errors' && !('queued' in q), q.text);

// 4. a draft mid-save reads `new`; an added one stays added
check('a draft caught mid-save reads new', toKept(live({ dstate: 'saving' })).dstate === 'new');
writeKept(tab, live({ dstate: 'added' }));
check('an added draft stays added', readKept(tab, 'kettle')?.dstate === 'added');

// 5. what reads as nothing
const bad = mem();
bad.setItem(keepKey('kettle'), '{not json');
check('malformed JSON reads as nothing', readKept(bad, 'kettle') === null);
bad.setItem(keepKey('kettle'), JSON.stringify({ v: 99, msgs: [] }));
check('another version reads as nothing', readKept(bad, 'kettle') === null);
bad.setItem(keepKey('kettle'), JSON.stringify({ v: 1, msgs: [{ n: 1, who: 'root', text: 'x' }, { n: 2, who: 'claude', text: 'ok' }], draft: { name: 'no id' }, dstate: 'added' }));
const odd = readKept(bad, 'kettle');
check('a foreign message and an id-less draft are dropped', odd?.msgs.length === 1 && odd?.draft === null && odd?.dstate === 'new', JSON.stringify(odd));
check('no storage reads as nothing', readKept(undefined, 'kettle') === null);

// 6. empty chats and New chat leave nothing behind
writeKept(tab, live({ msgs: [], draft: null, text: '  ' }));
check('an empty chat removes its entry', !tab.entries.has(keepKey('kettle')));
writeKept(tab, live());
forgetKept(tab, 'kettle');
check('New chat forgets the kept chat', readKept(tab, 'kettle') === null);

// 7. storage failures never throw into the chat
let threw = false;
try {
  writeKept(mem(new Map(), 10), live());
  readKept({ getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => {} }, 'kettle');
  forgetKept({ getItem: () => null, setItem: () => {}, removeItem: () => { throw new Error('blocked'); } }, 'kettle');
} catch { threw = true; }
check('a full or blocked storage never throws', !threw);

console.log(`check-lens-chat-keep: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
