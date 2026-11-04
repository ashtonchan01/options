/**
 * Yahoo Finance needs certain instruments under a different symbol than
 * what people actually type: crypto as "BTC-USD"/"ETH-USD", commodities/
 * CFDs as futures continuous-contract symbols like "CL=F" for US oil (WTI).
 * A bare "BTC" or "USOIL" either resolves to nothing or to an unrelated
 * equity ticker that happens to share the symbol. This maps the plain
 * ticker a user types into a Watchlist/Scanner to the Yahoo symbol before
 * hitting any quote/RSI endpoint, and back again so results still key off
 * the plain ticker the rest of the app (and the user) actually typed.
 */
const CRYPTO_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'BNB', 'MATIC', 'LTC', 'DOT',
  'AVAX', 'LINK', 'UNI', 'ATOM', 'TRX', 'SHIB', 'BCH', 'XLM', 'ETC', 'FIL',
  'APT', 'ARB', 'OP', 'NEAR', 'ICP', 'HBAR', 'VET', 'ALGO', 'SUI', 'TON', 'PEPE',
])

// Commodity/CFD aliases -> Yahoo's futures continuous-contract symbol.
// XAUUSD=X / XAGUSD=X (the forex-style spot ticker) consistently came back
// empty from Yahoo's public chart endpoint (verified against a live
// account), unlike the futures symbols — so despite trading at a slight
// premium to spot, GC=F/SI=F are what's actually reliable here.
const COMMODITY_ALIASES: Record<string, string> = {
  USOIL: 'CL=F', OIL: 'CL=F', WTI: 'CL=F',
  UKOIL: 'BZ=F', BRENT: 'BZ=F',
  NATGAS: 'NG=F',
  GOLD: 'GC=F', XAUUSD: 'GC=F', XAU: 'GC=F',
  SILVER: 'SI=F', XAGUSD: 'SI=F', XAG: 'SI=F',
  COPPER: 'HG=F', HG1: 'HG=F',
}

// Index roots -> Yahoo's "^"-prefixed index symbol. A bare "SPX", "NDX",
// or "XSP" resolves to nothing on Yahoo — indices need the caret. Option
// roots that don't have their own Yahoo listing (SPXW weeklies, NDXP/NDXW
// Nasdaq-100 options) quote the same index the strikes are on.
const INDEX_ALIASES: Record<string, string> = {
  SPX: '^GSPC', SPXW: '^GSPC', US500: '^GSPC', SPX500: '^GSPC',
  XSP: '^XSP',
  VIX: '^VIX',
  NDX: '^NDX', NDXP: '^NDX', NDXW: '^NDX', NDQ: '^NDX', NAS100: '^NDX', USTEC: '^NDX',
  DJI: '^DJI', US30: '^DJI', DJX: '^DJX',
  RUT: '^RUT', RUTW: '^RUT', US2000: '^RUT',
  OEX: '^OEX',
}

export function toYahooSymbol(symbol: string): string {
  // TradingView-style continuous-contract tickers (e.g. "HG1!" for front-
  // month COMEX copper) end in a bang the user might type verbatim — strip
  // it so "HG1!" and "HG1" both resolve to the same alias.
  const sym = symbol.toUpperCase().replace(/!$/, '')
  if (CRYPTO_TICKERS.has(sym)) return `${sym}-USD`
  if (COMMODITY_ALIASES[sym]) return COMMODITY_ALIASES[sym]
  if (INDEX_ALIASES[sym]) return INDEX_ALIASES[sym]
  return sym
}

/** Normalizes a list of tickers to Yahoo symbols, and returns a lookup back
 * from Yahoo symbol to every original ticker that asked for it. Several
 * roots share one index (SPX and SPXW are both ^GSPC); a single-slot map
 * would keep only the last of them and leave the other Stock Price blank. */
export function toYahooSymbols(symbols: string[]): { yahooSymbols: string[]; toOriginal: Record<string, string[]> } {
  const toOriginal: Record<string, string[]> = {}
  const yahooSymbols: string[] = []
  for (const s of symbols) {
    const y = toYahooSymbol(s)
    const originals = toOriginal[y]
    if (originals) originals.push(s)
    else {
      toOriginal[y] = [s]
      yahooSymbols.push(y)
    }
  }
  return { yahooSymbols, toOriginal }
}

/** Remaps a Yahoo-symbol-keyed response back to plain-ticker keys. Every
 * original that shared a Yahoo symbol gets the same quote. */
export function remapToOriginal<T>(data: Record<string, T>, toOriginal: Record<string, string[]>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [yahooSym, value] of Object.entries(data)) {
    const originals = toOriginal[yahooSym]
    if (!originals || originals.length === 0) out[yahooSym] = value
    else for (const orig of originals) out[orig] = value
  }
  return out
}
