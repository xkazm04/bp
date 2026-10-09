// The built-in lens catalog: the six manifests that ship with the standard. A project's map holds its
// own copy of each manifest it uses (catalog plus snapshot), so this is where copies come from, not
// what the blueprint draws from. The JSON files are the source; docs/standard/schema validates them.
import business from '../../../docs/standard/lenses/business.json';
import design from '../../../docs/standard/lenses/design.json';
import development from '../../../docs/standard/lenses/development.json';
import operations from '../../../docs/standard/lenses/operations.json';
import security from '../../../docs/standard/lenses/security.json';
import quality from '../../../docs/standard/lenses/quality.json';
import type { LensManifest } from './types';

// JSON imports widen literals (a density reads as string), so they are cast once here; the schema
// check (npm run validate:structure) is what guarantees the shape.
export const BUILTIN_LENSES: readonly LensManifest[] = [business, design, development, operations, security, quality] as unknown as LensManifest[];
