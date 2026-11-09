# Voice link: talking to the lamp through the PC

Written 2026-11-09 (night run two, S2). The owner picked "Talk to the lamp": speak at the table, the companion answers
aloud and acts on the plan. The headset records one short utterance (push to talk) and plays the answer. The PC does the
speech work, because the headset build carries no speech engine, so this only runs while the PC link is up (the USB
tether, or a PC build). This page is the server side: two routes, their wire contract, what they keep, and what they cost.
The headset side (recording, playback, the opt-in) belongs to the headset builder.

Code: `packages/core/src/server/companion/voice-link.server.ts` (the pipeline), the handlers
`packages/core/src/server/api/companion/listen/route.ts` and `.../say/route.ts`, their thin web mounts under
`apps/web/src/app/api/companion/`, and `scripts/check-voice-link.ts` (`npm run check:voice-link`).
The LAN door verbs for these two routes are added by the LAN door's own builder (`apps/server/src/lan-door.ts`).

## Wire contract

Both routes are `POST`, served on loopback only (apps/server on `:3100`, the web app on `:3010`). A headset reaches them
through the tether or the LAN door, which forwards its call as a loopback one. Every error body is JSON:
`{ "error": "<code>", ... }`. The codes are the closed list below.

### `POST /api/companion/listen`: an utterance in, its words out

| | |
|---|---|
| Request headers | `Content-Type: audio/wav` (`audio/wave` and `audio/x-wav` are also accepted), `Content-Length` (required), `x-bp-speech-consent: cloud` |
| Body | One RIFF/WAVE file: PCM, 16-bit, **mono**, at **16000 Hz (preferred)**, 24000 Hz or 48000 Hz. A `WAVE_FORMAT_EXTENSIBLE` header with a PCM sub-format is fine. |
| Caps | At most **30 seconds** and **3,000,000 bytes** (30 s at 48 kHz is 2,880,000 bytes of samples). 16 kHz is preferred because it is a third of the upload and the engine reads that rate anyway. |
| 200 | `{ "text": string, "ms": number, "heard": "speech" \| "no-speech" \| "silence", "language"?: string, "cost"?: { "credits"?: number, "usd"?: number } }` |

`ms` is the server's time for the whole call. `heard` keeps three different facts apart (stt-pipeline):

- `silence`: the loudest sample is under -45 dBFS. The answer is `{ "text": "" }` and the audio is never sent anywhere.
- `no-speech`: the engine heard sound but found no words. The answer is `{ "text": "" }`.
- `speech`: words came back.

The engine's sound tags, like "(laughs)" or "[music]", are removed from `text`.

