import assert from 'node:assert/strict'
import { thirdFriday, weekday, weekdaySessions } from '../src/backtest/calendar.ts'
import { runBacktest, type BacktestParams, type IntradayBar, type SessionBar } from '../src/backtest/engine.ts'
import { buildExpiries, resolveExpiry, SPXW_SCHEDULE } from '../src/backtest/expiries.ts'
import { HIDDEN_DEFAULTS } from '../src/backtest/defaults.ts'
import { bsmPut, bsmPutDelta, roundStrike, skewedIv, spreadMark } from '../src/backtest/pricing.ts'
import { markVolFromVix } from '../src/backtest/volatility.ts'
import { yearFraction } from '../src/backtest/calendar.ts'

function indexOf(dates: string[]) {
  return new Map(dates.map((d, i) => [d, i]))
}

function params(over: Partial<BacktestParams> = {}): BacktestParams {
  return {
    id: 't',
    dte: 0,
    entryWeekdays: [1, 2, 3, 4, 5],
    tradeFrequency: 'daily',
    frequencyWeekday: 1,
    frequencyMonthWeek: 1,
    strikeMode: 'pct',
    strikeValue: 0,
    width: 50,
    sizing: 'contracts',
    contracts: 1,
    riskBudget: 5000,
    takeProfitOn: false,
    takeProfitPct: 50,
    stopType: 'none',
    stopMultiple: 2,
    startDate: '1990-01-01',
    endDate: '2035-01-01',
    entryMinute: 10 * 60,
    startingCapital: 100_000,
    ...over,
  }
}

function sessions(dates: string[], spot: number, close: number, low = spot - 400): SessionBar[] {
  return dates.map(date => ({
    date,
    open: spot,
    high: Math.max(spot, close) + 10,
    low,
    close,
    vixOpen: 16,
    vixClose: 16,
  }))
}

const put = bsmPut(100, 100, 1, 0, 0, 0.2)
assert.ok(Math.abs(put - 7.965567) < 0.02, `ATM put ${put}`)
assert.ok(bsmPutDelta(100, 100, 1, 0, 0, 0.2) < 0)
assert.ok(Math.abs(skewedIv(20, 100, 97, 2) - 0.26) < 1e-9)
assert.equal(skewedIv(20, 100, 100, 2), 0.2)

assert.equal(weekday(SPXW_SCHEDULE.fridayWeekly), 5)
assert.equal(weekday(SPXW_SCHEDULE.wednesday), 3)
assert.equal(weekday(SPXW_SCHEDULE.monday), 1)
assert.equal(weekday(SPXW_SCHEDULE.tuesday), 2)
assert.equal(weekday(SPXW_SCHEDULE.thursday), 4)
assert.equal(thirdFriday(2013, 3), SPXW_SCHEDULE.thirdFridayPm)

// Daily era: the requested session is the expiry.
{
  const dates = weekdaySessions('2024-06-10', '2024-06-17')
  const expiries = buildExpiries(dates)
  const idx = indexOf(dates)
  for (const date of dates) {
    const resolved = resolveExpiry(dates, idx, expiries, date, 0)
    assert.ok(resolved)
    assert.equal(resolved.expiry.date, date)
    assert.equal(resolved.actualDte, 0)
    assert.equal(resolved.expiry.settle, 'pm')
  }
  const fri = dates.find(d => weekday(d) === 5)
  assert.ok(fri)
  const next = resolveExpiry(dates, idx, expiries, fri, 1)
  assert.ok(next)
  assert.equal(weekday(next.expiry.date), 1)
  assert.equal(next.actualDte, 1)
}

// Mon/Wed/Fri era: a Tuesday 0DTE request snaps to Wednesday.
{
  const dates = weekdaySessions('2018-06-04', '2018-06-08')
  const tue = dates.find(d => weekday(d) === 2)
  assert.ok(tue)
  const expiries = buildExpiries(dates)
  const resolved = resolveExpiry(dates, indexOf(dates), expiries, tue, 0)
  assert.ok(resolved)
  assert.equal(weekday(resolved.expiry.date), 3)
  assert.equal(resolved.actualDte, 1)
  assert.equal(resolved.expiry.settle, 'pm')
}

