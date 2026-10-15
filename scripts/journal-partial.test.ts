/**
 * Same-day and partial buybacks in the journal position matcher.
 * Run with: npm test
 */
import type { RawTrade } from '../src/types'
import { buildJournalPositions, buildStockPositions, foldPartialCloses, nearestExpiry } from '../src/engine/journal'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function opt(partial: Partial<RawTrade> & Pick<RawTrade, 'tradeDate' | 'quantity' | 'tradePrice' | 'symbol'>): RawTrade {
  return {
    underlyingSymbol: partial.symbol,
    assetClass: 'OPT',
    putCall: 'P',
    strike: 14.5,
    expiry: '20270320',
    proceeds: 0,
    commissions: 0,
    netCash: 0,
    openClose: partial.quantity < 0 ? 'O' : 'C',
    ...partial,
  }
}

function stk(partial: Partial<RawTrade> & Pick<RawTrade, 'tradeDate' | 'quantity' | 'tradePrice' | 'symbol'>): RawTrade {
  return {
    assetClass: 'STK',
    proceeds: 0,
    commissions: 0,
    netCash: 0,
    ...partial,
  }
}

// The reported SOFI case: 50 sold, 30 bought back later the same day as its
// own execution (different tradeTime, so it is not a settlement leg of the
// opening group). Flex would report the open position as -20.
{
  const trades = [
    opt({ symbol: 'SOFI', tradeDate: '20261007', tradeTime: '100000', quantity: -50, tradePrice: 0.2, commissions: 25, openClose: 'O' }),
    opt({ symbol: 'SOFI', tradeDate: '20261007', tradeTime: '153000', quantity: 30, tradePrice: 0.45, commissions: 15, openClose: 'C' }),
  ]
  const positions = buildJournalPositions(trades, {})
  const active = positions.filter(p => p.status === 'Active')
  const closed = positions.filter(p => p.status === 'Closed')
  const flexQty = -20
  check('SOFI same-day 50/30 leaves one open row', active.length === 1, `active ${active.length}`)
  check('SOFI open contracts are the net 20', active[0]?.contracts === 20, `contracts ${active[0]?.contracts}`)
  check('SOFI open quantity equals the flex position quantity', active[0]?.contracts === Math.abs(flexQty))
  check('SOFI 30-lot buyback is a realised partial close', closed.length === 1 && closed[0].contracts === 30, `closed ${closed.map(p => p.contracts).join(',')}`)
  check('SOFI partial close id is distinct from the open row', !!closed[0] && closed[0].id !== active[0]?.id && closed[0].id.startsWith(active[0]?.id ?? 'x'))
  // Opening credit 50 * 0.20 * 100 - 25 fee = 975. Remaining 20/50 keeps 390.
  check('SOFI open cost basis is the remaining 20', Math.abs((active[0]?.netPremium ?? 0) - 390) < 1e-6, `net ${active[0]?.netPremium}`)
  check('SOFI open fees are the remaining 20', Math.abs((active[0]?.openFees ?? 0) - 10) < 1e-6, `fees ${active[0]?.openFees}`)
  // Closed 30: opening share 585, buyback debit 30 * 0.45 * 100 + 15 = 1365, pnl = 585 - 1365.
  check('SOFI partial P&L is the 30-lot round trip', Math.abs((closed[0]?.pnl ?? 0) - (585 - 1365)) < 1e-6, `pnl ${closed[0]?.pnl}`)
  check('SOFI partial close fees include the buyback commission', Math.abs((closed[0]?.closeFees ?? 0) - 15) < 1e-6, `closeFees ${closed[0]?.closeFees}`)
  const shown = foldPartialCloses(positions)
  const shownActive = shown.find(p => p.status === 'Active')
  check('folded journal shows the partial P&L on the open row', Math.abs((shownActive?.pnl ?? 0) - (585 - 1365)) < 1e-6, `shown pnl ${shownActive?.pnl}`)
  check('folded journal hides the closed slice while the lot is open', shown.filter(p => p.id.includes('#c')).length === 0)
  check('raw positions still keep the closed slice for reports', positions.some(p => p.status === 'Closed' && p.pnl != null))
}

