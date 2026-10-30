// The contract schemas as validators, for the checks that hold real payloads to them: every schema in
// packages/schema/schema is loaded into one ajv (draft 2020-12, strict, as check:schema compiles them), so a cross-file
// $ref (morning-deck-1 -> decision-brief-1, shared-focus-1) resolves. `wire('shared-focus-1', 'sharedView')` validates
// one $def; the answer is null when the payload conforms, else the first errors in one line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../packages/schema/schema');
type Validate = ((doc: unknown) => boolean) & { errors?: { instancePath?: string; message?: string }[] | null };
type Ajv = { addSchema(s: unknown, key: string): void; getSchema(ref: string): Validate | undefined };

let ajv: Ajv | null = null;
async function load(): Promise<Ajv> {
  if (ajv) return ajv;
  const mod = (await import('ajv/dist/2020.js')) as unknown as { default?: { default?: unknown } | unknown };
  const Ctor = ((mod.default as { default?: unknown })?.default ?? mod.default ?? mod) as new (o: object) => Ajv;
  const a = new Ctor({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.schema.json'))) a.addSchema(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')), f);
  return (ajv = a);
}

/** A validator for `<schema>#/$defs/<def>` (schema without `.schema.json`): null when the payload conforms, else why. */
export async function wire(schema: string, def: string): Promise<(doc: unknown) => string | null> {
  const v = (await load()).getSchema(`${schema}.schema.json#/$defs/${def}`);
  if (!v) throw new Error(`no $def ${def} in ${schema}`);
  return (doc) => (v(JSON.parse(JSON.stringify(doc))) ? null : (v.errors ?? []).slice(0, 3).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; '));
}
