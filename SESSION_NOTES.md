# Session Notes — Options Dashboard

## Last updated: 2026-06-12

---

## Live app
https://options-jade.vercel.app (auto-deploys from `main` branch on push)

## Repo
https://github.com/ashtonchan01/options

## Git push
```
cd /Users/ashtonchan/options && git push origin main
```
`gh` CLI is authenticated via keyring — no token needed. Just works.

## GitHub fine-grained token (saved at ~/.github_token)
Token NOT stored in this file (blocked by GitHub push protection) — it lives at `~/.github_token` on this machine.
(Note: this token returned 403 on git push but gh CLI works fine via keyring)

---

## To resume on another computer
```
git clone https://github.com/ashtonchan01/options.git
cd options
npm install
npm run dev
```

---

## App structure
- React 19 + TypeScript + Vite 8
- Default tab: Dashboard
- Nav: **left sidebar** (Edgewonk-style) — Dashboard | Portfolio | Calendar | Strategies (expandable: Label Trades + 11 pages) | Journal | Scanner | Backtest | Plan; sync status + upload/sync/settings/theme buttons in sidebar bottom block; mobile = fixed top bar + drawer
- Strategies▾ dropdown: ✏️ Label Trades + 13 strategy pages
- Trade labels stored in localStorage via `src/store/tradeLabelsStore.ts`
- IBKR Flex XML upload + live sync supported

## Key files
| File | Purpose |
|---|---|
| `src/App.tsx` | Root — `StrategyPage` type, `TradeLabels` interface, tab routing |
| `src/components/layout/Sidebar.tsx` | Edgewonk-style left sidebar — exports `TAB_IDS`/`TabId`; expandable Strategies section; mobile drawer (TopNav.tsx deleted) |
| `src/components/dashboard/DashboardView.tsx` | Dashboard: key metrics, income channel strip, stocks table, options table (strategy-grouped), cash, actions sidebar |
| `src/components/strategies/StrategiesView.tsx` | Strategy sub-router — all 13 pages incl. covered_calls now use StrategyTradeLog |
| `src/components/strategies/StrategyTradeLog.tsx` | Main trade log — position-matched rows, spreadsheet-style |
| `src/components/strategies/CoveredCallsView.tsx` | UNUSED — CC page now routes through StrategyTradeLog |
| `src/components/strategies/TradeLabellerView.tsx` | Manual label UI + auto-label rules (SPX/SPXW → spx) |
| `src/store/tradeLabelsStore.ts` | localStorage label store |
| `src/engine/classifier.ts` | Classifies open positions → Strategy[] (spread → CC → PMCC → RR → CSP → LEAP → other) |
| `src/engine/actions.ts` | Generates action recommendations |
| `src/index.css` | All CSS — Edgewonk theme (dark slate + emerald) |
| `src/engine/journal.ts` | Journal engine — position matching (same semantics as StrategyTradeLog), KPI stats, equity curve, breakdowns, Edge Finder insights |
| `src/store/journalStore.ts` | localStorage journal entries (setup/mistakes/rating/note per position) + custom setups |
| `src/components/journal/JournalView.tsx` | Journal tab — Overview / Trade Journal / Psych Lab sub-views |

---

