# Personas adoption: one more follower of the shared focus

**Status: not built in Personas (read-only tonight); this is the adoption note.** Scouted 2026-10-30 against bp
`1bdf7da` and Personas `ad40fcf` (`C:/t/hk-bp-ref-personas`). Paths prefixed `bp:` are this repo; `P:` is Personas.

The owner's framing: Personas' Monitor joins as one more follower via the deep-link ids. It can, without any bp change,
if the calls are made from Personas' Rust side. They cannot be made from its webview (the CSP and bp's guards both
refuse, see section 2.1). The other catch is the room id: since `57ee810` (2026-10-25) a bp room is a capability, and
Personas' ported layout still uses domain rooms (section 2.3).

## 1. What bp offers (the contract)

Verbatim from `bp:packages/core/src/session/focus.ts`:

```ts
export type Surface = 'web' | 'phone' | 'vr' | 'companion' | 'personas' | 'standin' | 'morning';   // :17
export type PlaceKind = 'feature' | 'room' | 'wing' | 'site';                                        // session/place.ts:10
export type PlaceLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';                                           // session/place.ts:9
export interface FocusPlace { product: string; target?: { kind: PlaceKind; id: string }; level?: PlaceLevel;
  hash?: string; say?: string }                                                                       // :20-29
export interface Reader { id: string; surface: Surface; label: string; place?: FocusPlace; rev?: number; at?: string;
  follows?: string; seenAt: string }                                                                  // :31-43
export interface SharedView { rev: number;
  shared: { place: FocusPlace; reader: string; surface: Surface; label: string; at: string } | null;
  readers: (Pick<Reader, 'id' | 'surface' | 'label' | 'follows' | 'seenAt'> & { live: boolean })[] }  // :53-57
```

- **Route** (`bp:packages/core/src/server/api/session/focus/route.ts`): `GET /api/session/focus` returns a `SharedView`
  (:18-22). `POST` takes the body `{ op, reader, surface, label, place?, of? }` (:25-37). The ops are `hello`,
  `publish {place}` (201 when the shared place moved, 200 for an echo), `follow {of: '*' | readerId}`, `unfollow` and
  `forget`. A POST answers `{ moved, view }` (:39-51).
- **Event**: every visible change goes out as `event: shared` with `data: {"type":"shared","shared":<SharedView>}` on
  `GET /api/companion/stream` (`bp:.../session/focus.server.ts:50`, `bp:.../companion/stream/route.ts:34`). A `hello`
  makes an event only when presence flips.
- **Validation**: reader ids match `^[\w.:-]{1,80}$`, so `personas:main` is valid. Product slugs match
  `^[a-z0-9][a-z0-9-]{0,63}$` (focus.ts:66). A label is 1..40 characters, and `say` at most 280 (focus.ts:70-89).
- **Echo rules**:
  - Publishing the spot that is already shared is an echo: no new rev, no event (focus.ts:127-133). `sameSpot` compares
    the product, the target kind and the target id. It ignores `hash` and `say` (:92-93).
  - `toApply(view, me, follows, appliedRev)` skips your own writes, readers you do not follow, and revs you have
    already applied (:166-171).
  - You cannot follow yourself (:138). A lead that forgets stays the author of the place (:146-150).
  - A reader shows as gone after `LIVE_MS` = 45 s (:60), is forgotten after 24 h (:62), and at most 32 readers are kept
    (:63).
- **Levels**: feature is L4, room L2, wing L1 and site L0 when the publisher sets none (`levelOf`, :183).
- **Guards**: everything is loopback-only.
  - GET runs `localHost`: the Host must be a loopback name and every X-Forwarded-For hop must be loopback
    (`bp:packages/core/src/scan/local-only.ts:26-32,37`).
  - POST also runs `localOnly` and `jsonOnly` (:50,54-65,68).
  - **Focus needs no token**, because it carries ids only (route.ts:9-10).
- **Morning deck**: `GET /api/companion/morning?since=<iso>` is read-only and loopback-only
  (`bp:.../companion/morning/route.ts:15-19`). Its `POST` steers and needs bp's human token `x-bp-human` (:26). That
  token is handed only to a same-origin bp page (`bp:.../companion/door.server.ts:6-9`). **Personas must not steer
  through bp's morning route.** It decides through its own store path, and bp sees the result in `scan.db`.

