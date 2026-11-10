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
    Only `Content-Type` and `Accept` are forwarded from the headset; any `x-bp-device`, `x-bp-human` or other header it
    sends is dropped and the door sets `x-bp-device: <device>:<pairing id>` itself.
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
  listener strips any `x-bp-decider-seal` a client sends, and the LAN door forwards only `Content-Type` and `Accept`.
- On the tether a Bearer that matches no live pairing answers **401** `{ "error": "device token unknown, expired or revoked: pair again" }`
  before any route runs (the headset should drop its token and re-pair). A missing Bearer is not an error: the request
  runs as a plain loopback caller and a person's decision is refused with **403**
  `{ "error": "a person's answer: needs the x-bp-human token from bp's own page, or a paired headset's token with the decide scope" }`.
- `apps/web` (:3010, Next) has no device path: it never sets the seal, so on :3010 only the web page decides. VR talks to :3100.
- Every device decision must say **what the headset showed** (decision-records: "what was shown"): body field `shown`,
  a string of 1..1000 characters (no control characters except newline), the text the person read before the pinch.
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
no LAN listener). Without either, the ceremony routes answer 404 and only an existing token works on the tether.
The numbers: code 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; a request lives 120 s (`PAIR_TTL_MS`); an approved
pairing waits 120 s for its claim (`CLAIM_TTL_MS`); a token lives 30 days unless the owner says fewer (`--days 1..30`);
at most 4 pending requests and 8 pairings. A pairing window (120 s) is open at server start when nothing is paired, and
again after `npm run server -- pair open`. Requests outside a window are refused.

| Step | Who | Call | Answer |
| --- | --- | --- | --- |
| 1 | headset (tether) | `GET http://127.0.0.1:3100/lan/where` | 200 `{ door: { address: string, port: number } \| null, listening: boolean, window: string \| null, pairing: boolean }` |
| 2 | headset (tether or LAN) | `POST /pair` `{ nonce, device, scopes? }` | 201 `{ state: "pending", code, expiresAt }`; a retry with the same nonce: 201 pending or 200 `{ state: "approved", code, expiresAt }` |
| 3 | headset | shows `code` on the lamp's tag | |
| 4 | owner on the PC | `npm run server -- pair approve <code> --scope standup,place,focus,decide,scan` | `decide` and `scan` are granted ONLY when named here |
| 5 | headset, every 2 s | `POST /pair/claim` `{ nonce }` | 202 `{ state: "pending" }`; then 200 `{ token, device, scopes, expiresAt }` exactly once; again: 410 `{ state: "claimed" }` |
| 6 | headset | keeps `token` (and `device`, `scopes`, `expiresAt`) | |
| 7 | headset, at launch and every minute | `GET /pair/me` with Bearer | 200 `{ device, scopes, expiresAt }`; revoked/expired: 401 on the tether, bare 403 on the LAN |
| 8 | owner | `npm run server -- pair revoke <id>` (`pair list` shows ids) | the next request with that token is refused; requests in flight on the LAN door are cut |

- `nonce`: 22..128 characters of `[A-Za-z0-9_-]` (128 bits or more, from the headset's own RNG; never reused).
  `device`: 1..40 of `[A-Za-z0-9_.-]` (e.g. `quest3s`). `scopes`: a subset of
  `["read","standup","place","focus","decide","scan"]`, default `["read"]`.
- Step 2 and 5 must come from the same transport and peer: a request made over the tether is claimed over the tether.
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
| standup | POST | `/api/companion/turn` | as before |
| standup | GET | `/api/companion/focus`, `/api/companion/cards` | as before |
| standup | GET | `/api/companion/morning` | query: none, or `since=<iso>` and/or `opened=<iso>` (chars `0-9TZ:.-`) |
| standup | GET | `/api/companion/inbox` | query: none or `limit=<1..500>` |
| standup | GET | `/api/companion/policies` | section 3.3 |
| standup | POST | `/api/companion/listen`, `/api/companion/say` | the voice routes; their handlers are another builder's (2026-11-09) and so are their bodies: at the smoke, `say` took `{ text }` and answered `audio/wav`, `listen` took an `audio/wav` body (415 otherwise). Absent handler: 404 `{ error: "no route ..." }` |
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
Proof in code: `npm run check:table-link` (127 expectations) and `npm run check:lan-door`.

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
- **The token** is kept in GameUserSettings (`[/Script/BpLink.BpLinkSettings]`: `Token`, `Device`, `Scopes`, `ExpiresAt`,
  `CableUrl`, `WifiUrl`), shown as its last 4 characters, never logged. It goes out as `Authorization: Bearer` on every request
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
  forge the browser headers, and it can also run the `pair` CLI's loopback routes and approve a pairing for itself. The
  device marker guards against the companion agent (which has no shell and never sees a token) and against the LAN, not
  against something already running as the owner on the PC. A loopback script with no token is refused exactly as before.
- **The token travels in cleartext** over Wi-Fi (S8's recorded deviation; TLS is the follow-up). Anyone who sniffs the home
  network can replay it until it is revoked or expires. The binding is the token plus the private-range class.
- **A stolen headset decides** until `pair revoke`. The VR grant bound (12 h, tier 1+, four tools, one product) caps what
  one stolen session can hand the agent.
- **The decision record and the entity row are two writes** for the cross-cutting `decisions.jsonl`; the entity's own row
  (steering log, card, grant) carries the marks atomically. A failed `decisions.jsonl` append is logged, not fatal.
