// What each state of the crossing is, who draws it, what crosses the network, which build and which machine, with the
// standing of each claim. The marks follow the design report: `real` = runs today, `measured` = read on Lynx, `documented`
// = a vendor or spec says so, `unverified` = not yet seen on a Quest 3S or on ARM64, `new` = work this design proposes,
// `mock` = drawn by this web prototype only.
import type { StateId } from './timeline';
import type { CrossPlace, NextPlace } from './place';
import type { Exchange } from './baton';

export type Mark = 'real' | 'measured' | 'documented' | 'unverified' | 'new' | 'mock';
export interface Fact { k: 'see' | 'draw' | 'net' | 'build' | 'machine'; text: string; marks: Mark[] }
export interface StateFacts { title: string; facts: Fact[] }

export const KEY_LABEL: Record<Fact['k'], string> = { see: 'You see', draw: 'Drawn by', net: 'Network', build: 'Build', machine: 'Machine' };

export { placeWire } from './place';
import { placeWire } from './place';
export const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).length;

export interface Packet {
  at: number; dir: 'web→server' | 'APK→door→server' | 'server→web'; verb: string; note: string; mark: Mark;
  /** Estimated JSON size when the request did not run here. */
  size: number;
  /** When it ran against this server: the status and the bytes each way. */
  status?: number; up?: number; down?: number;
}

/** The crossing's wire on its clock; the requests that ran for real (`real`, from baton.ts) carry their status and bytes. */
export function packets(p: CrossPlace, n: NextPlace | null, F: number, live: number, off: number, real: readonly Exchange[] | null, paired = true, streamed: number | null = null): Packet[] {
  const ran = (step: Exchange['step']) => real?.find((x) => x.step === step);
  const pk = (at: number, dir: Packet['dir'], step: Exchange['step'] | null, verb: string, note: string, size: number): Packet => {
    const x = step ? ran(step) : undefined;
    return x ? { at, dir, verb, note, size, mark: 'real', status: x.status, up: x.up, down: x.down } : { at, dir, verb, note, size, mark: 'new' };
  };
  const nextTarget = n?.room ? { kind: 'room' as const, id: n.room.id } : p.target;
  const arm = pk(1.4, 'web→server', 'arm', 'POST /api/session/place', 'loopback · x-bp-human · arm', bytes({ place: placeWire(p, 'web') }));
  if (!paired) return [arm, { at: F, dir: 'APK→door→server', verb: 'no request', note: 'unpaired: the APK has no door to reach; the baton expires unclaimed after 120 s', size: 0, mark: 'documented' }];
  const out: Packet[] = [
    arm,
    pk(F + 0.8, 'APK→door→server', 'claim', 'GET /api/session/place?claim=1', 'via door :3101 · Bearer · scope place', 0),
    pk(F + 2.0, 'APK→door→server', 'live', 'POST /api/session/place', 'lift done · live · from vr', bytes({ place: placeWire(p, 'vr') })),
  ];
  if (n) {
    out.push(pk(live + 0.5, 'APK→door→server', 'lead', 'POST /api/session/place', 'table leads · ' + n.hash, bytes({ place: placeWire(p, 'vr', n.hash, n.level, nextTarget) })));
    const sz = bytes({ type: 'place', baton: { state: 'live', place: placeWire(p, 'vr', n.hash, n.level, nextTarget) } });
    out.push(streamed !== null
      ? { at: live + 0.6, dir: 'server→web', verb: 'companion stream · event place', note: 'the page flies there', size: sz, mark: 'real', down: streamed }
      : { at: live + 0.6, dir: 'server→web', verb: 'companion stream · event place', note: 'the page flies there', size: sz, mark: 'new' });
  }
  out.push(pk(off + 0.2, 'APK→door→server', 'return', 'POST /api/session/place/return', 'STOPPING → returned', 2));
  return out;
}

