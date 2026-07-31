import type { Env } from '../env'
import type { SessionUser } from '../types'
import { requireEnv } from '../env'

export function githubAuthorizeUrl(env: Env, state: string): string {
  const clientId = requireEnv(env, 'GITHUB_CLIENT_ID')
  const redirect = `${env.APP_BASE_URL.replace(/\/$/, '')}/auth/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    scope: 'read:user read:org',
    state,
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

export async function exchangeCode(
  env: Env,
  code: string,
): Promise<string> {
  const clientId = requireEnv(env, 'GITHUB_CLIENT_ID')
  const clientSecret = requireEnv(env, 'GITHUB_CLIENT_SECRET')
  const redirect = `${env.APP_BASE_URL.replace(/\/$/, '')}/auth/callback`

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirect,
    }),
  })
  const data = (await res.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }
  if (!data.access_token) {
    throw new Error(
      data.error_description || data.error || 'GitHub token exchange failed',
    )
  }
  return data.access_token
}

export async function fetchGitHubUser(
  accessToken: string,
): Promise<SessionUser> {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'amazon-flash-catalog',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const userRes = await fetch('https://api.github.com/user', { headers })
  if (!userRes.ok) {
    throw new Error(`GitHub /user failed (${userRes.status})`)
  }
  const user = (await userRes.json()) as {
    login: string
    id: number
    name?: string
    avatar_url?: string
  }

  const orgsRes = await fetch('https://api.github.com/user/orgs', { headers })
  const orgs: string[] = []
  if (orgsRes.ok) {
    const list = (await orgsRes.json()) as Array<{ login: string }>
    for (const o of list) orgs.push(o.login.toLowerCase())
  }

  return {
    login: user.login,
    id: user.id,
    name: user.name || undefined,
    avatarUrl: user.avatar_url,
    orgs,
  }
}

/** True if user belongs to ALLOWED_GITHUB_ORG (case-insensitive). */
export function isOrgAllowed(user: SessionUser, allowedOrg: string): boolean {
  const org = (allowedOrg || '').trim().toLowerCase()
  if (!org) return false
  return user.orgs.map((o) => o.toLowerCase()).includes(org)
}