// Same 50/30, but the buyback shares the opening group's tradeTime and is
// not flagged open/close — the matcher used to count only the opening sells.
{
  const trades = [
    opt({ symbol: 'SOFI', tradeDate: '20261007', tradeTime: '100000', quantity: -50, tradePrice: 0.2, commissions: 0, openClose: 'O' }),
    opt({ symbol: 'SOFI', tradeDate: '20261007', tradeTime: '100000', quantity: 30, tradePrice: 0.4, commissions: 0, openClose: undefined }),
  ]
  const positions = buildJournalPositions(trades, {})
  const active = positions.find(p => p.status === 'Active')
  check('same-group unmarked buyback nets to 20', active?.contracts === 20, `contracts ${active?.contracts}`)
  check('same-group unmarked buyback does not flatten the position', positions.filter(p => p.status === 'Active').length === 1)
}

// A later-day partial, a full close, and a close split across two prints.
{
  const partial = buildJournalPositions([
    opt({ symbol: 'AAPL', tradeDate: '20261001', tradeTime: '100000', quantity: -10, tradePrice: 1, strike: 240, expiry: '20261120' }),
    opt({ symbol: 'AAPL', tradeDate: '20261008', tradeTime: '110000', quantity: 4, tradePrice: 0.4, strike: 240, expiry: '20261120' }),
  ], {})
  check('later-day partial leaves 6 open', partial.find(p => p.status === 'Active')?.contracts === 6, JSON.stringify(partial.map(p => [p.status, p.contracts])))

  const full = buildJournalPositions([
    opt({ symbol: 'AAPL', tradeDate: '20261001', tradeTime: '100000', quantity: -10, tradePrice: 1, strike: 240, expiry: '20261120' }),
    opt({ symbol: 'AAPL', tradeDate: '20261008', tradeTime: '110000', quantity: 10, tradePrice: 0.4, strike: 240, expiry: '20261120' }),
  ], {})
  check('full close is still one closed position', full.length === 1 && full[0].status === 'Closed' && full[0].contracts === 10)
  check('full close keeps the original position id', full[0]?.id === '20261001|20261120|AAPL')
  // credit 1000, debit 400, pnl 600
  check('full close P&L is opening plus close', Math.abs((full[0]?.pnl ?? 0) - 600) < 1e-6, `pnl ${full[0]?.pnl}`)

  const split = buildJournalPositions([
    opt({ symbol: 'AVGO', tradeDate: '20261001', tradeTime: '100000', quantity: -2, tradePrice: 5, strike: 425, expiry: '20261120' }),
    opt({ symbol: 'AVGO', tradeDate: '20261008', tradeTime: '120001', quantity: 1, tradePrice: 8, strike: 425, expiry: '20261120' }),
    opt({ symbol: 'AVGO', tradeDate: '20261008', tradeTime: '120002', quantity: 1, tradePrice: 8, strike: 425, expiry: '20261120' }),
  ], {})
  check('two close prints that sum to the open fully close it', split.length === 1 && split[0].status === 'Closed' && Math.abs((split[0].pnl ?? 0) - (1000 - 1600)) < 1e-6, JSON.stringify(split.map(p => [p.status, p.contracts, p.pnl])))
}

