// The one object type guard. Pure: no React, DOM or Next, and types only besides the function, so Node can load it
// with type stripping. A plain object is non-null, typeof 'object' and not an Array.
export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
