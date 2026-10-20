// Run @bp/core's TypeScript source on plain Node (24+, type stripping), as apps/server does:
//   node --import @bp/core/register <entry.ts>
// Node strips types itself; these hooks add what the bundler gave the web app: extensionless relative imports
// (`./products.server` -> .ts, a directory -> index.ts) and .json / .jsonl files as default-export modules (the
// .jsonl one as its text). scripts/lib/src-hooks.mjs is the checks' twin of this file (it also maps `@/`).
import { register } from 'node:module';

register('./register-hooks.mjs', import.meta.url);
