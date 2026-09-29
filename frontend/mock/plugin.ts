import type { Connect, Plugin } from 'vite'
import { mockApps, mockLeaderboard } from './data.ts'

/**
 * Answers the leaderboard API with generated data, for both `vite` (dev) and
 * `vite preview` (the production bundle), so either can run without a backend.
 */
export function mockApi(apiBase: string): Plugin {
  const base = apiBase.replace(/\/$/, '')

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(`${base}/`)) return next()
    const path = url.pathname.slice(base.length)

    const send = (status: number, body: unknown) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      // A little latency so loading states are visible.
      setTimeout(() => res.end(JSON.stringify(body)), 250)
    }

    if (path === '/apps') return send(200, mockApps)
    const match = path.match(/^\/apps\/([^/]+)\/leaderboard$/)
    if (match) {
      let appId: string
      try {
        appId = decodeURIComponent(match[1])
      } catch {
        return send(400, { detail: 'Malformed app id' }) // bad percent-encoding
      }
      const board = mockLeaderboard(appId)
      return board ? send(200, board) : send(404, { detail: 'Unknown app' })
    }
    send(404, { detail: 'Not found' })
  }

  return {
    name: 'leaderboard-mock-api',
    apply: 'serve',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  }
}
