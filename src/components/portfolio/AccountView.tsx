/**
 * Account content view — Calendar / Journal / Reports / Allocation for one
 * broker account. Which account (Personal/Business x IBKR/Moomoo) is
 * chosen in the Sidebar now (two expandable nav groups), not here, so this
 * component only owns the single-line Section tab row + content, leaving
 * far more vertical room for the content itself than the old 3-row
 * Personal/Business -> Broker -> Section stack.
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
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import CalendarView from '../calendar/CalendarView'
import JournalPageView from '../journal/JournalPageView'
import PortfolioAllocationView from '../allocation/PortfolioAllocationView'
import CompaniesView from '../companies/CompaniesView'
import AccountUploadBar from '../shared/AccountUploadBar'
import { tradesToAppState } from '../shared/syntheticAccountState'
import { useReportAccount } from '../../store/reportAccountsStore'

export type Entity = 'personal' | 'business'
export type Broker = 'ibkr' | 'moomoo'
type Section = 'calendar' | 'journal' | 'reports' | 'allocation'

const SECTION_TABS: { id: Section; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'journal', label: 'Journal' },
  { id: 'reports', label: 'Reports' },
  { id: 'allocation', label: 'Allocation' },
]

export default function AccountView({ entity, broker, state, tradeLabels }: {
  entity: Entity
  broker: Broker
  state: AppState
  tradeLabels?: TradeLabels
}) {
  const [section, setSection] = useState<Section>('reports')

  const personalMoomoo = useReportAccount('personal_moomoo')
  const companyIbkr = useReportAccount('company_ibkr')
  const businessMoomoo = useReportAccount('business_moomoo')

  const isPrimary = entity === 'personal' && broker === 'ibkr'
  const account =
    entity === 'personal' ? (broker === 'ibkr' ? null : personalMoomoo) :
    (broker === 'ibkr' ? companyIbkr : businessMoomoo)

  const accountState: AppState = isPrimary ? state : tradesToAppState(account?.trades ?? [])
  const accountLabel =
    entity === 'personal' ? (broker === 'ibkr' ? 'Personal IBKR' : 'Personal Moomoo') :
    (broker === 'ibkr' ? 'Business IBKR' : 'Business Moomoo')

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
          {section === 'journal' && <JournalPageView state={accountState} tradeLabels={isPrimary ? tradeLabels : undefined} />}
          {section === 'allocation' && <PortfolioAllocationView state={accountState} />}
          {section === 'reports' && (
            <div className="jr-root" style={{ height: 'auto', overflow: 'visible', padding: 0 }}>
              {!isPrimary && account && <AccountUploadBar label={accountLabel} account={account} />}
              <CompaniesView state={accountState} tradeLabels={isPrimary ? tradeLabels : undefined} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
