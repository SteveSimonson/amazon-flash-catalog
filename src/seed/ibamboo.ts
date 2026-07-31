import { defaultFilters, newSite, type SiteConfig, type SourceCategory } from '../types'

/** Starter iBamboo flash categories (subset of scripts/bsr/categories.json). */
export function ibambooSeedSite(): SiteConfig {
  const cats: SourceCategory[] = [
    {
      id: 'cutting-boards',
      label: 'Cutting Boards',
      browseNode: '289863',
      searchQuery: 'bamboo cutting board',
      enabled: true,
      siteCategory: 'cutting-boards',
      filters: {
        ...defaultFilters(),
        topN: 25,
        includeKeywords: ['bamboo'],
        requireKeywordMatch: false,
      },
    },
    {
      id: 'kitchen-utensils',
      label: 'Kitchen Utensils',
      browseNode: '289754',
      searchQuery: 'bamboo kitchen utensils set',
      enabled: true,
      siteCategory: 'kitchen',
      filters: {
        ...defaultFilters(),
        topN: 25,
        includeKeywords: ['bamboo'],
      },
    },
    {
      id: 'dining-tabletop',
      label: 'Bamboo dinnerware',
      searchQuery: 'bamboo dinnerware plates bowls set',
      enabled: true,
      siteCategory: 'dining',
      filters: {
        ...defaultFilters(),
        topN: 20,
        includeKeywords: ['bamboo'],
      },
    },
    {
      id: 'bath',
      label: 'Bath bamboo',
      searchQuery: 'bamboo soap dish bathroom',
      enabled: true,
      siteCategory: 'bath',
      filters: {
        ...defaultFilters(),
        topN: 15,
        includeKeywords: ['bamboo'],
      },
    },
    {
      id: 'desk',
      label: 'Desk bamboo',
      searchQuery: 'bamboo monitor stand riser',
      enabled: true,
      siteCategory: 'desk',
      filters: {
        ...defaultFilters(),
        topN: 15,
        includeKeywords: ['bamboo'],
      },
    },
    {
      id: 'organization',
      label: 'Drawer organizers',
      searchQuery: 'bamboo drawer organizer kitchen',
      enabled: true,
      siteCategory: 'organization',
      filters: {
        ...defaultFilters(),
        topN: 15,
        includeKeywords: ['bamboo'],
      },
    },
    {
      id: 'outdoor',
      label: 'Outdoor bamboo',
      searchQuery: 'bamboo wind chime outdoor',
      enabled: true,
      siteCategory: 'outdoor',
      filters: {
        ...defaultFilters(),
        topN: 12,
        includeKeywords: ['bamboo'],
      },
    },
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
