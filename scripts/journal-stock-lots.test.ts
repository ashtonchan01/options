/**
 * Share sales use IBKR's lot match (cost / fifoPnlRealized / Closed Lots),
 * not this app's own FIFO or LIFO walk.
 * Run with: npm test
 */
import type { ClosedLot, RawPosition, RawTrade } from '../src/types'
import { buildJournalPositions, buildStockPositions } from '../src/engine/journal'
import { parseFlexDocument } from '../src/services/ibkr'
import { holdingsFromTrades } from '../src/components/allocation/PortfolioAllocationView'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function stk(partial: Partial<RawTrade> & Pick<RawTrade, 'tradeDate' | 'quantity' | 'tradePrice' | 'symbol'>): RawTrade {
  const qty = partial.quantity
  return {
    assetClass: 'STK',
    proceeds: qty < 0 ? Math.abs(qty) * partial.tradePrice : -Math.abs(qty) * partial.tradePrice,
    commissions: 0,
    netCash: 0,
    ...partial,
  }
}

function pos(partial: Partial<RawPosition> & Pick<RawPosition, 'symbol' | 'quantity'>): RawPosition {
  return {
    accountId: 'U21440275',
    description: partial.symbol,
    assetClass: 'STK',
    costBasisPrice: 0,
    costBasisMoney: 0,
    markPrice: 0,
    positionValue: 0,
    unrealizedPnL: 0,
    currency: 'USD',
    ...partial,
  }
}

const MSTR_PNL = -19179.53
const MSTR_BASIS = 32679.01
const MSTR_PX = 326.7901

// Highest cost. The newer lot is the cheap assignment; LIFO would close
// that one and book +$3,074.48. IBKR's cost is the older $326.7901 lot.
{
  const trades = [
    stk({ symbol: 'MSTR', tradeDate: '20250203', quantity: 100, tradePrice: MSTR_PX }),
    stk({ symbol: 'MSTR', tradeDate: '20260820', quantity: 100, tradePrice: 104.25, commissions: 0 }),
    stk({
      symbol: 'MSTR', tradeDate: '20261016', quantity: -100, tradePrice: 135,
      proceeds: 13500, commissions: -0.52, cost: -MSTR_BASIS, fifoPnlRealized: MSTR_PNL,
    }),
  ]
  const positions = buildStockPositions(trades, {})
  const closed = positions.filter(p => p.status === 'Closed')
  const open = positions.filter(p => p.status === 'Active')
  const pnl = closed.reduce((s, p) => s + (p.pnl ?? 0), 0)
  check('MSTR highest-cost sale realises IBKR P&L', Math.abs(pnl - MSTR_PNL) < 0.02, `pnl ${pnl}`)
  check('MSTR closed lot opened on the high-cost date', closed.length === 1 && closed[0].dateOpen === '20250203', JSON.stringify(closed.map(p => [p.dateOpen, p.contracts, p.pnl])))
  check('MSTR closed lot cost is $326.79', closed.length === 1 && Math.abs(closed[0].contracts - 100) < 1e-6 && Math.abs((-closed[0].netPremium) / closed[0].contracts - MSTR_PX) < 0.001, `basis ${closed[0] && -closed[0].netPremium}`)
  check('MSTR expanded row shows the closed lot, not the assignment', closed[0]?.shareFills?.[0]?.action === 'Buy (closed lot)' && Math.abs((closed[0].shareFills[0].price) - MSTR_PX) < 0.001, JSON.stringify(closed[0]?.shareFills))
  check('MSTR assignment stays open at $104.25', open.length === 1 && open[0].contracts === 100 && open[0].dateOpen === '20260820' && Math.abs(-open[0].netPremium - 10425) < 0.02, JSON.stringify(open.map(p => [p.dateOpen, p.contracts, -p.netPremium])))
  check('MSTR open row is still the assignment', open[0]?.shareFills?.[0]?.action === 'Buy (assigned)')
}

