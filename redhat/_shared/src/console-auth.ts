import { createApiClient, type ApiClient } from "./api"

export type ConsoleAuthConfig = {
  offlineToken: string
  ssoUrl?: string
  apiBaseUrl?: string
}

export type ConsoleAuthClient = {
  getAccessToken(): Promise<string>
  isConfigured(): boolean
}

type TokenResponse = {
  access_token: string
  expires_in: number
}

type CachedToken = {
  accessToken: string
  expiresAt: number
}

const DEFAULT_SSO_URL = "https://sso.redhat.com"
const DEFAULT_API_BASE_URL = "https://console.redhat.com"
const TOKEN_PATH = "/auth/realms/redhat-external/protocol/openid-connect/token"
const EXPIRY_BUFFER_MS = 60_000

export function createConsoleAuthClient(config: ConsoleAuthConfig): ConsoleAuthClient {
  const ssoUrl = config.ssoUrl ?? DEFAULT_SSO_URL
  let cached: CachedToken | undefined

  function isTokenValid(): boolean {
    return cached !== undefined && Date.now() < cached.expiresAt - EXPIRY_BUFFER_MS
  }

  async function fetchAccessToken(): Promise<CachedToken> {
    const url = `${ssoUrl}${TOKEN_PATH}`
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "cloud-services",
      refresh_token: config.offlineToken,
    })

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Console SSO token exchange failed (HTTP ${response.status}): ${text}`)
    }

    const data = (await response.json()) as TokenResponse
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    }
  }

  return {
    async getAccessToken(): Promise<string> {
      if (!isTokenValid()) {
        cached = await fetchAccessToken()
      }
      return cached!.accessToken
    },

    isConfigured(): boolean {
      return config.offlineToken.length > 0
    },
  }
}

export function createConsoleApiClient(
  config: ConsoleAuthConfig,
  servicePath: string,
  sharedAuthClient?: ConsoleAuthClient,
): ApiClient {
  const apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL
  const authClient = sharedAuthClient ?? createConsoleAuthClient(config)

  return createApiClient({
    baseUrl: `${apiBaseUrl}${servicePath}`,
    tokenFn: () => authClient.getAccessToken(),
  })
}
