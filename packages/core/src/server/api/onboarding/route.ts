// GET /api/onboarding: `{ items: [{ slug, name, job }] }`, every registered product (Kettle is built in and not listed)
// with its latest adopt job (ScanJob, live or read back from the job journal; null = never onboarded through the app),
// running or queued ones first, then by the most recent start (onboarding.server.ts onboardingList). The VR wrist's
// Projects tab polls it. A registry file that cannot be parsed answers as GET /api/products does (409 with the reason, 500
// when unreadable). Localhost only (403 `{ error }`).
import { localHost } from '@bp/core/scan/local-only';
import { onboardingList } from '@bp/core/server/onboarding.server';
import { jobFor } from '@bp/core/server/device-view.server';

export function GET(req: Request): Response {
  const bad = localHost(req);
  if (bad) return Response.json({ error: bad }, { status: 403 });
  const { items, problem } = onboardingList();
  if (problem) return Response.json({ error: problem.error }, { status: problem.status });
  // a paired headset reads each job without its log tail and with its error in fixed words (S4)
  return Response.json({ items: items.map((it) => ({ ...it, job: jobFor(req, it.job) })) });
}
