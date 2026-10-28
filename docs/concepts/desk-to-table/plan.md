# Desk to table: the crossing from the web app into the VR table

Written 2026-10-28. This plan takes **"The Desk Becomes the Table"** from a hackathon branch to the product. The
**migration** - landing the winner's web code on master - runs here, on the desk machine that ran the hackathon (Part W).
After that push the project moves to **Lynx** for good (owner, 2026-10-28): the LAN door, the contract for Unreal and the
whole VR half are built there (Part L). Lynx is assumed to have every tool ready: UE 5.8.4, the Android toolchain (S2),
Meta XR v207 and adb.

## The decision

- **Contest `web-vr-crossing`, 2026-10-28.** Twelve feasibility reports from four seats. The owner shortlisted A/1 Match
  Cut, A/2 The Desk Becomes the Table and D/2 The Paired Lantern.
- **The hackathon, same day.** It ran for 5 h in real code, one worktree per shortlisted design. The owner then chose
  **A/2**: "Well done, lets stop the servers, start project for migrating A/2". The record is in
  `.contest/arena/web-vr-crossing` (local, git-ignored) and the vault's `Solutions/contests/web-vr-crossing.md`.
- **The design in one sentence.** Nothing is streamed. The headset's own cameras show the real desk and monitor. The
  plan lifts off the pinned monitor onto the real desk, and the room fades to the studio. Only the address of where
  you are crosses the network: a **place baton** held briefly by `apps/server`.
- **Why it fits the machines we have.** It needs no PC-to-headset video route, and none is proven on Lynx (ARM64)
  (`../vr-light-table/headset-plan.md`, rungs 1-4). It runs on the standalone APK that the competition already needs
  (`../vr-light-table/standalone-plan.md`, S5), over the LAN door the owner has already approved (S8, D4).

## What the hackathon built, and what it did not

The source is branch `hack/a2-desk-table`: 50 commits on master `71f1b8d`, 37 files, +2472/-28. It exists only on the
desk machine, in `.claude/worktrees/hack-a2-desk-table`, until W0 below lands it. At its HEAD `50e23a2`, `npm run check`
passed 121/121 and `npm run build` was green. Its own record is that worktree's `.hack/RESULT.md` (local).

| Part | Built | Files |
|---|---|---|
| The blueprint as the table's first frame | Lit glass pane with the table's rim, VR-blue paper, bloomed walls, rooms as glass, a slab edge, ribbons as glass trays, bay frames, warm lamp light over features in trouble. Static raster only, so a gesture costs nothing extra (gesture p50 16.7 ms on a quiet machine) | `engine/render/plan.ts`, `engine/theme.ts`, `engine/Engine.ts`, `app/globals.css`, `components/blueprint.css` |
| The place baton | A pure state machine: armed, claimed, live, returned, expired. One writer at a time, a 120 s TTL, and a take-back from the page. Guarded routes on both mounts, plus a `place` event on the companion stream | `packages/core/src/session/place.ts`, `packages/core/src/server/api/session/`, `apps/web/src/app/api/session/`, `companion/contract.ts` |
| The page's half | The rail's **VR · Table** card arms the baton. The page follows the table's writes and shows the hand-back crumb ("the table left you at ..."). `BP_COMPANION_URL` rewrites `/api/session` to the one companion process | `components/crossing/{CrossingHost,TableCard,follow,place}.tsx/ts`, `companion/stream.ts`, `apps/web/next.config.ts` |
| The crossing demo | `/crossing` and `?cross=1`: ten states on the design's clock, paired and unpaired, the pin ceremony, and the real UE capture beside the mock. A lazy chunk | `components/crossing/{Crossing,timeline,table-art,facts,baton}.tsx/ts`, `crossing.css`, `app/crossing/page.tsx`, `public/crossing/` |
| Gates | `check:place-baton` (41 cases) and `check:crossing` (23 cases), both in `npm run check` | `scripts/check-place-baton.ts`, `scripts/check-crossing.ts` |

**Measured in the hackathon.**
- About 2.2 KB on the wire for a whole crossing, with 0 video frames.
- It works in the real one-companion topology: `apps/server` holds the baton, a device writes a place on it directly, as
  BpLink would, and the page follows.
