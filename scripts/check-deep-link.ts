// Checks the deep link other tools open bp with (src/engine/deep-link.ts): `?product=<slug>&page=ledger&tab=release`
// opens the ledger's Release tab at that product (Personas' Release card), `tab=triage|matrix` the other tabs, a missing
// or unknown tab the ledger's default, any other page nothing; the query keeps every other parameter once the deep link
// is dropped from it; and the engine's URL-state code (Engine.readHash) reads the deep link and drops it.
// Run: node scripts/check-deep-link.ts  (Node's type stripping). Exit 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEEP_LINK_KEYS, deepLinkHash, ledgerLink, withoutDeepLink } from '../src/engine/deep-link.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

check('the Release card link: ledger, release tab', eq(deepLinkHash('?product=pof&page=ledger&tab=release'), { page: 'ledger', lv: 'release' }), JSON.stringify(deepLinkHash('?product=pof&page=ledger&tab=release')));
check('tab=triage and tab=matrix open those tabs', eq(deepLinkHash('?page=ledger&tab=triage'), { page: 'ledger', lv: 'triage' }) && eq(deepLinkHash('?page=ledger&tab=matrix'), { page: 'ledger', lv: 'matrix' }));
check('no tab, or an unknown one: the ledger at its default tab', eq(deepLinkHash('?product=pof&page=ledger'), { page: 'ledger' }) && eq(deepLinkHash('?page=ledger&tab=nope'), { page: 'ledger' }));
check('no page, or a page bp does not know: no deep link', eq(deepLinkHash('?product=pof'), {}) && eq(deepLinkHash('?product=pof&page=plan&tab=release'), {}) && eq(deepLinkHash(''), {}) && eq(deepLinkHash('?tab=release'), {}));
check('the query keeps product and every other parameter, in order', withoutDeepLink('?product=pof&page=ledger&scale=2&tab=release&intro=0') === '?product=pof&scale=2&intro=0', withoutDeepLink('?product=pof&page=ledger&scale=2&tab=release&intro=0'));
check('nothing left: an empty query', withoutDeepLink('?page=ledger&tab=release') === '');
check('the keys are page and tab', eq([...DEEP_LINK_KEYS], ['page', 'tab']));
check('ledgerLink builds the Release card link', ledgerLink('pof') === '/?product=pof&page=ledger&tab=release' && ledgerLink('a b', 'matrix') === '/?product=a+b&page=ledger&tab=matrix', ledgerLink('pof'));
check('a link round-trips', eq(deepLinkHash(ledgerLink('pof').slice(1)), { page: 'ledger', lv: 'release' }));

// the engine's URL state reads it (readHash) and drops it from the query
const engine = fs.readFileSync(path.join(ROOT, 'src/engine/Engine.ts'), 'utf8');
const readHash = engine.slice(engine.indexOf('private readHash()'), engine.indexOf('private restoreHash()'));
check('Engine.readHash reads the deep link before the hash applies', /deepLinkHash\(location\.search\)/.test(readHash) && readHash.indexOf('deepLinkHash') < readHash.indexOf("h.page === 'ledger'"));
check('Engine.readHash drops the deep link from the query', /withoutDeepLink\(location\.search\)/.test(readHash) && /history\.replaceState/.test(readHash));
check('a hash that names a page wins over the deep link', /deep\.page && !h\.page/.test(readHash));

console.log(`deep-link: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
