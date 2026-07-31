import type { CategoryFilters, FlashProduct } from '../types'

function haystack(p: FlashProduct): string {
  return `${p.title} ${p.asin}`.toLowerCase()
}

export function applyFilters(
  products: FlashProduct[],
  filters: CategoryFilters,
): FlashProduct[] {
  let list = [...products]

  if (filters.includeKeywords.length > 0) {
    const keys = filters.includeKeywords.map((k) => k.toLowerCase().trim()).filter(Boolean)
    if (keys.length) {
      const matched = list.filter((p) => {
        const h = haystack(p)
        return keys.some((k) => h.includes(k))
      })
      if (filters.requireKeywordMatch || matched.length > 0) {
        list = matched
      }
    }
  }

  if (filters.excludeKeywords.length > 0) {
    const keys = filters.excludeKeywords.map((k) => k.toLowerCase().trim()).filter(Boolean)
    list = list.filter((p) => {
      const h = haystack(p)
      return !keys.some((k) => h.includes(k))
    })
  }

  if (filters.minRating > 0) {
    list = list.filter((p) => (p.rating ?? 0) >= filters.minRating)
  }
  if (filters.minReviews > 0) {
    list = list.filter((p) => (p.reviewCount ?? 0) >= filters.minReviews)
  }
  // When a price bound is set, drop products with unknown price (scrape-only).
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

  // Prefer lower BSR rank, then higher rating
  list.sort((a, b) => {
    const ra = a.bsrRank ?? 9999
    const rb = b.bsrRank ?? 9999
    if (ra !== rb) return ra - rb
    return (b.rating ?? 0) - (a.rating ?? 0)
  })

  const n = Math.max(1, Math.min(filters.topN || 40, 200))
  return list.slice(0, n)
}
