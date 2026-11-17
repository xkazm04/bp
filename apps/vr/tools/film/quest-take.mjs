// One unattended take of the demo film on the headset (docs/concepts/demo-video/dry-run.md): the Quest lies on the desk
// with its proximity sensor held closed, the Development build is driven over the console (am broadcast RUN), and the
// headset records its own eye buffers (adb shell screenrecord, 3664x1920, both eyes side by side, no audio) while the
// app's log is captured with device timestamps. The take's folder gets the video segments and take.json: every tour step,
// every voice clip Glim played (BpVoice: plays, with the clean WAV it maps to) and every command sent, in seconds from the
// first segment's start, so the composer (compose.mjs) places picture and voice by the app's own clock.
//
//   node apps/vr/tools/film/quest-take.mjs [--script spine] [--name <take>] [--keep-data] [--max <s>] [--dry]
//
// --script     a driver in SCRIPTS below (default spine: the first tour from the blank table to the hand-off)
// --keep-data  no pm clear (a returning person; the first tour will not run again)
// --max        stop after this many seconds whatever happens (default 330)
// Needs the Development APK (Shipping has no console) and one authorised headset. Output: apps/vr/Saved/demo/takes/<name>/.
// Exit 0 a take recorded, 1 a step failed (what was recorded is kept), 2 refused.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VR = path.resolve(HERE, '..', '..');
const VOICE = path.join(VR, 'Content', 'BpData', 'voice');
const PKG = 'com.developersblueprint.vr';
const ACTIVITY = `${PKG}/com.epicgames.unreal.GameActivity`;
const SAVED = `/sdcard/Android/data/${PKG}/files/UnrealGame/bp/bp/Saved`;
const DEV_DIR = '/sdcard/Movies/bp-take';

// A driver: each step waits for its log line (after the previous step), then its delay, then sends its commands.
// Commands are console lines; 'stop' ends the take. The hands are the synthetic hand (BpHands.Tap): it points, pinches and
// releases on camera, as a person's would.
const BENCH = 'BpView.Bench -15';
const lastMatch = (seen, re) => { for (let i = seen.length - 1; i >= 0; i--) { const m = re.exec(seen[i]); if (m) return m[1]; } return null; };
const SCRIPTS = {
  spine: [
    // Seated as soon as the table seats itself, at the pitch that frames the wall's sheet and the table together (-15).
    { on: /BpView: seat headset/, delay: 0.3, cmds: [BENCH] },
    { on: /BpTour: start the first tour/, delay: 0.3, cmds: [BENCH] },
    // The controls are pressed directly (BpConsole.Tap, BpLevel.Enter, BpStandup.Act): the synthetic hand (BpHands.Tap)
    // only acts with no headset on, and prox_close makes the resting headset count as worn.
    // Cue-locked (the cue's sync points, dry-run.md: ADD 23.4, SCAN 68.6, APPROVE 113.8): the take keeps the cue's spacing
    // from ADD on, so the edit lays it on the music at speed 1 with one offset. `mark` names a send's time; `after` waits
    // until that mark + s (never before the step's own line and delay).
    { on: /BpTour: step add-project/, delay: 6.0, mark: 'add', cmds: ['BpConsole.Tap console:add:tutorial'] },
    // The wing Glim highlights (the most urgent room's), read from the log; late enough that scan-first's idle (14 s) has
    // not run out when the scan is pressed.
    { on: /BpTour: step look-wing/, delay: 4.0, after: ['add', 30.7], cmds: [(seen) => `BpLevel.Enter ${lastMatch(seen, /BpLevel: highlight wing=(\S+)/) ?? '0:OPS'}`] },
    // SCAN arms, then starts as the cue's beat returns: the start lands on add + 45.2.
    { on: /BpTour: step scan-first/, delay: 4.5, after: ['add', 43.9], mark: 'scan', cmds: ['BpConsole.Tap console:scan:this', 1.3, 'BpConsole.Tap console:scan:this'] },
    // The card is read through the cue's peak and its breath; APPROVE on the final peak's downbeat: scan + 45.2 + 1.3.
    { on: /BpTour: step standup/, delay: 6.0, after: ['scan', 46.5], cmds: ['BpStandup.Act approve'] },
    { on: /BpTour: step talk/, delay: 5.0, cmds: ['BpTalk.Hold 1.5'] },
    { on: /BpTour: the first tour ends/, delay: 4.0, cmds: ['stop'] },
  ],
  // The table at rest, seated, 20 s (a plate for the hook or the end).
  rest: [
    { on: /BpTour: start the first tour|BpTable: plan/, delay: 0.5, cmds: ['BpTour.Stop', BENCH] },
    { on: null, delay: 20, cmds: ['stop'] },
  ],
};

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

