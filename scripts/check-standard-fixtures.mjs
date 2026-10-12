#!/usr/bin/env node
// Kept so `npm run check:standard-fixtures` keeps working: the fixture outcomes (validator runs, the
// applies-when healths, the section 14 example, missing values and the loader) are asserted once, in
// scripts/check-fixtures.ts. This delegates to it, so the two names can never hold different expectations.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-fixtures.ts')], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status ?? 1);
