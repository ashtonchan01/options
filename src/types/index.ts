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
}

export interface RawTrade {
  tradeDate: string
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
  suggestedStrike?: number
  suggestedExpiry?: string
  suggestedDelta?: number
  estimatedCredit?: number
}

// ─── Scanner Result ───────────────────────────────────────────────────────────

export type ScanFlag = 'HIGH_VOL' | 'HIGH_V_OI' | 'IV_SPIKE' | 'NEAR_TERM'

export interface ScanResult {
  underlying: string
  strategyType: Extract<StrategyType, 'csp' | 'covered_call'>
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
  annualizedYield: number   // mid / strike * (365/dte)
  score: number             // composite rank 0-100
  flags: ScanFlag[]
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
  netLiquidation?: number  // direct from IBKR EquitySummary
}

// ─── App State ────────────────────────────────────────────────────────────────

export interface AppState {
  sync: SyncState
  strategies: Strategy[]
  quotes: Record<string, Quote>
  actions: Action[]
  scanResults: ScanResult[]
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  date: string         // YYYY-MM-DD
  type: 'expiry' | 'earnings' | 'dividend'
  underlying: string
  label: string
  strategyIds?: string[]
}