// Same sale, but the $326.79 lot is not in the trade window — only Closed
// Lots name it. The assignment must not be consumed. Flex open lots are
// the shares still held, including one the trade list never saw.
{
  const closedLot: ClosedLot = {
    quantity: -100,
    tradeDate: '20261016',
    tradePrice: 135,
    proceeds: 13500,
    commissions: -0.52,
    cost: -MSTR_BASIS,
    fifoPnlRealized: MSTR_PNL,
    origTradeDate: '20240311',
    origTradePrice: MSTR_PX,
  }
  const trades = [
    stk({ symbol: 'MSTR', tradeDate: '20260820', quantity: 100, tradePrice: 104.25 }),
    stk({
      symbol: 'MSTR', tradeDate: '20261016', quantity: -100, tradePrice: 135,
      proceeds: 13500, commissions: -0.52, cost: -MSTR_BASIS, fifoPnlRealized: MSTR_PNL,
      closedLots: [closedLot],
    }),
  ]
  const live = [pos({
    symbol: 'MSTR',
    quantity: 180,
    costBasisPrice: (10425 + 20000) / 180,
    costBasisMoney: 10425 + 20000,
    levelOfDetail: 'SUMMARY',
    openLots: [
      { quantity: 100, costBasisPrice: 104.25, costBasisMoney: 10425, openDate: '20260820' },
      { quantity: 80, costBasisPrice: 250, costBasisMoney: 20000, openDate: '20240115' },
    ],
  })]
  const positions = buildStockPositions(trades, {}, live)
  const closed = positions.filter(p => p.status === 'Closed')
  const open = positions.filter(p => p.status === 'Active')
  const openQty = open.reduce((s, p) => s + p.contracts, 0)
  const openBasis = open.reduce((s, p) => s + (-p.netPremium), 0)
  check('closed-lot MSTR P&L matches IBKR', Math.abs(closed.reduce((s, p) => s + (p.pnl ?? 0), 0) - MSTR_PNL) < 0.02, JSON.stringify(closed.map(p => p.pnl)))
  check('closed lot keeps its own open date and $326.79 cost', closed[0]?.dateOpen === '20240311' && Math.abs((closed[0].shareFills?.[0]?.price ?? 0) - MSTR_PX) < 0.001, JSON.stringify(closed[0]?.shareFills))
  check('assignment was not the lot that was sold', !closed.some(p => p.dateOpen === '20260820' || Math.abs((p.shareFills?.[0]?.price ?? 0) - 104.25) < 0.01))
  check('open quantity matches the Flex position', Math.abs(openQty - 180) < 1e-6, `qty ${openQty}`)
  check('open lots keep Flex cost, including the assignment', open.some(p => p.dateOpen === '20260820' && Math.abs(-p.netPremium - 10425) < 0.02) && open.some(p => Math.abs(-p.netPremium - 20000) < 0.02) && Math.abs(openBasis - 30425) < 0.05, JSON.stringify(open.map(p => [p.dateOpen, p.contracts, -p.netPremium])))
}

// FIFO account. The newer lot is also the expensive one, so both LIFO and
// highest-cost would close it. IBKR's cost is the older $100 lot. Nothing
// here is hardcoded to highest cost.
{
  const trades = [
    stk({ symbol: 'AAPL', tradeDate: '20260105', quantity: 100, tradePrice: 100 }),
    stk({ symbol: 'AAPL', tradeDate: '20260601', quantity: 100, tradePrice: 180 }),
    stk({
      symbol: 'AAPL', tradeDate: '20261001', quantity: -100, tradePrice: 120,
      proceeds: 12000, commissions: -0.5, cost: -10000, fifoPnlRealized: 1999.5,
    }),
  ]
  const positions = buildStockPositions(trades, {})
  const closed = positions.filter(p => p.status === 'Closed')
  const open = positions.filter(p => p.status === 'Active')
  check('FIFO sale realises IBKR P&L', Math.abs((closed[0]?.pnl ?? 0) - 1999.5) < 0.02, `pnl ${closed[0]?.pnl}`)
  check('FIFO sale closes the older $100 lot', closed[0]?.dateOpen === '20260105' && Math.abs((closed[0].shareFills?.[0]?.price ?? 0) - 100) < 0.001)
  check('FIFO sale leaves the newer $180 lot open', open.length === 1 && open[0].contracts === 100 && open[0].dateOpen === '20260601' && Math.abs(-open[0].netPremium - 18000) < 0.02, JSON.stringify(open.map(p => [p.dateOpen, -p.netPremium])))
}

