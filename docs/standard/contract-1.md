# bp contract 1: the shared focus, the Morning deck and the decision brief

Written 2026-10-30 (roadmap S2, `docs/concepts/one-morning-brief/ROADMAP.md`). This is the normative text for every
client outside bp that follows the owner's morning: Personas first, BpLink (the VR table), any later screen. **bp
builds, a client reads**: bp proves a behaviour first, then publishes its wire, its golden and its copy targets here.

## 1. What the contract is made of

`packages/schema/contract.json` lists every file below with the sha256 of its LF bytes and a `rev`.
`npm run check` (`check:contract`) fails when one of them changes without its manifest entry, so a contract change is
always a visible edit of that file with a new `rev`. A client pins `rev` (or a file's hash) and compares.

| File | Role | What a client does with it |
|---|---|---|
| `packages/schema/schema/shared-focus-1.schema.json` | wire | `FocusPlace`, `SharedView`, the POST body and its answer. UE: `FBpFocusPlace`, `FBpSharedView`, `FBpSharedPlace`, `FBpFocusAnswer` through `BpSchema::FromJson` |
| `packages/schema/schema/morning-deck-1.schema.json` | wire | `MorningDeck` (GET), `AgentDeck` (`view=agent`), `SteerRow`. UE: `FBpMorningDeck`, `FBpAgentDeck`, `FBpSteerRow` |
| `packages/schema/schema/decision-brief-1.schema.json` | wire | The brief. UE: `FBpDecisionBrief` |
| `packages/schema/golden/shared-focus.json` | golden | A port of the focus rules runs its inputs and reproduces it exactly |
| `packages/schema/golden/decision-brief.json` | golden | A port of `brief.ts` runs its six cases and reproduces them byte for byte |
| `packages/core/src/session/focus.ts`, `session/place.ts`, `scan/brief.ts`, `standard/schema-vocab.ts` | copy targets | Pure, dependency-free TypeScript a port copies, with only marked edits |
| this file | text | The rules a schema cannot carry |

The TypeScript under `packages/schema/generated/ts/` is a parity artifact in bp; a port may copy it, but bp's own code
types are the hand-written ones above, held field by field to the schemas by `check:schema`.

**Moved.** The brief golden moved from `docs/concepts/decision-brief/golden.json` to
`packages/schema/golden/decision-brief.json` on 2026-10-30. The old path stays, byte for byte the same file
(`check:contract` and `check:decision-brief` hold it), because ports copied it from there and pin its hash.

**Versions.** Every schema is additive-only within its suffix: a new field is optional, and an enum only widens where a
client is told so here. A breaking change (a field removed or made required, a type changed, an enum narrowed) takes a
new suffix (`shared-focus-2`), and `npm run schema:generate -- --since origin/master --dry-run` says, before any write,
which channel each schema edit breaks and calls out a breaking file that kept its suffix.

**Pinning a port.** The first line of a ported file says where it came from:
`// PORTED from bp <path> @ <commit> sha256:<sha256 of bp's LF bytes at that commit>`, then the marked `EDIT (port):`
lines. A golden copy's test names `{ path, commit, sha256 }`. `node scripts/personas-drift.mjs --personas <checkout>`
reads those pins against this manifest and prints which copies are in sync, behind, or missing. It is a report run by
hand, not part of `npm run check` (a machine with no Personas checkout would print SKIP, and a SKIP fails the suite).

## 2. The shared focus

The place the owner is looking at, which any surface publishes and any other follows, with no leader.

- **Routes.** `GET /api/session/focus` answers a `SharedView`. `POST /api/session/focus` takes one move,
  `{ op, reader, surface?, label?, place?, of? }`, and answers `{ moved, view }`: 201 when the shared place moved, 200
  otherwise. The ops:
  - `hello` (say it every 15 s while open);
  - `publish { place }`;
  - `follow { of: '*' | <reader id> }`;
  - `unfollow`;
  - `forget` (on close).
  Every visible change also goes out as `event: shared`, `data: {"type":"shared","shared":<SharedView>}`, on
  `GET /api/companion/stream`.
- **Ids only.** A place is `{ product, target?: { kind: feature | room | wing | site, id }, level?, hash?, say? }`, never a
  selection. A reader id matches `^[\w.:-]{1,80}$`, a label is 1-40 characters, `say` at most 280. `say` may hold a
  newline: a Morning decision card sends its title, then its brief's one-line form, and a lower third shows both.
- **No fighting cursors.** These are the rules the golden pins:
  - Publishing the spot that is already shared is an echo: no new rev, no event to fly by. The lead's newer words and
    hash are kept.
  - `sameSpot` compares the product and the target's kind and id. Where both places say a level, the levels must match.
    Where both hashes carry `at=`, those must match too, because two bays of one room differ only there. The words never
    make it another place. (The Personas follower note of 2026-10-30, §1, says `sameSpot` ignores the hash: it no
    longer does, since `0a9cbef`.)
  - A reader never applies its own write, applies a rev only once, and applies only the reader it follows (`toApply`).
  - Following yourself is refused (400), and so is following a reader nobody knows (404).
  - A reader is shown gone after 45 s unseen and forgotten after 24 h; at most 32 are kept. A lead that forgets stays
    the place's author.
  - A place with no level reads as feature L4, room L2, wing L1, site L0 (`levelOf`).
- **What a client must not do.**
  - It must not publish a place it was only sent. A follower that lands somewhere reports nothing until it rests, and
    an echo is harmless.
  - It must not publish a place in a product the server cannot open (404).
  - It must not poll faster than once a second; with bp down, back off (every 5 s) instead of failing each second.
  - A client that maps bp's places to its own (a bp room is a Personas bay) must not publish its mapped place back unless
    the mapping is lossless. A lossy round trip republishes another spot.
- **One focus host.** The record is `$BP_HOME/session/focus.json`, re-read when its mtime changes, but the event bus
  is per process. **apps/server is the canonical host**: the web, started with `BP_COMPANION_URL=<apps/server origin>`,
  hands every `/api/companion` and `/api/session` request to it (`apps/web/next.config.ts`), and BpLink and the
  stand-ins talk to it directly. A client uses the same base URL as the open bp page's companion, which is apps/server
  when one runs.

## 3. The Morning deck

- **Read.** `GET /api/companion/morning?since=<iso>` answers a `MorningDeck`; the window defaults to the last 16 hours,
  and a reader keeps its `since` for the whole morning. With `&view=agent` it answers the compact `AgentDeck`
  (`morning.brief` on the MCP door), which fits the door's 8000-character result cap. A card's `id` is stable across
  reads of one morning, so a reader keeps its card by id, never by index. Today's steered decisions keep their slots,
  marked `steered`. A product that cannot be read is named in `skipped`.
- **Steer.** `POST /api/companion/morning` with `{ product, proposal, verdict }` is the **human path only**: it needs the
  `x-bp-human` token, which bp hands only to its own same-origin page. `approve` writes the store through bp's
  `decide`. `defer` and `hold` are steering-log rows only. `decline` is taken only when the card's brief recommends it
  (a repeat of a declined idea), else 409.
- **A client decides through its own path.** Personas approves or declines through its own store path
  (`lens_scan_decide`), never through this route, and bp's next read shows the result. bp counts those decisions on the
  close card ("decided elsewhere").

## 4. The decision brief

- **Routes.** `GET /api/products/<slug>/proposals/<id>/brief` and `GET /api/companion/brief?product&feature&title[&lens]`
  (or `&id=`, the `plan.brief` tool) answer a `decision-brief-1` document.
- **Rules.**
  - A card flips to Decline only on identity: the attempt chain, the same external item, or the same proposal filed
    again on the same feature.
  - A likeness only asks: it shows the quote, and Approve stays the default.
  - `lines` is at most 5 lines of at most 120 characters, the one rendering every small surface shares.
  - `scan/brief.ts` is the source. A port computes the brief locally over its own copy of the store and the map, with
    no call to bp.

## 5. Guards and origins (every route above)

- **Loopback only.** Reads need a loopback `Host` (this stops DNS rebinding) and every `X-Forwarded-For` hop loopback.
  Writes also need a loopback `Origin` when one is sent, no `Sec-Fetch-Site: cross-site`, and
  `Content-Type: application/json`.
- **From Rust, not a webview.** A desktop client calls bp from its native side. **Never allow `tauri.localhost` as an
  origin, and never add CORS to these routes.** Every Tauri 2 app on the machine shares that origin, so allowing it would
  admit them all.
- **A paired headset** reaches the focus through the LAN door's `focus` scope, and speaks only as reader `vr:<device>`,
  whatever its body says.
- **Cards run on bp's own origin.** A companion card's request goes to the server's own bound origin, never to the origin
  a request's `Host` names. A client cannot redirect a card, or the token it carries, to another port.
- **Products by root.** A client that knows a repository by its directory finds its slug through `GET /api/products`
  (each entry has `slug`, `name` and `root`). It never derives the slug from the directory name. A slug matches
  `^[a-z0-9][a-z0-9-]{0,62}$`, the registry's own rule. Today the LAN door's route pattern still admits 64 characters
  (`{0,63}`, `apps/server/src/lan-door.ts`); the registry never issues such a slug, and the alignment is left to the
  LAN door's owner.
