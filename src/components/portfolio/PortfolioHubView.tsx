/**
 * Portfolio hub — everything account-specific lives here now: pick
 * Personal or Business, then a broker (IBKR live-synced for Personal,
 * everything else is an uploaded statement), then Calendar / Journal /
 * Reports / Allocation for that account. A third top-level "Summary" choice
 * skips the broker/section drill-down and shows a combined Personal-vs-
 * Business trade summary for the financial year (each side is just the
 * union of that entity's accounts, reusing CompaniesView's own FY filter
 * rather than re-deriving FY math here).
 *
 * <main> in App.tsx is always `overflow: hidden`, so this component owns
 * being the single bounded box: fixed-height header (entity/broker/section
 * chips) + a flex:1 min-height:0 body. Calendar/Journal/Allocation already
 * manage their own internal height:100%/overflow-y:auto (they used to be
 * mounted directly under <main>), so the body wrapper for those stays
 * overflow:hidden and lets the child scroll itself — wrapping them in
 * another scrolling box double-nests overflow and breaks child scrolling
 * (see the .jr-stacked-top / pf-column comments in index.css). Reports/
 * Summary (CompaniesView) don't self-manage overflow, so those get a
 * `jr-root` wrapper (height:100% + its own overflow-y:auto), same as the
 * old standalone ReportsView did.
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

type Entity = 'personal' | 'business' | 'summary'
type Broker = 'ibkr' | 'moomoo'
type Section = 'calendar' | 'journal' | 'reports' | 'allocation'

const ENTITY_TABS: { id: Entity; label: string }[] = [
  { id: 'personal', label: 'Personal' },
  { id: 'business', label: 'Business' },
  { id: 'summary', label: 'Summary (Personal vs Business)' },
]
const BROKER_TABS: { id: Broker; label: string }[] = [
  { id: 'ibkr', label: 'IBKR' },
  { id: 'moomoo', label: 'Moomoo' },
]
const SECTION_TABS: { id: Section; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'journal', label: 'Journal' },
  { id: 'reports', label: 'Reports' },
  { id: 'allocation', label: 'Allocation' },
]

export default function PortfolioHubView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const [entity, setEntity] = useState<Entity>('personal')
  const [broker, setBroker] = useState<Broker>('ibkr')
  const [section, setSection] = useState<Section>('reports')

  const personalMoomoo = useReportAccount('personal_moomoo')
  const companyIbkr = useReportAccount('company_ibkr')
  const businessMoomoo = useReportAccount('business_moomoo')

  const isPrimary = entity === 'personal' && broker === 'ibkr'
  const account =
    entity === 'personal' ? (broker === 'ibkr' ? null : personalMoomoo) :
    entity === 'business' ? (broker === 'ibkr' ? companyIbkr : businessMoomoo) :
    null

  const accountState: AppState = isPrimary ? state : tradesToAppState(account?.trades ?? [])
  const accountLabel =
    entity === 'personal' ? (broker === 'ibkr' ? 'Personal IBKR' : 'Personal Moomoo') :
    (broker === 'ibkr' ? 'Business IBKR' : 'Business Moomoo')

  const personalCombined = tradesToAppState([...state.sync.trades, ...personalMoomoo.trades])
  const businessCombined = tradesToAppState([...companyIbkr.trades, ...businessMoomoo.trades])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: '0 0 auto', padding: '20px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="ph-tabgroup">
          {ENTITY_TABS.map(t => (
            <button
              key={t.id}
              className={`ph-tab${entity === t.id ? ' active' : ''}`}
              onClick={() => setEntity(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {entity !== 'summary' && (
          <>
            <div className="ph-tabgroup">
              {BROKER_TABS.map(t => (
                <button
                  key={t.id}
                  className={`ph-tab${broker === t.id ? ' active' : ''}`}
                  onClick={() => setBroker(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="ph-tabgroup">
              {SECTION_TABS.map(t => (
                <button
                  key={t.id}
                  className={`ph-tab${section === t.id ? ' active' : ''}`}
                  onClick={() => setSection(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {entity === 'summary' ? (
        <div className="jr-root">
          <div>
            <div className="cc-section-title" style={{ marginBottom: 8 }}>Personal — All Accounts</div>
            <CompaniesView state={personalCombined} tradeLabels={tradeLabels} />
          </div>
          <div>
            <div className="cc-section-title" style={{ marginBottom: 8 }}>Business — All Accounts</div>
            <CompaniesView state={businessCombined} />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: section === 'reports' ? 'auto' : 'hidden' }}>
          {section === 'calendar' && <CalendarView state={accountState} />}
          {section === 'journal' && <JournalPageView state={accountState} tradeLabels={isPrimary ? tradeLabels : undefined} />}
          {section === 'allocation' && <PortfolioAllocationView state={accountState} />}
          {section === 'reports' && (
            <div className="jr-root" style={{ height: 'auto', overflow: 'visible' }}>
              {!isPrimary && account && <AccountUploadBar label={accountLabel} account={account} />}
              <CompaniesView state={accountState} tradeLabels={isPrimary ? tradeLabels : undefined} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
