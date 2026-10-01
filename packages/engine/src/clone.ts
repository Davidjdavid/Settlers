/** Deep copy of plain JSON data (objects, arrays, primitives). Much faster than structuredClone. */
export function cloneJson<T>(x: T): T {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(cloneJson) as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(x)) out[k] = cloneJson((x as Record<string, unknown>)[k]);
  return out as T;
}
