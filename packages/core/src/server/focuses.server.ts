// The live saved focuses of a product (scan/focus.ts): `<root>/.ai/lens-scan/work/bp-focuses.json` = { version: 1, focuses },
// oldest first on disk, read on every call and written through products.server.ts's writeAtomic, as bp-waves.json is. A file
// that cannot be read is said once and read as none; a READ never writes, and the write that follows moves the broken file to
// `bp-focuses.corrupt.json` first, so nothing is lost. The list's rule (the same lens and note is one row, the oldest goes at
// MAX_SAVED_FOCUSES) is focus.ts's keepFocus, which the Kettle sim keeps too. Server-only; synchronous, so two calls cannot interleave.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkFocusNote, focusRefusal, keepFocus, type SavedFocus } from '../scan/focus.ts';
import { recovered, warnOnce, writeAtomic } from './products.server.ts';

if (typeof window !== 'undefined') throw new Error('focuses.server.ts is server-only');

export const focusFile = (root: string): string => path.join(root, '.ai', 'lens-scan', 'work', 'bp-focuses.json');
const isFocus = (f: unknown): f is SavedFocus => {
  const x = f as Partial<SavedFocus> | null;
  return !!x && typeof x.id === 'string' && typeof x.lens === 'string' && typeof x.note === 'string' && typeof x.created_at === 'string';
};

/** The file's rows, oldest first; no file = none; a broken file = none, said once. Never writes. */
function rows(root: string): SavedFocus[] {
  const file = focusFile(root);
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnOnce(file, e);
    return [];
  }
  try {
    const xs = (JSON.parse(text) as { focuses?: unknown })?.focuses;
    if (!Array.isArray(xs)) throw new Error('no "focuses" array');
    recovered(file);
    return xs.filter(isFocus);
  } catch (e) { warnOnce(file, e); return []; }
}
/** Whether the file is there but cannot be read as focuses: a write moves it aside before it makes a new one. */
function broken(root: string): boolean {
  const file = focusFile(root);
  try { return !Array.isArray((JSON.parse(fs.readFileSync(file, 'utf8')) as { focuses?: unknown })?.focuses); } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ENOENT'; }
}
function save(root: string, focuses: SavedFocus[]): void {
  const file = focusFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (broken(root)) {
    const aside = file.replace(/\.json$/, '.corrupt.json');
    fs.renameSync(file, aside);
    console.warn(`[bp] ${file} could not be read as focuses and was moved to ${aside}; a new file was written in its place`);
  }
  writeAtomic(file, JSON.stringify({ version: 1, focuses }, null, 2) + '\n');
}

/** The product's saved focuses, newest first. */
export const listFocuses = (root: string): SavedFocus[] => rows(root).reverse();

/** Keep a focus. `created` false: the same lens and note was there, and that row answers. A refusal carries the route's 400. */
export function saveFocus(root: string, lens: unknown, note: unknown): { ok: true; focus: SavedFocus; created: boolean } | { ok: false; status: 400; error: string } {
  const bad = focusRefusal(lens, note);
  if (bad) return { ok: false, status: 400, error: bad };
  const r = keepFocus(rows(root), lens as string, checkFocusNote(note)!, new Date().toISOString(), () => 'f-' + randomUUID().slice(0, 12));
  if (r.created) save(root, r.focuses);
  return { ok: true, focus: r.focus, created: r.created };
}

/** Forget a saved focus; false when it is not there. */
export function removeFocus(root: string, id: string): boolean {
  const all = rows(root);
  if (!all.some((f) => f.id === id)) return false;
  save(root, all.filter((f) => f.id !== id));
  return true;
}
