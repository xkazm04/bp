#!/usr/bin/env node
// Look-dev stills from the owner's signed-in Leonardo WEB STUDIO (the studio credit pool), not the API pool
// (the API pool answered 402 "Insufficient tokens" on 2026-10-25). Ported from gravitone-gcloud
// lib/imaging/studio/{browser,driver,selectors}.ts and providers/leonardoStudio.ts.
//
//   node scripts/lookdev/leonardo-studio.mjs recon [--aspect 16:9]       read-only: every mutation aborted, nothing clicked
//   node scripts/lookdev/leonardo-studio.mjs gen --prompt-file f.txt --aspect 16:9 --out <file> [--ref <image>]
//        [--prop id --variant A | --state name --variant a] [--quality medium|low]
//   node scripts/lookdev/leonardo-studio.mjs delete --id <id> [--kind generation|init-image]
//   gen --dry stops before Generate (nothing spent, nothing logged; a --ref upload is still made and deleted)
//
// THE ONE RULE: the Chrome on the other end of CDP (--cdp, default http://127.0.0.1:9333, profile
// ~/.leonardo-chrome) is the OWNER'S browser. browser.close() is never called; the script opens one tab, closes only
// that tab, and never reads or touches any other tab. The generation is identified from the page's own `Generate`
// answer (generationId), never from "the first card".
//
// Every generation is deleted once its image is held, and so is the reference upload a --ref call made: through
// deleteById in leonardo.mjs, the one script that holds the API credential (check-leonardo 'siblings'). The REST delete
// removes a studio-made generation (measured in gravitone 2026-10-23, and here 2026-10-25). One JSON line per call goes
// to lookdev/log.jsonl with "provider": "leonardo-studio"; leonardo.mjs keeps those out of its API-pool night cap.
// The logged file is the basename plus a fileNote, as leonardo.mjs's loggedFile does for an uncommitted frame.
//
// Flags, not environment: --cdp <url|port> (default http://127.0.0.1:9333) and --playwright <dir> (a folder whose
// node_modules holds playwright; tried after bp's own, then the sibling ../gravitone-gcloud, 1.62.1 on 2026-10-25).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { deleteById } from './leonardo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOG = path.join(ROOT, 'docs/concepts/vr-light-table/lookdev/log.jsonl');
const MODEL_ID = 'openai/gpt-image-2.5-sunburst';
const MODEL_LABEL = /\bGPT Image 2\.5 Sunburst\b/i;
const GQL = 'https://api.leonardo.ai/v1/graphql';
const MAX_CREDITS = 25; // Sunburst SMALL/MEDIUM read 20 in gravitone; HIGH (71) or MEDIUM size (155) is refused
const DESTRUCTIVE = /delete|remove|trash|archive/i;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 && i + 1 < args.length ? args[i + 1] : dflt;
};

function loadPlaywright() {
  const roots = [ROOT, opt('playwright') && path.resolve(opt('playwright')), path.resolve(ROOT, '../gravitone-gcloud')].filter(Boolean);
  for (const r of roots) {
    try {
      return createRequire(path.join(r, 'package.json'))('playwright');
    } catch {}
  }
  throw new Error('playwright is not resolvable (bp, --playwright <dir>, ../gravitone-gcloud)');
}

function endpoint() {
  const v = String(opt('cdp', '')).trim() || 'http://127.0.0.1:9333';
  return /^\d+$/.test(v) ? `http://127.0.0.1:${v}` : v.replace(/\/+$/, '');
}

const imageUrl = (aspect, quality = 'medium') =>
  `https://app.leonardo.ai/generate?model=${encodeURIComponent(MODEL_ID)}&aspectRatio=${encodeURIComponent(aspect)}` +
  `&quantity=1&size=SMALL&quality=${quality === 'low' ? 'LOW' : 'MEDIUM'}&promptEnhance=OFF`;

function opsOf(req) {
  let body;
  try {
    body = req.postDataJSON();
  } catch {
    return [];
  }
  return (Array.isArray(body) ? body : [body]).flatMap((b) => {
    if (!b || typeof b !== 'object') return [];
    const q = typeof b.query === 'string' ? b.query : '';
    const head = /^\s*(query|mutation|subscription)\s*(\w+)?/.exec(q);
    return [{ name: typeof b.operationName === 'string' ? b.operationName : head?.[2] ?? '', mutation: head?.[1] === 'mutation' }];
  });
}

