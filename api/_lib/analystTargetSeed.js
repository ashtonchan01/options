/** Upsert-safe seed rows for institutional analyst price targets. */
export const ANALYST_TARGET_SEEDS = [
  // SPCX — 2026-11-16, BUY
  { seed_key: 'spcx-adam-jonas-2026-11-16', ticker: 'SPCX', analyst_name: 'Adam Jonas', firm: 'Morgan Stanley', star_rating: 4, rating: 'BUY', price_target: 300, previous_target: null, action: 'Assigned', target_date: '2026-11-16', source_note: null },
  { seed_key: 'spcx-douglas-h-2026-11-16', ticker: 'SPCX', analyst_name: 'Douglas H.', firm: 'Bernstein', star_rating: 4, rating: 'BUY', price_target: 268, previous_target: null, action: 'Reiterated', target_date: '2026-11-16', source_note: null },
  { seed_key: 'spcx-gavin-pars-2026-11-16', ticker: 'SPCX', analyst_name: 'Gavin Pars.', firm: 'UBS', star_rating: 4, rating: 'BUY', price_target: 230, previous_target: null, action: 'Reiterated', target_date: '2026-11-16', source_note: null },
  { seed_key: 'spcx-ronald-ep-2026-11-16', ticker: 'SPCX', analyst_name: 'Ronald Ep.', firm: 'Bank of America', star_rating: 5, rating: 'BUY', price_target: 275, previous_target: null, action: 'Reiterated', target_date: '2026-11-16', source_note: null },
  { seed_key: 'spcx-jeffrey-wl-2026-11-16', ticker: 'SPCX', analyst_name: 'Jeffrey Wl.', firm: 'Pivotal Research', star_rating: 4, rating: 'BUY', price_target: 260, previous_target: null, action: 'Reiterated', target_date: '2026-11-16', source_note: null },
  { seed_key: 'spcx-john-godyn-2026-11-16', ticker: 'SPCX', analyst_name: 'John Godyn', firm: 'Citi', star_rating: 1, rating: 'BUY', price_target: 280, previous_target: 240, action: 'Assigned', target_date: '2026-11-16', source_note: null },
  { seed_key: 'spcx-kenneth-h-2026-11-16', ticker: 'SPCX', analyst_name: 'Kenneth H.', firm: 'RBC Capital', star_rating: 5, rating: 'BUY', price_target: 225, previous_target: null, action: 'Reiterated', target_date: '2026-11-16', source_note: null },
  // Goldman Sachs — 2026-11-13, BUY, analyst blank
  { seed_key: 'gs-spcx-2026-11-13', ticker: 'SPCX', analyst_name: null, firm: 'Goldman Sachs', star_rating: null, rating: 'BUY', price_target: 245, previous_target: null, action: 'Reiterated', target_date: '2026-11-13', source_note: 'Goldman Sachs AI names, as posted on X' },
  { seed_key: 'gs-mrvl-2026-11-13', ticker: 'MRVL', analyst_name: null, firm: 'Goldman Sachs', star_rating: null, rating: 'BUY', price_target: 270, previous_target: null, action: 'Reiterated', target_date: '2026-11-13', source_note: 'Goldman Sachs AI names, as posted on X' },
  { seed_key: 'gs-lrcx-2026-11-13', ticker: 'LRCX', analyst_name: null, firm: 'Goldman Sachs', star_rating: null, rating: 'BUY', price_target: 380, previous_target: null, action: 'Reiterated', target_date: '2026-11-13', source_note: 'Goldman Sachs AI names, as posted on X' },
  { seed_key: 'gs-mu-2026-11-13', ticker: 'MU', analyst_name: null, firm: 'Goldman Sachs', star_rating: null, rating: 'BUY', price_target: 1250, previous_target: null, action: 'Reiterated', target_date: '2026-11-13', source_note: 'Goldman Sachs AI names, as posted on X' },
  { seed_key: 'gs-avgo-2026-11-13', ticker: 'AVGO', analyst_name: null, firm: 'Goldman Sachs', star_rating: null, rating: 'BUY', price_target: 540, previous_target: null, action: 'Reiterated', target_date: '2026-11-13', source_note: 'Goldman Sachs AI names, as posted on X' },
  { seed_key: 'gs-nvda-2026-11-13', ticker: 'NVDA', analyst_name: null, firm: 'Goldman Sachs', star_rating: null, rating: 'BUY', price_target: 220, previous_target: null, action: 'Reiterated', target_date: '2026-11-13', source_note: 'Goldman Sachs AI names, as posted on X' },
  { seed_key: 'gs-amd-2026-11-13', ticker: 'AMD', analyst_name: null, firm: 'Goldman Sachs', star_rating: null, rating: 'BUY', price_target: 675, previous_target: null, action: 'Reiterated', target_date: '2026-11-13', source_note: 'Goldman Sachs AI names, as posted on X' },
]

export async function seedAnalystPriceTargets(db) {
  for (const row of ANALYST_TARGET_SEEDS) {
    await db`
      INSERT INTO analyst_price_targets (
        seed_key, ticker, analyst_name, firm, star_rating, rating,
        price_target, previous_target, action, target_date, source_note
      ) VALUES (
        ${row.seed_key},
        ${row.ticker},
        ${row.analyst_name},
        ${row.firm},
        ${row.star_rating},
        ${row.rating},
        ${row.price_target},
        ${row.previous_target},
        ${row.action},
        ${row.target_date},
        ${row.source_note}
      )
      ON CONFLICT (seed_key) DO UPDATE SET
        ticker = EXCLUDED.ticker,
        analyst_name = EXCLUDED.analyst_name,
        firm = EXCLUDED.firm,
        star_rating = EXCLUDED.star_rating,
        rating = EXCLUDED.rating,
        price_target = EXCLUDED.price_target,
        previous_target = EXCLUDED.previous_target,
        action = EXCLUDED.action,
        target_date = EXCLUDED.target_date,
        source_note = EXCLUDED.source_note,
        updated_at = now()
    `
  }
}