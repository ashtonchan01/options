/** Per-firm analyst targets must be dated within this window to count. */
export const ANALYST_TARGET_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

export function isWithinAnalystTargetWindow(dateYmd, nowMs = Date.now()) {
  if (!dateYmd || typeof dateYmd !== 'string') return false
  const ts = Date.parse(dateYmd.slice(0, 10))
  if (!Number.isFinite(ts)) return false
  return nowMs - ts <= ANALYST_TARGET_WINDOW_MS
}

export function filterAnalystRowsInWindow(rows, nowMs = Date.now()) {
  return (rows ?? []).filter(r => isWithinAnalystTargetWindow(r.date, nowMs))
}