import type { SessionUser } from '../types'

const COOKIE = 'afc_session'
/** 12h — shorter window so org removal bites sooner without stored tokens */
const MAX_AGE_SEC = 60 * 60 * 12

export type SessionPayload = {
  u: SessionUser
  exp: number
  /** GitHub OAuth access token for live org re-check (HttpOnly cookie only) */
  ghToken?: string
  /** Unix sec when orgs were last refreshed from GitHub */
  orgsCheckedAt?: number
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of u8) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signSession(
  user: SessionUser,
  secret: string,
  opts?: { ghToken?: string; orgsCheckedAt?: number },
): Promise<string> {
  const payload: SessionPayload = {
    u: user,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
    ghToken: opts?.ghToken,
    orgsCheckedAt: opts?.orgsCheckedAt ?? Math.floor(Date.now() / 1000),
  }
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await hmacKey(secret)
  const sig = b64url(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
  )
  return `${body}.${sig}`
}

export async function verifySessionPayload(
  token: string | null | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token || !secret) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const key = await hmacKey(secret)
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecode(sig),
    new TextEncoder().encode(body),
  )
  if (!ok) return null
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(b64urlDecode(body)),
    ) as SessionPayload
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
    if (!payload.u?.login) return null
    return payload
  } catch {
    return null
  }
}

export async function verifySession(
  token: string | null | undefined,
  secret: string,
): Promise<SessionUser | null> {
  const p = await verifySessionPayload(token, secret)
  return p?.u ?? null
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('Cookie') || ''
  const m = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  return m ? decodeURIComponent(m[1]) : null
}

export function setSessionCookie(token: string, secure: boolean): string {
  const flags = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SEC}`,
  ]
  if (secure) flags.push('Secure')
  return flags.join('; ')
}

export function clearSessionCookie(secure: boolean): string {
  const flags = [
    `${COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (secure) flags.push('Secure')
  return flags.join('; ')
}

export function oauthStateCookie(state: string, secure: boolean): string {
  const flags = [
    `afc_oauth_state=${state}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600',
  ]
  if (secure) flags.push('Secure')
  return flags.join('; ')
}

export function clearOauthStateCookie(secure: boolean): string {
  const flags = [
    'afc_oauth_state=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (secure) flags.push('Secure')
  return flags.join('; ')
}

export async function getSessionUser(
  request: Request,
  secret: string,
): Promise<SessionUser | null> {
  return verifySession(readSessionCookie(request), secret)
}

export async function getSessionPayload(
  request: Request,
  secret: string,
): Promise<SessionPayload | null> {
  return verifySessionPayload(readSessionCookie(request), secret)
}