/** The take's log lines (logcat -v epoch) as Glim's voice clips and the story's events, in s from t0 (device epoch). */
function timeline(logLines, t0) {
  const clipFile = (id) => {
    for (const d of fs.readdirSync(VOICE)) {
      const f = path.join(VOICE, d, `${id}.wav`);
      if (fs.existsSync(f)) return path.relative(path.resolve(VR, '..', '..'), f).replace(/\\/g, '/');
    }
    return null;
  };
  const events = [];
  const voice = [];
  for (const raw of logLines) {
    const m = /^\s*(\d+\.\d+)\s.*?LogBp\w+: (Bp[A-Z]\w*: .*?)\s*$/.exec(raw);
    if (!m) continue;
    const t = Number(m[1]) - t0;
    const text = m[2];
    const v = /^BpVoice: plays (\S+) \(([\d.]+) s\)/.exec(text);
    if (v) voice.push({ t: +t.toFixed(3), clip: v[1], dur: Number(v[2]), file: clipFile(v[1]) });
    if (/^BpTour: (step|start|the first tour|shown)|^BpVoice|^BpBuild: |^BpScan|^BpStandup: (answer|approve)|^BpTalk: (hold|released|sample)|^BpLevel/.test(text)) events.push({ t: +t.toFixed(3), text: text.slice(0, 200) });
  }
  return { voice, events };
}

// --reparse <take dir>: rebuild take.json's voice and events from its saved logcat.txt (no headset needed).
if (argv.includes('--reparse')) {
  const dir = path.resolve(opt('--reparse'));
  const take = JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8'));
  const t0 = take.segments?.[0]?.startEpoch ?? 0;
  Object.assign(take, timeline(fs.readFileSync(path.join(dir, 'logcat.txt'), 'utf8').split('\n'), t0));
  fs.writeFileSync(path.join(dir, 'take.json'), JSON.stringify(take, null, 2) + '\n');
  console.log(`reparsed ${dir}: ${take.voice.length} voice clip(s), ${take.events.length} events`);
  process.exit(0);
}
const scriptName = opt('--script', 'spine');
const script = SCRIPTS[scriptName];
if (!script) { console.log(`REFUSED: no script ${scriptName} (${Object.keys(SCRIPTS).join(', ')})`); process.exit(2); }
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const name = opt('--name', `${scriptName}-${stamp}`);
const maxS = Number(opt('--max', '330'));
const out = path.join(VR, 'Saved', 'demo', 'takes', name);

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sh = (cmd) => adb('shell', cmd);
const run = (cmd) => adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.RUN', '-e', 'cmd', `'${cmd}'`);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const log = (m) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}] ${m}`);
const T0 = Date.now();

const devices = adb('devices').split('\n').slice(1).filter((l) => /\tdevice\s*$/.test(l));
if (devices.length !== 1) { console.log(`REFUSED: ${devices.length} authorised headsets; one is needed`); process.exit(2); }
if (argv.includes('--dry')) { console.log(`would record ${scriptName} into ${out}`); process.exit(0); }
fs.mkdirSync(out, { recursive: true });

// ---- the stage: awake, no boundary dialog, a fresh first run, the music bed off, the microphone granted
sh('am broadcast -a com.oculus.vrpowermanager.prox_close');
sh('setprop debug.oculus.guardian_pause 1');
sh(`am force-stop ${PKG}`);
if (!argv.includes('--keep-data')) sh(`pm clear ${PKG}`);
try { sh(`pm grant ${PKG} android.permission.RECORD_AUDIO`); } catch { /* granted already or not grantable */ }
const store = { '/Script/bp.BpAudio': { MusicLevel: '0.00' } };
const tmp = path.join(out, 'BpTable.json');
if (argv.includes('--keep-data')) { try { adb('pull', `${SAVED}/BpTable.json`, tmp); Object.assign(store, JSON.parse(fs.readFileSync(tmp, 'utf8'))); store['/Script/bp.BpAudio'] = { ...(store['/Script/bp.BpAudio'] ?? {}), MusicLevel: '0.00' }; } catch { /* none */ } }
fs.writeFileSync(tmp, JSON.stringify(store, null, '\t') + '\n');
sh(`mkdir -p ${SAVED}`);
adb('push', tmp, `${SAVED}/BpTable.json`);
log(`stage ready (${argv.includes('--keep-data') ? 'data kept' : 'first run'}, music off, microphone granted)`);

