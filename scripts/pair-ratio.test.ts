import assert from 'node:assert/strict'
import { autoBands, bandSignals, buildRatio, rangePosition, zScore } from '../src/components/pairs/ratio.ts'

const day = (iso: string) => Math.floor(Date.parse(iso + 'T14:30:00Z') / 1000)

const a = {
  t: [day('2024-01-02'), day('2024-01-03'), day('2024-01-04'), day('2024-01-05')],
  c: [200, 210, 190, 220],
}
const b = {
  t: [day('2024-01-02'), day('2024-01-03'), day('2024-01-06'), day('2024-01-04')],
  c: [100, 100, 50, 100],
}

const points = buildRatio(a, b)
assert.equal(points.length, 3)
assert.equal(points[0].date, '2024-01-02')
assert.equal(points[0].ratio, 2)
assert.equal(points[2].date, '2024-01-04')
assert.equal(points[2].ratio, 1.9)

const series = Array.from({ length: 20 }, (_, i) => ({ t: i, date: `d${i}`, ratio: i + 1 }))
const bands = autoBands(series)
assert.ok(bands)
assert.ok(bands.top > bands.bottom)
assert.ok(bands.top < 20)
assert.ok(bands.bottom > 1)

const sigs = bandSignals(
  [{ t: 1, date: 'a', ratio: 5 }, { t: 2, date: 'b', ratio: 11 }, { t: 3, date: 'c', ratio: 12 }, { t: 4, date: 'd', ratio: 4 }],
  { top: 10, bottom: 4 },
)
assert.deepEqual(sigs.map(s => s.side), ['top', 'bottom'])

assert.equal(rangePosition(7, { top: 10, bottom: 4 }), 50)
const z = zScore(10, [8, 9, 10, 11, 12])
assert.ok(z != null && Math.abs(z) < 0.01)

console.log('pair-ratio.test.ts ok')
