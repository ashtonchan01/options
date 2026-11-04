/**
 * Share rows: Stock Price and Market Price are the same per-share price,
 * taken from the live quote rather than the older Flex mark. Option rows
 * keep the underlying in Stock Price and the contract premium in Market Price.
 * Run with: npm test
 */
import { journalMarks } from '../src/components/journal/shareMark'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// IBKR Business, 5 Nov 2026 ~7:16 Sydney. Stock Price was the live quote;
// Market Price was the Flex mark from the last sync.
const rows = [
  { ticker: 'UMAC', shares: 1000, live: 13.02, flexMark: 14.27, cost: 16805 },
  { ticker: 'SKHY', shares: 100, live: 142.04, flexMark: 147.71, cost: 14300 },
  { ticker: 'MSTR', shares: 200, live: 143.10, flexMark: 130.76, cost: 27340 },
]

for (const row of rows) {
  const marked = journalMarks({
    isShares: true,
    contracts: row.shares,
    underlyingPrice: row.live,
    ibkrMarketValue: row.shares * row.flexMark,
    units: row.shares,
  })
  check(`${row.ticker} stock price and market price are the live quote`, marked.stockPrice === row.live && marked.marketPrice === row.live)
  check(`${row.ticker} market value is shares × live quote`, marked.marketValue === row.shares * row.live, String(marked.marketValue))
  const unrealized = (marked.marketValue ?? 0) - row.cost
  check(`${row.ticker} unrealised follows the live mark, not the flex mark`, Math.abs(unrealized - (row.shares * row.live - row.cost)) < 1e-6)
}

const missed = journalMarks({
  isShares: true,
  contracts: 200,
  underlyingPrice: null,
  ibkrMarketValue: 200 * 130.76,
  units: 200,
})
check('missing live quote falls back to the flex mark in both columns', missed.stockPrice === 130.76 && missed.marketPrice === 130.76 && missed.marketValue === 200 * 130.76)

const spread = journalMarks({
  isShares: false,
  contracts: 4,
  underlyingPrice: 7696.42,
  ibkrMarketValue: -4200.34,
  units: 400,
})
check('option stock price stays the underlying', spread.stockPrice === 7696.42)
check('option market price stays the contract premium', spread.marketPrice != null && Math.abs(spread.marketPrice - 4200.34 / 400) < 1e-9, String(spread.marketPrice))
check('option market value stays the flex mark', spread.marketValue === -4200.34)

const shortShares = journalMarks({
  isShares: true,
  contracts: -100,
  underlyingPrice: 50,
  ibkrMarketValue: -100 * 48,
  units: -100,
})
check('short shares mark to the live quote with a negative value', shortShares.marketPrice === 50 && shortShares.marketValue === -5000 && shortShares.stockPrice === 50)

const shortFallback = journalMarks({
  isShares: true,
  contracts: -100,
  underlyingPrice: null,
  ibkrMarketValue: -4800,
  units: -100,
})
check('short shares without a quote still show the flex mark in both columns', shortFallback.stockPrice === 48 && shortFallback.marketPrice === 48 && shortFallback.marketValue === -4800)

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
