/**
 * Overview tab — the account's landing page. Key summary stats (moved here
 * from Journal Overview), the Flex Web Service sync + statement upload
 * controls (moved here from Reports), and a metrics/charts strip: win rate,
 * a monthly realized-P&L bar chart, and the current portfolio allocation
 * pie.
 */
import type { AppState } from '../../types'
import type { Account } from '../../store/accountsStore'
import { buildJournalPositions, buildStockPositions } from '../../engine/journal'
import { PortfolioSummaryPanel, AllocationPieCard } from '../analytics/AnalyticsView'
import AccountUploadBar from '../shared/AccountUploadBar'
import FlexSyncBar from '../shared/FlexSyncBar'

function fmtDollar(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function fmt(n: number): string {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/** IBKR dates come as raw "YYYYMMDD" — plain string slicing is enough, no Date parsing needed. */
function monthKey(dateStr: string): string {
  const d = /^\d{8}$/.test(dateStr) ? dateStr : dateStr.replace(/-/g, '')
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}` : ''
}
function fmtMonthShort(ym: string) {
  const [y, m] = ym.split('-')
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MONTHS[parseInt(m, 10) - 1] ?? m} ${y.slice(2)}`
}
function fmtMonthFull(ym: string) {
  const [y, m] = ym.split('-')
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${MONTHS[parseInt(m, 10) - 1] ?? ym} ${y}`
}

/** Realized P&L by close month, most recent 8 months — same bar-chart shape
 * as the old Monthly Cash Flow chart, but driven off actual closed-position
 * P&L (buildJournalPositions/buildStockPositions) rather than raw trade cash
 * flow, so it agrees with the Win Rate/Reports numbers next to it. */
function MonthlyPnlChart({ state }: { state: AppState }) {
  const closed = [
    ...buildJournalPositions(state.sync.trades, {}),
    ...buildStockPositions(state.sync.trades, {}),
  ].filter(p => p.status !== 'Active' && p.pnl != null && p.dateClosed)

  const byMonth = new Map<string, number>()
  for (const p of closed) {
    const key = monthKey(p.dateClosed!)
    if (!key) continue
    byMonth.set(key, (byMonth.get(key) ?? 0) + p.pnl!)
  }
  const rows = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8)
  if (rows.length === 0) return <div className="db-empty-msg" style={{ minHeight: 140 }}>No closed trades yet</div>

  const W = 380, H = 178, PL = 42, PR = 8, PT = 22, PB = 26
  const maxAbs = Math.max(...rows.map(([, v]) => Math.abs(v)), 1)
  const y0 = PT + (H - PT - PB) / 2
  const LABEL_ROOM = 16
  const halfHeight = (H - PT - PB) / 2 - LABEL_ROOM
  const scale = halfHeight / maxAbs
  const bw = (W - PL - PR) / rows.length
  const total = rows.reduce((s, [, v]) => s + v, 0)

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px 2px', fontFamily: 'Inter, sans-serif' }}>
        <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Last {rows.length} months</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: total >= 0 ? '#10b981' : '#ef4444' }}>
          Net {total >= 0 ? '+' : ''}{fmtDollar(total)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        <line x1={PL} x2={W - PR} y1={PT} y2={PT} stroke="var(--border-light)" strokeWidth="0.5" strokeDasharray="2,2" />
        <line x1={PL} x2={W - PR} y1={y0} y2={y0} stroke="var(--border-light)" strokeWidth="1" />
        <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} stroke="var(--border-light)" strokeWidth="0.5" strokeDasharray="2,2" />
        <text x={PL - 6} y={PT + 3} textAnchor="end" fill="var(--text-4)" fontSize="9" fontFamily="Inter, sans-serif">{fmtDollar(maxAbs)}</text>
        <text x={PL - 6} y={y0 + 3} textAnchor="end" fill="var(--text-4)" fontSize="9" fontFamily="Inter, sans-serif">$0</text>
        <text x={PL - 6} y={H - PB + 3} textAnchor="end" fill="var(--text-4)" fontSize="9" fontFamily="Inter, sans-serif">-{fmtDollar(maxAbs)}</text>
        {rows.map(([key, val], i) => {
          const h = Math.abs(val) * scale
          const bx = PL + i * bw + bw * 0.2
          const by = val >= 0 ? y0 - h : y0
          const labelY = val >= 0 ? by - 4 : by + h + 10
          return (
            <g key={key}>
              <rect x={bx} y={by} width={bw * 0.6} height={Math.max(h, 1)} rx={2}
                fill={val >= 0 ? '#10b981' : '#ef4444'} opacity={0.85}>
                <title>{fmtMonthFull(key)}: {val >= 0 ? '+' : ''}{fmtDollar(val)}</title>
              </rect>
              <text x={bx + bw * 0.3} y={labelY} textAnchor="middle" fill={val >= 0 ? '#10b981' : '#ef4444'} fontSize="8" fontWeight="600" fontFamily="Inter, sans-serif">
                {val >= 0 ? '+' : '-'}{fmt(Math.abs(val))}
              </text>
              <text x={bx + bw * 0.3} y={H - 6} textAnchor="middle" fill="var(--text-4)" fontSize="9" fontFamily="Inter, sans-serif">
                {fmtMonthShort(key)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Win rate + winners/losers strip — same closed-position set the Companies
 * (Reports) "All Time" mini strip uses, so the numbers agree with Reports. */
function WinRateCard({ state }: { state: AppState }) {
  const closed = [
    ...buildJournalPositions(state.sync.trades, {}),
    ...buildStockPositions(state.sync.trades, {}),
  ].filter(p => p.status !== 'Active' && p.pnl != null)

  const wins = closed.filter(p => p.pnl! > 0).length
  const losses = closed.filter(p => p.pnl! < 0).length
  const decided = wins + losses
  const winRate = decided > 0 ? (wins / decided) * 100 : 0
  const winRateColor = winRate >= 70 ? '#10b981' : winRate >= 50 ? '#f59e0b' : '#ef4444'

  return (
    <div className="dash-panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="dash-panel-header" style={{ padding: '8px 8px 0' }}><span>Win Rate</span></div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '10px 0 16px' }}>
        <div style={{ fontSize: 34, fontWeight: 800, fontFamily: 'Inter, sans-serif', color: winRateColor }}>
          {decided > 0 ? `${winRate.toFixed(0)}%` : '—'}
        </div>
        <div style={{ display: 'flex', gap: 18, fontSize: 12, fontFamily: 'Inter, sans-serif' }}>
          <span style={{ color: '#10b981', fontWeight: 600 }}>{wins} wins</span>
          <span style={{ color: 'var(--text-4)' }}>{closed.length} closed</span>
          <span style={{ color: '#ef4444', fontWeight: 600 }}>{losses} losses</span>
        </div>
      </div>
    </div>
  )
}

export default function OverviewView({ state, account, loading, error, onUpload, onClear, onSyncFlex }: {
  state: AppState
  account: Account
  loading: boolean
  error: string | null
  onUpload: (file: File) => void | Promise<void>
  onClear: () => void
  onSyncFlex: (token: string, queryId: string) => void
}) {
  const hasData = state.sync.trades.length > 0

  return (
    <div className="jr-root" style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <FlexSyncBar
        savedToken={account.flexToken}
        savedQueryId={account.flexQueryId}
        loading={loading}
        error={error}
        onSync={onSyncFlex}
      />
      <AccountUploadBar
        label={account.name}
        fileName={account.fileName}
        uploadedAt={account.uploadedAt}
        loading={loading}
        error={error}
        onUpload={onUpload}
        onClear={onClear}
      />

      {!hasData ? (
        <div className="db-empty-msg" style={{ flex: 1 }}>
          No trade data — sync IBKR Flex or upload a statement to get started
        </div>
      ) : (
        <>
          <PortfolioSummaryPanel state={state} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1.4fr', gap: 12 }}>
            <WinRateCard state={state} />
            <div className="dash-panel">
              <div className="dash-panel-header"><span>Monthly Realised P&amp;L</span></div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
                <MonthlyPnlChart state={state} />
              </div>
            </div>
            <AllocationPieCard state={state} />
          </div>
        </>
      )}
    </div>
  )
}