/** The unpaired ending (the judged build's behaviour), from FOCUSED on. */
function unpairedFacts(id: StateId): StateFacts | null {
  const open: StateFacts = { title: 'Unpaired: the APK opens its bundle at home', facts: [
    { k: 'see', text: 'No crossing. After the blackout: the studio and the bundled Kettle’s site plan, not the place you were in.', marks: ['documented'] },
    { k: 'draw', text: 'The APK, from the snapshot bundled in its pak (BpLink reads it with no server).', marks: ['measured'] },
    { k: 'net', text: 'Nothing. Without a paired door the APK cannot reach Lynx; the page’s armed baton is never claimed and expires after 120 s, with no error.', marks: ['new'] },
    { k: 'build', text: 'The same APK, unpaired: exactly what the judges get. Bundle mode gets no crossing.', marks: ['measured'] },
    { k: 'machine', text: 'Quest 3S alone. The APK has not run on a headset yet.', marks: ['unverified'] },
  ] };
  if (id === 'passthrough' || id === 'claimed' || id === 'lift' || id === 'fade') return open;
  if (id === 'arrived' || id === 'live') return { title: 'Unpaired: no live lamp, no place', facts: [
    { k: 'see', text: 'The lamp is there but not live: no server, so no conversation and no naming of your place.', marks: ['documented'] },
    { k: 'draw', text: 'The APK, bundle mode.', marks: ['measured'] },
    { k: 'net', text: 'Nothing; the page does not follow, there is nothing to follow.', marks: [] },
  ] };
  if (id === 'return') return { title: 'Headset off: the page is where you left it', facts: [
    { k: 'see', text: 'Your page, unchanged. The baton expired unclaimed.', marks: ['new'] },
    { k: 'draw', text: 'Chrome on Lynx.', marks: ['real'] },
  ] };
  return null;
}

