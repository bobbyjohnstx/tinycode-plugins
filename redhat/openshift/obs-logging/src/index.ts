import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createLokiClient } from "./loki-client"
import type { LokiClient, LogEntry } from "./loki-client"
import { createTempoClient } from "./tempo-client"
import type { TempoClient, Span } from "./tempo-client"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import type { OcClient } from "tinycode-plugin-redhat-shared/oc"

const optionsSchema = z
  .object({
    lokiUrl: z.string().url().optional().describe("Loki API URL"),
    tempoUrl: z.string().url().optional().describe("Tempo API URL"),
    token: z.string().optional().describe("Bearer token"),
  })
  .optional()

const LOKI_UNCONFIGURED =
  "Logging not configured. Set lokiUrl in plugin options to your Loki endpoint."
const TEMPO_UNCONFIGURED =
  "Tracing not configured. Set tempoUrl in plugin options to your Tempo endpoint."

function formatLogEntries(entries: LogEntry[]): string {
  if (entries.length === 0) {
    return "No log entries found."
  }
  const lines = [`Log entries: ${entries.length}`, ""]
  for (const entry of entries) {
    const labels = Object.entries(entry.labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(", ")
    lines.push(`[${entry.timestamp}] {${labels}} ${entry.line}`)
  }
  return lines.join("\n")
}

function buildLogQL(args: {
  namespace?: string
  pod?: string
  severity?: string
}): string {
  const selectors: string[] = []
  if (args.namespace) selectors.push(`namespace="${args.namespace}"`)
  if (args.pod) selectors.push(`pod="${args.pod}"`)

  const stream =
    selectors.length > 0 ? `{${selectors.join(", ")}}` : '{job=~".+"}'

  if (args.severity) {
    return `${stream} |= "${args.severity}"`
  }
  return stream
}

function formatSpanTree(spans: Span[], indent: number = 0): string {
  const lines: string[] = []
  for (const span of spans) {
    const prefix = "  ".repeat(indent)
    lines.push(
      `${prefix}[${span.duration}ms] ${span.serviceName}:${span.operationName}`,
    )
    if (span.children.length > 0) {
      lines.push(formatSpanTree(span.children, indent + 1))
    }
  }
  return lines.join("\n")
}

export function createLogTools(
  client: LokiClient,
): Record<string, ToolDefinition> {
  return {
    obs_logs: {
      description:
        "Run a LogQL query against Loki to search logs. Optionally build a query from namespace, pod, and severity filters.",
      args: {
        query: z
          .string()
          .optional()
          .describe("LogQL query expression (overrides filters)"),
        namespace: z.string().optional().describe("Filter by namespace"),
        pod: z.string().optional().describe("Filter by pod name"),
        severity: z
          .string()
          .optional()
          .describe("Filter by severity (e.g. error, warning)"),
        since: z
          .string()
          .optional()
          .describe("Start time (RFC3339 or relative like '1h')"),
        limit: z.number().optional().describe("Max entries to return"),
      },
      async execute(args: {
        query?: string
        namespace?: string
        pod?: string
        severity?: string
        since?: string
        limit?: number
      }) {
        try {
          const logql = args.query ?? buildLogQL(args)
          const entries = await client.query(
            logql,
            args.limit,
            args.since,
            undefined,
          )
          return formatLogEntries(entries)
        } catch (error) {
          return `Log query failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createTraceTools(
  client: TempoClient,
): Record<string, ToolDefinition> {
  return {
    obs_traces: {
      description:
        "Search distributed traces by service name, operation, and minimum duration.",
      args: {
        service: z.string().describe("Service name to search traces for"),
        operation: z
          .string()
          .optional()
          .describe("Filter by operation name"),
        minDuration: z
          .string()
          .optional()
          .describe("Minimum trace duration (e.g. '500ms', '1s')"),
        limit: z.number().optional().describe("Max traces to return"),
      },
      async execute(args: {
        service: string
        operation?: string
        minDuration?: string
        limit?: number
      }) {
        try {
          const traces = await client.searchTraces(
            args.service,
            args.operation,
            args.minDuration,
            args.limit,
          )
          if (traces.length === 0) {
            return "No traces found matching criteria."
          }
          const lines = [`Traces: ${traces.length}`, ""]
          for (const t of traces) {
            lines.push(
              `${t.traceID} | ${t.rootServiceName}:${t.rootTraceName} | ${t.durationMs}ms | ${t.spanCount} spans`,
            )
          }
          return lines.join("\n")
        } catch (error) {
          return `Trace search failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    obs_trace_detail: {
      description:
        "Get the full span tree for a specific trace ID, showing service calls and timing.",
      args: {
        traceId: z.string().describe("Trace ID to retrieve"),
      },
      async execute(args: { traceId: string }) {
        try {
          const detail = await client.getTrace(args.traceId)
          if (detail.spans.length === 0) {
            return "Trace has no spans."
          }
          const lines = [
            `Trace: ${detail.traceID} (${detail.spans.length} spans)`,
            "",
            formatSpanTree(detail.spans),
          ]
          return lines.join("\n")
        } catch (error) {
          return `Failed to get trace: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createOcTools(
  oc: OcClient,
): Record<string, ToolDefinition> {
  return {
    obs_network_flows: {
      description:
        "Query network flows from the Network Observability operator (NetObserv FlowCollector).",
      args: {
        namespace: z
          .string()
          .optional()
          .describe("Filter flows by namespace"),
        srcPod: z.string().optional().describe("Filter by source pod"),
        destPod: z.string().optional().describe("Filter by destination pod"),
        since: z
          .string()
          .optional()
          .describe("Time range (e.g. '1h', '30m')"),
      },
      async execute(args: {
        namespace?: string
        srcPod?: string
        destPod?: string
        since?: string
      }) {
        try {
          const result = await oc.get<{
            items: Array<{
              metadata: { name: string; namespace: string }
              spec: {
                agent?: { type?: string }
                processor?: { logTypes?: string }
              }
              status?: { conditions?: Array<{ type: string; status: string }> }
            }>
          }>("flowcollectors.flows.netobserv.io")

          if (result.items.length === 0) {
            return "No FlowCollector resources found. Network Observability may not be installed."
          }

          const lines = ["Network Flow Collectors:", ""]
          for (const fc of result.items) {
            const name = fc.metadata.name
            const agentType = fc.spec.agent?.type ?? "unknown"
            const logTypes = fc.spec.processor?.logTypes ?? "unknown"
            const conditions = fc.status?.conditions ?? []
            const ready = conditions.find((c) => c.type === "Ready")
            const status = ready ? ready.status : "Unknown"
            lines.push(
              `${name} | agent: ${agentType} | logTypes: ${logTypes} | ready: ${status}`,
            )
          }

          if (args.namespace || args.srcPod || args.destPod) {
            lines.push("")
            lines.push(
              `Filter: namespace=${args.namespace ?? "*"}, src=${args.srcPod ?? "*"}, dest=${args.destPod ?? "*"}`,
            )
          }

          return lines.join("\n")
        } catch (error) {
          return `Failed to query network flows: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    obs_dashboards: {
      description:
        "List available observability dashboards from OpenShift ConfigMaps.",
      args: {},
      async execute() {
        try {
          const result = await oc.get<{
            items: Array<{
              metadata: { name: string; namespace: string }
            }>
          }>("configmaps", {
            namespace: "openshift-config-managed",
            selector: "grafana_dashboard=1",
          })

          if (result.items.length === 0) {
            return "No dashboards found."
          }

          const lines = [
            `Dashboards: ${result.items.length}`,
            "",
          ]
          for (const cm of result.items) {
            lines.push(`${cm.metadata.name} | ${cm.metadata.namespace}`)
          }
          return lines.join("\n")
        } catch (error) {
          return `Failed to list dashboards: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredLogTools(): Record<string, ToolDefinition> {
  return {
    obs_logs: {
      description:
        "Run a LogQL query against Loki to search logs.",
      args: {
        query: z
          .string()
          .optional()
          .describe("LogQL query expression"),
      },
      async execute() {
        return LOKI_UNCONFIGURED
      },
    },
  }
}

export function createUnconfiguredTraceTools(): Record<
  string,
  ToolDefinition
> {
  return {
    obs_traces: {
      description: "Search distributed traces by service name.",
      args: {
        service: z.string().describe("Service name"),
      },
      async execute() {
        return TEMPO_UNCONFIGURED
      },
    },
    obs_trace_detail: {
      description: "Get the full span tree for a trace.",
      args: {
        traceId: z.string().describe("Trace ID"),
      },
      async execute() {
        return TEMPO_UNCONFIGURED
      },
    },
  }
}

export default {
  schema: optionsSchema,
  server: async (input, options): Promise<Hooks> => {
    const parsed = optionsSchema.safeParse(options)
    const opts = parsed.success ? parsed.data : undefined
    const oc = createOcClient(input.$)

    const tokenFn = opts?.token ? async () => opts.token! : undefined

    const logTools = opts?.lokiUrl
      ? createLogTools(
          createLokiClient({ baseUrl: opts.lokiUrl, tokenFn }),
        )
      : createUnconfiguredLogTools()

    const traceTools = opts?.tempoUrl
      ? createTraceTools(
          createTempoClient({ baseUrl: opts.tempoUrl, tokenFn }),
        )
      : createUnconfiguredTraceTools()

    const ocTools = createOcTools(oc)

    return {
      tool: {
        ...logTools,
        ...traceTools,
        ...ocTools,
      },
    }
  },
} satisfies PluginModule
