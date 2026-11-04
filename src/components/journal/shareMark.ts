/**
 * Stock Price vs Market Price on a journal row.
 *
 * For a share, both columns are the price of one share. Stock Price used to
 * be the live quote and Market Price the last Flex mark, so they drifted
 * as soon as the market moved after a sync (MSTR $143.10 live vs $130.76
 * marked). A share row is marked to the live quote — value and unrealised
 * follow — and if that quote never arrived both columns fall back to the
 * Flex per-share mark so they still agree.
 *
 * An option row is different: Stock Price is the underlying, Market Price
 * is the contract premium. Those stay on their own sources.
 */
export function journalMarks(args: {
  isShares: boolean
  contracts: number
  /** Live quote of the underlying. Null when the quote request missed. */
  underlyingPrice: number | null
  /** Mark value from the Flex snapshot. Null when no open IBKR leg matched. */
  ibkrMarketValue: number | null
  /** Share count, or contracts × 100 for an option. */
  units: number
}): { stockPrice: number | null; marketPrice: number | null; marketValue: number | null } {
  const { isShares, contracts, underlyingPrice, ibkrMarketValue, units } = args
  const ibkrPerShare = ibkrMarketValue != null && units !== 0 ? Math.abs(ibkrMarketValue) / Math.abs(units) : null
  if (!isShares) {
    return {
      stockPrice: underlyingPrice,
      marketPrice: ibkrPerShare,
      marketValue: ibkrMarketValue,
    }
  }
  if (underlyingPrice != null && underlyingPrice > 0 && Number.isFinite(underlyingPrice) && Number.isFinite(contracts)) {
    return {
      stockPrice: underlyingPrice,
      marketPrice: underlyingPrice,
      marketValue: contracts * underlyingPrice,
    }
  }
  return {
    stockPrice: ibkrPerShare,
    marketPrice: ibkrPerShare,
    marketValue: ibkrMarketValue,
  }
}
