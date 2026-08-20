/**
 * Account content view — Overview / Calendar / Journal / Company P&L /
 * Monthly Income / Allocation for one user-created account. Trades come
 * from either a one-off statement upload or a per-account IBKR Flex Web
 * Service sync (its own Token/Query ID, not a single app-wide primary
 * account) — both feed the same trades array, so everything downstream
 * doesn't care which source populated it.
 *
 * <main> in App.tsx is always `overflow: hidden`, so this component owns
 * being the single bounded box: fixed-height header (the Section tab row)
 * + a flex:1 min-height:0 body. Calendar/Journal/Allocation already manage
 * their own internal height:100%/overflow-y:auto (they used to be mounted
 * directly under <main>), so the body wrapper for those stays
 * overflow:hidden and lets the child scroll itself — wrapping them in
 * another scrolling box double-nests overflow and breaks child scrolling
 * (see the .jr-stacked-top / pf-column comments in index.css). Company
 * P&L/Monthly Income (formerly one combined "Reports" page, CompaniesView)
 * don't self-manage overflow, so those get a `jr-root` wrapper (height:100%
 * + its own overflow-y:auto), same as the old standalone ReportsView did.
 */
import { useState } from 'react'
import type { TradeLabels } from '../../App'
import type { Account } from '../../store/accountsStore'
import OverviewView from '../overview/OverviewView'
import CalendarView from '../calendar/CalendarView'
import JournalPageView from '../journal/JournalPageView'
import PortfolioAllocationView from '../allocation/PortfolioAllocationView'
import CompanyPnlView from '../companies/CompanyPnlView'
import MonthlyIncomeView from '../companies/MonthlyIncomeView'
import { accountToAppState } from '../shared/syntheticAccountState'

type Section = 'overview' | 'calendar' | 'journal' | 'company_pnl' | 'monthly_income' | 'allocation'

const SECTION_TABS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'journal', label: 'Journal' },
  { id: 'company_pnl', label: 'Company P&L' },
  { id: 'monthly_income', label: 'Monthly Income' },
  { id: 'allocation', label: 'Allocation' },
]

export default function AccountView({ account, loading, error, onUpload, onClear, onSyncFlex, tradeLabels, watchlistTickers, sessionKey }: {
  account: Account
  loading: boolean
  error: string | null
  onUpload: (file: File) => void | Promise<void>
  onClear: () => void
  onSyncFlex: (token: string, queryId: string) => void
  tradeLabels?: TradeLabels
  watchlistTickers: string[]
  sessionKey: string | null
}) {
  const [section, setSection] = useState<Section>('overview')
  const accountState = accountToAppState(account)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '20px 24px' }}>
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

        <div className={`av-section-body${section === 'calendar' ? ' av-section-calendar' : ''}`} style={{ flex: 1, minHeight: 0, overflow: section === 'company_pnl' || section === 'monthly_income' ? 'auto' : 'hidden' }}>
          {section === 'overview' && (
            <OverviewView
              state={accountState}
              account={account}
              loading={loading}
              error={error}
              onUpload={onUpload}
              onClear={onClear}
              onSyncFlex={onSyncFlex}
            />
          )}
          {section === 'calendar' && <CalendarView state={accountState} watchlistTickers={watchlistTickers} />}
          {section === 'journal' && <JournalPageView state={accountState} tradeLabels={tradeLabels} sessionKey={sessionKey} />}
          {section === 'allocation' && <PortfolioAllocationView state={accountState} accountId={account.id} sessionKey={sessionKey} />}
          {section === 'company_pnl' && (
            <div className="jr-root" style={{ height: 'auto', overflow: 'visible', padding: 0 }}>
              <CompanyPnlView state={accountState} tradeLabels={tradeLabels} />
            </div>
          )}
          {section === 'monthly_income' && (
            <div className="jr-root" style={{ height: 'auto', overflow: 'visible', padding: 0 }}>
              <MonthlyIncomeView state={accountState} tradeLabels={tradeLabels} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
