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
  (as `Glim`), the place baton's table writes (as `VR table`). The baton itself is unchanged.

## The Morning Watch
- Deck: `packages/core/src/companion/morning.ts` (pure) over every registered live product's store and plan
  (`server/api/companion/morning.server.ts`). `GET /api/companion/morning?since=<iso>` (default: the last 16 h).
- Cards: open (the portfolio in a line) -> per product: built overnight (at the room where most of it landed), release
  (confirmed only by readings taken after it; "fell short" otherwise), or a quiet night -> the top three blockers across
  products, stop-ship first -> close (what was decided, where the log is).
- Steering (`POST`, human path only): **A**pprove = the plan's own `decide`; **D**efer = off the deck for 20 h;
  **H**old = stays, marked. Each verdict is a row in `<root>/.ai/lens-scan/work/steering-log.jsonl`, rendered as the
  day's `steering-log.md`.
- On the page: **M** on a live product opens the deck docked left; the plan frames each card's place to its right
  (`Engine.setInsetLeft`). `→ ←`, `A D H`, `Esc`. A card in another product opens that product (`?morning=<card>`).

## Surfaces
- **Web**: the deck, and the follow chip on every page ("Following Web, 2 s ago" · Stop / Follow). `?follow=1` follows
  on load.
- **VR table, headless stand-in**: `scripts/focus-standin.ts` follows over the real stream and frames each place on the
  product's own plan (room, bay's room, wing, feature's room). `--lead` publishes the next room (the table leads).
- **Gates**: `check:shared-focus`, `check:morning-watch` (seeds a temp portfolio, steers it, drives the stand-in through
  a real apps/server).

## Demo data
`node scripts/morning-up.mjs [--port 3010] [--server]` seeds `.demo/morning/` (three copies of the Kettle map with a
labelled synthetic night, its own registry via `BP_PRODUCTS_FILE`) and starts the web with fake `claude` and `gh`.
