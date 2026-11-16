#!/usr/bin/env node
// Neutral words for the public sample in the competition APK (docs/concepts/vr-light-table/compliance.md, P4; owner
// 2026-11-04: "lets reword them"). The rules forbid brand names and recognisable products in the project, and Kettle's
// sample names real platforms (sign-in providers, wallets, frameworks, a phone, a browser, local payment schemes). The
// web's sample (packages/core/data) keeps its words; only what bundle-data.mjs writes for the headset is reworded, and
// ids are reworded the same way in every file, so the plan, the scan and the briefs still point at each other.
//
//   node apps/vr/tools/bundle-words.mjs --apply [--product kettle]   reword a bundle already on disk, in place
//   node apps/vr/tools/bundle-words.mjs --check [--product kettle]   exit 1 when a brand is left (check:vr-bundle)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** [from, to], applied in order: the longer phrases first, so a sentence is reworded whole before its parts are. */
export const NEUTRAL = [
  ['Membership card in Apple and Google Wallet', "Membership card in the phone's wallet"],
  ['Sign in with Apple, required for the iOS app store', 'Platform sign-in, required by the mobile app store'],
  ['Sign in with a Google account', 'Sign in with a social account'],
  ['Google sign-in', 'Social sign-in'],
  ['Apple sign-in', 'Platform sign-in'],
  ['google-sign-in', 'social-sign-in'],
  ['apple-sign-in', 'platform-sign-in'],
  ['React Native, iOS + Android', 'cross-platform mobile'],
  ['iOS and Android app', 'Mobile app'],
  ['(Next.js, TypeScript)', '(TypeScript)'],
  [' (Next.js)', ''],
  ['Pixel 7 emulator', 'phone emulator'],
  ['Chrome 1600x1000', 'desktop browser 1600x1000'],
  ['QR Platba (SPD) code', 'bank QR payment code'],
  ['Multibanco entity', 'bank-transfer entity'],
  ['framer motion', 'motion'],
];

/** Brand and product names that must not reach the headset's sample (whole words, any case). */
export const BRANDS = /\b(google|apple|ios|pixel|chrome|safari|next\.js|react native|multibanco|platba|stripe|paypal|mailchimp|twilio|whatsapp|instagram|facebook|firebase|sendgrid|framer|klarna|revolut|mastercard)\b/i;

export const neutralize = (text) => NEUTRAL.reduce((t, [from, to]) => t.split(from).join(to), text);

/** Each brand hit in a text: up to 40 characters around it, for the failure line. */
export function brandHits(text) {
  const hits = [];
  const re = new RegExp(BRANDS.source, 'gi');
  for (let m; (m = re.exec(text)) && hits.length < 20;) hits.push(text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).replace(/\s+/g, ' '));
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--product');
  const slug = i >= 0 ? args[i + 1] : 'kettle';
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'Content', 'BpData', slug);
  if (!fs.existsSync(dir)) { console.log(`REFUSED: no bundle at ${dir}`); process.exit(2); }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (args.includes('--apply')) {
    for (const f of files) {
      const p = path.join(dir, f), was = fs.readFileSync(p, 'utf8'), now = neutralize(was);
      if (now !== was) { fs.writeFileSync(p, now); console.log(`reworded ${f}`); }
    }
  }
  let left = 0;
  for (const f of files) {
    for (const h of brandHits(fs.readFileSync(path.join(dir, f), 'utf8'))) { left++; console.log(`FAIL ${slug}/${f}: ...${h}...`); }
  }
  console.log(`check:vr-bundle ${slug}: ${files.length} files, ${left} brand name(s) left`);
  process.exit(left ? 1 : 0);
}
