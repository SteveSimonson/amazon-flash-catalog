import {
  checkOrgMembership,
  exchangeCode,
  fetchGitHubUser,
  githubAuthorizeUrl,
  isLoginAllowed,
  isUserAllowed,
  listUserOrgs,
} from './auth/github'
import { ibambooSeedSite } from './seed/ibamboo'
import {
  clearOauthStateCookie,
  clearSessionCookie,
  getSessionPayload,
  getSessionUser,
  oauthStateCookie,
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

function hasBearerAdmin(request: Request, env: Env): boolean {
  const token = env.ADMIN_API_TOKEN?.trim()
  if (!token) return false
  const auth = request.headers.get('Authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return Boolean(m && m[1].trim() === token)
}

/** Block cross-site mutating API calls (defense in depth with SameSite=Lax). */
function assertSameOrigin(
  request: Request,
  url: URL,
  env: Env,
): Response | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null
  // Machine tokens are not browser CSRF vectors
  if (hasBearerAdmin(request, env)) return null
  const origin = request.headers.get('Origin')
  if (origin) {
    try {
      if (new URL(origin).origin !== url.origin) {
        return json({ error: 'CSRF: bad Origin' }, 403)
      }
      return null
    } catch {
      return json({ error: 'CSRF: bad Origin' }, 403)
    }
  }
  const referer = request.headers.get('Referer')
  if (referer) {
    try {
      if (new URL(referer).origin !== url.origin) {
        return json({ error: 'CSRF: bad Referer' }, 403)
      }
      return null
    } catch {
      return json({ error: 'CSRF: bad Referer' }, 403)
    }
  }
  // Non-browser clients (curl) without Origin/Referer: allow for ops; browsers send Origin on fetch.
  return null
}

const ORG_RECHECK_SEC = 15 * 60 // live re-check at least every 15 minutes

async function requireAdmin(
  request: Request,
  env: Env,
): Promise<
  | Response
  | {
      user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>
      setCookie?: string
    }
> {
  // Machine bootstrap / CI
  if (hasBearerAdmin(request, env)) {
    return {
      user: {
        login: 'admin-token',
        id: 0,
        orgs: env.ALLOWED_GITHUB_ORG
          ? [env.ALLOWED_GITHUB_ORG.toLowerCase()]
          : [],
      },
    }
  }

  if (!env.SESSION_SECRET) {
    return json({ error: 'SESSION_SECRET not configured' }, 500)
  }
  const payload = await getSessionPayload(request, env.SESSION_SECRET)
  if (!payload?.u) return json({ error: 'Unauthorized' }, 401)

  let user = payload.u
  let setCookie: string | undefined
  const now = Math.floor(Date.now() / 1000)
  const stale =
    !payload.orgsCheckedAt || now - payload.orgsCheckedAt > ORG_RECHECK_SEC

  if (stale && payload.ghToken && env.ALLOWED_GITHUB_ORG) {
    const member = await checkOrgMembership(
      payload.ghToken,
      env.ALLOWED_GITHUB_ORG,
    )
    const userOk = isUserAllowed(user, env.ALLOWED_GITHUB_USERS)
    if (!member && !userOk) {
      return json(
        { error: 'Forbidden: not allowed (org/user allowlist)' },
        403,
      )
    }
    if (member) {
      const orgs = await listUserOrgs(payload.ghToken)
      user = { ...user, orgs }
    }
    const token = await signSession(user, env.SESSION_SECRET, {
      ghToken: payload.ghToken,
      orgsCheckedAt: now,
    })
    setCookie = setSessionCookie(token, isSecure(new URL(request.url)))
  } else if (
    !isLoginAllowed(user, env.ALLOWED_GITHUB_ORG, env.ALLOWED_GITHUB_USERS)
  ) {
    return json({ error: 'Forbidden: not allowed (org/user allowlist)' }, 403)
  }

  return { user, setCookie }
}

function withAdminCookie(
  res: Response,
  setCookie?: string,
): Response {
  if (!setCookie) return res
  const headers = new Headers(res.headers)
  headers.append('Set-Cookie', setCookie)
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
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

  const csrf = assertSameOrigin(request, url, env)
  if (csrf) return csrf

  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const { user, setCookie } = auth

  if (path === '/api/me' && request.method === 'GET') {
    return withAdminCookie(json({ user }), setCookie)
  }

  // Seed iBamboo site + optional immediate refresh
  if (path === '/api/bootstrap/ibamboo' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      refresh?: boolean
    }
    const seed = ibambooSeedSite()
    const existing = (await loadConfig(env)).sites.find((s) => s.id === 'ibamboo')
    const site = existing
      ? {
          ...existing,
          categories:
            existing.categories.length > 0 ? existing.categories : seed.categories,
          schedule: existing.schedule || seed.schedule,
          name: existing.name || seed.name,
          siteUrl: existing.siteUrl || seed.siteUrl,
          enabled: true,
        }
      : seed
    await upsertSite(env, site)
    if (body.refresh !== false) {
      const result = await refreshSite(env, site)
      return withAdminCookie(
        json({ ok: result.ok, site, refresh: result }, result.ok ? 200 : 502),
        setCookie,
      )
    }
    return withAdminCookie(json({ ok: true, site, refresh: null }), setCookie)
  }

  if (path === '/api/sites' && request.method === 'GET') {
    const config = await loadConfig(env)
    return withAdminCookie(json(config), setCookie)
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
    return withAdminCookie(json({ ok: true, site }), setCookie)
  }

  const siteMatch = path.match(/^\/api\/sites\/([a-z0-9-]+)(\/.*)?$/i)
  if (siteMatch) {
    const siteId = siteMatch[1]
    const rest = siteMatch[2] || ''
    const config = await loadConfig(env)
    const site = config.sites.find((s) => s.id === siteId)
    if (!site) return withAdminCookie(json({ error: 'Site not found' }, 404), setCookie)

    if (rest === '' && request.method === 'GET') {
      return withAdminCookie(json({ site }), setCookie)
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
      return withAdminCookie(json({ ok: true, site: next }), setCookie)
    }

    if (rest === '' && request.method === 'DELETE') {
      await deleteSite(env, siteId)
      return withAdminCookie(json({ ok: true }), setCookie)
    }

    if (rest === '/categories' && request.method === 'PUT') {
      const body = (await request.json()) as { categories?: unknown }
      try {
        const categories = parseSourceCategories(body.categories)
        const next = { ...site, categories }
        await upsertSite(env, next)
        return withAdminCookie(json({ ok: true, site: next }), setCookie)
      } catch (e) {
        return withAdminCookie(
          json(
            { error: e instanceof Error ? e.message : 'Invalid categories' },
            400,
          ),
          setCookie,
        )
      }
    }

    if (rest === '/refresh' && request.method === 'POST') {
      const result = await refreshSite(env, site)
      return withAdminCookie(json(result, result.ok ? 200 : 502), setCookie)
    }
  }

  return withAdminCookie(json({ error: 'Not found' }, 404), setCookie)
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
    if (
      user &&
      isLoginAllowed(user, env.ALLOWED_GITHUB_ORG, env.ALLOWED_GITHUB_USERS)
    ) {
      return redirect('/admin')
    }
    const err = url.searchParams.get('error') || undefined
    return html(loginPage(appName, err))
  }

  if (!user) return redirect('/login')
  if (
    !isLoginAllowed(user, env.ALLOWED_GITHUB_ORG, env.ALLOWED_GITHUB_USERS)
  ) {
    return html(
      loginPage(
        appName,
        `GitHub user @${user.login} is not allowed (org/user allowlist).`,
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
        return redirect(location, {
          'Set-Cookie': oauthStateCookie(state, secure),
        })
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
          const member = env.ALLOWED_GITHUB_ORG
            ? await checkOrgMembership(token, env.ALLOWED_GITHUB_ORG)
            : false
          const allowed = isLoginAllowed(
            ghUser,
            env.ALLOWED_GITHUB_ORG,
            env.ALLOWED_GITHUB_USERS,
          )
          if (!member && !allowed) {
            return redirect(
              '/login?error=' +
                encodeURIComponent(
                  `Not allowed (org ${env.ALLOWED_GITHUB_ORG || '—'} / user allowlist)`,
                ),
            )
          }
          const session = await signSession(ghUser, env.SESSION_SECRET, {
            ghToken: token,
            orgsCheckedAt: Math.floor(Date.now() / 1000),
          })
          const secure = isSecure(url)
          const headers = new Headers({ Location: '/admin' })
          headers.append('Set-Cookie', setSessionCookie(session, secure))
          headers.append('Set-Cookie', clearOauthStateCookie(secure))
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
