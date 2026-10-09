#!/bin/sh
# Build into .next-subtle (retrying while another author's files break the shared tree), then serve on 3111.
cd "$(dirname "$0")/../../../.." || exit 1
LOG=${TMPDIR:-/tmp}/subtle-build.log
npx tsc --noEmit --incremental false || exit 1
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if NEXT_DIST_DIR=.next-subtle npx next build > "$LOG" 2>&1; then echo "BUILD OK (try $i)"; exit 0; fi
  grep -m3 -E "Error|error" "$LOG"; sleep 30
done
echo "BUILD FAILED"; exit 1
