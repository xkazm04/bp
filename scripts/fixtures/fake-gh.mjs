#!/usr/bin/env node
// A `gh` stand-in for demos (BP_GH_BIN=scripts/fixtures/fake-gh.mjs): `gh api user --jq .login` answers `morning-demo`, so
// a decision taken in a demo is signed `user:morning-demo` and never asks GitHub who the operator is. Anything else exits 1
// with a line saying it is a stand-in: no release, PR or auth step can pass through it by accident.
const a = process.argv.slice(2);
if (a[0] === 'api' && a[1] === 'user') { process.stdout.write('morning-demo\n'); process.exit(0); }
process.stderr.write(`fake-gh: a demo stand-in; "gh ${a.join(' ')}" is not served\n`);
process.exit(1);
