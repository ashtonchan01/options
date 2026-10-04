/**
 * Checks the ANY 1Y+ combo rules against the LAST / 2ND LAST / 3RD LAST
 * ranking, plus the chain window that feeds them. Run with:
 *   npx tsx scripts/check-any1y.ts
 */
import type { ScanResult } from '../src/types'
import { buildAny1yCombos, buildComboRankings } from '../src/components/opportunities/leapCombos'
import { LEAP_MAX_DTE, processChain } from '../src/services/cboe'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function leg(partial: {
  strategyType: ScanResult['strategyType']
  strike: number
  expiry: string
  dte: number
  mid: number
  stockPrice?: number
  delta?: number
}): ScanResult {
  const mid = partial.mid
  return {
    underlying: 'TST',
    strategyType: partial.strategyType,
    stockPrice: partial.stockPrice ?? 100,
    strike: partial.strike,
    expiry: partial.expiry,
    dte: partial.dte,
    delta: partial.delta ?? (partial.strategyType === 'csp' ? -0.4 : 0.55),
    gamma: 0,
    theta: 0,
    iv: 30,
    ivRank: 50,
    bid: mid * 0.97,
    ask: mid * 1.03,
    mid,
    volume: 20,
    openInterest: 200,
    volumeOiRatio: 0.1,
    annualizedYield: 1,
    score: 50,
    flags: [],
  }
}

/** Build a call and put whose net time value (debit minus intrinsic) is `time`. */
function pricedPair(opts: {
  expiry: string
  dte: number
  callStrike: number
  putStrike: number
  spot: number
  time: number
}): { call: ScanResult; put: ScanResult } {
  const intrinsicPerShare = Math.max(opts.spot - opts.callStrike, 0) - Math.max(opts.putStrike - opts.spot, 0)
  const netPerShare = intrinsicPerShare + opts.time / 100
  const putMid = 8
  const callMid = putMid + netPerShare
  if (callMid <= 0) throw new Error(`call mid ${callMid} for ${opts.expiry}`)
  return {
    call: leg({
      strategyType: 'leap', strike: opts.callStrike, expiry: opts.expiry, dte: opts.dte, mid: callMid, stockPrice: opts.spot,
    }),
    put: leg({
      strategyType: 'csp', strike: opts.putStrike, expiry: opts.expiry, dte: opts.dte, mid: putMid, stockPrice: opts.spot,
    }),
  }
}

const DTE = [400, 600, 800, 1000, 1200]
// Flat term structure except the 600 DTE expiry. That one is interior (it
// has a neighbour on each side) and it is only the 4th furthest, so LAST /
// 2ND LAST / 3RD LAST never show it. Call strike sits above the put, net
// debit is over $10k, and breakeven lands above the stock.
const FAIR_NORM = 900
const CHEAP_NORM = 650
const CHEAP_DTE = 600
function series(callStrike: number, putStrike: number, spot: number) {
  const calls: ScanResult[] = []
  const puts: ScanResult[] = []
  DTE.forEach((dte, i) => {
    const norm = dte === CHEAP_DTE ? CHEAP_NORM : FAIR_NORM
    const pair = pricedPair({
      expiry: `20300${i + 1}15`,
      dte,
      callStrike,
      putStrike,
      spot,
      time: norm * Math.sqrt(dte),
    })
    calls.push(pair.call)
    puts.push(pair.put)
  })
  return { calls, puts }
}

const spot = 100
const violated = series(130, 80, spot)
const flagged = buildAny1yCombos(violated.calls, violated.puts)
const old = buildComboRankings(violated.calls, violated.puts)