// Friday-weekly era: Tuesday snaps to Friday, and that contract is still modeled AM.
{
  const dates = weekdaySessions('2012-06-04', '2012-06-08')
  const tue = dates.find(d => weekday(d) === 2)
  assert.ok(tue)
  const resolved = resolveExpiry(dates, indexOf(dates), buildExpiries(dates), tue, 0)
  assert.ok(resolved)
  assert.equal(weekday(resolved.expiry.date), 5)
  assert.equal(resolved.actualDte, 3)
  assert.equal(resolved.expiry.settle, 'am')
}

// Before weeklies, only the monthly third Friday.
{
  const dates = weekdaySessions('2000-06-01', '2000-06-30')
  const monthly = thirdFriday(2000, 6)
  const expiries = buildExpiries(dates)
  const have = new Set(expiries.map(e => e.date))
  for (const date of dates) {
    if (weekday(date) !== 5) continue
    assert.equal(have.has(date), date === monthly)
  }
  const tue = dates.find(d => weekday(d) === 2 && d < monthly)
  assert.ok(tue)
  const resolved = resolveExpiry(dates, indexOf(dates), expiries, tue, 0)
  assert.ok(resolved)
  assert.equal(resolved.expiry.date, monthly)
  assert.ok(resolved.actualDte > 1)
  assert.equal(resolved.expiry.settle, 'am')
}

// Monday weeklies start 2016-08-22. The Monday before snaps forward.
{
  assert.equal(weekday('2016-08-15'), 1)
  assert.equal(weekday('2016-08-22'), 1)
  const early = weekdaySessions('2016-08-15', '2016-08-19')
  const earlyHit = resolveExpiry(early, indexOf(early), buildExpiries(early), '2016-08-15', 0)
  assert.ok(earlyHit)
  assert.equal(weekday(earlyHit.expiry.date), 3)
  const live = weekdaySessions('2016-08-22', '2016-08-26')
  const liveHit = resolveExpiry(live, indexOf(live), buildExpiries(live), '2016-08-22', 0)
  assert.ok(liveHit)
  assert.equal(liveHit.expiry.date, '2016-08-22')
  assert.equal(liveHit.actualDte, 0)
}

// Holiday shifts: Monday weeklies move forward, Friday weeklies move back.
{
  assert.equal(weekday('2019-05-27'), 1)
  const memorial = weekdaySessions('2019-05-24', '2019-05-31', ['2019-05-27'])
  assert.ok(buildExpiries(memorial).some(e => e.date === '2019-05-28'))
  assert.equal(weekday('2019-04-19'), 5)
  const goodFriday = weekdaySessions('2019-04-15', '2019-04-23', ['2019-04-19'])
  assert.ok(buildExpiries(goodFriday).some(e => e.date === '2019-04-18'))
}

// Expiring above the short strike keeps the whole credit, even if the daily low went through the long strike.
{
  const dates = weekdaySessions('2024-06-12', '2024-06-12')
  assert.equal(dates.length, 1)
  const spot = 5400
  const result = runBacktest(sessions(dates, spot, 5450, 5000), null, params())
  assert.equal(result.trades.length, 1)
  const trade = result.trades[0]
  assert.equal(trade.exitReason, 'expiry')
  assert.equal(trade.stopBasis, 'close')
  assert.equal(trade.actualDte, 0)
  assert.equal(trade.expiryDate, trade.entryDate)
  assert.ok(Math.abs(trade.pnl - trade.netCredit * 100) < 1e-6)
  assert.ok(trade.pnl > 0)
  assert.equal(trade.shortK, 5400)
  assert.equal(trade.longK, 5350)
}

// Settlement through the long strike loses width minus the credit collected.
{
  const dates = weekdaySessions('2024-06-12', '2024-06-12')
  const result = runBacktest(sessions(dates, 5400, 5000, 4900), null, params())
  const trade = result.trades[0]
  assert.equal(trade.exitReason, 'expiry')
  const loss = (trade.shortK - trade.longK - trade.netCredit) * 100
  assert.ok(Math.abs(trade.pnl + loss) < 1e-6)
  assert.ok(trade.pnl < 0)
}

// Net credit is positive for ATM 0DTE with default hidden slippage.
{
  const dates = weekdaySessions('2024-06-12', '2024-06-12')
  const result = runBacktest(sessions(dates, 5400, 5450), null, params())
  assert.ok(result.trades[0].netCredit > 0)
  assert.ok(result.trades[0].netCredit < result.trades[0].modelCredit)
}

