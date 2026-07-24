import { useState } from 'react'

const LS_KEY = 'options:live_proxy_url'

function load(): string {
  try { return localStorage.getItem(LS_KEY) ?? '' } catch { return '' }
}

function save(url: string) {
  try { localStorage.setItem(LS_KEY, url) } catch { /* ignore */ }
}

/** Strip trailing slash so `${url}/live/trades` doesn't double up. */
export function normalizeProxyUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function useLiveProxyStore() {
  const [url, setUrl] = useState<string>(load)

  const update = (next: string) => {
    const normalized = normalizeProxyUrl(next)
    save(normalized)
    setUrl(normalized)
  }

  return { url, update }
}
