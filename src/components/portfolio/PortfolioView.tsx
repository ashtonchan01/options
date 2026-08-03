/**
 * Portfolio tab — three side-by-side columns: Analytics (allocation pie,
 * cash flow, stocks/options tables), Journal Overview (KPIs, equity curve,
 * Edge Finder, breakdowns), and Trade Journal (per-position setup/mistake/
 * rating/notes). All three render at once instead of behind sub-tabs.
 */
import { useMemo } from 'react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import { ActualPortfolio } from '../analytics/AnalyticsView'
import { OverviewTab, JournalTab } from '../journal/JournalView'
import { buildJournalPositions, closedByDate } from '../../engine/journal'
import { useJournalStore } from '../../store/journalStore'

function NoTradeData() {
  return (
    <div className="db-empty-msg" style={{ flex: 1 }}>
      No trade data — sync IBKR Flex or upload an XML to start journaling
    </div>
  )
}

export default function PortfolioView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const { entries, updateEntry, setups, addSetup } = useJournalStore()

  const positions = useMemo(
    () => buildJournalPositions(state.sync.trades, tradeLabels?.labels ?? {}),
    [state.sync.trades, tradeLabels?.labels],
  )
  const closed = useMemo(() => closedByDate(positions), [positions])
  const hasTrades = state.sync.trades.length > 0

  return (
    <div className="pf-columns">
      <div className="pf-column">
        <ActualPortfolio state={state} labels={tradeLabels?.labels ?? {}} />
      </div>
      <div className="pf-column jr-root">
        <div className="cc-section-title" style={{ padding: 0 }}>Journal Overview</div>
        {hasTrades ? <OverviewTab closed={closed} entries={entries} /> : <NoTradeData />}
      </div>
      <div className="pf-column jr-root">
        <div className="cc-section-title" style={{ padding: 0 }}>Trade Journal</div>
        {hasTrades ? (
          <JournalTab positions={positions} entries={entries} updateEntry={updateEntry} setups={setups} addSetup={addSetup} />
        ) : <NoTradeData />}
      </div>
    </div>
  )
}
