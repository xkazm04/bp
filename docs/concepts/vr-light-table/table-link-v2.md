# Table link v2: the wire a headset codes against

Status: written 2026-11-09 (night run, S1, server side). This file is the contract. If the code and this file disagree,
the code is wrong or this file is stale: both are defects. Server code: `apps/server/src/` (`main.ts`, `mount.ts`,
`lan-door.ts`, `device-auth.ts`) and `packages/core/src/server/` (`decider.server.ts`, the routes under `api/`).

## 0. What changed on the owner's word (2026-11-09)

"We will need to implement ability to scan and watch scanners as in web app, ability to switch into real app, wire
'standups' as in web to establish daily plan with AI companion and let it handle the project - if connected to PC."
The owner also lifted the pairing gate tonight: the headset may reach the PC over Wi-Fi through the LAN door once paired
(desk-to-table/plan.md D1; standalone-plan.md D4 and S8). Three earlier rules are replaced, from 2026-11-09:

1. **Scans from VR on a live product.** A plain scan, a directed scan and an every-lens scan may start from the table on a
   live product (it was refused at the VR side: BpLink.cpp, BpMarks.cpp). The server never refused it by device; the LAN
   door already had `POST .../scans` under `scan`. New: `DELETE .../scans/<job>` (cancel) under `scan`.
2. **VR answers what the web's stand-up answers.** A Morning Watch verdict and a companion card answer, from a paired
   headset holding the `decide` scope. companion-link.md section 4 ("it never approves") is superseded by section 3 below.
3. **VR may grant the companion a time-boxed policy** ("let it handle the project"), bounded (section 3.4), and revoke one.

## 1. Conventions (once, for every route)