function walk(v, visit, depth = 0) {
  if (depth > 40 || !v || typeof v !== 'object') return;
  if (Array.isArray(v)) return v.forEach((x) => walk(x, visit, depth + 1));
  for (const [k, x] of Object.entries(v)) {
    visit(k, x, v);
    walk(x, visit, depth + 1);
  }
}

const balanceOf = (body) => {
  let sum;
  walk(body, (k, v) => {
    if (['subscriptionTokens', 'rolloverTokens', 'paidTokens'].includes(k) && Number.isFinite(Number(v))) sum = (sum ?? 0) + Number(v);
  });
  return sum;
};

async function attach() {
  const { chromium } = loadPlaywright();
  const ep = endpoint();
  try {
    const r = await fetch(`${ep}/json/version`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    throw new Error(`leonardo studio browser not reachable at ${ep}: ${e.message}`);
  }
  const browser = await chromium.connectOverCDP(ep, { timeout: 45000 });
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('studio browser has no profile context');
  const now = Date.now() / 1000;
  const cookies = await ctx.cookies('https://app.leonardo.ai');
  const signedIn = cookies.some(
    (c) => /better-auth\.session_token|session-token|CognitoIdentityServiceProvider\..*\.(idToken|refreshToken)$/i.test(c.name) && c.value && (c.expires <= 0 || c.expires > now),
  );
  return { browser, ctx, signedIn };
}

// The guard: destructive ops always aborted; in recon every mutation; in gen `Generate` once, after arm().
async function guard(page, mode) {
  const st = { armed: false, generated: false, blocked: [] };
  await page.route(`${GQL}**`, async (route) => {
    const ops = opsOf(route.request());
    const refuse = ops.find(
      (op) => DESTRUCTIVE.test(op.name) || (mode === 'recon' && (op.mutation || /^Generate$/.test(op.name))) || (/^Generate$/.test(op.name) && (!st.armed || st.generated)),
    );
    if (refuse) {
      st.blocked.push(refuse.name || '(unnamed mutation)');
      return route.abort('blockedbyclient').catch(() => {});
    }
    if (ops.some((op) => /^Generate$/.test(op.name))) st.generated = true;
    return route.continue().catch(() => {});
  });
  return st;
}

async function recon() {
  const { browser, ctx, signedIn } = await attach();
  void browser; // never closed: the owner's Chrome
  console.log(JSON.stringify({ signedIn }));
  if (!signedIn) return;
  const page = await ctx.newPage();
  const st = await guard(page, 'recon');
  const ops = [];
  let balance;
  page.on('request', (r) => r.url().startsWith(GQL) && opsOf(r).forEach((o) => ops.push(`${o.mutation ? 'mutation' : 'query'} ${o.name}`)));
  page.on('response', async (r) => {
    if (r.url().startsWith(GQL) && opsOf(r.request()).some((o) => /^GetTokens$/.test(o.name))) balance = balanceOf(await r.json().catch(() => null)) ?? balance;
  });
  try {
    await page.goto(imageUrl(opt('aspect', '16:9')), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(9000);
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const radios = [...document.querySelectorAll('[role=radio]')].filter(vis).map((e) => `${e.getAttribute('value')}|${e.getAttribute('aria-checked')}|${(e.textContent || '').trim().slice(0, 20)}`);
      const buttons = [...document.querySelectorAll('button')].filter(vis).map((b) => ((b.getAttribute('aria-label') || '') + ' :: ' + (b.textContent || '').trim()).slice(0, 80));
      const files = [...document.querySelectorAll('input[type=file]')].map((i) => `${i.accept}|${i.multiple}|${i.name || i.id}`);
      return { radios, buttons, files };
    });
    console.log(JSON.stringify({ url: page.url(), balance, ...info, ops: [...new Set(ops)], blocked: st.blocked }, null, 1));
  } finally {
    await page.unroute(`${GQL}**`).catch(() => {});
    await page.close().catch(() => {});
  }
}

function dims(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return {};
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return {};
}

