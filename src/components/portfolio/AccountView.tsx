/**
 * Account content view — Overview / Calendar / Journal / Income / Reports /
 * Allocation for one user-created account. Trades come from either a
 * one-off statement upload or a per-account IBKR Flex Web Service sync
 * (its own Token/Query ID, not a single app-wide primary account) — both
 * feed the same trades array, so everything downstream doesn't care which
 * source populated it.
 *
 * <main> in App.tsx is always `overflow: hidden`, so this component owns
 * being the single bounded box: fixed-height header (the Section tab row)
 * + a flex:1 min-height:0 body. Calendar/Journal/Allocation already manage
 * their own internal height:100%/overflow-y:auto (they used to be mounted
 * directly under <main>), so the body wrapper for those stays
 * overflow:hidden and lets the child scroll itself — wrapping them in
 * another scrolling box double-nests overflow and breaks child scrolling
 * (see the .jr-stacked-top / pf-column comments in index.css). Reports
 * (ReportsView — Company P&L and Monthly Income as its own internal
 * sub-nav) doesn't self-manage overflow, so that gets a `jr-root` wrapper
 * (height:100% + its own overflow-y:auto), same as the old standalone
 * ReportsView did.
 */
import { useState } from 'react'
import type { TradeLabels } from '../../App'
import type { Account } from '../../store/accountsStore'
import OverviewView from '../overview/OverviewView'
import CalendarView from '../calendar/CalendarView'
import JournalPageView from '../journal/JournalPageView'
import PortfolioAllocationView from '../allocation/PortfolioAllocationView'
import ReportsView from '../companies/ReportsView'
import IncomeView from '../income/IncomeView'
import type { IncomeSource } from '../../income/incomeLive'
import { accountToAppState } from '../shared/syntheticAccountState'

type Section = 'overview' | 'calendar' | 'journal' | 'income' | 'reports' | 'allocation'

const SECTION_TABS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'journal', label: 'Journal' },
  { id: 'income', label: 'Income' },
  { id: 'reports', label: 'Reports' },
  { id: 'allocation', label: 'Allocation' },
]

function incomeSources(list: Account[]): IncomeSource[] {
  return list.map(entry => ({
    name: entry.name,
    positions: entry.positions ?? [],
    trades: entry.trades,
    cashBalance: entry.cashBalance,
    netLiquidation: entry.netLiquidation,
    excessLiquidity: entry.excessLiquidity,
  }))
}

function initialSection(): Section {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    const asked = params.get('section')
    if (asked === 'overview' || asked === 'calendar' || asked === 'journal' || asked === 'income' || asked === 'reports' || asked === 'allocation') return asked
    if (params.get('fypreview') === '1') return 'reports'
  }
  return 'overview'
}

export default function AccountView({ account, accounts, loading, error, syncNote, uploadError, onUpload, onClear, onSyncFlex, tradeLabels, watchlistTickers, sessionKey, expand }: {
  account: Account
  /** Every account, so Income can read combined net liquidation and the
   * BTC cap. Display names only — Flex tokens stay on Account and are not passed down. */
  accounts?: Account[]
  loading: boolean
  error: string | null
  syncNote?: string | null
  uploadError?: string | null
  onUpload: (file: File) => void | Promise<void>
  onClear: () => void
  onSyncFlex: (token: string, queryId: string) => void
  tradeLabels?: TradeLabels
  watchlistTickers: string[]
  sessionKey: string | null
  /** Dev preview: let the page grow so a screenshot can capture the report. */
  expand?: boolean
}) {
  const [section, setSection] = useState<Section>(initialSection)
  const accountState = accountToAppState(account)
  const incomeAccounts = incomeSources(accounts && accounts.length > 0 ? accounts : [account])

  return (
    <div style={expand
      ? { display: 'flex', flexDirection: 'column', minHeight: '100vh', padding: '20px 24px' }
      : { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '20px 24px' }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="ph-underline-tabs" style={{ flex: '0 0 auto' }}>
          {SECTION_TABS.map(t => (
            <button
              key={t.id}
              className={`ph-underline-tab${section === t.id ? ' active' : ''}`}
              onClick={() => setSection(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={`av-section-body${section === 'calendar' ? ' av-section-calendar' : ''}`} style={{ flex: 1, minHeight: 0, overflow: expand ? 'visible' : section === 'reports' || section === 'income' ? 'auto' : 'hidden' }}>
          {section === 'overview' && (
            <OverviewView
              state={accountState}
              account={account}
              loading={loading}
              error={error}
              syncNote={syncNote}
              uploadError={uploadError}
              onUpload={onUpload}
              onClear={onClear}
              onSyncFlex={onSyncFlex}
            />
          )}
          {section === 'calendar' && <CalendarView state={accountState} watchlistTickers={watchlistTickers} tradeLabels={tradeLabels} />}
          {section === 'journal' && <JournalPageView state={accountState} tradeLabels={tradeLabels} sessionKey={sessionKey} accountId={account.id} />}
          {section === 'income' && (
            <IncomeView
              account={incomeSources([account])[0]}
              accounts={incomeAccounts}
              sessionKey={sessionKey}
            />
          )}
          {section === 'allocation' && <PortfolioAllocationView state={accountState} accountId={account.id} sessionKey={sessionKey} />}
          {section === 'reports' && (
            <div className="jr-root" style={{ height: 'auto', overflow: 'visible', padding: 0 }}>
              <ReportsView
                state={accountState}
                tradeLabels={tradeLabels}
                accountId={account.id}
                sessionKey={sessionKey}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
