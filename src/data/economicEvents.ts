/**
 * Market-moving macro/economic events — currently just FOMC rate-decision
 * days. Live dates are fetched from the Fed's published calendar via
 * src/services/fomc.ts (re-checked weekly); this file only holds a small
 * offline fallback used if that live fetch fails, plus the helper to turn
 * a flat date list into the per-day map the calendar renders.
 */

export interface EconEvent {
  label: string
  kind: 'fomc'
}

/** Offline fallback only — used if the live federalreserve.gov fetch fails. */
export const FOMC_FALLBACK_DATES: string[] = [
  '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12',
  '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
  '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
]

export function buildEconEventMap(fomcDates: string[]): Record<string, EconEvent[]> {
  const map: Record<string, EconEvent[]> = {}
  for (const d of fomcDates) map[d] = [{ label: 'FOMC', kind: 'fomc' }]
  return map
}
