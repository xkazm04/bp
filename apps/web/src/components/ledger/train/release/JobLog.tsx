// The Release tab's job log: the open release's jobs, oldest first, each the activity of its store run (the run whose
// note is `bp-job:<job id>`, as the Agents panel finds a job's run), else the job's own log tail (a finish writes no run).
// Monospace on the terminal surface, newest at the bottom; it follows the end only while the reader is at the bottom.
// Lines are memoised and keyed by activity id, so a new line appends and nothing is rebuilt.
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { ActivityKind } from '@/lib/scan/types';
import { isJobNote, jobLabel, type ScanJob } from '@/lib/scan/jobs';
import { useFindings } from '../../useLedger';

interface Line { key: string; at?: string; text: string; tone: string }

const TONE: Readonly<Record<ActivityKind, string>> = { reading: '', measured: 'ok', proposed: '', executing: '', committed: 'ok', note: '', error: 'err' };

const LogLine = memo(function LogLine({ at, text, tone }: Omit<Line, 'key'>) {
  return <div className={tone || undefined}>{at ? <i>{at.slice(11, 19)}</i> : null}{text}</div>;
});

export function JobLog({ jobs, version, n }: { jobs: readonly ScanJob[]; version?: string; n: number }) {
  const scan = useFindings().scan, runs = scan?.runs, activity = scan?.activity;
  const lines = useMemo(() => {
    const out: Line[] = [];
    for (const j of jobs) {
      out.push({ key: 'h:' + j.id, at: j.queued_at, text: '— ' + jobLabel(j) + ' · ' + j.status, tone: 'idle' });
      const run = runs?.find((r) => (j.run_id ? r.id === j.run_id : isJobNote(r.note, j.id)));
      const acts = run ? (activity ?? []).filter((a) => a.run_id === run.id).sort((a, b) => a.id - b.id) : [];
      if (acts.length) for (const a of acts) out.push({ key: 'a:' + a.id, at: a.at, text: a.text, tone: TONE[a.kind] });
      else (j.log_tail ? j.log_tail.split('\n') : []).forEach((t, i) => out.push({ key: 't:' + j.id + ':' + i, text: t, tone: '' }));
      if (j.error && !acts.some((a) => a.text === j.error)) out.push({ key: 'e:' + j.id, text: j.error, tone: 'err' });
    }
    return out;
  }, [jobs, runs, activity]);
  const box = useRef<HTMLDivElement>(null), atEnd = useRef(true);
  useLayoutEffect(() => { const el = box.current; if (el && atEnd.current) el.scrollTop = el.scrollHeight; }, [lines.length]);
  const onScroll = () => { const el = box.current; if (el) atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4; };
  return (
    <div ref={box} className="tr-rel-log" data-role="tr-rel-log" role="log" aria-live="polite" aria-label="Job log" tabIndex={0} onScroll={onScroll}>
      {lines.length ? lines.map((l) => <LogLine key={l.key} at={l.at} text={l.text} tone={l.tone} />) : (
        <div className="idle">No job yet. Build creates release/{version ?? '<version>'}, cherry-picks the {n} accepted commit{n === 1 ? '' : 's'}, runs the gates, writes the notes and opens a pull request. A conflicting item goes back to rework with its files as the note.</div>
      )}
    </div>
  );
}