check('old ranking drops call-above-put and a debit over $10k', old.length === 0, `got ${old.length}`)
check('ANY 1Y+ still lists that combo', flagged.length >= 1, `got ${flagged.length}`)
check('the listed combo is outside the three furthest expiries', flagged.some(c => c.dte === CHEAP_DTE), flagged.map(c => c.dte).join(','))
check('no row is under 365 DTE', flagged.every(c => c.dte >= 365))
const cheap = flagged.find(c => c.dte === CHEAP_DTE)
check('net debit is over $10k', !!cheap && cheap.comboNetCost > 10_000, String(cheap?.comboNetCost))
check('call strike is above the put', !!cheap && cheap.call.strike > cheap.put.strike)
check('it is a debit, not a required credit', !!cheap && cheap.comboNetCost > 0)
check('breakeven is above the stock and the row is still kept', !!cheap && cheap.comboBreakeven > spot, String(cheap?.comboBreakeven))
check('neighbours are shown', !!cheap && (cheap.termNeighbors?.length ?? 0) >= 2, JSON.stringify(cheap?.termNeighbors))
check(
  'neighbour comparison is the expiries on either side',
  !!cheap && cheap.termNeighbors!.map(n => n.dte).join(',') === '400,800',
  JSON.stringify(cheap?.termNeighbors),
)
check(
  'the row is under the line implied by the other expiries',
  !!cheap && (cheap.termGap ?? 0) >= 0.2 && (cheap.debitPerDay ?? 0) + (cheap.termGap ?? 0) > (cheap.debitPerDay ?? 0),
  `perDay ${cheap?.debitPerDay} gap ${cheap?.termGap} neighbors ${JSON.stringify(cheap?.termNeighbors)}`,
)
check('ranked cheap-first (gap descending)', flagged.every((c, i) => i === 0 || (c.termGap ?? 0) <= (flagged[i - 1].termGap ?? 0)))

const smoothCalls: ScanResult[] = []
const smoothPuts: ScanResult[] = []
for (let i = 0; i < DTE.length; i++) {
  const pair = pricedPair({
    expiry: `20310${i + 1}15`, dte: DTE[i], callStrike: 90, putStrike: 110, spot, time: 100 * Math.sqrt(DTE[i]),
  })
  smoothCalls.push(pair.call)
  smoothPuts.push(pair.put)
}
check('a smooth term structure flags nothing', buildAny1yCombos(smoothCalls, smoothPuts).length === 0)

const onlyTwo = series(130, 80, spot)
check(
  'two expiries are not enough to call a price mismatched',
  buildAny1yCombos(onlyTwo.calls.slice(0, 2), onlyTwo.puts.slice(0, 2)).length === 0,
)

const underYear = pricedPair({
  expiry: '20270615', dte: 200, callStrike: 130, putStrike: 80, spot, time: 100,
})
check(
  'under a year is ignored even if the longer series is cheap',
  buildAny1yCombos([...violated.calls, underYear.call], [...violated.puts, underYear.put]).every(c => c.dte >= 365),
)

// The four existing buttons: a normal synthetic long under the cap still ranks.
const classic = pricedPair({
  expiry: '20280121', dte: 470, callStrike: 100, putStrike: 110, spot: 105, time: 400,
})
const classicRanked = buildComboRankings([classic.call], [classic.put])
check('existing ranking still keeps call-below-put under $10k', classicRanked.length === 1, `net ${classic.comboNetCost ?? (classic.call.mid - classic.put.mid) * 100}`)
check('existing ranking still rejects the call struck above the put', buildComboRankings(
  [{ ...classic.call, strike: 120 }],
  [{ ...classic.put, strike: 90 }],
).length === 0)

// Chain window: a full book includes an expiry past LEAP_MAX_DTE. That
// contract is tagged and must not become "LAST".
function ymd(dte: number): string {
  const dt = new Date(Date.now() + dte * 86400000)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}
