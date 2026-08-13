/**
 * Portfolio tab — Calendar alongside Companies (per-underlying realized/
 * unrealized P&L breakdown). The summary metrics and holdings detail that
 * used to live here have been removed.
 */
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import CalendarPanel from '../dashboard/panels/CalendarPanel'
import CompaniesView from '../companies/CompaniesView'

export default function PortfolioView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  return (
    <div className="pf-columns">
      <div className="pf-column">
        <CalendarPanel state={state} />
      </div>
      <div className="pf-column" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <CompaniesView state={state} tradeLabels={tradeLabels} />
      </div>
    </div>
  )
}