// A daily low through the short strike does not stop a close-based trade.
// The same low on a 5-minute bar does.
{
  const dates = weekdaySessions('2024-06-12', '2024-06-12')
  const daily = runBacktest(sessions(dates, 5400, 5450, 5000), null, params({ stopType: 'strike' }))
  assert.equal(daily.trades[0].exitReason, 'expiry')
  assert.ok(daily.trades[0].pnl > 0)

  const bars: IntradayBar[] = [
    { minute: 30, open: 5400, high: 5404, low: 5390, close: 5398 },
    { minute: 60, open: 5440, high: 5460, low: 5435, close: 5450 },
  ]
  const intra = runBacktest(
    sessions(dates, 5400, 5450, 5000),
    new Map([[dates[0], bars]]),
    params({ stopType: 'strike' }),
  )
  assert.equal(intra.trades[0].exitReason, 'stop-strike')
  assert.equal(intra.trades[0].stopBasis, 'intraday')
  assert.ok(intra.trades[0].pnl < daily.trades[0].pnl)
}

// Take-profit buys the spread back before expiry and does not keep the full credit.
{
  const dates = weekdaySessions('2024-06-12', '2024-06-12')
  const bars: IntradayBar[] = [
    { minute: 30, open: 5400, high: 5408, low: 5398, close: 5404 },
    { minute: 90, open: 5420, high: 5700, low: 5415, close: 5600 },
    { minute: 150, open: 5600, high: 5610, low: 5590, close: 5605 },
  ]
  const held = runBacktest(sessions(dates, 5400, 5450), new Map([[dates[0], bars]]), params())
  const tp = runBacktest(
    sessions(dates, 5400, 5450),
    new Map([[dates[0], bars]]),
    params({ takeProfitOn: true, takeProfitPct: 50 }),
  )
  assert.equal(tp.trades[0].exitReason, 'take-profit')
  assert.ok(tp.trades[0].pnl > 0)
  assert.ok(tp.trades[0].pnl < held.trades[0].pnl)
}

// A close-based multiple stop fires on the way to expiry and does not get the recovery.
{
  const dates = weekdaySessions('2024-06-10', '2024-06-14').slice(0, 2)
  const bars = dates.map((date, i) => ({
    date,
    open: 5400,
    high: 5450,
    low: i === 0 ? 5050 : 5300,
    close: i === 0 ? 5100 : 5500,
    vixOpen: 16,
    vixClose: 16,
  }))
  const result = runBacktest(bars, null, params({ dte: 1, stopType: 'multiple', stopMultiple: 2 }))
  const first = result.trades.find(t => t.entryDate === dates[0])
  assert.ok(first)
  assert.equal(first.exitReason, 'stop-multiple')
  assert.equal(first.stopBasis, 'close')
  assert.equal(first.exitDate, dates[0])
  assert.ok(first.pnl < 0)
  assert.notEqual(first.expiryDate, first.exitDate)
}

// Deep OTM collects less credit than ATM on the same day.
{
  const dates = weekdaySessions('2024-06-12', '2024-06-12')
  const atm = runBacktest(sessions(dates, 5400, 5400, 5380), null, params())
  const otm = runBacktest(sessions(dates, 5400, 5400, 5380), null, params({ strikeMode: 'pct', strikeValue: -3 }))
  assert.ok(atm.trades.length === 1)
  assert.ok(atm.trades[0].netCredit > 0.5)
  const otmCredit = otm.trades[0]?.modelCredit ?? otm.meanRejectedCredit ?? 0
  assert.ok(otmCredit < atm.trades[0].modelCredit)
}

// Width-scaled slippage keeps narrow spreads from paying the full 50-wide haircut.
{
  const dates = weekdaySessions('2024-06-10', '2024-08-09')
  const wide = runBacktest(sessions(dates, 5400, 5400, 5200), null, params({ dte: 30, width: 50 }))
  const narrow = runBacktest(sessions(dates, 5400, 5400, 5200), null, params({ dte: 30, width: 5, strikeMode: 'pct', strikeValue: -3 }))
  assert.ok(wide.trades.length >= 1)
  assert.ok(narrow.trades.length >= 1)
  const w0 = wide.trades[0]
  const n0 = narrow.trades[0]
  assert.ok(w0.modelCredit - w0.netCredit > 0.09)
  assert.ok(n0.modelCredit - n0.netCredit <= 0.02)
  assert.ok(n0.netCredit >= n0.modelCredit * 0.75)
}

