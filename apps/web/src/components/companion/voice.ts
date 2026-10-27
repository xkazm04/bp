// Glim's voice on the page: the one arbiter every spoken line goes through (at most one line audible; a new line replaces
// the one playing), the global mute (persisted as `bp.companion.voice`, absolute: nothing plays while it is off) and the
// robot effect (VOICE_FX as a Web Audio graph, identical on every line). The line's audio comes from
// POST /api/companion/voice. Voice is an overlay: a failed or refused line leaves the lamp and its caption as they are.
// State is a tiny external store the toggle (VoiceToggle.tsx) subscribes to. Only `voiceStatus` and `fxGain` are pure.
import { readVoicePref, speakable, VOICE_FX } from '@bp/core/companion/voice';

export const VOICE_URL = '/api/companion/voice';
const PREF_KEY = 'bp.companion.voice';

/** on: will speak; speaking: a line is playing; blocked: the browser refused to start audio before a gesture (the toggle
 *  plays the waiting line); unavailable: the server has no voice (`reason` says why); off: muted by the person. */
export type VoiceStatus = 'off' | 'on' | 'speaking' | 'blocked' | 'unavailable';
export interface VoiceState { on: boolean; playing: boolean; blocked: boolean; reason: string | null }

export const voiceStatus = (s: VoiceState): VoiceStatus =>
  !s.on ? 'off' : s.reason ? 'unavailable' : s.playing ? 'speaking' : s.blocked ? 'blocked' : 'on';

/** The tremolo's gain at time t (seconds): 1 - depth/2 + depth/2 * sin(2 pi f t), as ffmpeg's tremolo shapes it. */
export const fxGain = (t: number, fx = VOICE_FX.tremolo): number => 1 - fx.depth / 2 + (fx.depth / 2) * Math.sin(2 * Math.PI * fx.hz * t);

let state: VoiceState = { on: readPref(), playing: false, blocked: false, reason: null };
const subs = new Set<() => void>();
const set = (p: Partial<VoiceState>) => { state = { ...state, ...p }; for (const fn of [...subs]) fn(); };

function readPref(): boolean {
  try { return readVoicePref(typeof localStorage === 'undefined' ? null : localStorage.getItem(PREF_KEY)); } catch { return readVoicePref(null); }
}

export const voice = {
  get: (): VoiceState => state,
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; },
};

let ctx: AudioContext | null = null, input: AudioNode | null = null;
let current: AudioBufferSourceNode | null = null, waiting: AudioBuffer | null = null, seq = 0, aborter: AbortController | null = null;

/** The effect graph, built once per AudioContext: source -> high-pass -> presence -> (dry + two echo taps) -> tremolo -> out. */
function graph(c: AudioContext): AudioNode {
  const hp = new BiquadFilterNode(c, { type: 'highpass', frequency: VOICE_FX.highpassHz });
  const pr = new BiquadFilterNode(c, { type: 'peaking', frequency: VOICE_FX.presence.hz, Q: VOICE_FX.presence.q, gain: VOICE_FX.presence.gainDb });
  const pre = new GainNode(c, { gain: VOICE_FX.echo.inGain }), mix = new GainNode(c, { gain: VOICE_FX.echo.outGain });
  hp.connect(pr).connect(pre);
  pre.connect(mix);
  for (const tap of VOICE_FX.echo.taps) pre.connect(new DelayNode(c, { delayTime: tap.ms / 1000 })).connect(new GainNode(c, { gain: tap.gain })).connect(mix);
  // tremolo: a gain held at 1 - depth/2 and swung by an oscillator of amplitude depth/2 (fxGain)
  const trem = new GainNode(c, { gain: 1 - VOICE_FX.tremolo.depth / 2 });
  const lfo = new OscillatorNode(c, { frequency: VOICE_FX.tremolo.hz });
  lfo.connect(new GainNode(c, { gain: VOICE_FX.tremolo.depth / 2 })).connect(trem.gain);
  lfo.start();
  mix.connect(trem).connect(c.destination);
  return hp;
}

function play(buf: AudioBuffer) {
  if (!ctx || !input) return;
  current?.stop();
  const src = new AudioBufferSourceNode(ctx, { buffer: buf });
  src.connect(input);
  src.onended = () => { if (current === src) { current = null; set({ playing: false }); } };
  current = src; waiting = null;
  src.start();
  set({ playing: true, blocked: false });
}

/** Say a reply aloud (it is made `speakable` here). Replaces whatever is playing; does nothing while muted or unavailable. */
export async function speak(text: string): Promise<void> {
  const line = speakable(text);
  if (!line || !state.on || state.reason) return;
  const n = ++seq;
  aborter?.abort(); aborter = new AbortController();
  stopAudio();
  let bytes: ArrayBuffer;
  try {
    const res = await fetch(VOICE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: line }), signal: aborter.signal });
    if (res.status === 503) { set({ reason: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'no voice configured' }); return; }
    if (!res.ok) return; // one line failed: the caption still carries it
    bytes = await res.arrayBuffer();
  } catch { return; }
  if (n !== seq || !state.on) return;
  try {
    ctx ??= new AudioContext();
    input ??= graph(ctx);
    const buf = await ctx.decodeAudioData(bytes);
    if (n !== seq || !state.on) return;
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') { waiting = buf; set({ blocked: true }); return; }
    play(buf);
  } catch { /* undecodable audio: stay silent */ }
}

function stopAudio() {
  if (current) { const c = current; current = null; c.stop(); }
  waiting = null;
  if (state.playing || state.blocked) set({ playing: false, blocked: false });
}

/** Stop the line playing or loading (the host's teardown, a stopped turn). */
export function hush() { seq++; aborter?.abort(); stopAudio(); }

/** The toggle's press: a line waiting for a gesture plays; a line playing stops; otherwise the mute flips (and is kept). */
export async function pressVoice(): Promise<void> {
  if (state.on && waiting && ctx) {
    const buf = waiting;
    await ctx.resume().catch(() => {});
    if (ctx.state === 'running') { play(buf); return; }
  }
  if (state.on && state.playing) { hush(); return; }
  const on = !state.on;
  if (!on) hush();
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* the choice lasts for this visit */ }
  set({ on });
  if (on) void ctx?.resume().catch(() => {}); // this press is a gesture: unlock audio for the next line
}

/** Ask the server once whether a voice is configured, so an unconfigured voice shows its reason before any line. */
export async function probeVoice(): Promise<void> {
  try {
    const r = (await (await fetch(VOICE_URL)).json()) as { available?: boolean; reason?: string };
    set({ reason: r.available === false ? r.reason ?? 'no voice configured' : null });
  } catch { /* the server is down: the stream says so; a line will try again */ }
}