- The glass adds 30-40 % to a full static raster, paid once when a gesture settles.

**Not built, and the subject of this plan.**
- The S8 LAN door. On loopback, a caller names its device with an `x-bp-device` header.
- Everything in Unreal.
- Any run on a Quest 3S.

## The contract both halves build to

The web half publishes it, and the VR half consumes it. Nothing below may change without a gate failing.

```ts
// packages/core/src/session/place.ts (as built)
interface Place {
  product: string;                 // 'kettle'
  hash: string;                    // the page's own hash, as Engine.hashOf writes it: '#at=bkg-06&lens=perf'
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  target?: { kind: 'feature' | 'room' | 'wing' | 'site'; id: string };  // the table maps L3/L4 to their room
  conversationId?: string;         // the desk's companion thread, so the lamp keeps talking
  from: 'web' | 'vr';
  at: string;                      // ISO time
}
type BatonState = 'armed' | 'claimed' | 'live' | 'returned' | 'expired';
interface PlaceBaton { id: string; state: BatonState; place: Place; armedAt: string; ttlMs: number; device?: string }
```

| Verb | Path | Caller | Guard | Effect |
|---|---|---|---|---|
| POST | `/api/session/place` | the web page | loopback + `x-bp-human` | arm (409 while a device holds it, unless `takeBack: true`) |
| GET | `/api/session/place?claim=1` | the APK, through `:3101` | door Bearer, scope `place` | armed → claimed; returns the Place (404 none, 410 expired) |
| POST | `/api/session/place` | the APK, through `:3101` | door Bearer, scope `place`, the claiming device only | claimed or live → live, `from: 'vr'`; a `place` event goes on the stream |
| POST | `/api/session/place/return` | the APK, through `:3101` | as above | live → returned; a `place` event goes on the stream |
| GET | `/api/companion/stream` | the web page | as today | plus `{ type: 'place', baton }` |

**The crossing's clock.** These are the times the web demo plays (`components/crossing/timeline.ts`) and the times UE
must match. t 0.0 is the XR session reaching FOCUSED:

