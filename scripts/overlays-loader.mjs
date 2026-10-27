// Shim for the checks that register this path (scripts/check-overlays.ts and its siblings): the loader itself is
// scripts/lib/src-hooks.mjs in transpile mode. This file keeps the path and the initialize data contract
// { src, root, mutate } so no call site changes; it must not grow a resolve() or load() of its own
// (check-loader-json.mjs pins that).
import { initialize as init } from './lib/src-hooks.mjs';

export function initialize(data) { init({ root: data.root, src: data.src, mutate: data.mutate || [], transpile: true }); }
export { resolve, load } from './lib/src-hooks.mjs';
