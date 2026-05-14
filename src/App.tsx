import { useState } from 'react'
import Sidebar, { type TabId } from './components/layout/Sidebar'
import Header from './components/layout/Header'
import FlexSettingsPanel from './components/shared/FlexSettingsPanel'
import { useAppStore } from './store/appStore'
import { useSettingsStore } from './store/settingsStore'
import PortfolioView from './components/portfolio/PortfolioView'
import CalendarView from './components/calendar/CalendarView'
import StrategiesView from './components/strategies/StrategiesView'
import OpportunitiesView from './components/opportunities/OpportunitiesView'
import ActionsView from './components/actions/ActionsView'
import PlanView from './components/plan/PlanView'
import BacktestView from './components/backtest/BacktestView'
import type { AppState } from './types'

type ViewComponent = React.FC<{ state: AppState }>

const VIEWS: Record<TabId, ViewComponent> = {
  portfolio:     PortfolioView,
  calendar:      CalendarView as ViewComponent,
  strategies:    StrategiesView as ViewComponent,
  opportunities: OpportunitiesView as ViewComponent,
  actions:       ActionsView as ViewComponent,
  plan:          PlanView as ViewComponent,
  backtest:      BacktestView as ViewComponent,
}

export default function App() {
  const [activeTab, setActiveTab]       = useState<TabId>('portfolio')
  const [showSettings, setShowSettings] = useState(false)
  const { state, uploadXML, syncFlex }  = useAppStore()
  const { settings, update }            = useSettingsStore()

  const hasCredentials = !!(settings.token && settings.queryId)
  const View = VIEWS[activeTab]

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-page)', maxWidth: 1920, margin: '0 auto' }}>
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actionCount={state.actions.length}
        syncStatus={state.sync.status}
      />

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <Header
          activeTab={activeTab}
          syncStatus={state.sync.status}
          syncError={state.sync.error}
          lastSync={state.sync.lastSync}
          hasCredentials={hasCredentials}
          onSyncClick={() => syncFlex(settings.token, settings.queryId)}
          onXmlUpload={uploadXML}
          onOpenSettings={() => setShowSettings(true)}
        />

        <main style={{ flex: 1, overflow: 'hidden', background: 'var(--bg-page)' }}>
          <View state={state} />
        </main>
      </div>

      {showSettings && (
        <FlexSettingsPanel
          settings={settings}
          onSave={s => { update(s); setShowSettings(false) }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
