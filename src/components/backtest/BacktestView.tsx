import { useEffect, useMemo, useState } from 'react'
import { Download, Plus, RefreshCw } from 'lucide-react'
import ConfigCard from './ConfigCard'
import { EquityChart, SpxChart, type Candle, type EquityCurve, type TradeMark } from './BacktestCharts'
import { SCENARIO_COLORS, sampleConfigs, shortLabel } from '../../backtest/defaults'
import { runBacktests, type BacktestParams, type BacktestResult, type BreakdownRow, type Trade } from '../../backtest/engine'
import { SPXW_SCHEDULE } from '../../backtest/expiries'
import { money, pathNote, pct, profitFactor, pts, riskMultiple, tradesToCsv } from '../../backtest/format'
import { fetchNewerBars, loadMarket, type MarketBundle } from '../../backtest/load'
import { mergeDailyBars, tupleToSession } from '../../backtest/series'
import { useThemeStore } from '../../store/themeStore'

type SortKey = 'entryDate' | 'expiryDate' | 'actualDte' | 'netCredit' | 'pnl' | 'entryVix'

function signed(n: number): string {
  return n < 0 ? 'bt-neg' : n > 0 ? 'bt-pos' : ''
}

function skipText(result: BacktestResult): string | null {
  const s = result.skipped
  const parts: string[] = []
  if (s.credit) {
    const avg = result.meanRejectedCredit == null ? '' : ` (avg model credit ${result.meanRejectedCredit.toFixed(3)} pt)`
    parts.push(`${s.credit} days skipped — credit was at or below slippage${avg}`)
  }
  if (s.vix) parts.push(`${s.vix} outside the VIX filter`)
  if (s.expiry) parts.push(`${s.expiry} with no tradable expiry inside the range`)
  if (s.size) parts.push(`${s.size} that could not be sized`)
  return parts.length ? parts.join(' · ') : null
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
    <div className="bt-stat">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  )
}

