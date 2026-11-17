# Plumbline scenario - a product maintained through bp, idea to deployable

Started 2026-11-17 (spark `agentic-web-hackathon`). The product is **Plumbline** (sibling repo `../plumbline`): sign, gate
and watch to keep an agentic website true after it ships; entry to the Open Agentic Web Challenge, Devpost deadline
2027-01-11 16:00 UTC. The point of this scenario is bp itself: a real product from an empty repo to a deployable one,
driven through bp's scans, morning stand-ups and owner gates, with each phase's lessons landing as a bp or skill change
(`lessons.md`).

## Roles

- **Claude (Director)** orchestrates: builds packages through builder agents, runs the scans and the stand-up, decides
  convention, and brings only major directions to the owner.
- **Owner** decides at phase gates and for stand-up forks that change direction. Only the owner publishes the repo, spends
  money (Otari or any paid call), supplies the Otari account email and records the video in their own voice.
- **bp** is the instrument: `/adopt-bp` registers the product, `/lens-scan` and `/scan-sweep` measure it, `/dowser`
  proposes backlog from evidence, the Morning Watch (`/api/companion/morning`) is the stand-up, the companion and the VR
  table are exercised as surfaces of the same product.

## Phases

| Phase | What lands | Closes with | Owner gate |
|---|---|---|---|
| P0 genesis | repo scaffold, wire contract, stubs, gates, LF pinned; bp registration | first scan of a young repo | none (done 2026-11-17: be498db, 2c604d8) |
| P1 signing | WP1: canonical bytes, keys, sign, verify, rotate, signing CLI, `docs/signature-format.md` | scan, stand-up, `lessons.md` entry | review of the signature format |
| P2 gate + Action | WP2: safe fetch, validator, Atlas and Customs adapters, three drift detectors, the Action | scan, stand-up, lesson | none unless an adapter design is contested |
| P3 the Desk | WP3: the agentic site on the unmodified reference runtime, in-browser sign and gate, BYOK | scan, stand-up, lesson, browser proof | direction of the visuals |
| P4 watch | scheduled drift workflow against the lock, runtime sync | scan, stand-up, lesson | none |
| P5 hardening | an attacker's read of the signing path, accessibility, secret scan, docs sync | scan, stand-up, lesson | publish gate: create the public repo, push, enable Pages |
| P6 release | deploy, screenshots, Devpost text, the video | final scan | owner records the video and submits |

## The rhythm at each phase boundary

1. Gates of the product repo green (`npm run check`) and the secret scan clean.
2. `/adopt-bp` the first time, then `/lens-scan` to re-measure; `/dowser` for backlog evidence once there is code.
3. The Morning Watch deck is read as the stand-up; anything that changes direction becomes one question to the owner.
4. One entry in `lessons.md`: what the phase showed bp or a skill got wrong, and the change it caused (or why none).

## Out of bounds without the owner

Pushing the product repo to GitHub, any paid or keyed external call, committing any key, and recording or uploading the
video. Each is its own gate.
