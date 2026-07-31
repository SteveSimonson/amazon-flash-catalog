import { defaultFilters, newSite, type SiteConfig, type SourceCategory } from '../types'

function bambooCat(
  partial: Omit<SourceCategory, 'filters' | 'enabled'> & {
    topN?: number
    exclude?: string[]
  },
): SourceCategory {
  const f = defaultFilters()
  return {
    id: partial.id,
    label: partial.label,
    browseNode: undefined, // search-first only — BSR nodes pollute with non-bamboo
    searchQuery: partial.searchQuery,
    siteCategory: partial.siteCategory,
    enabled: true,
    filters: {
      ...f,
      topN: partial.topN ?? 20,
      includeKeywords: ['bamboo'],
      requireKeywordMatch: true,
      excludeKeywords: [
        ...f.excludeKeywords,
        ...(partial.exclude || []),
      ],
    },
  }
}

/** Starter iBamboo flash categories — bamboo search only, hard keyword gate. */
export function ibambooSeedSite(): SiteConfig {
  const cats: SourceCategory[] = [
    bambooCat({
      id: 'cutting-boards',
      label: 'Bamboo cutting boards',
      searchQuery: 'bamboo cutting board',
      siteCategory: 'cutting-boards',
      topN: 22,
    }),
    bambooCat({
      id: 'serving-boards',
      label: 'Bamboo serving / cheese boards',
      searchQuery: 'bamboo cheese board charcuterie',
      siteCategory: 'cutting-boards',
      topN: 12,
    }),
    bambooCat({
      id: 'kitchen-utensils',
      label: 'Bamboo kitchen utensils',
      searchQuery: 'bamboo kitchen utensils set cooking',
      siteCategory: 'kitchen',
      topN: 22,
      exclude: ['plastic handle set only'],
    }),
    bambooCat({
      id: 'dining-tabletop',
      label: 'Bamboo dinnerware',
      searchQuery: 'bamboo dinnerware plates bowls set',
      siteCategory: 'dining',
      topN: 18,
    }),
    bambooCat({
      id: 'bath',
      label: 'Bamboo bath accessories',
      searchQuery: 'bamboo soap dish bathroom accessories',
      siteCategory: 'bath',
      topN: 14,
    }),
    bambooCat({
      id: 'desk',
      label: 'Bamboo desk organizers',
      searchQuery: 'bamboo monitor stand desk organizer',
      siteCategory: 'desk',
      topN: 14,
    }),
    bambooCat({
      id: 'organization',
      label: 'Bamboo drawer organizers',
      searchQuery: 'bamboo drawer organizer kitchen expandable',
      siteCategory: 'organization',
      topN: 14,
    }),
    bambooCat({
      id: 'outdoor',
      label: 'Bamboo outdoor',
      searchQuery: 'bamboo outdoor serving tray patio',
      siteCategory: 'outdoor',
      topN: 10,
    }),
  ]

  const site = newSite({
    id: 'ibamboo',
    name: 'iBamboo',
    siteUrl: 'https://ibamboo.com',
  })
  site.schedule = 'daily'
  site.categories = cats
  return site
}
