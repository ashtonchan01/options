/**
 * Dev-only preview of the realised report. Loaded only when
 * `import.meta.env.DEV` and `?fypreview=1`, so the statement fixture is not
 * part of the production bundle.
 */
import { useMemo, useState } from 'react'
import fy2526Json from '../../scripts/fixtures/ibkr-u21440275-fy2025-26.json'
import fy2627Json from '../../scripts/fixtures/ibkr-u21440275-fy2026-27.json'
import { tradesFromFixture, type StatementFixture } from '../engine/statementFixture'
import type { Account } from '../store/accountsStore'
import AccountView from '../components/portfolio/AccountView'
import type { TradeLabels } from '../App'
import type { RawTrade } from '../types'

const fy2526 = fy2526Json as StatementFixture
const fy2627 = fy2627Json as StatementFixture

function stock(partial: Partial<RawTrade> & Pick<RawTrade, 'tradeDate' | 'symbol' | 'fifoPnlRealized'>): RawTrade {
  return {
    assetClass: 'STK',
    quantity: -1,
    tradePrice: 1,
    proceeds: 0,
    commissions: 0,
    netCash: 0,
    openClose: 'C',
    tradeTime: '120000',
    ...partial,
  }
}

function previewAccounts(): Account[] {
  return [
    {
      id: 'preview-personal',
      name: 'Personal',
      trades: [...tradesFromFixture(fy2526), ...tradesFromFixture(fy2627)],
    },
    {
      id: 'preview-business',
      name: 'Business',
      trades: [stock({
        accountId: 'U26373931',
        symbol: 'AAPL',
        tradeDate: '20250915',
        quantity: -10,
        tradePrice: 200,
        proceeds: 2000,
        commissions: -1,
        fifoPnlRealized: 100,
      })],
    },
    {
      id: 'preview-u23020202',
      name: 'U23020202',
      trades: [{
        accountId: 'U23020202',
        assetClass: 'OPT',
        symbol: 'SPX',
        underlyingSymbol: 'SPX',
        putCall: 'P',
        strike: 5000,
        expiry: '20250919',
        tradeDate: '20250919',
        tradeTime: '062000',
        quantity: 1,
        tradePrice: 0,
        proceeds: 0,
        commissions: 0,
        netCash: 0,
        openClose: 'C',
        fifoPnlRealized: 50,
      }],
    },
  ]
}

const tradeLabels: TradeLabels = {
  labels: {},
  setLabel: () => {},
  setMany: () => {},
  clearAll: () => {},
}

export function FyPreviewApp() {
  const accounts = useMemo(() => previewAccounts(), [])
  const [id, setId] = useState(accounts[0].id)
  const active = accounts.find(a => a.id === id) ?? accounts[0]
  return (
    <div className="ew-shell" style={{ height: 'auto', minHeight: '100vh', overflow: 'visible' }}>
      <aside style={{ width: 168, flex: '0 0 168px', padding: 16, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 8 }}>Accounts</div>
        {accounts.map(a => (
          <button
            key={a.id}
            onClick={() => setId(a.id)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', marginBottom: 6,
              padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)',
              background: a.id === active.id ? 'var(--accent-dim)' : 'transparent',
              color: 'var(--text-1)', cursor: 'pointer',
            }}
          >
            {a.name}
          </button>
        ))}
      </aside>
      <div className="ew-main" style={{ overflow: 'visible' }}>
        <main style={{ overflow: 'visible' }}>
          <AccountView
            account={active}
            loading={false}
            error={null}
            onUpload={() => {}}
            onClear={() => {}}
            onSyncFlex={() => {}}
            tradeLabels={tradeLabels}
            watchlistTickers={[]}
            sessionKey={null}
            expand
          />
        </main>
      </div>
    </div>
  )
}