function SplitTable({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <div className="bt-card">
      <div className="cc-section-title" style={{ padding: 0 }}>{title}</div>
      {rows.length === 0 ? <p className="bt-hint">No trades.</p> : (
        <table className="bt-table">
          <thead>
            <tr><th>Group</th><th>Trades</th><th>Win rate</th><th>Avg credit</th><th>Avg P&L</th><th>Total</th></tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key}>
                <td>{row.key}</td>
                <td>{row.trades}</td>
                <td>{pct(row.winRate)}</td>
                <td>{pts(row.avgCredit)}</td>
                <td className={row.avgPnl != null ? signed(row.avgPnl) : ''}>{row.avgPnl == null ? '—' : money(row.avgPnl)}</td>
                <td className={signed(row.totalPnl)}>{money(row.totalPnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function BacktestView() {
  const { theme } = useThemeStore()
  const [configs, setConfigs] = useState<BacktestParams[]>(() => sampleConfigs())
  const [selected, setSelected] = useState(0)
  const [market, setMarket] = useState<MarketBundle | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'entryDate', dir: 1 })

  useEffect(() => {
    let cancel = false
    loadMarket()
      .then(bundle => { if (!cancel) setMarket(bundle) })
      .catch(err => { if (!cancel) setLoadError(err instanceof Error ? err.message : 'Could not load market data') })
    return () => { cancel = true }
  }, [])

  const results = useMemo(() => {
    if (!market) return null
    return runBacktests(market.sessions, market.intra, configs)
  }, [market, configs])

  const index = Math.min(selected, Math.max(0, configs.length - 1))
  const active = results?.[index] ?? null
  const activeCfg = configs[index]

  const candles = useMemo<Candle[]>(() => {
    if (!market || !activeCfg) return []
    return market.sessions
      .filter(s => s.date >= activeCfg.startDate && s.date <= activeCfg.endDate)
      .map(s => ({ time: s.date, open: s.open, high: s.high, low: s.low, close: s.close }))
  }, [market, activeCfg])

  const marks = useMemo<TradeMark[]>(() => {
    if (!active) return []
    return active.trades.map(t => ({ time: t.entryDate, win: t.win }))
  }, [active])

  const curves = useMemo<EquityCurve[]>(() => {
    if (!results) return []
    const labels = configs.map(shortLabel)
    return results.map((result, i) => ({
      name: labels.filter(label => label === labels[i]).length > 1 ? `${labels[i]} ${i + 1}` : labels[i],
      color: SCENARIO_COLORS[i % SCENARIO_COLORS.length],
      points: result.equity.map(p => ({ time: p.date, value: p.equity })),
    }))
  }, [results, configs])

  const sortedTrades = useMemo(() => {
    if (!active) return []
    const copy = [...active.trades]
    copy.sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (av < bv) return -1 * sort.dir
      if (av > bv) return 1 * sort.dir
      return 0
    })
    return copy
  }, [active, sort])

  const worst = useMemo(() => {
    if (!active) return []
    return [...active.trades].sort((a, b) => a.pnl - b.pnl).slice(0, 5)
  }, [active])

  function toggleSort(key: SortKey) {
    setSort(prev => prev.key === key ? { key, dir: (prev.dir * -1) as 1 | -1 } : { key, dir: key === 'pnl' ? 1 : 1 })
  }

  async function onUpdate() {
    if (!market || updating) return
    setUpdating(true)
    setUpdateMsg(null)
    const result = await fetchNewerBars(market.dailyTo)
    if (result.error) {
      setUpdateMsg(result.error)
      setUpdating(false)
      return
    }
    if (result.bars.length === 0) {
      setUpdateMsg(`No new daily sessions after ${market.dailyTo}. The 5-minute file is a fixed copy and is not refreshed.`)
      setUpdating(false)
      return
    }
    const bars = mergeDailyBars(market.bars, result.bars)
    const sessions = bars.map(tupleToSession)
    const last = sessions[sessions.length - 1]?.date ?? market.dailyTo
    setMarket({ ...market, bars, sessions, dailyFrom: sessions[0].date, dailyTo: last })
    const saved = result.persisted ? 'Saved' : 'Showing for this session only (the database did not store them)'
    setUpdateMsg(`${saved} ${result.bars.length} new session${result.bars.length === 1 ? '' : 's'} through ${last}. 5-minute bars were not changed.`)
    setUpdating(false)
  }

  function addConfig() {
    const last = configs[configs.length - 1]
    setConfigs([...configs, { ...last, id: crypto.randomUUID() }])
    setSelected(configs.length)
  }

  const summary = active?.summary

  return (
    <div className="jr-root bt-page">
      <header className="bt-header">
        <div>
          <div className="cc-section-title" style={{ padding: 0 }}>Backtest</div>
          <h1>SPX put credit spreads</h1>
        </div>
        <div className="bt-header-actions">
          <button type="button" className="bt-btn" onClick={() => { setConfigs(sampleConfigs()); setSelected(0) }}>Reset sample</button>
          <button type="button" className="bt-btn primary" onClick={onUpdate} disabled={!market || updating}>
            <RefreshCw size={14} className={updating ? 'bt-spin' : ''} />
            {updating ? 'Updating…' : 'Update data'}
          </button>
        </div>
      </header>

      <div className="bt-banner">
        Credits are modelled Black–Scholes estimates, not historical quotes and not fills. IV is that morning’s VIX divided by 100, plus the skew slope. VIX is a 30-day vol, so a 0DTE strike 3% out of the money is many daily standard deviations away and the model credit is usually about zero.
      </div>

      {market && (
        <p className="bt-meta">
          Daily {market.dailyFrom} → {market.dailyTo} (snapshot {market.built}). SPX close is Cboe’s free history; open/high/low are Yahoo ^GSPC because that Cboe file is close-only. VIX is Cboe’s free history from 1990. 5-minute SPX is a copied file from ashtonchan01/0dte-spx-backtest, {market.intraFrom} → {market.intraTo}. Nothing refreshes on a schedule. Update data appends only newer daily sessions, and only while you are signed in.
          {updateMsg && <span className="bt-update">{updateMsg}</span>}
        </p>
      )}
      {loadError && <p className="bt-banner">{loadError}</p>}
      {!market && !loadError && <p className="bt-meta">Loading the saved SPX and VIX history…</p>}

      <div className="bt-workspace">
      <div className="bt-config-col">
      <div className="bt-configs">
        {configs.map((config, i) => (
          <ConfigCard
            key={config.id}
            config={config}
            color={SCENARIO_COLORS[i % SCENARIO_COLORS.length]}
            canRemove={configs.length > 1}
            onChange={next => setConfigs(cs => cs.map(c => c.id === config.id ? next : c))}
            onRemove={() => {
              setConfigs(cs => cs.filter(c => c.id !== config.id))
              setSelected(0)
            }}
          />
        ))}
      </div>
      <button type="button" className="bt-btn" onClick={addConfig} disabled={configs.length >= 8}>
        <Plus size={14} /> Add configuration
      </button>
      </div>

      {results && market && (
        <div className="bt-results">
          <p className="bt-hint">{pathNote(results, market.intraFrom, market.intraTo)}</p>

          <div className="bt-card">
            <div className="cc-section-title" style={{ padding: 0 }}>Comparison</div>
            <div className="bt-table-wrap bt-compare">
              <table className="bt-table">
                <thead>
                  <tr>
                    <th>Configuration</th>
                    <th>Trades</th>
                    <th>Win rate</th>
                    <th>Avg credit</th>
                    <th>Avg P&L</th>
                    <th>Max drawdown</th>
                    <th>Worst trade</th>
                    <th>CAGR</th>
                    <th>P&L / avg risk</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result, i) => {
                    const s = result.summary
                    return (
                      <tr key={configs[i].id} className={i === index ? 'bt-selected' : ''} onClick={() => setSelected(i)}>
                        <td><span className="bt-swatch" style={{ background: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }} />{shortLabel(configs[i])}</td>
                        <td>{s.trades}</td>
                        <td>{pct(s.winRate)}</td>
                        <td>{pts(s.avgCredit)} pt</td>
                        <td className={s.avgPnl == null ? '' : signed(s.avgPnl)}>{s.avgPnl == null ? '—' : money(s.avgPnl)}</td>
                        <td>{s.trades ? `${money(s.maxDrawdown)} (${pct(s.maxDrawdownPct)})` : '—'}</td>
                        <td className={s.worst ? 'bt-neg' : ''}>{s.worst ? `${money(s.worst.pnl)} ${s.worst.entryDate}` : '—'}</td>
                        <td className={s.cagr == null ? '' : signed(s.cagr)}>{pct(s.cagr)}</td>
                        <td className={s.returnOnRisk == null ? '' : signed(s.returnOnRisk)}>{riskMultiple(s.returnOnRisk)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {results.map((result, i) => {
              const text = skipText(result)
              return text ? <p key={configs[i].id} className="bt-hint"><b>{shortLabel(configs[i])}:</b> {text}</p> : null
            })}
          </div>

          <div className="bt-charts">
            <div className="bt-card bt-chart-card">
              <div className="cc-section-title" style={{ padding: 0 }}>SPX · {shortLabel(activeCfg)} entries</div>
              <SpxChart theme={theme} candles={candles} marks={marks} />
            </div>
            <div className="bt-card bt-chart-card">
              <div className="cc-section-title" style={{ padding: 0 }}>Equity</div>
              <EquityChart theme={theme} curves={curves} />
              <div className="bt-legend">
                {curves.map(curve => (
                  <span key={curve.name}><i style={{ background: curve.color }} />{curve.name}</span>
                ))}
              </div>
            </div>
          </div>

          {summary && (
            <div className="bt-stats">
              <Stat label="Trades" value={String(summary.trades)} />
              <Stat label="Win rate" value={pct(summary.winRate)} />
              <Stat label="Avg credit" value={`${pts(summary.avgCredit)} pt`} />
              <Stat label="Avg win" value={summary.avgWin == null ? '—' : money(summary.avgWin)} tone="bt-pos" />
              <Stat label="Avg loss" value={summary.avgLoss == null ? '—' : money(summary.avgLoss)} tone="bt-neg" />
              <Stat label="Expectancy" value={summary.expectancy == null ? '—' : money(summary.expectancy)} tone={summary.expectancy == null ? '' : signed(summary.expectancy)} />
              <Stat label="Profit factor" value={profitFactor(summary.profitFactor)} />
              <Stat label="Max drawdown" value={summary.trades ? money(summary.maxDrawdown) : '—'} />
              <Stat label="CAGR" value={pct(summary.cagr)} tone={summary.cagr == null ? '' : signed(summary.cagr)} />
              <Stat label="Return on capital" value={pct(summary.totalReturn)} tone={summary.totalReturn == null ? '' : signed(summary.totalReturn)} />
              <Stat label="P&L / avg risk" value={riskMultiple(summary.returnOnRisk)} />
              <Stat label="Total P&L" value={money(summary.totalPnl)} tone={signed(summary.totalPnl)} />
            </div>
          )}

          <div className="bt-splits">
            <SplitTable title="By year" rows={active?.byYear ?? []} />
            <SplitTable title="By VIX at entry" rows={active?.byVix ?? []} />
          </div>

          <div className="bt-card">
            <div className="cc-section-title" style={{ padding: 0 }}>Worst trades · {shortLabel(activeCfg)}</div>
            {worst.length === 0 ? <p className="bt-hint">No trades.</p> : (
              <ul className="bt-worst">
                {worst.map(t => (
                  <li key={`${t.entryDate}-${t.shortK}`}>
                    <span>{t.entryDate} → {t.expiryDate}</span>
                    <span>{t.actualDte} DTE</span>
                    <span>{t.shortK}/{t.longK}</span>
                    <span className="bt-neg">{money(t.pnl)}</span>
                    <span>{t.exitReason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bt-card">
            <div className="bt-card-head">
              <div className="cc-section-title" style={{ padding: 0, margin: 0 }}>Trades · {shortLabel(activeCfg)}</div>
              <button
                type="button"
                className="bt-btn"
                disabled={!active || active.trades.length === 0}
                onClick={() => active && download(`spx-put-spreads-${shortLabel(activeCfg).replace(/\s+/g, '-')}.csv`, tradesToCsv(active.trades))}
              >
                <Download size={14} /> CSV
              </button>
            </div>
            <div className="ph-underline-tabs" role="tablist" aria-label="Configuration">
              {configs.map((config, i) => (
                <button key={config.id} type="button" role="tab" aria-selected={i === index} className={`ph-underline-tab${i === index ? ' active' : ''}`} onClick={() => setSelected(i)}>
                  {shortLabel(config)}
                </button>
              ))}
            </div>
            <div className="bt-table-wrap bt-trades">
              <table className="bt-table">
                <thead>
                  <tr>
                    <SortTh label="Entry" k="entryDate" sort={sort} onSort={toggleSort} />
                    <SortTh label="Expiry" k="expiryDate" sort={sort} onSort={toggleSort} />
                    <SortTh label="DTE" k="actualDte" sort={sort} onSort={toggleSort} />
                    <th>Spot</th>
                    <th>Strikes</th>
                    <SortTh label="Credit" k="netCredit" sort={sort} onSort={toggleSort} />
                    <th>Exit</th>
                    <SortTh label="P&L" k="pnl" sort={sort} onSort={toggleSort} />
                    <SortTh label="VIX" k="entryVix" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedTrades.map(trade => (
                    <TradeRow key={`${trade.entryDate}-${trade.shortK}-${trade.expiryDate}`} trade={trade} />
                  ))}
                </tbody>
              </table>
              {sortedTrades.length === 0 && <p className="bt-hint">No trades for this configuration.</p>}
            </div>
          </div>
        </div>
      )}
      </div>

      <details className="bt-card bt-details">
        <summary>Data, storage, and model limits</summary>
        <div className="bt-prose">
          <p>{market?.note}</p>
          <p>
            The committed snapshot is two gzip files under <code>public/data</code>. A full daily history is about 9,000 rows and the backtest runs in the browser, so a database round-trip on every tweak would only add latency. Newer daily sessions are the only thing that changes, and only when you press Update data. Those rows go into the existing Neon database (<code>market_daily_tail</code>) and are merged onto the snapshot on the next load. The 5-minute series is a copy of <code>spx_5min.js</code> from ashtonchan01/0dte-spx-backtest ({market?.fiveMinSource}). There is no free source to extend it, and this page does not talk to IBKR.
          </p>
          <p>
            DTE counts NYSE sessions in the saved SPX file, so weekends, holidays, and special closes are skipped. The target session is that many sessions after entry. The trade opens the next real SPXW expiry on or after that day. Friday weeklies begin {SPXW_SCHEDULE.fridayWeekly} (first expiry in Cboe circular IC05-138; none on the standard expiration Friday). They are modeled as AM-settled until {SPXW_SCHEDULE.fridayWeeklyPm} and PM after that — the real switch to PM was earlier, so Friday 0DTE before then snaps forward. Wednesday expiries begin {SPXW_SCHEDULE.wednesday}, Mondays {SPXW_SCHEDULE.monday}, Tuesdays {SPXW_SCHEDULE.tuesday}, Thursdays {SPXW_SCHEDULE.thursday}. From the Thursday launch, every session has an expiry. Third-Friday PM settlement is modeled from {SPXW_SCHEDULE.thirdFridayPm} (SPXPM pilot; the symbol became SPXW on 1 May 2017). A holiday expiry moves to the previous session, except Monday weeklies, which move to the next session. End-of-month expiries are not added on days that did not already expire.
          </p>
          <p>
            PM contracts settle on the close. AM contracts settle on the next open and cannot be entered on the settlement morning, so the row’s DTE is the sessions until that morning. Each leg is priced with its own IV: VIX/100 plus the skew times how far the strike is below spot. Strikes round to 5 points. Slippage is removed from the credit and added again if the spread is closed before expiry; expiry pays no second slippage. Max loss is width minus the net credit, times $100, times contracts. Every selected weekday is an entry, even if another spread is still open. Equity is marked when trades close, not every day while they are open. No commissions.
          </p>
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
  const dte = trade.snapped ? `${trade.actualDte} (asked ${trade.targetDte})` : String(trade.actualDte)
  return (
    <tr>
      <td>{trade.entryDate}</td>
      <td>{trade.expiryDate} <span className="bt-unit">{trade.settle.toUpperCase()}</span></td>
      <td>{dte}</td>
      <td>{trade.entrySpot.toFixed(2)} → {trade.exitSpot.toFixed(2)}</td>
      <td>{trade.shortK} / {trade.longK}</td>
      <td>{trade.netCredit.toFixed(2)}</td>
      <td>{trade.exitReason} · {trade.stopBasis}</td>
      <td className={signed(trade.pnl)}>{money(trade.pnl)}</td>
      <td>{trade.entryVix.toFixed(1)}</td>
    </tr>
  )
}
