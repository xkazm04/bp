#!/usr/bin/env node
// Usage: node scripts/fixtures/kettle-finding-shots.mjs --check          (npm run check:finding-shots; calls no generator)
//        node scripts/fixtures/kettle-finding-shots.mjs --generate [id..] (all eight, or the named ones; calls Codex)
// The Kettle sample's generated "before" screens: one PNG per finding in FINDING_SHOTS (packages/core/src/model/train-sim.ts),
// apps/web/public/sample-shots/finding-<id>.png, made through the Codex CLI's built-in image generation (owner, 2026-11-09:
// "For Kettle example create screenshots through Codex CLI image generation"). Each image is a believable screen of the
// fictional Kettle studio app showing the problem its finding describes. The manifest beside this script
// (kettle-finding-shots.manifest.json) records per image the proposal id, the exact prompt sent, the tool, the model when
// Codex reports one, the date, the bytes and the sha256 of the committed file.
// Generated images are not reproducible byte for byte, so --check does not regenerate: it verifies that every FINDING_SHOTS id
// has a manifest entry and a file whose bytes and sha256 match it, that each file is a PNG of at most 1280x720 and under
// 400 KB (the VR bundle carries them), that the manifest's prompts are the prompts this script would send now (an edited
// prompt must be regenerated), that every id is an open finding of kettle.findings.json, and that no stray finding-*.png sits
// in the folder; and that the VR bundle (apps/vr/tools/bundle-data.mjs) holds the same eight files under
// apps/vr/Content/BpData/kettle/shots/ and the same eight rows in its scan.json.
// How --generate calls Codex (codex-cli 0.166.0): `codex exec --skip-git-repo-check -s read-only --json -C <tmp> <prompt>`
// with stdin closed; the first JSONL event carries the thread id, and the image tool saves the picture under
// ~/.codex/generated_images/<thread id>/*.png. The newest PNG there is resized to 1280x720 and palette-compressed with sharp
// (a transitive dependency through next, as scripts/art uses it). Look at every image before committing it: the hard rules
// are no real brand names, logos or trademarks, no faces or identifiable people, no real personal data.
// Selection (how the eight were picked, reproducible): the open findings (status proposed or approved) of
// packages/core/data/kettle.findings.json in the ledger's order (packages/core/src/scan/score.ts: tier first - Kettle's
// findings carry none - then byWorth over worthOf/estValue, ties by created_at then id). From the top of that order, the
// first finding per lens whose problem shows on a screen, plus a second design one (the lens most about screens):
// kf-011 (rank 1, design), kf-053 (3, security), kf-020 (4, design), kf-045 (12, quality), kf-052 (13, cost), kf-024 (15,
// operations), kf-055 (24, performance), kf-041 (27, business). Skipped as not visible on a screen: test coverage, CORS,
// dependency and flaky-test findings (ranks 5-11); kf-056 names a real brand's sign-in and is never drawn.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FINDING_SHOTS, findingShotFile } from '../../packages/core/src/model/train-sim.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'apps/web/public/sample-shots');
const MANIFEST = path.join(ROOT, 'scripts/fixtures/kettle-finding-shots.manifest.json');
const FINDINGS = path.join(ROOT, 'packages/core/data/kettle.findings.json');
const VR_BUNDLE = path.join(ROOT, 'apps/vr/Content/BpData/kettle');
const W = 1280, H = 720, MAX_BYTES = 400 * 1024;

// One fictional app, one look: every prompt opens with this.
const STYLE = [
  'Generate one image with your image generation tool. Do not run any shell commands and do not write any files; reply with the single word done.',
  'The image: a flat, crisp desktop web app UI screenshot, 16:9 landscape, no browser chrome, no device frame, no perspective, no people.',
  'The app is "Kettle", fictional software for a small fitness and yoga studio called "Riverside studio". Consistent design system:',
  'a white top bar with the plain text wordmark "Kettle" at the left (text only, no logo mark) and "Riverside studio" at the right;',
  'a light grey left navigation column with the items Schedule, Members, Payments, Check-in, Reports;',
  'page background #f4f5f7, white cards with 1 px #d9dde3 borders and 10 px corner radius, dark slate text #1c2230, muted grey #5b6475,',
  'one blue accent #2f6fde for primary buttons and links, red #d4483f only for errors; a clean geometric sans-serif typeface, large readable text.',
  'In the top right corner of the content area, a small outlined orange stamp reading "SAMPLE SCREEN".',
  'Hard rules: no real company, product or brand names, no logos or trademarks, no faces, photos or illustrations of people',
  '(any person appears only as a round badge with two initials), no real personal data (member numbers like M-1042 instead of names, no email addresses or phone numbers).',
  'Keep every visible word short and spelled exactly as given here.',
].join(' ');

