/**
 * In-dashboard reader-mode article view — clicking a Ticker Headline fills
 * this panel with the article's extracted title/byline/paragraphs (via
 * /api/article) instead of opening a new browser tab, and instead of
 * embedding the source page itself in an iframe (most publishers block
 * framing anyway, and an iframe would carry the source's own ads/scripts
 * straight through). Plain extracted text structurally can't carry ads.
 */
import { useEffect, useState } from 'react'
import { ExternalLink, Newspaper } from 'lucide-react'
import { fetchArticle, type Article } from '../../../services/article'

export interface SelectedHeadline { url: string; title: string; source: string }

export default function ArticleReaderPanel({ selected }: { selected: SelectedHeadline | null }) {
  const [article, setArticle] = useState<Article | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!selected) { setArticle(null); setFailed(false); return }
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetchArticle(selected.url).then(a => {
      if (cancelled) return
      setLoading(false)
      if (a) setArticle(a)
      else setFailed(true)
    })
    return () => { cancelled = true }
  }, [selected?.url]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dash-panel" style={{ flex: 1 }}>
      <div className="dash-panel-header">
        <Newspaper size={13} style={{ color: 'var(--accent)' }} />
        <span>Article</span>
        {selected && (
          <a href={selected.url} target="_blank" rel="noreferrer" title="Open original"
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text-4)', textDecoration: 'none' }}>
            Open original <ExternalLink size={11} />
          </a>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
        {!selected ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 12, textAlign: 'center', padding: 20 }}>
            Click a headline below to read it here.
          </div>
        ) : loading ? (
          <div style={{ padding: '20px 12px', color: 'var(--text-4)', fontSize: 12 }}>Loading article…</div>
        ) : failed ? (
          <div style={{ padding: '20px 12px', color: 'var(--text-4)', fontSize: 12 }}>
            Couldn't extract this article's text (the source may block it).{' '}
            <a href={selected.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open it in a new tab</a> instead.
          </div>
        ) : article ? (
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '10px 8px 24px' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.35, marginBottom: 6, fontFamily: 'Inter, sans-serif' }}>
              {article.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 16 }}>{article.byline}</div>
            {article.paragraphs.map((p, i) => (
              <p key={i} style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2)', marginBottom: 12 }}>{p}</p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
