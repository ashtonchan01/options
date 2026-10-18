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

// A position transfer's market value is not its tax cost. When the Flex
// row carries cost, that basis is the lot. When it does not, the mark must
// not be what a later sale realises against.
{
  const rows: { tag: string; attrs: Record<string, string> }[] = [
    { tag: 'Transfer', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'MSTR', date: '20260820',
      direction: 'IN', quantity: '100', positionAmount: '10425',
    } },
    { tag: 'Transfer', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'IBIT', date: '20260820',
      direction: 'IN', quantity: '200', positionAmount: '7756', cost: '-9200',
      transferPrice: '46', fifoPnlRealized: '0',
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
  const mstrIn = snap.trades.find(t => t.symbol === 'MSTR')
  const ibitIn = snap.trades.find(t => t.symbol === 'IBIT')
  check('transfer market value is the display price and not cost', !!mstrIn && mstrIn.isTransfer === true && mstrIn.cost == null && mstrIn.fifoPnlRealized == null && Math.abs(mstrIn.tradePrice - 104.25) < 0.001 && mstrIn.quantity === 100, JSON.stringify(mstrIn))
  check('transfer cost basis wins over the same-day mark', !!ibitIn && ibitIn.cost === -9200 && ibitIn.fifoPnlRealized === 0 && Math.abs(ibitIn.tradePrice - 46) < 0.001, JSON.stringify(ibitIn))

  const carried = buildStockPositions([
    stk({ symbol: 'MSTR', tradeDate: '20260820', quantity: 100, tradePrice: 104.25, cost: -MSTR_BASIS, isTransfer: true, fifoPnlRealized: 0, proceeds: -10425 }),
    stk({ symbol: 'MSTR', tradeDate: '20261017', quantity: -100, tradePrice: 135, proceeds: 13500, commissions: -0.52 }),
  ], {})
  const carriedClosed = carried.filter(p => p.status === 'Closed')
  const carriedPnl = carriedClosed.reduce((s, p) => s + (p.pnl ?? 0), 0)
  check('a transfer that carries IBKR cost is closed at that cost, not the $104.25 mark', Math.abs(carriedPnl - MSTR_PNL) < 0.05 && carried.filter(p => p.status === 'Active').length === 0 && Math.abs((carriedClosed[0]?.shareFills?.[0]?.price ?? 0) - MSTR_PX) < 0.001, `pnl ${carriedPnl} price ${carriedClosed[0]?.shareFills?.[0]?.price}`)
}

// Covered call called away. IBIT 200 sh came in on 20 Aug 2026 at that
// day's mark ($38.78, cost basis shown as $7,756) and were assigned at $46
// on 19 Sep 2026. IBKR's basis on the delivery is -$8,150 and the realised
// P/L is $1,106.40 — the short call's premium sits inside that figure, so
// the basis does not match the transfer mark. A normal sale would leave
// the transfer open. Flex also omits a symbol once its quantity is 0.
const IBIT_PNL = 1106.4

function ibitTransfer(): RawTrade {
  return stk({
    symbol: 'IBIT', tradeDate: '20260820', quantity: 200, tradePrice: 38.78,
    isTransfer: true, fifoPnlRealized: 0, proceeds: -7756, commissions: 0,
  })
}

function ibitAssignment(extra: Partial<RawTrade> = {}): RawTrade {
  return stk({
    symbol: 'IBIT', tradeDate: '20260919', tradeTime: '062000', quantity: -200, tradePrice: 46,
    proceeds: 9200, commissions: -0.23, cost: -8150, fifoPnlRealized: IBIT_PNL,
    openClose: 'C', isAssignment: true,
    ...extra,
  })
}

{
  const positions = buildStockPositions([ibitTransfer(), ibitAssignment()], {})
  const active = positions.filter(p => p.status === 'Active')
  const closed = positions.filter(p => p.status === 'Closed')
  const pnl = closed.reduce((s, p) => s + (p.pnl ?? 0), 0)
  check('called-away IBIT is not an open share position', active.length === 0, JSON.stringify(active.map(p => [p.underlying, p.contracts, -p.netPremium])))
  check('called-away IBIT realises IBKR 1,106.40', Math.abs(pnl - IBIT_PNL) < 0.02, `pnl ${pnl}`)
  check('called-away IBIT closes the 20 Aug lot', closed.length === 1 && closed[0].dateOpen === '20260820' && closed[0].contracts === 200, JSON.stringify(closed.map(p => [p.dateOpen, p.contracts, p.pnl])))
  check('called-away IBIT keeps IBKR cost basis', closed.length === 1 && Math.abs((-closed[0].netPremium) - 8150) < 0.05, `basis ${closed[0] && -closed[0].netPremium}`)
  check('called-away fill is labelled as an assignment', closed[0]?.shareFills?.some(f => f.action === 'Sell (assigned)') === true)

  const partial = buildStockPositions([
    ibitTransfer(),
    ibitAssignment({ quantity: -100, proceeds: 4600, commissions: -0.12, cost: -4075, fifoPnlRealized: 553.2 }),
  ], {})
  const partialOpen = partial.filter(p => p.status === 'Active')
  const partialPnl = partial.filter(p => p.status === 'Closed').reduce((s, p) => s + (p.pnl ?? 0), 0)
  check('partial assignment leaves the other 100 shares open', partialOpen.length === 1 && partialOpen[0].contracts === 100, JSON.stringify(partialOpen.map(p => [p.contracts, -p.netPremium])))
  check('partial assignment realises its own fifo', Math.abs(partialPnl - 553.2) < 0.02, `pnl ${partialPnl}`)

  const stored = [
    ibitTransfer(),
    ibitAssignment({ isAssignment: undefined }),
    stk({ symbol: 'NVDA', tradeDate: '20260801', quantity: 10, tradePrice: 180 }),
    stk({ symbol: 'XYZ', tradeDate: '20260115', quantity: 5, tradePrice: 20 }),
  ]
  const swept = buildStockPositions(stored, {}, [
    pos({ symbol: 'NVDA', quantity: 10, costBasisPrice: 180, costBasisMoney: 1800 }),
    pos({ symbol: 'IBIT', quantity: 0 }),
  ])
  const sweptActive = swept.filter(p => p.status === 'Active')
  check(
    'Flex open quantity 0 drops every share ticker the snapshot does not hold',
    sweptActive.length === 1 && sweptActive[0].underlying === 'NVDA' && sweptActive[0].contracts === 10,
    JSON.stringify(sweptActive.map(p => [p.underlying, p.status, p.contracts])),
  )
  const sweptPnl = swept.filter(p => p.underlying === 'IBIT' && p.status === 'Closed').reduce((s, p) => s + (p.pnl ?? 0), 0)
  check('flat IBIT still keeps the assignment realised P&L', Math.abs(sweptPnl - IBIT_PNL) < 0.02, `pnl ${sweptPnl}`)

  const omitted = buildStockPositions(stored, {}, [
    pos({ symbol: 'NVDA', quantity: 10, costBasisPrice: 180, costBasisMoney: 1800 }),
  ])
  const omittedActive = omitted.filter(p => p.status === 'Active')
  check(
    'a symbol missing from a non-empty Flex snapshot is not an open share',
    omittedActive.length === 1 && omittedActive[0].underlying === 'NVDA',
    JSON.stringify(omittedActive.map(p => [p.underlying, p.contracts])),
  )

  const noSnap = buildStockPositions([
    stk({ symbol: 'XYZ', tradeDate: '20260115', quantity: 5, tradePrice: 20 }),
  ], {}, [])
  check('an empty Flex snapshot does not wipe open shares', noSnap.some(p => p.status === 'Active' && p.underlying === 'XYZ' && p.contracts === 5))

  const mstrLive = buildStockPositions([
    stk({ symbol: 'MSTR', tradeDate: '20260820', quantity: 100, tradePrice: 104.25, isTransfer: true, fifoPnlRealized: 0, proceeds: -10425 }),
    stk({
      symbol: 'MSTR', tradeDate: '20261017', quantity: -100, tradePrice: 135,
      proceeds: 13500, commissions: -0.52, cost: -MSTR_BASIS, fifoPnlRealized: MSTR_PNL, openClose: 'C',
    }),
  ], {}, [pos({ symbol: 'MSTR', quantity: 100, costBasisPrice: 104.25, costBasisMoney: 10425 })])
  const mstrOpen = mstrLive.filter(p => p.status === 'Active')
  check(
    'a non-assignment sale does not remove shares Flex still holds',
    mstrOpen.length === 1 && mstrOpen[0].underlying === 'MSTR' && mstrOpen[0].contracts === 100 && Math.abs(-mstrOpen[0].netPremium - 10425) < 0.05,
    JSON.stringify(mstrOpen.map(p => [p.underlying, p.contracts, -p.netPremium])),
  )

  const held = holdingsFromTrades([ibitTransfer(), ibitAssignment()])
  check('allocation fallback does not keep called-away IBIT', held.every(h => h.symbol !== 'IBIT'), JSON.stringify(held))
  const mstrHeld = holdingsFromTrades([
    stk({ symbol: 'MSTR', tradeDate: '20260820', quantity: 100, tradePrice: 104.25 }),
    stk({ symbol: 'MSTR', tradeDate: '20261016', quantity: -100, tradePrice: 135, proceeds: 13500, commissions: -0.52, cost: -MSTR_BASIS, fifoPnlRealized: MSTR_PNL }),
  ])
  check('allocation fallback still keeps the unmatched MSTR transfer', mstrHeld.length === 1 && mstrHeld[0].shares === 100, JSON.stringify(mstrHeld))
}

{
  const rows: { tag: string; attrs: Record<string, string> }[] = [
    { tag: 'OptionEAE', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'IBIT', tradeID: 'eae1',
      date: '20260919', transactionType: 'Assignment', quantity: '200', tradePrice: '46',
      proceeds: '9200', commisionsAndTax: '-0.23', cost: '-8150', fifoPnlRealized: '1106.40',
    } },
    { tag: 'OptionEAE', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'NVDA', tradeID: 'eae2',
      date: '20260919', transactionType: 'SELL', quantity: '10', tradePrice: '100', proceeds: '1000',
    } },
    { tag: 'OptionEAE', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'TSLA', tradeID: 'eae3',
      date: '20260919', transactionType: 'Assignment', quantity: '100', tradePrice: '250', proceeds: '-25000',
    } },
    { tag: 'OptionEAE', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'AAPL', tradeID: 'eae4',
      date: '20260919', transactionType: 'Buy', quantity: '50', tradePrice: '135', proceeds: '-6750',
    } },
    { tag: 'Trade', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'IBIT', tradeID: 'tr1',
      tradeDate: '20260919', quantity: '-200', tradePrice: '46', proceeds: '9200',
      ibCommission: '-0.23', cost: '-8150', fifoPnlRealized: '1106.40',
      notes: 'A;C', openCloseIndicator: 'C', levelOfDetail: 'EXECUTION', transactionType: 'BookTrade',
    } },
    { tag: 'Trade', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'IBIT', tradeID: 'trUnsigned',
      tradeDate: '20260919', quantity: '200', tradePrice: '46', proceeds: '9200',
      notes: 'A', levelOfDetail: 'EXECUTION', transactionType: 'BookTrade',
    } },
    { tag: 'Trade', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'MSTR', tradeID: 'tr2',
      tradeDate: '20261017', quantity: '-100', tradePrice: '135', proceeds: '13500',
      notes: 'C;HC', openCloseIndicator: 'C', levelOfDetail: 'EXECUTION', cost: '-32679.01', fifoPnlRealized: '-19179.53',
    } },
    { tag: 'Trade', attrs: {
      accountId: 'U21440275', assetCategory: 'STK', symbol: 'TSLA', tradeID: 'trPut',
      tradeDate: '20260901', quantity: '100', tradePrice: '250', proceeds: '-25000',
      notes: 'A;O', openCloseIndicator: 'O', levelOfDetail: 'EXECUTION',
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
  const byId = (id: string) => snap.trades.find(t => t.execId === id)
  const eae = byId('eae1')
  check('OptionEAE assignment of unsigned shares is a closing sale', !!eae && eae.quantity === -200 && eae.isAssignment === true && eae.openClose === 'C' && eae.fifoPnlRealized === 1106.4, JSON.stringify(eae))
  const sell = byId('eae2')
  check('OptionEAE SELL is a negative stock quantity', !!sell && sell.quantity === -10 && sell.isAssignment === true, JSON.stringify(sell && { quantity: sell.quantity, isAssignment: sell.isAssignment }))
  const received = byId('eae3')
  check('put assignment OptionEAE stays a share receipt', !!received && received.quantity === 100 && received.isAssignment !== true, JSON.stringify(received && { quantity: received.quantity, isAssignment: received.isAssignment }))
  const bought = byId('eae4')
  check('OptionEAE Buy stays positive', !!bought && bought.quantity === 50 && bought.isAssignment !== true, JSON.stringify(bought && { quantity: bought.quantity }))
  const noted = byId('tr1')
  check('Flex trade code A on a stock close is an assignment', !!noted && noted.quantity === -200 && noted.isAssignment === true && noted.fifoPnlRealized === 1106.4, JSON.stringify(noted && { quantity: noted.quantity, isAssignment: noted.isAssignment }))
  const unsigned = byId('trUnsigned')
  check('unsigned Flex assignment with cash in is signed as a sale', !!unsigned && unsigned.quantity === -200 && unsigned.isAssignment === true, JSON.stringify(unsigned && { quantity: unsigned.quantity, isAssignment: unsigned.isAssignment }))
  const ordinary = byId('tr2')
  check('an ordinary C;HC stock sale is not an assignment', !!ordinary && ordinary.isAssignment !== true && ordinary.quantity === -100, JSON.stringify(ordinary && { isAssignment: ordinary.isAssignment, quantity: ordinary.quantity }))
  const putAssign = byId('trPut')
  check('a put assignment that receives shares stays an open buy', !!putAssign && putAssign.quantity === 100 && putAssign.isAssignment !== true, JSON.stringify(putAssign && { quantity: putAssign.quantity, isAssignment: putAssign.isAssignment }))

  const closedByParser = buildStockPositions([ibitTransfer(), eae!], {})
  const parserPnl = closedByParser.filter(p => p.status === 'Closed').reduce((s, p) => s + (p.pnl ?? 0), 0)
  check(
    'parsed called-away assignment closes the transfer at 1,106.40',
    closedByParser.every(p => p.status !== 'Active') && Math.abs(parserPnl - IBIT_PNL) < 0.02,
    JSON.stringify(closedByParser.map(p => [p.status, p.contracts, p.pnl])),
  )
}

if (failed > 0) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall passed')
