import { describe, it, expect } from "bun:test"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import type { PromQLClient } from "tinycode-plugin-redhat-shared/promql"
import plugin from "../src/index"
import { createObsTools, createUnconfiguredObsTools } from "../src/index"

function createMockPromQLClient(
  overrides?: Partial<PromQLClient>,
): PromQLClient {
  return {
    instantQuery: async () => ({
      resultType: "vector" as const,
      result: [],
    }),
    rangeQuery: async () => ({
      resultType: "matrix" as const,
      result: [],
    }),
    alerts: async () => [],
    silenceAlert: async () => "silence-id-123",
    ...overrides,
  }
}

async function getPluginTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

const configuredOptions = {
  prometheusUrl: "http://prometheus:9090",
}

describe("tinycode-plugin-obs-metrics", () => {
  describe("plugin loading", () => {
    it("loads without error", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      expect(hooks).toBeDefined()
    })

    it("returns unconfigured message when prometheusUrl not set", async () => {
      const tools = await getPluginTools(undefined)
      const promqlResult = await tools.obs_promql.execute(
        { query: "up" },
        {} as never,
      )
      expect(promqlResult).toContain("not configured")
      expect(promqlResult).toContain("prometheusUrl")

      const alertsResult = await tools.obs_alerts.execute({}, {} as never)
      expect(alertsResult).toContain("not configured")

      const silenceResult = await tools.obs_alert_silence.execute(
        { alertName: "test", duration: "1h", comment: "test" },
        {} as never,
      )
      expect(silenceResult).toContain("not configured")
    })

    it("registers all three tools", async () => {
      const tools = await getPluginTools(configuredOptions)
      expect(tools.obs_promql).toBeDefined()
      expect(tools.obs_alerts).toBeDefined()
      expect(tools.obs_alert_silence).toBeDefined()
    })

    it("all tools have descriptions", async () => {
      const tools = await getPluginTools(configuredOptions)
      expect(tools.obs_promql.description).toBeTruthy()
      expect(tools.obs_alerts.description).toBeTruthy()
      expect(tools.obs_alert_silence.description).toBeTruthy()
    })
  })

  describe("obs_promql", () => {
    it("runs instant query and formats vector results", async () => {
      const client = createMockPromQLClient({
        instantQuery: async () => ({
          resultType: "vector" as const,
          result: [
            {
              metric: { __name__: "up", instance: "localhost:9090" },
              value: [1700000000, "1"] as [number, string],
            },
            {
              metric: { __name__: "up", instance: "localhost:9091" },
              value: [1700000000, "0"] as [number, string],
            },
          ],
        }),
      })
      const tools = createObsTools(client)
      const result = (await tools.obs_promql.execute(
        { query: "up" },
        {} as never,
      )) as string
      expect(result).toContain("Results: 2 vectors")
      expect(result).toContain('__name__="up"')
      expect(result).toContain('instance="localhost:9090"')
      expect(result).toContain("=> 1")
      expect(result).toContain("=> 0")
    })

    it("runs range query when start/end/step provided", async () => {
      const client = createMockPromQLClient({
        rangeQuery: async () => ({
          resultType: "matrix" as const,
          result: [
            {
              metric: { __name__: "cpu_usage" },
              values: [
                [1700000000, "0.5"] as [number, string],
                [1700000060, "0.7"] as [number, string],
              ],
            },
          ],
        }),
      })
      const tools = createObsTools(client)
      const result = (await tools.obs_promql.execute(
        {
          query: "cpu_usage",
          start: "2023-11-14T00:00:00Z",
          end: "2023-11-14T01:00:00Z",
          step: "1m",
        },
        {} as never,
      )) as string
      expect(result).toContain("Results: 1 series")
      expect(result).toContain('__name__="cpu_usage"')
      expect(result).toContain("=> 0.5")
      expect(result).toContain("=> 0.7")
    })

    it("returns empty result message for no data", async () => {
      const client = createMockPromQLClient()
      const tools = createObsTools(client)
      const result = (await tools.obs_promql.execute(
        { query: "nonexistent_metric" },
        {} as never,
      )) as string
      expect(result).toContain("Query returned no results")
    })

    it("returns error on query failure", async () => {
      const client = createMockPromQLClient({
        instantQuery: async () => {
          throw new Error("connection refused")
        },
      })
      const tools = createObsTools(client)
      const result = (await tools.obs_promql.execute(
        { query: "up" },
        {} as never,
      )) as string
      expect(result).toContain("PromQL query failed")
      expect(result).toContain("connection refused")
    })
  })

  describe("obs_alerts", () => {
    const mockAlerts = [
      {
        labels: {
          alertname: "KubePodCrashLooping",
          severity: "critical",
          namespace: "payments",
        },
        annotations: { description: "Pod is crash looping" },
        state: "firing" as const,
        activeAt: "2024-01-15T10:00:00Z",
        value: "1",
        fingerprint: "abc123",
      },
      {
        labels: {
          alertname: "HighMemoryUsage",
          severity: "warning",
          namespace: "monitoring",
        },
        annotations: { description: "Memory above 90%" },
        state: "firing" as const,
        activeAt: "2024-01-15T11:00:00Z",
        value: "0.95",
        fingerprint: "def456",
      },
    ]

    it("lists all active alerts formatted", async () => {
      const client = createMockPromQLClient({
        alerts: async () => mockAlerts,
      })
      const tools = createObsTools(client)
      const result = (await tools.obs_alerts.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("Active Alerts: 2")
      expect(result).toContain("[CRITICAL] KubePodCrashLooping")
      expect(result).toContain("payments")
      expect(result).toContain("Pod is crash looping")
      expect(result).toContain("[WARNING] HighMemoryUsage")
      expect(result).toContain("monitoring")
    })

    it("filters by severity", async () => {
      const client = createMockPromQLClient({
        alerts: async () => mockAlerts,
      })
      const tools = createObsTools(client)
      const result = (await tools.obs_alerts.execute(
        { severity: "critical" },
        {} as never,
      )) as string
      expect(result).toContain("Active Alerts: 1")
      expect(result).toContain("[CRITICAL] KubePodCrashLooping")
      expect(result).not.toContain("HighMemoryUsage")
    })

    it("filters by namespace", async () => {
      const client = createMockPromQLClient({
        alerts: async () => mockAlerts,
      })
      const tools = createObsTools(client)
      const result = (await tools.obs_alerts.execute(
        { namespace: "monitoring" },
        {} as never,
      )) as string
      expect(result).toContain("Active Alerts: 1")
      expect(result).toContain("HighMemoryUsage")
      expect(result).not.toContain("KubePodCrashLooping")
    })

    it("returns no alerts message when empty", async () => {
      const client = createMockPromQLClient()
      const tools = createObsTools(client)
      const result = (await tools.obs_alerts.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("No active alerts matching filters")
    })

    it("returns error on alert query failure", async () => {
      const client = createMockPromQLClient({
        alerts: async () => {
          throw new Error("AlertManager unavailable")
        },
      })
      const tools = createObsTools(client)
      const result = (await tools.obs_alerts.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("Failed to query alerts")
      expect(result).toContain("AlertManager unavailable")
    })
  })

  describe("obs_alert_silence", () => {
    it("silences alert after permission", async () => {
      const client = createMockPromQLClient({
        silenceAlert: async () => "silence-abc-123",
      })
      const tools = createObsTools(client)
      const ctx = { ask: async () => {} }
      const result = (await tools.obs_alert_silence.execute(
        { alertName: "KubePodCrashLooping", duration: "1h", comment: "investigating" },
        ctx as never,
      )) as string
      expect(result).toContain("Alert 'KubePodCrashLooping' silenced for 1h")
      expect(result).toContain("Silence ID: silence-abc-123")
    })

    it("returns error when permission denied", async () => {
      const client = createMockPromQLClient()
      const tools = createObsTools(client)
      const ctx = {
        ask: async () => {
          throw new Error("User denied")
        },
      }
      const result = (await tools.obs_alert_silence.execute(
        { alertName: "TestAlert", duration: "30m", comment: "test" },
        ctx as never,
      )) as string
      expect(result).toContain("Alert silencing cancelled by user")
    })

    it("validates duration format", async () => {
      const client = createMockPromQLClient()
      const tools = createObsTools(client)
      const ctx = { ask: async () => {} }
      const result = (await tools.obs_alert_silence.execute(
        { alertName: "TestAlert", duration: "invalid", comment: "test" },
        ctx as never,
      )) as string
      expect(result).toContain("Invalid duration")
    })

    it("returns error when silence fails", async () => {
      const client = createMockPromQLClient({
        silenceAlert: async () => {
          throw new Error("AlertManager returned 503")
        },
      })
      const tools = createObsTools(client)
      const ctx = { ask: async () => {} }
      const result = (await tools.obs_alert_silence.execute(
        { alertName: "TestAlert", duration: "1h", comment: "test" },
        ctx as never,
      )) as string
      expect(result).toContain("Failed to silence alert")
      expect(result).toContain("AlertManager returned 503")
    })
  })

  describe("system prompt hook", () => {
    it("injects alert summary into system prompt", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, configuredOptions)

      // Mock the PromQL client's alerts call via fetch
      // Since the plugin creates its own client, we need to mock globalThis.fetch
      const originalFetch = globalThis.fetch
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                labels: {
                  alertname: "HighCPU",
                  severity: "critical",
                  namespace: "prod",
                },
                annotations: {},
                state: "firing",
                activeAt: "2024-01-15T10:00:00Z",
                value: "1",
                fingerprint: "aaa",
              },
              {
                labels: {
                  alertname: "DiskFull",
                  severity: "warning",
                  namespace: "infra",
                },
                annotations: {},
                state: "firing",
                activeAt: "2024-01-15T11:00:00Z",
                value: "1",
                fingerprint: "bbb",
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )) as typeof fetch

      try {
        await hooks["session.start"]!({}, {})

        const output = { system: [] as string[] }
        await hooks["experimental.chat.system.transform"]!(
          { model: {} as never },
          output,
        )

        expect(output.system.length).toBe(1)
        expect(output.system[0]).toContain("<observability-context>")
        expect(output.system[0]).toContain("1 critical (HighCPU)")
        expect(output.system[0]).toContain("1 warning (DiskFull)")
        expect(output.system[0]).toContain("</observability-context>")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it("handles Prometheus unreachable gracefully", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, configuredOptions)

      const originalFetch = globalThis.fetch
      globalThis.fetch = (() =>
        Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch

      try {
        await hooks["session.start"]!({}, {})

        const output = { system: [] as string[] }
        await hooks["experimental.chat.system.transform"]!(
          { model: {} as never },
          output,
        )

        expect(output.system.length).toBe(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})
