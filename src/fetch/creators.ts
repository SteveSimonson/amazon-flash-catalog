/**
 * Optional Amazon Creators API enrichment.
 * Soft-fails when credentials missing or AssociateNotEligible.
 */

import type { Env } from '../env'
import type { FlashProduct } from '../types'

const TOKEN_ENDPOINTS: Record<string, string> = {
  '3.1': 'https://api.amazon.com/auth/o2/token',
  '3.2': 'https://api.amazon.co.uk/auth/o2/token',
  '3.3': 'https://api.amazon.co.jp/auth/o2/token',
}

type TokenCache = { token: string; exp: number }
let tokenCache: TokenCache | null = null

function hasCreatorsCreds(env: Env): boolean {
  return Boolean(
    env.AMAZON_CREATORS_CREDENTIAL_ID &&
      env.AMAZON_CREATORS_CREDENTIAL_SECRET,
  )
}

async function getAccessToken(env: Env): Promise<string | null> {
  if (!hasCreatorsCreds(env)) return null
  const now = Date.now()
  if (tokenCache && tokenCache.exp > now + 60_000) return tokenCache.token

  const version = env.AMAZON_CREATORS_CREDENTIAL_VERSION || '3.1'
  const tokenUrl = TOKEN_ENDPOINTS[version]
  if (!tokenUrl) return null

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.AMAZON_CREATORS_CREDENTIAL_ID!,
    client_secret: env.AMAZON_CREATORS_CREDENTIAL_SECRET!,
    scope: 'creatorsapi/default',
  })

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    access_token?: string
    expires_in?: number
  }
  if (!data.access_token) return null
  tokenCache = {
    token: data.access_token,
    exp: now + (data.expires_in || 3600) * 1000,
  }
  return data.access_token
}

/** Batch GetItems — returns map asin → partial enrichment. Soft-empty on failure. */
export async function enrichAsins(
  env: Env,
  asins: string[],
): Promise<Map<string, Partial<FlashProduct>>> {
  const out = new Map<string, Partial<FlashProduct>>()
  if (!asins.length) return out

  const token = await getAccessToken(env)
  if (!token) return out

  const partnerTag = env.AMAZON_ASSOCIATE_TAG || 'iu0e3-20'
  const marketplace = env.AMAZON_MARKETPLACE || 'www.amazon.com'
  const unique = [...new Set(asins.map((a) => a.toUpperCase()))]

  // Creators GetItems typically batches ≤10
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10)
    try {
      const res = await fetch('https://creatorsapi.amazon/catalog/v1/getItems', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-marketplace': marketplace,
          'x-partner-tag': partnerTag,
        },
        body: JSON.stringify({
          itemIds: batch,
          resources: [
            'images.primary.large',
            'itemInfo.title',
            'offersV2.listings.price',
            'browseNodeInfo.websiteSalesRank',
          ],
        }),
      })
      if (!res.ok) {
        // AssociateNotEligible and friends — stop trying this run
        if (res.status === 403 || res.status === 401) break
        continue
      }
      const data = (await res.json()) as {
        itemsResult?: {
          items?: Array<{
            asin?: string
            itemInfo?: { title?: { displayValue?: string } }
            images?: { primary?: { large?: { url?: string } } }
            offersV2?: {
              listings?: Array<{
                price?: { money?: { amount?: number; currency?: string } }
              }>
            }
            browseNodeInfo?: {
              websiteSalesRank?: { salesRank?: number }
            }
          }>
        }
      }
      for (const item of data.itemsResult?.items || []) {
        const asin = (item.asin || '').toUpperCase()
        if (!asin) continue
        const price = item.offersV2?.listings?.[0]?.price?.money
        out.set(asin, {
          title: item.itemInfo?.title?.displayValue,
          image: item.images?.primary?.large?.url,
          price: price?.amount,
          currency: price?.currency || 'USD',
          bsrRank: item.browseNodeInfo?.websiteSalesRank?.salesRank,
          enriched: true,
        })
      }
    } catch {
      // soft fail batch
    }
  }
  return out
}

export function mergeEnrichment(
  products: FlashProduct[],
  enrich: Map<string, Partial<FlashProduct>>,
): FlashProduct[] {
  return products.map((p) => {
    const e = enrich.get(p.asin.toUpperCase())
    if (!e) return p
    return {
      ...p,
      title: e.title || p.title,
      image: e.image || p.image,
      price: e.price ?? p.price,
      currency: e.currency || p.currency,
      bsrRank: e.bsrRank ?? p.bsrRank,
      rating: e.rating ?? p.rating,
      reviewCount: e.reviewCount ?? p.reviewCount,
      enriched: Boolean(e.enriched),
    }
  })
}
