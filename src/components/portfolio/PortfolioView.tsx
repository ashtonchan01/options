/**
 * Portfolio tab — two side-by-side columns: Analytics (allocation pie, cash
 * flow, classified income, stocks/options tables) and Companies (per-
 * underlying realized/unrealized P&L breakdown). Both render at once
 * instead of behind sub-tabs.
 */
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import { ActualPortfolio } from '../analytics/AnalyticsView'
import CompaniesView from '../companies/CompaniesView'

export default function PortfolioView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  return (
    <div className="pf-columns">
      <div className="pf-column">
        <ActualPortfolio state={state} labels={tradeLabels?.labels ?? {}} />
      </div>
      <div className="pf-column">
        <CompaniesView state={state} tradeLabels={tradeLabels} />
      </div>
    </div>
  )
}
