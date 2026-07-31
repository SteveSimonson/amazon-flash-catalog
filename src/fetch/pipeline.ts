import type { Env } from '../env'
import { publishCatalog } from '../storage/catalog'
import { upsertSite } from '../storage/config'
import {
  blurbFromTitle,
  type CatalogPayload,
  type FlashProduct,
  type SiteConfig,
} from '../types'
import {
  discoverCategory,
  hydrateProductTitles,
  isPlaceholderTitle,
} from './bsr'
import { enrichAsins, mergeEnrichment } from './creators'
import { applyFilters, qualityGateBamboo } from './filters'

function weekOfIso(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  if (day !== 1) date.setUTCDate(date.getUTCDate() - (day - 1))
  return date.toISOString().slice(0, 10)
}

export type RefreshResult = {
  ok: boolean
  catalog?: CatalogPayload
  error?: string
  publishedKeys?: { latestKey: string; runKey: string }
}

function finalizeProduct(p: FlashProduct, weekOf: string): FlashProduct {
  const title = (p.title || '').trim()
  return {
    ...p,
    title,
    weekOf,
    limitedTime: true,
    blurb: blurbFromTitle(title, p.siteCategory),
  }
}

export async function refreshSite(
  env: Env,
  site: SiteConfig,
): Promise<RefreshResult> {
  const generatedAt = new Date().toISOString()
  const weekOf = weekOfIso()
  const tag = env.AMAZON_ASSOCIATE_TAG || 'iu0e3-20'
  const marketplace = env.AMAZON_MARKETPLACE || 'www.amazon.com'

  try {
    const enabled = site.categories.filter((c) => c.enabled)
    if (enabled.length === 0) {
      throw new Error('No enabled source categories — add categories in admin')
    }

    const categoryStats: CatalogPayload['categoryStats'] = []
    const all: FlashProduct[] = []
    const seen = new Set<string>()

    for (const cat of enabled) {
      // Ensure hard bamboo keywords on every category
      const filters = {
        ...cat.filters,
        includeKeywords:
          cat.filters.includeKeywords?.length > 0
            ? cat.filters.includeKeywords
            : ['bamboo'],
        requireKeywordMatch: true,
      }

      let fetched = await discoverCategory(cat, {
        associateTag: tag,
        marketplace,
      })
      const fetchedCount = fetched.length

      // Creators enrichment (soft-fail) then DP hydrate for remaining bad titles
      const enrichMap = await enrichAsins(
        env,
        fetched.map((p) => p.asin),
      )
      fetched = mergeEnrichment(fetched, enrichMap)

      const stillBad = fetched.filter(
        (p) => isPlaceholderTitle(p.title) || !/\bbamboo\b/i.test(p.title),
      )
      if (stillBad.length) {
        fetched = await hydrateProductTitles(fetched, marketplace, 28)
      }

      let kept = applyFilters(fetched, filters)
      kept = qualityGateBamboo(kept)

      categoryStats.push({
        sourceCategoryId: cat.id,
        siteCategory: cat.siteCategory,
        fetched: fetchedCount,
        kept: kept.length,
      })

      for (const p of kept) {
        const key = p.asin.toUpperCase()
        if (seen.has(key)) continue
        seen.add(key)
        all.push(finalizeProduct(p, weekOf))
      }
    }

    // Final site-wide bamboo gate
    const products = qualityGateBamboo(all).map((p) => finalizeProduct(p, weekOf))

    if (products.length === 0) {
      throw new Error(
        'Quality gate removed every product — check search queries include bamboo and Amazon HTML parse is working',
      )
    }

    const catalog: CatalogPayload = {
      siteId: site.id,
      siteName: site.name,
      generatedAt,
      weekOf,
      productCount: products.length,
      associateTag: tag,
      marketplace,
      products,
      categoryStats,
    }

    const publishedKeys = await publishCatalog(env, catalog)

    await upsertSite(env, {
      ...site,
      lastRunAt: generatedAt,
      lastProductCount: products.length,
      lastError: undefined,
      lastErrorAt: undefined,
    })

    return { ok: true, catalog, publishedKeys }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await upsertSite(env, {
      ...site,
      lastError: message,
      lastErrorAt: generatedAt,
    })
    return { ok: false, error: message }
  }
}

/** Map cron preset → whether a run is due given lastRunAt. */
export function isScheduleDue(
  schedule: SiteConfig['schedule'],
  lastRunAt: string | undefined,
  now = Date.now(),
): boolean {
  if (schedule === 'manual') return false
  if (!lastRunAt) return true
  const last = Date.parse(lastRunAt)
  if (Number.isNaN(last)) return true
  const elapsed = now - last
  const hour = 60 * 60 * 1000
  switch (schedule) {
    case 'hourly':
      return elapsed >= hour
    case 'every_6h':
      return elapsed >= 6 * hour
    case 'daily':
      return elapsed >= 24 * hour
    case 'weekly':
      return elapsed >= 7 * 24 * hour
    default:
      return false
  }
}
