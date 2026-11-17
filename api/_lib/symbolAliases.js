/** Server-side Yahoo symbol aliases (subset of src/services/symbolAliases.ts). */
const INDEX_ALIASES = {
  SPX: '^GSPC', SPXW: '^GSPC',
}

export function toYahooSymbol(symbol) {
  const sym = String(symbol).toUpperCase().replace(/!$/, '')
  return INDEX_ALIASES[sym] ?? sym
}