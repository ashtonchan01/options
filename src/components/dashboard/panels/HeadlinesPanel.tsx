import { useEffect, useState } from 'react'
import { fetchHeadlines, type Headline } from '../../../services/news'

const REFRESH_MS = 3 * 60 * 1000

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

export default function HeadlinesPanel() {
  const [headlines, setHeadlines] = useState<Headline[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const data = await fetchHeadlines()
      if (!cancelled && data.length > 0) setHeadlines(data)
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
    <div className="dash-panel" style={{ flex: 1 }}>
      <div className="dash-panel-header"><span>World Economic Headlines</span></div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {headlines.length === 0 && (
          <div style={{ padding: '12px 4px', fontSize: 12, color: 'var(--text-4)' }}>Loading headlines…</div>
        )}
        {headlines.map((h, i) => (
          <a key={h.link + i} href={h.link} target="_blank" rel="noreferrer" style={{
            display: 'block', padding: '8px 4px', textDecoration: 'none',
            borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.4 }}>{h.title}</div>
            <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>
              {h.source} · {relativeTime(h.time)}
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
