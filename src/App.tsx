import { useState } from 'react'
import Sidebar, { type TabId, parseAccountTabId } from './components/layout/Sidebar'
import AuthGate from './components/auth/AuthGate'
import { useTradeLabelStore } from './store/tradeLabelsStore'
import { useAuthStore } from './store/authStore'
import { useAccounts } from './store/accountsStore'
import { useWatchlists } from './store/watchlistStore'
import DashboardView from './components/dashboard/DashboardView'
import AccountView from './components/portfolio/AccountView'
import OpportunitiesView from './components/opportunities/OpportunitiesView'
import WatchlistView from './components/watchlist/WatchlistView'
import { tradesToAppState } from './components/shared/syntheticAccountState'
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

// Dashboard doesn't read from any live-synced primary account anymore
// (every account is its own thing now) — it just needs an AppState-shaped
// prop, so an empty one is all there is to pass.
const EMPTY_STATE = tradesToAppState([])

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const auth = useAuthStore()
  const { labels, setLabel, setMany, clearAll } = useTradeLabelStore()
  const accountsStore = useAccounts(auth.user?.email ?? null)
  const watchlists = useWatchlists(auth.user?.email ?? null)

  const activeAccountId = parseAccountTabId(activeTab)
  const activeAccount = activeAccountId ? accountsStore.accounts.find(a => a.id === activeAccountId) : undefined
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
        accounts={accountsStore.accounts}
        onAddAccount={accountsStore.addAccount}
        userEmail={auth.user.email}
        onSignOut={auth.logout}
      />

      <div className="ew-main">
        <main style={{ flex: 1, overflow: 'hidden' }}>
          {activeAccount ? (
            <AccountView
              account={activeAccount}
              loading={accountsStore.loadingId === activeAccount.id}
              error={accountsStore.error}
              onUpload={file => accountsStore.uploadStatement(activeAccount.id, file)}
              onClear={() => accountsStore.clearTrades(activeAccount.id)}
              onSyncFlex={(token, queryId) => accountsStore.syncFlex(activeAccount.id, token, queryId)}
              tradeLabels={tradeLabels}
              watchlistTickers={watchlists.activeTickers}
            />
          ) : activeTab === 'watchlist' ? (
            <WatchlistView
              lists={watchlists.lists}
              activeId={watchlists.activeId}
              onSetActive={watchlists.setActive}
              onAddList={watchlists.addList}
              onRemoveList={watchlists.removeList}
              onRenameList={watchlists.renameList}
              onAddTicker={watchlists.addTicker}
              onRemoveTicker={watchlists.removeTicker}
            />
          ) : activeTab === 'scanner' ? (
            <OpportunitiesView
              state={EMPTY_STATE}
              tickers={watchlists.activeTickers}
              onAddTicker={sym => watchlists.activeId && watchlists.addTicker(watchlists.activeId, sym)}
              onRemoveTicker={sym => watchlists.activeId && watchlists.removeTicker(watchlists.activeId, sym)}
            />
          ) : (
            <DashboardView state={EMPTY_STATE} />
          )}
        </main>
      </div>
    </div>
  )
}
