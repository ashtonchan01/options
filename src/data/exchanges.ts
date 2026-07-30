/**
 * Major global equity exchanges/indices shown on the Markets map.
 * lat/lon are the exchange's city (for plotting on the world map).
 * Trading hours are local exchange time, Mon–Fri, no holiday calendar
 * (US holidays are cross-checked against HOLIDAY_MAP separately).
 */

export interface Exchange {
  symbol: string       // Yahoo Finance symbol
  name: string         // index name shown in UI
  city: string
  country: string
  lat: number
  lon: number
  timezone: string     // IANA timezone of the exchange
  openMin: number      // minutes after local midnight
  closeMin: number
  /** Overrides the map-clustering key when a city sits too close to another
   * to render as a separate dot at world-map scale (e.g. Shenzhen/Hong Kong). */
  mapGroup?: string
}

export const EXCHANGES: Exchange[] = [
  { symbol: '^DJI',      name: 'Dow Jones',       city: 'New York',   country: 'US', lat: 40.71, lon: -74.01, timezone: 'America/New_York',    openMin: 9 * 60 + 30, closeMin: 16 * 60 },
  { symbol: '^GSPC',     name: 'S&P 500',         city: 'New York',   country: 'US', lat: 40.71, lon: -74.01, timezone: 'America/New_York',    openMin: 9 * 60 + 30, closeMin: 16 * 60 },
  { symbol: '^IXIC',     name: 'Nasdaq',          city: 'New York',   country: 'US', lat: 40.71, lon: -74.01, timezone: 'America/New_York',    openMin: 9 * 60 + 30, closeMin: 16 * 60 },
  { symbol: '^GSPTSE',   name: 'TSX',             city: 'Toronto',    country: 'CA', lat: 43.65, lon: -79.38, timezone: 'America/Toronto',      openMin: 9 * 60 + 30, closeMin: 16 * 60 },
  { symbol: '^BVSP',     name: 'Bovespa',         city: 'Sao Paulo',  country: 'BR', lat: -23.55, lon: -46.63, timezone: 'America/Sao_Paulo',   openMin: 10 * 60,     closeMin: 17 * 60 },
  { symbol: '^FTSE',     name: 'FTSE 100',        city: 'London',     country: 'UK', lat: 51.51, lon: -0.13,  timezone: 'Europe/London',        openMin: 8 * 60,      closeMin: 16 * 60 + 30 },
  { symbol: '^FCHI',     name: 'CAC 40',          city: 'Paris',      country: 'FR', lat: 48.85, lon: 2.35,   timezone: 'Europe/Paris',         openMin: 9 * 60,      closeMin: 17 * 60 + 30 },
  { symbol: '^GDAXI',    name: 'DAX',             city: 'Frankfurt',  country: 'DE', lat: 50.11, lon: 8.68,  timezone: 'Europe/Berlin',        openMin: 9 * 60,      closeMin: 17 * 60 + 30 },
  { symbol: 'FTSEMIB.MI',name: 'FTSE MIB',        city: 'Milan',      country: 'IT', lat: 45.46, lon: 9.19,  timezone: 'Europe/Rome',          openMin: 9 * 60,      closeMin: 17 * 60 + 30 },
  { symbol: 'IMOEX.ME',  name: 'MOEX',            city: 'Moscow',     country: 'RU', lat: 55.75, lon: 37.62, timezone: 'Europe/Moscow',        openMin: 9 * 60 + 50, closeMin: 18 * 60 + 50 },
  { symbol: '^N225',     name: 'Nikkei 225',      city: 'Tokyo',      country: 'JP', lat: 35.68, lon: 139.69,timezone: 'Asia/Tokyo',           openMin: 9 * 60,      closeMin: 15 * 60 },
  { symbol: '000001.SS', name: 'Shanghai',        city: 'Shanghai',   country: 'CN', lat: 31.23, lon: 121.47,timezone: 'Asia/Shanghai',        openMin: 9 * 60 + 30, closeMin: 15 * 60 },
  { symbol: '^HSI',      name: 'Hang Seng',       city: 'Hong Kong',  country: 'HK', lat: 22.32, lon: 114.17,timezone: 'Asia/Hong_Kong',       openMin: 9 * 60 + 30, closeMin: 16 * 60 },
  { symbol: '399001.SZ', name: 'Shenzhen',        city: 'Shenzhen',   country: 'CN', lat: 22.54, lon: 114.06,timezone: 'Asia/Shanghai',        openMin: 9 * 60 + 30, closeMin: 15 * 60, mapGroup: 'Hong Kong|HK' },
  { symbol: '^TWII',     name: 'Taiwan Weighted', city: 'Taipei',     country: 'TW', lat: 25.03, lon: 121.57,timezone: 'Asia/Taipei',          openMin: 9 * 60,      closeMin: 13 * 60 + 30 },
  { symbol: '^KLSE',     name: 'Malaysia (KLCI)', city: 'Kuala Lumpur',country: 'MY',lat: 3.14,  lon: 101.69,timezone: 'Asia/Kuala_Lumpur',    openMin: 9 * 60,      closeMin: 17 * 60 },
  { symbol: '^STI',      name: 'Singapore (STI)', city: 'Singapore',  country: 'SG', lat: 1.35,  lon: 103.82,timezone: 'Asia/Singapore',       openMin: 9 * 60,      closeMin: 17 * 60 },
  { symbol: '^BSESN',    name: 'Sensex',          city: 'Mumbai',     country: 'IN', lat: 19.08, lon: 72.88, timezone: 'Asia/Kolkata',         openMin: 9 * 60 + 15, closeMin: 15 * 60 + 30 },
  { symbol: '^AXJO',     name: 'ASX 200',         city: 'Sydney',     country: 'AU', lat: -33.87,lon: 151.21,timezone: 'Australia/Sydney',     openMin: 10 * 60,     closeMin: 16 * 60 },
]
