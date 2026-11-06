# Standing rules v1 (bp-rules.json)

Status: built, 2026-10-30. Hackathon pack "Rules you set once". The schema is
[rules-1.schema.json](rules-1.schema.json). The code is `packages/core/src/scan/rules.ts` (types, the gate, the replay;
pure) and `packages/core/src/server/rules.server.ts` (files, the log, the doors' gate calls).

**Goal.** One record per product of what agents may NOT do (orders) and what they MAY decide alone (grants). The
owner sets each rule once, every agent door consults it, and any app that opens the product's lens-scan directory can
read it without asking bp.

## 1. Files

Both files sit in `<root>/.ai/lens-scan/work/`, beside `bp-waves.json` and one level under `scan.db`:

| File | Shape | Written by | Kept |
|---|---|---|---|
| `bp-rules.json` | one `RulesFile` (section 2) | bp, whole-file, atomic (section 8) | every rule ever set, revoked and expired ones included |
| `bp-rules-log.jsonl` | one `HeldEntry` per line (section 7) | bp, append-only | never rotated or truncated; readers take the newest 2000 lines (`LOG_MAX`) |
| `bp-rules.corrupt.json` | whatever was there | bp, by rename (section 8) | until a person removes it |

No file means no rules and an empty log. Neither file is meant for git: they hold one owner's decisions about one
checkout.

## 2. RulesFile

```ts
interface RulesFile { version: 1; rules: Rule[] }
```

`rules` is in the order the rules were set, newest last. bp writes `version: 1` and today reads the `rules` array
without checking `version`. Other readers treat any other version as unreadable.

## 3. Rule

| Field | Type | Required | Kinds | Meaning |
|---|---|---|---|---|
| `id` | string | yes | all | `O-n` for an order, `G-n` for a grant (section 4) |
| `kind` | `hold` \| `only` \| `cap` \| `grant` | yes | all | `hold`, `only` and `cap` are orders; `grant` is a grant |
| `text` | string, at most 200 | yes | all | the rule in the owner's words; when the draft gives none, bp fills the kind's template (`RULE_TEMPLATES`) |
| `by` | string | yes | all | who set it: `user:<gh login>`, else `user:blueprint` |
| `at` | ISO date-time | yes | all | when it was set; it is live from this moment |
| `scope` | object | yes | all | where it governs (below) |
| `lenses` | string[], at least 1 | for `only` | `only` | the lenses whose work may still start in the place |
| `maxEffort` | `low` \| `medium` \| `high` \| `xhigh` | for `cap` | `cap` | the highest effort a build in the place may run at |
| `model` | `sonnet` \| `opus` | no | `cap` | only builds on this model are capped; absent = every model |
| `minTier` | 0 \| 1 \| 2 \| 3 | no | `grant` | the tier floor: findings of this tier or milder (0 stop-ship, 1 urgent, 2 normal, 3 backlog); absent = any tier |
| `cautious` | true | no | `grant` | act only on a lens where the grant's approvals agreed with the owner's decisions inside its place at least 90% of the time over at least 3 of them (`lensTrust`, `CAUTION_RATE`, `CAUTION_MIN`); elsewhere the finding goes to the person. Absent = not cautious |
| `tools` | string[], at least 1 | no | `grant` | the agent tools it lets run without a card (catalog names); absent = `decision.answer` and `wave.dispatch` |
| `expiresAt` | ISO date-time | for `grant` | all | when it ends by itself; absent = until revoked |
| `revokedAt` | ISO date-time | no | all | when a person revoked it |
| `revokedBy` | string | no | all | who revoked it, signed like `by` |
| `evidence` | object | no | all | what the replay said when it was set: `{ decided, matched, differed, abstained, at }`, all five present |

"For `only`", "for `cap`" and "for `grant`" mean bp's write path refuses the draft without them
(`checkRuleBody`); the TypeScript type keeps them optional, and a reader must not fail on their absence.

`scope` is a `ScanScope`:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `feature` \| `bay` \| `room` \| `wing` \| `all` \| `selection` | yes | what kind of place it is |
| `id` | safe id | no | the place id (a feature slug, capability, domain or wing id); absent for `all` |
| `label` | string, 1 to 200 | yes | what the UI calls the place: "Invoice OCR", "Payments room", "Everything" |
| `features` | safe id[] | yes | the feature slugs the place covered when the rule was written; `[]` for `all` (every feature) |

A safe id matches `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$`. The features are resolved when the rule is written, so the
gate needs no map: a feature added to the wing later is not covered. A scope other than `all` names at least one
feature, and at most 2000.

The write path also bounds `hours` (the draft's lifetime) to `0 < hours <= 720`, so `expiresAt` is at most 30 days
after `at`. A grant must have `hours`, so every grant expires.

Readers ignore keys they do not know.

## 4. Ids

Orders are `O-1`, `O-2`, ... and grants are `G-1`, `G-2`, ..., numbered per product (`nextRuleId`). The next id of a
kind is one more than the highest of that prefix in the file, revoked and expired rules included. An id is never
reused, and a rule is never deleted: revoking sets `revokedAt` and `revokedBy` and keeps the rule in the file as the
record. The HTTP routes accept ids matching `^[OG]-\d{1,6}$`.

## 5. Liveness

A rule is live at time `now` when it has no `revokedAt` and either has no `expiresAt` or `expiresAt > now`
(`isLive`). Only live rules act. A rule that is not live has ended: revoked if `revokedAt` is set, else expired.

A rule covers a feature when its scope is `all` or the feature is in `scope.features` (`covers`).

## 6. What the gate holds

Every agent door calls one gate before it builds or scans (`gate`, through `gateBuild` / `gateScan`): wave compose
(`wave.compose`) and dispatch (`wave.dispatch`), `/dispatch` (`dispatch`), a lens's execute (`lens.execute`), a
place scan (`scan.place`, with the lens `all` when it scans every lens at once, so any `hold` or `only` refuses that form) and a lens's prepare job (`lens.prepare`, gated as that lens's scan of everything: it edits the
repo across the product). The gate reads only live orders. Grants never refuse.

The gate **fails closed**: while `bp-rules.json` exists but cannot be read or parsed, every build and scan is refused,
citing `bp-rules.json`, until it can (the owner's next write moves a corrupt file aside, section 9).

| Kind | A build item (finding: feature, lens) is held when | A scan (lens, scope) is refused when |
|---|---|---|
| `hold` | the order covers the item's feature | the order's place and the scan's place share a feature, or either is `all` |
| `only` | the order covers the feature and the item's lens is not in `lenses` | the places touch as above and the scan's lens is not in `lenses` |
| `cap` | the order covers the feature and either the act names no effort (it would run at the CLI's default, which no cap can vouch for), or names one above `maxEffort` (order `low` < `medium` < `high` < `xhigh`) while `model` is absent, equals the act's model, or the act names no model | never |

For a build, the first live order that holds an item is cited for it. The act keeps the items no order holds; when
every item is held, the first holding order refuses the whole act and the door answers 403
`{ error, order, held }`. Under a `cap`, a place builds only through a wave package that names its effort. A refusal cites the rule as
`{ id, kind, by, at, text, place }`, where `place` is `scope.label`.

The gate's behaviour is also kept as data: [`rules-1.cases.json`](rules-1.cases.json) lists rules, acts and what the gate
answers (held ids with their order, the refusing order, the covering grant). `scripts/check-rules.ts` replays every case on
bp's gate; any other enforcer of this file (a Personas port) must pass the same table.

## 7. The log and the record

Each act the gate held items from, or refused, appends one line per citing rule to `bp-rules-log.jsonl`:

```ts
interface HeldEntry { at: string; rule: string; tool: string; ids: string[]; refused: boolean }
```

`at` is when the door ran, `rule` the order's id, `tool` the door (`wave.compose`, `wave.dispatch`, `dispatch`,
`lens.execute`, `scan.place`), `ids` the findings this order held (`[]` for a refused scan), and `refused` whether the
whole act was refused. A log that cannot be written is warned once and never fails the door. Readers skip torn or
foreign lines. Per rule, `tallyHeld` counts the acts (`times`), the items, the refusals and the last time.

**Breaches** are not in either file. For an order, a breach is a finding approved after `at` and before the order
ended (`revokedAt`, else `expiresAt`), inside its place, that the order would have held (`breachesOf`). The doors that
consult an order are builds and scans, and approving is neither, so a person's own approval in the plan makes a breach
as well as anything that went around bp (a CLI run, another app's runner): an order stops the build, not the approval.
They are read from `scan.db` decided rows (a `cap` breach
also needs the model and effort from the `bp-waves.json` package that built the finding).

## 8. Grants and the `rule:G-n` / `policy:pol_..` signatures

A live grant lets the companion run a card on its own when the tool is in the grant's `tools`, and every finding the
call names is inside the grant's place and, when `minTier` is set, carries a tier that is `>= minTier` (`grantFor`).
A finding with no tier is never covered by a tier-bound grant, and an id the store lacks is never covered. A `cautious`
grant also needs the finding's lens to be one it has earned over the owner's decided rows (the same record the replay
reads), earned on the owner's real decisions only (rows of a `syn-` run never earn it); a reader that cannot read that
record must treat a cautious grant as covering nothing.

The call a grant runs is signed with the grant: the route it reaches writes `decided_by = 'rule:G-n'` in `scan.db`'s
`proposals` (proposal decisions and wave dispatch). The owner's own decisions stay `user:<login>`. The replay a new
rule is tested against reads only the owner's decisions, so rows signed `rule:` are left out of it and never count as
an order's breach. A card a companion policy runs (bp's older global grants, `policies.json`) is signed `policy:pol_..`
the same way and is left out the same way. The signature is accepted only with a per-process token bp never hands out,
and only while the permission still covers the call as it is when it lands (a wave changed since the card was filed, or
a grant revoked meanwhile, is refused 403). The card's request goes to the server's own bound origin
whatever `Host` the filing request carried, so neither token reaches another port (`originOf`, held by
`check:companion-door`). `POST /api/companion/turn` still gives the MCP process its request's origin; that process holds
neither token. bp is loopback-only, so this guards against the agent, not against an attacker already on the machine.

## 9. Writing

Only bp writes `bp-rules.json`, and only on the human path: `POST /api/products/<slug>/rules` (without
`preview: true`) and `DELETE /api/products/<slug>/rules/<id>`, each requiring the `x-bp-human` token that bp's own page
holds. An agent may propose a rule (`rule.propose`) and preview its replay; only a person sets or revokes it.

A write is whole-file and atomic: bp writes `bp-rules.json.<pid>.<ms>.tmp` and renames it over the file. Before
writing, bp reads the current file. If the file exists but is not JSON with a `rules` array, bp renames it to
`bp-rules.corrupt.json` and writes a new file in its place. If it cannot be read at all (busy, permissions), the write is
refused (503) rather than risk replacing rules it could not see. Entries bp does not recognise are written back as they
were. A reader never sees a half-written file.

bp also writes `bp-rules-log.jsonl`, by appending (section 7). No other app writes either file.

## 10. Reading

| Reader | How |
|---|---|
| bp's doors | `readRules` on every call (no cache): no file = no rules; unreadable or corrupt = every build and scan refused (fails closed), warned once |
| HTTP | `GET /api/products/<slug>/rules` answers `{ rules, record, held, breaches, since, suggestions }` (a corrupt file reads as no rules here) |
| MCP | `rules.list` (the same GET) |
| Personas | the files themselves, from the lens-scan directory it already opens (proposal: `docs/concepts/rules-personas-adoption.md`) |

bp's reader keeps the entries that have a string `id`, `kind`, `text`, `by` and `at`, and a `scope` object with a
`features` array. It skips any other entry.

## 11. Example

```json
{
  "version": 1,
  "rules": [
    {
      "id": "O-1",
      "kind": "hold",
      "text": "Hold: no builds or scans start here until I lift it",
      "by": "user:ana",
      "at": "2026-10-30T09:00:00.000Z",
      "scope": { "kind": "wing", "id": "payments", "label": "Memberships & Payments", "features": ["card-payments", "refunds-account-credit"] },
      "expiresAt": "2026-11-02T09:00:00.000Z",
      "evidence": { "decided": 107, "matched": 17, "differed": 11, "abstained": 79, "at": "2026-10-30T09:00:00.000Z" }
    },
    {
      "id": "G-1",
      "kind": "grant",
      "text": "Agents may approve tier 2+ (normal or milder) findings here on their own",
      "by": "user:ana",
      "at": "2026-10-30T09:05:00.000Z",
      "scope": { "kind": "room", "id": "front-desk", "label": "Front desk", "features": ["check-in", "class-booking"] },
      "minTier": 2,
      "expiresAt": "2026-10-31T09:05:00.000Z",
      "revokedAt": "2026-10-30T12:00:00.000Z",
      "revokedBy": "user:ana"
    }
  ]
}
```

`O-1` holds every build and scan in two payments features until 2 November. `G-1` was a grant and has been revoked;
it stays as the record, and the next grant is `G-2`. A matching log line:

```json
{"at":"2026-10-30T10:12:44.120Z","rule":"O-1","tool":"wave.dispatch","ids":["sec-card-3","dev-refund-1"],"refused":true}
```
