import { describe, it, expect, afterEach } from "bun:test"
import { createConsoleAuthClient, createConsoleApiClient } from "../src/console-auth"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const validTokenResponse = {
  access_token: "eyJhbGciOiJSUzI1NiJ9.test-access-token",
  expires_in: 900,
}

describe("createConsoleAuthClient", () => {
  describe("getAccessToken", () => {
    it("exchanges offline token for access token via POST", async () => {
      const requests: Array<{ url: string; init?: RequestInit }> = []
      globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        requests.push({ url: String(args[0]), init: args[1] })
        return new Response(JSON.stringify(validTokenResponse), { status: 200 })
      }) as unknown as typeof fetch

      const client = createConsoleAuthClient({ offlineToken: "offline-tok-123" })
      const token = await client.getAccessToken()

      expect(token).toBe("eyJhbGciOiJSUzI1NiJ9.test-access-token")
      expect(requests).toHaveLength(1)
      expect(requests[0]!.url).toBe(
        "https://sso.redhat.com/auth/realms/redhat-external/protocol/openid-connect/token",
      )
      expect(requests[0]!.init?.method).toBe("POST")

      const body = requests[0]!.init?.body as string
      expect(body).toContain("grant_type=refresh_token")
      expect(body).toContain("client_id=cloud-services")
      expect(body).toContain("refresh_token=offline-tok-123")

      const headers = requests[0]!.init?.headers as Record<string, string>
      expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded")
    })

    it("uses custom ssoUrl when provided", async () => {
      const requests: Array<{ url: string }> = []
      globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        requests.push({ url: String(args[0]) })
        return new Response(JSON.stringify(validTokenResponse), { status: 200 })
      }) as unknown as typeof fetch

      const client = createConsoleAuthClient({
        offlineToken: "tok",
        ssoUrl: "https://custom-sso.example.com",
      })
      await client.getAccessToken()

      expect(requests[0]!.url).toContain("https://custom-sso.example.com")
    })

    it("caches token and reuses it on subsequent calls", async () => {
      let fetchCount = 0
      globalThis.fetch = (async () => {
        fetchCount++
        return new Response(JSON.stringify(validTokenResponse), { status: 200 })
      }) as unknown as typeof fetch

      const client = createConsoleAuthClient({ offlineToken: "tok" })
      const token1 = await client.getAccessToken()
      const token2 = await client.getAccessToken()

      expect(token1).toBe(token2)
      expect(fetchCount).toBe(1)
    })

    it("re-fetches token when within 60s of expiry", async () => {
      let fetchCount = 0
      globalThis.fetch = (async () => {
        fetchCount++
        return new Response(
          JSON.stringify({ access_token: `token-${fetchCount}`, expires_in: 30 }),
          { status: 200 },
        )
      }) as unknown as typeof fetch

      const client = createConsoleAuthClient({ offlineToken: "tok" })

      const token1 = await client.getAccessToken()
      expect(token1).toBe("token-1")

      const token2 = await client.getAccessToken()
      expect(token2).toBe("token-2")
      expect(fetchCount).toBe(2)
    })

    it("throws on 401 response for invalid offline token", async () => {
      globalThis.fetch = (async () => {
        return new Response('{"error":"invalid_grant"}', { status: 401 })
      }) as unknown as typeof fetch

      const client = createConsoleAuthClient({ offlineToken: "bad-token" })

      expect(client.getAccessToken()).rejects.toThrow("Console SSO token exchange failed (HTTP 401)")
    })

    it("throws on network failure", async () => {
      globalThis.fetch = (async () => {
        throw new Error("fetch failed")
      }) as unknown as typeof fetch

      const client = createConsoleAuthClient({ offlineToken: "tok" })

      expect(client.getAccessToken()).rejects.toThrow("fetch failed")
    })
  })

  describe("isConfigured", () => {
    it("returns true when offlineToken is non-empty", () => {
      const client = createConsoleAuthClient({ offlineToken: "some-token" })
      expect(client.isConfigured()).toBe(true)
    })

    it("returns false when offlineToken is empty", () => {
      const client = createConsoleAuthClient({ offlineToken: "" })
      expect(client.isConfigured()).toBe(false)
    })
  })
})

describe("createConsoleApiClient", () => {
  it("creates an ApiClient that calls the correct service URL with auth", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0])
      requests.push({ url, init: args[1] })

      if (url.includes("sso.redhat.com")) {
        return new Response(JSON.stringify(validTokenResponse), { status: 200 })
      }
      return new Response(JSON.stringify({ advisories: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    const apiClient = createConsoleApiClient(
      { offlineToken: "tok" },
      "/api/insights/v1",
    )

    const result = await apiClient.get("/advisories")

    expect(result.status).toBe(200)
    expect(result.data).toEqual({ advisories: [] })

    const apiRequest = requests.find((r) => r.url.includes("console.redhat.com"))
    expect(apiRequest).toBeDefined()
    expect(apiRequest!.url).toBe("https://console.redhat.com/api/insights/v1/advisories")

    const headers = apiRequest!.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer eyJhbGciOiJSUzI1NiJ9.test-access-token")
  })

  it("uses custom apiBaseUrl when provided", async () => {
    const requests: Array<{ url: string }> = []
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0])
      requests.push({ url })

      if (url.includes("sso.redhat.com")) {
        return new Response(JSON.stringify(validTokenResponse), { status: 200 })
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    const apiClient = createConsoleApiClient(
      { offlineToken: "tok", apiBaseUrl: "https://staging.console.redhat.com" },
      "/api/cost-management/v1",
    )

    await apiClient.get("/reports")

    const apiRequest = requests.find((r) => r.url.includes("staging.console"))
    expect(apiRequest).toBeDefined()
    expect(apiRequest!.url).toBe(
      "https://staging.console.redhat.com/api/cost-management/v1/reports",
    )
  })
})
