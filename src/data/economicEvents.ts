/**
 * Market-moving macro/economic events — FOMC rate decision days.
 * Dates come from the Federal Reserve's published meeting calendar
 * (https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm).
 * The decision/statement day is the second day of each two-day meeting.
 *
 * Fed publishes its schedule roughly a year or more in advance, so these
 * are hardcoded (like market holidays) rather than fetched. Update yearly
 * as the Fed publishes new calendars.
 */

export interface EconEvent {
  label: string
  kind: 'fomc'
}

const FOMC_DECISION_DATES: string[] = [
  // 2024
  '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12',
  '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
  // 2025
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
  '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  // 2026 (per Fed's published tentative schedule)
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
]

export const ECON_EVENT_MAP: Record<string, EconEvent[]> = Object.fromEntries(
  FOMC_DECISION_DATES.map(d => [d, [{ label: 'FOMC', kind: 'fomc' }]]),
)
