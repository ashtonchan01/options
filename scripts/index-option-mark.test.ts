/**
 * Personal SPX 7575/7550, 4-lot bull put, expiry 2026-11-06.
 * Credit was $3,729.76 ($9.32 × 4 × 100). Flex still had the spread marked
 * at $11.37, which is a loss of about 22%. CBOE mids at the same time were
 * 6.10 / 4.35, a $1.75 debit to close, which is about +81% of the credit.
 * Run with: npm test
 */
import { journalMarks } from '../src/components/journal/shareMark'
import { contractKey, indexOptionMarketValue } from '../src/services/indexOptionMarks'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const COST = -3729.76
const quotes = {
  [contractKey('SPX', '20261106', 7575, 'P')]: { bid: 6, ask: 6.2, mid: 6.1 },
  [contractKey('SPX', '20261106', 7550, 'P')]: { bid: 4.3, ask: 4.4, mid: 4.35 },
}

const live = indexOptionMarketValue({
  underlying: 'SPX',
  expiry: '20261106',
  strikes: [7575, 7550],
  putCall: 'P',
  strategy: 'put_spread',
  netPremium: 3729.76,
  contracts: 4,
  multiplier: 100,
  liveSigns: {},
  quotes,
})

check('spread value is short mid minus long mid, times 4 × 100', live != null && Math.abs(live - 4 * 100 * (4.35 - 6.1)) < 1e-6, String(live))

const marked = journalMarks({
  isShares: false,
  contracts: 4,
  underlyingPrice: 7697.2,
  ibkrMarketValue: -4 * 11.37 * 100,
  liveMarketValue: live,
  units: 400,
})
const pct = ((marked.marketValue ?? 0) - COST) / Math.abs(COST) * 100
check('7575/7550 unrealised is about +82% of the credit', pct > 80 && pct < 84, pct.toFixed(2))
check('stock price stays the live index', marked.stockPrice === 7697.2)
check('market price is the $1.75 net, not the stale $11.37', marked.marketPrice != null && Math.abs(marked.marketPrice - 1.75) < 1e-9, String(marked.marketPrice))

const stale = journalMarks({
  isShares: false,
  contracts: 4,
  underlyingPrice: null,
  ibkrMarketValue: -4548,
  units: 400,
})
const stalePct = ((stale.marketValue ?? 0) - COST) / Math.abs(COST) * 100
check('the flex mark of $11.37 is about −22%', stalePct < -20 && stalePct > -23, stalePct.toFixed(2))

const shortOnly = indexOptionMarketValue({
  underlying: 'SPX',
  expiry: '20261106',
  strikes: [7575, 7550],
  putCall: 'P',
  strategy: 'put_spread',
  netPremium: 3729.76,
  contracts: 4,
  multiplier: 100,
  liveSigns: { '7575': -1 },
  quotes: { [contractKey('SPX', '20261106', 7575, 'P')]: { bid: 6, ask: 6.2, mid: 6.1 } },
})
check('a missing long leg is not marked as a naked short', shortOnly == null)

const equity = indexOptionMarketValue({
  underlying: 'TSLA',
  expiry: '20261218',
  strikes: [340],
  putCall: 'P',
  strategy: 'csp',
  netPremium: 800,
  contracts: 1,
  multiplier: 100,
  liveSigns: { '340': -1 },
  quotes: { [contractKey('TSLA', '20261218', 340, 'P')]: { bid: 1, ask: 1.2, mid: 1.1 } },
})
check('equity options are not re-marked here', equity == null)

const withSigns = indexOptionMarketValue({
  underlying: 'SPX',
  expiry: '2026-11-06',
  strikes: [7575, 7550],
  putCall: 'P',
  strategy: 'put_spread',
  netPremium: 3729.76,
  contracts: 4,
  multiplier: 100,
  liveSigns: { '7575': -1, '7550': 1 },
  quotes,
})
check('flex signs and a dashed expiry match the same value', withSigns != null && live != null && Math.abs(withSigns - live) < 1e-6)

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
