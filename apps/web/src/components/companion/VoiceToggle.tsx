'use client';
// The companion's one voice control, shown by the host for every skin: Glim's global mute, and the place where a line
// the browser refused to start waits to be played. Each status has its own glyph and sentence, so a muted voice, a
// voice that is speaking and a voice that cannot speak never look alike (voice.ts holds the state).
import { useEffect, useSyncExternalStore } from 'react';
import { pressVoice, probeVoice, voice, voiceStatus, type VoiceStatus } from './voice';

const LABEL: Record<VoiceStatus, string> = {
  on: 'Voice on',
  speaking: 'Speaking',
  blocked: 'Play reply',
  off: 'Voice off',
  unavailable: 'No voice',
};
const TITLE: Record<VoiceStatus, string> = {
  on: "Glim reads its replies aloud. Click to mute.",
  speaking: 'Glim is speaking. Click to stop.',
  blocked: 'The browser held back the reply until you click. Click to hear it.',
  off: 'Glim is muted. Click to hear its replies.',
  unavailable: '',
};

function Glyph({ s }: { s: VoiceStatus }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      {s === 'off' && <path d="M11 6l3.5 4M14.5 6L11 10" stroke="currentColor" strokeWidth="1.3" />}
      {s === 'unavailable' && <path d="M1.5 14.5l13-13" stroke="currentColor" strokeWidth="1.3" />}
      {(s === 'on' || s === 'speaking' || s === 'blocked') && <path className="cp-v1" d="M10.5 6.2a2.5 2.5 0 0 1 0 3.6" fill="none" stroke="currentColor" strokeWidth="1.3" />}
      {(s === 'on' || s === 'speaking') && <path className="cp-v2" d="M12.3 4.4a5 5 0 0 1 0 7.2" fill="none" stroke="currentColor" strokeWidth="1.3" />}
    </svg>
  );
}

/** `compact`: the glyph alone (a skin that sets it beside the lamp); the status still reads in its name and tooltip. */
export function VoiceToggle({ compact = false }: { compact?: boolean }) {
  const v = useSyncExternalStore(voice.subscribe, voice.get, voice.get);
  useEffect(() => { void probeVoice(); }, []);
  const s = voiceStatus(v);
  const title = s === 'unavailable' ? `Glim cannot speak: ${v.reason}. Click to turn the voice off.` : TITLE[s];
  return (
    <button type="button" className={'cp-voice s-' + s + (compact ? ' cp-voice-c' : '')} onClick={() => void pressVoice()} aria-label={title} title={title} aria-pressed={v.on}>
      <Glyph s={s} />
      {!compact && <span>{LABEL[s]}</span>}
    </button>
  );
}
