// The live products this blueprint can open: `bp.products.local.json` at the repo root (gitignored;
// bp.products.example.json shows the shape). A missing or unreadable file means no live products; Kettle
// is built in and never listed. Server-only: route handlers import this, client components never do.
import fs from 'node:fs';
import path from 'node:path';
import type { ProductEntry } from './types';

if (typeof window !== 'undefined') throw new Error('products.server.ts is server-only');

export const PRODUCTS_FILE = 'bp.products.local.json';

/** Each lens-scan product keeps its store and its structure here, under its repo root. */
export const storeDir = (p: ProductEntry): string => path.join(p.root, '.ai', 'lens-scan');
export const storeFile = (p: ProductEntry): string => path.join(storeDir(p), 'scan.db');

/** Read on every call (the file is tiny and edited by hand or by scripts/scan-demo.mjs while the server runs). */
export function listProducts(): ProductEntry[] {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), PRODUCTS_FILE), 'utf8')); } catch { return []; }
  const xs = (raw as { products?: unknown })?.products;
  if (!Array.isArray(xs)) return [];
  const out: ProductEntry[] = [], seen = new Set<string>();
  for (const x of xs as Record<string, unknown>[]) {
    if (!x || typeof x.slug !== 'string' || typeof x.root !== 'string' || !x.slug || seen.has(x.slug)) continue;
    seen.add(x.slug);
    out.push({ slug: x.slug, name: typeof x.name === 'string' && x.name ? x.name : x.slug, root: path.resolve(x.root) });
  }
  return out;
}

export function findProduct(slug: string): ProductEntry | null {
  return listProducts().find((p) => p.slug === slug) ?? null;
}

export const hasStore = (p: ProductEntry): boolean => fs.existsSync(storeFile(p));
