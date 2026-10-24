/**
 * Shared key for a long call + short put booked under different symbols.
 * Allocation uses this so a call booked as BABA and a put booked as the
 * Hong Kong board code 9988 (or BIDU / 9888) are one ticker.
 * A blank underlying falls through to the OCC root, not the whole contract.
 */
import type { RawPosition } from '../types'

const HK_LISTING_TO_ADR: Record<string, string> = {
  '9988': 'BABA',
  '9888': 'BIDU',
}

/** OCC root + right, e.g. "BABA  270115C00120000" or "9988  270115P00090000". */
export function occContract(symbol: string): { root: string; putCall: 'C' | 'P' } | null {
  const m = symbol.trim().toUpperCase().match(/^([A-Z0-9][A-Z0-9.]{0,5})\s*(\d{6})([CP])(\d{8})$/)
  if (!m) return null
  return { root: m[1], putCall: m[3] as 'C' | 'P' }
}

export function adrTicker(root: string): string {
  return HK_LISTING_TO_ADR[root] ?? root
}

/** Ticker IBKR put on this leg, before the HK→ADR alias. */
export function rawOptionUnderlying(p: RawPosition): string {
  const under = (p.underlyingSymbol ?? '').trim()
  const underOcc = under ? occContract(under) : null
  if (under && !underOcc) return under.split(/\s+/)[0]!.toUpperCase()
  const fromSymbol = occContract(p.symbol)
  if (fromSymbol) return fromSymbol.root
  if (underOcc) return underOcc.root
  return (under || p.symbol).trim().split(/\s+/)[0]?.toUpperCase() ?? p.symbol
}

export function optionRight(p: RawPosition): 'C' | 'P' | undefined {
  if (p.putCall === 'C' || p.putCall === 'P') return p.putCall
  return occContract(p.symbol)?.putCall ?? (p.underlyingSymbol ? occContract(p.underlyingSymbol)?.putCall : undefined)
}
