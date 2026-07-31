/**
 * Amazon search-first discovery for bamboo products.
 * Prefers keyword search over broad BSR nodes (those mix in non-bamboo junk).
 * Best-effort HTML parse + optional DP title hydration.
 */

import type { FlashProduct, SourceCategory } from '../types'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const PLACEHOLDER_TITLE = /^amazon product\s+[a-z0-9]{10}$/i

function weekOfIso(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  if (day !== 1) date.setUTCDate(date.getUTCDate() - (day - 1))
  return date.toISOString().slice(0, 10)
}

function affiliateUrl(asin: string, tag: string, marketplace: string): string {
  const host = marketplace.replace(/^https?:\/\//, '')
  return `https://${host}/dp/${asin}?tag=${encodeURIComponent(tag)}`
}

function decodeEntities(s: string): string {
  return s
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let t = decodeEntities(raw)
  // Strip Amazon noise prefixes
  t = t.replace(/^Amazon\.com\s*:\s*/i, '').replace(/\s*:\s*Amazon\.com.*$/i, '')
  t = t.replace(/\s*[-–|]\s*Amazon\.com.*$/i, '')
  if (t.length < 8) return undefined
  if (PLACEHOLDER_TITLE.test(t)) return undefined
  // Drop pure UI chrome
  if (/^(sponsored|best seller|overall pick|climate pledge)/i.test(t)) return undefined
  return t.slice(0, 200)
}

function looksBamboo(text: string): boolean {
  return /\bbamboo\b/i.test(text)
}

/** Prefer durable Amazon listing CDN paths (`/images/I/…`), sized for cards. */
export function normalizeAmazonImage(
  url: string | undefined | null,
): string | undefined {
  if (!url) return undefined
  let u = url.trim().replace(/^http:\/\//i, 'https://')
  // Reject flaky ASIN P/ guesses — they often 404 as white tiles
  if (/\/images\/P\/[A-Z0-9]{10}/i.test(u)) return undefined
  if (!/\/images\/I\//i.test(u)) return undefined
  u = u
    .replace(/\._AC_UL\d+(?:_SR\d+,\d+)?(?:_QL\d+)?_\./i, '._AC_SL500_.')
    .replace(/\._AC_UL[^.]+\./i, '._AC_SL500_.')
    .replace(/\._AC_UX\d+_.*?\./i, '._AC_SL500_.')
    .replace(/\._AC_UY\d+_.*?\./i, '._AC_SL500_.')
    .replace(/\._AC_SL\d+_\./i, '._AC_SL500_.')
    .replace(/\._SX\d+_\./i, '._SL500_.')
    .replace(/\._SY\d+_\./i, '._SL500_.')
  // Ensure a size token if bare /I/hash.jpg
  if (!/\._[A-Z]{2}/i.test(u) && /\.jpg/i.test(u)) {
    u = u.replace(/\.jpg/i, '._AC_SL500_.jpg')
  }
  return u
}

export function hasReliableImage(p: { image?: string }): boolean {
  return Boolean(normalizeAmazonImage(p.image))
}

/** Ensure search queries always include bamboo. */
export function bambooSearchQuery(cat: SourceCategory): string {
  const base = (cat.searchQuery || cat.label || cat.id || '').trim()
  if (!base) return 'bamboo home'
  if (/\bbamboo\b/i.test(base)) return base
  return `bamboo ${base}`
}

type Card = { asin: string; title?: string; image?: string }

/**
 * Parse Amazon search / list HTML into ASIN + title + image cards.
 * Works against common search result markup (data-asin blocks).
 */
export function parseProductCards(html: string): Card[] {
  const byAsin = new Map<string, Card>()

  // Split on data-asin result tiles
  const tileRe = /data-asin="([A-Z0-9]{10})"/gi
  let m: RegExpExecArray | null
  const indices: Array<{ asin: string; i: number }> = []
  while ((m = tileRe.exec(html))) {
    indices.push({ asin: m[1].toUpperCase(), i: m.index })
  }

  for (let t = 0; t < indices.length; t++) {
    const { asin, i } = indices[t]
    if (byAsin.has(asin)) continue
    const end = t + 1 < indices.length ? indices[t + 1].i : Math.min(html.length, i + 6000)
    const block = html.slice(i, end)

    const titleMatch =
      block.match(
        /<span[^>]*class="[^"]*a-size-(?:base-plus|medium|base)[^"]*a-color-base[^"]*a-text-normal[^"]*"[^>]*>([^<]{8,240})<\/span>/i,
      ) ||
      block.match(
        /<h2[^>]*>[\s\S]*?<span[^>]*class="[^"]*a-text-normal[^"]*"[^>]*>([^<]{8,240})<\/span>/i,
      ) ||
      block.match(/<h2[^>]*aria-label="([^"]{8,240})"/i) ||
      block.match(/class="[^"]*s-title-instructions-style[^"]*"[\s\S]*?<span[^>]*>([^<]{8,240})<\/span>/i)

    const imgMatch =
      block.match(
        /src="(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9,._%-]+\._AC_[^"]+\.jpg)"/i,
      ) ||
      block.match(
        /data-src="(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9,._%-]+[^"]*)"/i,
      ) ||
      block.match(
        /src="(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9,._%-]+\.jpg)"/i,
      ) ||
      block.match(
        /(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9,._%-]+)/i,
      ) ||
      block.match(
        /(https:\/\/images-na\.ssl-images-amazon\.com\/images\/I\/[A-Za-z0-9,._%-]+)/i,
      )

    const title = cleanTitle(titleMatch?.[1])
    byAsin.set(asin, {
      asin,
      title,
      image: normalizeAmazonImage(imgMatch?.[1]),
    })
    if (byAsin.size >= 80) break
  }

  // JSON embedded titles (some SERP payloads)
  const jsonTitleRe =
    /"asin"\s*:\s*"([A-Z0-9]{10})"[\s\S]{0,400}?"title"\s*:\s*"((?:\\.|[^"\\]){8,240})"/gi
  while ((m = jsonTitleRe.exec(html))) {
    const asin = m[1].toUpperCase()
    const title = cleanTitle(m[2])
    const prev = byAsin.get(asin) || { asin }
    if (title && (!prev.title || PLACEHOLDER_TITLE.test(prev.title))) {
      byAsin.set(asin, { ...prev, title })
    }
  }

  return [...byAsin.values()]
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`Fetch ${url} → HTTP ${res.status}`)
  return res.text()
}