// Trade frequency throttles entries (daily vs weekly / monthly).
{
  const dates = weekdaySessions('2024-06-10', '2024-06-14') // Mon–Fri
  const bars = sessions(dates, 5400, 5450)
  const daily = runBacktest(bars, null, params())
  assert.equal(daily.trades.length, 5)

  const weekly = runBacktest(bars, null, params({ tradeFrequency: 'weekly', frequencyWeekday: 1 }))
  assert.equal(weekly.trades.length, 1)
  assert.equal(weekday(weekly.trades[0].entryDate), 1)

  const may = weekdaySessions('2019-05-01', '2019-05-31', ['2019-05-06'])
  const monthly = runBacktest(sessions(may, 5400, 5450), null, params({
    tradeFrequency: 'monthly',
    frequencyMonthWeek: 1,
    frequencyWeekday: 1,
    startDate: '2019-05-01',
    endDate: '2019-05-31',
  }))
  assert.equal(monthly.trades.length, 1)
  assert.equal(monthly.trades[0].entryDate, '2019-05-07')
}

// 60 DTE 25-wide credits at VIX ~16: ATM net ~$9 after width-scaled slippage (engine expiry + clock).
{
  const spot = 5560
  const width = 25
  const shortK = roundStrike(spot)
  const longK = shortK - width
  const slip = HIDDEN_DEFAULTS.slippage * (width / 50)
  const dates = weekdaySessions('2024-03-01', '2024-12-31')
  const idx = indexOf(dates)
  const resolved = resolveExpiry(dates, idx, buildExpiries(dates), '2024-08-19', 60)
  assert.ok(resolved)
  const settleClock = resolved.expiry.settle === 'am' ? 9 * 60 + 30 : 16 * 60
  const t = yearFraction('2024-08-19', 10 * 60, resolved.expiry.date, settleClock)
  const r = HIDDEN_DEFAULTS.ratePct / 100
  const q = HIDDEN_DEFAULTS.divPct / 100
  const skew = HIDDEN_DEFAULTS.skewPerPct
  const vol = markVolFromVix(16, resolved.actualDte)
  const atmNet = spreadMark(spot, shortK, longK, t, r, q, vol, skew) - slip
  assert.ok(atmNet >= 8.85 && atmNet <= 9.15, `60 DTE ATM net credit ${atmNet}`)
  const shortOtm = roundStrike(spot * 0.97)
  const otmNet = spreadMark(spot, shortOtm, shortOtm - width, t, r, q, vol, skew) - slip
  assert.ok(otmNet > 1 && otmNet < atmNet, `OTM ${otmNet} vs ATM ${atmNet}`)
  assert.ok(otmNet >= 5 && otmNet <= 7, `60 DTE -3% net credit ${otmNet}`)
}

// Backtest marks use VIX (not trailing realized) on a calm tape with low realized vol.
{
  const dates = weekdaySessions('2024-03-01', '2024-12-31')
  const bars: SessionBar[] = dates.map(date => ({
    date,
    open: 5560,
    high: 5570,
    low: 5555,
    close: 5560,
    vixOpen: 16,
    vixClose: 16,
  }))
  const wide = runBacktest(bars, null, params({
    dte: 60,
    width: 25,
    strikeMode: 'pct',
    strikeValue: 0,
    takeProfitOn: false,
    stopType: 'none',
    startDate: '2024-08-19',
    endDate: '2024-12-31',
  }))
  const atmTrade = wide.trades.find(t => t.entryDate === '2024-08-19')
  assert.ok(atmTrade, `trades ${wide.trades.length}`)
  assert.ok(atmTrade!.netCredit >= 8.85 && atmTrade!.netCredit <= 9.15, `net credit ${atmTrade!.netCredit}`)
  const otm = runBacktest(bars, null, params({
    dte: 60,
    width: 25,
    strikeMode: 'pct',
    strikeValue: -3,
    takeProfitOn: false,
    stopType: 'none',
    startDate: '2024-08-19',
    endDate: '2024-12-31',
  }))
  const otmTrade = otm.trades.find(t => t.entryDate === '2024-08-19')
  assert.ok(otmTrade)
  assert.ok(otmTrade!.netCredit < atmTrade!.netCredit)
  assert.ok(otmTrade!.netCredit >= 5)
}

console.log('backtest-engine.test.ts ok')
