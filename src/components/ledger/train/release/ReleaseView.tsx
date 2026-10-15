// The ledger's Release tab (WP4c implements): the version (suggested, with its reason), the package of accepted items
// by lens (flagged ones with their notes), the stepper draft -> building -> pr-open -> merged -> tagged driven by the
// release row and its job from the stream, the job log, the notes the release will publish, the failure states, and
// the history of past releases. Build and Finish start the Claude Code job; on the phone the tab is read-only.

export interface ReleaseViewProps {
  phone: boolean;
}

export function ReleaseView(props: ReleaseViewProps) {
  void props;
  return null;
}

/** The header band's three counters: Changed (items built), Waiting for you (done + failed), Will ship (the draft). */
export function SummaryStrip() {
  return null;
}

/** The phone ledger's one read-only line about the open release ("Release v0.1.0 · building"), else nothing. */
export function ReleaseStatusLine() {
  return null;
}