function occ(yyyymmdd: string, cp: 'C' | 'P', strike: number): string {
  return `TST${yyyymmdd.slice(2)}${cp}${String(Math.round(strike * 1000)).padStart(8, '0')}`
}
function quote(symbol: string, bid: number, ask: number, delta: number) {
  const mid = (bid + ask) / 2
  return {
    option: symbol, bid, ask, iv: 0.3, volume: 10, open_interest: 50,
    delta, gamma: 0, theta: 0, vega: 0, rho: 0, theo: mid, last_trade_price: mid,
  }
}
const chainDtes = [500, 800, 1500]
const options = chainDtes.flatMap(dte => {
  const exp = ymd(dte)
  return [
    quote(occ(exp, 'C', 100), 20, 20.4, 0.55),
    quote(occ(exp, 'P', 105), 6, 6.2, -0.45),
  ]
})
const processed = processChain(
  { current_price: 100, options },
  'TST',
  { min: 1, max: LEAP_MAX_DTE },
)
const leaps = processed.filter(r => r.strategyType === 'leap')
const farLeaps = leaps.filter(r => r.dte > LEAP_MAX_DTE)
const nearLeaps = leaps.filter(r => r.dte <= LEAP_MAX_DTE)
check('chain keeps a LEAP past the standard ceiling', farLeaps.length > 0, `leaps ${leaps.map(r => r.dte + (r.leapHorizon ?? '')).join(',')}`)
check('that far LEAP is tagged extended', farLeaps.every(r => r.leapHorizon === 'extended'))
check('LEAPs inside the standard ceiling are not tagged', nearLeaps.length > 0 && nearLeaps.every(r => r.leapHorizon == null))
const farPuts = processed.filter(r => r.strategyType === 'csp' && r.dte > LEAP_MAX_DTE)
check('the far put is tagged extended too', farPuts.length > 0 && farPuts.every(r => r.leapHorizon === 'extended'))
const listedExpiries = [...new Set(nearLeaps.map(r => r.expiry))]
  .map(expiry => ({ expiry, dte: nearLeaps.find(r => r.expiry === expiry)!.dte }))
  .sort((a, b) => b.dte - a.dte)
  .slice(0, 3)
check(
  'LAST / 2ND / 3RD do not pick the extended expiry',
  listedExpiries.every(e => e.dte <= LEAP_MAX_DTE) && !farLeaps.some(r => listedExpiries.some(e => e.expiry === r.expiry)),
)

// Live chain: the fetch already contains every listed expiry. ANY 1Y+ must
// be able to use expiries outside the three furthest, and the rows it
// returns have to carry the neighbour comparison.
const liveRes = await fetch('https://cdn.cboe.com/api/global/delayed_quotes/options/NVDA.json')
if (!liveRes.ok) {
  check('live NVDA chain', false, String(liveRes.status))
} else {
  const liveJson = await liveRes.json() as { data: { current_price: number; options: Parameters<typeof processChain>[0]['options'] } }
  const live = processChain(liveJson.data, 'NVDA', { min: 1, max: LEAP_MAX_DTE })
  const liveCalls = live.filter(r => r.strategyType === 'leap')
  const livePuts = live.filter(r => r.strategyType === 'csp')
  const expiryCount = new Set(liveCalls.filter(r => r.dte >= 365 && r.leapHorizon !== 'extended').map(r => r.expiry)).size
  check('live NVDA has more than three 1Y+ expiries in the standard window', expiryCount > 3, String(expiryCount))
  const liveCombos = buildAny1yCombos(
    liveCalls.filter(r => r.dte >= 365),
    livePuts.filter(r => r.dte >= 365),
  )
  check('live combos are all at least 365 DTE', liveCombos.every(c => c.dte >= 365))
  check('live combos are ranked cheap-first', liveCombos.every((c, i) => i === 0 || (c.termGap ?? 0) <= (liveCombos[i - 1].termGap ?? 0)))
  check('every live row shows neighbouring expiries', liveCombos.every(c => (c.termNeighbors?.length ?? 0) >= 1 && c.debitPerDay != null))
  const droppedByOldRules = liveCombos.filter(c => c.call.strike >= c.put.strike || c.comboNetCost > 10_000)
  check(
    'a live row the old strike-order or $10k rule would drop is absent from that ranking',
    droppedByOldRules.length === 0 || droppedByOldRules.every(c => buildComboRankings([c.call], [c.put]).length === 0),
    `${droppedByOldRules.length} of ${liveCombos.length} violate the old gates`,
  )
  console.log(`live NVDA ${liveCombos.length} cheap combos, ${droppedByOldRules.length} outside the old gates`)
  for (const c of liveCombos.slice(0, 5)) {
    const ns = (c.termNeighbors ?? []).map(n => `${n.dte}d ${n.debitPerDay.toFixed(2)}`).join(' · ')
    console.log(`  ${c.call.strike}C/${c.put.strike}P ${c.dte}d net=${c.comboNetCost.toFixed(0)} $${(c.debitPerDay ?? 0).toFixed(2)}/d vs ${ns} gap $${(c.termGap ?? 0).toFixed(2)} bep=${c.comboBreakeven.toFixed(0)}`)
  }
}

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall checks passed')