- **Absent values are omitted.** An optional field that has no value is left out of the JSON, never `null` and never `0`.
  `null` appears only where this file names it as a known "none" (`/lan/where`'s `door`, `window`).
- Every JSON write sends `Content-Type: application/json` (else 415 `{ error: "body must be application/json (Content-Type: ...)" }`).
- Errors are `{ "error": string }` with a 4xx/5xx status, unless this file names more fields.
- Times are ISO 8601 UTC strings with `Z` (`2026-11-09T21:04:05.123Z`).
- Two transports, one vocabulary:
  - **Tether (USB, `adb reverse tcp:3100 tcp:3100`)**: the headset calls `http://127.0.0.1:3100`. On the PC the peer is
    loopback, so every route is reachable as it is for any local program; the `Host` header must be a loopback name
    (`127.0.0.1:3100` or `localhost:3100`; libcurl sets it from the URL). A person's decision additionally needs the device
    token (section 2).
  - **LAN door (Wi-Fi)**: the headset calls `http://<pc-lan-ip>:3101` (the address comes from `GET /lan/where` over the
    tether, section 4, or from the owner). Every request except `POST /pair` and `POST /pair/claim` carries
    `Authorization: Bearer <token>` and must match a verb in section 5 under a scope the pairing holds. **Every refusal on
    the LAN door is the same bare 403** (empty body, `cache-control: no-store`, `connection: close`, after a 250 ms delay):
    the headset cannot tell "wrong scope" from "revoked" from "unknown path" there; use `GET /pair/me` to tell.
    Only `Content-Type` and `Accept` are forwarded from the headset, and on `POST /api/companion/listen` alone also
    `x-bp-speech-consent` and `Content-Length` (the route needs both; S3, 2026-11-10: before that, listen over Wi-Fi always
    answered 403 `no-consent`). Any `x-bp-device`, `x-bp-human`, `Cookie`, `Origin` or other header it sends is dropped and
    the door sets `Host`, `X-Forwarded-For` and `x-bp-device: <device>:<pairing id>` itself (`lan-door.ts` `FORWARDED`,
    `LISTEN_FORWARDED`; `check:lan-door` asserts the whole allow-list).
  - **The door's `Host` must be its own address and port exactly** (`<lan address>:3101`, which libcurl sets from the URL);
    any other `Host` (a DNS-rebound page in the PC's browser, a loopback name) is the bare 403 before the ceremony or a token
    is looked at. The door never answers CORS headers.
  - **Caps on the door** (S3 finding 7): at most 32 sockets (`MAX_CONNECTIONS`); at most 8 requests in flight from one peer
    address (`MAX_PEER_INFLIGHT`; past it the bare 403 at once, no delay held); the request head within 10 s and the whole
    request within 60 s (`HEADERS_TIMEOUT_MS`, `REQUEST_TIMEOUT_MS`: they bound what the headset SENDS, never the answer, so a
    600 s companion turn still streams whole). `paired.json` is stat'ed per request and parsed again only when it changed.
- `x-bp-device` on the tether: a request **with** a valid Bearer gets `x-bp-device` set from the pairing (whatever the
  headset sent is replaced). A request without a Bearer may still name itself in `x-bp-device` as before (the baton routes
  use it), but that name proves nothing and never makes a person's decision.

## 2. The device marker (who may make a person's decision)

Registry standards: `hitl-approval` (techniques **decision-records**, consent-gates) and `device-pairing` (techniques
**pairing-ceremony**, **token-binding-and-transport**, **verb-allowlists**, **revocation-and-expiry**).

- A person's decision (sections 3.1 to 3.5) needs one of:
  - the web page's `x-bp-human` token (unchanged: bp's own page only; surface `web`), or
  - **a paired headset's token whose pairing holds the `decide` scope** (surface `vr`). The token is the one the pairing
    ceremony minted (section 4); it is presented as `Authorization: Bearer <token>` on the tether or on the LAN door.
- How the server knows (pairing-ceremony: the owner's approve is the only mint gate, and `decide` is granted only when the
  owner's approve names it): apps/server authenticates the Bearer against `$BP_HOME/lan/paired.json` (re-read per
  request, constant-time over every row, expiry checked) on BOTH listeners, and when the pairing holds `decide` it adds an
  in-process header `x-bp-decider-seal` carrying a per-process secret (`decider.server.ts` `deciderSeal()`). The routes
  accept a device decision only with that seal plus `x-bp-device`. The seal never leaves the process: the loopback
  listener strips any `x-bp-decider-seal` a client sends, and the LAN door forwards only its allow-list (section 1).
- On the tether a Bearer that matches no live pairing answers **401** `{ "error": "device token unknown, expired or revoked: pair again" }`
  before any route runs (the headset should drop its token and re-pair). A missing Bearer is not an error: the request
  runs as a plain loopback caller and a person's decision is refused with **403**
  `{ "error": "a person's answer: needs the x-bp-human token from bp's own page, or a paired headset's token with the decide scope" }`.
- `apps/web` (:3010, Next) has no device path: it never sets the seal, so on :3010 only the web page decides. VR talks to :3100.
- Every device decision must say **what the headset showed** (decision-records: "what was shown"): body field `shown`,
  a string of 1..1000 characters (no control characters except newline, no C1 controls, no format characters such as
  bidi overrides and zero-width joiners (`\p{Cf}`), no U+2028/U+2029: S3 finding 8), the text the person read before the pinch.
  Missing or malformed from a device: **400** `{ "error": "a decision from the table must say what it showed: shown, 1..1000 characters" }`.
  From the web page `shown` is optional and recorded when sent.
- **Recorded**, every person's decision on these routes (web and vr), as one row of `$BP_HOME/companion/decisions.jsonl`
  (`decider.server.ts` `DecisionRecord`):
  `{ at, kind: "morning" | "card" | "policy-grant" | "policy-revoke", surface: "web" | "vr", device?, shown?, product?, target, verdict }`.
  The entity's own row carries the same marks in the same write as its state change (decision-records: "the write is part
  of the gate"): the steering-log row, the card row, the grant in `policies.json` (section 3).

## 3. A person's decisions (decide)

Types quoted by name: `Decider`, `DeciderMarks`, `DecisionRecord`, `VR_POLICY_BOUND` (packages/core/src/server/decider.server.ts);
`SteerRow` (packages/core/src/companion/morning.ts); `Card`, `PolicyGrant` (packages/core/src/companion/contract.ts).
`DeciderMarks = { surface: 'web' | 'vr'; device?: string; shown?: string }`.

### 3.1 Morning verdict: `POST /api/companion/morning`

- Body: `{ product: string, proposal: string, verdict: "approve" | "defer" | "hold" | "decline", shown: string }`.
- 200 `SteerRow & DeciderMarks`: `{ at, product, proposal, verdict, title, by, until?, warning?, note?, surface, device?, shown? }`
  from the table (`surface: "vr"`). A row the web page made keeps the plain `SteerRow` shape (no `surface`: the page's;
  the morning-deck-1 schema is strict), and `decisions.jsonl` records it as `surface: "web"`. The deck's `steered` rows are
  always the plain `SteerRow`.
  `decline` takes only a repeat of a declined idea (else 409). An approve also moves the finding in the store with the note
  `Morning Watch` (web) or `Morning Watch, from the table (<device>)` (vr).
- 400 bad body / no `shown` from a device; 403 not a person (above), or `BP_WRITES=off`; 404 unknown product or
  proposal; 409 already decided; 503 store or log unwritable.
- LAN scope: `decide`. Tether: Bearer with `decide`.

### 3.2 Card answer: `POST /api/companion/cards/<id>`

- Body: `{ decision: "approve" | "decline", shown: string }` (`CardAnswer` plus `shown`).
- 200 `Card & DeciderMarks` (the card's new row: `done` or `failed` with `result` after an approve, `declined` after a decline;
  `decidedBy: "human"`). 409 `{ error, card }` when it is no longer pending; 404 unknown card; 400 bad body.
- From the table, a card whose tool sets the owner's standing permissions (`rule.propose`, `policy.propose`) is refused
  **403** `{ "error": "<tool> sets the owner's standing permissions: answer it on bp's page" }` and stays pending.
- **An APPROVE from the table is bounded like a grant from the table** (S3 finding 1, 2026-11-10; `decider.server.ts`
  `outsideTableBound`): the card's tool is one of `VR_POLICY_BOUND.tools` (`decision.answer`, `finding.decline`,
  `scan.directed`, `wave.dispatch`), its args name exactly one product (never `*`, never a `slug` and a `product` that
  disagree), and every finding or wave package it names is tier 1 or milder, a finding with no tier or missing from the store
  counting as 0. Otherwise **403** `{ "error": "Answer this one at your PC: it is outside what the table may approve (<why>)" }`
  and the card stays pending for bp's page; `<why>` is one of `<tool> is not one of ...`, `it does not name exactly one
  product`, `its findings cannot be read`, `it touches a stop-ship or untiered finding`. Before this, any other pending card
  (a stop-ship `wave.dispatch`, `release.build`, `release.finish`, `release.draft`) ran from the table.
- A **decline** from the table is allowed for every card (declining runs nothing).
- An approved card from the table runs its tool WITHOUT the web's human token (the tool's own route signs the decision as
  usual); the card row says it came from `vr`.
- LAN scope: `decide`.

### 3.3 Policy list: `GET /api/companion/policies`

- 200 `(PolicyGrant & { grantedBy?: DeciderMarks })[]`, newest first; an expired grant stays listed (compare `expiresAt`).
- LAN scope: `standup`.

### 3.4 Policy grant: `POST /api/companion/policies`

- Body: `{ product: string, tools: string[], minTier?: 0 | 1 | 2 | 3, hours: number, shown: string }`.
- **A grant from the table is bounded** (`VR_POLICY_BOUND`), anything wider is refused **403**
  `{ "error": "a grant from the table is bounded: ...", "bound": VR_POLICY_BOUND }`:
  - `product`: one product slug (live or `kettle`), never `"*"`;
  - `tools`: a subset of `["decision.answer", "finding.decline", "scan.directed", "wave.dispatch"]` (never the release
    tools, `rule.propose` or `policy.propose`);
  - `minTier`: required, 1, 2 or 3 (a grant from the table never covers a stop-ship finding, tier 0);
  - `hours`: `0 < hours <= 12`.
- 201 `PolicyGrant & { grantedBy: DeciderMarks; hours: number }`:
  `{ id, product, tools, minTier?, expiresAt, createdAt, grantedBy: { surface, device?, shown? }, hours }`. `tools` are
  dotted catalog names; `expiresAt` is exactly `createdAt + hours`. The headset shows `tools`, `product`, `minTier` and
  `expiresAt` from this answer, never from what it asked.
- **One table grant per product** (S3 finding 6): a new grant from the table replaces, in the same write, any earlier grant
  the table made on that product (`grantedBy.surface: "vr"`), so a renewal never stacks. The 201 then also carries
  `replaced: string[]` (the ids it removed), and the decision record's verdict says `replacing <ids>`. Grants made on bp's
  page are never replaced by the table. A headset can still hold one live grant on each product.
- `minTier` everywhere (table and page): a finding with no tier, or one the store does not hold, counts as tier 0, so a floor
  of 1..3 never covers it (it used to be left out of the test).
- The web keeps its wider limits (`hours <= 720`, any GATED tool except `policy.propose`, `"*"` allowed).
- 400 bad body (unknown or AUTO tool, bad hours); 404 unknown product. LAN scope: `decide`.

### 3.5 Policy revoke: `DELETE /api/companion/policies/<id>`

- No body. 200 `{ id }`; 404 `{ error: "no policy <id>" }`. A table may revoke any grant (revoking only narrows).
- Recorded as `kind: "policy-revoke"`. LAN scope: `decide`.

### 3.6 Store decisions (unchanged)

`POST /api/products/<slug>/proposals/<id>/approve`, `.../proposals/<id>/decline`, `.../proposals/approve` keep their
rules (BpLink.h); LAN scope `decide`.

### 3.7 What the decisions became: the `outcomes` card (`GET /api/companion/morning`, added 2026-11-10, ES1)

The owner's pick E: "the morning shows what yesterday's approvals became (built or failed, with before and after screens on
the table)". The morning deck (morning-deck-1) gains one card kind, additive: `cardKind` gains `"outcomes"` (appended to the
enum), `morningCard` gains the optional `outcomes`, and `$defs.outcome` is new. Nothing was renamed, removed or reordered.

- **Where**: at most one per product, after `open` (and `agents`) and before every product's `built` card. LAN scope:
  `standup` (the deck's own).
- **The card**: the deck's usual fields (`id: "outcomes:<slug>"`, `kind: "outcomes"`, `product`, `productName`, `headline`,
  `lines`, `tone`, `place?`) plus `outcomes: Outcome[]`, 1 to 8, newest decision first. `lines` holds one plain line per
  outcome (`<title>: built (<commit>)`, `<title>: failed - <reason>`, `building now`, `approved, not built yet`) for a reader
  that shows text only; `place` is the room most of them sit in (L2).
- `headline`: a count in words, `"<n> approved yesterday on <product>: 2 built, 1 failed"` (`"this week"` when one is older
  than 48 h; `"2 approved yesterday on <product>, not built yet"` when none was built). `tone`: `bad` if any failed, else
  `warn` if any waits, else `calm` if any is building, else `good`.
- **`Outcome`** (`packages/core/src/companion/outcomes.ts`; absent values are omitted, never null or empty):

  | field | type | meaning |
  | --- | --- | --- |
  | `proposal` | string | the proposal id the person approved |
  | `title` | string | its title as the store has it now |
  | `room?` | string | the room id on the plan, when its feature maps to one (as decision cards resolve it) |
  | `decided_at` | ISO string | the approval's `at` (an event time: the decision log's row) |
  | `decided_by` | `"web"` \| `"vr"` | the row's surface (a steering-log row with no `surface` is the page's) |
  | `outcome` | `"built"` \| `"failed"` \| `"building"` \| `"waiting"` | below |
  | `reason?` | string, at most 160 | failed only: the failure record's stage and reason in one sentence |
  | `commit?` | string | built only: the short sha (7) when the store has one |
  | `wave?` | string | the wave id: the job's wave, else the newest wave whose package names it |
  | `before?`, `after?` | string, `.png`/`.jpg`/`.webp` | the proposal's `Shot.path` for that phase (light theme first, then newest) |

- **`outcome`**: `built` = the store says `done`, or a later triage or release of a built item (`accepted`, `rework`,
  `released`); `failed` = `failed`; `building` = `executing`, or a `queued`/`running` execute job in the job journal names it
  (a journal line older than 12 h is a process a restart lost, not a build); `waiting` = approved and nothing builds it yet
  ("approved, not built yet": an approval does not queue a build; a wave or `/dispatch` does).
- **Which decisions**: approve rows for the product from `$BP_HOME/companion/decisions.jsonl` (kind `morning`) and the
  product's own steering log, at most 7 days old and before the deck's window (`since`); one per proposal, its latest
  approve before the window. Dropped: a proposal whose latest row (any time, this morning included) is a hold, defer or
  decline; one the store has declined, descoped or reopened; one that no longer exists. A card answer (`kind: "card"`)
  records the card's id, not a proposal, so it is not an approval here.
- **The screens**: a live product's `before`/`after` is a store path (`shots/<run>/<file>.png`): fetch it as
  `GET /api/products/<slug>/shots/<path without the leading shots/>` (png, jpg, webp only). The bundled Kettle sample's are
  bare file names (`finding-kf-011.png`, `finding-kf-011-after.png`): read them from the bundle's `kettle/shots/` folder (the
  PC serves the same names at `/api/products/kettle/shots/<file>`, section 7).
- **The sample** (`apps/vr/Content/BpData/kettle/morning.json`, `bundle-morning.ts`): three approvals made from the table
  yesterday morning: `kf-011` and `kf-041` built (each with a generated before and after screen), `kf-045` failed ("A check
  failed after the change: the new end-to-end test still fails because the total stays at 120.00 with the promo code
  applied."), all in wave `w-sample-yesterday`. Live will often say "approved, not built yet".
- The agent view (`view=agent`) carries the card with its `lines` only (no `outcomes` array).

## 4. Pairing (device-pairing: pairing-ceremony, token-binding-and-transport, revocation-and-expiry)

The server must run with `--lan` (LAN listener on :3101 plus the ceremony) or `--pair` (the ceremony on the tether only,
no LAN listener), or have the door switched on from bp's Headsets page for this run (section 13). Without any of these,
the ceremony routes answer 404 and only an existing token works on the tether.
The numbers: code 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; a request lives 120 s (`PAIR_TTL_MS`); an approved
pairing waits 120 s for its claim (`CLAIM_TTL_MS`); a token lives 30 days unless the owner says fewer (`--days 1..30`);
at most 4 pending requests and 8 pairings. A pairing window (120 s) is open at server start when nothing is paired, and
again after OPEN PAIRING on the Headsets page or `npm run server -- pair open`. Requests outside a window are refused.
Five wrong codes in a row at the owner's approve (the page and the CLI count together; a right code resets the count)
cancel every open request and shut the window (`MAX_WRONG_CODES`).

| Step | Who | Call | Answer |
| --- | --- | --- | --- |
| 1 | headset (tether) | `GET http://127.0.0.1:3100/lan/where` | 200 `{ door: { address: string, port: number } \| null, listening: boolean, window: string \| null, pairing: boolean }` |
| 2 | headset (tether or LAN) | `POST /pair` `{ nonce, device, scopes? }` | 201 `{ state: "pending", code, expiresAt }`; a retry with the same nonce: 201 pending or 200 `{ state: "approved", code, expiresAt }` |
| 3 | headset | shows `code` on the lamp's tag | |
| 4 | owner on the PC | bp's Headsets page (`/headsets`): types the code, ticks the permissions, APPROVE (section 13); or `npm run server -- pair approve <code> --scope standup,place,focus,decide,scan` | `decide`, `scan` and `onboard` are granted ONLY when ticked or named here |
| 5 | headset, every 2 s | `POST /pair/claim` `{ nonce }` | 202 `{ state: "pending" }`; then 200 `{ token, device, scopes, expiresAt }` exactly once; again: 410 `{ state: "claimed" }` |
| 6 | headset | keeps `token` (and `device`, `scopes`, `expiresAt`) | |
| 7 | headset, at launch and every minute | `GET /pair/me` with Bearer | 200 `{ device, scopes, expiresAt }`; revoked/expired: 401 on the tether, bare 403 on the LAN |
| 8 | owner | REVOKE on the Headsets page, or `npm run server -- pair revoke <id>` (`pair list` shows ids) | the next request with that token is refused; requests in flight on the LAN door are cut |

