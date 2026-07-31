import {
  exchangeCode,
  fetchGitHubUser,
  githubAuthorizeUrl,
  isOrgAllowed,
} from './auth/github'
import {
  clearSessionCookie,
  getSessionUser,
  setSessionCookie,
  signSession,
} from './auth/session'
import {
  dashboardPage,
  loginPage,
  siteEditorPage,
} from './admin/ui'
import type { Env } from './env'
import { isScheduleDue, refreshSite } from './fetch/pipeline'
import {
  deleteSite,
  loadConfig,
  slugifyId,
  upsertSite,
} from './storage/config'
import {
  publicCatalogPath,
  readLatestCatalog,
} from './storage/catalog'
import {
  defaultFilters,
  newSite,
  type CategoryFilters,
  type SiteConfig,
  type SourceCategory,
} from './types'

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  })
}

function html(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

function redirect(url: string, headers: Record<string, string> = {}) {
  return new Response(null, {
    status: 302,
    headers: { Location: url, ...headers },
  })
}

function isSecure(url: URL): boolean {
  return url.protocol === 'https:'
}

async function requireAdmin(
  request: Request,
  env: Env,
): Promise<Response | Awaited<ReturnType<typeof getSessionUser>>> {
  if (!env.SESSION_SECRET) {
    return json({ error: 'SESSION_SECRET not configured' }, 500)
  }
  const user = await getSessionUser(request, env.SESSION_SECRET)
  if (!user) return json({ error: 'Unauthorized' }, 401)
  if (!isOrgAllowed(user, env.ALLOWED_GITHUB_ORG)) {
    return json({ error: 'Forbidden: not a member of allowed GitHub org' }, 403)
  }
  return user
}

function parseSourceCategories(raw: unknown): SourceCategory[] {
  if (!Array.isArray(raw)) throw new Error('categories must be an array')
  return raw.map((item, i) => {
    const c = item as Partial<SourceCategory>
    const id = slugifyId(String(c.id || `cat-${i + 1}`))
    if (!id) throw new Error(`Invalid category id at index ${i}`)
    const f = (c.filters || defaultFilters()) as CategoryFilters
    return {
      id,
      label: String(c.label || id),
      browseNode: c.browseNode ? String(c.browseNode) : undefined,
      searchQuery: c.searchQuery ? String(c.searchQuery) : undefined,
      enabled: c.enabled !== false,
      siteCategory: String(c.siteCategory || 'general'),
      filters: {
        topN: Number(f.topN) || 40,
        minRating: Number(f.minRating) || 0,
        minReviews: Number(f.minReviews) || 0,
        minPrice: f.minPrice == null || f.minPrice === ('' as unknown) ? null : Number(f.minPrice),
        maxPrice: f.maxPrice == null || f.maxPrice === ('' as unknown) ? null : Number(f.maxPrice),
        includeKeywords: Array.isArray(f.includeKeywords)
          ? f.includeKeywords.map(String)
          : defaultFilters().includeKeywords,
        excludeKeywords: Array.isArray(f.excludeKeywords)
          ? f.excludeKeywords.map(String)
          : [],
        requireKeywordMatch: Boolean(f.requireKeywordMatch),
      },
    }
  })
}

async function handleApi(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const path = url.pathname

  // Public catalog for consumer sites
  const catalogMatch = path.match(/^\/api\/catalog\/([a-z0-9-]+)$/i)
  if (catalogMatch && request.method === 'GET') {
    const siteId = catalogMatch[1]
    const catalog = await readLatestCatalog(env, siteId)
    if (!catalog) return json({ error: 'Catalog not found' }, 404)
    return json(catalog, 200, {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    })
  }

  if (path === '/api/health' && request.method === 'GET') {
    return json({ ok: true, app: env.APP_NAME || 'amazon-flash-catalog' })
  }

  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const user = auth

  if (path === '/api/me' && request.method === 'GET') {
    return json({ user })
  }

  if (path === '/api/sites' && request.method === 'GET') {
    const config = await loadConfig(env)
    return json(config)
  }

  if (path === '/api/sites' && request.method === 'POST') {
    const body = (await request.json()) as {
      id?: string
      name?: string
      siteUrl?: string
    }
    const id = slugifyId(body.id || '')
    if (!id || !body.name?.trim()) {
      return json({ error: 'id and name required' }, 400)
    }
    const config = await loadConfig(env)
    if (config.sites.some((s) => s.id === id)) {
      return json({ error: 'Site id already exists' }, 409)
    }
    const site = newSite({
      id,
      name: body.name.trim(),
      siteUrl: body.siteUrl?.trim() || undefined,
    })
    await upsertSite(env, site)
    return json({ ok: true, site })
  }

  const siteMatch = path.match(/^\/api\/sites\/([a-z0-9-]+)(\/.*)?$/i)
  if (siteMatch) {
    const siteId = siteMatch[1]
    const rest = siteMatch[2] || ''
    const config = await loadConfig(env)
    const site = config.sites.find((s) => s.id === siteId)
    if (!site && request.method !== 'POST') {
      // allow create only via /api/sites
    }
    if (!site) return json({ error: 'Site not found' }, 404)

    if (rest === '' && request.method === 'GET') {
      return json({ site })
    }

    if (rest === '' && request.method === 'PUT') {
      const body = (await request.json()) as {
        name?: string
        siteUrl?: string
        enabled?: boolean
        schedule?: SiteConfig['schedule']
      }
      const schedules = ['manual', 'hourly', 'every_6h', 'daily', 'weekly'] as const
      const schedule = body.schedule && schedules.includes(body.schedule)
        ? body.schedule
        : site.schedule
      const next = {
        ...site,
        name: body.name?.trim() || site.name,
        siteUrl: body.siteUrl !== undefined ? body.siteUrl?.trim() || undefined : site.siteUrl,
        enabled: body.enabled !== undefined ? Boolean(body.enabled) : site.enabled,
        schedule,
      }
      await upsertSite(env, next)
      return json({ ok: true, site: next })
    }

    if (rest === '' && request.method === 'DELETE') {
      await deleteSite(env, siteId)
      return json({ ok: true })
    }

    if (rest === '/categories' && request.method === 'PUT') {
      const body = (await request.json()) as { categories?: unknown }
      try {
        const categories = parseSourceCategories(body.categories)
        const next = { ...site, categories }
        await upsertSite(env, next)
        return json({ ok: true, site: next })
      } catch (e) {
        return json(
          { error: e instanceof Error ? e.message : 'Invalid categories' },
          400,
        )
      }
    }

    if (rest === '/refresh' && request.method === 'POST') {
      const result = await refreshSite(env, site)
      return json(result, result.ok ? 200 : 502)
    }
  }

  return json({ error: 'Not found' }, 404)
}

async function handleAdminPages(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (!env.SESSION_SECRET) {
    return html(
      loginPage(
        env.APP_NAME || 'Amazon Flash Catalog',
        'Configure SESSION_SECRET and GitHub OAuth secrets before use.',
      ),
    )
  }

  const user = await getSessionUser(request, env.SESSION_SECRET)
  const appName = env.APP_NAME || 'Amazon Flash Catalog'

  if (url.pathname === '/' || url.pathname === '/login') {
    if (user && isOrgAllowed(user, env.ALLOWED_GITHUB_ORG)) {
      return redirect('/admin')
    }
    const err = url.searchParams.get('error') || undefined
    return html(loginPage(appName, err))
  }

  if (!user) return redirect('/login')
  if (!isOrgAllowed(user, env.ALLOWED_GITHUB_ORG)) {
    return html(
      loginPage(
        appName,
        `GitHub user @${user.login} is not in org "${env.ALLOWED_GITHUB_ORG}".`,
      ),
      403,
      { 'Set-Cookie': clearSessionCookie(isSecure(url)) },
    )
  }

  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    const config = await loadConfig(env)
    return html(dashboardPage(config, user, appName))
  }

  const sitePage = url.pathname.match(/^\/admin\/sites\/([a-z0-9-]+)$/i)
  if (sitePage) {
    const config = await loadConfig(env)
    const site = config.sites.find((s) => s.id === sitePage[1])
    if (!site) return html(loginPage(appName, 'Site not found'), 404)
    return html(siteEditorPage(site, user, publicCatalogPath(site.id)))
  }

  return html(loginPage(appName, 'Not found'), 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    try {
      // Auth routes
      if (url.pathname === '/auth/login' && request.method === 'GET') {
        if (!env.GITHUB_CLIENT_ID || !env.SESSION_SECRET) {
          return html(
            loginPage(
              env.APP_NAME || 'Amazon Flash Catalog',
              'GitHub OAuth is not configured (GITHUB_CLIENT_ID / SESSION_SECRET).',
            ),
          )
        }
        const state = crypto.randomUUID()
        const location = githubAuthorizeUrl(env, state)
        const secure = isSecure(url)
        // store state in short-lived cookie
        const stateCookie = [
          `afc_oauth_state=${state}`,
          'Path=/',
          'HttpOnly',
          'SameSite=Lax',
          'Max-Age=600',
          secure ? 'Secure' : '',
        ]
          .filter(Boolean)
          .join('; ')
        return redirect(location, { 'Set-Cookie': stateCookie })
      }

      if (url.pathname === '/auth/callback' && request.method === 'GET') {
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const cookie = request.headers.get('Cookie') || ''
        const m = cookie.match(/(?:^|;\s*)afc_oauth_state=([^;]+)/)
        const expected = m?.[1]
        if (!code || !state || !expected || state !== expected) {
          return redirect('/login?error=' + encodeURIComponent('Invalid OAuth state'))
        }
        try {
          const token = await exchangeCode(env, code)
          const ghUser = await fetchGitHubUser(token)
          if (!isOrgAllowed(ghUser, env.ALLOWED_GITHUB_ORG)) {
            return redirect(
              '/login?error=' +
                encodeURIComponent(
                  `Not a member of GitHub org ${env.ALLOWED_GITHUB_ORG}`,
                ),
            )
          }
          const session = await signSession(ghUser, env.SESSION_SECRET)
          const secure = isSecure(url)
          const headers = new Headers({ Location: '/admin' })
          headers.append('Set-Cookie', setSessionCookie(session, secure))
          headers.append(
            'Set-Cookie',
            'afc_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
          )
          return new Response(null, { status: 302, headers })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'OAuth failed'
          return redirect('/login?error=' + encodeURIComponent(msg))
        }
      }

      if (url.pathname === '/auth/logout') {
        return redirect('/login', {
          'Set-Cookie': clearSessionCookie(isSecure(url)),
        })
      }

      if (url.pathname.startsWith('/api/')) {
        return handleApi(request, env, url)
      }

      return handleAdminPages(request, env, url)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Server error'
      if (url.pathname.startsWith('/api/')) {
        return json({ error: msg }, 500)
      }
      return html(loginPage(env.APP_NAME || 'Amazon Flash Catalog', msg), 500)
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDueCron(env))
  },
}

async function runDueCron(env: Env): Promise<void> {
  const config = await loadConfig(env)
  const now = Date.now()
  for (const site of config.sites) {
    if (!site.enabled) continue
    if (!isScheduleDue(site.schedule, site.lastRunAt, now)) continue
    // sequential to be gentle on Amazon
    await refreshSite(env, site)
  }
}
