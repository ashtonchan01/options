/** Splits an array into fixed-size chunks — shared by any client service
 * that talks to a /api/* endpoint with a per-request symbol cap. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
