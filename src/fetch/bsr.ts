/**
 * Lightweight Amazon Best Sellers / search discovery.
 * HTML shapes change; this is best-effort and safe to fail soft per category.
 */

import type { FlashProduct, SourceCategory } from '../types'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebChat/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

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

function extractAsins(html: string): string[] {
  const found = new Set<string>()
  const re = /\/dp\/([A-Z0-9]{10})/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    found.add(m[1].toUpperCase())
    if (found.size >= 100) break
  }
  // data-asin attributes
  const re2 = /data-asin="([A-Z0-9]{10})"/gi
  while ((m = re2.exec(html))) {
    found.add(m[1].toUpperCase())
    if (found.size >= 120) break
  }
  return [...found]
}

function extractTitleNearAsin(html: string, asin: string): string | undefined {
  const idx = html.indexOf(asin)
  if (idx < 0) return undefined
  const window = html.slice(Math.max(0, idx - 400), idx + 800)
  const m =
    window.match(/aria-label="([^"]{8,200})"/i) ||
    window.match(/alt="([^"]{8,200})"/i) ||
    window.match(/<span[^>]*class="[^"]*a-size[^"]*"[^>]*>([^<]{8,200})<\/span>/i)
  if (!m) return undefined
  return m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim()
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

export async function discoverCategory(
  cat: SourceCategory,
  opts: { associateTag: string; marketplace: string },
): Promise<FlashProduct[]> {
  const host = opts.marketplace.replace(/^https?:\/\//, '')
  const urls: string[] = []
  if (cat.browseNode) {
    urls.push(`https://${host}/gp/bestsellers/home-garden/${cat.browseNode}`)
    urls.push(`https://${host}/gp/bestsellers/kitchen/${cat.browseNode}`)
    urls.push(`https://${host}/Best-Sellers/zgbs/home-garden/${cat.browseNode}`)
  }
  if (cat.searchQuery) {
    const q = encodeURIComponent(cat.searchQuery)
    urls.push(`https://${host}/s?k=${q}`)
  }
  if (urls.length === 0) {
    const q = encodeURIComponent(cat.label)
    urls.push(`https://${host}/s?k=${q}`)
  }

  const asins = new Set<string>()
  let htmlBlob = ''
  for (const url of urls) {
    try {
      const html = await fetchHtml(url)
      htmlBlob += html
      for (const a of extractAsins(html)) asins.add(a)
      if (asins.size >= 60) break
    } catch {
      // try next URL shape
    }
  }

  const weekOf = weekOfIso()
  const products: FlashProduct[] = []
  let rank = 1
  for (const asin of asins) {
    products.push({
      asin,
      title: extractTitleNearAsin(htmlBlob, asin) || `Amazon product ${asin}`,
      url: affiliateUrl(asin, opts.associateTag, host),
      bsrRank: rank++,
      sourceCategoryId: cat.id,
      siteCategory: cat.siteCategory,
      limitedTime: true,
      weekOf,
      enriched: false,
    })
  }
  return products
}
