/** One ticker → colour map for the Overview Ideas, Puts, and Calls chips. */
const KNOWN: Record<string, string> = {
  BTC: '#f7931a',
  MSTR: '#a78bfa',
  BSOL: '#14f195',
  IBIT: '#4a72d4',
}

export function tickerColor(symbol: string): string {
  const key = symbol.trim().toUpperCase()
  if (KNOWN[key]) return KNOWN[key]
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 33 + key.charCodeAt(i)) % 360
  return `hsl(${hash}, 62%, 62%)`
}
