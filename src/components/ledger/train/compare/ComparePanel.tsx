// The compare panel (WP4b implements): one pack item's evidence beside the table. The metric strip (before -> after,
// unit, verdict), the screens (light / dark / both x side by side / slider / blink / change map), the perf table for a
// performance item, the measurement texts, the commit and its diff, and the decision strip (Decide, compact).
import type { CompareView } from '../../useLedger';

export interface ComparePanelProps {
  /** The pack item shown. */
  id: string;
  view: CompareView;
  wide: boolean;
  /** The phone shows the panel as a full-screen sheet. */
  phone: boolean;
  onView(v: CompareView): void;
  onWide(): void;
  onClose(): void;
}

export function ComparePanel(props: ComparePanelProps) {
  void props;
  return null;
}
