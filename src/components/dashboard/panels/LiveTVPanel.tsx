/**
 * Embedded 24/7 news channel via YouTube iframe, with a region-grouped
 * switcher — channel list and video IDs sourced from World Monitor's
 * open-source default channel list (github.com/koala73/worldmonitor,
 * src/components/LiveNewsPanel.ts) rather than guessed IDs.
 */
import { useState } from 'react'

type Region = 'na' | 'eu' | 'latam' | 'asia' | 'me' | 'africa' | 'oceania'

const REGIONS: { id: Region; label: string }[] = [
  { id: 'na',      label: 'N. America' },
  { id: 'eu',      label: 'Europe' },
  { id: 'latam',   label: 'Latin America' },
  { id: 'asia',    label: 'Asia' },
  { id: 'me',      label: 'Middle East' },
  { id: 'africa',  label: 'Africa' },
  { id: 'oceania', label: 'Oceania' },
]

/** Fixed known-live 24/7 stream video IDs — same approach World Monitor uses
 * as its fallback (a channel's persistent livestream keeps the same video ID
 * even as content moves on, so this doesn't go stale like a random clip would). */
const CHANNELS: { id: string; name: string; region: Region; videoId: string }[] = [
  { id: 'bloomberg',   name: 'Bloomberg',        region: 'na',      videoId: 'iEpJwprxDdk' },
  { id: 'cnbc',        name: 'CNBC',             region: 'na',      videoId: '9NyxcX3rhQs' },
  { id: 'yahoo',       name: 'Yahoo Finance',    region: 'na',      videoId: 'KQp-e_XQnDE' },
  { id: 'cnn',         name: 'CNN',              region: 'na',      videoId: 'w_Ma8oQLmSM' },
  { id: 'foxnews',     name: 'Fox News',         region: 'na',      videoId: 'QaftgYkG-ek' },
  { id: 'newsmax',     name: 'Newsmax',          region: 'na',      videoId: 'S-lFBzloL2Y' },
  { id: 'cbs',         name: 'CBS News',         region: 'na',      videoId: 'R9L8sDK8iEc' },
  { id: 'nbc',         name: 'NBC News',         region: 'na',      videoId: 'yMr0neQhu6c' },
  { id: 'cbc',         name: 'CBC News',         region: 'na',      videoId: 'jxP_h3V-Dv8' },
  { id: 'sen',         name: 'Sen Space Live',   region: 'na',      videoId: 'aB1yRz0HhdY' },

  { id: 'sky',         name: 'Sky News',         region: 'eu',      videoId: 'uvviIF4725I' },
  { id: 'euronews',    name: 'Euronews',         region: 'eu',      videoId: 'pykpO5kQJ98' },
  { id: 'dw',          name: 'DW',               region: 'eu',      videoId: 'LuKwFajn37U' },
  { id: 'france24',    name: 'France 24',        region: 'eu',      videoId: 'u9foWyMSETk' },
  { id: 'bbc',         name: 'BBC News',         region: 'eu',      videoId: 'bjgQzJzCZKs' },
  { id: 'france24en',  name: 'France 24 English',region: 'eu',      videoId: 'Ap-UM1O9RBU' },
  { id: 'rtve',        name: 'RTVE 24H',         region: 'eu',      videoId: '7_srED6k0bE' },
  { id: 'trthaber',    name: 'TRT Haber',        region: 'eu',      videoId: '3XHebGJG0bc' },
  { id: 'ntv',         name: 'NTV',              region: 'eu',      videoId: 'pqq5c6k70kk' },
  { id: 'cnnturk',     name: 'CNN Türk',         region: 'eu',      videoId: 'lsY4GFoj_xY' },
  { id: 'tvpinfo',     name: 'TVP Info',         region: 'eu',      videoId: '3jKb-uThfrg' },
  { id: 'telewrep',    name: 'Telewizja Republika', region: 'eu',   videoId: 'dzntyCTgJMQ' },
  { id: 'welt',        name: 'WELT',             region: 'eu',      videoId: 'L-TNmYmaAKQ' },
  { id: 'tagesschau',  name: 'Tagesschau24',     region: 'eu',      videoId: 'fC_q9TkO1uU' },
  { id: 'euronewsfr',  name: 'Euronews FR',      region: 'eu',      videoId: 'NiRIbKwAejk' },
  { id: 'france24fr',  name: 'France 24 FR',     region: 'eu',      videoId: 'l8PMl7tUDIE' },
  { id: 'franceinfo',  name: 'France Info',      region: 'eu',      videoId: 'Z-Nwo-ypKtM' },
  { id: 'bfmtv',       name: 'BFMTV',            region: 'eu',      videoId: 'smB_F6DW7cI' },

  { id: 'cnnbrasil',   name: 'CNN Brasil',       region: 'latam',   videoId: 'qcTn899skkc' },
  { id: 'tn',          name: 'TN (Todo Noticias)', region: 'latam', videoId: 'cb12KmMMDJA' },
  { id: 'c5n',         name: 'C5N',              region: 'latam',   videoId: 'SF06Qy1Ct6Y' },

  { id: 'tbs',         name: 'TBS NEWS DIG',     region: 'asia',    videoId: 'aUDm173E8k8' },
  { id: 'cna',         name: 'CNA',              region: 'asia',    videoId: 'XWq5kBlakcQ' },
  { id: 'nhk',         name: 'NHK World Japan',  region: 'asia',    videoId: 'f0lYfG_vY_U' },
  { id: 'indiatoday',  name: 'India Today',      region: 'asia',    videoId: 'sYZtOFzM78M' },

  { id: 'alarabiya',   name: 'Al Arabiya',       region: 'me',      videoId: 'n7eQejkXbnM' },
  { id: 'aljazeera',   name: 'Al Jazeera',       region: 'me',      videoId: 'gCNeDWCI0vo' },
  { id: 'alhadath',    name: 'Al Hadath',        region: 'me',      videoId: 'xWXpl7azI8k' },
  { id: 'skyarabia',   name: 'Sky News Arabia',  region: 'me',      videoId: 'U--OjmpjF5o' },
  { id: 'trtworld',    name: 'TRT World',        region: 'me',      videoId: 'ABfFhWzWs0s' },
  { id: 'kan11',       name: 'Kan 11',           region: 'me',      videoId: 'TCnaIE_SAtM' },
  { id: 'i24news',     name: 'i24NEWS',          region: 'me',      videoId: 'myKybZUK0IA' },
  { id: 'asharq',      name: 'Asharq News',      region: 'me',      videoId: 'f6VpkfV7m4Y' },
  { id: 'aljazeeraar', name: 'Al Jazeera Arabic',region: 'me',      videoId: 'bNyUyrR0PHo' },

  { id: 'ktn',         name: 'KTN News',         region: 'africa',  videoId: 'RmHtsdVb3mo' },
  { id: 'arise',       name: 'Arise News',       region: 'africa',  videoId: '4uHZdlX-DT4' },

  { id: 'abcaus',      name: 'ABC News Australia', region: 'oceania', videoId: 'vOTiJkg1voo' },
]

