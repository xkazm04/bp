# Glim's voice: the design record and how to rebuild it

Glim speaks in "Vintage Tin", a voice made with ElevenLabs Voice Design on 2026-10-27. A designed voice exists only as a
library entry on the account that made it. This page and its record are what let us make the same voice again
somewhere else.

## Where everything lives

- **What every line is read with:** `VOICE` in `packages/core/src/companion/voice.ts` (voice id, model, settings, seed,
  format). It is also the cache key, so changing it re-synthesizes every cached line.
- **How the voice was made:** `VOICE_DESIGN` in the same file (designer model, description, design text, guidance,
  seed, which preview was kept). It is provenance only, so editing it changes no cached line.
- **The robot effect:** `VOICE_FX`, applied on the page. It is never baked into audio.
- **The approved sound:** `docs/voice/glim/`.
  - `design.mp3` is the designer's preview read of the design text.
  - `morning.mp3`, `decision.mp3`, `warning.mp3` and `wrap.mp3` are the four casting lines, read with exactly `VOICE`
    and no effect. Their texts are in `VOICE_DESIGN.reference`.
- **The tool:** `scripts/voice-rebuild.ts` runs every step below. It reads the key the way the server does and never
  prints it.

## Rebuilding

1. **Check first (free):** `node scripts/voice-rebuild.ts status`.
   - If the voice id resolves, nothing needs rebuilding.
   - If it doesn't, the key belongs to another account or the library voice was deleted.
2. **Clone from the clips (preferred):** `node scripts/voice-rebuild.ts clone`.
   - This makes an instant voice clone from the five reference clips. It is the closest match because it starts from
     the approved sound itself.
   - Cloning is fine here: the voice is synthetic and designed by the owner, so it is nobody's likeness.
   - It needs a plan that includes instant cloning.
3. **Or redesign from the record (fallback):** `node scripts/voice-rebuild.ts design`.
   - This reruns the design call with the recorded description, text, guidance and seed, and saves all three previews.
   - The designer is not guaranteed to repeat itself across time or model updates. Listen to all three against
     `design.mp3`, then keep the closest with `node scripts/voice-rebuild.ts save <generated_id>`.
4. **Audition:** `node scripts/voice-rebuild.ts audition <voice_id>`.
   - This reads the four casting lines with the new voice and `VOICE`'s settings.
   - Compare each with its clip in `docs/voice/glim/`, with the effect off. Check that it is the same character (buzz,
     nasal tin, choppy syllables), at the same pace, with no added or dropped words.
   - The owner makes the call, by ear.
5. **Adopt:** set `VOICE.voiceId` to the new id, update the Voice paragraph in `docs/blueprint-ui.md` with the date and
   the path you used (clone or redesign), and commit.

## When a model changes

A new speech model (one after `eleven_v3`) or a new designer generation breaks the lock, even if the voice id still
resolves. Before switching `VOICE.modelId`:
- run `audition` with the current voice id;
- temporarily edit the model in a local copy of the script;
- compare the result with the clips the same way.

Keep the old model until the owner accepts the new read.