| Status | `error` | When |
|---|---|---|
| 400 | `bad-wav` (+ `reason`) | not RIFF/WAVE, not 16-bit PCM, not mono, or another sample rate |
| 403 | `no-consent` (+ `need`) | the consent header is missing |
| 403 | `speech-off` | the PC has turned cloud transcription off (`BP_CLOUD_SPEECH=off`) |
| 403 | a guard sentence | not loopback, a foreign Origin or a cross-site request |
| 411 | `no-length` | no `Content-Length` |
| 413 | `too-large` (+ `maxBytes`) | the declared or real body is over 3,000,000 bytes (apps/server's own cap of 4 MiB sits above this one) |
| 413 | `too-long` (+ `maxSeconds`) | the audio is over 30 s |
| 415 | a guard sentence | the body is not `audio/wav` |
| 429 | `busy` / `rate` (+ `retryAfterS`) | one call is already in flight, or 20 have run in the last minute |
| 502 | `upstream` (+ `status`) | the transcription service failed. `status` is its HTTP status, or 0 when it did not answer within 30 s |
| 503 | `no-speech-key` | no `ELEVEN_LABS_API_KEY` in the environment or in bp's `.env` |

Silence is checked before the key, so a silent capture answers 200 even on a PC with no key.

### `POST /api/companion/say`: a line in, Glim's voice out

| | |
|---|---|
| Request headers | `Content-Type: application/json` |
| Body | `{ "text": string }`, 1 to **4000** characters. The line actually spoken is `speakable(text)` (`packages/core/src/companion/voice.ts`): markdown, code and links become plain words, and the line is cut at a sentence end to at most **320** characters (about 20 s of speech). |
| 200 | `audio/wav`: RIFF, PCM **16-bit, mono, 24000 Hz**, levelled to **-14 LUFS** integrated with a **-1 dBFS** peak ceiling |
| 200 headers | `x-bp-voice` (the voice speaking: "Glim (Vintage Tin, a designed voice, not a likeness of a person)"), `x-bp-voice-cache: hit \| miss`, `x-bp-say-cut: 0 \| 1` (1: the text was cut or cleaned before speaking), `x-bp-say-ms`, and on a fresh synthesis `x-bp-voice-cost` (credits) |

The voice is exactly the tour clips' voice. The same `VOICE` (voice id `SVlo1tpEuzf5ilPRxsRZ`, model `eleven_v3`, seed
4242, stability 1.0, similarity 0.8) goes through the same cached MP3 synthesis. Then the same ffmpeg robot chain
(`VOICE_FX`) runs at 24 kHz mono, followed by the same two-pass level: measure with ebur128, then one static gain plus a
limiter. So the app plays an answer at the gain it plays the tour clips. `check:voice-link` holds the effect, rate, level
and voice equal to the tour's own `apps/vr/Content/BpData/voice/tour/lines.json`. Asked for the tour's welcome line, the
route returns a file byte-identical to `welcome.wav`.

| Status | `error` | When |
|---|---|---|
| 400 | `bad-text` (+ `reason`) | not JSON, no `text`, or nothing left to speak after `speakable` |
| 403 | a guard sentence | not loopback, a foreign Origin or a cross-site request |
| 413 | `too-large` (+ `maxChars`) | `text` is over 4000 characters |
| 415 | a guard sentence | the body is not `application/json` |
| 429 | `busy` / `rate` (+ `retryAfterS`) | a fresh render is already in flight, or 20 have run in the last minute (cached lines are never limited) |
| 500 | `render-failed` | ffmpeg failed on the effect or the level pass |
| 502 | `upstream` (+ `status`) | the voice service refused the line (its HTTP status) or did not answer (0) |
| 503 | `no-speech-key` | no key, and the line is not cached |
| 503 | `no-ffmpeg` | ffmpeg is not on the PC's PATH |

**Cache.** The finished WAV is stored as `$BP_HOME/companion/voice-link/<hash>.wav`. By default that is
`<repo>/.bp/companion/voice-link/`, which is git-ignored. The key of the hash is the voice (id, model, settings, seed),
the effect chain, the rate, the level and the spoken text. A repeated line answers from disk in a few milliseconds and
costs nothing. The MP3 under it is shared with the web lamp's cache, `$BP_HOME/companion/voice/`.

## Privacy, in plain words

- **What leaves the headset:** only what the wearer records while holding push to talk, as one WAV of at most 30
  seconds. It goes to the PC over the USB cable, or over the paired LAN door. Nothing is recorded without the gesture.
- **Where it goes:** the PC sends that recording once to ElevenLabs' speech-to-text service (`api.elevenlabs.io`, model
  Scribe v2) to turn it into words. A recording the PC measures as silence is not sent at all. The PC sends ElevenLabs
  the text the lamp will say, to turn it into speech.
- **What is kept:** on the PC, nothing of what you said. The recording stays in memory only for the call and is then
  dropped. The words are sent back to the headset and are not written to any file or log. The server's log lines name
  only refused requests, never a body. The one thing kept is the cache of the lamp's own answers: the audio of lines the
  app itself asked to be spoken, so a repeated answer is free. Deleting `.bp/companion/voice-link/` clears it.
  ElevenLabs keeps data under its own terms for this account, and bp does not control that.
