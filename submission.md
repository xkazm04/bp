# Developer's Blueprint

**Track:** Productivity · **Division:** New Experience · **Platform:** Meta Quest 3 and 3S (standalone, hands first)
**Video:** [owner: public link] · **Build:** Competition release channel, [owner: invite link, from the steps below]

## Getting the build link (Meta Horizon developer dashboard)

**Done 2026-11-18:** app ID 1439047369295275; the Shipping APK (versionCode 1, 0.1.0) is build 1439076655959013,
validated with no errors and published to the Competition channel (1894208691932471) with Meta's CLI:
`metavr store dist upload --app-id 1439047369295275 --channel Competition --apk <apk> --publish` (metavr has no Windows ARM64
binary; its x64 build runs under emulation). Left for the owner: the channel's invite link (step 6).

The form wants an invite link to the APK in a release channel. The dashboard makes that link once the build is uploaded.
Menu names drift between dashboard versions; follow the closest match.

1. **The APK.** Upload `apps/vr/.cache/quest/Android_ASTC/bp-Android-Shipping-arm64.apk` (209 MB). It is the Shipping
   build, release-signed and not debuggable, package `com.developersblueprint.vr`, versionCode 1. Keep the release key
   and its password (`apps/vr/Build/Android/bp-release.keystore`, `%LOCALAPPDATA%\Unreal Engine\Engine\Config\UserEngine.ini`):
   every later upload of this app must be signed by the same key and carry a higher versionCode.
2. **Create the app.** Sign in to the developer dashboard (developers.meta.com/horizon, "My Apps", or your organization's
   page), create a new app, pick the Meta Quest (Horizon Store) platform, and name it "Developer's Blueprint". The first
   upload fixes the app's package name to `com.developersblueprint.vr`.
3. **Make the channel.** In the app: Distribution > Release Channels. Create a channel named **Competition** (the rules
   ask for that name), or use an existing test channel and rename it if the dashboard allows.
