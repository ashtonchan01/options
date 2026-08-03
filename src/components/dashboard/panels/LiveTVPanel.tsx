/**
 * Embedded 24/7 news channel via YouTube iframe, with a small switcher.
 * No API key needed — each channel is a fixed known-live video id
 * (same approach as World Monitor's LiveNewsPanel fallback list).
 */
import { useState } from 'react'

const CHANNELS = [
  { id: 'bloomberg', name: 'Bloomberg',      videoId: 'iEpJwprxDdk' },
  { id: 'cnbc',       name: 'CNBC',          videoId: '9NyxcX3rhQs' },
  { id: 'sky',        name: 'Sky News',      videoId: 'uvviIF4725I' },
  { id: 'yahoo',      name: 'Yahoo Finance', videoId: 'KQp-e_XQnDE' },
  { id: 'dw',         name: 'DW',            videoId: 'LuKwFajn37U' },
]

export default function LiveTVPanel() {
  const [active, setActive] = useState(CHANNELS[0])

  return (
    <div className="dash-panel">
      <div className="dash-panel-header">
        <span>Live TV</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {CHANNELS.map(c => (
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
      </div>
      <div style={{ flex: 1, minHeight: 0, borderRadius: 6, overflow: 'hidden', background: '#000' }}>
        <iframe
          key={active.id}
          src={`https://www.youtube-nocookie.com/embed/${active.videoId}?autoplay=1&mute=1`}
          title={active.name}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>
    </div>
  )
}
