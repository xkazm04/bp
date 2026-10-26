// Where the companion keeps its state: $BP_HOME/companion (default <repo>/.bp, git-ignored). The brain, conversations,
// the leg ledger, cards, policies and the generated --mcp-config all live under it. Tests point BP_HOME at a temp dir.
import path from 'node:path';

if (typeof window !== 'undefined') throw new Error('home.server.ts is server-only');

/** The bp repo root: the server's working directory, as products.server.ts reads bp.products.local.json from it. */
export const repoRoot = (): string => process.cwd();

export function companionHome(): string {
  return path.join(process.env.BP_HOME ? path.resolve(process.env.BP_HOME) : path.join(repoRoot(), '.bp'), 'companion');
}
