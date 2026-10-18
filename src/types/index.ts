// ─── IBKR Position (parsed from Flex XML or API) ────────────────────────────

export type AssetClass = 'STK' | 'OPT' | 'CASH'
export type PutCall = 'P' | 'C'
export type BuySell = 'BUY' | 'SELL'
export type OpenClose = 'O' | 'C'

export interface RawPosition {
  accountId: string
  symbol: string
  description: string
  assetClass: AssetClass
  quantity: number
  costBasisPrice: number
  costBasisMoney: number
  markPrice: number
  positionValue: number
  unrealizedPnL: number
  // Options-specific
  putCall?: PutCall
  strike?: number
  expiry?: string    // YYYYMMDD compact
  multiplier?: number
  underlyingSymbol?: string
  currency: string
  // IBKR Flex "Open Positions" level of detail, when the report includes it
  // ("SUMMARY" vs per-lot "LOT") — used only to dedupe a report that has
  // both checked, so a multi-lot position doesn't get counted twice.
  levelOfDetail?: string
  /** YYYYMMDD the lot was opened. Present on LOT rows; copied onto `openLots`. */
  openDate?: string
  /**
   * Per-lot breakdown from the Flex Open Positions section, when the query
   * included Lot detail. The position's own quantity and cost stay the
   * summary (so portfolio totals are not double-counted). Share accounting
   * uses these lots as the open cost basis instead of reconstructing one.
   */
  openLots?: OpenLot[]
}

/** One tax lot still open at IBKR. Cost is whatever lot method the account uses. */
export interface OpenLot {
  quantity: number
  costBasisPrice: number
  costBasisMoney: number
  /** YYYYMMDD, when the Flex lot row included an open date. */
  openDate?: string
  unrealizedPnL?: number
}

/**
 * One opening lot a closing Flex trade actually consumed. IBKR reports
 * these as Trade rows with levelOfDetail CLOSED_LOT (and, on some
 * templates, as ClosedLot elements). `cost` is the signed basis removed
 * — negative when a long lot is sold — and `fifoPnlRealized` is IBKR's
 * realized P&L for that lot under the account's lot method. The attribute
 * is named "fifo" even when the account is set to Highest Cost, LIFO, or
 * specific lot.
 */
export interface ClosedLot {
  quantity: number
  tradeDate: string
  tradePrice: number
  proceeds: number
  commissions: number
  cost: number
  fifoPnlRealized?: number
  /** YYYYMMDD the consumed lot was opened. */
  origTradeDate?: string
  /** Per-share cost of the consumed lot. */
  origTradePrice?: number
  origTradeId?: string
}

export interface RawTrade {
  /** IBKR Flex accountId this trade belongs to. A Flex Query token
   * provisioned across multiple linked accounts (common for a family/
   * advisor structure) reports every one of those accounts' activity in the
   * same XML — used to filter down to just the single account this app
   * "Account" entry is meant to represent, instead of silently merging in
   * another account's trades (verified: a closed BPS/put_spread trade from
   * an unrelated linked account showed up in the Journal even though it was
   * never part of the account the user actually synced). */
  accountId?: string
  tradeDate: string
  /** IBKR's own execution time ("HHMMSS"), when the report includes it. Two
   * unrelated spreads opened minutes apart on the same day share a tradeDate
   * but not a tradeTime — used to keep the position matcher from lumping them
   * into one group just because the date matches. */
  tradeTime?: string
  symbol: string
  underlyingSymbol?: string
  assetClass: AssetClass
  putCall?: PutCall
  strike?: number
  expiry?: string
  quantity: number
  tradePrice: number
  proceeds: number
  commissions: number
  netCash: number
  openClose?: OpenClose
  /** True for ACATS/internal position-transfer records (not real trading activity) — used to exclude them from daily activity aggregations while still feeding share-count reconstruction. */
  isTransfer?: boolean
  /** IBKR's own unique execution ID (Flex XML `tradeID`), when available. Used
   * to tell apart genuinely distinct executions that share the same date/
   * symbol/quantity/price — the composite `tradeId()` key alone collapses
   * those into one, silently undercounting a multi-lot order that filled at
   * a single uniform price (verified: a real 3-lot CSP sell, each execution
   * -1 @ the same price, merged down to 2 distinct rows). */
  execId?: string
  /** IBKR's own order ID (Flex XML `ibOrderID`), when available. Legs of one
   * multi-leg combo order (e.g. a bull put spread) always share this value —
   * unlike tradeTime, which is only second-granularity and can coincidentally
   * collide between two genuinely unrelated single-leg orders placed at the
   * same second (verified against a real account: an unrelated 7500C buy and
   * a 7525P sell, placed as two separate orders, landed on the identical
   * tradeTime and got merged into one fake mixed put/call "spread"). Used to
   * group trades into their real order instead of just date+time. */
  orderId?: string
  /**
   * Signed cost basis IBKR attached to this fill (`cost` on the Flex Trade).
   * On a closing stock sale this is the basis removed, using the account's
   * lot method — negative for a long close. Absent on statements that
   * didn't include the column, and on trades synced before the parser
   * stored it (the next Flex sync rewrites the report window and fills it in).
   */
  cost?: number
  /**
   * Realized P&L IBKR computed for this fill (`fifoPnlRealized`). Despite
   * the name, the figure follows the account's Tax Optimizer lot method
   * (FIFO, LIFO, Highest Cost, specific lot, …), not a FIFO assumption.
   * Present only when the Flex row included the attribute.
   */
  fifoPnlRealized?: number
  /** Flex Trade levelOfDetail (EXECUTION, ORDER, …). Closed-lot rows are not stored as their own trades. */
  levelOfDetail?: string
  /**
   * Opening lots this closing fill consumed, when the Flex query included
   * Closed Lots. Empty / absent when the query has executions only — the
   * journal then falls back to `cost` and `fifoPnlRealized` on this fill.
   */
  closedLots?: ClosedLot[]
  /**
   * Stock delivered by option assignment or exercise (activity-statement
   * code A or Ex, a Flex trade note of the same, or an OptionEAE stock
   * leg). The shares left the account. IBKR's basis on that fill includes
   * the option premium, so it does not have to match a lot in this trade
   * list. An ordinary sale is not marked, and its lots stay put until one
   * of them costs what IBKR reported.
   */
  isAssignment?: boolean
}

