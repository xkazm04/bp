# Prototypes

These are the two contest winners the app descends from. Each is a static page with no build step:
open `index.html` straight from disk. The data is in `data/`, regenerated with
`node scripts/fixtures/gen-kettle.mjs <dir> --js` and `gen-swarm.mjs <dir> --js`.

| Folder | Round | What it is |
|---|---|---|
| `drawing-set/` | 2 | The drawing set: an L0 site of five wings, semantic zoom from site to feature sheet, lenses as drawing sheets, and the `?scale=4` campus. |
| `site-watch/` | 3 | The drawing set with the simulated agent swarm on top: crews at work, RFI pennants, standing orders, steering previews and the replayable hour. The Next.js app is a port of this page. |

They are kept for reference. Their sample data is the original Kettle shape, not app-structure v3.
