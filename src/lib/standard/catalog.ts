// The built-in lens catalog: the six manifests that ship with the standard. A project's map holds its
// own copy of each manifest it uses (catalog plus snapshot), so this is where copies come from, not
// what the blueprint draws from. The JSON files are the source; docs/standard/schema validates them.
// The JSON imports carry `with { type: 'json' }` so Node (type stripping) can load this module as the
// bundler does, and a script reads the catalog from here instead of re-listing the six files.
import business from '../../../docs/standard/lenses/business.json' with { type: 'json' };
import design from '../../../docs/standard/lenses/design.json' with { type: 'json' };
import development from '../../../docs/standard/lenses/development.json' with { type: 'json' };
import operations from '../../../docs/standard/lenses/operations.json' with { type: 'json' };
import security from '../../../docs/standard/lenses/security.json' with { type: 'json' };
import quality from '../../../docs/standard/lenses/quality.json' with { type: 'json' };
import type { LensManifest } from './types';

// JSON imports widen literals (a density reads as string), so they are cast once here; the schema
// check (npm run validate:structure) is what guarantees the shape.
export const BUILTIN_LENSES: readonly LensManifest[] = [business, design, development, operations, security, quality] as unknown as LensManifest[];
