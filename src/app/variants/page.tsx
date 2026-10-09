import Link from 'next/link';
import { SWARM, loadProduct } from '@/lib/data';
import { VARIANTS } from '@/variants/registry';
import { ThemeToggle } from '@/components/ThemeToggle';
import styles from './index.module.css';

// The index: one card per variant. Each card opens /v/<id>; the scale and theme links are shortcuts.
export default function Home() {
  const K = loadProduct();
  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <div>
          <div className={styles.kicker}>Project Kettle · drawing set · three lens expressions</div>
          <h1 className={styles.h1}>Kettle blueprint</h1>
          <p className={styles.lead}>
            {K.features.length} features drawn as a building, read through {K.lenses.length} lenses, with a simulated swarm of {SWARM.agents.length} agents at work. The
            plan, the stage colours and the General sheet are shared; each variant only changes how a lens speaks.
          </p>
        </div>
        <ThemeToggle />
      </header>
      <ol className={styles.cards}>
        {VARIANTS.map((v, i) => (
          <li key={v.id} className={styles.card}>
            <Link href={'/v/' + v.id} className={styles.link}>
              <span className={styles.no}>{'V-' + String(i + 1).padStart(2, '0')}</span>
              <span className={styles.name}>{v.name}</span>
              <span className={styles.desc}>{v.description}</span>
              <span className={styles.open}>Open the drawing ›</span>
            </Link>
            <span className={styles.alts}>
              <Link href={'/v/' + v.id + '?scale=4'}>×4 campus</Link>
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.foot}>Sample data · the swarm is a simulation · keyboard: / find, 1–9 lenses, + − zoom, arrows walk rooms, Enter opens, Esc goes back.</p>
    </main>
  );
}
