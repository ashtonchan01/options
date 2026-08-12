/**
 * Target $1M portfolio definition for the Portfolio Allocation page.
 * Bucket percentages and lot-sizing rules come directly from the user's
 * own stated targets (not derived/guessed):
 *   - Cash/STRC: 5%
 *   - TSLA + SPCX combined: 50% (20/20 base, +10% swing to whichever looks
 *     the better value buy right now — see valueSwing() in the view)
 *   - Crypto (MSTR/IBIT/BSOL): 20% (10/5/5)
 *   - Everything else: 25%, split evenly across the 11 tickers
 * Every ticker rounds to a whole lot (100 shares; 10 for MU/ASML since
 * they're expensive enough that 100 shares would badly overshoot).
 */

export const TARGET_PORTFOLIO_VALUE = 1_000_000
export const CASH_PCT = 5

export type Category = 'core' | 'crypto' | 'rest'

export interface TargetTicker {
  symbol: string
  category: Category
  basePct: number
  lotSize: number
}

export const REST_TICKERS = ['ALAB', 'AMD', 'ARM', 'ASML', 'AVGO', 'GOOG', 'MRVL', 'MU', 'NVDA', 'PLTR', 'TSM'] as const
const REST_PCT_EACH = 25 / REST_TICKERS.length
const BIG_TICKET_LOT: Record<string, number> = { MU: 10, ASML: 10 }

export const TARGETS: TargetTicker[] = [
  { symbol: 'TSLA', category: 'core',   basePct: 20, lotSize: 100 },
  { symbol: 'SPCX', category: 'core',   basePct: 20, lotSize: 100 },
  { symbol: 'MSTR', category: 'crypto', basePct: 10, lotSize: 100 },
  { symbol: 'IBIT', category: 'crypto', basePct: 5,  lotSize: 100 },
  { symbol: 'BSOL', category: 'crypto', basePct: 5,  lotSize: 100 },
  ...REST_TICKERS.map(symbol => ({
    symbol, category: 'rest' as const, basePct: REST_PCT_EACH, lotSize: BIG_TICKET_LOT[symbol] ?? 100,
  })),
]

/** SpaceX is a private company with no exchange listing — there's no live
 * quote to fetch, so its price is a manually-tracked estimate (matching the
 * user's own valuation tracking) rather than pulled from a market feed. */
export const SPCX_STATIC_PRICE = 155

export const CATEGORY_COLOR: Record<Category | 'cash', string> = {
  cash:   '#64748b',
  core:   '#f43f5e',
  crypto: '#f59e0b',
  rest:   '#3b82f6',
}
