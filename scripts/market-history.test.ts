import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  joinDaily,
  parseCboeSpx,
  parseCboeVix,
  selectNewBars,
} from '../api/_lib/marketHistory.js'

const spx = parseCboeSpx('DATE,SPX\n11/13/2026,100\n11/16/2026,110\n')
const vix = parseCboeVix('DATE,OPEN,HIGH,LOW,CLOSE\n11/13/2026,1,2,0.5,1.5\n11/16/2026,2,3,1,2.5\n')
assert.equal(spx.get('2026-11-16'), 110)
assert.equal(vix.get('2026-11-13')?.c, 1.5)

const yahoo = new Map([
  ['2026-11-16', { o: 109, h: 112, l: 108, c: 111 }],
])
const joined = joinDaily({ cboeSpx: spx, yahooSpx: yahoo, vix })
const fresh = selectNewBars(joined.bars, '2026-11-13')
assert.equal(fresh.length, 1)
assert.equal(fresh[0][0], '2026-11-16')
assert.equal(fresh[0][4], 110)
assert.equal(fresh[0][1], 109)
assert.equal(selectNewBars(joined.bars, '2026-11-16').length, 0)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const daily = JSON.parse(gunzipSync(readFileSync(join(root, 'public/data/spx_vix_daily.bin'))).toString())
const intra = JSON.parse(gunzipSync(readFileSync(join(root, 'public/data/spx_5min.bin'))).toString())
assert.equal(daily.from, '1990-01-02')
assert.ok(daily.to >= '2026-11-13')
assert.ok(daily.rows > 9000)
assert.equal(daily.bars[0][0], '1990-01-02')
assert.equal(daily.bars.at(-1)[0], daily.to)
assert.ok(daily.bars[0][8] > 0)
assert.equal(intra.from, '2024-03-12')
assert.equal(intra.to, '2026-04-24')
assert.equal(intra.days[0][1][0][0], 0)
assert.equal(intra.days[0][1].at(-1)[0], 385)

console.log('market-history.test.ts ok')
