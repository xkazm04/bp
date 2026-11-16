// The contract schemas as validators, for the checks that hold real payloads to them: packages/schema/roots.mjs's
// schemaAjv(), the one ajv (draft 2020-12, strict) every validator and check:schema use, so a cross-file $ref
// (morning-deck-1 -> decision-brief-1, shared-focus-1) resolves. `wire('shared-focus-1', 'sharedView')` validates one
// $def; the answer is null when the payload conforms, else the first errors in one line.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../packages/schema/roots.mjs');
type Validate = ((doc: unknown) => boolean) & { errors?: { instancePath?: string; message?: string }[] | null };
type Ajv = { getSchema(ref: string): Validate | undefined };

let ajv: Ajv | null = null;
async function load(): Promise<Ajv> {
  if (ajv) return ajv;
  const { schemaAjv } = (await import(pathToFileURL(ROOTS).href)) as { schemaAjv(): Ajv };
  return (ajv = schemaAjv());
}

/** A validator for `<schema>#/$defs/<def>` (schema without `.schema.json`): null when the payload conforms, else why. */
export async function wire(schema: string, def: string): Promise<(doc: unknown) => string | null> {
  const v = (await load()).getSchema(`${schema}.schema.json#/$defs/${def}`);
  if (!v) throw new Error(`no $def ${def} in ${schema}`);
  return (doc) => (v(JSON.parse(JSON.stringify(doc))) ? null : (v.errors ?? []).slice(0, 3).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; '));
}
