// Running scans on the plan: a marching outline in the lens accent around each job's scope, a label
// chip, a sweep on the feature being judged and a tick on the done ones (spark scan-package WP3).
import type { JobStatus } from '@/lib/scan/jobs';

export interface ScanView {
  id: string;
  lens: string;
  /** The lens accent for the current theme (manifest presentation.accent), else ink. */
  accent: string;
  /** The place the scope names; null = a feature list (outline its bounding box) or everything. */
  place: { t: 'bld' | 'wing' | 'room' | 'bay' | 'tile'; id: string } | null;
  features: string[];
  done: ReadonlySet<string>;
  current?: string;
  n: number;
  m: number;
  status: JobStatus;
}
