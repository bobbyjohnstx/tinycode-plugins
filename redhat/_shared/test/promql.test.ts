import { describe, it, expect, afterEach } from "bun:test"
import { createPromQLClient, parseDuration } from "../src/promql"
import { createMockFetch } from "../src/test-utils"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const tokenFn = async () => "test-token"

describe("createPromQLClient", () => {
  it("instantQuery returns vector results", async () => {
    globalThis.fetch = createMockFetch([
      {
        path: "/api/v1/query",
        body: {
          status: "success",
          data: {
            resultType: "vector",
            result: [
              { metric: { __name__: "up", job: "prometheus" }, value: [1234567890, "1"] },
            ],
          },
        },
      },
    ])

    const client = createPromQLClient({ baseUrl: "https://thanos.example.com", tokenFn })
    const result = await client.instantQuery("up")

    expect(result.resultType).toBe("vector")
    expect(result.result).toHaveLength(1)
    const vector = result.result as Array<{ metric: Record<string, string>; value: [number, string] }>
    expect(vector[0]!.metric.__name__).toBe("up")
    expect(vector[0]!.value[1]).toBe("1")
  })

  it("instantQuery returns scalar results", async () => {
    globalThis.fetch = createMockFetch([
      {
        path: "/api/v1/query",
        body: {
          status: "success",
          data: {
            resultType: "scalar",
            result: [1234567890, "42"],
          },
        },
      },
    ])

    const client = createPromQLClient({ baseUrl: "https://thanos.example.com", tokenFn })
    const result = await client.instantQuery("42")

    expect(result.resultType).toBe("scalar")
    expect(result.result).toEqual([1234567890, "42"])
  })

  it("instantQuery passes optional time parameter", async () => {
    const urls: string[] = []
    const mockFetch = createMockFetch([
      {
        path: "/api/v1/query",
        body: { status: "success", data: { resultType: "vector", result: [] } },
      },
    ])
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      urls.push(String(args[0]))
      return mockFetch(...args)
    }) as unknown as typeof fetch

    const client = createPromQLClient({ baseUrl: "https://thanos.example.com", tokenFn })
    await client.instantQuery("up", "2024-01-01T00:00:00Z")

    expect(urls[0]).toContain("time=2024-01-01T00%3A00%3A00Z")
  })

  it("rangeQuery returns matrix results", async () => {
    globalThis.fetch = createMockFetch([
      {
        path: "/api/v1/query_range",
        body: {
          status: "success",
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { __name__: "up", job: "prometheus" },
                values: [
                  [1234567890, "1"],
                  [1234567900, "1"],
                  [1234567910, "0"],
                ],
              },
            ],
          },
        },
      },
    ])

    const client = createPromQLClient({ baseUrl: "https://thanos.example.com", tokenFn })
    const result = await client.rangeQuery("up", "1234567890", "1234567910", "10s")

    expect(result.resultType).toBe("matrix")
    expect(result.result).toHaveLength(1)
    const matrix = result.result as Array<{ metric: Record<string, string>; values: [number, string][] }>
    expect(matrix[0]!.values).toHaveLength(3)
  })

  it("alerts returns firing and pending alerts", async () => {
    const mockAlerts = [
      {
        labels: { alertname: "HighCPU", severity: "critical" },
        annotations: { summary: "CPU usage is high" },
        state: "firing",
        activeAt: "2024-01-01T00:00:00Z",
        value: "95",
        fingerprint: "abc123",
      },
      {
        labels: { alertname: "DiskFull", severity: "warning" },
        annotations: { summary: "Disk is almost full" },
        state: "pending",
        activeAt: "2024-01-01T01:00:00Z",
        value: "85",
        fingerprint: "def456",
      },
    ]

    globalThis.fetch = createMockFetch([
      { path: "/api/v2/alerts", body: mockAlerts },
    ])

    const client = createPromQLClient({ baseUrl: "https://thanos.example.com", tokenFn })
    const alerts = await client.alerts()

    expect(alerts).toHaveLength(2)
    expect(alerts[0]!.labels.alertname).toBe("HighCPU")
    expect(alerts[0]!.state).toBe("firing")
    expect(alerts[1]!.state).toBe("pending")
  })

  it("alerts passes active and silenced filter params", async () => {
    const urls: string[] = []
    const mockFetch = createMockFetch([
      { path: "/api/v2/alerts", body: [] },
    ])
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      urls.push(String(args[0]))
      return mockFetch(...args)
    }) as unknown as typeof fetch

    const client = createPromQLClient({ baseUrl: "https://thanos.example.com", tokenFn })
    await client.alerts(true, false)

    expect(urls[0]).toContain("active=true")
    expect(urls[0]).toContain("silenced=false")
  })

  it("silenceAlert creates silence and returns silence ID", async () => {
    const bodies: unknown[] = []
    const mockFetch = createMockFetch([
      { method: "POST", path: "/api/v2/silences", body: { silenceID: "silence-789" } },
    ])
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      if (args[1]?.body) {
        bodies.push(JSON.parse(args[1].body as string))
      }
      return mockFetch(...args)
    }) as unknown as typeof fetch

    const client = createPromQLClient({ baseUrl: "https://thanos.example.com", tokenFn })
    const matchers = [{ name: "alertname", value: "HighCPU", isRegex: false, isEqual: true }]
    const silenceId = await client.silenceAlert(matchers, "1h", "admin", "Planned maintenance")

    expect(silenceId).toBe("silence-789")
    const body = bodies[0] as Record<string, unknown>
    expect(body.matchers).toEqual(matchers)
    expect(body.createdBy).toBe("admin")
    expect(body.comment).toBe("Planned maintenance")
    expect(body.startsAt).toBeDefined()
    expect(body.endsAt).toBeDefined()
  })

  it("uses separate alertManagerUrl when configured", async () => {
    const urls: string[] = []
    const mockFetch = createMockFetch([
      { path: "/api/v2/alerts", body: [] },
    ])
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      urls.push(String(args[0]))
      return mockFetch(...args)
    }) as unknown as typeof fetch

    const client = createPromQLClient({
      baseUrl: "https://thanos.example.com",
      alertManagerUrl: "https://alertmanager.example.com",
      tokenFn,
    })
    await client.alerts()

    expect(urls[0]).toContain("alertmanager.example.com")
    expect(urls[0]).not.toContain("thanos.example.com")
  })

  it("throws on network error", async () => {
    globalThis.fetch = (() => {
      return Promise.reject(new Error("Network error"))
    }) as unknown as typeof fetch

    const client = createPromQLClient({ baseUrl: "https://thanos.example.com", tokenFn })

    try {
      await client.instantQuery("up")
      expect(true).toBe(false)
    } catch (error) {
      expect((error as Error).message).toContain("Network error")
    }
  })

  it("returns empty results for queries with no matches", async () => {
    globalThis.fetch = createMockFetch([
      {
        path: "/api/v1/query",
        body: { status: "success", data: { resultType: "vector", result: [] } },
      },
    ])

    const client = createPromQLClient({ baseUrl: "https://thanos.example.com", tokenFn })
    const result = await client.instantQuery("nonexistent_metric")

    expect(result.resultType).toBe("vector")
    expect(result.result).toHaveLength(0)
  })

  it("throws on invalid query (400 from Prometheus)", async () => {
    globalThis.fetch = createMockFetch([
      {
        path: "/api/v1/query",
        status: 400,
        body: { status: "error", errorType: "bad_data", error: "invalid expression" },
      },
    ])

    const client = createPromQLClient({ baseUrl: "https://thanos.example.com", tokenFn })

    try {
      await client.instantQuery("invalid{[}")
      expect(true).toBe(false)
    } catch (error) {
      expect((error as Error).message).toContain("400")
    }
  })
})

describe("parseDuration", () => {
  it("parses valid duration strings", () => {
    expect(parseDuration("30s")).toBe(30_000)
    expect(parseDuration("5m")).toBe(300_000)
    expect(parseDuration("1h")).toBe(3_600_000)
    expect(parseDuration("7d")).toBe(604_800_000)
    expect(parseDuration("1w")).toBe(604_800_000)
  })

  it("throws on invalid duration format", () => {
    expect(() => parseDuration("abc")).toThrow("Invalid duration format")
    expect(() => parseDuration("10x")).toThrow("Invalid duration format")
    expect(() => parseDuration("")).toThrow("Invalid duration format")
  })
})
