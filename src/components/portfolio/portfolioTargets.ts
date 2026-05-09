export interface TickerTarget {
  ticker: string
  ath: number
  priceTarget2026: number
  cagr: number               // decimal, e.g. 0.38 = 38%
  atr1: number
  atr2: number
  targetShares: number        // end-goal portfolio
  targetReqShares: number     // $1M portfolio
  category: 'stock' | 'crypto' | 'cash'
}

export const PORTFOLIO_TARGETS: TickerTarget[] = [
  { ticker: 'ALAB',  ath: 245.20,     priceTarget2026: 197.34,    cagr: 0.38,   atr1: 143,      atr2: 100,      targetShares: 500,    targetReqShares: 100,  category: 'stock' },
  { ticker: 'AMD',   ath: 421.47,     priceTarget2026: 230.24,    cagr: 0.1231, atr1: 205,      atr2: 168,      targetShares: 500,    targetReqShares: 100,  category: 'stock' },
  { ticker: 'ARM',   ath: 237.30,     priceTarget2026: 114.00,    cagr: 0.14,   atr1: 100,      atr2: 80,       targetShares: 500,    targetReqShares: 100,  category: 'stock' },
  { ticker: 'ASML',  ath: 1544.74,    priceTarget2026: 1218.49,   cagr: 0.1946, atr1: 1020,     atr2: 950,      targetShares: 100,    targetReqShares: 10,   category: 'stock' },
  { ticker: 'AVGO',  ath: 425.44,     priceTarget2026: 376.80,    cagr: 0.256,  atr1: 300,      atr2: 260,      targetShares: 500,    targetReqShares: 100,  category: 'stock' },
  { ticker: 'GOOG',  ath: 395.07,     priceTarget2026: 369.68,    cagr: 0.1925, atr1: 310,      atr2: 297,      targetShares: 500,    targetReqShares: 100,  category: 'stock' },
  { ticker: 'MRVL',  ath: 172.15,     priceTarget2026: 88.46,     cagr: 0.164,  atr1: 76,       atr2: 66,       targetShares: 500,    targetReqShares: 100,  category: 'stock' },
  { ticker: 'MU',    ath: 666.80,     priceTarget2026: 321.37,    cagr: 0.1276, atr1: 285,      atr2: 240,      targetShares: 500,    targetReqShares: 100,  category: 'stock' },
  { ticker: 'NVDA',  ath: 207.67,     priceTarget2026: 246.09,    cagr: 0.4062, atr1: 175,      atr2: 130,      targetShares: 2000,   targetReqShares: 300,  category: 'stock' },
  { ticker: 'PLTR',  ath: 207.18,     priceTarget2026: 181.48,    cagr: 0.3247, atr1: 137,      atr2: 110,      targetShares: 500,    targetReqShares: 100,  category: 'stock' },
  { ticker: 'TSLA',  ath: 489.88,     priceTarget2026: 564.41,    cagr: 0.4853, atr1: 380,      atr2: 330,      targetShares: 10000,  targetReqShares: 1200, category: 'stock' },
  { ticker: 'TSM',   ath: 419.50,     priceTarget2026: 348.54,    cagr: 0.1618, atr1: 300,      atr2: 277,      targetShares: 500,    targetReqShares: 100,  category: 'stock' },
  { ticker: 'BTC',   ath: 124310.60,  priceTarget2026: 139300.00, cagr: 0.99,   atr1: 70000,    atr2: 60000,    targetShares: 10,     targetReqShares: 1.2,  category: 'crypto' },
  { ticker: 'MSTR',  ath: 455.90,     priceTarget2026: 151.17,    cagr: 0.0078, atr1: 150,      atr2: 120,      targetShares: 5000,   targetReqShares: 500,  category: 'crypto' },
  { ticker: 'SOL',   ath: 256.70,     priceTarget2026: 108.02,    cagr: -0.0998,atr1: 120,      atr2: 100,      targetShares: 4000,   targetReqShares: 500,  category: 'crypto' },
]

export const CASH_TARGET = 400_000
export const CASH_TARGET_1M = 50_000

export const ALLOCATION_TARGETS = [
  { label: 'TSLA', pct: 45, color: '#f43f5e' },
  { label: 'CRYPTO', pct: 25, color: '#f59e0b' },
  { label: 'IA13/OPTIONS', pct: 25, color: '#6366F1' },
  { label: 'CASH', pct: 5, color: '#10b981' },
]

export const PRE_IPO_WATCHLIST = ['SpaceX', 'xAI', 'Anduril']
