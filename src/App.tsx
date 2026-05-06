import { useState } from 'react'
import Sidebar, { type TabId } from './components/layout/Sidebar'
import Header from './components/layout/Header'
import { useAppStore } from './store/appStore'
import PortfolioView from './components/portfolio/PortfolioView'
import CalendarView from './components/calendar/CalendarView'
import StrategiesView from './components/strategies/StrategiesView'
import OpportunitiesView from './components/opportunities/OpportunitiesView'
import ActionsView from './components/actions/ActionsView'
import GrowthView from './components/growth/GrowthView'
import type { AppState } from './types'

type ViewComponent = React.FC<{ state: AppState }>

const VIEWS: Record<TabId, ViewComponent> = {
  portfolio:     PortfolioView,
  calendar:      CalendarView as ViewComponent,
  strategies:    StrategiesView as ViewComponent,
  opportunities: OpportunitiesView as ViewComponent,
  actions:       ActionsView as ViewComponent,
  growth:        GrowthView as ViewComponent,
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('portfolio')
  const { state, uploadXML, syncFlex } = useAppStore()

  const View = VIEWS[activeTab]

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0e0d14' }}>
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actionCount={state.actions.length}
        syncStatus={state.sync.status}
      />

      <div className="flex flex-col flex-1 min-w-0">
        <Header
          activeTab={activeTab}
          syncStatus={state.sync.status}
          syncMode={state.sync.mode}
          lastSync={state.sync.lastSync}
          onSyncClick={syncFlex}
          onXmlUpload={uploadXML}
        />

        <main className="flex-1 overflow-auto" style={{ background: '#0e0d14' }}>
          <View state={state} />
        </main>
      </div>
    </div>
  )
}