const DEFAULT_CHANNEL = CHANNELS.find(c => c.id === 'abcaus')!

export default function LiveTVPanel() {
  const [region, setRegion] = useState<Region>(DEFAULT_CHANNEL.region)
  const [active, setActive] = useState(DEFAULT_CHANNEL)
  const shown = CHANNELS.filter(c => c.region === region)

  return (
    <div className="dash-panel">
      <div className="dash-panel-header">
        <span>Live TV</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {REGIONS.map(r => (
            <button key={r.id} onClick={() => setRegion(r.id)} style={{
              fontSize: 10.5, fontWeight: 600, padding: '3px 8px', borderRadius: 5,
              border: `1px solid ${region === r.id ? 'var(--border)' : 'transparent'}`,
              background: region === r.id ? 'var(--bg-elevated)' : 'transparent',
              color: region === r.id ? 'var(--text-1)' : 'var(--text-4)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
        {shown.map(c => (
          <button key={c.id} onClick={() => setActive(c)} style={{
            fontSize: 10.5, fontWeight: 600, padding: '3px 8px', borderRadius: 5,
            border: `1px solid ${active.id === c.id ? '#8b5cf6' : 'var(--border)'}`,
            background: active.id === c.id ? '#8b5cf61a' : 'transparent',
            color: active.id === c.id ? '#8b5cf6' : 'var(--text-3)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {c.name}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, borderRadius: 6, overflow: 'hidden', background: '#000' }}>
        <iframe
          key={active.id}
          src={`https://www.youtube-nocookie.com/embed/${active.videoId}?autoplay=1&mute=1&playsinline=1`}
          title={active.name}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        />
      </div>
    </div>
  )
}
