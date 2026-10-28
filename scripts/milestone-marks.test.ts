/**
 * Chart marks use the same compound crossing as the A$1M / A$5M / A$10M cards.
 * Run with: npm test
 */
import { milestoneChartMarks, projectMilestone } from '../src/components/dashboard/milestonePace'
import { MILESTONES } from '../src/components/dashboard/milestoneYears'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const today = new Date(2026, 9, 28)
const start = 462_000

const oneMillion = projectMilestone(start, 1_000_000, 0.3, today)
const expectedYears = Math.log(1_000_000 / start) / Math.log(1.3)
check('1M at 30% is the compound year count', oneMillion.years != null && Math.abs(oneMillion.years - expectedYears) < 1e-9)
check('1M label is the month that year count lands on', oneMillion.label === 'Oct 2029')

const marks = milestoneChartMarks({
  startCapital: start,
  targetAnnual: 0.3,
  paceAnnual: 0.49,
  numYears: 15,
  today,
  milestones: MILESTONES,
})
check('six marks when both series reach every level', marks.length === 6, String(marks.length))
check('labels name the series and the level', marks.some(m => m.text === 'Target 1M') && marks.some(m => m.text === 'Pace 10M'))
const paceFive = projectMilestone(start, 5_000_000, 0.49, today)
const paceFiveMark = marks.find(m => m.id === 'pace-5000000')
check(
  'a mark year matches the card projection',
  paceFive.years != null && paceFiveMark != null && paceFiveMark.years === paceFive.years && paceFiveMark.title.includes(paceFive.label),
  `${paceFiveMark?.years} vs ${paceFive.years} ${paceFive.label}`,
)

const shortWindow = milestoneChartMarks({
  startCapital: start,
  targetAnnual: 0.3,
  paceAnnual: 0.3,
  numYears: 8,
  today,
  milestones: MILESTONES,
})
check('a level past the window is left off', shortWindow.every(m => m.aud === 1_000_000), shortWindow.map(m => m.text).join(','))
check('matching pace and target still mark both series', shortWindow.filter(m => m.aud === 1_000_000).length === 2)

const already = milestoneChartMarks({
  startCapital: 2_000_000,
  targetAnnual: 0.3,
  paceAnnual: 0.3,
  numYears: 15,
  today,
  milestones: MILESTONES,
})
check('a level the line already starts above is not a future crossing', already.every(m => m.aud !== 1_000_000))
check('higher levels are still marked', already.some(m => m.text === 'Target 5M') && already.some(m => m.text === 'Pace 10M'))

const flat = projectMilestone(start, 1_000_000, 0, today)
check('a rate that cannot compound has no year count', flat.years == null && flat.label === '—')

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('milestone marks ok')