async function gen() {
  const prompt = fs.readFileSync(opt('prompt-file'), 'utf8').trim();
  const aspect = opt('aspect', '16:9');
  const quality = opt('quality', 'medium');
  const out = path.resolve(opt('out'));
  const ref = opt('ref');
  const entry = {
    time: new Date().toISOString(),
    provider: 'leonardo-studio',
    ...(opt('prop') ? { prop: opt('prop') } : {}),
    ...(opt('state') ? { state: opt('state') } : {}),
    variant: opt('variant', 'a'),
    model: MODEL_ID,
    prompt,
    seed: null,
    quality: quality.toUpperCase(),
    aspect,
    ...(ref ? { reference: path.relative(ROOT, path.resolve(ref)).replace(/\\/g, '/') } : {}),
    generationId: null,
    status: 'ERROR',
    credits: null,
    creditsSource: 'studio-generate-receipt',
    file: null,
    urls: [],
    committed: false,
  };
  const { ctx, signedIn } = await attach();
  if (!signedIn) throw new Error('studio asks to sign in (no live session cookie) - STOP');
  const page = await ctx.newPage();
  const st = await guard(page, 'gen');
  let armedAt = 0;
  let receipt = null;
  let balance;
  const urls = new Set();
  const statuses = new Map();
  const refOps = [];
  const uploads = []; // GetViewerUploads rows: {id, createdAt} - the init image ids (UploadImage's uploadId is NOT one)
  const before = new Set();
  let uploadAt = 0;
  page.on('response', async (r) => {
    if (!r.url().startsWith(GQL)) return;
    const ops = opsOf(r.request());
    const body = await r.json().catch(() => null);
    if (ops.some((o) => /^GetTokens$/.test(o.name))) balance = balanceOf(body) ?? balance;
    const mut = ops.find((o) => o.mutation && !/^(Generate|LogSessionActivity)$/.test(o.name));
    if (mut) refOps.push({ op: mut.name });
    if (ops.some((o) => o.name === 'GetViewerUploads')) uploads.push(...(body?.data?.init_images ?? []).map((i) => ({ id: i.id, createdAt: i.createdAt })));
    if (armedAt && !receipt && ops.some((o) => /^Generate$/.test(o.name))) {
      let id, credits, err;
      walk(body, (k, v) => {
        if (k === 'generationId' && typeof v === 'string' && !id) id = v;
        if (k === 'cost' && v && typeof v === 'object' && credits === undefined && Number.isFinite(Number(v.amount))) credits = Number(v.amount);
      });
      for (const b of Array.isArray(body) ? body : [body]) if (b?.errors?.[0]?.message) err = b.errors[0].message;
      receipt = { id, credits, err, status: r.status() };
    }
    walk(body, (k, v, parent) => {
      if (typeof v === 'string' && v.startsWith('https://cdn.leonardo.ai/')) urls.add(v);
      if (k === 'status' && typeof v === 'string' && typeof parent.id === 'string') statuses.set(parent.id, v);
    });
  });
  let id;
  try {
    await page.goto(imageUrl(aspect, quality), { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (/\/(auth|login|sign-?in)\b/i.test(new URL(page.url()).pathname)) throw new Error('studio redirected to sign-in - STOP');
    const box = page.locator('textarea').filter({ visible: true }).first();
    await box.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2500);
    const model = page.locator("button:has-text('Model')").filter({ visible: true }).first();
    if (!(await model.count()) || !MODEL_LABEL.test(await model.innerText())) throw new Error('model control is not GPT Image 2.5 Sunburst');
    const click = async (sel) => {
      const l = page.locator(sel).filter({ visible: true }).first();
      if (!(await l.count())) return false;
      await l.click({ timeout: 5000 }).catch(() => l.evaluate((el) => el.click()));
      return true;
    };
    if (!(await setAspect(page, aspect, click))) throw new Error(`no ${aspect} aspect control`);
    if (!(await click("[role=radio][value='1'], button:text-is('1')"))) throw new Error('image-count control not found');
    if (ref) {
      await attachReference(page, path.resolve(ref), {
        snapshot: () => uploads.forEach((u) => before.add(u.id)),
        uploaded: () => refOps.some((o) => o.op === 'UploadImage'),
        mark: () => (uploadAt = Date.now()),
        trace: (t) => args.includes('--dry') && console.error(JSON.stringify(t)),
        cleared: (n) => (entry.referencesClearedBefore = n),
      });
    }
    await box.fill(prompt);
    const button = page.locator("button:has-text('Generate')").filter({ visible: true }).first();
    if (!(await button.count())) throw new Error('generate button not found');
    const label = await button.innerText();
    const price = Math.max(0, ...(label.match(/\d+/g) ?? []).map(Number));
    entry.priceLabel = label.replace(/\s+/g, ' ').trim();
    if (price > MAX_CREDITS) throw new Error(`studio priced this at ${price}; ceiling ${MAX_CREDITS}`);
    if (await button.isDisabled()) throw new Error('generate button disabled');
    if (args.includes('--dry')) throw new Error(`dry run: stopped before Generate (${entry.priceLabel})`);
    st.armed = true;
    armedAt = Date.now();
    await button.click({ timeout: 5000 });
    while (!receipt && Date.now() - armedAt < 60000) await page.waitForTimeout(250);
    if (!receipt) throw new Error('studio did not answer Generate');
    id = receipt.id;
    entry.generationId = id ?? null;
    entry.credits = receipt.credits ?? null;
    if (receipt.err || receipt.status >= 400 || !id) throw new Error(`Generate refused: ${receipt.err ?? 'HTTP ' + receipt.status}`);
    const want = new RegExp(`^https://cdn\\.leonardo\\.ai/[^\\s"']*/generations/${id}/[^\\s"']+\\.(?:jpe?g|png|webp)`, 'i');
    const deadline = Date.now() + 240000;
    let url;
    for (;;) {
      url = [...urls].find((u) => want.test(u));
      if (!url) url = (await page.$$eval('img', (is) => is.map((i) => i.src)).catch(() => [])).find((u) => want.test(u));
      if (url) break;
      const s = statuses.get(id) ?? '';
      if (/^(FAILED|NSFW)$/i.test(s)) throw new Error(`generation ${id} ended ${s}`);
      if (Date.now() > deadline) throw new Error(`generation ${id} not finished in 4 min`);
      await page.waitForTimeout(1000);
    }
    // Full resolution: the CDN original (strip any resize query the page added).
    const clean = url.split('?')[0];
    const r = await fetch(clean, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`download HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const ext = (/\.(png|jpe?g|webp)$/i.exec(clean)?.[1] ?? 'jpg').toLowerCase();
    const file = out.replace(/\.(png|jpe?g|webp)$/i, '') + '.' + ext;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    Object.assign(entry, dims(buf), { status: 'COMPLETE', file: path.basename(file), fileNote: 'not committed: downloaded outside the repo by leonardo-studio.mjs and recoverable from urls', urls: [clean], bytes: buf.length });
    console.error(`saved ${file}`);
  } catch (e) {
    entry.error = e.message;
  } finally {
    entry.balanceAfter = balance ?? null;
    if (ref) entry.referencesClearedAfter = await clearReferences(page).catch((e) => `failed: ${e.message}`);
    await page.unroute(`${GQL}**`).catch(() => {});
    await page.close().catch(() => {});
  }
  if (ref) {
    entry.referenceOps = refOps.map((o) => o.op);
    // Ours = an upload row the dialog did not list before our upload, created no earlier than 2 min before it.
    const initIds = [...new Set(uploads.filter((u) => !before.has(u.id) && uploadAt && Date.parse(u.createdAt + 'Z') > uploadAt - 120000).map((u) => u.id))];
    entry.referenceId = initIds[0] ?? null;
    entry.referenceCleanup = [];
    for (const iid of initIds) entry.referenceCleanup.push(`${iid}: ${await deleteById('init-image', iid)}`);
  }
  if (id) {
    entry.cleanup = await deleteById('generation', id, { verify: true });
    entry.cleanupVerified = entry.cleanup === 'deleted (verified gone)';
  }
  if (!args.includes('--dry')) fs.appendFileSync(LOG, JSON.stringify(entry) + '\n'); // a dry run is not a call
  const { prompt: _p, ...summary } = entry;
  console.log(JSON.stringify(summary));
  if (entry.status !== 'COMPLETE') process.exitCode = 1;
}

// Image reference (recon 2026-10-25): button[aria-label='Add reference to generation'] opens a menu whose
// "Image Reference" item opens a "Select Media" dialog with a multiple file input (png/jpg/webp <= 25 MB), a
// "N/16 selected" counter and Confirm. The upload must leave exactly 1 selected; anything else stops before spending.
// The hidden input's React handler is not always bound when the dialog first shows (2026-10-25: a set at ~0.5 s after
// open sent nothing, one at ~10 s uploaded), so wait for the dialog's lists to load, set once, and set again only if
// no UploadImage went out (a second set while the first is in flight uploads twice).
// The form's references PERSIST across tabs of the profile (2026-10-25: three from earlier dry runs reappeared in a
// fresh tab and raised the price 20 -> 29), so they are cleared before attaching and again before the tab closes,
// leaving the profile's form as it was found (it had none).
const REMOVE_REF = "button[aria-label^='Remove Image Reference']";
async function clearReferences(page) {
  for (let i = 0; i < 12; i++) {
    const b = page.locator(REMOVE_REF).filter({ visible: true }).first();
    if (!(await b.count())) return i;
    await b.click({ timeout: 5000 }).catch(() => b.evaluate((el) => el.click()));
    await page.waitForTimeout(600);
  }
  throw new Error('could not clear the form references');
}

async function attachReference(page, file, hooks) {
  hooks.cleared?.(await clearReferences(page));
  await page.locator("button[aria-label='Add reference to generation']").filter({ visible: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(800);
  await page.getByText('Image Reference', { exact: true }).filter({ visible: true }).first().click({ timeout: 8000 });
  const dialog = page.locator('[role=dialog]').filter({ hasText: 'Select Media' }).first();
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(8000);
  hooks.snapshot();
  hooks.mark();
  const input = dialog.locator('input[type=file]').first();
  for (let attempt = 0; attempt < 2 && !hooks.uploaded(); attempt++) {
    await input.setInputFiles(file);
    for (let i = 0; i < 15 && !hooks.uploaded(); i++) await page.waitForTimeout(1000);
  }
  if (!hooks.uploaded()) throw new Error('reference: no UploadImage after two sets of the file input');
  const t0 = Date.now();
  let txt = '';
  let closed = false;
  while (Date.now() - t0 < 60000) {
    if (!(await dialog.isVisible().catch(() => false))) {
      closed = true;
      break;
    }
    txt = await dialog.innerText().catch(() => '');
    if (/\b1\/16 selected/.test(txt)) break;
    await page.waitForTimeout(1000);
  }
  if (!closed) {
    if (!/\b1\/16 selected/.test(txt)) throw new Error(`reference upload did not leave exactly one selected (${/\d+\/16 selected/.exec(txt)?.[0] ?? '?'})`);
    // The dialog usually closes itself once the upload is selected; Confirm only if it is still open.
    for (let i = 0; i < 5 && (await dialog.isVisible().catch(() => false)); i++) await page.waitForTimeout(1000);
    if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: 'Confirm' }).click({ timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(2000);
  const n = await page.locator(REMOVE_REF).filter({ visible: true }).count();
  if (n !== 1) throw new Error(`expected exactly one image reference on the form, found ${n}`);
  hooks.trace?.(
    await page.evaluate(() => {
      const c = {};
      for (const b of document.querySelectorAll('button'))
        if (b.offsetWidth) {
          const k = (b.getAttribute('aria-label') || '') + '::' + (b.textContent || '').trim().slice(0, 30);
          c[k] = (c[k] || 0) + 1;
        }
      return { closed: true, buttons: Object.entries(c).filter(([, n]) => n === 1).map(([k]) => k) };
    }),
  );
}

// Aspect: 16:9, 1:1, 9:16 are radio cards; the wider presets sit under "Custom" (21:9 -> value 21:9-ultrawide-film,
// 1584x672 at SMALL, "Generate 21"). aspectRatio=21:9 in the URL is NOT honoured (the page fell back to 1:1).
const CUSTOM_ASPECT = { '21:9': '21:9-ultrawide-film', '4:3': '4:3-twitter', '4:5': '4:5-instagram' };
async function setAspect(page, aspect, click) {
  if (!CUSTOM_ASPECT[aspect]) return click(`[role=radio][value='${aspect}']`);
  await page.locator("button:has-text('Custom')").filter({ visible: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(800);
  await page.locator(`[role=radio][value='${CUSTOM_ASPECT[aspect]}']`).filter({ visible: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  return (await page.locator(`[role=radio][value='${CUSTOM_ASPECT[aspect]}']`).first().getAttribute('aria-checked')) === 'true';
}

const main = { recon, gen, delete: async () => console.log(await deleteById(opt('kind', 'generation'), opt('id'), { verify: true })) }[cmd];
if (!main) {
  console.error('usage: leonardo-studio.mjs recon | gen ... | delete --id <id>');
  process.exit(2);
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 200)); // drop the CDP socket without closing the owner's browser
