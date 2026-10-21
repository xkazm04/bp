#!/usr/bin/env node
// Gate: every STRUCTURAL selector token in scripts/fidelity/roles*.json still exists in apps/web/src.
//
// roles*.json is a hand-written map from a named design role ("item-title", "pack-row") to one CSS selector
// per side, and it is the only thing tying the fidelity contract to the ledger's markup. When a `data-role`
// is renamed or a class dropped, the port's selector matches nothing and the contest instrument reports the
// role as `missing` - which scripts/fidelity/README.md's own rule asks a human to triage as "real (fix the
// port) or structural (fix the selector)". So a stale selector arrives looking like a design deviation. And
// it can only arrive at all from `contract.py check --port 3321`, which needs `npx next dev` running: there
// was no way to learn offline that the map had rotted.
//
// STRUCTURAL vs DATA, decided by the attribute and not by a list: `data-role` values and class names are
// markup this repo writes, so they must resolve. `data-fid` and `data-pack` values are row ids out of a live
// product's scan store (Athena's `p-271316`, `k-des-1`) and are not in the source at all, so they are
// counted and reported, never failed. Everything is matched against tracked apps/web/src sources only.
// Run: node scripts/check-fidelity-roles.mjs   (plain node, no deps; exit 1 on any unresolved token)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FID = path.join(ROOT, 'scripts/fidelity');
const MIN_TOKENS = 100;   // floor: below this the role files or the scan stopped matching
const DATA_ATTRS = new Set(['fid', 'pack']);   // row ids from a live store, not markup this repo writes

const files = execFileSync('git', ['ls-files', 'apps/web/src'], { cwd: ROOT, encoding: 'utf8' })
  .split(/\r?\n/).filter((f) => /\.(tsx?|css)$/.test(f));
let src = '';
for (const f of files) src += fs.readFileSync(path.join(ROOT, f), 'utf8');

/** The tokens one selector names: [{ kind, attr, value }]. */
function tokensOf(sel) {
  const out = [];
  for (const m of sel.matchAll(/\[data-([\w-]+)=([^\]]+)\]/g)) out.push({ kind: 'attr', attr: m[1], value: m[2].replace(/^["']|["']$/g, '') });
  for (const m of sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.push({ kind: 'class', attr: '', value: m[1] });
  return out;
}

const roleFiles = fs.readdirSync(FID).filter((f) => /^roles.*\.json$/.test(f)).sort();
let structural = 0, data = 0;
const bad = [];
for (const rf of roleFiles) {
  const spec = JSON.parse(fs.readFileSync(path.join(FID, rf), 'utf8')).roles;
  for (const [role, v] of Object.entries(spec)) {
    if (!v.port) continue;
    for (const t of tokensOf(v.port)) {
      if (t.kind === 'attr' && DATA_ATTRS.has(t.attr)) { data++; continue; }
      structural++;
      if (!src.includes(t.value)) bad.push(`scripts/fidelity/${rf}  role '${role}'  ${t.kind === 'class' ? '.' + t.value : `[data-${t.attr}=${t.value}]`} is in no tracked apps/web/src source (renamed or dropped: fix the selector)`);
    }
  }
}

// ------------------------------------------------------------------ controls: the scan must still bite
const ctl = [];
const probe = (sel) => tokensOf(sel).filter((t) => !(t.kind === 'attr' && DATA_ATTRS.has(t.attr))).filter((t) => !src.includes(t.value));
ctl.push(['a renamed data-role is caught', probe('[data-role=tr-row-no-such-role] span').length === 1]);
ctl.push(['a dropped class is caught', probe('.tr-no-such-class').length === 1]);
ctl.push(['a live data id is not failed', probe('[data-fid="p-271316"]').length === 0 && probe('[data-pack=k-des-1]').length === 0]);
ctl.push(['a real selector passes', probe('[data-role=tr-row] [data-role=tr-row-title] > span').length === 0]);
if (!roleFiles.length) ctl.push(['no roles*.json found in scripts/fidelity', false]);
if (structural < MIN_TOKENS) ctl.push([`${structural} structural tokens read, expected at least ${MIN_TOKENS}`, false]);

const ctlBad = ctl.filter(([, ok]) => !ok);
for (const [what] of ctlBad) console.log(`FAIL  control: ${what}`);
for (const b of bad) console.log('FAIL  ' + b);
console.log(bad.length || ctlBad.length
  ? `check-fidelity-roles: ${bad.length} unresolved token(s), ${ctlBad.length} of ${ctl.length} controls failed`
  : `check-fidelity-roles: ${structural} structural selector tokens in ${roleFiles.length} role files all resolve in apps/web/src (${data} live-store ids not checked); ${ctl.length} controls held`);
process.exit(bad.length || ctlBad.length ? 1 : 0);
