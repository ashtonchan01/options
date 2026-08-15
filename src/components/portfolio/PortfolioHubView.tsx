/**
 * Portfolio hub — everything account-specific lives here now: pick
 * Personal or Business, then a broker (IBKR live-synced for Personal,
 * everything else is an uploaded statement), then Calendar / Journal /
 * Reports / Allocation for that account.
 *
 * (A "Summary" entity that combined Personal-vs-Business FY reports side by
 * side used to sit alongside Personal/Business here — pulled for now per
 * user request; the underlying per-account CompaniesView data is untouched
 * so it can come back later without re-deriving anything.)
 *
 * <main> in App.tsx is always `overflow: hidden`, so this component owns
 * being the single bounded box: fixed-height header (entity/broker/section
 * tabs) + a flex:1 min-height:0 body. Calendar/Journal/Allocation already
 * manage their own internal height:100%/overflow-y:auto (they used to be
 * mounted directly under <main>), so the body wrapper for those stays
 * overflow:hidden and lets the child scroll itself — wrapping them in
 * another scrolling box double-nests overflow and breaks child scrolling
 * (see the .jr-stacked-top / pf-column comments in index.css). Reports
 * (CompaniesView) doesn't self-manage overflow, so that gets a `jr-root`
 * wrapper (height:100% + its own overflow-y:auto), same as the old
 * standalone ReportsView did.
 */
import { useState } from 'react'
import { Landmark, TrendingUp } from 'lucide-react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import CalendarView from '../calendar/CalendarView'
import JournalPageView from '../journal/JournalPageView'
import PortfolioAllocationView from '../allocation/PortfolioAllocationView'
import CompaniesView from '../companies/CompaniesView'
import AccountUploadBar from '../shared/AccountUploadBar'
import { tradesToAppState } from '../shared/syntheticAccountState'
import { useReportAccount } from '../../store/reportAccountsStore'

type Entity = 'personal' | 'business'
type Broker = 'ibkr' | 'moomoo'
type Section = 'calendar' | 'journal' | 'reports' | 'allocation'

const ENTITY_TABS: { id: Entity; label: string }[] = [
  { id: 'personal', label: 'Personal' },
  { id: 'business', label: 'Business' },
]
const BROKER_CARDS: { id: Broker; label: string; icon: React.ReactNode }[] = [
  { id: 'ibkr', label: 'IBKR', icon: <Landmark size={14} /> },
  { id: 'moomoo', label: 'Moomoo', icon: <TrendingUp size={14} /> },
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
    (broker === 'ibkr' ? companyIbkr : businessMoomoo)

  const accountState: AppState = isPrimary ? state : tradesToAppState(account?.trades ?? [])
  const accountLabel =
    entity === 'personal' ? (broker === 'ibkr' ? 'Personal IBKR' : 'Personal Moomoo') :
    (broker === 'ibkr' ? 'Business IBKR' : 'Business Moomoo')

  function brokerSubtitle(entityId: Entity, brokerId: Broker): string {
    if (entityId === 'personal' && brokerId === 'ibkr') return 'Live sync'
    const acct = entityId === 'personal' ? personalMoomoo : (brokerId === 'ibkr' ? companyIbkr : businessMoomoo)
    return acct.trades.length > 0 ? `${acct.trades.length} trades` : 'No data yet'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '20px 24px' }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ph-underline-tabs">
            {ENTITY_TABS.map(t => (
              <button
                key={t.id}
                className={`ph-underline-tab${entity === t.id ? ' active' : ''}`}
                onClick={() => setEntity(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div>
            <div className="ph-cardrow-label">Broker</div>
            <div className="ph-card-row">
              {BROKER_CARDS.map(b => (
                <button
                  key={b.id}
                  className={`ph-card${broker === b.id ? ' active' : ''}`}
                  onClick={() => setBroker(b.id)}
                >
                  <span className="ph-card-icon">{b.icon}</span>
                  <span className="ph-card-body">
                    <span className="ph-card-title">{b.label}</span>
                    <span className="ph-card-sub">{brokerSubtitle(entity, b.id)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="ph-underline-tabs">
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
        </div>

        <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid var(--border)', paddingTop: 16, overflow: section === 'reports' ? 'auto' : 'hidden' }}>
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