4. **Upload the build** to the Competition channel with the channel's Upload Build button, or with Meta's command-line
   uploader: `ovr-platform-util upload-quest-build --app_id <App ID> --app_secret <App Secret> --apk <path> --channel Competition`
   (App ID and secret: the app's API page; run `ovr-platform-util help upload-quest-build` for the current flags). Wait
   for the build to finish processing; if it is refused, the message names the manifest field (supported devices are
   Quest 3 and 3S; the VR category and hand tracking are declared by the build).
5. **Anything the dashboard asks first.** If it blocks the upload or the channel on missing app details (a Data Use
   Checkup, an age rating, a privacy policy URL, a short description), fill them from this file: the app reads a
   product's files on the owner's PC only after pairing, sends speech only when the person holds to talk and allowed it,
   and collects nothing else.
6. **The invite link.** In the Competition channel's settings, turn on the invite (shareable) link, or Add Users, and
   copy the link. Open it once while logged out of your own account, or on a second account, to check it installs. Put
   the link in the form's build field and at the top of this file.
7. **Keep it up.** The rules judge the build as it stood at the deadline and keep the channel live until about 11
   December: do not delete or replace the build there before then.
**Target launch date:** [owner] (Meta Horizon Store, Productivity)

**Tagline.** Your codebase as an architect's drawing on a light table: Glim, a desk-lamp companion, draws your product as
a building, scans it, and puts the day's decisions in your hands.

## Inspiration

Software teams lose the shape of their product. The code is thousands of files, the backlog is a list, and nobody sees
the whole building at once. Architects solved this long ago with the drawing set: a site plan, wings and rooms, read at
any zoom on a backlit table. We wanted a software product to have that drawing, and to put the person at the table in
the morning, where the day's decisions are made, with a companion that does the legwork and asks before it acts.

## What it does

Developer's Blueprint draws a codebase as a building: areas of the product are wings, capabilities are rooms, features
are fixtures. On first launch Glim, a drafting lamp who speaks and captions every line, walks you through the real
process with your hands: add a project and watch it draw itself on the table, open a wing, scan it while Glim flies room
to room, see what needs a person become decision cards, approve one on the wall, and ask Glim anything. Every morning the
stand-up opens with what yesterday's approvals became, then today's decisions, one card at a time. The judged build
carries a sample project and runs with no PC; paired with your PC, the same table reads your live projects.

## How we built it

A real-time 3D engine with the Quest platform's XR plugin and interaction SDK for hand tracking, seated and within arm's
reach. The drawing is data, not art: the table reads the product's structure and draws every wing, room and fixture at
runtime, with text sized by its angle from the seated eye. A small home server on the PC serves the product's live state
to the web app and, after a one-time pairing code, to the headset. The companion runs through a coding agent on the PC,
under a written constitution: it may say anything in character but acts only through its tools, and every write waits
for the person's card. Glim's lines live once in the code, so his captions and recorded voice cannot drift apart.

## Challenges we ran into

Making a standalone headset build that is fast, signed and honest: a Quest render tier in the same scene (72 fps measured
on a Quest 3S), a release-signing setup that keeps the key out of the package, and the difference between the build we
debug and the build we ship. Making the first five minutes follow the product's own story instead of a tour of buttons,
with one voice owning the first run. And filming a live product without a camera crew: we built an unattended pipeline
that drives the headset, records it, and cuts the take to the music by the app's own clock.

## Accomplishments that we're proud of

A first run that onboards a project, scans it and lands on a real decision in about two and a half minutes, by hand.
Glim, who flies to the room he is reading and only acts on your yes. A morning ritual with a reason to come back: what
your approvals became, with before and after screens. And a demo video cut entirely from real footage of the app on the
web and on the headset, side by side.

## What we learned

Start the story where the user starts, not where the interface starts. Treat the voice as one owner and every other
sound as polite. Measure on the device, never on the PC preview. And keep the film as reproducible as the code: when the
take, the edit and the render are commands, every note costs minutes instead of a day.

## What's next

Speech recognition on the PC itself, with the cloud as an opt-in fallback; an encrypted headset-to-PC link with the token
in secure storage; reading a new project in a sandbox; more lenses on the product; and a store release in the Productivity
category on the target date above.

## Accessibility and comfort

Seated, hands first, controllers optional. Every spoken line is captioned; text size 100, 115 or 130 %; reduced motion;
the wrist menu on either hand; voice and music volumes set apart; talking is always optional.

## Built with

Unreal Engine 5.8, Meta XR plugin and Interaction SDK, C++, TypeScript, Next.js, Node.js. [owner: confirm whether naming
the engine and tools is allowed under the brand rule]

## 4. What Meta VR capability(ies) did you use in your project?

The Meta XR plugin (OpenXR runtime on Quest 3 and 3S) for the standalone, seated experience, and the Meta Interaction
SDK for hand tracking: its hand and controller rigs and its finger-pinch recognizer drive every action, with controllers
as an optional second input. Passthrough powers "Your room": one tap fades the studio out and puts the light table on
your real desk, so you can see your keyboard or a notebook while you plan, and one tap brings the studio back. Dynamic
foveated rendering and a dedicated Quest render tier keep the app at 72 fps on a Quest 3S. The app follows the XR
session's focus (the guided tour pauses when you take the headset off or open the system menu, and resumes where it
was), and asks for the microphone through the platform's permission dialog only when you first hold to talk.

## 5. Describe how Hand Interactions are implemented into your experience.

Everything works with bare hands, seated, within arm's reach of the table. A pinch-tap on a wing lifts it, a tap on a
room raises it, and a second tap steps inside; pinching and pulling a wing toward you does the same, and pinching and
pushing away goes back a level. Each hand casts a ray that reaches both the table and the large sheet projected on the
far wall, so you point and pinch to press APPROVE, LATER or SCAN; a press counts only on the control the pinch began on,
which stops accidental taps while the hand moves. Looking at your left wrist shows a small panel of quick actions (menu,
tour, talk, the waiting decision) that turns to face your eye. To talk to Glim you pinch and hold him (or hold TALK on the
wrist) and let go to send, and pinching one of his reply buttons answers him. The interaction layer is built on the
Interaction SDK's hand rigs and pinch recognition, with our own gesture logic for tap, pull, push and hold, and a
controls legend on the table's far corner names each gesture; controllers mirror every action (stick to move, A to
select, B to go back) for anyone who prefers them.

