/**
 * Portfolio tab — two side-by-side columns: the left has the top summary
 * (key metrics + allocation pie / monthly cash flow) followed by Companies
 * (per-underlying realized/unrealized P&L breakdown); the right has the
 * holdings detail (income channels + stocks/options/cash tables).
 */
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import { PortfolioSummaryPanel, PortfolioHoldingsPanel } from '../analytics/AnalyticsView'
import CompaniesView from '../companies/CompaniesView'

export default function PortfolioView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  return (
    <div className="pf-columns">
      <div className="pf-column" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <PortfolioSummaryPanel state={state} />
        <CompaniesView state={state} tradeLabels={tradeLabels} />
      </div>
      <div className="pf-column">
        <PortfolioHoldingsPanel state={state} />
      </div>
    </div>
  )
}
