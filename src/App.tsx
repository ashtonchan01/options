import { useState } from 'react'
import Sidebar, { type TabId } from './components/layout/Sidebar'
import FlexSettingsPanel from './components/shared/FlexSettingsPanel'
import AuthGate from './components/auth/AuthGate'
import { useAppStore } from './store/appStore'
import { useSettingsStore } from './store/settingsStore'
import { useTradeLabelStore } from './store/tradeLabelsStore'
import { useAuthStore } from './store/authStore'
import DashboardView from './components/dashboard/DashboardView'
import PortfolioView from './components/portfolio/PortfolioView'
import JournalPageView from './components/journal/JournalPageView'
import OpportunitiesView from './components/opportunities/OpportunitiesView'
import PortfolioAllocationView from './components/allocation/PortfolioAllocationView'
import type { AppState } from './types'
import type { TradeLabel } from './store/tradeLabelsStore'

// Kept for TradeLabel (trade labeling feature, used by Analytics/Portfolio) even though
// the Strategies tab itself has been removed from navigation.
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

type ViewComponent = React.FC<{ state: AppState; tradeLabels?: TradeLabels }>

const VIEWS: Record<TabId, ViewComponent> = {
  dashboard: DashboardView as ViewComponent,
  calendar:  PortfolioView,
  journal:   JournalPageView,
  scanner:   OpportunitiesView as ViewComponent,
  portfolio: PortfolioAllocationView as ViewComponent,
}

export default function App() {
  const [activeTab, setActiveTab]       = useState<TabId>('dashboard')
  const [showSettings, setShowSettings] = useState(false)
  const auth = useAuthStore()
  const { state, uploadXML, syncFlex }  = useAppStore(auth.user?.email ?? null)
  const { settings, update, activeProfile } = useSettingsStore(auth.user?.email ?? null)
  const { labels, setLabel, setMany, clearAll } = useTradeLabelStore()

  const hasCredentials = !!(activeProfile?.token && activeProfile?.queryId)
  const View = VIEWS[activeTab]
  const tradeLabels: TradeLabels = { labels, setLabel, setMany, clearAll }

  if (auth.loading) {
    return <div style={{ height: '100vh', width: '100vw', background: 'var(--bg-surface)' }} />
  }
  if (!auth.user) {
    return <AuthGate error={auth.error} onLogin={auth.login} onSignup={auth.signup} />
  }

  function handleTabChange(tab: TabId) {
    setActiveTab(tab)
  }

  return (
    <div className="ew-shell">
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        actionCount={state.actions.length}
        syncStatus={state.sync.status}
        syncError={state.sync.error}
        lastSync={state.sync.lastSync}
        hasCredentials={hasCredentials}
        onSyncClick={() => activeProfile && syncFlex(activeProfile.token, activeProfile.queryId)}
        onXmlUpload={uploadXML}
        onOpenSettings={() => setShowSettings(true)}
        userEmail={auth.user.email}
        onSignOut={auth.logout}
      />

      <div className="ew-main">
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <View state={state} tradeLabels={tradeLabels} />
        </main>
      </div>

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
