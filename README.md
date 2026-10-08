# App Blueprint

A canvas that shows a software product as a blueprint: domains, modules and features, each feature
broken into **Development**, **Operations** and **Business** dimensions. The canvas starts with an
overview of the whole product. Lenses then bring up one field's view, the way the layers of an
architectural drawing set do.

The goal is control over apps that AI agent crews build quickly. Many people check state and steer
the work, each from their own field. The blueprint has to show at a glance what exists, what is
pending, what is blocked and what still needs a human to verify it.

## How we work

Prototype and Q&A rounds. Each round produces **four variants** from the previous baseline. The
client picks ideas and answers product questions, and the next round builds on that. The visual
shape comes first. The data model, backend and workflows follow in later phases.

| Round | Focus | Notes |
| --- | --- | --- |
| 1 | Theme, canvas shape and content | [docs/rounds/round-01.md](docs/rounds/round-01.md) |

## Repository layout

```
prototypes/
  shared/blueprint-data.js     mock product: Larkspur, a fullstack commerce platform (20 modules, ~120 features)
  shared/blueprint-model.js    shared derivations (scores, rollups, filters) as window.BP
  round-01/<variant>/index.html one self-contained page per variant
docs/
  data-model.md                schema v0.1 and the BP API
  rounds/                      per-round concepts, decisions and open questions
scripts/
  validate-data.mjs            checks the mock data's integrity and coherence rules
  shoot.mjs                    Playwright screenshot and smoke-test harness
  bundle.mjs                   inlines shared scripts into publishable single-file pages (dist/)
```

## Running locally

Each prototype is a static page, so you can open it straight from disk:

```sh
npm install                      # playwright + d3 (d3 is only used to stub the CDN during screenshots)
npm run validate                 # check the mock dataset
open prototypes/round-01/index.html
npm run shoot -- prototypes/round-01/a-cyanotype/index.html   # screenshots go to .shots/
npm run bundle                   # single-file builds in dist/round-01/
```
