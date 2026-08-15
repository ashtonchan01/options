/**
 * Account content view — Calendar / Journal / Reports / Allocation for one
 * user-created account. Every account here is upload-based (statement
 * decoded into trades, no live API sync) — the account itself, and which
 * Personal/Business group it's under, was picked in the Sidebar.
 *
 * <main> in App.tsx is always `overflow: hidden`, so this component owns
 * being the single bounded box: fixed-height header (the Section tab row)
 * + a flex:1 min-height:0 body. Calendar/Journal/Allocation already manage
 * their own internal height:100%/overflow-y:auto (they used to be mounted
 * directly under <main>), so the body wrapper for those stays
 * overflow:hidden and lets the child scroll itself — wrapping them in
 * another scrolling box double-nests overflow and breaks child scrolling
 * (see the .jr-stacked-top / pf-column comments in index.css). Reports
 * (CompaniesView) doesn't self-manage overflow, so that gets a `jr-root`
 * wrapper (height:100% + its own overflow-y:auto), same as the old
 * standalone ReportsView did.
 */
import { useState } from 'react'
import type { TradeLabels } from '../../App'
import type { Account } from '../../store/accountsStore'
import CalendarView from '../calendar/CalendarView'
import JournalPageView from '../journal/JournalPageView'
import PortfolioAllocationView from '../allocation/PortfolioAllocationView'
import CompaniesView from '../companies/CompaniesView'
import AccountUploadBar from '../shared/AccountUploadBar'
import { tradesToAppState } from '../shared/syntheticAccountState'

type Section = 'calendar' | 'journal' | 'reports' | 'allocation'

const SECTION_TABS: { id: Section; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'journal', label: 'Journal' },
  { id: 'reports', label: 'Reports' },
  { id: 'allocation', label: 'Allocation' },
]

export default function AccountView({ account, loading, error, onUpload, onClear, tradeLabels }: {
  account: Account
  loading: boolean
  error: string | null
  onUpload: (file: File) => void
  onClear: () => void
  tradeLabels?: TradeLabels
}) {
  const [section, setSection] = useState<Section>('reports')
  const accountState = tradesToAppState(account.trades)

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

        <div style={{ flex: 1, minHeight: 0, overflow: section === 'reports' ? 'auto' : 'hidden' }}>
          {section === 'calendar' && <CalendarView state={accountState} />}
          {section === 'journal' && <JournalPageView state={accountState} tradeLabels={tradeLabels} />}
          {section === 'allocation' && <PortfolioAllocationView state={accountState} />}
          {section === 'reports' && (
            <div className="jr-root" style={{ height: 'auto', overflow: 'visible', padding: 0 }}>
              <AccountUploadBar
                label={account.name}
                fileName={account.fileName}
                uploadedAt={account.uploadedAt}
                loading={loading}
                error={error}
                onUpload={onUpload}
                onClear={onClear}
              />
              <CompaniesView state={accountState} tradeLabels={tradeLabels} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
