/**
 * Yahoo Finance needs crypto tickers as "BTC-USD", "ETH-USD", etc. — a bare
 * "BTC" either resolves to nothing or to an unrelated equity ticker that
 * happens to share the symbol. This maps the plain ticker a user types into
 * a Watchlist/Scanner to the Yahoo symbol before hitting any quote/RSI
 * endpoint, and back again so results still key off the plain ticker the
 * rest of the app (and the user) actually typed.
 */
const CRYPTO_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'BNB', 'MATIC', 'LTC', 'DOT',
  'AVAX', 'LINK', 'UNI', 'ATOM', 'TRX', 'SHIB', 'BCH', 'XLM', 'ETC', 'FIL',
  'APT', 'ARB', 'OP', 'NEAR', 'ICP', 'HBAR', 'VET', 'ALGO', 'SUI', 'TON', 'PEPE',
])

export function toYahooSymbol(symbol: string): string {
  const sym = symbol.toUpperCase()
  return CRYPTO_TICKERS.has(sym) ? `${sym}-USD` : sym
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
