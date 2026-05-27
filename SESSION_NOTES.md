# Session Notes — Options Dashboard

## Last updated: 2026-05-27

## What's been built

### App structure
- React 19 + TypeScript + Vite 8
- Default tab: Dashboard
- Nav: Dashboard | Portfolio | Calendar | Strategies▾ | Scanner | Backtest | Plan
- Strategies dropdown: Label Trades + 13 strategy pages
- Trade labels stored in localStorage via `src/store/tradeLabelsStore.ts`

### Key files
- `src/App.tsx` — root, StrategyPage type, TradeLabels interface
- `src/components/layout/TopNav.tsx` — nav with Strategies dropdown
- `src/components/dashboard/DashboardView.tsx` — dashboard with P&L strip, income channels, actions sidebar
- `src/components/strategies/StrategiesView.tsx` — strategy router
- `src/components/strategies/CoveredCallsView.tsx` — CC trade log (expiry-based)
- `src/components/strategies/StrategyTradeLog.tsx` — generic spread-grouped trade log (SPX, CSP, LEAP, etc.)
- `src/components/strategies/TradeLabellerView.tsx` — manual label assignment + auto-label rules
- `src/store/tradeLabelsStore.ts` — localStorage label store
- `src/services/ibkr.ts` — IBKR Flex XML parser
- `src/index.css` — all CSS including .cc-*, .tl-*, .db-* classes

### Strategy trade log (StrategyTradeLog.tsx)
Columns match user's spreadsheet:
  Date Open | C | Strike Price | Expiry Date | Initial DTE | Price (Premium) | Transaction Fees | Opening Amount | Position Status | DTE | Profit / Loss

Grouping: legs with same tradeDate + expiry → one spread row
Expired rows: greyed out (opacity 0.38) with EXPIRED badge
Summary strip cards: Total Trades | Active | Expired | Open Premium | Realized P&L | Net Cash | Win Rate | Open Fees | Total Fees

### Income calculation logic
- Open Premium = netCash from sell legs (qty < 0) on non-expired trades only
- Realized P&L = netCash sum of expired trades
- Net Cash = all trades total (should match IBKR statement)
- Do NOT use openCloseIndicator — unreliable for index options
- Use expiry date vs today to determine active vs expired

### Auto-label rules (TradeLabellerView.tsx)
- SPX/SPXW underlying → label 'spx'
- Only applies to unlabelled trades (never overwrites manual labels)

### Git push method
Local proxy returns 403. Always use token URL directly:
```
git push https://<YOUR_GITHUB_TOKEN>@github.com/ashtonchan01/options.git main
```
(Token must be passed at runtime — do not store in repo.)

### Vercel deployment
Auto-deploys from main branch: https://options-jade.vercel.app

## Pending / next steps
- Covered Calls page (CoveredCallsView.tsx) uses same expiry-based logic but still has individual leg rows — consider applying SpreadTable grouping there too if user wants it
- SPX P&L for CLOSED positions (bought back before expiry) — currently pnl = openingAmount (assumes held to expiry); need to match open+close legs for accurate realized P&L on early closes
- Dashboard income channel cards may need to be wired to actual labeled trade data
