import { useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw, Save, Trash2 } from 'lucide-react'
import ConfigCard from './ConfigCard'
import { EquityChart, type EquityCurve } from './BacktestCharts'
import { SCENARIO_COLORS, defaultParams, shortLabel } from '../../backtest/defaults'
import { runBacktest, type BacktestParams, type BacktestResult, type Trade } from '../../backtest/engine'
import { money, pct, tradesToCsv } from '../../backtest/format'
import { fetchNewerBars, loadMarket, type MarketBundle } from '../../backtest/load'
import { mergeDailyBars, tupleToSession } from '../../backtest/series'
import { addSavedRun, deleteSavedRun, loadSavedRuns, type SavedRun } from '../../backtest/savedRuns'
import { useThemeStore } from '../../store/themeStore'

type PageMode = 'run' | 'compare'
type SortKey = 'entryDate' | 'exitDate' | 'expiryDate' | 'actualDte' | 'netCredit' | 'exitDebit' | 'pnl'

function spot(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function sprd(n: number): string {
  return n.toFixed(2)
}

function signed(n: number): string {
  return n < 0 ? 'bt-neg' : n > 0 ? 'bt-pos' : ''
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bt-stat bt-stat-compact">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  )
}

export default function BacktestView() {
  const { theme } = useThemeStore()
  const [page, setPage] = useState<PageMode>('run')
  const [config, setConfig] = useState<BacktestParams>(() => defaultParams())
  const [market, setMarket] = useState<MarketBundle | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'entryDate', dir: 1 })
  const [saved, setSaved] = useState<SavedRun[]>(() => loadSavedRuns())
  const [saveName, setSaveName] = useState('')
  const [showSave, setShowSave] = useState(false)
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancel = false
    loadMarket()
      .then(bundle => { if (!cancel) setMarket(bundle) })
      .catch(err => { if (!cancel) setLoadError(err instanceof Error ? err.message : 'Could not load market data') })
    return () => { cancel = true }
  }, [])

  const result = useMemo(() => {
    if (!market) return null
    return runBacktest(market.sessions, market.intra, config)
  }, [market, config])

  const compareResults = useMemo(() => {
    if (!market || page !== 'compare') return []
    const picked = saved.filter(r => compareIds.has(r.id))
    return picked.map((run, i) => ({
      run,
      color: SCENARIO_COLORS[i % SCENARIO_COLORS.length],
      result: runBacktest(market.sessions, market.intra, run.params),
    }))
  }, [market, page, saved, compareIds])

  const sortedTrades = useMemo(() => {
    if (!result) return []
    const copy = [...result.trades]
    copy.sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (av < bv) return -1 * sort.dir
      if (av > bv) return 1 * sort.dir
      return 0
    })
    return copy
  }, [result, sort])

  const equityCurve = useMemo<EquityCurve[]>(() => {
    if (!result) return []
    return [{
      name: shortLabel(config),
      color: SCENARIO_COLORS[0],
      points: result.equity.map(p => ({ time: p.date, value: p.equity })),
    }]
  }, [result, config])

  const compareCurves = useMemo<EquityCurve[]>(() => {
    return compareResults.map(({ run, color, result: r }) => ({
      name: run.name,
      color,
      points: r.equity.map(p => ({ time: p.date, value: p.equity })),
    }))
  }, [compareResults])

  function toggleSort(key: SortKey) {
    setSort(prev => prev.key === key ? { key, dir: (prev.dir * -1) as 1 | -1 } : { key, dir: 1 })
  }

  async function onUpdate() {
    if (!market || updating) return
    setUpdating(true)
    setUpdateMsg(null)
    const res = await fetchNewerBars(market.dailyTo)
    if (res.error) {
      setUpdateMsg(res.error)
      setUpdating(false)
      return
    }
    if (res.bars.length === 0) {
      setUpdateMsg('Already up to date.')
      setUpdating(false)
      return
    }
    const bars = mergeDailyBars(market.bars, res.bars)
    const sessions = bars.map(tupleToSession)
    const last = sessions[sessions.length - 1]?.date ?? market.dailyTo
    setMarket({ ...market, bars, sessions, dailyFrom: sessions[0].date, dailyTo: last })
    setUpdateMsg(res.persisted ? `Saved ${res.bars.length} new session${res.bars.length === 1 ? '' : 's'}.` : 'Loaded new sessions for this visit.')
    setUpdating(false)
  }

  function onSave() {
    const name = saveName.trim() || shortLabel(config)
    addSavedRun(name, config)
    setSaved(loadSavedRuns())
    setSaveName('')
    setShowSave(false)
  }

  function toggleCompare(id: string) {
    setCompareIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const summary = result?.summary
  const dataThrough = market?.dailyTo

  return (
    <div className="jr-root bt-page bt-page-compact">
      <header className="bt-header">
        <div>
          <h1>SPX put credit spreads</h1>
        </div>
        <div className="bt-header-actions">
          <div className="bt-mode-tabs" role="tablist" aria-label="Backtest mode">
            <button type="button" role="tab" aria-selected={page === 'run'} className={`bt-chip${page === 'run' ? ' on' : ''}`} onClick={() => setPage('run')}>Run</button>
            <button type="button" role="tab" aria-selected={page === 'compare'} className={`bt-chip${page === 'compare' ? ' on' : ''}`} onClick={() => setPage('compare')}>Compare</button>
          </div>
          {dataThrough && <span className="bt-data-through">Data through {dataThrough}</span>}
          <button type="button" className="bt-btn primary" onClick={onUpdate} disabled={!market || updating}>
            <RefreshCw size={14} className={updating ? 'bt-spin' : ''} />
            {updating ? 'Updating…' : 'Update data'}
          </button>
        </div>
      </header>

      {loadError && <p className="bt-banner">{loadError}</p>}
      {updateMsg && <p className="bt-meta">{updateMsg}</p>}
      {!market && !loadError && <p className="bt-meta">Loading market history…</p>}

      {page === 'run' && (
        <div className="bt-one-screen">
          <ConfigCard config={config} onChange={setConfig} />
          {result && market && (
            <RunResults
              config={config}
              result={result}
              summary={summary}
              equityCurve={equityCurve}
              sortedTrades={sortedTrades}
              sort={sort}
              onSort={toggleSort}
              theme={theme}
              showSave={showSave}
              saveName={saveName}
              onSaveName={setSaveName}
              onToggleSave={() => setShowSave(v => !v)}
              onSave={onSave}
              onReset={() => setConfig(defaultParams())}
            />
          )}
        </div>
      )}

      {page === 'compare' && market && (
        <div className="bt-compare-panel">
          <p className="bt-hint">Select two or more saved runs to compare.</p>
          <ul className="bt-saved-list">
            {saved.length === 0 && <li className="bt-hint">No saved runs yet. Use Run → Save.</li>}
            {saved.map(run => (
              <li key={run.id}>
                <label className="bt-saved-row">
                  <input type="checkbox" checked={compareIds.has(run.id)} onChange={() => toggleCompare(run.id)} />
                  <span className="bt-saved-name">{run.name}</span>
                  <span className="bt-saved-meta">{shortLabel(run.params)}</span>
                  <button type="button" className="bt-text-btn" aria-label="Delete" onClick={() => {
                    deleteSavedRun(run.id)
                    setSaved(loadSavedRuns())
                    setCompareIds(prev => { const n = new Set(prev); n.delete(run.id); return n })
                  }}><Trash2 size={14} /></button>
                </label>
              </li>
            ))}
          </ul>

          {compareResults.length >= 2 && (
            <>
              <div className="bt-table-wrap">
                <table className="bt-table bt-compare-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Trades</th>
                      <th>Win rate</th>
                      <th>Total P&L</th>
                      <th>Max drawdown</th>
                      <th>Avg P&L / trade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareResults.map(({ run, result: r }) => {
                      const s = r.summary
                      return (
                        <tr key={run.id}>
                          <td>{run.name}</td>
                          <td>{s.trades}</td>
                          <td>{pct(s.winRate)}</td>
                          <td className={signed(s.totalPnl)}>{money(s.totalPnl)}</td>
                          <td>{s.trades ? money(s.maxDrawdown) : '—'}</td>
                          <td className={s.avgPnl == null ? '' : signed(s.avgPnl)}>{s.avgPnl == null ? '—' : money(s.avgPnl)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="bt-card bt-chart-card">
                <div className="cc-section-title" style={{ padding: 0 }}>Equity</div>
                <EquityChart theme={theme} curves={compareCurves} />
                <div className="bt-legend">
                  {compareCurves.map(curve => (
                    <span key={curve.name}><i style={{ background: curve.color }} />{curve.name}</span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function RunResults({
  config,
  result,
  summary,
  equityCurve,
  sortedTrades,
  sort,
  onSort,
  theme,
  showSave,
  saveName,
  onSaveName,
  onToggleSave,
  onSave,
  onReset,
}: {
  config: BacktestParams
  result: BacktestResult
  summary: BacktestResult['summary'] | undefined
  equityCurve: EquityCurve[]
  sortedTrades: Trade[]
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (key: SortKey) => void
  theme: string
  showSave: boolean
  saveName: string
  onSaveName: (v: string) => void
  onToggleSave: () => void
  onSave: () => void
  onReset: () => void
}) {
  return (
    <div className="bt-results-compact">
      <div className="bt-results-toolbar">
        <button type="button" className="bt-btn" onClick={onReset}>Reset defaults</button>
        <button type="button" className="bt-btn" onClick={onToggleSave}><Save size={14} /> Save</button>
        {showSave && (
          <div className="bt-inline bt-save-row">
            <input className="bt-input" placeholder="Run name" value={saveName} onChange={e => onSaveName(e.target.value)} />
            <button type="button" className="bt-btn primary" onClick={onSave}>Save run</button>
          </div>
        )}
      </div>

      {summary && (
        <div className="bt-stats bt-stats-row">
          <Stat label="Trades" value={String(summary.trades)} />
          <Stat label="Win rate" value={pct(summary.winRate)} />
          <Stat label="Total P&L" value={money(summary.totalPnl)} tone={signed(summary.totalPnl)} />
          <Stat label="Max drawdown" value={summary.trades ? money(summary.maxDrawdown) : '—'} />
          <Stat label="Avg P&L / trade" value={summary.avgPnl == null ? '—' : money(summary.avgPnl)} tone={summary.avgPnl == null ? '' : signed(summary.avgPnl)} />
        </div>
      )}

      <div className="bt-card bt-chart-card bt-chart-compact">
        <EquityChart theme={theme} curves={equityCurve} />
      </div>

      <details className="bt-card bt-trades-details">
        <summary className="bt-trades-summary">
          Trades ({result.trades.length})
          <button
            type="button"
            className="bt-btn bt-csv-btn"
            disabled={result.trades.length === 0}
            onClick={e => {
              e.preventDefault()
              download(`spx-put-spreads-${shortLabel(config).replace(/\s+/g, '-')}.csv`, tradesToCsv(result.trades))
            }}
          >
            <Download size={14} /> CSV
          </button>
        </summary>
        <div className="bt-table-wrap bt-trades">
          <table className="bt-table">
            <thead>
              <tr>
                <SortTh label="Entry" k="entryDate" sort={sort} onSort={onSort} />
                <SortTh label="Exit" k="exitDate" sort={sort} onSort={onSort} />
                <SortTh label="Exp" k="expiryDate" sort={sort} onSort={onSort} />
                <SortTh label="DTE" k="actualDte" sort={sort} onSort={onSort} />
                <th className="bt-tight">K</th>
                <th className="bt-num">SPX₀</th>
                <th className="bt-num">SPX₁</th>
                <SortTh label="Cr" k="netCredit" sort={sort} onSort={onSort} />
                <SortTh label="Db" k="exitDebit" sort={sort} onSort={onSort} />
                <th className="bt-tight">Why</th>
                <SortTh label="P&L" k="pnl" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {sortedTrades.map(trade => (
                <TradeRow key={`${trade.entryDate}-${trade.shortK}-${trade.expiryDate}`} trade={trade} />
              ))}
            </tbody>
          </table>
          {sortedTrades.length === 0 && <p className="bt-hint">No trades in this range.</p>}
        </div>
      </details>
    </div>
  )
}

function SortTh({ label, k, sort, onSort }: { label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (key: SortKey) => void }) {
  const arrow = sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''
  return <th aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => onSort(k)}>{label}{arrow}</button></th>
}

function TradeRow({ trade }: { trade: Trade }) {
  return (
    <tr>
      <td>{trade.entryDate}</td>
      <td>{trade.exitDate}</td>
      <td>{trade.expiryDate}</td>
      <td>{trade.actualDte}</td>
      <td className="bt-tight">{trade.shortK}/{trade.longK}</td>
      <td className="bt-num">{spot(trade.entrySpot)}</td>
      <td className="bt-num">{spot(trade.exitSpot)}</td>
      <td className="bt-num">{sprd(trade.netCredit)}</td>
      <td className="bt-num">{sprd(trade.exitDebit)}</td>
      <td className="bt-tight" title={trade.exitReason}>{trade.exitReason}</td>
      <td className={signed(trade.pnl)}>{money(trade.pnl)}</td>
    </tr>
  )
}
