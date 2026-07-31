export type Env = {
  CATALOGS: R2Bucket
  APP_NAME: string
  ALLOWED_GITHUB_ORG: string
  /** Comma-separated GitHub logins allowed in addition to org members */
  ALLOWED_GITHUB_USERS?: string
  APP_BASE_URL: string
  AMAZON_ASSOCIATE_TAG: string
  AMAZON_MARKETPLACE: string
  SESSION_SECRET: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  /** Machine token for bootstrap / curl (Authorization: Bearer …) */
  ADMIN_API_TOKEN?: string
  AMAZON_CREATORS_CREDENTIAL_ID?: string
  AMAZON_CREATORS_CREDENTIAL_SECRET?: string
  AMAZON_CREATORS_CREDENTIAL_VERSION?: string
}

export function requireEnv(env: Env, key: keyof Env): string {
  const v = env[key]
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Missing required env/secret: ${String(key)}`)
  }
  return v.trim()
}