// FIFO across two lots: 100 @ $10 then 100 @ $30, sell 150. Basis
// 100*10 + 50*30 = 2500. Highest cost would have been 3500.
{
  const trades = [
    stk({ symbol: 'IBM', tradeDate: '20260105', quantity: 100, tradePrice: 10 }),
    stk({ symbol: 'IBM', tradeDate: '20260601', quantity: 100, tradePrice: 30 }),
    stk({
      symbol: 'IBM', tradeDate: '20261001', quantity: -150, tradePrice: 20,
      proceeds: 3000, commissions: 0, cost: -2500, fifoPnlRealized: 500,
    }),
  ]
  const positions = buildStockPositions(trades, {})
  const closed = positions.filter(p => p.status === 'Closed')
  const open = positions.filter(p => p.status === 'Active')
  const pnl = closed.reduce((s, p) => s + (p.pnl ?? 0), 0)
  const closedQty = closed.reduce((s, p) => s + p.contracts, 0)
  check('FIFO span realises the reported P&L', Math.abs(pnl - 500) < 0.02, `pnl ${pnl}`)
  check('FIFO span closes 150 shares', Math.abs(closedQty - 150) < 1e-6, `qty ${closedQty}`)
  check('FIFO span leaves 50 of the $30 lot', open.length === 1 && Math.abs(open[0].contracts - 50) < 1e-6 && Math.abs((open[0].shareFills?.[0]?.price ?? 0) - 30) < 0.001, JSON.stringify(open))
}

// Basis present, and the sale is only part of the lot. The same-day
// partial netting from PR 289 must still leave the unsold shares open.
{
  const trades = [
    stk({ symbol: 'TSLA', tradeDate: '20261007', quantity: 100, tradePrice: 400 }),
    stk({
      symbol: 'TSLA', tradeDate: '20261007', quantity: -40, tradePrice: 420,
      proceeds: 16800, commissions: 0, cost: -16000, fifoPnlRealized: 800,
    }),
  ]
  const positions = buildStockPositions(trades, {})
  const open = positions.find(p => p.status === 'Active')
  const closed = positions.find(p => p.status === 'Closed')
  check('IBKR partial still leaves 60 shares open', open?.contracts === 60, JSON.stringify(positions.map(p => [p.status, p.contracts])))
  check('IBKR partial realises the 40-lot P&L', Math.abs((closed?.pnl ?? 0) - 800) < 0.02, `pnl ${closed?.pnl}`)
}

// An option round-trip in the same batch is untouched by the stock matcher.
{
  const trades = [
    stk({ symbol: 'MSTR', tradeDate: '20250203', quantity: 100, tradePrice: MSTR_PX }),
    stk({ symbol: 'MSTR', tradeDate: '20260820', quantity: 100, tradePrice: 104.25 }),
    stk({
      symbol: 'MSTR', tradeDate: '20261016', quantity: -100, tradePrice: 135,
      proceeds: 13500, commissions: -0.52, cost: -MSTR_BASIS, fifoPnlRealized: MSTR_PNL,
    }),
    {
      symbol: 'SOFI', underlyingSymbol: 'SOFI', assetClass: 'OPT' as const, putCall: 'P' as const,
      strike: 14.5, expiry: '20270320', tradeDate: '20261001', tradeTime: '100000',
      quantity: -10, tradePrice: 1, proceeds: 1000, commissions: 0, netCash: 1000, openClose: 'O' as const,
    },
    {
      symbol: 'SOFI', underlyingSymbol: 'SOFI', assetClass: 'OPT' as const, putCall: 'P' as const,
      strike: 14.5, expiry: '20270320', tradeDate: '20261008', tradeTime: '110000',
      quantity: 10, tradePrice: 0.4, proceeds: -400, commissions: 0, netCash: -400, openClose: 'C' as const,
    },
  ]
  const opts = buildJournalPositions(trades, {})
  const stocks = buildStockPositions(trades, {})
  check('option round trip is still one closed position', opts.length === 1 && opts[0].status === 'Closed' && opts[0].contracts === 10, JSON.stringify(opts.map(p => [p.status, p.contracts, p.pnl])))
  check('option P&L is unchanged by the stock lot fix', Math.abs((opts[0]?.pnl ?? 0) - 600) < 1e-6, `pnl ${opts[0]?.pnl}`)
  check('stock P&L in the same batch is still IBKR', Math.abs(stocks.filter(p => p.status === 'Closed').reduce((s, p) => s + (p.pnl ?? 0), 0) - MSTR_PNL) < 0.02)
}

