/**
 * Bloomberg headlines widget — Bloomberg's own public RSS feeds (Markets,
 * Economics, Technology, Politics), merged and sorted newest first. Not an
 * embedded bloomberg.com page: like virtually every major news site,
 * Bloomberg sends framing-refusal headers (X-Frame-Options/CSP), so an
 * iframe of the live site just renders blank — this pulls their own
 * syndicated headlines instead, which is real Bloomberg content without
 * fighting that.
 */
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { fetchBloombergNews, type BloombergHeadline } from '../../../services/bloombergNews'

const REFRESH_MS = 3 * 60 * 1000

const SECTION_COLOR: Record<string, string> = {
  Markets: '#10b981',
  Economics: '#3b82f6',
  Technology: '#a855f7',
  Politics: '#f59e0b',
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export default function BloombergNewsPanel() {
  const [headlines, setHeadlines] = useState<BloombergHeadline[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    const data = await fetchBloombergNews()
    if (data.length > 0) setHeadlines(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="dash-panel">
      <div className="dash-panel-header">
        <span>Bloomberg</span>
        <button onClick={load} disabled={loading} title="Refresh" style={{
          background: 'none', border: 'none', color: 'var(--text-4)', cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', padding: 0, marginLeft: 'auto',
        }}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {headlines.length === 0 && (
          <div style={{ padding: '12px 4px', fontSize: 12, color: 'var(--text-4)' }}>
            {loading ? 'Loading Bloomberg headlines…' : 'No headlines available.'}
          </div>
        )}
        {headlines.map((h, i) => (
          <a key={h.link + i} href={h.link} target="_blank" rel="noreferrer" style={{
            display: 'block', padding: '7px 4px', textDecoration: 'none',
            borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{
                fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                color: SECTION_COLOR[h.section] ?? 'var(--text-4)',
              }}>
                {h.section}
              </span>
              <span style={{ fontSize: 9.5, color: 'var(--text-4)' }}>{relativeTime(h.time)}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.4 }}>{h.title}</div>
          </a>
        ))}
      </div>
    </div>
  )
}
