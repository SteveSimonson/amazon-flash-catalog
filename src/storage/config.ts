import type { Env } from '../env'
import { emptyConfig, type AppConfig, type SiteConfig } from '../types'

const CONFIG_KEY = 'config/app.json'

export async function loadConfig(env: Env): Promise<AppConfig> {
  const obj = await env.CATALOGS.get(CONFIG_KEY)
  if (!obj) return emptyConfig()
  try {
    const data = (await obj.json()) as AppConfig
    if (!data || data.version !== 1 || !Array.isArray(data.sites)) {
      return emptyConfig()
    }
    return data
  } catch {
    return emptyConfig()
  }
}

export async function saveConfig(env: Env, config: AppConfig): Promise<void> {
  await env.CATALOGS.put(CONFIG_KEY, JSON.stringify(config, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  })
}

export async function getSite(
  env: Env,
  siteId: string,
): Promise<SiteConfig | null> {
  const cfg = await loadConfig(env)
  return cfg.sites.find((s) => s.id === siteId) || null
}

export async function upsertSite(
  env: Env,
  site: SiteConfig,
): Promise<AppConfig> {
  const cfg = await loadConfig(env)
  const i = cfg.sites.findIndex((s) => s.id === site.id)
  const next = { ...site, updatedAt: new Date().toISOString() }
  if (i >= 0) cfg.sites[i] = next
  else cfg.sites.push(next)
  await saveConfig(env, cfg)
  return cfg
}

export async function deleteSite(env: Env, siteId: string): Promise<AppConfig> {
  const cfg = await loadConfig(env)
  cfg.sites = cfg.sites.filter((s) => s.id !== siteId)
  await saveConfig(env, cfg)
  return cfg
}

export function slugifyId(raw: string): string {
  return String(raw)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48)
}
