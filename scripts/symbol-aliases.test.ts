/**
 * Index option roots must quote as Yahoo indices, and two roots that share
 * one index (SPX and SPXW) must both get that price back. Equities stay
 * on the ticker that was asked for.
 * Run with: npm test
 */
import { remapToOriginal, toYahooSymbol, toYahooSymbols } from '../src/services/symbolAliases'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

check('SPX quotes the S&P 500 index', toYahooSymbol('SPX') === '^GSPC')
check('SPXW weeklies quote the same index', toYahooSymbol('SPXW') === '^GSPC')
check('lowercase spx still maps', toYahooSymbol('spx') === '^GSPC')
check('NDX quotes the Nasdaq-100', toYahooSymbol('NDX') === '^NDX')
check('NDXP has no Yahoo listing and uses ^NDX', toYahooSymbol('NDXP') === '^NDX')
check('XSP quotes the mini S&P', toYahooSymbol('XSP') === '^XSP')
check('RUTW quotes the Russell 2000', toYahooSymbol('RUTW') === '^RUT')

for (const equity of ['AAPL', 'TSLA', 'GOOGL', 'NVDA', 'MSTR', 'BRK.B']) {
  check(`${equity} is not rewritten`, toYahooSymbol(equity) === equity)
}
check('crypto still maps to the -USD pair', toYahooSymbol('BTC') === 'BTC-USD')

const { yahooSymbols, toOriginal } = toYahooSymbols(['TSLA', 'SPX', 'SPXW', 'NDX', 'AAPL'])
check('shared index is requested once', yahooSymbols.filter(s => s === '^GSPC').length === 1, yahooSymbols.join(','))
check('equity order is preserved around the alias', yahooSymbols[0] === 'TSLA' && yahooSymbols.includes('AAPL'))

const prices = remapToOriginal(
  { '^GSPC': 7698.34, '^NDX': 28464.44, TSLA: 387.21, AAPL: 352.12 },
  toOriginal,
)
check('SPX and SPXW both receive the index price', prices.SPX === 7698.34 && prices.SPXW === 7698.34, JSON.stringify(prices))
check('NDX is keyed by the root, not the caret symbol', prices.NDX === 28464.44 && prices['^NDX'] == null)
check('equities in the same batch are unchanged', prices.TSLA === 387.21 && prices.AAPL === 352.12)

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
