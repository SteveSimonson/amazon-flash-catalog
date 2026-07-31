import type { CategoryFilters, FlashProduct } from '../types'
import { isPlaceholderTitle } from './bsr'

const DEFAULT_EXCLUDES = [
  'plastic',
  'silicone',
  'polyester',
  'stainless steel only',
  'for pets only',
  'dog toy',
  'cat toy',
  'phone case',
  'screen protector',
  'ebook',
  'kindle',
  'video game',
  'bluetooth speaker',
  'led light strip',
]

function haystack(p: FlashProduct): string {
  return `${p.title || ''} ${p.asin || ''}`.toLowerCase()
}

function hasKeyword(text: string, keys: string[]): boolean {
  const h = text.toLowerCase()
  return keys.some((k) => h.includes(k))
}

/**
 * Quality gate + merchandising filters.
 * Include keywords are HARD by default (requireKeywordMatch default true).
 * Placeholder titles ("Amazon product ASIN") never pass keyword checks.
 */
export function applyFilters(
  products: FlashProduct[],
  filters: CategoryFilters,
): FlashProduct[] {
  let list = [...products]

  // Drop empty / junk titles always
  list = list.filter((p) => {
    const t = (p.title || '').trim()
    if (t.length < 8) return false
    if (isPlaceholderTitle(t)) return false
    return true
  })

  const include = (filters.includeKeywords || [])
    .map((k) => k.toLowerCase().trim())
    .filter(Boolean)
  // Default hard require when include list present
  const hard =
    filters.requireKeywordMatch !== false || include.length > 0

  if (include.length > 0) {
    list = list.filter((p) => hasKeyword(haystack(p), include))
    // If hard and nothing left, return empty (do not soft-pass junk)
    if (hard && list.length === 0) return []
  }

  const exclude = [
    ...DEFAULT_EXCLUDES,
    ...(filters.excludeKeywords || []).map((k) => k.toLowerCase().trim()),
  ].filter(Boolean)

  if (exclude.length) {
    list = list.filter((p) => !hasKeyword(haystack(p), exclude))
  }

  if (filters.minRating > 0) {
    list = list.filter((p) => (p.rating ?? 0) >= filters.minRating)
  }
  if (filters.minReviews > 0) {
    list = list.filter((p) => (p.reviewCount ?? 0) >= filters.minReviews)
  }
  if (filters.minPrice != null) {
    list = list.filter(
      (p) => p.price != null && p.price >= filters.minPrice!,
    )
  }
  if (filters.maxPrice != null) {
    list = list.filter(
      (p) => p.price != null && p.price <= filters.maxPrice!,
    )
  }

  // Prefer bamboo-in-title, then rank, then rating
  list.sort((a, b) => {
    const ba = /\bbamboo\b/i.test(a.title) ? 1 : 0
    const bb = /\bbamboo\b/i.test(b.title) ? 1 : 0
    if (ba !== bb) return bb - ba
    const ra = a.bsrRank ?? 9999
    const rb = b.bsrRank ?? 9999
    if (ra !== rb) return ra - rb
    return (b.rating ?? 0) - (a.rating ?? 0)
  })

  const n = Math.max(1, Math.min(filters.topN || 40, 200))
  return list.slice(0, n)
}

/** Site-wide quality pass after merge (always require bamboo in title). */
export function qualityGateBamboo(products: FlashProduct[]): FlashProduct[] {
  return products.filter((p) => {
    if (isPlaceholderTitle(p.title)) return false
    if (!/\bbamboo\b/i.test(p.title)) return false
    if (p.title.length < 12) return false
    return true
  })
}