/** What each finding's screen shows: the problem, plainly, at the size a triage thumbnail is read. */
const SCENES = {
  'kf-011': 'Screen: Payments > "Paper invoices", the upload-to-payment flow. A scanned invoice preview card on the left; on the right the extracted fields '
    + '(Supplier, Amount, Due date) are half-rendered: the Amount field shows the literal text "NaN", the Due date field shows "undefined", and the '
    + '"Match to payment" button is greyed out with no reason. A slim red bar at the bottom of the page reads "3 errors in console". Field labels are very small, faint grey text.',
  'kf-053': 'Screen: Reports > "Payout reconciliation", a table with columns Date, Payout, Amount, Status, Note. Rows show amounts like 412.00 and 1,280.50 and '
    + 'status chips "Matched" in green. In one row the Note cell is broken: raw markup leaks into the page, the cell shows the literal text '
    + '<b onmouseover=alert(1)>refund</b> and a large bold red word "PAID" injected over the neighbouring cells, breaking the table layout. Highlight that row with a thin red outline.',
  'kf-020': 'Screen: Payments > "Bank debit", a page meant to list direct-debit mandates. The main card has the header "Mandates" and a table header '
    + '(Member, Mandate, Status, Next collection) but no rows and no explanation: the body is blank white except the raw text "null" in grey monospace '
    + 'in the top left and a spinner that never resolves. A side card titled "Last collection" shows "Error: 500" in plain grey text with no action button.',
  'kf-045': 'Screen: the member checkout for "10-class pack", price 120.00. A promo code field contains "SPRING20" and a green check with the text '
    + '"Code applied", yet the order summary below still shows Subtotal 120.00, Discount 0.00, Total 120.00. A blue "Pay 120.00" button. '
    + 'The mismatch between "Code applied" and the unchanged total is the point: make both easy to read.',
  'kf-052': 'Screen: Reports > "SMS reminders". A large card with a progress bar at 40% and the text "Building report... 47 s" and a note '
    + '"Rebuilt on every open". Beside it a small cost card: "SMS provider calls this month" with the big number "18,420" and a grey sparkline climbing steeply, '
    + 'and the line "Estimated 2,840 USD / month". A list of reminder rows below is greyed out behind a loading shimmer.',
  'kf-024': 'Screen: a sign-in page of Kettle, centered card, title "Sign in with a link". The card shows the message "Check your inbox: we sent you a sign-in link" '
    + 'with a "Resend link" button and the small line "Sent 14 minutes ago". On the right side a small status panel titled "System status" shows '
    + 'green dots and "All systems operational", while a red note under the card reads "No sign-in emails delivered since 09:12". No email address is shown.',
  'kf-055': 'Screen: Members > "Class packs & credits", a long scrolling grid of pack cards (5-class pack, 10-class pack, 20-class pack, Intro week) with prices. '
    + 'The grid is caught mid-scroll and visibly janky: the lower half of the cards are blank grey placeholder tiles, one row is duplicated and offset, '
    + 'and a small dark performance overlay in the bottom right reads "Frame p95 21.7 ms" with a red bar above a dashed line labelled "16.7 ms budget".',
  'kf-041': 'Screen: "Instructor mode" setup wizard. A top stepper reads "Step 1 of 9" with nine small numbered circles, only the first filled. '
    + 'The page asks for many fields before anything useful: Display name, Bio, Certifications, Payout details, Tax form, Availability, Room preferences. '
    + 'A blue "Next" button and a grey "Save draft" link at the bottom. A small grey hint at the top right: "About 25 minutes to finish".',
};

const promptOf = (id) => STYLE + '\n\n' + SCENES[id];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const readManifest = () => (fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null);

