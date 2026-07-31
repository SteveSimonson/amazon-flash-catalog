import type { Env } from '../env'
import { publishCatalog, readLatestCatalog } from '../storage/catalog'
import { upsertSite } from '../storage/config'
import {
  blurbFromTitle,
  type CatalogPayload,
  type FlashProduct,
  type SiteConfig,
} from '../types'
import {
  discoverCategory,
  hasReliableImage,
  hydrateProductMedia,
  isPlaceholderTitle,
  normalizeAmazonImage,
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
    image: normalizeAmazonImage(p.image),
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

      // Creators enrichment (soft-fail) — no heavy DP hydrate yet (rate limits)
      const enrichMap = await enrichAsins(
        env,
        fetched.map((p) => p.asin),
      )
      fetched = mergeEnrichment(fetched, enrichMap)
      fetched = fetched.map((p) => ({
        ...p,
        image: normalizeAmazonImage(p.image) || p.image,
      }))

      // Light title hydrate only when SERP titles are unusable (cap low)
      const badTitles = fetched.filter(
        (p) => isPlaceholderTitle(p.title) || !/\bbamboo\b/i.test(p.title || ''),
      )
      if (badTitles.length > 0 && badTitles.length <= 12) {
        fetched = await hydrateProductMedia(fetched, marketplace, {
          limit: 12,
          preferMissingImage: false,
        })
      }

      let kept = applyFilters(fetched, filters)
      kept = qualityGateBamboo(kept)

      // Hydrate images only for survivors still missing photos (prevention)
      const stillNoImg = kept.filter((p) => !hasReliableImage(p))
      if (stillNoImg.length) {
        kept = await hydrateProductMedia(kept, marketplace, {
          limit: Math.min(stillNoImg.length, 10),
          preferMissingImage: true,
        })
        kept = qualityGateBamboo(kept)
      }

      // Prefer imaged first; keep imageless for unique monogram fallbacks on site
      const withImg = kept.filter((p) => hasReliableImage(p))
      const noImg = kept.filter((p) => !hasReliableImage(p))
      const topN = filters.topN || 20
      kept = [...withImg, ...noImg].slice(0, topN)

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

    // Final site-wide bamboo gate; imaged products first in the published list
    const products = qualityGateBamboo(all)
      .map((p) => finalizeProduct(p, weekOf))
      .sort((a, b) => {
        const ai = hasReliableImage(a) ? 0 : 1
        const bi = hasReliableImage(b) ? 0 : 1
        return ai - bi
      })

    if (products.length === 0) {
      // Amazon often blocks Worker scrapes; keep last good catalog instead of wiping.
      const prev = await readLatestCatalog(env, site.id)
      if (prev?.products?.length) {
        await upsertSite(env, {
          ...site,
          lastErrorAt: generatedAt,
          lastError:
            'Refresh found 0 quality products (Amazon scrape/block). Kept previous catalog.',
        })
        return {
          ok: true,
          catalog: prev,
          error:
            'No new products passed quality gate; previous catalog retained',
        }
      }
      throw new Error(
        'Quality gate removed every product — Amazon HTML parse empty and no previous catalog',
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