// No live positions: trade-only allocation relieves IBKR's basis, so the
// cheap lot is what remains. A basis bigger than every lot in the file
// (the sold lot was opened outside the window) must not wipe the assignment.
{
  const both = holdingsFromTrades([
    stk({ symbol: 'MSTR', tradeDate: '20250203', quantity: 100, tradePrice: MSTR_PX }),
    stk({ symbol: 'MSTR', tradeDate: '20260820', quantity: 100, tradePrice: 104.25 }),
    stk({ symbol: 'MSTR', tradeDate: '20261016', quantity: -100, tradePrice: 135, proceeds: 13500, commissions: -0.52, cost: -MSTR_BASIS, fifoPnlRealized: MSTR_PNL }),
  ])
  check('allocation fallback keeps the $104.25 lot', both.length === 1 && both[0].shares === 100 && Math.abs(both[0].avgCost - 104.25) < 0.02, JSON.stringify(both))

  const onlyAssignment = holdingsFromTrades([
    stk({ symbol: 'MSTR', tradeDate: '20260820', quantity: 100, tradePrice: 104.25 }),
    stk({ symbol: 'MSTR', tradeDate: '20261016', quantity: -100, tradePrice: 135, proceeds: 13500, commissions: -0.52, cost: -MSTR_BASIS, fifoPnlRealized: MSTR_PNL }),
  ])
  check('assignment is not erased when the closed lot is outside the file', onlyAssignment.length === 1 && onlyAssignment[0].shares === 100 && Math.abs(onlyAssignment[0].value - 10425) < 0.05, JSON.stringify(onlyAssignment))
}

