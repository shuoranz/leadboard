import type { Connect, Plugin } from 'vite'
import { HttpError, createWorld } from './world.ts'

/**
 * Answers the benchmark API from the fake services' JSON seed data, for both
 * `vite` (dev) and `vite preview` (the production bundle), so either can run
 * without the Python stack. Started runs live in memory until restart.
 */
export function mockApi(apiBase: string): Plugin {
  const base = apiBase.replace(/\/$/, '')
  const world = createWorld()

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(`${base}/`)) return next()
    const path = url.pathname.slice(base.length)
    const method = req.method ?? 'GET'

    const send = (status: number, body: unknown) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      // A little latency so loading states are visible.
      setTimeout(() => res.end(JSON.stringify(body)), 200)
    }
    const found = (body: unknown, what: string) => (body ? send(200, body) : send(404, { detail: `Unknown ${what}` }))

    const route = (body: unknown) => {
      let m: RegExpMatchArray | null
      if (method === 'GET' && path === '/services') return send(200, world.services())
      if (method === 'GET' && path === '/catalog') return send(200, world.catalog())
      if (method === 'GET' && path === '/load-profiles') return send(200, world.loadProfiles())
      if (method === 'GET' && (m = path.match(/^\/services\/([^/]+)\/leaderboard$/)))
        return found(world.leaderboard(decodeURIComponent(m[1]), url.searchParams.get('profile') ?? undefined), 'service')
      if (method === 'GET' && (m = path.match(/^\/services\/([^/]+)$/))) return found(world.service(decodeURIComponent(m[1])), 'service')
      if (method === 'GET' && path === '/runs')
        return send(
          200,
          world.runs({
            service_id: url.searchParams.get('service_id') ?? undefined,
            status: url.searchParams.getAll('status'),
            limit: Number(url.searchParams.get('limit')) || undefined,
          }),
        )
      if (method === 'POST' && path === '/runs') return send(201, world.createRuns(body as Parameters<typeof world.createRuns>[0]))
      if (method === 'GET' && (m = path.match(/^\/runs\/([^/]+)$/))) return found(world.run(decodeURIComponent(m[1])), 'run')
      if (method === 'POST' && (m = path.match(/^\/runs\/([^/]+)\/cancel$/))) return found(world.cancel(decodeURIComponent(m[1])), 'run')
      if (method === 'GET' && (m = path.match(/^\/runs\/([^/]+)\/results$/))) {
        const id = decodeURIComponent(m[1])
        const run = world.run(id)
        if (!run) return send(404, { detail: 'Unknown run' })
        const ready = run.status === 'completed' || (run.status === 'cancelled' && run.headline)
        return ready ? found(world.results(id), 'results') : send(409, { detail: `No results yet (run is ${run.status})` })
      }
      send(404, { detail: 'Not found' })
    }

    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      try {
        route(raw ? JSON.parse(raw) : undefined)
      } catch (e) {
        if (e instanceof HttpError) send(e.status, { detail: e.detail })
        else send(400, { detail: e instanceof Error ? e.message : 'Bad request' })
      }
    })
  }

  return {
    name: 'benchmark-mock-api',
    apply: 'serve',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  }
}
