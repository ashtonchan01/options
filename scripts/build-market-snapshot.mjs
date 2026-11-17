/**
 * Rebuild the committed daily and 5-minute snapshots.
 * Run by hand: `node scripts/build-market-snapshot.mjs`
 * Not scheduled. The in-app Update data button only appends newer daily sessions.
 */
import { gzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CBOE_SPX_URL,
  CBOE_VIX_URL,
  fetchText,
  fetchYahoo,
  joinDaily,
  mergeMaps,
  parseCboeSpx,
  parseCboeVix,
} from '../api/_lib/marketHistory.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'data')
const FIVE_MIN_URL = 'https://raw.githubusercontent.com/ashtonchan01/0dte-spx-backtest/main/spx_5min.js'

function r2(n) {
  return Math.round(n * 100) / 100
}

const period1 = 631152000
const period2 = Math.floor(Date.now() / 1000) + 86400

const [spxCsv, vixCsv, yahooSpx, yahooVix, fiveMinJs] = await Promise.all([
  fetchText(CBOE_SPX_URL),
  fetchText(CBOE_VIX_URL),
  fetchYahoo('^GSPC', period1, period2),
  fetchYahoo('^VIX', period1, period2),
  fetchText(FIVE_MIN_URL),
])

const joined = joinDaily({
  cboeSpx: parseCboeSpx(spxCsv),
  yahooSpx,
  vix: mergeMaps(parseCboeVix(vixCsv), yahooVix),
})

const built = new Date().toISOString().slice(0, 10)
const daily = {
  built,
  from: joined.bars[0][0],
  to: joined.bars[joined.bars.length - 1][0],
  rows: joined.bars.length,
  closeOnlyDays: joined.closeOnly,
  outsideRangeKeptYahoo: joined.keptYahoo,
  sources: {
    spxClose: CBOE_SPX_URL,
    spxOhlc: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC',
    vix: CBOE_VIX_URL,
    note: 'Cboe SPX_History.csv publishes the close only. Open, high and low are Yahoo ^GSPC. The close is the Cboe value when it falls inside that Yahoo range. VIX is Cboe VIX_History.csv; a missing latest session can be filled from Yahoo ^VIX.',
  },
  bars: joined.bars,
}

const raw = fiveMinJs.slice(fiveMinJs.indexOf('=') + 1).trim().replace(/;\s*$/, '')
const parsed = JSON.parse(raw)
const dayKeys = Object.keys(parsed).sort()
const days = dayKeys.map(date => [
  date,
  parsed[date].map(bar => [bar[0], r2(bar[1]), r2(bar[2]), r2(bar[3]), r2(bar[4])]),
])
const intraday = {
  source: 'https://github.com/ashtonchan01/0dte-spx-backtest/blob/main/spx_5min.js',
  minuteOrigin: 'minutes after 09:30 America/New_York',
  from: dayKeys[0],
  to: dayKeys[dayKeys.length - 1],
  days,
}

mkdirSync(outDir, { recursive: true })
// Not a .gz suffix: Vercel treats foo.json.gz as a precompressed foo.json and
// refuses the deploy when that uncompressed file is not next to it.
writeFileSync(join(outDir, 'spx_vix_daily.bin'), gzipSync(Buffer.from(JSON.stringify(daily))))
writeFileSync(join(outDir, 'spx_5min.bin'), gzipSync(Buffer.from(JSON.stringify(intraday))))

console.log(`daily ${daily.from} → ${daily.to} (${daily.rows} rows, close-only ${daily.closeOnlyDays}, yahoo-close kept ${daily.outsideRangeKeptYahoo})`)
console.log(`5min ${intraday.from} → ${intraday.to} (${days.length} days)`)
