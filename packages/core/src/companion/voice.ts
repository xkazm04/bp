// The companion's voice: what Glim says aloud and how it sounds. Pure and import-free, so the server route
// (server/companion/voice.server.ts), the page (apps/web/src/components/companion/voice.ts) and
// scripts/check-companion-web.ts share one definition.
// The voice was cast on 2026-10-27: "Vintage Tin", an ElevenLabs Voice Design voice, read by eleven_v3 at Robust stability
// with a fixed seed, then a light robot effect applied on the page (VOICE_FX). The owner picked it over steadier setups
// for being playful; a fixed seed keeps a repeated line the same, and the effect is identical on every line.
// VOICE_DESIGN records how the voice was made; scripts/voice-rebuild.ts rebuilds it from that (docs/voice/glim.md).

/** The ElevenLabs voice and the request settings every line is synthesized with. Changing any of them changes the cache key. */
export const VOICE = {
  voiceId: 'SVlo1tpEuzf5ilPRxsRZ',
  modelId: 'eleven_v3',
  settings: { stability: 1.0, similarity_boost: 0.8 },
  seed: 4242,
  format: 'mp3_44100_128',
} as const;

/** How the voice was made, so it can be rebuilt where `VOICE.voiceId` does not resolve (another ElevenLabs account, a lost
 *  library voice, a new designer generation). Kept out of VOICE on purpose: VOICE is the cache key, this is provenance.
 *  The clips in `docs/voice/glim/` are the approved sound, rendered with exactly VOICE and no effect; the rebuild and
 *  acceptance procedure is docs/voice/glim.md. */
export const VOICE_DESIGN = {
  name: 'Vintage Tin',
  designedOn: '2026-10-27',
  /** POST /v1/text-to-voice/design; the design call returns 3 previews, preview 0 was saved via POST /v1/text-to-voice. */
  modelId: 'eleven_ttv_v3',
  description:
    'A retro 1950s tin-can male robot, nasal buzzy metallic resonance, choppy staccato syllables, charming and slightly clunky, studio quality.',
  text: "Hello, I'm Glim, your blueprint companion. I scanned your three projects and found two decisions waiting for your call.",
  guidanceScale: 6,
  seed: 7,
  preview: 0,
  /** Reference clips, relative to the repo root. `design` is the designer's own preview read of `text`, not a VOICE read. */
  reference: [
    { file: 'docs/voice/glim/design.mp3', text: null },
    { file: 'docs/voice/glim/morning.mp3', text: 'Good morning. The nightly scan finished across all four projects. Coverage is up six percent.' },
    { file: 'docs/voice/glim/decision.mp3', text: 'Heads up: the ledger and the canvas engine number versions differently. I drafted both fixes. Which one wins?' },
    { file: 'docs/voice/glim/warning.mp3', text: 'Careful. That push would skip the quality gate, and two checks are still red. Want to see them first?' },
    { file: 'docs/voice/glim/wrap.mp3', text: "Wave three is composed and every check is green. Nice work. I'll keep watch and ping you if anything moves." },
  ],
} as const;

/** The longest line spoken, in characters (about 20 s of speech); a longer reply is cut at a sentence end before it. */
export const VOICE_MAX_CHARS = 320;

/** The robot effect, applied by the page's Web Audio graph: a high-pass, a presence lift, a short two-tap metallic echo
 *  and a slow tremolo (the casting test's ffmpeg chain, `highpass=f=110,equalizer=f=2400:t=q:w=1.2:g=3,
 *  aecho=0.85:0.8:7|13:0.35|0.25,tremolo=f=55:d=0.22`). */
export const VOICE_FX = {
  highpassHz: 110,
  presence: { hz: 2400, q: 1.2, gainDb: 3 },
  echo: { inGain: 0.85, outGain: 0.8, taps: [{ ms: 7, gain: 0.35 }, { ms: 13, gain: 0.25 }] },
  tremolo: { hz: 55, depth: 0.22 },
} as const;

/** The text of a reply as it should be spoken: markdown, code and links reduced to their words, whitespace collapsed,
 *  and cut to VOICE_MAX_CHARS at the last sentence end that fits (else the last word that fits). '' : nothing to say. */
export function speakable(text: string, max = VOICE_MAX_CHARS): string {
  const t = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]*?\S)\1/g, '$2')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  if (end > max / 3) return head.slice(0, end + 1);
  const sp = head.lastIndexOf(' ');
  return (sp > 0 ? head.slice(0, sp) : head.slice(0, max)).replace(/[,;:]$/, '') + '…';
}

/** The page's voice preference as stored ('on' | 'off'); anything else, including nothing stored, reads as the default.
 *  The default is on: the owner chose the first impression over a quiet first run (2026-10-27). A browser still plays
 *  nothing before the person's first gesture, and the page only speaks replies to turns the person sent. */
export const VOICE_DEFAULT_ON = true;
export const readVoicePref = (raw: string | null | undefined): boolean => (raw === 'on' ? true : raw === 'off' ? false : VOICE_DEFAULT_ON);
