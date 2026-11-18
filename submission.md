# Developer's Blueprint

**Track:** Productivity · **Division:** New Experience · **Platform:** Meta Quest 3 and 3S (standalone, hands first)
**Video:** [owner: public link] · **Build:** Competition release channel, [owner: invite link]
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