export type HydrateOpts = {
  /** Max DP fetches */
  limit?: number
  /** Prefer products missing image and/or title */
  preferMissingImage?: boolean
}

/**
 * Hydrate missing titles/images from product detail pages.
 * Prefers products missing reliable `/images/I/` photos.
 */
export async function hydrateProductMedia(
  products: FlashProduct[],
  marketplace: string,
  opts: HydrateOpts = {},
): Promise<FlashProduct[]> {
  const limit = opts.limit ?? 36
  const host = marketplace.replace(/^https?:\/\//, '')
  const need = products
    .filter(
      (p) =>
        !hasReliableImage(p) ||
        !p.title ||
        PLACEHOLDER_TITLE.test(p.title) ||
        !looksBamboo(p.title),
    )
    .sort((a, b) => {
      // Missing image first when requested
      if (opts.preferMissingImage) {
        const ai = hasReliableImage(a) ? 1 : 0
        const bi = hasReliableImage(b) ? 1 : 0
        if (ai !== bi) return ai - bi
      }
      return 0
    })
  const targets = need.slice(0, limit)
  if (!targets.length) return products

  const byAsin = new Map<string, { title?: string; image?: string }>()
  const queue = [...targets]
  const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (queue.length) {
      const p = queue.shift()
      if (!p) break
      try {
        const html = await fetchHtml(`https://${host}/dp/${p.asin}`)
        const og =
          html.match(
            /<meta\s+property="og:title"\s+content="([^"]{8,240})"/i,
          ) || html.match(/<meta\s+name="title"\s+content="([^"]{8,240})"/i)
        const h1 = html.match(/id="productTitle"[^>]*>\s*([^<]{8,240})\s*</i)
        const title = cleanTitle(og?.[1] || h1?.[1])
        const ogImg = html.match(
          /<meta\s+property="og:image"\s+content="(https:\/\/[^"]+)"/i,
        )
        const img =
          html.match(
            /id="landingImage"[^>]*(?:data-old-hires|data-a-dynamic-image|src)="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i,
          ) ||
          html.match(
            /"hiRes"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i,
          ) ||
          html.match(
            /"large"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i,
          ) ||
          ogImg
        const image = normalizeAmazonImage(img?.[1] || ogImg?.[1])
        if (title || image) {
          byAsin.set(p.asin.toUpperCase(), { title, image })
        }
      } catch {
        // skip
      }
    }
  })
  await Promise.all(workers)

  return products.map((p) => {
    const h = byAsin.get(p.asin.toUpperCase())
    if (!h) {
      return { ...p, image: normalizeAmazonImage(p.image) }
    }
    return {
      ...p,
      title: h.title || p.title,
      image: h.image || normalizeAmazonImage(p.image),
    }
  })
}

