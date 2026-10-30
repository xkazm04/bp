# One morning, one place

The daily steering ritual, wherever the owner stands: a **Morning Watch** that briefs the whole portfolio in one deck,
and a **shared focus** that every surface publishes and every other follows, so as a card is read every screen is in
the same room.

## The shared focus ("Follow me")
- Pure rules: `packages/core/src/session/focus.ts`. Record: `$BP_HOME/session/focus.json`
  (`packages/core/src/server/api/session/focus.server.ts`). Route: `GET/POST /api/session/focus`; every visible change
  goes out as `event: shared` on `/api/companion/stream`.
- Leader-less. Every surface is a reader (`{ id, surface, label, place?, follows?, seenAt }`); the shared place is the
  newest place any reader published. A reader follows `*` (whoever moves) or one named reader.
- A place is ids only: `{ product, target?: { kind: feature | room | wing | site, id }, level?, hash?, say? }` - the
  same ids the baton, the companion's `focus.show` and Personas' deep link already speak.
- No fighting cursors: publishing the place that is already shared is an echo (no new rev, no event); a reader never
  applies its own write; a page arriving at a place it was sent publishes nothing until it lands; a gone reader holds
  nothing (shown gone after 45 s, forgotten after 24 h).
- Writers that go through it: any page (where it rests), the Morning deck (each card), the companion's `focus.show`
  (as `Glim`), the VR table when moved by hand (as `VR table`), the place baton's table writes (as `VR table`). The
  baton itself is unchanged.
- Over the LAN: the S8 door's `focus` scope admits GET and POST; a caller with `x-bp-device` (the door sets it) is pinned
  to reader `vr:<device>`, so a headset cannot speak as another surface.

## The Morning Watch
- Deck: `packages/core/src/companion/morning.ts` (pure) over every registered live product's store and plan
  (`server/api/companion/morning.server.ts`). `GET /api/companion/morning?since=<iso>` (default: the last 16 h).
- Cards: open (the portfolio in a line) -> per product: built overnight (at the room where most of it landed), release
  (confirmed only by readings taken after it; "fell short" otherwise), or a quiet night -> the top three blockers across
  products, stop-ship first -> close (what was decided, where the log is).
- Steering (`POST`, human path only): **A**pprove = the plan's own `decide`; **D**efer = off the deck for 20 h;
  **H**old = stays, marked. Each verdict is a row in `<root>/.ai/lens-scan/work/steering-log.jsonl`, rendered as the
  day's `steering-log.md`. This morning's decisions keep their slots (marked) so the deck never reshuffles mid-standup;
  decisions taken elsewhere (the plan, the ledger, Personas through its own path) are counted on the close card.
- Decision cards say what deciding buys: the metric now and expected (the manifest's label), size, change risk.
- On the page: **M** (wherever live products are registered) opens the deck docked left; the plan frames each card's
  place to its right (`Engine.setInsetLeft`). `→ ←`, `A D H`, `V` (the browser's own voice), `Esc`. A card in another
  product opens it **in place** (`switchProduct`: no reload; the deck and every follower keep their state).

## Decisions with memory, in the morning (the e2 + e3 fusion)
Every decision card on the deck carries its **decision brief** (`docs/concepts/decision-brief/`), computed by one
function, `cardBrief` in `companion/morning.ts`, over the product's store and plan: what it touches, the owner's own
declines quoted, undo, cost. The web deck, the phone, a follower's lower third (the brief's short line under the line
being read), `morning.brief` for agents and `plan.brief` all read the same lines (`check:morning-brief` pins it).
- **A repeat** (the same idea filed again: the brief's advice `withdraw`): **Decline** joins Approve, Defer and Hold as
  the recommended key; **Enter** takes it, and the store row gets the brief's note, `Repeats <id>, declined <day>: "..."`,
  through the same `decide`. The server refuses Decline on any other card (409): the plan keeps the free Decline.
- **A likeness** (a like idea, the same standard): the owner's words in amber, "yours to decide"; the keys stay.
- **Agents**: the opening card says how often agents checked your decisions overnight, the declines they heard and what
  they withdrew; an agents card (second) shows the trail's lines at the feature they stood down on. The close card
  counts repeats declined. `morning.brief` reads a compact agent view (`view=agent`) that fits the door's 8000-char cap.
- **The release card and its tile agree**: a tile shows its newest track, so the card flies to an item whose tile shows
  this release's reading and names it first.

## Surfaces
- **Web**: the deck, and the follow chip on every page ("Following Web, just now" / "12 s ago" · Stop / Follow) with the leader's line
  as a lower third. `?follow=1` follows on load (labelled "Web window").
- **Phone**: the clicker. The deck runs full screen and leads; the desk follows.
- **VR table (UE)**: BpLink follows (1 Hz poll, `vr:table`), the table enters the room with its lift and fade and says
  "Following Web" on its rim; moving the table by hand publishes ("Shared from this table"). `BpLink.Follow|Publish
  on|off`, `BpLink.Goto <id>`. Captures from the target pose: `vr-*.jpg` here.
- **VR table, headless stand-in**: `scripts/focus-standin.ts` follows over the real stream and frames each place on the
  product's own plan (room, bay's room, wing, feature's room). `--lead` publishes the next room (the table leads).
  `--personas` plays Personas' Monitor (1 Hz poll, prints its Blueprint-sheet call): see `personas-adoption.md`.
- **Agents (MCP)**: `morning.brief` reads the deck; `focus.show` moves every follower. `scripts/morning-agent-walk.mjs`
  walks the deck through the real door (scripted, no model).
- **Gates**: `check:shared-focus`, `check:morning-watch` (seeds a temp portfolio, steers it, drives the stand-in through
  a real apps/server), `check:morning-brief` (the brief on the cards, Decline on a repeat only, the agent trail).

## Demo data
`node scripts/morning-up.mjs [--port 3010] [--server]` seeds `.demo/morning/` (three copies of the Kettle map with a
labelled synthetic night, its own registry via `BP_PRODUCTS_FILE`), adds the brief's labelled decision history to Kettle
Web (`scripts/brief-demo-seed.mjs --morning`), starts the web with fake `claude` and `gh`, and plays the night's agent
once (`scripts/brief-agent-demo.mjs`, scripted, no model) so the morning opens with what agents heard.
