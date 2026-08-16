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

// Commodity/CFD aliases -> a Yahoo symbol. Oil/gas have no spot ticker on
// Yahoo, so those stay on the futures continuous-contract symbol (CL=F
// etc). Gold/silver do have a spot-rate ticker (XAUUSD=X / XAGUSD=X) that
// tracks the actual spot price CFD platforms quote as "GOLD"/"XAUUSD" —
// GC=F (COMEX futures) trades close to spot but not exactly on it.
const COMMODITY_ALIASES: Record<string, string> = {
  USOIL: 'CL=F', OIL: 'CL=F', WTI: 'CL=F',
  UKOIL: 'BZ=F', BRENT: 'BZ=F',
  NATGAS: 'NG=F',
  GOLD: 'XAUUSD=X', XAUUSD: 'XAUUSD=X', XAU: 'XAUUSD=X',
  SILVER: 'XAGUSD=X', XAGUSD: 'XAGUSD=X', XAG: 'XAGUSD=X',
}

// Index/CFD aliases -> Yahoo's "^"-prefixed index symbol. A bare "SPX" or
// "VIX" resolves to nothing on Yahoo — indices need the caret.
const INDEX_ALIASES: Record<string, string> = {
  SPX: '^GSPC', US500: '^GSPC', 'SPX500': '^GSPC',
  VIX: '^VIX',
  NDQ: '^NDX', NAS100: '^NDX', USTEC: '^NDX',
  DJI: '^DJI', US30: '^DJI',
  RUT: '^RUT', US2000: '^RUT',
}

export function toYahooSymbol(symbol: string): string {
  const sym = symbol.toUpperCase()
  if (CRYPTO_TICKERS.has(sym)) return `${sym}-USD`
  if (COMMODITY_ALIASES[sym]) return COMMODITY_ALIASES[sym]
  if (INDEX_ALIASES[sym]) return INDEX_ALIASES[sym]
  return sym
}

/** Normalizes a list of tickers to Yahoo symbols, and returns a lookup back
 * from Yahoo symbol to the original ticker so response keys can be
 * remapped. */
export function toYahooSymbols(symbols: string[]): { yahooSymbols: string[]; toOriginal: Record<string, string> } {
  const toOriginal: Record<string, string> = {}
  const yahooSymbols = symbols.map(s => {
    const y = toYahooSymbol(s)
    toOriginal[y] = s
    return y
  })
  return { yahooSymbols, toOriginal }
}

/** Remaps a Yahoo-symbol-keyed response back to plain-ticker keys. */
export function remapToOriginal<T>(data: Record<string, T>, toOriginal: Record<string, string>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [yahooSym, value] of Object.entries(data)) {
    out[toOriginal[yahooSym] ?? yahooSym] = value
  }
  return out
}