## 2. Personas as a follower

### 2.1 Where the calls must live: Rust, not the webview

Both reasons the webview path fails were checked against the code.

- **CSP.** The shipped `connect-src` in `P:src-tauri/tauri.conf.json:43` lists no `localhost` or `127.0.0.1`, so the
  webview can neither `fetch` nor open an `EventSource` to bp. Polling at 1 Hz from the webview is blocked just as
  SSE is. Only `devCsp` (:44) allows `http://localhost:*`, and not `127.0.0.1`. This is why `probeBp` answers
  `unknown` outside dev (`P:src/features/decision-center/lens/useBpRelease.ts:5-9,68`).
- **bp's guards and CORS.**
  - Tauri 2 on Windows (`P:src-tauri/Cargo.toml:41`, no `useHttpsScheme`) serves the shipped webview from
    `http://tauri.localhost`.
  - A POST from that origin fails `writeVerdict`. The Origin's hostname `tauri.localhost` does not match `LOOPBACK_HOST`
    `^(localhost|127…|[::1]|::1)$` (local-only.ts:5), so bp answers **403 `foreign-origin`**: "writes are only
    accepted from a localhost page (Origin: http://tauri.localhost)" (:57-62).
  - Had the origin passed, `Sec-Fetch-Site: cross-site` (tauri.localhost vs localhost) would still refuse it (:63).
  - bp sends no `Access-Control-Allow-Origin` on any route. The `application/json` POST therefore fails its preflight,
    and even the GET could not be read by the webview. This holds in dev too (Origin `http://localhost:1420` passes
    bp's guard, but CORS still blocks it).
- **What works today with no bp change:**
  - Personas' Rust already depends on `reqwest` 0.12 with `stream` (`P:src-tauri/Cargo.toml:67`).
  - A request from Rust sends no Origin and no Sec-Fetch-Site, and its Host is `localhost:3010`. It passes `localHost`,
    `localOnly` and `jsonOnly` as long as it sets `content-type: application/json`.
  - Add one module next to `P:src-tauri/src/commands/infrastructure/lens_scan/`. It reads the base URL from the
    existing `lens_scan.bp_url` setting (`P:src/features/decision-center/lens/bpLink.ts:19-29`, default
    `http://localhost:3010`). It exposes three commands (`bp_focus_start`, `bp_focus_publish`, `bp_focus_stop`) and
    emits one Tauri event, `bp-focus:view`, carrying the `SharedView`.

**Poll, don't stream.** Rust should `GET /api/session/focus` once a second while a Personas Blueprint surface is open.

- `/api/companion/stream` also carries the owner's companion `turn` and `card` events (stream/route.ts:2-8). Personas
  has no business reading the conversation, and a GET of the focus record is under 2 KB.
- SSE from Rust is a later optimisation, filtered to `event: shared`.

**Point Personas at the same bp process as the web page.** The focus record is per process. `readFocus` reads
`focus.json` once and then serves memory (focus.server.ts:20-30). The bus is per process too (stream/route.ts:10-11).
The bp web page uses `:3010`, and so should Personas.

### 2.2 The reader

| Field | Value |
|---|---|
| `reader` | `personas:<window label>` (e.g. `personas:main`); one per Personas window |
| `surface` / `label` | `personas` / `Personas` |
| `hello` | on start, then every 15 s while the Monitor's Blueprint tab or a Blueprint sheet is visible (bp's web does the same: `bp:apps/web/src/lib/focus/shared.ts:14,83`) |
| `follow` | `{ of: '*' }` when the owner turns Follow on (a chip in the sheet header, as bp's "Following Web, 2 s ago"; `followingWords` gives the words) |
| `unfollow` / `forget` | Follow off / window close or the last Blueprint surface unmounting |
| applying | `toApply(view, me, follows, appliedRev)`, then advance `appliedRev` whenever following (shared.ts:92-102) |

The mounts are the Monitor's Blueprint tab (`P:src/features/fleet/monitor/shell/MonitorBody.tsx:50-60` →
`BlueprintPicker`) and the sheet every card opens (`openLensSheet` → `LensSheetHost` → `LiveBlueprint` →
`BlueprintSheet`). Follow should apply only while one of them is visible. A shared place must never pop the
full-bleed sheet over another Personas view.

### 2.3 Mapping a FocusPlace to Personas' place

**Product.**

- Personas opens a sheet by `projectId` (`P:.../lens/lensSheetStore.ts:14-17`), not by slug.
- Its only slug is `bpSlug(root)`: the repo folder name, lower-cased, with non-`[a-z0-9-]` runs turned into `-`
  (bpLink.ts:12-16,32-36). bp's slug is whatever `bp.products.local.json` says. Registration via POST enforces
  `^[a-z0-9][a-z0-9-]{0,62}$` (`bp:packages/core/src/server/registry.server.ts:61`), and a hand-edited entry can be
  anything (`bp:.../products.server.ts:80-83`).
- They agree on this machine's registry (`bp`, `pof`). They diverge for worktrees (`hk-bp-ref-personas`), renamed
  registrations (`/adopt-bp --slug`), and two repos sharing a folder name.
- **The fix needs no guessing.** bp's `GET /api/products` returns `{ slug, name, root }` per product
  (`bp:.../api/products/route.ts:15-22`). Rust matches `root` (canonicalised, case-folded on Windows) against
  `dev_projects.root_path` and keeps a slug↔projectId table, refreshed when a place names an unknown slug.
- A bp slug with no Personas project is shown as "Not in Personas: <slug>", and the sheet stays where it is.

**Target.** Personas' layout is the fbef867 port (`P:.../blueprint/model/layout.ts:1-6`). bp has since given every live
product capability rooms and kind bays (`bp:packages/core/src/model/layout.ts:71,74-78,108-110`, `57ee810`). Ids line
up like this for a live product with one building:

| bp place | bp id | Personas node | How Personas goes there |
|---|---|---|---|
| `site` / no target (L0) | - | the building | `toLevel(0)` |
| `wing` (L1) | `0:<domainId>` (`bp:layout.ts:144`) | `WING['0:<domainId>']` (`P:layout.ts:88`), and the room `ROOM[<domainId>]` covers the same area | `nav.flyToPlace('wing', id)` (`P:.../controller/useNavigation.ts:137-144`) |
| `room` (L2) | **capability id** (`bp:layout.ts:147`, `rs.id = c.id`) | **bay** `BAY[<capabilityId>]` (`P:layout.ts:97,110`) | `nav.flyToPlace('bay', id)` |
| `room` that is a feature-less domain | domain id | none: Personas skips empty domains | fall back to the site and say so |
| bp bay `<capId>.<kind>` | (never a PlaceKind; the stand-in resolves it to its room) | the bay `<capId>` | strip `.<kind>` and use the bay |
| `feature` (L4) | feature id from the map | `TILE[<featureId>]` | `nav.openSheet(fid, lens?)` (useNavigation.ts:54-67) |

- When the id resolves to nothing, keep the camera still and show "<kind> <id> is not on Personas' plan". This is the
  same rule the stand-in uses (`bp:scripts/focus-standin.ts:25-33`).
- `hash` is bp-web-only. Personas may read `lens=<id>` from it for `openSheet`'s lens argument and ignore the rest.
- `say` is one line to show in the follow chip.

**The seam to add.** `LensSheetRequest` carries only `{ kind, projectId }`. `LiveBlueprint` takes `initialFeature` once
(`P:.../live/LiveBlueprint.tsx:24-40`, `P:.../controller/useSheetController.ts:73-81`, guarded by `opened.current`).
Applying a place needs two changes:

1. `place?: FocusPlace` on the request. Opening another product remounts the sheet (it is keyed by `projectId`,
   `P:.../lens/LensSheetHost.tsx:46-47`).
2. A small `useFocusApply(nav, plan)` in the sheet controller for moves within the open product.

## 3. Personas as a publisher

When the owner moves deliberately in Personas, Rust publishes the place with surface `personas`. bp's web, the VR table
and Glim then follow Personas.

| Owner action in Personas | Published place |
|---|---|
| opens a product's sheet (Picker row, `P:.../picker/ProductRow.tsx:80`; or a deck card) | `{ product, level: 'L0' }` |
| flies to a wing (or a room, which is the same domain) | `{ product, target: { kind: 'wing', id: '0:<domainId>' }, level: 'L1' }` |
| flies to a bay | `{ product, target: { kind: 'room', id: <capabilityId> }, level: 'L2' }` |
| opens a feature's L4 sheet | `{ product, target: { kind: 'feature', id }, level: 'L4' }` |

Echo rules Personas must keep (bp's web keeps the same ones, `bp:apps/web/src/lib/focus/shared.ts:1-6,113-120`):

1. **Never publish a place you were sent.** While applying, set an `applying` flag. Hush publishes for 2.5 s after
   landing, and skip any place where `sameSpot(p, lastApplied) && sameSpot(p, view.shared.place)`.
2. **Publish only deliberate moves.** Opening a product, a wing or bay fly, and opening or closing an L4 sheet count.
   Camera drift, wheel zoom and `j/k` stepping through a queue do not count. Coalesce bursts (last of 250 ms).
3. **Map the place back exactly as it came in.** A lossy round trip republishes a different spot and makes a new rev.
   For example, bp's empty-domain room falls back to Personas' site, and publishing that site would move the shared
   focus. Rule 1 is what stops it, so never weaken it.
4. **Use the bp slug from the root table, never `bpSlug(root)` alone.** A wrong slug is a valid slug for some other
   product, or a 404 in every follower.

## 4. The Morning Watch in Personas

- **Read the deck from Rust.** Use `GET /api/companion/morning` and render it read-only in the Monitor. This means bp's
  JSON (`MorningDeck`, `bp:packages/core/src/companion/morning.ts:34-46`), not Personas' wire types. Those stop at
  store v3, with no `tier` or `origin` (`P:src/lib/lensScan/wire.ts:68`), so reading bp's computed deck avoids that
  drift. Each card's `place` is a FocusPlace (morning.ts:64-65,125,155). Reading a card in Personas applies its place
  locally and publishes it as `personas`.
- **Approve uses Personas' own decide.**
  - It calls `actions.decide([card.decision.proposal], 'approve', 'Morning Watch')` → `lens_scan_decide`
    (`P:src-tauri/src/commands/infrastructure/lens_scan/mod.rs:66`), with `projectId` resolved from `card.product`
    through the root table. It never calls bp's POST.
  - **Correction to the brief:** in Personas' sheet that verb is **A**, the same letter as bp's deck
    (`P:.../blueprint/model/keymap.ts:2-5,24`). **Y** in the sheet is *triage accept* of a built item (`keymap.ts:27`,
    `PARITY.md:221`), which is bp's ledger A.
  - bp's deck takes both A and Y for approve (`bp:apps/web/src/components/focus/MorningWatch.tsx:23`). Personas' deck
    may do the same in its own key scope, but both keys must call `decide`, never `triage`.
  - The decision is signed `user:<gh>`, else `user:personas`.
  - bp's deck drops the proposal on its next read, because it lists only `status === 'proposed'` (morning.ts:69-80).
  - `BP_WRITES=off` does not apply to this path. It gates bp's own decide (`bp:.../morning.server.ts:85-88`).
- **Defer and Hold are bp-only today.** They write one `SteerRow` (morning.ts:31) to
  `<root>/.ai/lens-scan/work/steering-log.jsonl` and re-render `steering-log.md` (morning.server.ts:26-27,49-58,79-101).
  The recommendation is to **leave them to bp** for now and show Defer and Hold in Personas' deck as "Defer / Hold in
  bp" (they open the deep link with `?morning=<card>`). If parity is wanted later, there are two rules:
  - Personas appends exactly one `SteerRow` line (`{ at, product: <bp slug>, proposal, verdict, title, by, until? }`,
    `until = at + 20 h` for defer). It never rewrites the file and never touches `steering-log.md`.
  - bp first renders the `.md` on read rather than only on its own steer, so a Personas row is not missing from it
    (see section 6).
- **The close card will not count Personas' approvals.** Its "N approved" comes only from steering-log rows
  (morning.server.ts:70-72, morning.ts:173-181). Section 6 proposes the bp-side fix.

## 5. Rollout steps (Personas), each with its check

1. **Rust focus client, read-only.** GET `/api/session/focus` at 1 Hz → `bp-focus:view`. *Check:* with bp's web on
   :3010 and Follow on there, moving the bp page changes `view.rev` and `shared.place` in Personas' devtools. With bp
   down, the client reports offline every 5 s instead of erroring each second.
2. **Product table by root.** Fetch `GET /api/products` and match on canonical roots. *Check:* a unit test with a
   worktree root (`hk-bp-ref-personas` → bp slug `personas`) and a product registered under a renamed slug both
   resolve. An unknown slug yields "Not in Personas".
3. **Reader presence.** `hello` every 15 s only while a Blueprint surface is visible; `forget` on close. *Check:* bp's
   follow chip lists "Personas" live while the tab is open and shows it gone 45 s after the tab is hidden.
4. **Follow and apply.** A Follow chip, `follow *`, `toApply`, `place?` on `LensSheetRequest` and `useFocusApply`.
   *Check:* each row of the 2.3 table, driven by `scripts/focus-standin.ts --lead` and by bp's Morning deck (`M`, then
   `→`), lands on the right Personas node. A capability room lands on its bay. An unknown id holds still and says so.
5. **Publish.** Publish deliberate moves with the echo rules. *Check:* with Personas and bp's web both on Follow `*`,
   one move in Personas raises `rev` by exactly 1, and bp's web follows. Then one move in bp raises `rev` by exactly 1,
   and Personas follows and publishes nothing (check the bp record: Personas' `rev` is unchanged).
6. **Morning deck, read-only, with Approve via `lens_scan_decide`.** *Check:* approving a decision card in Personas
   moves the proposal to `approved` in `scan.db`, and bp's deck no longer shows it on its next GET.

## 6. Risks, and what bp would add

**Risks.**

- **CSP and origin.** Any webview implementation fails in the shipped build (section 2.1). Keep every call in Rust.
- **Slug mismatch.** `bpSlug(root)` is a convention, not a lookup, and it is already used for the Release deep link
  (`useBpRelease.ts:110`). Fix both uses with the root table.
- **Wire drift since fbef867** (912 bp commits).
  - Room ids changed meaning on 2026-10-25, so a bp `room` is Personas' bay.
  - bp's multi-building layout prefixes wing ids with the building index (`bp:layout.ts:144,173-179`), and Personas
    only knows `0:`.
  - Nothing gates either drift (DOSSIER section 4). Pin the mapping with a test that loads one live product's map in
    both layouts and asserts the id table above.
- **Two writers of the same place.** bp is last-writer-wins with echo suppression, and has no locks by design.
  - If the owner moves in Personas and bp at once, the later rev wins and the other surface flies.
  - The real hazard is a lossy mapping that republishes a different spot (rule 3). The worst case is a two-surface
    ping-pong held back only by the 2.5 s hush.
- **Two bp processes.** The web on :3010 and apps/server on :3100 each hold their own focus record and bus
  (focus.server.ts:20-30). Personas must use the same base URL as the bp page the owner has open.

**What bp would add** (all small, all bp-side):

1. **`packages/core/src/session/focus-contract.ts`**, a dependency-free copy target. It holds the types above,
   `PLACE_KINDS` inlined (focus.ts imports place.ts today), `readFocusPlace`, `sameSpot`, `toApply`,
   `followingWords`, `LIVE_MS` and the op list. A header names the bp commit and a content hash, and a bp check fails
   when `focus.ts` drifts from it. Personas copies the one file, and its PORTED header has something to diff.
2. **No CORS or Origin allowance for `tauri.localhost`.**
   - Every Tauri 2 app on the machine shares the origin `http://tauri.localhost`, so allowing it in `writeVerdict`
     (local-only.ts:57-62) would open bp's loopback writes to all of them, not just Personas.
   - The Rust path already passes the guards unchanged. If a webview path is ever wanted, scope it to
     `/api/session/focus` only, plus a per-install token minted by bp. Never widen `LOOPBACK_HOST`.
3. **Slug by root.** Document `GET /api/products` as the lookup. Alternatively, accept `root` in place of `product` on
   publish and resolve it server-side. Also align `focus.ts:66` (`{0,63}`) with the registry rule (`{0,62}`,
   registry.server.ts:61).
4. **A bay-aware place.** Either accept `<capId>.<kind>` bay ids as `room` targets in the stand-in and VR resolvers
   (they already resolve a bay to its room), or add `bay` to `PlaceKind` so a Personas bay and a bp bay can each be
   said exactly.
5. **Morning close card from the store.** Count "approved this morning" from proposals decided in the window by any
   signer, not only from steering-log rows. Render `steering-log.md` on read, so an appended row from another writer
   always shows.
6. **One focus host.** Name the canonical process for the shared focus, or re-read `focus.json` when its mtime changes,
   so :3010 and :3100 cannot disagree.