// Flex XML: executions, closed lots, and open-position lots.
{
  const rows: { tag: string; attrs: Record<string, string> }[] = [
    { tag: 'Trade', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'MSTR', tradeID: 'sale1',
      tradeDate: '20261016', quantity: '-100', tradePrice: '135', proceeds: '13500',
      ibCommission: '-0.52', netCash: '13499.48', cost: '-32679.01', fifoPnlRealized: '-19179.53',
      openCloseIndicator: 'C', levelOfDetail: 'EXECUTION', buySell: 'SELL',
    } },
    { tag: 'Trade', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'MSTR', tradeID: 'sale1',
      tradeDate: '20261016', quantity: '-100', tradePrice: '135', proceeds: '13500',
      ibCommission: '-0.52', cost: '-32679.01', fifoPnlRealized: '-19179.53',
      origTradePrice: '326.7901', origTradeDate: '20240311', origTradeID: 'openHi',
      levelOfDetail: 'CLOSED_LOT',
    } },
    { tag: 'Trade', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'MSTR', tradeDate: '20261016',
      quantity: '-100', tradePrice: '135', levelOfDetail: 'ORDER',
    } },
    { tag: 'Trade', attrs: {
      accountId: 'U21440275', assetCategory: 'OPT', symbol: 'SOFI', underlyingSymbol: 'SOFI',
      tradeID: 'opt1', tradeDate: '20261001', quantity: '-1', tradePrice: '1',
      proceeds: '100', ibCommission: '-1', putCall: 'P', strike: '14.5', expiry: '20270320',
      openCloseIndicator: 'O', levelOfDetail: 'EXECUTION',
    } },
    { tag: 'Trade', attrs: {
      accountId: 'U21440275', assetCategory: 'OPT', symbol: 'SOFI', tradeDate: '20261001',
      quantity: '-1', tradePrice: '1', levelOfDetail: 'CLOSED_LOT', cost: '0', fifoPnlRealized: '0',
    } },
    { tag: 'OpenPosition', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'MSTR', position: '180',
      costBasisPrice: '169.027777', costBasisMoney: '30425', markPrice: '136.83',
      positionValue: '24629.4', fifoPnlUnrealized: '-5795.6', currency: 'USD', levelOfDetail: 'SUMMARY',
    } },
    { tag: 'OpenPosition', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'MSTR', position: '100',
      costBasisPrice: '104.25', costBasisMoney: '10425', markPrice: '136.83',
      positionValue: '13683', fifoPnlUnrealized: '3258', currency: 'USD', levelOfDetail: 'LOT',
      openDateTime: '20260820;093000',
    } },
    { tag: 'OpenPosition', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'MSTR', position: '80',
      costBasisPrice: '250', costBasisMoney: '20000', markPrice: '136.83',
      positionValue: '10946.4', fifoPnlUnrealized: '-9053.6', currency: 'USD', levelOfDetail: 'LOT',
      openDateTime: '20240115;100000',
    } },
  ]
  const elements = rows.map(r => ({
    tag: r.tag,
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(r.attrs, name) ? r.attrs[name] : null
    },
  }))
  const doc = {
    querySelectorAll(sel: string) { return elements.filter(e => e.tag === sel) },
    querySelector(sel: string) { return elements.find(e => e.tag === sel) ?? null },
  }
  const snap = parseFlexDocument(doc as unknown as Document)
  const mstr = snap.trades.filter(t => t.symbol === 'MSTR' && t.assetClass === 'STK')
  const sofi = snap.trades.filter(t => t.symbol === 'SOFI')
  check('parser keeps one MSTR execution, not the closed lot or the order rollup', mstr.length === 1, `trades ${mstr.length}`)
  check('parser attaches the closed lot', mstr[0]?.closedLots?.length === 1 && mstr[0].closedLots[0].origTradeDate === '20240311' && Math.abs((mstr[0].closedLots[0].origTradePrice ?? 0) - MSTR_PX) < 1e-6, JSON.stringify(mstr[0]?.closedLots))
  check('parser keeps cost and fifoPnlRealized on the execution', mstr[0]?.cost === -MSTR_BASIS && mstr[0]?.fifoPnlRealized === MSTR_PNL, `cost ${mstr[0]?.cost} pnl ${mstr[0]?.fifoPnlRealized}`)
  check('option closed lot is not a second option trade', sofi.length === 1, `sofi ${sofi.length}`)
  const mstrPos = snap.positions.filter(p => p.symbol === 'MSTR')
  check('open position summary is not double-counted with its lots', mstrPos.length === 1 && mstrPos[0].quantity === 180 && Math.abs(mstrPos[0].costBasisMoney - 30425) < 0.01, JSON.stringify(mstrPos.map(p => [p.quantity, p.costBasisMoney, p.openLots?.length])))
  check('open lots keep their own cost and open date', mstrPos[0]?.openLots?.length === 2 && mstrPos[0].openLots.some(l => l.openDate === '20260820' && l.costBasisPrice === 104.25) && mstrPos[0].openLots.some(l => l.openDate === '20240115' && l.quantity === 80), JSON.stringify(mstrPos[0]?.openLots))

  const built = buildStockPositions(mstr, {}, mstrPos)
  const openQty = built.filter(p => p.status === 'Active').reduce((s, p) => s + p.contracts, 0)
  const pnl = built.filter(p => p.status === 'Closed').reduce((s, p) => s + (p.pnl ?? 0), 0)
  check('parsed MSTR sale realises -$19,179.53', Math.abs(pnl - MSTR_PNL) < 0.02, `pnl ${pnl}`)
  check('parsed open quantity matches Flex', Math.abs(openQty - 180) < 1e-6, `qty ${openQty}`)
}

if (failed > 0) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall passed')
