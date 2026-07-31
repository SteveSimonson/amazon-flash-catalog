/** Shared Amazon Flash Catalog types */

export type CronPreset =
  | 'manual'
  | 'hourly'
  | 'every_6h'
  | 'daily'
  | 'weekly'

export type CategoryFilters = {
  /** Max products to keep for this source category after filters (default 40) */
  topN: number
  /** Minimum star rating 0–5; 0 = no floor */
  minRating: number
  /** Minimum review count; 0 = no floor */
  minReviews: number
  /** Inclusive price band in USD; null = open */
  minPrice: number | null
  maxPrice: number | null
  /** Title/keyword must match at least one (case-insensitive); empty = any */
  includeKeywords: string[]
  /** Drop if title matches any */
  excludeKeywords: string[]
  /** Prefer / require “bamboo” bias (soft: score boost; hard: must match) */
  requireKeywordMatch: boolean
}

export type SourceCategory = {
  id: string
  label: string
  /** Amazon Best Sellers browse node id, if known */
  browseNode?: string
  /** Free-text Amazon search used when node is sparse or missing */
  searchQuery?: string
  enabled: boolean
  /** Map into the consuming site’s shelf / category slug */
  siteCategory: string
  filters: CategoryFilters
}

export type SiteConfig = {
  id: string
  name: string
  /** Optional public site URL (docs only) */
  siteUrl?: string
  enabled: boolean
  /** Manual + optional cron */
  schedule: CronPreset
  /** ISO timestamp of last successful publish */
  lastRunAt?: string
  /** ISO timestamp of last failure */
  lastErrorAt?: string
  lastError?: string
  /** Product count in last successful catalog */
  lastProductCount?: number
  categories: SourceCategory[]
  createdAt: string
  updatedAt: string
}

export type AppConfig = {
  version: 1
  sites: SiteConfig[]
}

export type FlashProduct = {
  asin: string
  title: string
  url: string
  image?: string
  price?: number
  currency?: string
  rating?: number
  reviewCount?: number
  bsrRank?: number
  /** Source browse node or search id */
  sourceCategoryId: string
  /** Mapped site shelf */
  siteCategory: string
  limitedTime: boolean
  weekOf: string
  enriched: boolean
  raw?: Record<string, unknown>
}

export type CatalogPayload = {
  siteId: string
  siteName: string
  generatedAt: string
  weekOf: string
  productCount: number
  associateTag: string
  marketplace: string
  products: FlashProduct[]
  /** Per source-category stats for the admin UI */
  categoryStats: Array<{
    sourceCategoryId: string
    siteCategory: string
    fetched: number
    kept: number
  }>
}

export type SessionUser = {
  login: string
  id: number
  name?: string
  avatarUrl?: string
  orgs: string[]
}

export function defaultFilters(): CategoryFilters {
  return {
    topN: 40,
    minRating: 0,
    minReviews: 0,
    minPrice: null,
    maxPrice: null,
    includeKeywords: ['bamboo'],
    excludeKeywords: [],
    requireKeywordMatch: false,
  }
}

export function emptyConfig(): AppConfig {
  return { version: 1, sites: [] }
}

export function newSite(partial: {
  id: string
  name: string
  siteUrl?: string
}): SiteConfig {
  const now = new Date().toISOString()
  return {
    id: partial.id,
    name: partial.name,
    siteUrl: partial.siteUrl,
    enabled: true,
    schedule: 'manual',
    categories: [],
    createdAt: now,
    updatedAt: now,
  }
}
