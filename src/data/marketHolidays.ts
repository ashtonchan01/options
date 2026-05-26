/**
 * CBOE / US equity market holidays.
 * Markets are CLOSED on these dates (no trading).
 *
 * Source: https://www.cboe.com/about/hours/us-equities/
 * Update annually — dates through 2027 are included.
 */

export interface MarketHoliday {
  date: string // YYYY-MM-DD
  name: string
}

export const CBOE_HOLIDAYS: MarketHoliday[] = [
  // ─── 2025 ──────────────────────────────────────────────────
  { date: '2025-01-01', name: "New Year's Day" },
  { date: '2025-01-20', name: 'MLK Jr. Day' },
  { date: '2025-02-17', name: "Presidents' Day" },
  { date: '2025-04-18', name: 'Good Friday' },
  { date: '2025-05-26', name: 'Memorial Day' },
  { date: '2025-06-19', name: 'Juneteenth' },
  { date: '2025-07-04', name: 'Independence Day' },
  { date: '2025-09-01', name: 'Labor Day' },
  { date: '2025-11-27', name: 'Thanksgiving' },
  { date: '2025-12-25', name: 'Christmas Day' },

  // ─── 2026 ──────────────────────────────────────────────────
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-19', name: 'MLK Jr. Day' },
  { date: '2026-02-16', name: "Presidents' Day" },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-05-25', name: 'Memorial Day' },
  { date: '2026-06-19', name: 'Juneteenth' },
  { date: '2026-07-03', name: 'Independence Day (observed)' },
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-11-26', name: 'Thanksgiving' },
  { date: '2026-12-25', name: 'Christmas Day' },

  // ─── 2027 ──────────────────────────────────────────────────
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-01-18', name: 'MLK Jr. Day' },
  { date: '2027-02-15', name: "Presidents' Day" },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-05-31', name: 'Memorial Day' },
  { date: '2027-06-18', name: 'Juneteenth (observed)' },
  { date: '2027-07-05', name: 'Independence Day (observed)' },
  { date: '2027-09-06', name: 'Labor Day' },
  { date: '2027-11-25', name: 'Thanksgiving' },
  { date: '2027-12-24', name: 'Christmas Day (observed)' },
]

/** Quick lookup: date string → holiday name or undefined */
export const HOLIDAY_MAP: Record<string, string> = Object.fromEntries(
  CBOE_HOLIDAYS.map(h => [h.date, h.name])
)
