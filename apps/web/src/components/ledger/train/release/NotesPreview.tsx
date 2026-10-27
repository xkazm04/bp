// The Release tab's notes, in a collapsible: before the build, a preview generated from the package (the sections the
// release run writes: per item its title, lens, feature, before -> after with unit, a flagged item's triage note and
// its commit and pack; then the items a conflict sent back to rework, and the gates); after the build, the release's own
// notes. Both come from one writer (@bp/core/train/notes releaseNotes), so the swap keeps the item lines.
import { useMemo } from 'react';
import { useProductName } from '@/lib/scan/projects';
import { conflictsOf, notesPreview, type ReleaseModel } from './releaseState';

/** `version`: the release's, else the suggested one. */
export function NotesPreview({ m, version }: { m: ReleaseModel; version?: string }) {
  const name = useProductName(m.T.slug, m.T.slug ? m.T.slug : 'Kettle');
  const own = m.rel?.notes;
  const text = useMemo(() => own ?? notesPreview(name, version ?? 'next', m.items, conflictsOf(m)), [own, name, version, m]);
  return (
    <details className="tr-rel-notes" data-role="tr-rel-notes" open>
      <summary>{own ? 'Release notes' : 'Release notes it will publish · preview'}</summary>
      <pre>{text}</pre>
    </details>
  );
}