| t (s) | Step | Who draws it |
|---|---|---|
| before 0 | the person arms the baton (any time within 120 s), then puts the headset on (3-5 s of black) | the page, then nobody |
| 0.0 | passthrough: the real desk and monitor | the Quest |
| 0.8 | baton claimed; the place shows as a label on the pinned monitor | the APK |
| 1.0-2.0 | the paper lifts off the monitor anchor and lands on the desk plane (content only, BpSwitch's smoothstep) | the APK |
| 2.0-2.8 | passthrough fades to the night studio; rooms rise out of the glass | the APK |
| 2.7 | the lamp names the place | the APK |
| while in VR | every level change posts the place, and the page follows | the APK, then the page |
| headset off | return (STOPPING, or the app pausing); the page is already there, with the crumb | the APK, then the page |

**Unpaired** (no pairing, or no baton): the APK opens on the bundled Kettle at home, exactly as the judged build does
today. No passthrough, no lift, no live lamp.

## Part W: the migration, here (desk machine, x64)

Each step is atomic commits on master, with `npm run check` green and the secret scan clean, then pushed. This is how
Lynx receives the work (CLAUDE.md, Git). Part W ports what the winner built and adds nothing new; new work starts on
Lynx.

### W0. Land the branch on current master

- Rebase `hack/a2-desk-table` onto `origin/master` in a fresh worktree (`spark/desk-to-table`). Since `71f1b8d`,
  master's only file in common with the branch is `docs/blueprint-ui.md`; resolve it keeping both sides.
- Keep the branch's commits; they are already atomic. Drop none of the gates.
- Keep `apps/web/public/crossing/` (two real UE captures, 160 KB): the demo shows them as REAL.
- **Pass:** `npm run typecheck`, `npm run check` (121 or more) and `npm run build` are green on the rebased tip.

**Done 2026-10-28.** All 50 commits rebased onto `0051ba9` with no conflicts: `docs/blueprint-ui.md` merged on its own,
with the new section "The light table and the crossing" beside master's. The tip is `164532f`.
- `npm run typecheck` passed, `npm run check` was 121/121 and `npm run build` was green. Its warnings come from the
  existing `api/products/[slug]/shots` route, as in the hackathon.
- A dev smoke test answered 200 on `/`, `/crossing` and `GET /api/session/place` (`{"state":"none"}`).
- Master fast-forwarded to it.

### W1. A review pass before the port is called done

The hackathon's two code reviews fixed 17 issues. Read the rebased diff once more against `../../blueprint-ui.md` and
the repo's laws, and fix in place:

- **Device identity.** `x-bp-device` is accepted from any loopback caller. That is acceptable while only loopback
  exists, but the door (D1) must set it from the paired fingerprint and drop any client-sent value. Write that rule
  into `baton.server.ts`'s header now, and add a gate case for it.
- **Fixture mode.** The follow rides the live lamp's stream, so `?lamp-fixture=1` does not follow. Either make it say
  so in the card, or follow from a fixture stream.
- **Perf on a quiet machine.** The hackathon's figures were taken on a machine loaded by two other competitors.
  - Re-run `python scripts/perf.py` (gesture at `?scale=4`) and the `--lod` raster pass against master, alone on the
    machine.
  - Record the result in `docs/perf.md`.
  - **Pass:** gesture p50 ≤ 16.7 ms.
- **Text floor.** Run `python scripts/shots.py`, which fails on any text under 12 px, over the new look and the card.

**Done 2026-10-28.**
- **Device identity:** `deviceOf` is the one reader of `x-bp-device`, and `check:place-baton` now fails if any other server
  file reads it (seeded red once, then green, 43 cases) (`5f9d8e1`).
- **Fixture mode:** the card says the page will not follow (`7c20eb2`).
- **Perf, alone on the machine, production builds side by side** (`0fd9fd0`, `docs/perf.md`):
  - gesture p50 16.7 ms on every run, so the bar is met;
  - the settle raster costs 1.5-2x the pre-glass build (home 14 → 29 ms), not the hackathon's +30-40 %;
  - the cost is spread over seven parts (no single hotspot) and recorded as the bar for later work, unchanged here,
    since Part W adds nothing new;
  - the first cuts to try are named there: the bay frames as one path, the lamp sprites at home.
- **Text floor:** `scripts/shots.py` holds 12 px over the whole matrix, the new table states included, with no page errors.

### W2. Pin the look

The winner is the code, so the port cannot drift from it. What can drift is the next change.

- Add the table look's states to the screenshot matrix: site, wing, room, bay, the light theme and `?scale=4`.
- Copy the winner's reference shots into `docs/concepts/desk-to-table/ref/`:
  - `compare-l0.png` and `compare-room.png` (before, after, VR);
  - `final-crossing.gif`;
  - `final-s0..9.png`.
- **Pass:** those shots and the refs agree when you look at them side by side.

**Done 2026-10-28.**
- **The matrix** (`04875cd`) now takes a room and a bay in both themes, the table card, and `/crossing` at "Room fades".
- **The refs** (`2e2f7d6`) are in [`ref/`](ref/README.md): the winner's comparisons, the ten crossing states and the GIF,
  plus four shots of the port. The PNGs became JPEGs, about 7.4 MB in all.
- **Side by side:** the ported site plan has the same pane, rim, glass rooms, bloom, slab and lamp light as the winner's.
  The data has moved on since (master's Kettle has a Communications room), so the plan differs, not the look.

### W3. Docs and landing, the end of the migration

- `docs/blueprint-ui.md`: the light table look, the card, the follow, `/crossing` and the session routes (the branch
  already wrote most of it).
- `../vr-light-table/standalone-plan.md` S8: a pointer to the `place` scope.
- This plan: mark W0-W3 done, with the commits.
- `git fetch`, rebase onto `origin/master`, `npm run check`, the secret scan, then push.
- **This push ends development on the desk machine.** From here on the project lives on Lynx (owner, 2026-10-28): the
  rest of this plan, and everything after it, runs there. The hackathon worktrees and the arena stay on the desk
  machine as the record; nothing in them is needed on Lynx.

**Done 2026-10-28.**
- `docs/blueprint-ui.md` now covers the device seam, fixture mode and a pointer to this plan.
- `standalone-plan.md` S8 has the `place` scope.
- The VR Light Table README links here.
- The migration ends with this push; the rest of the plan runs on Lynx.

## Part L: everything after the migration, on Lynx

Lynx pulls master after W3. The assumption is that the tooling is ready: `start-editor.ps1`'s environment,
`package-quest.ps1`, adb, Meta XR v207, the schema and PoF junctions, and a Quest 3S in developer mode with hand
tracking on. UE work runs in the main checkout only, one UBT or editor at a time (`.claude/spark/config.md`).

Part L has two phases (owner, 2026-10-28):

- **The base: L0 and L1.** The competition build's own path. It is not optional.
- **The optional crossing phase: D1, D2 and L2 to L7, before 2026-11-18.** It is entered only when every earlier aspect
  works well: L0 and L1 pass, and the competition plan's S4 (the mobile tier, measured on the device) and S6 (the judged
  experience: the cold start, the tour, the hands-first audit) are green. If any of those is still open, the crossing
  waits for them, and the competition build ships without it. Inside the phase, every step re-runs L0's unpaired line;
  a step that breaks it is reverted, not patched over, before the submission (S7).

### L0. Sync and regress the judged build

- Pull master, re-run `apps/vr/tools/link-schema.ps1` so `FBpPlace` is visible, and build the editor.
- Run `node apps/vr/tools/run-bplink.mjs --mode game --bundle` and the Simulator (`--xr-sim --vr`). Both must log the
  bundle line and `Kettle wings=5` as before.
- **Pass:** the unpaired path is unchanged. This is the competition build's regression line, and every later step
  re-runs it.

### L1. The first run on the Quest 3S (standalone-plan S5)

- This is on the competition path already. If it is done by the time this plan runs, record its reading and skip it.
- **Pass:** `adb logcat -s UE` shows the bundle line, then `Kettle wings=5`, and the table draws and takes hands.

> **The optional crossing phase starts here.** Enter it only when the gate holds: L0, L1, S4 and S6 green. Its steps
> run in the order below.

### D1. The S8 door, server half (on Lynx, the door's host)

S8 is the door between the headset and `apps/server`. Lynx serves it (owner, 2026-10-28), so it is built and tested
there. It is TypeScript in `apps/server`, and its headset acceptance is L2. It follows
`../vr-light-table/standalone-plan.md` S8 as written, plus one scope:

1. **Opt-in.** `--lan` starts a second listener on the LAN address at `:3101`; without the flag nothing changes.
2. **Admission.** Only private-range peers are admitted (10/8, 172.16/12, 192.168/16, 100.64/10). Every refusal is the
   same bare 403.
3. **The pairing ceremony.**
   - The device requests pairing, and the door shows a 6-character code (2 min TTL) on the lamp's tag.
   - The owner approves with `npm run server -- pair approve <code>`, or in the web lamp, and chooses the scope there.
   - The device claims its token once. `$BP_HOME/lan/paired.json` keeps only its SHA-256 fingerprint, the device,
     the scope and the expiry (30 days by default). `pair revoke` removes it.
4. **Scopes.** Each scope is forwarded in-process to the loopback mount, so every existing guard still runs:
   - `read`: structure, plan, scans, scan, waves;
   - `standup`: also the companion turn, focus and cards GETs;
   - **`place`**: the three baton verbs, with `x-bp-device` set by the door from the fingerprint. Never cards/<id>,
     human-token, dispatch, build or finish.
5. **Constant time.** Fingerprints are compared in constant time.
- **Pass:**
  - a script, `scripts/check-lan-door.ts`, run in `npm run check`, drives the whole sequence: pair, approve, claim,
    `place` claim and publish and return, a revoke, and the refusals (wrong peer, no token, a wrong scope, a forged
    `x-bp-device`), with identical refusal bodies;
  - a second machine on the LAN, or `curl` from a VM, completes a claim against `:3101`.

### D2. Hand the contract to Unreal (on Lynx)

- **Schemas.** Add JSON Schemas for `Place`, `PlaceBaton` and the `place` event to `packages/schema`. Generate the UE
  structs `FBpPlace` and `FBpPlaceBaton`. Extend `check:schema` parity, so a changed field fails the build in both
  channels.
- **Contract text.** Write a new section in `../vr-light-table/companion-link.md`, "The place baton": the route table
  above, the clock table above, and what BpLink must not do:
  - write while another device holds the baton;
  - claim without a pairing;
  - call `x-bp-human` routes.
- **The clock.** Export `timeline.ts`'s design times as named constants and quote them in the contract, so the UE step
  durations have one source.
- **Pass:** `check:schema` is green, and the generated header compiles in the UE stand-in (`packages/schema/ue-standin`).

### L2. BpLink through the door

1. **Pairing.** On a request, BpLink shows the 6-character code on the lamp's tag. The owner approves it on the PC.
   BpLink claims the token and stores it under the app's `Saved/`.
2. **Requests.** Every request to the door sends `Authorization: Bearer`. The URL comes from `-BpLinkUrl` or a saved
   value: `http://<lynx-lan-ip>:3101`.
3. **Cleartext.** Set `usesCleartextTraffic` for Android (S8's recorded deviation; TLS on the door is the follow-up).
4. **Lynx side.** Allow inbound `:3101` on Lynx for the **private** network profile only (owner step).
- **Pass:**
  - paired, the APK reads the live plan over `:3101`, and the log names the source;
  - unpaired or unreachable, it reads the bundle (L0's line).

### L3. The baton in BpLink

- **On FOCUSED**, `GET /api/session/place?claim=1`.
  - On 200, build the table at `Place.target`, hidden (a feature or bay opens its room, with the feature lit).
  - On 404 or 410, open home: the unpaired ending.
- **On every level change** the table makes (dive, lift, next room, a lamp focus), `POST /api/session/place` with
  `from: 'vr'`, the target, and a hash built the way the web reads it (`#at=<id>`).
- **On STOPPING, the app pausing (`ApplicationWillEnterBackgroundDelegate`) or exit**, `POST /api/session/place/return`.
- Parse with the generated `FBpPlace`; never hand-parse.
- **Pass:**
  - the scripted desk side arms, the headset claims, and the open web page flies to each place the table writes;
  - headset off leaves the crumb;
  - a second device's write is refused;
  - L0's line still holds.

### L4. `ABpCrossing`: passthrough, lift, fade

1. **Passthrough.** Enable persistent passthrough (`UOculusXRPassthroughSubsystem`), with its project and manifest
   settings for Android.
2. **At FOCUSED**, show passthrough. Build the room at the claimed place, unseen.
3. **At t 0.8**, show the place label on the monitor anchor.
4. **Lift, t 1.0-2.0.** The paper lifts from the monitor anchor to the desk plane, using BpSwitch's ease and moving
   content only.
5. **Fade, t 2.0-2.8.** Passthrough fades to the studio, and the rooms rise.
6. **At t 2.7**, the lamp caption names the place, using the lamp caption's text class (40 arcmin).
- The times come from D2's constants. The view is never moved; log any pawn or camera transform during the crossing as
  an error.
- If the monitor anchor is unknown (no ceremony yet, or lost), the paper fades in on the desk instead.
- **Pass:**
  - the crossing runs on the Quest 3S from a real arm on the desk;
  - the log shows no view motion;
  - the owner rates comfort 4/5 or higher in a sitting;
  - L0's line holds.

### L5. The pin ceremony: desk and monitor, once

- The first crossing asks for:
  - a tap on the desk, which sets the table top (the tapped height replaces `BpView.Seat`'s table move);
  - a touch on the monitor's two top corners.
- Save them as Meta spatial anchors, and find them again by UUID on later runs.
- Re-place the deck and the caption from the real eye, as `BpHeadset.cpp` item 2 already does.
- **Pass:**
  - after an app restart the anchors are found and the lift starts at the monitor;
  - with an anchor deleted, the fallback (paper on the desk) runs once and offers the ceremony again.

### L6. The mobile tier with passthrough (standalone-plan S4)

- Passthrough plus the table on the XR2 Gen 2, measured on the device: 72 Hz held and GPU ≤ 13.9 ms (the S4 budget).
- Grade the deck body text in the headset ("reads easily").
- A wave that fails is folded rather than allowed to pull the PC look down, per the owner's S4 rule.
- **Pass:** the budget holds with the crossing's scene loaded.

### L7. Owner sittings and the record

- **Two sittings in the headset:**
  1. the crossing from the site, a room and an open feature;
  2. comfort, text and the way back.
- **Record** in `../vr-light-table/runs/<date>-crossing.md`:
  - the route;
  - the timings measured against the clock table;
  - comfort ratings;
  - the anchor reliability;
  - frame times.
- **Readings** in `../vr-light-table/machine.md`.

## Order and size

| Step | Where | Size | Depends on |
|---|---|---|---|
| W0 land the branch | desk | ½ session | - |
| W1 review, perf, text floor | desk | ½ session | W0 |
| W2 pin the look | desk | ½ session | W0 |
| W3 docs, push (the migration ends) | desk | ¼ session | W1, W2 |
| L0 sync, regression | Lynx | ¼ session | W3 |
| L1 first Quest run (S5) | Lynx + owner | on the competition path | L0 |
| *gate: L0, L1, S4 and S6 green* | | | |
| D1 S8 door, server half | Lynx | 1 session | the gate |
| D2 contract to UE | Lynx | ½ session | D1 |
| L2 BpLink through the door | Lynx | 1 session | D1 |
| L3 the baton in BpLink | Lynx | 1 session | L2, D2 |
| L4 `ABpCrossing` | Lynx + owner | 1-2 sessions | L3 |
| L5 pin ceremony | Lynx + owner | 1 session | L4 |
| L6 mobile tier with passthrough | Lynx + owner | ongoing (S4) | L4 |
| L7 sittings and record | owner | 2 sittings | L4, L5 |

The migration: about 1¾ sessions here. The optional phase on Lynx: about 6-7 sessions plus two owner sittings, which
matches the winning report's own sizing once the door is counted.

## Risks

| Risk | What we do |
|---|---|
| The crossing destabilises the judged APK before 2026-11-18 | The phase is optional and gated; everything crossing-specific runs only when paired; L0's unpaired line is re-run at every step, and a step that breaks it is reverted (decision 1) |
| Passthrough or anchors behave differently on the Quest 3S than documented | Each is a probe with a fallback: the paper on the desk without anchors, and the bundle without a pairing |
| STOPPING is not delivered when the headset comes off | The page follows the whole time, so a missed return only leaves the crumb out. The person can take the lead back from the card (`takeBack`) |
| Cleartext Bearer on the LAN | Home LAN or a tailnet only, as S8 records; TLS on the door is the follow-up |
| The glass's raster cost grows with later visual work | W1's quiet-machine measurement becomes the bar in `docs/perf.md`; W2's shots catch drift |
| A device forges `x-bp-device` | The door sets it from the fingerprint and strips the client value (W1 rule, D1 gate case) |

## Decisions (owner, 2026-10-28)

1. **Before the deadline, as an optional phase.** The crossing (D1, D2, L2-L7) is built before 2026-11-18 only if every
   earlier aspect works well: L0, L1, S4 and S6. Otherwise the competition build ships without it.
2. **Keep the `/crossing` demo route** in the product, behind the rail card's "Play the crossing from here", as the spec
   the UE work is measured against.
3. **Lynx serves the LAN door**, and the project's further development moves to Lynx completely after the migration
   (Part W). The desk machine keeps only the hackathon record.

## Sources

- The winning report: `.contest/arena/web-vr-crossing/entries/claude-claude-opus-5-5_xhigh-b/variant-2/` (local).
- The hackathon branch: `hack/a2-desk-table`, and its `.hack/RESULT.md` (local).
- `../vr-light-table/standalone-plan.md` (S4, S5, S8), `../vr-light-table/headset-plan.md`,
  `../vr-light-table/companion-link.md`, `../vr-light-table/machine.md` (reading 37: the 43 cm seated pose).
- Meta: Passthrough API and Spatial Anchors for Unreal. Khronos: `XrSessionState` (STOPPING). These are as cited in the
  report, and `[unverified]` on a Quest 3S until L4-L5.
