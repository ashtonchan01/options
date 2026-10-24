/** One ticker → colour map for Income chips, the expiry timeline, and the crypto gauge. */
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