- **How to turn it off:** on the PC, set `BP_CLOUD_SPEECH=off` and restart the server. Every listen call is then
  refused (`speech-off`), and the lamp can still speak.

## Cost per call (as the upstream reports it)

ElevenLabs answers each call with `character-cost` (credits). Speech-to-text also returns `fiat-cost-before-overages`
(USD). Measured 2026-11-09 against this account:

| Call | Reported cost |
|---|---|
| listen, a 5.5 s utterance (16 kHz) | 2 credits, $0.00036 |
| listen, a 3.4 s utterance | 1 credit, $0.00018 |
| say, a fresh 50-character line | 22 credits (`x-bp-voice-cost`) |
| say, a 6-character line | 3 credits |
| say, a cached line | 0 |

Transcription is billed by audio length, about 0.35 credits or $0.000065 per second, and a silent capture costs nothing.
Synthesis is billed by characters, about 0.45 credits per character on `eleven_v3`. With a key, every
`npm run check` run costs one transcription (about 2 credits). Its say line is a tour line that is already cached.

## Measured latency (2026-11-09, Lynx, apps/server on 127.0.0.1)

| Call | Time |
|---|---|
| say, fresh line (synthesis + effect + level) | 2.87 s (50 characters) |
| say, MP3 cached, WAV not yet (effect + level only) | 0.49 s |
| say, cached | 1 to 5 ms |
| listen, 3.4 to 5.5 s utterance at 16 kHz | 0.62 to 1.03 s |
| listen, silence | 1 to 3 ms |

## Registry decisions (voice-io)

- **on-device-vs-cloud.** The rule is that capture defaults to on-device, and cloud transcription is an opt-in. It must
  be disclosed in plain words, chosen affirmatively, revocable in one step and visibly active while in use. Here the
  server refuses to transcribe without the client's `x-bp-speech-consent: cloud` (403 `no-consent`), and the PC can
  revoke it in one step (`BP_CLOUD_SPEECH=off`, 403 `speech-off`). The privacy section above is the plain-words
  disclosure.
- **stt-pipeline.** Silence, no speech and failure are three different answers (`heard`, and 502 for failure). Push to
  talk has a hard cap (30 s), because the cap belongs to the engine's bounded input and not to an auto-stop rule.
- **unattended-caller-attribution.** `say` renders a file that the caller plays, so the PC itself never speaks. That is
  the technique's "renders into a file" case: attribution moves to the artifact. Every answer names the voice in
  `x-bp-voice`, and the voice is a designed one, not a clone of a person. The rate is bounded: one in flight and 20
  per minute per route. Capture does not travel through this door: `listen` takes audio the headset already recorded
  under its own gesture, and never opens a microphone.
- **speech-ready-text.** `say` speaks `speakable(text)`, never raw markdown.
- **Rate limit.** The repo has no request rate limiter. Its costly job routes refuse with 429 when their queue is full,
  so these two routes refuse with 429 too, using an in-process counter per route. Every caller here is loopback, so
  "per caller" can only mean per route.

## Deviations (recorded; the standard stands)

1. **Capture goes to the cloud (on-device-vs-cloud).** The standard's default for capture is on-device. The headset has
   no speech engine, and the PC has none installed tonight, so this link uses a cloud engine as its only engine.
   Closing it: a local recognizer on the PC (for example a Whisper build) behind the same route, with cloud as the
   fallback the person opts into.
2. **The consent record is the headset's claim, not something the server holds (on-device-vs-cloud).** The server
   checks a header, but the opt-in screen, its plain-words disclosure and the "visibly active while in use" indicator
   live in the headset, and they are not built yet. Until they are, the headset must send the header only after the
   wearer has accepted the disclosure in the app, and must show that it is listening while the recording is sent and
   transcribed.
3. **No vocabulary biasing (decode-time-vocabulary-biasing).** The product knows its words (feature names, "approve",
   "decline"), and the engine misheard "kettle wing" as "Kettlewing" in the round trip. The route sends no key terms
   yet.
