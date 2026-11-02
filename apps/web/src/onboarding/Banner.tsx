'use client';
// The blueprint's note that the open product is still being onboarded: "Onboarding in progress · Watch" goes to the
// onboarding screen. Asked once when the product opens, then every 20 s while the adopt job runs; gone once it ends.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchOnboarding, isRunning, onboardingHref, type AdoptJob } from './api';
import styles from './banner.module.css';

export function OnboardingBanner({ slug }: { slug: string }) {
  const [job, setJob] = useState<AdoptJob | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => fetchOnboarding(slug, ac.signal).then((j) => {
      if (ac.signal.aborted) return;
      setJob(j);
      if (isRunning(j)) timer = setTimeout(ask, 20000);
    }, () => { /* no onboarding route or no server: no banner */ });
    void ask();
    return () => { ac.abort(); clearTimeout(timer); setJob(null); };
  }, [slug]);
  if (!job || !isRunning(job)) return null;
  return (
    <div className={styles.banner} role="status">
      <span className={styles.dot} aria-hidden />
      <span>Onboarding in progress</span>
      <Link href={onboardingHref(slug, job.id)} className={styles.watch}>Watch</Link>
    </div>
  );
}
