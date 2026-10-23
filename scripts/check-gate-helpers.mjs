#!/usr/bin/env node
// The derived-source helpers check-bplink.mjs exports (stripCxx, braceSpan, readEventsReport, copiedCaptures,
// streamStateReport, includePathAdds, junctionSpec) and the validate() check-art.mjs exports, imported WITHOUT running either gate, with the
// seeded cases that proved them correct pinned here instead of living in a transcript. A helper a gate trusts to say
// "this C++ is compliant" is only worth that if it can be shown to say "it is not": every helper gets a positive and a
// negative case. Also runs each gate once as a child and requires its summary line, because a gate whose main-module guard
// misfired would import cleanly, do nothing and exit 0.
// Run: node scripts/check-gate-helpers.mjs   Exit 1 on any failure.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A gate that still runs on import would call process.exit() mid-import and end THIS check with the gate's own (green)
// status and none of the cases below run. So the exit is watched: unless the end of the file was reached, it is a failure.
let finished = false;
process.on('exit', () => { if (!finished) { console.log('FAIL  check-gate-helpers did not reach its end: an imported gate ran and exited the process'); process.exitCode = 1; } });
const { stripCxx, braceSpan, readEventsReport, copiedCaptures, streamStateReport, includePathAdds, junctionSpec, payloadErrors } = await import('./check-bplink.mjs');
const { validate } = await import('./check-art.mjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const nl = (t) => (t.match(/\n/g) ?? []).length;

// ---- stripCxx
const lineComment = stripCxx('code(); // StreamStatus == 200\nnext();');
check('stripCxx: a // comment is gone and its newline survives', !lineComment.includes('200') && nl(lineComment) === 1 && lineComment.includes('next();'), JSON.stringify(lineComment));
const blockComment = stripCxx('a /* StreamStatus == 405\n still comment */ b');
check('stripCxx: a block comment is blanked and its newline survives', !blockComment.includes('405') && nl(blockComment) === 1 && blockComment.includes('a ') && blockComment.endsWith(' b'), JSON.stringify(blockComment));
check('stripCxx: // inside a string is not a comment when strings are kept', stripCxx('f(TEXT("http://127.0.0.1:3100")); g();', true).includes('http://127.0.0.1:3100')
  && stripCxx('f(TEXT("http://127.0.0.1:3100")); g();', true).includes('g();'));
check('stripCxx: string literals are blanked unless kept', !stripCxx('f("StreamStatus == 405");').includes('405') && stripCxx('f("StreamStatus == 405");', true).includes('405'));
const escaped = stripCxx('a("x\\"//y") b', false);
check('stripCxx: an escaped quote does not end the string early', escaped.endsWith(' b') && !escaped.includes('y'), JSON.stringify(escaped));
check('stripCxx: the kept and blanked forms have the same length (an index into one is an index into the other)', (() => { const t = 'a("x\\"y"); // c\nb("zz");'; return stripCxx(t).length === stripCxx(t, true).length; })());

// ---- braceSpan
check('braceSpan: matches nested braces', (() => { const t = 'x { a { b } c } y { z }'; const sp = braceSpan(t, 0); return t.slice(...sp) === '{ a { b } c }'; })());
check('braceSpan: null when unbalanced or absent', braceSpan('x { a { b }', 0) === null && braceSpan('no braces', 0) === null);

// ---- readEventsReport
const readEvents = (inLoop, after) => `void ReadEvents(const FString& J, TArray<E>& Out) { int32 Skipped = 0; for (const FString& Line : Lines) { if (ok) { Out.Add(1); } else ${inLoop} } ${after}
}`;
const report = (t) => readEventsReport(stripCxx(t), stripCxx(t, true));
const capped = readEvents('if (++Skipped <= Max) { UE_LOG(LogBpLink, Warning, TEXT("a %.80s"), *Line); }', 'if (Skipped > 0) { UE_LOG(LogBpLink, Warning, TEXT("skipped %d of %d"), Skipped, Total); }');
const uncapped = readEvents('{ UE_LOG(LogBpLink, Warning, TEXT("a %.80s"), *Line); }', '');
const noSummary = readEvents('if (++Skipped <= Max) { UE_LOG(LogBpLink, Warning, TEXT("a %.80s"), *Line); }', '');
check('readEventsReport: a guarded warning plus an N-of-M summary reads 0 unguarded, 1 summary', JSON.stringify(report(capped)) === JSON.stringify({ unguarded: 0, summaries: 1 }), JSON.stringify(report(capped)));
check('readEventsReport: a warning per line with no guard reads 1 unguarded, 0 summaries', JSON.stringify(report(uncapped)) === JSON.stringify({ unguarded: 1, summaries: 0 }), JSON.stringify(report(uncapped)));
check('readEventsReport: a guarded warning with no summary reads 0 summaries', report(noSummary)?.summaries === 0 && report(noSummary)?.unguarded === 0);
check('readEventsReport: a summary that only talks about it in a comment does not count', report(readEvents('if (++Skipped <= Max) { UE_LOG(LogBpLink, Warning, TEXT("a")); }', '// UE_LOG(LogBpLink, Warning, TEXT("skipped %d of %d"))'))?.summaries === 0);
check('readEventsReport: null when ReadEvents is absent', report('void Other() { for (;;) { } }') === null);

// ---- copiedCaptures
const caps = (c) => copiedCaptures(stripCxx(`R->OnDone().BindLambda([${c}](int) mutable { });`), 'Snapshot');
check('copiedCaptures: a bare Snapshot is a copy', caps('Root, Snapshot').join() === 'Snapshot');
check('copiedCaptures: Snapshot = Snapshot and a default = capture are copies', caps('Snapshot = Snapshot').length === 1 && caps('=').length === 1);
check('copiedCaptures: Snapshot = MoveTemp(Snapshot) is not a copy', caps('Root, Snapshot = MoveTemp(Snapshot)').length === 0 && caps('Snapshot=MoveTemp( Snapshot )').length === 0);
check('copiedCaptures: other captures and a by-reference one are not copies of Snapshot', caps('Root, Slug, OnDone').length === 0 && caps('&Snapshot').length === 0);

// ---- streamStateReport
const hdr = (v) => stripCxx(`struct S { int32 StreamStatus = ${v}; };`);
const cppOf = (assign, branch) => `Snapshot.StreamStatus = ${assign}; if (Snapshot.StreamStatus == 200) { UE_LOG(LogBpLink, Log, TEXT("ok")); } ${branch}`;
const ss = (h, c) => streamStateReport(h, stripCxx(c), stripCxx(c, true));
const good = ss(hdr(-1), cppOf('(bConn && Resp.IsValid()) ? Resp->GetResponseCode() : 0', 'else if (Snapshot.StreamStatus == 0) { UE_LOG(LogBpLink, Warning, TEXT("did not connect: %s"), *Root); }'));
check('streamStateReport: reads the default, the no-connection value and its warning text', good.initial === -1 && good.noConnect === 0 && good.message === 'did not connect: %s', JSON.stringify(good));
const same = ss(hdr(0), cppOf('(bConn) ? Resp->GetResponseCode() : 0', 'else if (Snapshot.StreamStatus == 0) { UE_LOG(LogBpLink, Warning, TEXT("answered %d"), Snapshot.StreamStatus); }'));
check('streamStateReport: the old shape reads default 0, no-connection 0 and a message that says answered', same.initial === 0 && same.noConnect === 0 && /answered/.test(same.message), JSON.stringify(same));
check('streamStateReport: no branch on the no-connection value reads message null', ss(hdr(-1), cppOf('(bConn) ? 1 : 0', '')).message === null);

// ---- includePathAdds
check('includePathAdds: finds PublicIncludePaths.Add, PrivateIncludePaths.AddRange and PublicSystemIncludePaths.Add in code', includePathAdds('PublicIncludePaths.Add(x); PrivateIncludePaths.AddRange(y); PublicSystemIncludePaths.Add(z);').length === 3);
check('includePathAdds: [] for a comment or a string that only names one, and for other lists', includePathAdds('// PublicIncludePaths.Add(x)\n/* PrivateIncludePaths.Add(y) */ s = "PublicIncludePaths.Add(z)"; PublicDependencyModuleNames.AddRange(d);').length === 0);

// ---- junctionSpec
check('junctionSpec: reads $LinkRel and $TargetRel with / separators', JSON.stringify(junctionSpec("$x = 1\n$LinkRel = 'a\\b\\Schema'\n$TargetRel = 'p\\ue'\n")) === JSON.stringify({ link: 'a/b/Schema', target: 'p/ue' }));
check('junctionSpec: null when either line is missing, commented out or not a single-quoted literal',
  junctionSpec("$LinkRel = 'a'\n") === null && junctionSpec("$LinkRel = 'a'\n$TargetRel = \"b\"\n") === null && junctionSpec("# $LinkRel = 'a'\n# $TargetRel = 'b'\n") === null);

// ---- payloadErrors (the schema validators check-bplink holds)
check('payloadErrors: an empty body is refused by plan-1 and structure-envelope-1, a minimal pong passes scan-wire-1', payloadErrors('plan-1', {}) !== '' && payloadErrors('structure-envelope-1', {}) !== '' && payloadErrors('scan-wire-1', { ping: { at: '2026-10-21T00:00:00Z' } }) === '' && payloadErrors('scan-wire-1', { ping: {} }) !== '');
check('payloadErrors: an unregistered schema name is reported, not accepted', /not registered/.test(payloadErrors('no-such-schema', {})));

// ---- validate (check-art)
const manifest = { id: 'x', gates: Object.fromEntries(['input', 'mesh_acceptance', 'scale', 'finishing', 'poly_budget'].map((g) => [g, { pass: true }])), sha256: {}, tris: 10, budget_tris: 100 };
check('validate: a minimal true manifest has no violation', validate('x', manifest, { commit: false }).length === 0, validate('x', manifest, { commit: false }).join('; '));
check('validate: a false gate, a wrong id and an over-budget tris are each reported',
  validate('x', { ...manifest, gates: { ...manifest.gates, scale: { pass: false } } }, { commit: false }).some((e) => /scale is not pass/.test(e))
  && validate('y', manifest, { commit: false }).some((e) => /not the folder name/.test(e))
  && validate('x', { ...manifest, tris: 101 }, { commit: false }).some((e) => /over budget/.test(e)));
check('validate: a gate a same-class peer carries is required, and a missing file listed in sha256 is reported',
  validate('x', { ...manifest, class: 'a' }, { commit: false, peers: [{ class: 'a', gates: { ...manifest.gates, extra: { pass: true } } }] }).some((e) => /gate extra is missing/.test(e))
  && validate('x', { ...manifest, sha256: { 'nope.png': '0'.repeat(64) } }, { commit: false }).some((e) => /missing/.test(e)));

// ---- each gate, run as a program, still runs
const run = (file, summary) => { const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', file)], { cwd: ROOT, encoding: 'utf8' }); return { ok: r.status === 0 && summary.test(r.stdout), tail: (r.stdout + r.stderr).trim().split('\n').slice(-2).join(' | ') }; };
const art = run('check-art.mjs', /\d+ asset folders, [\d.]+ MB committed under ArtSource, 0 violation/);
check('check-art.mjs run directly still runs the gate and prints its summary', art.ok, art.tail);
const bp = run('check-bplink.mjs', /check-bplink: \d+ passed, 0 failed/);
check('check-bplink.mjs run directly still runs the gate and prints its summary', bp.ok, bp.tail);

console.log(`\ncheck-gate-helpers: ${passed} passed, ${failed} failed`);
finished = true;
process.exit(failed ? 1 : 0);
