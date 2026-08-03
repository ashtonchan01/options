/**
 * Embedded X (Twitter) timeline via the official publish.twitter.com
 * widget — no API key needed. Defaults to a fast macro/markets headline
 * account; swap XACCOUNT to whichever handle you want to follow.
 */
import { useEffect, useRef } from 'react'

const XACCOUNT = 'DeItaone'

declare global {
  interface Window {
    twttr?: { widgets?: { load: (el?: HTMLElement) => void } }
  }
}

function loadTwitterWidgets(): Promise<void> {
  if (window.twttr?.widgets) return Promise.resolve()
  return new Promise(resolve => {
    const existing = document.getElementById('twitter-wjs')
    if (existing) { existing.addEventListener('load', () => resolve()); return }
    const script = document.createElement('script')
    script.id = 'twitter-wjs'
    script.src = 'https://platform.twitter.com/widgets.js'
    script.async = true
    script.onload = () => resolve()
    document.body.appendChild(script)
  })
}

export default function XFeedPanel() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    loadTwitterWidgets().then(() => {
      if (!cancelled && containerRef.current) window.twttr?.widgets?.load(containerRef.current)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="dash-panel" style={{ flex: 1 }}>
      <div className="dash-panel-header"><span>X / Twitter</span></div>
      <div ref={containerRef} style={{ flex: 1, overflowY: 'auto' }}>
        <a
          className="twitter-timeline"
          data-theme="dark"
          data-chrome="noheader nofooter noborders transparent"
          href={`https://twitter.com/${XACCOUNT}?ref_src=twsrc%5Etfw`}
        >
          Tweets by {XACCOUNT}
        </a>
      </div>
    </div>
  )
}
