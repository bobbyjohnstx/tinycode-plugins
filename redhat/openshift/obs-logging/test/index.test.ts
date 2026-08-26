import { describe, it, expect } from "bun:test"
import {
  createMockShell,
  createMockInput,
} from "tinycode-plugin-redhat-shared/test-utils"
import type { LokiClient, LogEntry } from "../src/loki-client"
import type { TempoClient, TraceSummary, TraceDetail } from "../src/tempo-client"
import plugin, {
  createLogTools,
  createTraceTools,
  createOcTools,
} from "../src/index"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"

function createMockLokiClient(
  overrides?: Partial<LokiClient>,
): LokiClient {
  return {
    query: async () => [],
    labels: async () => [],
    ...overrides,
  }
}

function createMockTempoClient(
  overrides?: Partial<TempoClient>,
): TempoClient {
  return {
    searchTraces: async () => [],
    getTrace: async () => ({ traceID: "abc", spans: [] }),
    ...overrides,
  }
}

async function getPluginTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

describe("tinycode-plugin-obs-logging", () => {
  describe("plugin loading", () => {
    it("loads without error", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      expect(hooks).toBeDefined()
    })

    it("registers all five tools", async () => {
      const tools = await getPluginTools({
        lokiUrl: "http://loki:3100",
        tempoUrl: "http://tempo:3200",
      })
      expect(tools.obs_logs).toBeDefined()
      expect(tools.obs_traces).toBeDefined()
      expect(tools.obs_trace_detail).toBeDefined()
      expect(tools.obs_flow_collectors).toBeDefined()
      expect(tools.obs_dashboards).toBeDefined()
    })

    it("all tools have descriptions", async () => {
      const tools = await getPluginTools({
        lokiUrl: "http://loki:3100",
        tempoUrl: "http://tempo:3200",
      })
      expect(tools.obs_logs.description).toBeTruthy()
      expect(tools.obs_traces.description).toBeTruthy()
      expect(tools.obs_trace_detail.description).toBeTruthy()
      expect(tools.obs_flow_collectors.description).toBeTruthy()
      expect(tools.obs_dashboards.description).toBeTruthy()
    })
  })

  describe("obs_logs", () => {
    it("returns unconfigured when lokiUrl not set", async () => {
      const tools = await getPluginTools(undefined)
      const result = await tools.obs_logs.execute(
        { query: '{namespace="test"}' },
        {} as never,
      )
      expect(result).toContain("not configured")
      expect(result).toContain("lokiUrl")
    })

    it("queries Loki with LogQL", async () => {
      const mockEntries: LogEntry[] = [
        {
          timestamp: "1700000000000000000",
          line: "error: connection refused",
          labels: { namespace: "payments", pod: "api-1" },
        },
        {
          timestamp: "1700000001000000000",
          line: "warn: retry attempt 2",
          labels: { namespace: "payments", pod: "api-1" },
        },
      ]
      const client = createMockLokiClient({
        query: async () => mockEntries,
      })
      const tools = createLogTools(client)
      const result = (await tools.obs_logs.execute(
        { query: '{namespace="payments"}' },
        {} as never,
      )) as string
      expect(result).toContain("Log entries: 2")
      expect(result).toContain("error: connection refused")
      expect(result).toContain("warn: retry attempt 2")
      expect(result).toContain('namespace="payments"')
    })

    it("builds LogQL from filters", async () => {
      let capturedQuery = ""
      const client = createMockLokiClient({
        query: async (logql) => {
          capturedQuery = logql
          return []
        },
      })
      const tools = createLogTools(client)
      await tools.obs_logs.execute(
        { namespace: "payments", severity: "error" },
        {} as never,
      )
      expect(capturedQuery).toContain('namespace="payments"')
      expect(capturedQuery).toContain('|= "error"')
    })

    it("returns empty when no logs", async () => {
      const client = createMockLokiClient()
      const tools = createLogTools(client)
      const result = (await tools.obs_logs.execute(
        { query: '{namespace="empty"}' },
        {} as never,
      )) as string
      expect(result).toContain("No log entries found")
    })

    it("returns error on failure", async () => {
      const client = createMockLokiClient({
        query: async () => {
          throw new Error("Loki unavailable")
        },
      })
      const tools = createLogTools(client)
      const result = (await tools.obs_logs.execute(
        { query: "bad query" },
        {} as never,
      )) as string
      expect(result).toContain("Log query failed")
      expect(result).toContain("Loki unavailable")
    })
  })

  describe("obs_traces", () => {
    it("returns unconfigured when tempoUrl not set", async () => {
      const tools = await getPluginTools(undefined)
      const result = await tools.obs_traces.execute(
        { service: "frontend" },
        {} as never,
      )
      expect(result).toContain("not configured")
      expect(result).toContain("tempoUrl")
    })

    it("searches traces", async () => {
      const mockTraces: TraceSummary[] = [
        {
          traceID: "abc123",
          rootServiceName: "frontend",
          rootTraceName: "GET /api/users",
          durationMs: 250,
          startTimeUnixNano: "1700000000000000000",
          spanCount: 5,
        },
        {
          traceID: "def456",
          rootServiceName: "frontend",
          rootTraceName: "POST /api/orders",
          durationMs: 800,
          startTimeUnixNano: "1700000001000000000",
          spanCount: 12,
        },
      ]
      const client = createMockTempoClient({
        searchTraces: async () => mockTraces,
      })
      const tools = createTraceTools(client)
      const result = (await tools.obs_traces.execute(
        { service: "frontend" },
        {} as never,
      )) as string
      expect(result).toContain("Traces: 2")
      expect(result).toContain("abc123")
      expect(result).toContain("frontend:GET /api/users")
      expect(result).toContain("250ms")
      expect(result).toContain("5 spans")
    })

    it("returns empty when no traces", async () => {
      const client = createMockTempoClient()
      const tools = createTraceTools(client)
      const result = (await tools.obs_traces.execute(
        { service: "nonexistent" },
        {} as never,
      )) as string
      expect(result).toContain("No traces found")
    })

    it("returns error on failure", async () => {
      const client = createMockTempoClient({
        searchTraces: async () => {
          throw new Error("Tempo connection refused")
        },
      })
      const tools = createTraceTools(client)
      const result = (await tools.obs_traces.execute(
        { service: "frontend" },
        {} as never,
      )) as string
      expect(result).toContain("Trace search failed")
      expect(result).toContain("Tempo connection refused")
    })
  })

  describe("obs_trace_detail", () => {
    it("returns span tree", async () => {
      const mockDetail: TraceDetail = {
        traceID: "abc123",
        spans: [
          {
            traceID: "abc123",
            spanID: "span-1",
            operationName: "GET /api/users",
            serviceName: "frontend",
            duration: 250,
            startTime: 1700000000,
            tags: {},
            children: [
              {
                traceID: "abc123",
                spanID: "span-2",
                operationName: "SELECT users",
                serviceName: "database",
                duration: 50,
                startTime: 1700000100,
                tags: {},
                children: [],
              },
            ],
          },
        ],
      }
      const client = createMockTempoClient({
        getTrace: async () => mockDetail,
      })
      const tools = createTraceTools(client)
      const result = (await tools.obs_trace_detail.execute(
        { traceId: "abc123" },
        {} as never,
      )) as string
      expect(result).toContain("Trace: abc123")
      expect(result).toContain("1 spans")
      expect(result).toContain("[250ms] frontend:GET /api/users")
      expect(result).toContain("[50ms] database:SELECT users")
    })

    it("returns error on failure", async () => {
      const client = createMockTempoClient({
        getTrace: async () => {
          throw new Error("Trace not found")
        },
      })
      const tools = createTraceTools(client)
      const result = (await tools.obs_trace_detail.execute(
        { traceId: "nonexistent" },
        {} as never,
      )) as string
      expect(result).toContain("Failed to get trace")
      expect(result).toContain("Trace not found")
    })
  })

  describe("obs_flow_collectors", () => {
    it("lists flow collectors", async () => {
      const shell = createMockShell([
        {
          match: "flowcollectors.flows.netobserv.io",
          json: {
            items: [
              {
                metadata: { name: "cluster", namespace: "netobserv" },
                spec: {
                  agent: { type: "eBPF" },
                  processor: { logTypes: "FLOWS" },
                },
                status: {
                  conditions: [{ type: "Ready", status: "True" }],
                },
              },
            ],
          },
          output: JSON.stringify({
            items: [
              {
                metadata: { name: "cluster", namespace: "netobserv" },
                spec: {
                  agent: { type: "eBPF" },
                  processor: { logTypes: "FLOWS" },
                },
                status: {
                  conditions: [{ type: "Ready", status: "True" }],
                },
              },
            ],
          }),
        },
      ])
      const oc = createOcClient(shell)
      const tools = createOcTools(oc)
      const result = (await tools.obs_flow_collectors.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("Flow Collectors")
      expect(result).toContain("cluster")
      expect(result).toContain("eBPF")
      expect(result).toContain("FLOWS")
      expect(result).toContain("ready: True")
    })

    it("returns error on oc failure", async () => {
      const shell = createMockShell([
        {
          match: "flowcollectors",
          exitCode: 1,
          output: "",
        },
      ])
      const oc = createOcClient(shell)
      const tools = createOcTools(oc)
      const result = (await tools.obs_flow_collectors.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("Failed to list flow collectors")
    })
  })

  describe("obs_dashboards", () => {
    it("lists dashboards", async () => {
      const shell = createMockShell([
        {
          match: "configmaps",
          json: {
            items: [
              {
                metadata: {
                  name: "grafana-dashboard-k8s-resources",
                  namespace: "openshift-config-managed",
                },
              },
              {
                metadata: {
                  name: "grafana-dashboard-node-cluster",
                  namespace: "openshift-config-managed",
                },
              },
            ],
          },
          output: JSON.stringify({
            items: [
              {
                metadata: {
                  name: "grafana-dashboard-k8s-resources",
                  namespace: "openshift-config-managed",
                },
              },
              {
                metadata: {
                  name: "grafana-dashboard-node-cluster",
                  namespace: "openshift-config-managed",
                },
              },
            ],
          }),
        },
      ])
      const oc = createOcClient(shell)
      const tools = createOcTools(oc)
      const result = (await tools.obs_dashboards.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("Dashboards: 2")
      expect(result).toContain("grafana-dashboard-k8s-resources")
      expect(result).toContain("grafana-dashboard-node-cluster")
    })

    it("returns empty when no dashboards", async () => {
      const shell = createMockShell([
        {
          match: "configmaps",
          json: { items: [] },
          output: JSON.stringify({ items: [] }),
        },
      ])
      const oc = createOcClient(shell)
      const tools = createOcTools(oc)
      const result = (await tools.obs_dashboards.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("No dashboards found")
    })
  })
})