// ---- the recorder on the headset: 170 s segments (screenrecord stops at 180), each one's start in segs.txt
// Each screenrecord's PID goes to rec.pid, so the stop interrupts only the recorder this take started.
const rec = [
  `rm -rf ${DEV_DIR}; mkdir -p ${DEV_DIR}; i=0`,
  `while [ ! -f ${DEV_DIR}/stop ]; do`,
  `  i=$((i+1)); echo "$i $(date +%s.%N)" >> ${DEV_DIR}/segs.txt`,
  `  screenrecord --time-limit 170 --size 3664x1920 --bit-rate 40000000 ${DEV_DIR}/seg_$i.mp4 & echo $! > ${DEV_DIR}/rec.pid; wait $!`,
  `done`,
].join('\n');
fs.writeFileSync(path.join(out, 'rec.sh'), rec + '\n');
adb('push', path.join(out, 'rec.sh'), '/sdcard/Movies/bp-rec.sh');
adb('logcat', '-c');
const logFile = path.join(out, 'logcat.txt');
const logStream = fs.createWriteStream(logFile);
const cat = spawn('adb', ['logcat', '-v', 'epoch'], { stdio: ['ignore', 'pipe', 'ignore'] });
const lines = [];
let buf = '';
cat.stdout.on('data', (d) => {
  logStream.write(d);
  buf += d.toString('utf8');
  const parts = buf.split('\n');
  buf = parts.pop();
  for (const l of parts) if (/Bp[A-Z]\w+:/.test(l)) lines.push(l);
});
spawn('adb', ['shell', 'nohup sh /sdcard/Movies/bp-rec.sh > /dev/null 2>&1 &'], { stdio: 'ignore' }).unref();
await sleep(1.5);
sh(`am start -n ${ACTIVITY}`);
log('recording; the app started');

// ---- the driver
const sent = [];
const marks = {};
let seen = 0;
const waitFor = async (re, limitS) => {
  const until = Date.now() + limitS * 1000;
  while (Date.now() < until) {
    for (; seen < lines.length; seen++) if (!re || re.test(lines[seen])) { seen++; return true; }
    await sleep(0.2);
  }
  return false;
};
let code = 0;
const deadline = T0 + maxS * 1000;
try {
  outer: for (const step of script) {
    const left = (deadline - Date.now()) / 1000;
    if (left <= 0) { log('the take ran out of time'); code = 1; break; }
    if (step.on && !(await waitFor(step.on, left))) { log(`never saw ${step.on}`); code = 1; break; }
    await sleep(step.delay);
    if (step.after) {
      const at = marks[step.after[0]];
      if (at !== undefined) { const wait = at + step.after[1] * 1000 - Date.now(); if (wait > 0) await sleep(wait / 1000); else log(`late by ${(-wait / 1000).toFixed(1)} s for ${step.after[0]} + ${step.after[1]}`); }
    }
    if (step.mark) marks[step.mark] = Date.now();
    for (const each of step.cmds) {
      if (typeof each === 'number') { await sleep(each); continue; }
      const c = typeof each === 'function' ? each(lines) : each;
      if (c === 'stop') break outer;
      sh('am broadcast -a com.oculus.vrpowermanager.prox_close');
      run(c);
      const devNow = Number(sh('date +%s.%N').trim());
      sent.push({ epoch: devNow, cmd: c });
      log(`sent ${c}`);
    }
  }
} catch (e) {
  log(`driver failed: ${String(e.message).split('\n')[0]}`);
  code = 1;
} finally {
  // ---- stop (SIGINT lets screenrecord finish its file), pull, and time everything from the first segment's start
  try { sh(`touch ${DEV_DIR}/stop; kill -INT $(cat ${DEV_DIR}/rec.pid)`); } catch (e) { log(`stop: ${String(e.message).split('\n')[0]}`); }
  await sleep(3);
  cat.kill();
  logStream.end();
  let segsText = '';
  try { segsText = sh(`cat ${DEV_DIR}/segs.txt`); } catch { log('no segments were recorded'); }
  const segs = segsText.trim().split('\n').filter(Boolean).map((l) => { const [i, t] = l.trim().split(/\s+/); return { i: Number(i), epoch: Number(t) }; });
  const files = [];
  for (const s of segs) {
    const local = path.join(out, `seg_${s.i}.mp4`);
    try { adb('pull', `${DEV_DIR}/seg_${s.i}.mp4`, local); } catch { continue; }
    let dur = 0;
    try { dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', local], { encoding: 'utf8' }).trim()); } catch { /* unreadable */ }
    if (dur > 0.5) files.push({ file: path.relative(path.resolve(VR, '..', '..'), local).replace(/\\/g, '/'), startEpoch: s.epoch, duration: dur });
  }
  const t0 = files.length ? files[0].startEpoch : 0;
  const { voice, events } = timeline(lines, t0);
  const take ={ name, script: scriptName, recordedAt: new Date().toISOString(), segments: files, sent: sent.map((s) => ({ t: +(s.epoch - t0).toFixed(3), cmd: s.cmd })), voice, events };
  fs.writeFileSync(path.join(out, 'take.json'), JSON.stringify(take, null, 2) + '\n');
  sh(`rm -rf ${DEV_DIR} /sdcard/Movies/bp-rec.sh`);
  sh('setprop debug.oculus.guardian_pause 0');
  log(`take ${name}: ${files.length} segment(s), ${files.reduce((a, f) => a + f.duration, 0).toFixed(1)} s, ${voice.length} voice clip(s), ${events.length} events -> ${out}`);
  process.exit(code);
}
