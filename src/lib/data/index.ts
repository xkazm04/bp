import kettleJson from '@/data/kettle.json';
import swarmJson from '@/data/swarm.json';
import type { Kettle, Swarm } from './types';

export * from './types';

/** The product: 13 domains, 29 capabilities, 132 features. Sample data. */
export const KETTLE = kettleJson as unknown as Kettle;
/** The simulated swarm over KETTLE: 42 agents, 28 decisions, 8 orders, one replayable hour. */
export const SWARM = swarmJson as unknown as Swarm;
