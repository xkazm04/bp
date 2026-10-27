# Voice SDK plan: talking to the table with Meta's Voice SDK for Unreal

Written 2026-10-27 for a later session. Today the VR app has no voice input. The web companion already speaks its
replies (ElevenLabs, `docs/blueprint-ui.md`, "Voice"), and nothing listens yet. This plan adds speech-to-text in the
headset with Meta's own SDK, so the table can be driven by voice as well as by hands.

## Why this SDK

| Option | Cost | Runs on the Quest alone | Meta stack | Notes |
|---|---|---|---|---|
| **Meta Voice SDK for Unreal (Wit.ai)** | Free (a Wit.ai account) | **Yes** (Android and Win64) | **Yes** | Dictation plus NLU (intents), and Wit text-to-speech too |
| Muse Voice Transcribe (Meta Model API) | $0.18 per hour of audio | Only through a server we host | Yes | Meta's newest speech-to-text; streams over WebSocket; needs an API key, so a server in between |
| A local Whisper | Free | Heavy on an XR2 | No | Offline |

The Voice SDK is the one that works in the judged build ([`standalone-plan.md`](standalone-plan.md): no PC and no bp
server). It also fits two of the competition's special awards:

- **Best Agentic Interaction:** "voice-first AI interaction".
- **Best Accessibility Forward:** "voice alternatives for hand interactions".

## Facts (read 2026-10-27)

- **The plugin.** [`wit-ai/voicesdk-unreal`](https://github.com/wit-ai/voicesdk-unreal) at **v76.0.0** (the
  `VoiceSDK.uplugin` descriptor):
  - modules `VoiceSDK` (Android, Win64) and `PlatformIntegration` (Win64);
  - it depends on [`wit-unreal`](https://github.com/wit-ai/wit-unreal);
  - the last commits are from May 2025 ("add ue5.5 scripts"). **Nothing says it builds on UE 5.8**, and our Meta
    plugins are v207. Treat it as a probe.
- **Dictation.** It transcribes live speech with no NLU. `OnPartialTranscription` fires while the person speaks, and
  `OnFullTranscription` fires when they stop ([dictation](https://developers.meta.com/vr/documentation/unreal/vsdk-dictation/),
  [transcriptions](https://developers.meta.com/vr/documentation/unreal/vsdk-transcription/)).
- **Setup.** A Wit Configuration asset holds the app's **Client Access Token**, from Wit.ai → Management → Settings
  ([integrate](https://developers.meta.com/vr/documentation/unreal/vsdk-integrate-voice/)). Meta ships a sample project
  with a dictation demo ([sample](https://developers.meta.com/vr/documentation/unreal/vsdk-sample-project/)).
- **Languages.** English is high quality; 12 more languages are in early preview ([overview](https://developers.meta.com/vr/documentation/unreal/vsdk-overview/)).
- **Text-to-speech.** Wit has TTS with customizable voices
  ([TTS voices](https://developers.meta.com/horizon/documentation/unreal/vsdk-tts-voice-customization/)). That is a
  Meta-built fallback for Glim's voice on the headset, where ElevenLabs through our server is not available.

## How voice fits the table (the rules we keep)

These follow the registry's `voice-io` subject (technique `voice-ux-integration`).

- **Voice is an accelerator, never the only way in.** Every action stays reachable by hand: the competition's
  hands-first rule says the same.
- **Listening starts from a gesture.** Hold the lamp for 0.8 s, which already exists as a hold target. Listening is
  shown where the person looks: the lamp's lens glows and the tag reads "listening". The same gesture stops it.
- **One arbiter.** While the table listens, Glim does not speak, and a new utterance cuts off a line that is playing.
- **Honest failure.** No network, no microphone permission or no token each show one sentence on the lamp's tag. The
  table stays fully usable by hand.

## The steps

### V1. The probe: does it build on 5.8? (one session, time-boxed to 2 hours)

1. Clone `voicesdk-unreal` and `wit-unreal` into `apps/vr/Plugins/` as git-ignored folders, the way `install-xr.ps1`
   installs MetaXR. Read their licence first.
2. Enable them in a **local** `bp.uproject` first, so a failed probe never lands in master.
3. Build `bpEditor`. Record every API break in `machine.md`.

**Pass:** the build succeeds, the sample's dictation map runs in the editor with the PC microphone, and a partial and a
full transcription are logged.

**Fail:** go to the fallback (V6), and record why.

### V2. Push-to-talk on the lamp

1. A `UBpVoice` component on the pawn: start or stop dictation, partial text to the lamp's tag, the full text to a
   handler.
2. The lamp's hold starts listening; releasing the hold, or 8 s of silence, stops it.

**Pass:** in the Simulator, holding the lamp and speaking shows the words on the tag.

### V3. What a sentence does

There are two routes, chosen by whether a server answered (BpLink's `bFromBundle`):

- **With the bp server (PC route):** the transcript becomes a companion turn (`POST /api/companion/turn`), the same as
  typing on the web lamp. Glim answers, and its focus commands move the table, as they already do.
- **Standalone (judged build):** Wit's NLU maps the sentence to table commands, with no companion:

  | Intent | Example | What it does |
  |---|---|---|
  | `show_wing` | "show me Money" | Lifts that wing |
  | `open_room` | "open checkout" | Dives into that room |
  | `level` | "back to the site" | Returns to L0 |
  | `lens` | "security lens" | Switches the lens |
  | `explain` | "what is this?" | Reads the focused feature's summary from the bundle |

  The entity values come from the bundled plan's names, so they are trained once per product.

**Pass:** five spoken commands each do what their hand gesture does, on the Quest with no PC.

### V4. Android

1. Add `android.permission.RECORD_AUDIO` to the manifest, and ask for it at first use, not at start.
2. Run V3's standalone route on the device.

**Pass:** it works on the Quest 3S, and a refused permission shows its sentence on the tag.

### V5. Glim's voice on the headset (optional)

Wit TTS reads Glim's scripted lines (standalone plan, D1 option b) with the same robot effect as on the web: a high-pass
filter, a presence lift, a short echo and a tremolo, as a UE submix effect chain. Lines are cached on the device.

**Pass:** the tour plays with voice, and the wrist has a voice mute that is remembered between sessions.

### V6. The fallback, if V1 fails

Muse Voice Transcribe or Whisper, through the bp server. This works only on the PC route, so the judged build would
have no voice. Weigh that before the competition deadline. The Voice SDK route is the only one that works with no
server.

## Secrets

The Wit **Client Access Token** is a client-side token that Wit.ai issues for apps, but it still stays out of git:

- Keep it in a git-ignored config file (for example `Config/DefaultVoice.local.ini`), merged at package time, or in the
  owner's `.env`, read by the packaging script.
- Use a server token only on a server, never in the APK.

## Decisions for the owner

- **V-D1:** Create the Wit.ai app, with the owner's Meta account.
- **V-D2:** Standalone voice commands only (V3, standalone), or the companion too, which needs the PC or a hosted
  server.
- **V-D3:** Whether Glim speaks on the headset (V5), and with which voice: Wit TTS on the device, or ElevenLabs lines
  pre-rendered into the bundle.
