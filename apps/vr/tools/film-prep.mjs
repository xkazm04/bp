// Prepares the headset for one take of the demo film (docs/concepts/demo-video/dry-run.md): stops the app, optionally
// clears its data so the take is a true first run (the first tour from the blank table), writes the app's saved settings
// with the music bed off (the film gets its own cue in the edit), and starts the app again.
//
//   node apps/vr/tools/film-prep.mjs [--first-run] [--music <0..2>] [--voice <0..2>] [--no-start]
//
// --first-run   pm clear: no tour progress, no pairing, no answers kept (every first-run take starts the same)
// --music       bp.MusicLevel to save (default 0: off; 1 is the app's 100 %)
// --voice       bp.VoiceLevel to save (default: leave as it is; 1 is 100 %)
// The settings live in Saved/BpTable.json (BpStore.cpp: { "<section>": { "<key>": "<value>" } }); this merges into the
// file on the headset when there is one, so a pairing or a choice made earlier stays unless --first-run.
// Needs adb and exactly one authorised headset. Exit 0 ready, 1 a step failed, 2 refused.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PKG = 'com.developersblueprint.vr';
const ACTIVITY = `${PKG}/com.epicgames.unreal.GameActivity`;
const SAVED = `/sdcard/Android/data/${PKG}/files/UnrealGame/bp/bp/Saved`;
const STORE = `${SAVED}/BpTable.json`;
const AUDIO = '/Script/bp.BpAudio';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const level = (k) => {
  const v = opt(k);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 2) { console.log(`REFUSED: ${k} ${v} is not 0..2`); process.exit(2); }
  return n.toFixed(2);
};
const music = level('--music') ?? '0.00';
const voice = level('--voice');
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const devices = adb('devices').split('\n').slice(1).filter((l) => l.trim());
const ready = devices.filter((l) => /\tdevice$/.test(l.trim()));
if (ready.length !== 1) { console.log(`REFUSED: ${ready.length} authorised headsets (${devices.map((l) => l.trim()).join('; ') || 'none'}); one is needed`); process.exit(2); }

adb('shell', 'am', 'force-stop', PKG);
console.log('stopped the app');
if (argv.includes('--first-run')) {
  adb('shell', 'pm', 'clear', PKG);
  console.log('cleared its data: the take is a first run (the first tour starts on the blank table)');
}

let store = {};
const tmp = path.join(os.tmpdir(), `bp-film-prep-${process.pid}.json`);
try {
  adb('pull', STORE, tmp);
  store = JSON.parse(fs.readFileSync(tmp, 'utf8'));
} catch { /* no saved file yet: a fresh one */ }
store[AUDIO] = { ...(store[AUDIO] ?? {}), MusicLevel: music, ...(voice !== undefined ? { VoiceLevel: voice } : {}) };
fs.writeFileSync(tmp, JSON.stringify(store, null, '\t') + '\n');
adb('shell', 'mkdir', '-p', SAVED);
adb('push', tmp, STORE);
fs.rmSync(tmp, { force: true });
console.log(`saved: music ${Math.round(Number(music) * 100)} %${voice !== undefined ? `, voice ${Math.round(Number(voice) * 100)} %` : ''}`);

if (!argv.includes('--no-start')) {
  adb('shell', 'am', 'start', '-n', ACTIVITY);
  console.log('started the app: put the headset on (a boundary dialog holds the start until it is confirmed)');
}
