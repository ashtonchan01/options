import type { IntradayBar, SessionBar } from './engine'

/** [date, spx open, high, low, close, vix open, high, low, close] */
export type DailyTuple = [string, number, number, number, number, number, number, number, number]

export function tupleToSession(row: DailyTuple): SessionBar {
  return {
    date: row[0],
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    vixOpen: row[5],
    vixClose: row[8],
  }
}

/** Later rows replace the same date. Result is sorted. */
export function mergeDailyBars(base: readonly DailyTuple[], extra: readonly DailyTuple[]): DailyTuple[] {
  const map = new Map<string, DailyTuple>()
  for (const row of base) map.set(row[0], row)
  for (const row of extra) {
    if (!row || typeof row[0] !== 'string') continue
    map.set(row[0], row)
  }
  return [...map.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

export function barsToIntraday(days: readonly [string, number[][]][]): Map<string, IntradayBar[]> {
  const map = new Map<string, IntradayBar[]>()
  for (const [date, bars] of days) {
    map.set(date, bars.map(bar => ({
      minute: bar[0],
      open: bar[1],
      high: bar[2],
      low: bar[3],
      close: bar[4],
    })))
  }
  return map
}