- `nonce`: 22..128 characters of `[A-Za-z0-9_-]` (128 bits or more, from the headset's own RNG; never reused).
  `device`: 1..40 of `[A-Za-z0-9_.-]` (e.g. `quest3s`). `scopes`: a subset of
  `["read","standup","place","focus","decide","scan","onboard"]`, default `["read"]` (`onboard`: section 14).
- Step 2 and 5 must come from the same transport and peer: a request made over the tether is claimed over the tether.
- **The code is shown on the requesting device only** (S3 finding 5, 2026-11-10). The server's log line says that a request
  arrived, from which peer, under which claimed device name and for which scopes, and that its code is on that device's
  screen; it never prints the code, and neither does `pair list` (it lists open requests by device and peer). The owner types
  the code the headset shows; `pair approve` prints the device name and peer it approved.
- **One open request per peer.** A new `POST /pair` (a new nonce) from a peer that already has an open request replaces that
  request (the same device asking again, e.g. after an app restart); the old code then approves nothing (404). So one LAN host
  holds at most one of the 4 pending slots and cannot lock the real headset out. Codes are unique among open requests by
  construction, so a code names exactly one request (and through it, one peer). Over the tether every request is the peer
  `loopback`, so the tether too holds one open request at a time.
- A token is bound to the pairing (its fingerprint in `paired.json`), not to the transport: one token works on the tether
  and on the LAN door. The claimed `device` string (`<device>:<pairing id>`) is the id every decision records.
- Refusals in the ceremony: on the LAN door, the bare 403; on the tether, 403 `{ error: "pairing refused: <cause>" }`
  where cause is one of `pair-body`, `pair-repeat`, `no-window`, `pending-cap`, `claim-unknown`, `claim-denied`, `paired-cap`.
- `/lan/where` is loopback-only (the LAN door has no such verb): `door` is null without `--lan`; `address` is the one
  IPv4 address the door binds (the first private-range interface, or `--lan-host`); `listening` says whether :3101 is up
  right now (it closes when nothing is paired and no window is open); `window` is the open window's end or null;
  `pairing` says whether `/pair` is served at all (`--lan` or `--pair`).

## 5. The LAN door's verbs (section 1's rules apply; `SLUG` = `[a-z0-9][a-z0-9-]{0,62}`, `ID` = `[A-Za-z0-9_.-]{1,80}`)

`standup` includes `read`. `any` = any live pairing, whatever its scopes. A query is allowed only where shown.

| Scope | Method | Path | Notes |
| --- | --- | --- | --- |
| any | GET | `/api/health` | liveness, section 6 |
| any | GET | `/pair/me` | section 4 step 7 |
| read | GET | `/api/products` | `ProductEntry`-based list (live products; Kettle is not listed) |
| read | GET | `/api/products/<SLUG>/structure`, `/plan`, `/scan`, `/scans`, `/waves`, `/focuses` | as before; `/plan` also takes exactly `layout=islands` (the table's layout, 2026-11-10) |
| read | GET | `/api/products/<SLUG>/scans/<ID>` | kept, but the route has no GET (405); read `/scans` |
| read | GET | `/api/products/<SLUG>/proposals/<ID>/brief` | as before |
| read | GET | `/api/products/<SLUG>/shots/<ID>[/<ID>]{0,4}` | png/jpg/webp bytes; Kettle from the sample shots (section 7) |
| standup | POST | `/api/companion/turn` | as before; per paired device at most one turn in flight and 6 a minute (section 12). G1 (2026-11-11): the body also takes `surface: { kind: "vr", place?, target?, product?, spoken? }` (where the person is, beside their words; `target` is what "this one" means), the stream carries `card` and `focus` events, and a `done` end may carry `replies: [{ label, say }]` (at most 3; a press sends `say` as the next turn). Contract: companion-link.md section 2 |
| standup | GET | `/api/companion/focus`, `/api/companion/cards` | as before |
| standup | GET | `/api/companion/morning` | query: none, or `since=<iso>` and/or `opened=<iso>` (chars `0-9TZ:.-`) |
| standup | GET | `/api/companion/inbox` | query: none or `limit=<1..500>` |
| standup | GET | `/api/companion/policies` | section 3.3 |
| standup | POST | `/api/companion/listen`, `/api/companion/say` | the voice routes (voice-link.md): `say` takes `{ text }` and answers `audio/wav`; `listen` takes an `audio/wav` body with `Content-Length` and `x-bp-speech-consent: cloud`, which the door forwards on this verb only; a daily budget per device (voice-link.md) |
| place | GET | `/api/session/place?claim=1`; POST `/api/session/place`, `/api/session/place/return` | as before |
| focus | GET, POST | `/api/session/focus` | as before |
| decide | POST | `/api/products/<SLUG>/proposals/<ID>/decline`, `.../proposals/<ID>/approve`, `.../proposals/approve` | as before |
| decide | POST | `/api/companion/morning` | section 3.1 |
| decide | POST | `/api/companion/cards/<ID>` | section 3.2 |
| decide | POST | `/api/companion/policies` | section 3.4 |
| decide | DELETE | `/api/companion/policies/<ID>` | section 3.5 |
| scan | POST | `/api/products/<SLUG>/scans` | plain `{ lens, scope }`, directed `{ lens, scope, focus }`, every lens `{ lens: "all", scope: { kind: "all", label, features: [] }, phase?: "measure" \| "propose" }`; 202 `ScanJob` (packages/core/src/scan/jobs.ts) |
| scan | DELETE | `/api/products/<SLUG>/scans/<ID>` | cancel; 200 `ScanJob`; 404 unknown job |
| read | GET | `/api/onboarding` | no query; section 14 |
| read | GET | `/api/products/<SLUG>/onboarding/feed` | query exactly `after=<1..9 digits>&job=<ID>`, optionally followed by `&layout=islands` (the VR app's two forms); section 14 |
| onboard | GET | `/api/onboarding/candidates` | section 14 |
| onboard | POST | `/api/onboarding/start` | section 14: a paid agent run, no confirmation at the PC |

Never reachable through the door: `GET /api/companion/human-token`, the plan's free decide `POST .../proposals/<id>`,
`.../dispatch`, `.../waves/<w>/dispatch`, release build/finish/tag, `/api/companion/stream` (SSE: VR polls), `/lan/*`,
`/athena*`.

Watching scanners: poll `GET /api/products/<slug>/scans` (every 2 s while a job is `queued` or `running`, else every 15 s)
and `GET /api/products/<slug>/scan` for the findings.

## 6. Liveness: `GET /api/health`

- 200 `{ ok: true, boot: string, at: string }` (`Health`, packages/core/src/server/api/health/route.ts). `boot` is a random
  id minted once per server process: when it changes, the PC restarted (the baton, the Kettle sims and the jobs list
  are gone; read them again). `cache-control: no-store`. Cheap: no file is read.
- Tether: plain GET. LAN: Bearer, any scope. Poll every 5 s while disconnected, every 30 s while connected.
- No answer (connection refused, timeout 2 s) = the PC is away.

## 7. Kettle shots: `GET /api/products/kettle/shots/<file>`

- While no registered product is named `kettle`, the built-in sample serves its shots from `apps/web/public/sample-shots/`
  (e.g. `finding-<proposalId>.png`, another builder's files). `content-type` `image/png`, `image/jpeg` or `image/webp`;
  `cache-control: private, max-age=3600`.
- 403 `{ error: "path outside the shots directory" }` for `..`, `.`, empty, absolute, drive or separator-smuggling
  segments, NUL, and symlinks out; 404 `{ error: "no such shot" }`; 415 `{ error: "not an image" }` (e.g. the `.svg` files).
- A live product: unchanged (`<store>/shots/...`).

## 8. What the headset must do first

1. Over the tether: `GET /api/health`, then `GET /lan/where`.
2. Pair (section 4) asking for `["standup","place","focus","decide","scan"]`; show the code; poll the claim; store the token.
3. Send `Authorization: Bearer <token>` on EVERY request, tether and LAN alike (the tether's decisions need it).
4. Every decision body carries `shown`.

## 9. Real answers (smoke, 2026-11-09)

`npm run server -- --port 3200 --lan --lan-port 3201` with `BP_HOME` and `BP_PRODUCTS_FILE` in a scratch dir (the
`scripts/morning-demo.mjs` portfolio), the LAN door on `10.0.0.143:3201`; tokens shown as `<token>`, long bodies cut.
Proof in code: `npm run check:table-link` (151 expectations since S3, 2026-11-10) and `npm run check:lan-door`.

```
$ curl http://127.0.0.1:3200/api/health
{"ok":true,"boot":"f77e5dbe8382d6bd","at":"2026-11-09T20:30:56.922Z"} [200]
$ curl http://127.0.0.1:3200/lan/where
{"door":{"address":"10.0.0.143","port":3201},"listening":true,"window":"2026-11-09T20:32:56.697Z","pairing":true} [200]
$ curl -X POST http://127.0.0.1:3200/pair -d '{"nonce":"<nonce>","device":"quest3s","scopes":["standup","place","focus","decide","scan"]}'
{"state":"pending","code":"ZJPKHR","expiresAt":"2026-11-09T20:32:59.202Z"} [201]
$ curl -X POST http://127.0.0.1:3200/pair/claim -d '{"nonce":"<nonce>"}'
{"state":"pending"} [202]
$ npm run server -- pair approve ZJPKHR --scope standup,place,focus,decide,scan --port 3200
approved quest3s at loopback: standup,place,focus,decide,scan for 30 days, once it claims its token (2 min).
$ curl -X POST http://127.0.0.1:3200/pair/claim -d '{"nonce":"<nonce>"}'
{"token":"<token>","device":"quest3s:3fce56bf","scopes":["standup","place","focus","decide","scan"],"expiresAt":"2026-12-09T20:31:02.668Z"} [200]
$ curl http://10.0.0.143:3201/pair/me -H 'authorization: Bearer <token>'
{"device":"quest-lan:f2df8d4c","scopes":["read","standup","decide","scan"],"expiresAt":"2026-12-09T20:31:07.375Z"} [200]
$ curl http://10.0.0.143:3201/api/health -H 'authorization: Bearer <token>'
{"ok":true,"boot":"f77e5dbe8382d6bd","at":"2026-11-09T20:31:11.750Z"} [200]
$ curl http://10.0.0.143:3201/api/products -H 'authorization: Bearer <token>'
[{"slug":"kettle-web","name":"Kettle Web","root":"...","live":true,"readiness":{...},"setup":[...]},...] [200]
$ curl 'http://10.0.0.143:3201/api/companion/morning?since=2026-11-01T00:00:00Z' -H 'authorization: Bearer <token>'
{"since":"2026-11-01T00:00:00.000Z","until":"2026-11-09T20:31:13.686Z","products":[...],"cards":[...]} [200]
$ curl 'http://10.0.0.143:3201/api/companion/inbox?limit=5' -H 'authorization: Bearer <token>'
{"items":[{"product":"kettle-web","id":"find-kettle-web-1","kind":"proposal","title":"...","tier":0,"ageMs":7985882,"rank":1},...],"skipped":[]} [200]
$ curl http://10.0.0.143:3201/api/companion/cards -H 'authorization: Bearer <token>'
[] [200]
$ curl http://10.0.0.143:3201/api/companion/policies -H 'authorization: Bearer <token>'
[] [200]
$ curl http://10.0.0.143:3201/api/products/kettle/focuses -H 'authorization: Bearer <token>'
{"focuses":[{"id":"focus-2","lens":"design","note":"...","created_at":"2026-11-09T20:31:17.483Z"},...]} [200]
$ curl http://10.0.0.143:3201/api/products/kettle/scans -H 'authorization: Bearer <token>'
[] [200]
$ curl -X POST http://10.0.0.143:3201/api/companion/morning -H 'authorization: Bearer <token>' -d '{"product":"kettle-web","proposal":"find-kettle-web-1","verdict":"approve","shown":"Approve the top blocker?"}'
{"at":"2026-11-09T20:31:20.260Z","product":"kettle-web","proposal":"find-kettle-web-1","verdict":"approve","title":"...","by":"user:morning-demo","surface":"vr","device":"quest-lan:f2df8d4c","shown":"Approve the top blocker?"} [200]
$ curl -X POST http://127.0.0.1:3200/api/companion/morning -H 'authorization: Bearer <token>' -d '{"product":"kettle-phone","proposal":"find-kettle-phone-1","verdict":"defer","shown":"Defer it?"}'
{"at":"...","product":"kettle-phone","proposal":"find-kettle-phone-1","verdict":"defer","title":"...","by":"user:morning-demo","until":"2026-11-10T16:31:21.347Z","surface":"vr","device":"quest3s:3fce56bf","shown":"Defer it?"} [200]
$ curl -X POST http://127.0.0.1:3200/api/companion/morning -d '{"product":"kettle-desk","proposal":"find-kettle-desk-1","verdict":"hold","shown":"Hold it?"}'
{"error":"a person's answer: needs the x-bp-human token from bp's own page, or a paired headset's token with the decide scope"} [403]
$ curl -X POST http://10.0.0.143:3201/api/companion/cards/card_0mw9pv4q00174cb -H 'authorization: Bearer <token>' -d '{"decision":"decline","shown":"Decline this card?"}'
{"id":"card_0mw9pv4q00174cb","tool":"finding.decline","args":{...},"summary":"...","product":"kettle-desk","state":"declined","createdAt":"...","decidedBy":"human","surface":"vr","device":"quest-lan:f2df8d4c","shown":"Decline this card?"} [200]
$ curl -X POST http://10.0.0.143:3201/api/companion/policies -H 'authorization: Bearer <token>' -d '{"product":"kettle-web","tools":["decision.answer"],"hours":24,"minTier":1,"shown":"x"}'
{"error":"a grant from the table is bounded (one product; tools decision.answer, finding.decline, scan.directed, wave.dispatch; minTier 1..3; at most 12 hours); refused: 24 hours","bound":{"tools":[...],"minTier":[1,2,3],"maxHours":12,"product":"one product slug, never *"}} [403]
$ curl -X POST http://10.0.0.143:3201/api/companion/policies -H 'authorization: Bearer <token>' -d '{"product":"kettle-web","tools":["decision.answer","scan.directed"],"hours":4,"minTier":1,"shown":"Let it approve tier 1+ and run directed scans on kettle-web for 4 h?"}'
{"id":"pol_0mw9pv75q02e8d2","product":"kettle-web","tools":["decision.answer","scan.directed"],"minTier":1,"expiresAt":"2026-11-10T00:31:26.462Z","createdAt":"2026-11-09T20:31:26.462Z","grantedBy":{"surface":"vr","device":"quest-lan:f2df8d4c","shown":"..."},"hours":4} [201]
$ curl -X DELETE http://10.0.0.143:3201/api/companion/policies/pol_0mw9pv75q02e8d2 -H 'authorization: Bearer <token>'
{"id":"pol_0mw9pv75q02e8d2"} [200]
$ curl -X POST http://10.0.0.143:3201/api/products/kettle/scans -H 'authorization: Bearer <token>' -d '{"lens":"development","scope":{"kind":"all","label":"everything","features":[]}}'
{"id":"sim-1","kind":"measure","lens":"development","scope":{...},"status":"running","queued_at":"...","started_at":"...","run_id":"run-sim-1"} [202]
$ curl -X DELETE http://10.0.0.143:3201/api/products/kettle/scans/sim-1 -H 'authorization: Bearer <token>'
{"id":"sim-1",...,"status":"cancelled",...,"ended_at":"2026-11-09T20:31:29.584Z"} [200]
$ curl -X POST http://10.0.0.143:3201/api/products/kettle/scans -H 'authorization: Bearer <token>' -d '{"lens":"all","scope":{"kind":"all","label":"everything","features":[]}}'
{"error":"unknown-lens"} [400]          (Kettle's sim has no every-lens job; a live product queues one, 202)
$ curl -X POST http://10.0.0.143:3201/api/companion/say -H 'authorization: Bearer <token>' -d '{"text":"hello"}'
RIFF....WAVE... [200 audio/wav]          (the voice builder's route, landed tonight)
$ curl -X POST http://10.0.0.143:3201/api/companion/listen -H 'authorization: Bearer <token>' -d '{}'
{"error":"body must be audio/wav (Content-Type: application/json)"} [415]   (it takes a WAV body)
$ curl http://10.0.0.143:3201/api/products/kettle/shots/des1-card-after-dark.svg -H 'authorization: Bearer <token>'
{"error":"not an image"} [415]
$ curl http://10.0.0.143:3201/api/products/kettle/shots/finding-none.png -H 'authorization: Bearer <token>'
{"error":"no such shot"} [404]
$ curl 'http://127.0.0.1:3200/api/products/kettle/shots/..%2Fpackage.json'
{"error":"path outside the shots directory"} [403]
$ curl http://10.0.0.143:3201/api/companion/human-token -H 'authorization: Bearer <token>'
(empty) [403]                             (never a LAN verb)
$ npm run server -- pair revoke 3fce56bf --port 3200
revoked 3fce56bf (its requests in flight were cut)
$ curl http://127.0.0.1:3200/pair/me -H 'authorization: Bearer <token>'
{"error":"device token unknown, expired or revoked: pair again"} [401]
$ curl http://127.0.0.1:3200/api/health -H 'authorization: Bearer <token>'
{"error":"device token unknown, expired or revoked: pair again"} [401]
```

`$BP_HOME/companion/decisions.jsonl` after that run (one row per decision, none for the refused ones):

```
{"at":"2026-11-09T20:31:20.506Z","kind":"morning","surface":"vr","device":"quest-lan:f2df8d4c","shown":"Approve the top blocker?","product":"kettle-web","target":"find-kettle-web-1","verdict":"approve"}
{"at":"2026-11-09T20:31:21.373Z","kind":"morning","surface":"vr","device":"quest3s:3fce56bf","shown":"Defer it?","product":"kettle-phone","target":"find-kettle-phone-1","verdict":"defer"}
{"at":"2026-11-09T20:31:24.556Z","kind":"card","surface":"vr","device":"quest-lan:f2df8d4c","shown":"Decline this card?","product":"kettle-desk","target":"card_0mw9pv4q00174cb","verdict":"decline"}
{"at":"2026-11-09T20:31:26.465Z","kind":"policy-grant","surface":"vr","device":"quest-lan:f2df8d4c","shown":"Let it approve tier 1+ and run directed scans on kettle-web for 4 h?","product":"kettle-web","target":"pol_0mw9pv75q02e8d2","verdict":"grant decision.answer,scan.directed tier 1+ until 2026-11-10T00:31:26.462Z"}
{"at":"2026-11-09T20:31:27.676Z","kind":"policy-revoke","surface":"vr","device":"quest-lan:f2df8d4c","product":"kettle-web","target":"pol_0mw9pv75q02e8d2","verdict":"revoke"}
```

With `--pair` instead of `--lan`: `GET /lan/where` answers `{"door":null,"listening":false,"window":"...","pairing":true}`
and `POST /pair` works on the tether.

## 10. The headset's side (night two W2a, BpLink)

What `apps/vr/Source/BpLink` does with this contract; `npm run check:bplink` pins its requests against a live `--pair` server
(the keys each link function reads must be in the answers; every request but the ceremony's own two starts at `NewRequest`).

- **The route**, in order: an explicit `-BpLinkUrl` (or `BP_LINK_URL`; `bundle` reads the sample only); the cable
  (`http://127.0.0.1:3100`, saved as `CableUrl`; `-BpLinkCable=` moves it for a PC check, unsaved) if `GET /api/health`
  answers; the saved Wi-Fi door (learned from `GET /lan/where`, only with a token) if it answers; else the build's bundled
  sample. Health is asked every 5 s while on the sample and every 15 s while linked (timeout 2 s); a door that does not answer
  backs off 5 s doubling to 60 s. Two misses in a row fall back to the sample (said once); the PC coming back is linked
  without a restart; a new `boot` reads everything again (product, scans, products, shared focus).
- **The token** is kept in the app's own file `Saved/BpTable.json` (`FBpStore`, section `/Script/BpLink.BpLinkSettings`: `Token`,
  `Device`, `Scopes`, `ExpiresAt`, `CableUrl`, `WifiUrl`), not GameUserSettings.ini, which the engine deletes at the next launch
  on the Quest (2026-11-10); shown as its last 4 characters, never logged. It goes out as `Authorization: Bearer` on every request
  except `POST /pair` and `POST /pair/claim`. A 401 on the tether, or the door's bare 403 on `/api/health` or `/pair/me`, forgets
  it and the console says "pair again". `UNPAIR` forgets it here only; `pair revoke <id>` ends it on the PC. On the headset the
  token sits in the app's private storage in plain text (no Android keystore yet): a recorded deviation, like the cleartext wire.
- **Android and cleartext**: nothing was added to the manifest. UE 5.8's Android HTTP is libcurl over native sockets
  (`HTTP.Build.cs` links libcurl for the Android group; `AndroidPlatformHttp.cpp` creates `FCurlHttpManager`/`FCurlHttpRequest`),
  and Android's `usesCleartextTraffic` / network security config is honoured only by the Java stack (`NetworkSecurityPolicy`), so
  it does not apply. UE's manifest already holds `INTERNET`, `ACCESS_NETWORK_STATE` and `ACCESS_WIFI_STATE`. Adding
  `usesCleartextTraffic` would widen the Java side for nothing. **The token travels in cleartext on the LAN** (section 11).
- **Fixed (night two W2b):** the LAN door's `GET .../plan` verb takes exactly `?layout=islands` (or no query), under `read`,
  so over Wi-Fi BpLink asks `/plan?layout=islands` as on the cable and draws the same islands; `check:lan-door` holds the
  query (exactly that, nothing wider) and the body through the door. `/stream`, `/api/onboarding` and `.../onboarding/feed`
  are not door verbs: over Wi-Fi the table shows no onboarding.
- **The stand-up (night two W2b)** reads `GET /api/companion/morning?since=<last stand-up>` (or the build's sample deck,
  `Content/BpData/kettle/morning.json` from `apps/vr/tools/bundle-morning.ts`, saying it is a sample and sending nothing), sends
  each verdict with `shown` = the card's title and its brief's one line, answers companion cards with `shown`, grants only the
  fixed bound (the card's product, the four tools, `minTier` 1, 8 hours; BpLink refuses anything wider before sending) and
  shows the grant from the server's 201 body, revokes with `DELETE`. A finding's `before` screen is read from the bundle's
  `shots/` or `GET .../shots/<path>` (cached under `Saved/BpShots/`). The companion turn's request lasts 600 s with the same
  activity limit (the engine's default 30 s activity timeout cut every silent model turn).
- **SHOW ON PC** sends `POST /api/session/place` (scope `place`); with no baton claimed (409) the place goes out as the shared
  focus (`POST /api/session/focus` publish), which the web follows.

## 11. Residual risks (plain words)

- **A program on the PC can still decide.** The human token's own residual (door.server.ts) stands: any local program can
  forge the browser headers, and it can also run the `pair` CLI's loopback routes and approve a pairing for itself (the
  Headsets page's routes need the page's token, which such a program can fetch the same way; section 13). The
  device marker guards against the companion agent (which has no shell and never sees a token) and against the LAN, not
  against something already running as the owner on the PC. A loopback script with no token is refused exactly as before.
- **The token travels in cleartext** over Wi-Fi (S8's recorded deviation; TLS is the follow-up). Anyone who sniffs the home
  network can replay it until it is revoked or expires. The binding is the token plus the private-range class.
- **A stolen headset decides** until `pair revoke`. The VR grant bound (12 h, tier 1+, four tools, one product, one live
  table grant per product) caps what one stolen session can hand the agent, and since S3 (2026-11-10) the same bound caps
  what it can approve through a card (3.2), what a card its turns file can run under (section 12), and what its turns and
  voice calls can spend (section 12, voice-link.md).
- **A repository's own text can steer the adopt run** (S4, 2026-11-10; prompt-safety: "the last fence is capability, not
  text"). Since S4 the run loads no configuration of the folder it reads (its hooks, `.mcp.json` servers and `CLAUDE.md`:
  section 12, deviation 15), but it still reads the folder's files with permissions skipped, so instructions planted in
  them are read by an agent that can run commands as the owner. A PC-started run shares it; since the PC confirm (section
  14) no headset-asked run starts without the owner's click.
- **The decision record and the entity row are two writes** for the cross-cutting `decisions.jsonl`; the entity's own row
  (steering log, card, grant) carries the marks atomically. A failed `decisions.jsonl` append is logged, not fatal.

## 12. The door after review (S3, 2026-11-10)

Registry standards: `device-pairing` (admission-scoping, pairing-ceremony, verb-allowlists), `authorization`,
`hitl-approval` (consent-gates) and `rate-limiting` (key-design, refusal-contract). A read-only review read every handler;
what changed, with its numbers (each held by `check:table-link`, `check:lan-door`, `check:voice-link` or
`check:companion-door`):

- **Card answers** are bounded from the table (3.2), and `minTier` counts an untiered or unknown finding as 0 (3.4).
- **One table grant per product**: a renewal replaces, never stacks (3.4).
- **The companion turn from a device** (`packages/core/src/server/table-bound.server.ts`): a request carrying a paired
  device's `x-bp-device` (apps/server sets it from the token on both listeners) may have **one turn in flight** and start
  **6 turns a rolling minute** (`TURN_RATE_PER_MINUTE`; a spoken exchange at the table is hold, speak, wait, listen: one
  every several seconds at the very most). Past either: **429**
  `{ "error": "one question at a time from the table: wait for the answer to the last one" | "the table asked 6 questions in the last minute: wait <n> s", "limit": "6 a minute, one at a time, per paired device", "retryAfterS": number }`
  with `Retry-After`. The page and plain loopback callers (no device) are not limited by it. A fresh `conversationId` no
  longer dodges anything: the key is the device, not the conversation.
- **Cards a device-driven turn files**: while a device's turn runs, its conversation is marked; a card the agent files from
  that conversation (`x-bp-conversation`, set by the MCP process) runs at once only under a policy grant the table itself
  could have made (`grantWithinTableBound`: one product, the bound's tools, `minTier` 1..3, at most 12 hours long). A wider
  grant made at the PC, or a standing rule grant (`bp-rules.json`), does not reach it: the card waits for a person. A card
  that ran under a grant is signed by that grant (the route re-checks that THIS grant still covers it).
- **Pairing**: the code is never logged, one open request per peer, `Host` must be the door's own (section 4, section 1).
- **Door caps**: 32 sockets, 8 in flight per peer, head 10 s, request 60 s, the registry parsed only when it changed (section 1).
- **Voice**: a daily budget per device and a capped answer cache (voice-link.md).

### What the headset may now meet that it did not before

| Where | Status | Body |
| --- | --- | --- |
| `POST /api/companion/cards/<id>` approve | 403 | `{ error: "Answer this one at your PC: it is outside what the table may approve (<why>)" }` |
| `POST /api/companion/policies` | 201 | may carry `replaced: string[]` |
| `POST /api/companion/turn` | 429 | `{ error, limit, retryAfterS }` (words above) |
| `POST /api/companion/say`, `/listen` | 429 | `{ error: "budget", words, limit, used, retryAfterS }` (voice-link.md) |
| any decision | 400 | the existing `shown` error, now also for format characters and U+2028/U+2029 |
| the LAN door | bare 403 | for a wrong `Host`, or a 9th request in flight from one address |
| `POST /api/companion/listen` over Wi-Fi | 200 | (it was always 403 `no-consent` before) |
| `GET /api/onboarding/candidates` (S4) | 200 | gains `held: number` (folders not offered: their own agent settings or a name bp will not pass on) |
| `POST /api/onboarding/start` from a headset (S4, the PC confirm) | 202 | `{ request, name, state: "waiting" }`: an ask, no longer a start; 403 `{ error }` for a held folder's id; 429 `{ error, limit, retryAfterS }` past 6 asks an hour |
| `GET /api/onboarding/requests/<24 hex>` (S4, new) | 200 / 404 | `{ request, name, state, slug?, job?, reason? }`; 404 for any other pairing's ask, or none |
| `GET /api/onboarding`, the feed, `GET .../scans` from a device (S4) | 200 | each job without `log_tail`; `error` is one of "the run failed", "the run was stopped", "the run timed out" |
| `GET /api/products` from a device (S4) | 200 | each product without `root` |

### Deviations (numbered; the standard stands)

1. **AUTO tools from a device-driven turn (rate-limiting, metered-step-selection; authorization).** A `standup`-only
   headset's turn can still make the agent call AUTO tools, which go straight to their routes without a card; among them a
   scan start, so a turn can start a scan the pairing's missing `scan` scope would refuse at the door. The turn cap (6 a
   minute, one at a time) bounds how often; the call itself is not scoped by the pairing. Closing it: carry the driving
   device's scopes into the MCP process (as the conversation mark is carried) and refuse AUTO tools outside them.
2. **Turn text size from a device.** A device's turn still takes up to 8000 characters (`turn/route.ts` `MAX_TEXT`), sized
   for the page; a spoken question is far shorter. Bounded by the rate above, not by its own cap.
3. **The turn caps and the conversation mark live in the server's memory** (`table-bound.server.ts`, one process: apps/server
   is the canonical host). A restart forgets them, which only ever lets a device start afresh at one turn; Next (`:3010`)
   never sets a device, so it is not limited and needs no limit.
4. **The conversation mark trusts the MCP process's `x-bp-conversation`.** A loopback program that names a device-driven
   conversation makes its own cards stricter, never looser; a card filed with no conversation is treated as the PC's. The
   agent itself never sets the header (the MCP process does, from its environment).
5. **The registry cache** keys on the file's inode, size and mtime. Every write the server makes is a rename to a new file, so
   a revoke reaches the next request; a hand edit that keeps the same size within one mtime tick could be missed until the
   next change. Editing `paired.json` by hand is not a supported path (`pair revoke` or the Headsets page is).
6. **The CLI's approval path has no human token** (device-pairing, pairing-ceremony: "the mint gate: a person, in the
   application's own chrome"; added 2026-11-10 with section 13). `npm run server -- pair approve` calls the loopback
   `/lan/pair/*` routes guarded by `localOnly` and `jsonOnly` only: it is a terminal on the PC, and any local program can
   call those routes. The Headsets page's path (section 13) needs the page's human token and refuses any device. Both share
   one mint (`LanDoor.approve`) and one wrong-code count. Closing it: retire the CLI's approve once the page has proven itself,
   or give the CLI a token file only the owner's account can read. Since S4 (2026-11-10) the CLI's approve answers a wrong
   code after the same 250 ms as the page's, and a right code resets the wrong-code count only when the approved request
   came from another device than this PC (not the cable's `loopback`, a loopback address or one of this PC's own interface
   addresses: `peerIsThisPc`), or when a closed window is opened again; so a local program can no longer approve its own
   request every few guesses to keep guessing. What remains: a local program can still pair ITSELF (open a request and
   approve its code) and so hold a token with the scopes it names.
7. **The human token is fetchable by a local program** (section 11's residual, now also on the pairing gate): a program
   that forges `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: cors` reads the token and can approve a pairing for a
   request it made itself. The page's gate stops the companion agent (no shell, never sees the token) and every headset
   (a Bearer, the seal or `x-bp-device` is refused before the token is looked at), not a program already running as the owner.
8. **Five wrong codes cancel every open request** (MAX_WRONG_CODES; timing-defenses, pairing-ceremony). A local program can
   use it to cancel the owner's pairing in progress; it could already decline it (it holds the same routes). The owner sees
   "pairing is shut" on the page and reopens it.
9. **Reading the decision log is not itself recorded** (audit-logging, audit-querying: "reading the trail is itself an
   auditable act"). A single-operator tool on the owner's PC; the reader is bp's own page only (`fromOwnPage`). Closing it:
   a read-access row in the same log, if bp ever has more than one person.
10. **"Last seen" lives in the server's memory** (`device-auth.ts`), on both listeners: a restart forgets it and the page says
   "not seen since the server started". It is a convenience, not an audit field; the ledger keeps claims, refusals and revokes.
11. **WITHDRAWN 2026-11-10 (S4): a headset no longer starts a paid run without a click at the PC.** It read: "A headset
   holding `onboard` starts a paid agent run with no confirmation at the PC (owner's decision, 2026-11-10 morning: 'Pick and
   start on the headset ... no PC click')". After the read-only review's finding 1 (a hostile repository beside the owner's
   projects could run code when a headset started reading it), the owner chose on 2026-11-10: "Add the PC confirm: the
   headset picks the folder; a confirm appears on the Headsets page naming the folder, and the run starts only after your
   click there." Built in section 14 (the ask). hitl-approval (consent-gates) and authorization (privilege-tiers: a spend is a
   person's act in the PC's chrome) now hold for this path. The bounds stay as a second line (one at a time, three confirmed
   a day per pairing, six asks an hour).
12. **The day bound is per pairing.** A re-pair (an owner's act on the page) starts a fresh count; the device name alone is
   the headset's claim and keys nothing. The count is read from the decision log, so a restart forgets nothing.
13. **A refused start is not in the decision log** (verb-allowlists: "every act, success or failure, writes a ledger row").
   It is one 4xx answer to the device; a successful start is logged and printed. Through the door a scope refusal is still
   the ledger's `refused` row. Closing it: a rate-capped `onboard-refused` row, as the door caps its refusal rows.
14. **Narrowed by S4 (2026-11-10): what a device still reads of a job** (verb-allowlists, "reads are a projection"). To a
   request carrying a device mark, `GET /api/onboarding`, the feed and `GET .../scans` answer each job without `log_tail`,
   with `error` replaced by "the run failed", "the run was stopped" or "the run timed out", and `GET /api/products` answers
   each product without `root` (`packages/core/src/server/device-view.server.ts`; the page's requests are unchanged; the
   headset reads only `error`, as words, and never `root` or `log_tail`: BpLink.cpp). What still leaks: the rest of the job
   record (its `scope` labels and feature ids, a directed scan's `focus` note, `adopt_phase`, times), the build-up feed's
   events (domain and feature names, the narration lines the agent writes, tool activity by area), and `GET .../scan`'s
   store (activity rows). These are the product's map, which `read` exists to show; a path the agent names in its
   narration can reach the feed. Closing it: a feed projection that drops narration text for a device.
15. **The adopt run reads a folder bp has never read with permissions skipped** (S4, 2026-11-10; prompt-safety; subprocess-
   lifecycle, spawn contract; untrusted-extension-host: code nobody reviewed runs only isolated). Since S4 the run loads no
   configuration of that folder: `--setting-sources user --strict-mcp-config` (jobs.server.ts `ADOPT_ARGS`; proven by
   experiment: a SessionStart hook and an `.mcp.json` server in a scratch folder wrote their markers and its `CLAUDE.md` was
   obeyed with the old flags, none of the three with the new; the adopt skill is still read by path), and a folder that
   ships agent settings is never offered to a headset. What remains: (a) the folder's files are text the agent reads with
   `--dangerously-skip-permissions`, so a planted instruction can steer it into running commands as the owner (prompt
   injection), from the PC's /projects as from a confirmed ask; (b) the agent's own `git` commands in that folder honour its
   `.git/config` (`core.fsmonitor`, `core.hooksPath`), which a clone does not carry but a folder copied onto the disk can;
   (c) the user's own MCP servers are dropped from the adopt run too (it needs none). Closing (a) and (b): an adopt run
   without skipped permissions (an allow-list of the commands adopt-bp runs, `--permission-mode` with `--allowedTools`), or
   one in a sandbox that cannot reach the owner's files; the owner decides. The PC confirm (section 14) is the human gate
   for the headset's path; it does not make the run safe on a hostile folder.
16. **A folder swapped after its confirm.** The start checks that the folder still resolves to the path offered (a
   junction swapped in during the check is 409), but the job spawns after `adopt.mjs check` (up to a minute later) in that
   path; a swap in that window runs the agent at the junction's target. Closing it: re-resolve at spawn for an adopt job and
   fail on a difference (a PC-registered product whose root is itself a link would need its real path registered first).
17. **A waiting ask lives in this process's memory** (onboard-start.server.ts). A restart forgets it: the headset reads 404
   and asks again. The ask and its answer are in the decision log on disk, and the hourly ask cap and the day bound are
   counted from it, so a restart resets no bound.
18. **DNS rebinding, the rest** (S4, 2026-11-10; section 13, threats considered). The web app hands `/api/companion/*` and
   `/api/session/*` to the server only for a Host named `localhost` or `127.x.x.x`; a page at `[::1]` falls through to the
   web app's own companion routes (Next's host match cuts at the first colon). The server refuses a forwarded host that is
   not a loopback name; the port is not judged (a rebinding page cannot make its own name loopback).

## 13. The Headsets page (owner, 2026-11-10: "Pair from the PC app")

Registry standards: `device-pairing` (pairing-ceremony, revocation-and-expiry, timing-defenses), `authorization`
(ceiling-before-consent) and `audit-logging` (audit-querying, decision-records). Code: `apps/server/src/headsets.ts` (the
routes), `lan-door.ts` (`pageState`, `approve`'s wrong-code count, `denyId`, `widen`), `main.ts` (the door switch),
`packages/core/src/server/api/companion/decisions/route.ts` (the reader), `apps/web/src/headsets/` (the page at `/headsets`,
linked from the rail's VR · Table card and the project switcher's menu). Proof: `npm run check:headsets` (66 expectations;
nine seeded defects each turn it red), `check:server` (the six routes on every start).

**The page is the human.** Every route below runs, in order: `localOnly` (+ `jsonOnly` on a write); a refusal **403**
`{ error: "a headset cannot pair or revoke headsets: that is bp's own page's to do" }` for any request carrying
`Authorization`, the decider seal or `x-bp-device` (so a paired headset, even one holding `decide`, never manages headsets);
then the page's `x-bp-human` token (`isHuman`, never `deciderOf`), else **403**. They are apps/server's own routes (core
cannot reach the door), mounted on every start, under `/api/companion/headsets` so the web app's rewrite to this server
(`BP_COMPANION_URL`) carries them; the page's token is minted by the same process through the same rewrite. None is a LAN
verb. The CLI's `/lan/pair/*` routes are unchanged (section 12, deviation 6). `cache-control: no-store` on every answer.

| Method, path | Body | Answer |
| --- | --- | --- |
| GET `/api/companion/headsets` | | 200 the state below |
| POST `/api/companion/headsets/open` | `{}` | 200 the state, a 2-minute window open; 409 when pairing is off |
| POST `/api/companion/headsets/approve` | `{ code, scopes, days }`: the 6 characters TYPED from the headset's screen, a non-empty subset of the scopes (seven with `onboard`), 1..30 | 200 `{ ok, device, peer, scopes, days }`; 400 a bad body (in words); 404 a wrong code, after the door's 250 ms, `{ error, wrong: { count, limit, cancelled } }`; 409 off or 8 paired |
| POST `/api/companion/headsets/deny` | `{ id }` (a pending request's opaque id) | 200; 404 no longer open |
| POST `/api/companion/headsets/revoke` | `{ id }` (8 hex) | 200; 404. Works with the door off too (the registry is on disk) |
| POST `/api/companion/headsets/door` | `{ mode: "pair" \| "lan" }` | 200 the state; 409 in words (no home-network address, still starting) |

The state: `{ now, door: "off" | "pair" | "lan", started, window: iso | null, wifi: { address, port, listening } | null,
wifiAt: { address | null, port } | null, pending: [{ id, device, peer, state: "pending" | "approved", requested, granted?,
at, until }], wrongCodes: { count, limit }, paired: [{ id, device, name, scopes, createdAt, expiresAt, expired, lastSeen? }],
scopes, namedOnly, days: { default, max }, limits: { pending, paired } }`. **Never a code, a nonce, a fingerprint or a
token**: the code is the proof the owner is looking at THAT headset, so the page lists who asks (the claimed name, the
peer: `loopback` is the cable, the request's age and the scopes it asked for) and the owner types what the headset shows.
`peer` is the socket's, never the body's. `lastSeen` is when this process last authenticated the pairing (section 12, 10).

**The permissions on the page** (ceiling-before-consent): all six are offered, each with one line; See, Stand-up, Hand over
and Focus are ticked by default; Decide as you (`decide`) and Scan (`scan`) start unticked whatever the headset asked, and
say so ("a headset never gets this by asking"). What the page sends is what the token holds (`approve` mints from the
owner's list). The lifetime is 1, 7, 14 or 30 days (default 30, `DEFAULT_DAYS`). A request that came over Wi-Fi carries the
cleartext warning beside APPROVE. DECLINE is one click; APPROVE needs the typed code.

**The door switch (this run only).** When the server was started without `--lan` or `--pair`, the page shows pairing off
and two buttons: PAIR OVER THE CABLE attaches the door as `--pair` does (its routes join the loopback mount, which `dispatch`
reads per request; a window opens when nothing is paired), and TURN WI-FI ON as `--lan` does, on the first private-range
interface and port 3101, saying "Opens port 3101 on <address> to devices on your home network. Only a headset you paired gets
past it, and its key travels unencrypted on your Wi-Fi." A cable-only door (started `--pair` or switched) can be widened to
Wi-Fi the same way (`LanDoor.widen`). Each switch is one ledger row `{ event: "door-on", mode, by: "page", until: "this run of
the server" }` and one log line; nothing is saved, and a restart goes back to the command line. The page never switches the
door off (stopping the server does). Calls are serialized, so two clicks never attach two doors.

**The decision log reader**: `GET /api/companion/decisions?surface=vr|web&device=<name>:<pairing id>&limit=1..200` (core,
mirrored by apps/web). `localHost`, then bp's own page only (`fromOwnPage`: `Sec-Fetch-Site: same-origin`,
`Sec-Fetch-Mode: cors`), else 403; an unknown filter 400. 200 `{ rows, matched, total, limit, unreadable, recorded, filter }`:
rows newest first exactly as recorded (`shown` included), at most 200 (default 100); `matched` before the cap, `total` in
the file, `unreadable` torn lines, `recorded: false` when the file does not exist yet, so the page tells "nothing decided
yet", "nothing matched" and "the newest 100 of 253" apart (audit-querying).

**The page's three parts**, in order: PAIR A HEADSET (the door, the window with OPEN PAIRING, the requests with DECLINE, the
code field, the permissions, the lifetime, APPROVE), PAIRED (each pairing's permissions, dates, last seen, REVOKE), WHAT THE
TABLE DID (the companion's grants, live and expired, who gave them and the words shown, REVOKE on a live one through the
existing `DELETE /api/companion/policies/<id>` with the page's token; then the decision log with an All / At the table /
On this PC filter). When the page cannot reach this server it says so with the one command (`npm run server`, or the web app
restarted with `BP_COMPANION_URL=http://127.0.0.1:3100`) and shows nothing else. `?fixture=1|off|cable|paired|empty|noserver|nowire`
renders each state without a server (in the fixture, `K7QX4M` is the right code).

**Threats considered (S4, 2026-11-10).** *DNS rebinding through the web app's proxy*: a page at `rebind.example:3010` that
re-resolves to 127.0.0.1 is same-origin with the web app, and Next's rewrite to this server set `changeOrigin`, so the server
saw Host `127.0.0.1:3100` and could hand that page the human token, then the headsets state, the decisions, cards,
policies, the morning, the stream and `/api/session/*` (writes were already refused: a POST carries the foreign Origin).
Two locks now, either one enough: the rewrite applies only when the incoming Host is `localhost` or `127.x.x.x`
(`apps/web/next.config.ts`, so a rebound name reaches the web app's own routes, which refuse its Host), and every guard
(`local-only.ts` `hostVerdict`) refuses a request whose `X-Forwarded-Host` is not a loopback name. The web app's own
routes under `apps/web/src/app/api` are thin mirrors of core handlers that open with `localHost` or `localOnly`
(check:route-guards). Held by check:local-only and a live probe through `next start` (section 14's S4 notes). *A paired
headset reading paths*: section 12, deviation 14. *A stuck door switch*: a switch that throws answers its failure in a
sentence and the next one runs (`serializeSwitch`); the door is set, and its routes mounted, only after it started.

**What the headset's PC LINK page says** (apps/vr; the Director's to place): "Open Developer's Blueprint on your PC, go to Headsets, and type
this code there."

## 14. Onboarding from the headset (owner, 2026-11-10: "Pick and start on the headset")

Registry standards: `device-pairing` (verb-allowlists: reads are a projection, writes act only on what the projection showed),
`authorization` (scope-design: a scope names its gate) and `rate-limiting` (key-design, refusal-contract). Code:
`apps/server/src/lan-door.ts` (the scope and the verbs), `device-auth.ts` (the onboard seal), `mount.ts` (strips a client's
seal), `packages/core/src/server/onboard-start.server.ts` (the offer, the start, the bounds), the routes under
`packages/core/src/server/api/onboarding/{candidates,start}`, `apps/server/src/headsets.ts` (the page's list and STOP).
Proof: `npm run check:onboard-door` (91 expectations since S4, 2026-11-10; the seeded defects of S4 are listed in its report).

**The scope `onboard`** is named-only like `decide` and `scan`: a headset may ask for it, only the owner's approve that ticks or
names it grants it. The page's line: "this headset may start reading a new project from the folders this PC offers: a paid
agent run". A pairing that holds it gets an in-process seal (`x-bp-onboard-seal`, its own per-process secret, not the decider
seal: `decide` does not imply `onboard` nor the reverse) beside `x-bp-device`, on both listeners; the loopback mount strips a
client-sent one. The door forwards nothing new from the device.

| Method, path | Who | Answer |
| --- | --- | --- |
| GET `/api/onboarding/candidates` | Wi-Fi: scope `onboard`. Cable: a Bearer whose pairing holds `onboard` (a Bearer without it: 403 in words); a plain loopback caller (the PC) too | 200 `{ candidates: [{ id, name, hint, state }], roots, held }` |
| POST `/api/onboarding/start` `{ candidate, shown }` | a pairing holding `onboard` (Wi-Fi or cable): an ASK; bp's own page (`x-bp-human`): a start; anyone else 403 | headset 202 `{ request, name, state: "waiting" }`; page 202 `{ slug, name, job }` |
| GET `/api/onboarding/requests/<request>` (24 hex, no query) | the pairing that made the ask (`onboard`); anyone else 404 | 200 `{ request, name, state: "waiting" \| "confirmed" \| "declined" \| "expired", slug?, job?, reason? }` |
| POST `/api/companion/headsets/ask/confirm` `{ id }`, `/ask/decline` `{ id }` | bp's own page only (section 13's gate: a device's token, seal or mark is 403) | confirm 200 `{ ok, request, state: "confirmed", slug, name, job }`, or the failure `{ error, state: "declined" }` (403 held, 404 gone, 409 busy or changed, 429 the day bound); decline 200; 404 unknown; 409 already answered or expired |
| GET `/api/onboarding` | `read` (or `standup`), no query | 200 `{ items: [{ slug, name, job: ScanJob \| null }] }` (unchanged) |
| GET `/api/products/<SLUG>/onboarding/feed?after=<n>&job=<id>[&layout=islands]` | `read`, that query exactly | 200 `{ job, events, next, done }` (unchanged) |

- **What is offered**: git work trees (a directory with its own `.git`, not a link, not hidden) that are direct children of the
  parent folders of the registered products, not registered, or registered but never read (no map, no finished adopt job);
  at most 24 (`MAX_CANDIDATES`), sorted by name; at most 400 entries of one parent are looked at. **Held back** (S4,
  2026-11-10; untrusted-extension-host): a folder that carries its own agent configuration (`.mcp.json`,
  `.claude/settings.json`, `.claude/settings.local.json` or `.claude/hooks`), or whose name holds anything but letters,
  digits, space, dot, underscore and hyphen, is never offered: it is counted in `held` (the headset says "N more folders
  carry their own agent settings: start those on your PC"), and a start naming its id is **403** `{ error }`. The PC's
  /projects page offers them as before. `state`: `new` (not
  registered), `registered` (registered, never read), `onboarding` (its adopt job is queued or running). `roots`: how many
  parent folders were looked in. The list is cached 10 s; a start always re-derives it.
- `id`: 24 lower-case hex, an HMAC of the folder's real path under a per-process key: opaque, stable while the server runs,
  different after a restart (read the list again). `name`: the folder's name. `hint`: at most 60 characters, the last commit's
  subject, else the remote's repo name (the last segment of `remote.origin.url`), else a plain phrase; a candidate text that
  holds a drive letter, a backslash, a home-style absolute path or this account's user name is not used. Nothing else.
- **The start**: the body is exactly `{ candidate, shown }` (any other key is 400: no model, no flags, no path). `candidate`
  must be 24 hex (a path or a name is 400) and one of the ids the PC offers NOW (else 404, also when the folder is gone or no
  longer a git work tree). `shown` (1..1000 characters, the decision rule of section 2) is required from a headset and
  optional from the page. The PC runs the existing folder check, registers the folder under the slug /projects proposes
  (`slugOf`/`uniqueSlug`, `-2` when taken; a registered one keeps its slug), and queues the adopt job with the options the
  /projects page sends for a first read (`{}`: no model, no resume).
- **The PC confirm** (owner, 2026-11-10, after the review: "the headset picks the folder; a confirm appears on the Headsets
  page naming the folder, and the run starts only after your click there"). A headset's start creates no job and no
  registry entry: it records an ASK and answers **202** `{ request, name, state: "waiting" }`. One open ask per pairing (a
  new one declines the waiting one with the reason "replaced by a newer ask from this headset"); an ask expires 10 minutes
  after it was made (`ASK_TTL_MS`); at most 6 asks a rolling hour per pairing (`ASKS_PER_HOUR`: **429** `{ error, limit,
  retryAfterS }` with `Retry-After`). The Headsets page's state gains `asks: [{ id, device, name, hint, shown, askedAt,
  expiresAt }]` (the folder's name and hint as the PC knows them, and what the headset said it showed, so a mismatch shows)
  and shows each at the top of WHAT THE TABLE DID: "<device> asks to read <name>: <hint>. Reading it starts an agent on that
  folder and spends from your account." with CONFIRM and DECLINE, polling every 2 s while one is open. CONFIRM re-derives
  the offer (a held, gone or busy folder declines the ask with that sentence as its `reason`), re-checks the bounds, then
  runs the start: the folder check, that the folder still resolves to the offered path (else 409), the register, the adopt
  job with the page's options. /projects starts at once, as before.
- **Bounds at the confirm**: one headset-asked read queued or running on this PC at a time, from any headset
  (`DEVICE_IN_FLIGHT` 1: 409, the ask declined); three CONFIRMED reads a rolling 24 h per pairing (`DEVICE_STARTS_PER_DAY` 3:
  429, the ask declined). At the ask: a candidate already being read is **409** `{ error, slug }` (watch it).
- **Recorded**: the ask is one row `{ kind: "onboard-ask", surface: "vr", device, shown, target: <folder name>, verdict:
  "ask", request }`; its answer one row `{ kind: "onboard", surface: "web", device: <the asking device>, shown, request,
  verdict: "confirm", product: slug, target: slug, job }` or `{ ..., verdict: "decline", target: <folder name>, reason }`; a
  page start `{ kind: "onboard", surface: "web", verdict: "start", product, target, job }` as before. The Headsets page
  lists the confirmed ones under "Projects started from the table" (`onboards: [{ at, device, slug, name, shown?, job,
  status }]`, `onboardBounds: { perDay, inFlight }`), with **STOP** on a queued or running one: `POST
  /api/companion/headsets/stop { slug, job }` (the page's gate; the existing job cancel; 200 `{ ok, status }`).
- Errors are `{ error }` in words a person can read, plus the fields named above.

**The headset's flow** (for the VR builder): with `onboard` in `/pair/me`'s scopes, show a list from GET candidates (name,
hint, state; `onboarding` rows are watchable, not startable; with `held` > 0, the line "N more folders carry their own agent
settings: start those on your PC"). On a pick, show the words (for example "Ask your PC to read <name>? It starts when you
confirm it there.") and send them as `shown` with the id. On 202 `{ request }`, say "Confirm it on your PC: bp's Headsets
page" and poll GET `/api/onboarding/requests/<request>` (every few seconds, at most 10 minutes): `confirmed` gives `slug`
and `job`: watch them through GET `/api/onboarding` and the feed with `after` and `job` exactly as BpLink.cpp does today;
`declined` gives `reason` (say it); `expired` (or a 404 after a server restart): offer to ask again. On 409 with `slug`,
watch that one. On 403 with `{ error }` (a held folder) or 429, say the words. A bare 403 over Wi-Fi is the door's (no
scope, or revoked: ask `/pair/me`). Job `error` fields now read "the run failed", "the run was stopped" or "the run timed
out" (section 12, deviation 14).

**As built against the brief**: the brief's contract, with three choices recorded: a path or name in place of the id is
**400** (malformed) rather than 404 (an id of the right shape the PC does not offer is 404); the in-flight bound answers
**409** with the running slug, the daily bound **429**; a body key beyond `candidate` and `shown` is refused, not ignored.
