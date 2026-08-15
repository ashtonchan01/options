/**
 * Reports tab — per-account company breakdowns (Companies, Personal IBKR,
 * Company IBKR, Personal Moomoo), each reusing CompaniesView (which already
 * has its own FY filter — All Time / previous FY / current FY). The two
 * non-primary accounts have no live sync, so each gets its own statement
 * upload instead.
 */
import { useRef, useState } from 'react'
import { Upload, Trash2 } from 'lucide-react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import CompaniesView from '../companies/CompaniesView'
import { useReportAccount, type ReportAccountId } from '../../store/reportAccountsStore'

type ReportAccount = ReturnType<typeof useReportAccount>

type ReportTabId = 'companies' | 'personal_ibkr' | ReportAccountId

const TABS: { id: ReportTabId; label: string }[] = [
  { id: 'companies', label: 'Companies' },
  { id: 'personal_ibkr', label: 'Personal IBKR Account' },
  { id: 'company_ibkr', label: 'Company IBKR Account' },
  { id: 'personal_moomoo', label: 'Personal Moomoo Account' },
]

function emptyAppState(): AppState {
  return {
    sync: { mode: 'xml', status: 'idle', positions: [], trades: [], cashBalance: 0 },
    strategies: [],
    quotes: {},
    actions: [],
    scanResults: [],
    livePrices: {},
  }
}

/** Upload control + status for one of the non-primary accounts — a broker
 * statement (IBKR Flex .xml, or a best-effort generic .csv for anything
 * else, Moomoo included) gets decoded into trades and folded into that
 * account's report, same as the main Sidebar's XML upload does for the
 * primary account. Takes the account object as a prop (rather than calling
 * useReportAccount itself) so it shares the exact same state as whatever
 * reads `.trades` from it elsewhere — two separate hook calls for the same
 * id each get their own independent useState, so an upload in one instance
 * never appeared in the other's `.trades` (verified: localStorage held the
 * parsed rows right after upload, but the table below still read empty). */
function AccountUploadBar({ label, account }: { label: string; account: ReportAccount }) {
  const { fileName, uploadedAt, loading, error, upload, clear } = account
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) upload(file)
    e.target.value = ''
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, flexWrap: 'wrap',
    }}>
      <label style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
        fontSize: 11, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
        color: 'var(--accent)', cursor: loading ? 'not-allowed' : 'pointer', borderRadius: 4, fontFamily: 'Inter, sans-serif',
      }}>
        <Upload size={12} />
        {loading ? 'Decoding…' : `Upload ${label} statement`}
        <input ref={fileRef} type="file" accept=".xml,.csv" style={{ display: 'none' }} onChange={handleFile} disabled={loading} />
      </label>
      <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
        Accepts an IBKR Flex .xml export, or a generic .csv (Date/Symbol/Quantity/Price columns).
      </span>
      {fileName && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
          Last import: {fileName} ({uploadedAt ? new Date(uploadedAt).toLocaleDateString() : ''})
          <button onClick={clear} title="Clear imported trades for this account" style={{
            background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)',
            cursor: 'pointer', padding: '3px 6px', borderRadius: 4, display: 'flex',
          }}>
            <Trash2 size={11} />
          </button>
        </span>
      )}
      {error && (
        <div style={{ width: '100%', fontSize: 11, color: '#ef4444' }}>{error}</div>
      )}
    </div>
  )
}

export default function ReportsView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const [tab, setTab] = useState<ReportTabId>('companies')
  const companyIbkr = useReportAccount('company_ibkr')
  const personalMoomoo = useReportAccount('personal_moomoo')

  const companyIbkrState: AppState = { ...emptyAppState(), sync: { ...emptyAppState().sync, trades: companyIbkr.trades } }
  const personalMoomooState: AppState = { ...emptyAppState(), sync: { ...emptyAppState().sync, trades: personalMoomoo.trades } }
  // "Companies" is the combined view across every account — the other three
  // tabs are each one account's own breakdown.
  const combinedState: AppState = {
    ...emptyAppState(),
    sync: { ...emptyAppState().sync, trades: [...state.sync.trades, ...companyIbkr.trades, ...personalMoomoo.trades], positions: state.sync.positions },
  }

  return (
    <div className="jr-root">
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tl-filter-chip${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'companies' && <CompaniesView state={combinedState} tradeLabels={tradeLabels} />}
      {tab === 'personal_ibkr' && <CompaniesView state={state} tradeLabels={tradeLabels} />}
      {tab === 'company_ibkr' && (
        <>
          <AccountUploadBar label="Company IBKR" account={companyIbkr} />
          <CompaniesView state={companyIbkrState} />
        </>
      )}
      {tab === 'personal_moomoo' && (
        <>
          <AccountUploadBar label="Personal Moomoo" account={personalMoomoo} />
          <CompaniesView state={personalMoomooState} />
        </>
      )}
    </div>
  )
}
