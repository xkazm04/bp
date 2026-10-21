// Run @bp/core's TypeScript source on plain Node (24+, type stripping), as apps/server does:
//   node --import @bp/core/register <entry.ts>
// Node strips types itself; these hooks add what the bundler gave the web app: extensionless relative imports
// (`./products.server` -> .ts, a directory -> index.ts) and .json / .jsonl files as default-export modules (the
// .jsonl one as its text).
// scripts/lib/src-hooks.mjs is the checks' near-twin of this file, and the two are deliberately NOT the same. It
// does five things this one does not, so do not copy a change between them without reading both:
//   - resolves the web app's `@/` alias (this core runs without apps/web)
//   - tries `.tsx` as well as `.ts` (core-purity forbids React in packages/core, so core has no .tsx to find)
//   - has no "already has an extension" guard, so it runs tryFile on `./x.json` too
//   - marks a resolved .json / .jsonl `format: 'module'` at resolve time, not only at load
//   - strips importAttributes on the fall-through, which this one passes through untouched
// This file's own two narrowings are the extension guard in resolve() and the `file:` guard in load().
import { register } from 'node:module';

register('./register-hooks.mjs', import.meta.url);