// Bull put spread, covered call, and a synthetic, each partially bought back.
{
  const bps = buildJournalPositions([
    opt({ symbol: 'SPX', tradeDate: '20261001', tradeTime: '093000', quantity: -10, tradePrice: 5, strike: 7525, putCall: 'P', expiry: '20261120', openClose: 'O' }),
    opt({ symbol: 'SPX', tradeDate: '20261001', tradeTime: '093000', quantity: 10, tradePrice: 3, strike: 7500, putCall: 'P', expiry: '20261120', openClose: 'O' }),
    opt({ symbol: 'SPX', tradeDate: '20261009', tradeTime: '100001', quantity: 4, tradePrice: 2, strike: 7525, putCall: 'P', expiry: '20261120', openClose: 'C' }),
    opt({ symbol: 'SPX', tradeDate: '20261009', tradeTime: '100002', quantity: -4, tradePrice: 1, strike: 7500, putCall: 'P', expiry: '20261120', openClose: 'C' }),
  ], {})
  check('BPS partial leaves 6 spreads open', bps.find(p => p.status === 'Active')?.contracts === 6, JSON.stringify(bps.map(p => [p.status, p.contracts, p.strikeDisplay])))
  check('BPS partial books the 4-lot close', bps.find(p => p.status === 'Closed')?.contracts === 4)

  const cc = buildJournalPositions([
    opt({ symbol: 'TSLA', tradeDate: '20261002', tradeTime: '100000', quantity: -5, tradePrice: 2, strike: 400, putCall: 'C', expiry: '20261120', openClose: 'O' }),
    opt({ symbol: 'TSLA', tradeDate: '20261002', tradeTime: '150000', quantity: 2, tradePrice: 1, strike: 400, putCall: 'C', expiry: '20261120', openClose: 'C' }),
  ], {})
  check('covered call same-day partial leaves 3', cc.find(p => p.status === 'Active')?.contracts === 3, JSON.stringify(cc.map(p => [p.status, p.contracts])))

  const synth = buildJournalPositions([
    opt({ symbol: 'TSLA', tradeDate: '20261003', tradeTime: '110000', quantity: 2, tradePrice: 20, strike: 330, putCall: 'C', expiry: '20270618', openClose: 'O' }),
    opt({ symbol: 'TSLA', tradeDate: '20261003', tradeTime: '110000', quantity: -2, tradePrice: 15, strike: 340, putCall: 'P', expiry: '20270618', openClose: 'O' }),
    opt({ symbol: 'TSLA', tradeDate: '20261010', tradeTime: '120000', quantity: -1, tradePrice: 22, strike: 330, putCall: 'C', expiry: '20270618', openClose: 'C' }),
    opt({ symbol: 'TSLA', tradeDate: '20261010', tradeTime: '120000', quantity: 1, tradePrice: 12, strike: 340, putCall: 'P', expiry: '20270618', openClose: 'C' }),
  ], {})
  check('synthetic partial leaves 1 open', synth.find(p => p.status === 'Active')?.contracts === 1, JSON.stringify(synth.map(p => [p.status, p.contracts, p.strikeDisplay, p.strategy])))
}

// A round-trip filed on its own later order must not close an earlier open
// of the same strike, and a roll's close must still hit the old strike.
{
  const roundTrip = buildJournalPositions([
    opt({ symbol: 'SOFI', tradeDate: '20261007', tradeTime: '100000', quantity: -10, tradePrice: 0.2, openClose: 'O' }),
    opt({ symbol: 'SOFI', tradeDate: '20261007', tradeTime: '150000', quantity: -10, tradePrice: 0.3, openClose: 'O' }),
    opt({ symbol: 'SOFI', tradeDate: '20261007', tradeTime: '150000', quantity: 10, tradePrice: 0.3, openClose: 'C' }),
  ], {})
  const stillOpen = roundTrip.filter(p => p.status === 'Active')
  check('later same-day round trip does not consume the earlier open', stillOpen.length === 1 && stillOpen[0].contracts === 10, JSON.stringify(roundTrip.map(p => [p.status, p.contracts, p.dateOpen])))

  const roll = buildJournalPositions([
    opt({ symbol: 'AVGO', tradeDate: '20260901', tradeTime: '100000', quantity: -1, tradePrice: 4, strike: 400, expiry: '20261120', openClose: 'O' }),
    opt({ symbol: 'AVGO', tradeDate: '20261001', tradeTime: '110000', quantity: 1, tradePrice: 2, strike: 400, expiry: '20261120', openClose: 'C' }),
    opt({ symbol: 'AVGO', tradeDate: '20261001', tradeTime: '110000', quantity: -1, tradePrice: 3, strike: 380, expiry: '20261120', openClose: 'O' }),
  ], {})
  check('roll closes the old strike', roll.some(p => p.status === 'Closed' && p.strikes.includes(400)))
  check('roll leaves the new strike open', roll.some(p => p.status === 'Active' && p.strikes.includes(380) && p.contracts === 1), JSON.stringify(roll.map(p => [p.status, p.strikeDisplay, p.contracts])))
}

// Shares already net same-day partial sells. Keep that.
{
  const shares = buildStockPositions([
    stk({ symbol: 'TSLA', tradeDate: '20261007', quantity: 100, tradePrice: 400 }),
    stk({ symbol: 'TSLA', tradeDate: '20261007', quantity: -40, tradePrice: 420 }),
  ], {})
  check('share same-day partial leaves 60', shares.find(p => p.status === 'Active')?.contracts === 60, JSON.stringify(shares.map(p => [p.status, p.contracts])))
  check('share partial close is realised', shares.some(p => p.status === 'Closed' && p.contracts === 40 && (p.pnl ?? 0) > 0))
}

