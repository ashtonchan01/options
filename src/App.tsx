import { useState } from 'react'
import TopNav, { type TabId } from './components/layout/TopNav'
import FlexSettingsPanel from './components/shared/FlexSettingsPanel'
import { useAppStore } from './store/appStore'
import { useSettingsStore } from './store/settingsStore'
import { useTradeLabelStore } from './store/tradeLabelsStore'
import DashboardView from './components/dashboard/DashboardView'
import PortfolioView from './components/portfolio/PortfolioView'
import CalendarView from './components/calendar/CalendarView'
import StrategiesView from './components/strategies/StrategiesView'
import OpportunitiesView from './components/opportunities/OpportunitiesView'
import PlanView from './components/plan/PlanView'
import BacktestView from './components/backtest/BacktestView'
import JournalView from './components/journal/JournalView'
import type { AppState } from './types'
import type { TradeLabel } from './store/tradeLabelsStore'

export type StrategyPage =
  | 'overview'
  | 'label_trades'
  | 'covered_calls'
  | 'csp'
  | 'leap'
  | 'spx'
  | 'rotation'
  | 'ptos'
  | 'dcas'
  | 'profit_taking'
  | 'lilo'
  | 'arb_cloud'
  | 'tabi'
  | 'forex'
  | 'assignment'

export interface TradeLabels {
  labels:   Record<string, TradeLabel>
  setLabel: (id: string, label: TradeLabel | null) => void
  setMany:  (ids: string[], label: TradeLabel | null) => void
  clearAll: () => void
}

type ViewComponent = React.FC<{ state: AppState; stratPage?: StrategyPage; tradeLabels?: TradeLabels }>

const VIEWS: Record<TabId, ViewComponent> = {
  dashboard:  DashboardView,
  portfolio:  PortfolioView,
  calendar:   CalendarView as ViewComponent,
  strategies: StrategiesView as ViewComponent,
  scanner:    OpportunitiesView as ViewComponent,
  plan:       PlanView as ViewComponent,
  backtest:   BacktestView as ViewComponent,
  journal:    JournalView as ViewComponent,
}

export default function App() {
  const [activeTab, setActiveTab]       = useState<TabId>('dashboard')
  const [stratPage, setStratPage]       = useState<StrategyPage>('overview')
  const [showSettings, setShowSettings] = useState(false)
  const { state, uploadXML, syncFlex }  = useAppStore()
  const { settings, update, activeProfile } = useSettingsStore()
  const { labels, setLabel, setMany, clearAll } = useTradeLabelStore()

  const hasCredentials = !!(activeProfile?.token && activeProfile?.queryId)
  const View = VIEWS[activeTab]
  const tradeLabels: TradeLabels = { labels, setLabel, setMany, clearAll }

  function handleTabChange(tab: TabId) {
    setActiveTab(tab)
    if (tab !== 'strategies') setStratPage('overview')
  }

  function handleStrategySelect(page: StrategyPage) {
    setActiveTab('strategies')
    setStratPage(page)
  }

  return (
    <div className="app-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-page)', maxWidth: 1920, margin: '0 auto' }}>
      <TopNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onStrategySelect={handleStrategySelect}
        actionCount={state.actions.length}
        syncStatus={state.sync.status}
        syncError={state.sync.error}
        lastSync={state.sync.lastSync}
        hasCredentials={hasCredentials}
        onSyncClick={() => activeProfile && syncFlex(activeProfile.token, activeProfile.queryId)}
        onXmlUpload={uploadXML}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main style={{ flex: 1, overflow: 'hidden', background: 'var(--bg-page)' }}>
        <View state={state} stratPage={stratPage} tradeLabels={tradeLabels} />
      </main>

      {showSettings && (
        <FlexSettingsPanel
          settings={settings}
          onSave={update}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