/** @deprecated use hydrateProductMedia */
export async function hydrateProductTitles(
  products: FlashProduct[],
  marketplace: string,
  limit = 24,
): Promise<FlashProduct[]> {
  return hydrateProductMedia(products, marketplace, { limit })
}

export function isPlaceholderTitle(title: string | undefined): boolean {
  if (!title) return true
  return PLACEHOLDER_TITLE.test(title)
}

export async function discoverCategory(
  cat: SourceCategory,
  opts: { associateTag: string; marketplace: string },
): Promise<FlashProduct[]> {
  const host = opts.marketplace.replace(/^https?:\/\//, '')
  const q = bambooSearchQuery(cat)
  // Search-first only — broad BSR nodes inject non-bamboo junk.
  // Simple search first (department filters often empty / blocked for bots)
  const urls = [
    `https://${host}/s?k=${encodeURIComponent(q)}`,
    `https://${host}/s?k=${encodeURIComponent(q)}&s=exact-aware-popularity-rank`,
    `https://${host}/s?k=${encodeURIComponent(q + ' kitchen')}`,
  ]

  const cards = new Map<string, Card>()
  for (const url of urls) {
    try {
      const html = await fetchHtml(url)
      for (const c of parseProductCards(html)) {
        if (!cards.has(c.asin)) cards.set(c.asin, c)
      }
      // Enough high-quality cards with bamboo titles?
      const bambooish = [...cards.values()].filter(
        (c) => c.title && looksBamboo(c.title),
      ).length
      if (bambooish >= 20 || cards.size >= 50) break
    } catch {
      // try next
    }
  }

  const weekOf = weekOfIso()
  const products: FlashProduct[] = []
  let rank = 1
  for (const c of cards.values()) {
    const title = c.title || `Amazon product ${c.asin}`
    products.push({
      asin: c.asin,
      title,
      url: affiliateUrl(c.asin, opts.associateTag, host),
      image: c.image,
      bsrRank: rank++,
      sourceCategoryId: cat.id,
      siteCategory: cat.siteCategory,
      limitedTime: true,
      weekOf,
      enriched: false,
    })
  }

  // Prefer items that already look like bamboo; still return all for hydrate step
  products.sort((a, b) => {
    const ba = looksBamboo(a.title) ? 0 : 1
    const bb = looksBamboo(b.title) ? 0 : 1
    if (ba !== bb) return ba - bb
    return (a.bsrRank ?? 99) - (b.bsrRank ?? 99)
  })

  return products
}
