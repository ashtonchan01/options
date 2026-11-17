import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Serves /api/history in `vite dev` the same way Vercel serves api/history.js. */
function historyDevApi() {
  return {
    name: 'history-dev-api',
    configureServer(server: { middlewares: { use: (fn: (req: import('http').IncomingMessage, res: import('http').ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/history')) return next()
        // Plain JS edge handler — no declaration file.
        // @ts-expect-error api/history.js is untyped Vercel edge code
        const loaded = await import('./api/history.js')
        const handler = loaded.default as (req: Request) => Promise<Response>
        const response = await handler(new Request(`http://localhost${url}`))
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(Buffer.from(await response.arrayBuffer()))
      })
    },
  }
}

/** Serves /api/cboe?history= in `vite dev` the same way Vercel serves api/cboe.js. */
function marketHistoryDevApi() {
  return {
    name: 'market-history-dev-api',
    configureServer(server: { middlewares: { use: (fn: (req: import('http').IncomingMessage, res: import('http').ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/cboe')) return next()
        const parsed = new URL(url, 'http://localhost')
        if (!parsed.searchParams.has('history')) return next()
        // @ts-expect-error api/cboe.js is untyped Vercel node code
        const loaded = await import('./api/cboe.js')
        const query: Record<string, string> = {}
        parsed.searchParams.forEach((value, key) => { query[key] = value })
        Object.assign(req, { query })
        const shim = {
          statusCode: 200,
          status(code: number) { this.statusCode = code; return this },
          setHeader(name: string, value: string) { res.setHeader(name, value); return this },
          json(body: unknown) {
            res.statusCode = this.statusCode
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(body))
          },
        }
        await loaded.default(req, shim)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), historyDevApi(), marketHistoryDevApi()],
  base: '/',
  server: {
    proxy: {
      '/yahoo-api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/yahoo-api/, ''),
      },
    },
  },
})
