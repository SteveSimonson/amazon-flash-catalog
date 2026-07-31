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
  const idx = html.toUpperCase().indexOf(asin.toUpperCase())
  if (idx < 0) return undefined
  const window = html.slice(Math.max(0, idx - 1200), idx + 1600)
  const patterns = [
    /"title"\s*:\s*"((?:\\.|[^"\\]){8,240})"/i,
    /data-title="([^"]{8,240})"/i,
    /aria-label="([^"]{8,240})"/i,
    /alt="([^"]{8,240})"/i,
    /<span[^>]*class="[^"]*a-size[^"]*"[^>]*>([^<]{8,240})<\/span>/i,
    /<h2[^>]*>[\s\S]*?<span[^>]*>([^<]{8,240})<\/span>/i,
  ]
  for (const re of patterns) {
    const m = window.match(re)
    if (!m?.[1]) continue
    const t = m[1]
      .replace(/\\u0026/g, '&')
      .replace(/\\"/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim()
    if (t.length >= 8 && !/^amazon product/i.test(t)) return t.slice(0, 200)
  }
  return undefined
}

function extractImageNearAsin(html: string, asin: string): string | undefined {
  const idx = html.toUpperCase().indexOf(asin.toUpperCase())
  if (idx < 0) return undefined
  const window = html.slice(Math.max(0, idx - 800), idx + 1200)
  const m =
    window.match(
      /(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9._%+-]+\.jpg)/i,
    ) ||
    window.match(
      /(https:\/\/images-na\.ssl-images-amazon\.com\/images\/I\/[A-Za-z0-9._%+-]+)/i,
    )
  return m?.[1]
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
      image: extractImageNearAsin(htmlBlob, asin),
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
