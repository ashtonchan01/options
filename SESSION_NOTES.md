# Session Notes — Options Dashboard

## Last updated: 2026-05-28

---

## Live app
https://options-jade.vercel.app (auto-deploys from `main` branch)

## Repo
https://github.com/ashtonchan01/options

## To resume on another computer
```
git clone https://github.com/ashtonchan01/options.git
cd options
npm install
npm run dev
```

---

## What's been built

### App structure
- React 19 + TypeScript + Vite 8
- Default tab: Dashboard
- Nav: Dashboard | Portfolio | Calendar | Strategies▾ | Scanner | Backtest | Plan
- Strategies▾ dropdown: ✏️ Label Trades + 13 strategy pages
- Trade labels stored in localStorage via `src/store/tradeLabelsStore.ts`
- IBKR Flex XML upload + live sync supported

### Key files
| File | Purpose |
|---|---|
| `src/App.tsx` | Root — `StrategyPage` type, `TradeLabels` interface, tab routing |
| `src/components/layout/TopNav.tsx` | Nav bar with Strategies dropdown |
| `src/components/dashboard/DashboardView.tsx` | Dashboard: P&L strip, 11 income channel cards, portfolio snapshot, actions sidebar |
| `src/components/strategies/StrategiesView.tsx` | Strategy sub-router — routes to correct page per `stratPage` |
| `src/components/strategies/StrategyTradeLog.tsx` | **Main trade log** — position-matched rows, spreadsheet-style (see below) |
| `src/components/strategies/CoveredCallsView.tsx` | CC-specific trade log (expiry-based, individual legs) |
| `src/components/strategies/TradeLabellerView.tsx` | Manual label UI + auto-label rules (e.g. SPX/SPXW → spx) |
| `src/store/tradeLabelsStore.ts` | localStorage label store |
| `src/services/ibkr.ts` | IBKR Flex XML parser — reads `ibCommission`, `netCash`, `openCloseIndicator`, etc. |
| `src/index.css` | All CSS — `.cc-*`, `.tl-*`, `.db-*` classes |

---

## StrategyTradeLog — position matching logic

Each row = one **complete position** (open legs + matched close legs).

### Grouping
- Trades grouped by `(tradeDate, expiry, underlyingSymbol)` → one "open group"
- Groups with sell legs (qty < 0) = position openers
- Groups with only buy legs (qty > 0) = position closers
- Closers matched to openers by same `expiry + underlying`, later date (FIFO)

### Table columns (current)
**OPENING:** # | Ticker | Date Open | Strategy | C | Strike | Expiry | Price | Open Fees | Net Premium | BEP

**CURRENT:** Status | DTE

**CLOSING:** Date Closed | Close Price | Close Fees | Closing Amt

**P&L:** Profit / Loss

### Status badges
- **Active** — green badge, full row colour
- **Closed** — amber badge, full row colour
- **Expired** — grey badge text only, full row colour (NOT greyed out)

### P&L calculation
- **Expired worthless** → P&L = Net Premium (full credit kept)
- **Closed early** → P&L = Net Premium − Closing Amount
- **Active** → P&L not shown (position still open)

### Summary strip cards
Positions | Active | Closed | Expired | Open Premium | Realized P&L | Total P&L | Win Rate | Open Fees | Total Fees

---

## Income / premium calculation rules
- **DO NOT use `openCloseIndicator`** — unreliable for SPX/index options (IBKR marks everything as 'O')
- Use **expiry date vs today** to determine active vs expired
- **Open Premium** = netCash from sell legs (qty < 0) on non-expired trades
- **Realized P&L** = sum of `pnl` from closed + expired positions
- **Net Cash** = all trades total (matches IBKR statement — user confirmed $2,254.64)
- **Open Fees** = commissions on active (non-expired) trades only
- User reference: 1 SPX spread = ~$3.28 fees, 2 spreads = ~$5.16 fees

---

## Trade labelling
- Manual: user assigns each trade to a strategy in Label Trades page
- Auto-label rule: `underlyingSymbol` starts with SPX or SPXW → label `'spx'`
- Auto-label only applies to **unlabelled** trades — never overwrites manual labels
- Labels stored in localStorage key `options:tradeLabels`
- Trade ID format: `${tradeDate}|${symbol}|${quantity}|${tradePrice}`

---

## Strategy pages
| Page | Strategy ID | Auto-detect filter (fallback) |
|---|---|---|
| covered_calls | CC | OPT + putCall=C |
| csp | CSP | OPT + putCall=P |
| leap | LEAP | OPT + qty > 0 (long options) |
| spx | SPX | underlyingSymbol starts with SPX/SPXW |
| rotation | ROT | — |
| ptos | PTOS | — |
| dcas | DCAS | — |
| profit_taking | PT | — |
| lilo | LILO | — |
| arb_cloud | ARB | OPT + putCall=C + qty > 0 |
| tabi | TABI | OPT |
| forex | FX | — |
| assignment | ASSIGN | — |

---

## Git push
Local proxy returns 403. Must use token URL:
```
git push https://<YOUR_GITHUB_TOKEN>@github.com/ashtonchan01/options.git main
```
(Do not store token in repo — pass at runtime.)

---

## Pending / next steps
1. **CoveredCallsView.tsx** — still shows individual legs, not position-matched rows. Consider applying same `buildPositions()` logic from StrategyTradeLog.
2. **Closing Amount calculation** — currently `Math.abs(closeNetCash) + closeFees` which may double-count fees since `netCash` already includes commissions. Verify against user's IBKR data.
3. **Close Price column** — currently averages all close leg prices. For spreads this is misleading; consider showing per-leg or net credit instead.
4. **Dashboard income channel cards** — not yet wired to labeled trade data (showing placeholder values).
5. **Week column** — removed from table; user may want it back as a grouping/filter.
