#!/usr/bin/env node
// The tether route (docs/concepts/vr-light-table/run-locally.md, "Over the cable"): a wired Quest reaches the PC's apps/server
// through `adb reverse`, with no LAN pairing and no manifest change. The APK's default BpLink URL is http://127.0.0.1:3100, and
// on the headset that port is the PC's once the reverse stands. UE's Android HTTP is libcurl over native sockets, so Android's
// cleartext switch, which only the Java network stack honours, does not apply (read in the engine, 2026-11-09: HTTP.Build.cs
// links libcurl for the Android group, and AndroidPlatformHttp.cpp makes FCurlHttpManager and FCurlHttpRequest; the manifest UE
// writes already holds INTERNET, ACCESS_NETWORK_STATE and ACCESS_WIFI_STATE). This script does the reverse and prints the state.
// It changes nothing else: start the server yourself. The app needs no relaunch: BpLink asks /api/health every 5 s while it
// shows the sample and moves to the live link when the PC answers (table link v2, night two W2a).
//
//   node apps/vr/tools/quest-tether.mjs [--port 3100] [--remove]
//
// Exit 0 tethered and the server answered, 1 tethered but the server did not, 2 refused (no adb, or no single device).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const port = (() => { const i = args.indexOf('--port'); return i >= 0 ? Number(args[i + 1]) : 3100; })();
const ADB = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean).map((d) => path.join(d, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')).find((p) => fs.existsSync(p)) ?? 'adb';
const adb = (...a) => { const r = spawnSync(ADB, a, { encoding: 'utf8' }); return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }; };

const devices = adb('devices');
if (!devices.ok) { console.log(`REFUSED: ${ADB} did not run (${devices.out || 'not found'}); install the platform-tools (apps/vr/tools/setup-android.ps1)`); process.exit(2); }
const attached = devices.out.split(/\r?\n/).slice(1).filter((l) => /\tdevice$/.test(l));
if (attached.length !== 1) { console.log(`REFUSED: ${attached.length} authorized devices attached; connect exactly one Quest by USB and allow debugging\n${devices.out}`); process.exit(2); }
console.log(`device  ${attached[0].split('\t')[0]}`);

if (args.includes('--remove')) {
  const r = adb('reverse', '--remove', `tcp:${port}`);
  console.log(`reverse removed: ${r.ok ? 'yes' : r.out}`);
  process.exit(r.ok ? 0 : 2);
}

const reverse = adb('reverse', `tcp:${port}`, `tcp:${port}`);
if (!reverse.ok) { console.log(`REFUSED: adb reverse failed: ${reverse.out}`); process.exit(2); }
console.log(`reverse ${adb('reverse', '--list').out || '(none listed)'}`);

const url = `http://127.0.0.1:${port}/api/products/kettle/structure`;
const server = await fetch(url, { signal: AbortSignal.timeout(4000) }).then((r) => r.status).catch(() => 0);
console.log(server === 200 ? `server  ${url} answered 200` : `server  ${url} did not answer (${server || 'no connection'}): start \`npm run server\` on this PC`);
console.log('next    relaunch the app: adb shell am force-stop com.developersblueprint.vr, then start it from the headset (it reads the product once, at launch)');
console.log(`logs    adb logcat -d -s UE | findstr BpLink  (Development APK; a Shipping APK compiles the logs out: see run-locally.md for the wrist's words)`);
process.exit(server === 200 ? 0 : 1);