// ─── Classified Strategy ─────────────────────────────────────────────────────

export type StrategyType =
  | 'covered_call'
  | 'csp'
  | 'pmcc'
  | 'risk_reversal'
  | 'put_spread'
  | 'call_spread'
  | 'leap'
  | 'other'

export interface OptionLeg {
  symbol: string
  underlying: string
  putCall: PutCall
  strike: number
  expiry: string       // YYYYMMDD
  dte: number
  quantity: number     // negative = short
  markPrice: number
  delta?: number
  iv?: number
  theta?: number
  gamma?: number
  vega?: number
  costBasis: number
  unrealizedPnL: number
}

export interface StockPosition {
  symbol: string
  quantity: number
  avgCost: number
  markPrice: number
  unrealizedPnL: number
}

export interface Strategy {
  id: string
  type: StrategyType
  underlying: string
  legs: OptionLeg[]
  shares?: StockPosition
  netPremiumReceived: number   // positive = credit received
  maxProfit: number
  maxLoss: number
  unrealizedPnL: number
  openDate?: string
  note?: string
}

// ─── Quote / Greeks from Yahoo ───────────────────────────────────────────────

export interface Quote {
  symbol: string
  price: number
  change: number
  changePct: number
  iv?: number          // impliedVolatility from Yahoo option chain
  fetchedAt: number    // timestamp ms
}

export interface OptionGreeks {
  symbol: string       // OCC format
  delta: number
  gamma: number
  theta: number
  vega: number
  iv: number
  bid: number
  ask: number
  mid: number
  volume: number
  openInterest: number
}

// ─── Action / Recommendation ─────────────────────────────────────────────────

export type ActionType = 'close' | 'roll' | 'open' | 'manage'
export type UrgencyLevel = 'urgent' | 'manage' | 'opportunity' | 'watch'

export interface Action {
  id: string
  strategyType: StrategyType
  underlying: string
  urgency: UrgencyLevel
  actionType: ActionType
  reason: string
  details: string
  relatedStrategyId?: string
  /** Human-readable position identifier, e.g. "$340P 21Jun25 (14d)" */
  legSummary?: string
  suggestedStrike?: number
  suggestedExpiry?: string
  suggestedDelta?: number
  estimatedCredit?: number
}

// ─── Scanner Result ───────────────────────────────────────────────────────────

export type ScanFlag = 'HIGH_VOL' | 'HIGH_V_OI' | 'IV_SPIKE' | 'NEAR_TERM'

export interface ScanResult {
  underlying: string
  strategyType: Extract<StrategyType, 'csp' | 'covered_call' | 'leap'>
  stockPrice: number
  strike: number
  expiry: string
  dte: number
  delta: number
  gamma: number
  theta: number
  iv: number
  ivRank: number            // 0-100 percentile within chain
  bid: number
  ask: number
  mid: number
  volume: number
  openInterest: number
  volumeOiRatio: number     // volume / openInterest
  annualizedYield: number   // mid / strike * (365/dte) — for 'leap', this is
                            // the extrinsic cost annualized (a cost rate, not
                            // a yield): (extrinsic / stockPrice) * (365/dte)
  score: number             // composite rank 0-100
  flags: ScanFlag[]
  /** 'leap' only — mid minus intrinsic value, i.e. the time-value premium
   * actually being paid for (the deep-ITM debit's "wasted" portion). */
  extrinsic?: number
  /** 'leap' only — stockPrice / mid: how many dollars of stock exposure one
   * dollar spent on the call controls, vs buying shares outright. */
  leverage?: number
  /** Set on contracts past the standard LEAP window (see LEAP_MAX_DTE).
   * They exist only so the scanner's ANY 1Y+ choice can see expiries the
   * LAST / 2ND LAST / 3RD LAST / ALL 3 rankings do not use. */
  leapHorizon?: 'extended'
}

// ─── IBKR Sync State ─────────────────────────────────────────────────────────

export type SyncMode = 'xml' | 'flex_api'
export type SyncStatus = 'idle' | 'loading' | 'success' | 'error'

export interface SyncState {
  mode: SyncMode
  status: SyncStatus
  lastSync?: number    // timestamp ms
  error?: string
  positions: RawPosition[]
  trades: RawTrade[]
  cashBalance: number
  /** Per-currency breakdown of cashBalance (USD, AUD, etc.) — only an XML/
   * Flex sync provides this; undefined for a generic .csv/.xlsx/.pdf import. */
  cashBalances?: Record<string, number>
  netLiquidation?: number  // direct from IBKR EquitySummary
}

// ─── App State ────────────────────────────────────────────────────────────────

export interface AppState {
  sync: SyncState
  strategies: Strategy[]
  quotes: Record<string, Quote>
  actions: Action[]
  scanResults: ScanResult[]
  /** Live stock prices keyed by underlying symbol, refreshed every 60s */
  livePrices: Record<string, number>
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  date: string         // YYYY-MM-DD
  type: 'expiry' | 'earnings' | 'dividend'
  underlying: string
  label: string
  strategyIds?: string[]
}
