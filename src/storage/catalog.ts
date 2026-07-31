import type { Env } from '../env'
import type { CatalogPayload } from '../types'

function latestKey(siteId: string): string {
  return `catalogs/${siteId}/latest.json`
}

function runKey(siteId: string, iso: string): string {
  const safe = iso.replace(/[:.]/g, '-')
  return `catalogs/${siteId}/runs/${safe}.json`
}

export async function publishCatalog(
  env: Env,
  catalog: CatalogPayload,
): Promise<{ latestKey: string; runKey: string }> {
  const body = JSON.stringify(catalog, null, 2)
  const meta = { httpMetadata: { contentType: 'application/json' as const } }
  const lk = latestKey(catalog.siteId)
  const rk = runKey(catalog.siteId, catalog.generatedAt)
  await Promise.all([
    env.CATALOGS.put(lk, body, meta),
    env.CATALOGS.put(rk, body, meta),
  ])
  return { latestKey: lk, runKey: rk }
}

export async function readLatestCatalog(
  env: Env,
  siteId: string,
): Promise<CatalogPayload | null> {
  const obj = await env.CATALOGS.get(latestKey(siteId))
  if (!obj) return null
  try {
    return (await obj.json()) as CatalogPayload
  } catch {
    return null
  }
}

/** Public-ish JSON URL path for site consumers (same worker). */
export function publicCatalogPath(siteId: string): string {
  return `/api/catalog/${encodeURIComponent(siteId)}`
}