{
  const synth = buildJournalPositions([
    opt({ symbol: 'TSLA', tradeDate: '20260723', tradeTime: '110000', quantity: 1, tradePrice: 48, strike: 330, putCall: 'C', expiry: '20270618', openClose: 'O' }),
    opt({ symbol: 'TSLA', tradeDate: '20260723', tradeTime: '110000', quantity: -1, tradePrice: 36, strike: 340, putCall: 'P', expiry: '20270115', openClose: 'O' }),
    opt({ symbol: 'TSLA', tradeDate: '20261010', tradeTime: '120000', quantity: -1, tradePrice: 50, strike: 330, putCall: 'C', expiry: '20270618', openClose: 'C' }),
    opt({ symbol: 'TSLA', tradeDate: '20261010', tradeTime: '120000', quantity: 1, tradePrice: 30, strike: 340, putCall: 'P', expiry: '20270115', openClose: 'C' }),
  ], { })
  // The two opens share a timestamp but not an expiry, so they are one
  // synthetic. 20270115 is sooner than 20270618.
  check('multi-expiry synthetic is one position', synth.length === 1 && synth[0].strikes.length === 2, JSON.stringify(synth.map(p => [p.status, p.strikeDisplay, p.expiry, p.contracts])))
  check('multi-expiry synthetic shows the nearest expiry', synth[0]?.expiry === '20270115', synth[0]?.expiry)
  check('multi-expiry synthetic close flattens both legs', synth[0]?.status === 'Closed' && synth[0].strikeDisplay.includes('340P') && synth[0].strikeDisplay.includes('330C'), JSON.stringify(synth.map(p => [p.status, p.strikeDisplay, p.expiry])))
}

// A buy-to-close that IBKR marked 'O' (common on SPX) must stay a close.
// Parking opening long calls must not turn that fill into its own position.
{
  const markedOpen = buildJournalPositions([
    opt({ symbol: 'SPX', tradeDate: '20261001', tradeTime: '093000', quantity: -1, tradePrice: 4, strike: 7000, putCall: 'C', expiry: '20261120', openClose: 'O' }),
    opt({ symbol: 'SPX', tradeDate: '20261008', tradeTime: '100000', quantity: 1, tradePrice: 1, strike: 7000, putCall: 'C', expiry: '20261120', openClose: 'O' }),
  ], {})
  check('call buyback marked open still closes the short', markedOpen.length === 1 && markedOpen[0].status === 'Closed' && markedOpen[0].contracts === 1, JSON.stringify(markedOpen.map(p => [p.status, p.strikeDisplay, p.contracts])))

  // Same second as a new short put on a different expiry: the buy still
  // belongs to the short call, and the put stays its own position.
  const alongside = buildJournalPositions([
    opt({ symbol: 'SPX', tradeDate: '20261001', tradeTime: '093000', quantity: -1, tradePrice: 4, strike: 7000, putCall: 'C', expiry: '20261120', openClose: 'O' }),
    opt({ symbol: 'SPX', tradeDate: '20261008', tradeTime: '100000', quantity: 1, tradePrice: 1, strike: 7000, putCall: 'C', expiry: '20261120', openClose: 'O' }),
    opt({ symbol: 'SPX', tradeDate: '20261008', tradeTime: '100000', quantity: -1, tradePrice: 3, strike: 6800, putCall: 'P', expiry: '20261218', openClose: 'O' }),
  ], {})
  check('call buyback is not absorbed into a same-timestamp short put', alongside.some(p => p.status === 'Closed' && p.strikes.includes(7000)) && alongside.some(p => p.status === 'Active' && p.strikes.includes(6800) && p.strikes.length === 1), JSON.stringify(alongside.map(p => [p.status, p.strikeDisplay, p.expiry])))
}

{
  const today = new Date(2026, 9, 15)
  check('nearest expiry is the soonest date still ahead', nearestExpiry(['20270618', '20270115', '20260320'], today) === '20270115')
  check('nearest expiry falls back to the latest past date', nearestExpiry(['20260320', '20260102'], today) === '20260320')
  check('a single expiry is unchanged', nearestExpiry(['20270320'], today) === '20270320')
}

if (failed > 0) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall passed')
