import { describe, it, expect, afterEach } from "bun:test"
import { createApiClient } from "../src/api"
import { createMockFetch } from "../src/test-utils"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("createApiClient", () => {
  it("returns an object with get/post/put/delete methods", () => {
    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "token",
    })

    expect(typeof client.get).toBe("function")
    expect(typeof client.post).toBe("function")
    expect(typeof client.put).toBe("function")
    expect(typeof client.delete).toBe("function")
  })

  it("get() calls fetch with Authorization Bearer header", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const mockFetch = createMockFetch([{ path: "/test", body: { ok: true } }])
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      requests.push({ url: String(args[0]), init: args[1] })
      return mockFetch(...args)
    }) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "test-token",
    })

    await client.get("/test")

    expect(requests).toHaveLength(1)
    const headers = requests[0]!.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer test-token")
  })

  it("get() appends query params to URL", async () => {
    const requests: Array<{ url: string }> = []
    const mockFetch = createMockFetch([{ path: "/search", body: { results: [] } }])
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      requests.push({ url: String(args[0]) })
      return mockFetch(...args)
    }) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "token",
    })

    await client.get("/search", { q: "pods", limit: "10" })

    expect(requests[0]!.url).toContain("/search?")
    expect(requests[0]!.url).toContain("q=pods")
    expect(requests[0]!.url).toContain("limit=10")
  })

  it("post() sends JSON body with Content-Type header", async () => {
    const requests: Array<{ init?: RequestInit }> = []
    const mockFetch = createMockFetch([
      { method: "POST", path: "/items", body: { id: 1 } },
    ])
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      requests.push({ init: args[1] })
      return mockFetch(...args)
    }) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "token",
    })

    await client.post("/items", { name: "test" })

    const headers = requests[0]!.init?.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
    expect(requests[0]!.init?.body).toBe(JSON.stringify({ name: "test" }))
  })

  it("retries with fresh token on 401 response (calls tokenFn twice)", async () => {
    let tokenCallCount = 0
    const tokenFn = async () => {
      tokenCallCount++
      return `token-${tokenCallCount}`
    }

    let fetchCallCount = 0
    globalThis.fetch = (async () => {
      fetchCallCount++
      if (fetchCallCount === 1) {
        return new Response("Unauthorized", { status: 401 })
      }
      return new Response(JSON.stringify({ data: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn,
    })

    const result = await client.get("/test")
    expect(tokenCallCount).toBe(2)
    expect(result.data).toEqual({ data: "ok" })
  })

  it("does not retry on 401 when maxRetries=0", async () => {
    let tokenCallCount = 0
    const tokenFn = async () => {
      tokenCallCount++
      return "token"
    }

    globalThis.fetch = (async () => {
      return new Response("Unauthorized", { status: 401 })
    }) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn,
      maxRetries: 0,
    })

    try {
      await client.get("/test")
      expect(true).toBe(false)
    } catch (error) {
      expect(tokenCallCount).toBe(1)
      expect((error as Error).message).toContain("401")
    }
  })

  it("throws error with status and body on non-2xx response", async () => {
    globalThis.fetch = createMockFetch([
      { path: "/error", status: 500, body: { error: "Internal Server Error" } },
    ])

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "token",
    })

    try {
      await client.get("/error")
      expect(true).toBe(false)
    } catch (error) {
      expect((error as Error).message).toContain("500")
    }
  })

  it("skips Authorization header when tokenFn returns null", async () => {
    const requests: Array<{ init?: RequestInit }> = []
    const mockFetch = createMockFetch([{ path: "/test", body: { ok: true } }])
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      requests.push({ init: args[1] })
      return mockFetch(...args)
    }) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => null,
    })

    await client.get("/test")

    const headers = requests[0]!.init?.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it("includes Authorization header when tokenFn returns a value", async () => {
    const requests: Array<{ init?: RequestInit }> = []
    const mockFetch = createMockFetch([{ path: "/test", body: { ok: true } }])
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      requests.push({ init: args[1] })
      return mockFetch(...args)
    }) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "my-token",
    })

    await client.get("/test")

    const headers = requests[0]!.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer my-token")
  })

  it("aborts request after timeout", async () => {
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"))
          })
        }
      })
    ) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "token",
      timeoutMs: 50,
      maxRetries: 0,
    })

    try {
      await client.get("/slow")
      expect(true).toBe(false)
    } catch (error) {
      expect((error as Error).message).toContain("Network error")
    }
  })

  it("throws descriptive error when response is HTML", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><body>Login Required</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    ) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "token",
    })

    try {
      await client.get("/test")
      expect(true).toBe(false)
    } catch (error) {
      expect((error as Error).message).toContain("Expected JSON")
      expect((error as Error).message).toContain("text/html")
      expect((error as Error).message).toContain("Login Required")
    }
  })

  it("throws descriptive error when Content-Type is missing", async () => {
    globalThis.fetch = (async () =>
      new Response("plain text", {
        status: 200,
        headers: {},
      })
    ) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "token",
    })

    try {
      await client.get("/test")
      expect(true).toBe(false)
    } catch (error) {
      expect((error as Error).message).toContain("unknown content type")
    }
  })

  it("retries on ECONNRESET", async () => {
    let fetchCallCount = 0
    globalThis.fetch = (async () => {
      fetchCallCount++
      if (fetchCallCount === 1) {
        const err = new Error("connect ECONNRESET")
        throw err
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "token",
    })

    const result = await client.get("/test")
    expect(fetchCallCount).toBe(2)
    expect(result.data).toEqual({ ok: true })
  })

  it("does not retry on non-transient errors", async () => {
    let fetchCallCount = 0
    globalThis.fetch = (async () => {
      fetchCallCount++
      throw new TypeError("Invalid URL")
    }) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "token",
    })

    try {
      await client.get("/test")
      expect(true).toBe(false)
    } catch (error) {
      expect(fetchCallCount).toBe(1)
      expect((error as Error).message).toContain("Network error after 1 attempt")
    }
  })

  it("throws after exhausting retries on transient errors", async () => {
    let fetchCallCount = 0
    globalThis.fetch = (async () => {
      fetchCallCount++
      throw new Error("connect ECONNRESET")
    }) as unknown as typeof fetch

    const client = createApiClient({
      baseUrl: "https://api.example.com",
      tokenFn: async () => "token",
      maxRetries: 2,
    })

    try {
      await client.get("/test")
      expect(true).toBe(false)
    } catch (error) {
      expect(fetchCallCount).toBe(3)
      expect((error as Error).message).toContain("Network error after 3 attempt")
    }
  })
})
