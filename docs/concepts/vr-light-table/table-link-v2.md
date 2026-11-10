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
| 4 | owner on the PC | bp's Headsets page (`/headsets`): types the code, ticks the permissions, APPROVE (section 13); or `npm run server -- pair approve <code> --scope standup,place,focus,decide,scan` | `decide` and `scan` are granted ONLY when ticked or named here |
| 5 | headset, every 2 s | `POST /pair/claim` `{ nonce }` | 202 `{ state: "pending" }`; then 200 `{ token, device, scopes, expiresAt }` exactly once; again: 410 `{ state: "claimed" }` |
| 6 | headset | keeps `token` (and `device`, `scopes`, `expiresAt`) | |
| 7 | headset, at launch and every minute | `GET /pair/me` with Bearer | 200 `{ device, scopes, expiresAt }`; revoked/expired: 401 on the tether, bare 403 on the LAN |
| 8 | owner | REVOKE on the Headsets page, or `npm run server -- pair revoke <id>` (`pair list` shows ids) | the next request with that token is refused; requests in flight on the LAN door are cut |

- `nonce`: 22..128 characters of `[A-Za-z0-9_-]` (128 bits or more, from the headset's own RNG; never reused).
  `device`: 1..40 of `[A-Za-z0-9_.-]` (e.g. `quest3s`). `scopes`: a subset of
  `["read","standup","place","focus","decide","scan"]`, default `["read"]`.
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
| standup | POST | `/api/companion/turn` | as before; per paired device at most one turn in flight and 6 a minute (section 12) |
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
   or give the CLI a token file only the owner's account can read.
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
| POST `/api/companion/headsets/approve` | `{ code, scopes, days }`: the 6 characters TYPED from the headset's screen, a non-empty subset of the six scopes, 1..30 | 200 `{ ok, device, peer, scopes, days }`; 400 a bad body (in words); 404 a wrong code, after the door's 250 ms, `{ error, wrong: { count, limit, cancelled } }`; 409 off or 8 paired |
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

**What the headset's PC LINK page says** (apps/vr; the Director's to place): "Open bp on your PC, go to Headsets, and type
this code there."
