/**
 * Market-moving macro/economic events — FOMC rate-decision days, plus the
 * Kansas City Fed's annual Jackson Hole Economic Symposium (the Fed Chair's
 * keynote there has moved markets nearly every year — Powell's 2022 "pain"
 * speech alone triggered a same-day S&P selloff). Live FOMC dates are
 * fetched from the Fed's published calendar via src/services/fomc.ts
 * (re-checked weekly); this file holds the offline FOMC fallback used if
 * that live fetch fails, the Jackson Hole dates (no live source — the KC
 * Fed doesn't publish a machine-readable calendar for it, so these are
 * hardcoded same as the FOMC fallback), and the helper that turns both
 * flat date lists into the per-day map the calendar renders.
 */

export interface EconEvent {
  label: string
  kind: 'fomc' | 'jackson_hole'
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

/** The KC Fed's Jackson Hole Economic Symposium runs Thursday–Saturday, so
 * all three days are marked (not just the Friday keynote) — attendees
 * arrive Thursday and market-moving remarks (not only the Chair's, whose
 * keynote is usually Friday) can come from any session across the retreat.
 * 2026 dates are the Fed's usual pattern (Thu-Sat in the last full week of
 * August) — confirm against the KC Fed's release closer to the date since,
 * unlike FOMC, no live calendar feed exists for this to auto-correct from. */
export const JACKSON_HOLE_DATES: string[] = [
  '2024-08-22', '2024-08-23', '2024-08-24',
  '2025-08-21', '2025-08-22', '2025-08-23',
  '2026-08-27', '2026-08-28', '2026-08-29',
]

export function buildEconEventMap(fomcDates: string[], jacksonHoleDates: string[] = JACKSON_HOLE_DATES): Record<string, EconEvent[]> {
  const map: Record<string, EconEvent[]> = {}
  for (const d of fomcDates) map[d] = [...(map[d] ?? []), { label: 'FOMC', kind: 'fomc' }]
  for (const d of jacksonHoleDates) map[d] = [...(map[d] ?? []), { label: 'Jackson Hole', kind: 'jackson_hole' }]
  return map
}
