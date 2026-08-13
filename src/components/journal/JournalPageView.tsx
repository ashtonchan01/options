/**
 * Journal tab — Journal Overview (KPIs, equity curve, Edge Finder, breakdowns)
 * and Trade Journal (per-position setup/mistake/rating/notes) side by side.
 */
import { useMemo } from 'react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import { OverviewTab, JournalTab } from './JournalView'
import { buildJournalPositions, buildStockPositions, closedByDate } from '../../engine/journal'
import { useJournalStore } from '../../store/journalStore'
import { ActionsSidebar } from '../analytics/AnalyticsView'

function NoTradeData() {
  return (
    <div className="db-empty-msg" style={{ flex: 1 }}>
      No trade data — sync IBKR Flex or upload an XML to start journaling
    </div>
  )
}

export default function JournalPageView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const { entries, updateEntry, setups, addSetup } = useJournalStore()

  const positions = useMemo(() => {
    const labels = tradeLabels?.labels ?? {}
    return [
      ...buildJournalPositions(state.sync.trades, labels),
      ...buildStockPositions(state.sync.trades, labels),
    ]
  }, [state.sync.trades, tradeLabels?.labels])
  const closed = useMemo(() => closedByDate(positions), [positions])
  const hasTrades = state.sync.trades.length > 0

  return (
    <div className="jr-page-row">
      <div className="jr-stacked">
        <div className="jr-stacked-top jr-root">
          <div className="cc-section-title" style={{ padding: 0 }}>Journal Overview</div>
          {hasTrades ? <OverviewTab closed={closed} positions={positions} entries={entries} /> : <NoTradeData />}
        </div>
        <div className="jr-stacked-bottom jr-root">
          {hasTrades ? (
            <JournalTab positions={positions} livePositions={state.sync.positions} trades={state.sync.trades} entries={entries} updateEntry={updateEntry} setups={setups} addSetup={addSetup} />
          ) : (
            <>
              <div className="cc-section-title" style={{ padding: 0 }}>Trade Journal</div>
              <NoTradeData />
            </>
          )}
        </div>
      </div>
      <div className="jr-page-actions">
        <ActionsSidebar state={state} />
      </div>
    </div>
  )
}