/** A PNG's width and height from its IHDR, or null when it is not a PNG. */
function pngSize(b) {
  const SIG = '89504e470d0a1a0a';
  if (b.length < 24 || b.subarray(0, 8).toString('hex') !== SIG || b.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function check() {
  const fails = [], ok = (cond, msg) => { if (!cond) fails.push(msg); return cond; };
  const m = readManifest();
  if (!ok(m && Array.isArray(m.images), `${rel(MANIFEST)} is missing or has no images[]`)) return report(fails, 0);
  const findings = JSON.parse(fs.readFileSync(FINDINGS, 'utf8')), byId = new Map(findings.map((p) => [p.id, p]));
  ok(new Set(FINDING_SHOTS).size === FINDING_SHOTS.length && FINDING_SHOTS.length === 8, `FINDING_SHOTS holds ${FINDING_SHOTS.length} distinct ids, the sample carries 8`);
  ok(Object.keys(SCENES).sort().join() === [...FINDING_SHOTS].sort().join(), 'SCENES and FINDING_SHOTS name the same ids');
  ok(m.images.length === FINDING_SHOTS.length, `the manifest has ${m.images.length} images for ${FINDING_SHOTS.length} ids`);
  let held = 0;
  for (const id of FINDING_SHOTS) {
    const e = m.images.find((x) => x.proposal_id === id), p = byId.get(id), file = path.join(DIR, findingShotFile(id));
    ok(p && (p.status === 'proposed' || p.status === 'approved'), `${id} is not an open finding of ${rel(FINDINGS)} (${p?.status ?? 'absent'})`);
    if (!ok(e, `${id}: no manifest entry`)) continue;
    ok(e.file === findingShotFile(id), `${id}: manifest file ${e.file} is not ${findingShotFile(id)}`);
    ok(e.prompt === promptOf(id), `${id}: the manifest's prompt is not the one this script sends now; regenerate it (--generate ${id})`);
    ok(typeof e.tool === 'string' && e.tool.length > 0 && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.date), `${id}: tool or date missing`);
    if (!ok(fs.existsSync(file), `${id}: ${rel(file)} is missing`)) continue;
    const b = fs.readFileSync(file), s = pngSize(b);
    ok(b.length === e.bytes, `${id}: ${b.length} bytes on disk, the manifest says ${e.bytes}`);
    ok(sha(b) === e.sha256, `${id}: sha256 differs from the manifest`);
    ok(s && s.w <= W && s.h <= H && s.w > 0 && s.h > 0, `${id}: not a PNG of at most ${W}x${H} (${s ? s.w + 'x' + s.h : 'no PNG header'})`);
    ok(b.length < MAX_BYTES, `${id}: ${b.length} bytes, over the ${MAX_BYTES} limit`);
    held++;
  }
  const stray = fs.readdirSync(DIR).filter((f) => /^finding-.*\.png$/.test(f) && !FINDING_SHOTS.some((id) => findingShotFile(id) === f));
  ok(!stray.length, `stray files in ${rel(DIR)}: ${stray.join(', ')}`);
  // the VR bundle (apps/vr/tools/bundle-data.mjs): the same eight files under kettle/shots/ and the same rows in scan.json
  const scanRows = fs.existsSync(path.join(VR_BUNDLE, 'scan.json')) ? (JSON.parse(fs.readFileSync(path.join(VR_BUNDLE, 'scan.json'), 'utf8')).shots ?? []).filter((s) => s.harness_module === 'generated-sample') : [];
  ok(scanRows.length === FINDING_SHOTS.length && FINDING_SHOTS.every((id) => scanRows.some((s) => s.proposal_id === id && s.phase === 'before' && s.path === findingShotFile(id))),
    `${rel(VR_BUNDLE)}/scan.json carries ${scanRows.length} generated before rows, not one per finding shot; rerun node apps/vr/tools/bundle-data.mjs`);
  const vrShots = path.join(VR_BUNDLE, 'shots'), vrFiles = fs.existsSync(vrShots) ? fs.readdirSync(vrShots) : [];
  ok(vrFiles.length === FINDING_SHOTS.length && FINDING_SHOTS.every((id) => {
    const a = path.join(vrShots, findingShotFile(id)), b = path.join(DIR, findingShotFile(id));
    return fs.existsSync(a) && fs.existsSync(b) && sha(fs.readFileSync(a)) === sha(fs.readFileSync(b));
  }), `${rel(vrShots)} does not hold exactly the eight web files (${vrFiles.length} files); rerun node apps/vr/tools/bundle-data.mjs`);
  return report(fails, held);
}

function report(fails, held) {
  for (const f of fails) console.log('FAIL  ' + f);
  console.log(`RESULT ${fails.length ? 'FAIL' : 'PASS'}: ${held} of ${FINDING_SHOTS.length} finding shots match the manifest${fails.length ? `, ${fails.length} problem(s)` : ''}`);
  process.exit(fails.length ? 1 : 0);
}

async function generate(ids) {
  const { default: sharp } = await import('sharp');
  // one command string through the shell: codex is an npm shim (codex.cmd) on Windows, and its arguments are fixed words
  const version = spawnSync('codex --version', { encoding: 'utf8', shell: true }).stdout.trim();
  const m = readManifest() ?? { images: [] };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-finding-shots-'));
  for (const id of ids) {
    if (!SCENES[id]) throw new Error(`no scene for ${id}`);
    const prompt = promptOf(id);
    console.log(`${id}: asking Codex...`);
    // the prompt goes through stdin ('-'): it holds quotes and angle brackets a Windows shell would mangle
    const r = spawnSync(`codex exec --skip-git-repo-check -s read-only --json -C "${work}" -`,
      { input: prompt, encoding: 'utf8', shell: true, timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
    const events = (r.stdout ?? '').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const thread = events.find((e) => e.type === 'thread.started')?.thread_id;
    const model = events.map((e) => e.model ?? e.item?.model).find(Boolean) ?? null;
    const dir = thread && path.join(os.homedir(), '.codex', 'generated_images', thread);
    const pngs = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs) : [];
    if (!pngs.length) {
      console.log(`FAIL  ${id}: Codex saved no image (exit ${r.status}${r.error ? ', ' + r.error.message : ''})`);
      console.log((r.stderr ?? '').split(/\r?\n/).slice(-8).join('\n'));
      process.exitCode = 1;
      continue;
    }
    const src = fs.readFileSync(pngs[0]), meta = await sharp(src).metadata();
    const out = await sharp(src).resize(W, H, { fit: 'cover', position: 'centre' }).png({ palette: true, colours: 192, quality: 90, effort: 10, compressionLevel: 9 }).toBuffer();
    if (out.length >= MAX_BYTES) { console.log(`FAIL  ${id}: ${out.length} bytes after compression`); process.exitCode = 1; continue; }
    const file = path.join(DIR, findingShotFile(id));
    fs.writeFileSync(file, out);
    const entry = { proposal_id: id, file: findingShotFile(id), prompt, tool: `${version} exec, built-in image_generation`, model: model ?? 'not reported by codex exec',
      thread_id: thread, date: new Date().toISOString().slice(0, 10), source_size: `${meta.width}x${meta.height}`, size: `${W}x${H}`, bytes: out.length, sha256: sha(out) };
    const at = m.images.findIndex((x) => x.proposal_id === id);
    if (at < 0) m.images.push(entry); else m.images[at] = entry;
    console.log(`${id}: ${rel(file)} ${out.length} bytes (from ${meta.width}x${meta.height}, ${rel(pngs[0])})`);
  }
  m.images.sort((a, b) => FINDING_SHOTS.indexOf(a.proposal_id) - FINDING_SHOTS.indexOf(b.proposal_id));
  const out = {
    about: 'Generated "before" screens of eight Kettle findings (fictional product, sample data). Written by scripts/fixtures/kettle-finding-shots.mjs --generate; verified by --check (npm run check:finding-shots). Never hand-edit.',
    selection: 'Open findings (proposed or approved) of packages/core/data/kettle.findings.json in the ledger order (score.ts: tier first, none in Kettle; then byWorth over estValue; ties by created_at, id); per lens the first whose problem shows on a screen, plus a second design finding. See the script header for ranks.',
    rules: 'No real brand names, logos or trademarks; no faces or identifiable people (initials badges only); no real personal data. Each image was looked at before it was kept.',
    images: m.images,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(out, null, 2) + '\n');
  fs.rmSync(work, { recursive: true, force: true });
}

const argv = process.argv.slice(2);
if (argv.includes('--generate')) await generate(argv.filter((a) => !a.startsWith('--')).length ? argv.filter((a) => !a.startsWith('--')) : [...FINDING_SHOTS]);
else if (argv.includes('--check')) check();
else { console.log('usage: kettle-finding-shots.mjs --check | --generate [id..]'); process.exit(2); }