export function factsFor(id: StateId, p: CrossPlace, n: NextPlace | null, paired = true): StateFacts {
  if (!paired) { const u = unpairedFacts(id); if (u) return u; }
  const at = p.hash || '#', where = p.crumbs.slice(1).join(' › ') || 'the site';
  const S: Record<StateId, StateFacts> = {
    desk: { title: 'At the desk: your page, where you are', facts: [
      { k: 'see', text: 'The bp page on your monitor at ' + where + ' (' + at + ').', marks: ['real'] },
      { k: 'draw', text: 'Chrome on Lynx: the canvas engine draws the plan; its place lives only in the URL hash.', marks: ['real'] },
      { k: 'net', text: 'Nothing. Today the server does not know where the page is looking.', marks: ['real'] },
      { k: 'machine', text: 'Lynx: Windows 11 on ARM64.', marks: ['real'] },
    ] },
    armed: { title: '“Take it to the table” arms a place baton', facts: [
      { k: 'see', text: 'The page says the baton is armed for 120 s. Nothing launches: putting the headset on is the launch.', marks: ['new'] },
      { k: 'draw', text: 'Chrome on Lynx.', marks: ['real'] },
      { k: 'net', text: 'POST /api/session/place on loopback with x-bp-human: one Place (below). The web starts publishing its place only here.', marks: ['new'] },
      { k: 'machine', text: 'Lynx: apps/server :3100 holds the baton (Node, native ARM64).', marks: ['new'] },
    ] },
    blackout: { title: 'The headset goes on: 3-5 s nothing can draw', facts: [
      { k: 'see', text: 'Black. The Quest system owns these seconds; no app pixels, so the design hides nothing here.', marks: ['documented'] },
      { k: 'draw', text: 'Nothing (Quest system).', marks: ['documented'] },
      { k: 'net', text: 'Nothing yet.', marks: [] },
      { k: 'build', text: 'The standalone APK com.developersblueprint.vr resumes when the person puts the headset on.', marks: ['unverified'] },
      { k: 'machine', text: 'Quest 3S. The APK builds on Lynx (284 MB, 33 min BuildCookRun); it has not run on a headset yet.', marks: ['measured', 'unverified'] },
    ] },
    passthrough: { title: 't 0.0 · the first frame is your own desk', facts: [
      { k: 'see', text: 'Your real desk and monitor through the headset’s cameras, with the bp page still on the monitor.', marks: ['documented', 'unverified'] },
      { k: 'draw', text: 'Quest 3S passthrough (the cameras, Meta’s compositor; UOculusXRPassthroughSubsystem). Not in this app yet.', marks: ['documented', 'unverified'] },
      { k: 'net', text: 'The APK asks the door for the baton.', marks: ['new'] },
      { k: 'build', text: 'Standalone APK, mobile tier (S4), no PC in the frame path.', marks: ['measured'] },
      { k: 'machine', text: 'Quest 3S (XR2 Gen 2). Whether the monitor reads through passthrough is open.', marks: ['unverified'] },
    ] },
    claimed: { title: 't 0.8 · the APK claims the place', facts: [
      { k: 'see', text: 'Still your desk. The place arrives as an address: ' + at + '.', marks: ['new'] },
      { k: 'draw', text: 'Passthrough.', marks: ['documented'] },
      { k: 'net', text: 'GET :3101 /api/session/place?claim=1 over home Wi-Fi: Bearer, scope “place”, constant-time refusal. armed → claimed by one device.', marks: ['new'] },
      { k: 'machine', text: 'Lynx: the S8 LAN door :3101 (owner D4 = yes) forwards in-process to :3100. Cleartext on the home LAN is S8’s recorded deviation.', marks: ['new'] },
    ] },
    lift: { title: 't 1.0 · the paper lifts off the monitor onto the desk', facts: [
      { k: 'see', text: 'A sheet of the plan peels off the pinned monitor and lands under your hands. Content moves; your view never does.', marks: ['new'] },
      { k: 'draw', text: 'The APK on the headset GPU, from the plan at the claimed place. It is NOT the page’s pixels: nothing is streamed, so the real page stays on the monitor behind it.', marks: ['new'] },
      { k: 'net', text: 'Nothing new. 0 video frames, 0 audio, ever.', marks: [] },
      { k: 'machine', text: 'Quest 3S. The monitor’s pose comes from a spatial anchor pinned once (two touches); anchors persist across sessions.', marks: ['documented', 'unverified'] },
    ] },
    fade: { title: 't 2.0 · the room fades to the studio; the paper is the table', facts: [
      { k: 'see', text: 'Your room dissolves into the night studio. The table sits where your desk is, at the tapped height (75 cm desk, eye 43 cm above).', marks: ['measured', 'new'] },
      { k: 'draw', text: 'The APK: studio and table at the mobile tier on XR2 Gen 2, far below the PC look-dev bar. Fade = BpSwitch’s smoothstep, 0.8 s.', marks: ['measured', 'unverified'] },
      { k: 'net', text: 'POST :3101 place · live (from vr) once the lift is done: the table leads now.', marks: ['new'] },
      { k: 'build', text: 'Same APK the judges get; unpaired it opens the bundled Kettle instead, with no crossing.', marks: ['measured'] },
    ] },
    arrived: { title: 't 2.7 · the lamp names the room you were in', facts: [
      { k: 'see', text: 'The lamp says “' + p.name + '”. Its caption is 40 arcmin, inside the comfortable band.', marks: ['new'] },
      { k: 'draw', text: 'The APK. The lamp keeps the desk’s conversation (the baton carries its id) over the door’s standup scope.', marks: ['new'] },
      { k: 'net', text: 'The companion stream, as today: one companion process serves both.', marks: ['real'] },
      { k: 'machine', text: 'Cards stay answerable only on bp’s web page (x-bp-human): the headset never answers one.', marks: ['real'] },
    ] },
    live: { title: 'The table leads; the page follows', facts: [
      { k: 'see', text: n ? 'You dive on the table to ' + n.name + '. A wrist peek cuts a passthrough window over the monitor: the page is already there.' : 'You move on the table; the page follows.', marks: ['new'] },
      { k: 'draw', text: 'The table: the APK. The page in the peek: Chrome on Lynx, seen through the cameras.', marks: ['new', 'unverified'] },
      { k: 'net', text: 'Every level change POSTs the place; the page hears it on the companion stream (event: place) and flies, with the same hash route a focus command uses. Running here: the page behind this overlay just did.', marks: ['new', 'real'] },
      { k: 'machine', text: 'Lynx (page, server) + Quest 3S (table). The lamp holds a decision waiting here; the headset cannot answer it (x-bp-human is bp’s page’s only), so the answer is a peek and a click on the desk.', marks: ['real'] },
    ] },
    return: { title: 'Headset off: a non-event', facts: [
      { k: 'see', text: 'Your page, already at ' + (n ? n.name : 'the table’s last place') + ', with a 10 s crumb: “the table left you at …”.', marks: ['new'] },
      { k: 'draw', text: 'Chrome on Lynx.', marks: ['real'] },
      { k: 'net', text: 'POST /return if the session reaches STOPPING (an OpenXR “should”); a missed one costs only the last move, because the page followed all along.', marks: ['documented', 'unverified'] },
      { k: 'machine', text: 'Lynx. The baton is returned; the web leads again.', marks: ['new'] },
    ] },
  };
  return S[id];
}