## Theme — Edgewonk (dark slate + emerald), since 2026-06-12
- Dark (default, matches Edgewonk app): page `#0f172a`, sidebar `#0c1424`, cards `#1a2438`, slate borders/text ramp
- Accent: emerald `#10b981` (Edgewonk brand, scraped from edgewonk.com: #059669/#047857/#10b981); loss `#ef4444`; warn `#f59e0b`; secondary blue `#3b82f6`
- Light mode: edgewonk.com marketing palette (white surfaces, `#f8fafc` page, `#059669` accent)
- Font: **Inter** only — loaded via `<link>` in `index.html` (NOT CSS `@import` — Tailwind/lightningcss drops it); `.mono` = Inter + `font-variant-numeric: tabular-nums`
- Cards: 12px radius, 1px slate border; no glass/glow/bracket effects (all JARVIS HUD chrome removed)
- Layout: `.ew-shell` (flex row) = `Sidebar` + `.ew-main`; sidebar 230px, `--bg-sidebar`, expandable Strategies, bottom block (sync dot + icon buttons); mobile: `.ew-mobilebar` fixed top + drawer (`.ew-sidebar.open`)
- All in CSS variables in `src/index.css` `:root` block; Edgewonk shell CSS at bottom of file

---

## Journal tab (Edgewonk-style, added 2026-06-12)
Three sub-views, all driven by Flex-synced trades (OPT only, premium-selling semantics):
1. **Overview** — KPI strip (Net P&L, Win Rate, Profit Factor, Expectancy, Avg Win/Loss, Payoff, Max Drawdown), streak/fees mini-strip, equity curve SVG, monthly P&L bars, **Edge Finder** (auto-generated strengths/weaknesses), breakdown tables (underlying / strategy label / entry weekday / entry DTE / hold time)
2. **Trade Journal** — filterable position list (All/Wins/Losses/Active/Unreviewed); click row to expand editor: setup (select + custom add), mistake chips, 1–5 execution grade (◆), notes. Persisted to localStorage `options:journal` keyed by position id `${tradeDate}|${expiry}|${underlying}` (stable across re-syncs)
3. **Psych Lab** — Tiltmeter gauge (last 10 graded trades: avg grade − 9/mistake → 0-100), Discipline Edge cards (avg P&L grade≥4 vs ≤2), grade distribution, mistake cost table
- Closed-trade timeline uses `dateClosed` (expiry date for expired positions)
- Strategy attribution comes from trade labels (Label Trades page) via opening-leg trade ids

---

## Dashboard — what's on it
1. **Key metrics strip** — Net Liquidation, Unrealized P&L, Realized P&L, Cash (Base)
2. **Income channel strip** — per-strategy cards (Open, Realized, Total P&L, Win Rate) — only shows when trades are labelled
3. **Stocks table** — Ticker | Shares | Avg Cost | Last | Market Value | Unrealized P&L | %
4. **Options table** — grouped by strategy type with coloured badges (Covered Call, PMCC, Risk Reversal, Put Spread, CSP, LEAP). IBKR-style descriptions: `MSTR Jan18'26 180 CALL`
5. **Cash** — Base USD
6. **Actions sidebar** — urgent/manage/opportunity recommendations from engine

---

## StrategyTradeLog — position matching logic

Each row = one complete position (open legs + matched close legs).

### Grouping
- Trades grouped by `(tradeDate, expiry, underlyingSymbol)` → one "open group"
- Groups with sell legs (qty < 0) = position openers
- Groups with only buy legs (qty > 0) = position closers
- Closers matched to openers by same `expiry + underlying`, later date (FIFO)

### Close Price
- Net debit per share: `|closeNetCash| / contracts / 100` (matches openPrice logic, correct for spreads)

### Closing Amount
- `Math.abs(closeNetCash)` — netCash already includes commissions, no double-count

### P&L calculation
- **Expired worthless** → P&L = openingNetCash (full credit kept)
- **Closed early** → P&L = openingNetCash + closeNetCash
- **Active** → P&L not shown

---

## Income / premium calculation rules
- **DO NOT use `openCloseIndicator`** — unreliable for SPX/index options (IBKR marks everything as 'O')
- Use **expiry date vs today** to determine active vs expired
- **Open Premium** = netCash from sell legs (qty < 0) on non-expired trades
- **Realized P&L** = sum of pnl from closed + expired positions

---

## Trade labelling
- Manual: user assigns each trade to a strategy in Label Trades page
- Auto-label rule: `underlyingSymbol` starts with SPX or SPXW → label `'spx'`
- Auto-label only applies to unlabelled trades — never overwrites manual labels
- Labels stored in localStorage key `options:tradeLabels`
- Trade ID format: `${tradeDate}|${symbol}|${quantity}|${tradePrice}`

---

## Strategy classifier priority (src/engine/classifier.ts)
1. Spreads (same underlying, same expiry, same putCall, opposing qty)
2. Covered Calls (short call + ≥100 shares)
3. PMCC (short call + long LEAP call, same underlying, later expiry)
4. Risk Reversals (short put + long call, ±30d expiry, different strikes)
5. CSPs (remaining short puts)
6. LEAPs (long options DTE > 365)
7. Other

---

## Strategy pages (all use StrategyTradeLog now)
| Page | ID | Auto-detect filter |
|---|---|---|
| covered_calls | CC | OPT + putCall=C |
| csp | CSP | OPT + putCall=P |
| leap | LEAP | OPT + qty > 0 |
| spx | SPX | underlyingSymbol starts with SPX/SPXW |
| rotation | ROT | STK |
| ptos | PTOS | OPT + putCall=P + qty > 0 |
| dcas | DCAS | STK + qty > 0 |
| profit_taking | PT | netCash > 0 + openClose='C' |
| lilo | LILO | OPT |
| arb_cloud | ARB | OPT + putCall=C + qty > 0 |
| tabi | TABI | OPT |
| forex | FX | — |
| assignment | ASSIGN | — |

---

## Live Activity (IB Gateway, added 2026-07-24)
Flex Web Service data is inherently ~1 day stale (IBKR generates statements on a schedule, no intraday option for most reports). To see today's fills before Flex catches up:

1. Start IB Gateway (Client Portal Gateway) on the Mac, log in — it listens on `https://localhost:5000`
2. Start the local proxy: `node server/flex-proxy.cjs` (now also serves `GET /live/trades`, proxying `https://localhost:5000/v1/api/iserver/account/trades`)
3. Start ngrok: `ngrok http 3457`
4. Copy the ngrok URL (e.g. `https://xxxx.ngrok-free.app`) into the app: Settings → Live Proxy URL. Rotates every ngrok restart — update it each session.
5. Dashboard now shows a **Live Activity** card (today's fills, polls every 45s) and a pinned banner in Actions when fills exist after the last Flex sync timestamp.

**Scope note**: CPAPI trades only return `conid`/`symbol`/side/size/price — no strike/expiry/putCall breakdown. So live trades are informational-only (staleness flag + activity feed); they do NOT feed the classifier/position-matching/journal, which still needs Flex's structured fields. Full replacement would require resolving `conid` → contract detail via a `/trsrv/secdef` lookup — not built yet.

**Untested**: the `/live/trades` endpoint and CPAPI field names (`trade_time`, `order_description`, etc.) were written against IBKR's documented CPAPI shape but not verified against a live Gateway session — check the browser console / proxy terminal output if it errors, and the field mapping in `handleLiveTrades()` in `server/flex-proxy.cjs` may need adjusting to match what your Gateway actually returns.


## Pending / next steps

1. **Week column** — removed from StrategyTradeLog; user may want back as grouping/filter
2. **Income channel strip** — only visible when trades are labelled; consider showing raw totals when no labels
