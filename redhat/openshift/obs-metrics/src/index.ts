import type {
  Hooks,
  PluginModule,
  ToolContext,
  ToolDefinition,
} from "tinycode-plugin"
import { z } from "zod"
import {
  createPromQLClient,
  parseDuration,
} from "tinycode-plugin-redhat-shared/promql"
import type {
  PromQLClient,
  PromQLVector,
  PromQLMatrix,
  Alert,
} from "tinycode-plugin-redhat-shared/promql"

const optionsSchema = z
  .object({
    prometheusUrl: z.string().url().describe("Prometheus/Thanos URL"),
    alertManagerUrl: z
      .string()
      .url()
      .optional()
      .describe("AlertManager URL (defaults to Prometheus URL)"),
    token: z
      .string()
      .optional()
      .describe("Bearer token for Prometheus API"),
    namespace: z
      .string()
      .optional()
      .describe("Default namespace for queries"),
  })
  .optional()

const UNCONFIGURED_MESSAGE =
  "Observability plugin not configured. Set prometheusUrl in plugin options to your Prometheus/Thanos endpoint."

function formatVectorResult(vectors: PromQLVector[]): string {
  if (vectors.length === 0) {
    return "Query returned no results."
  }
  const lines = [`Results: ${vectors.length} vectors`, ""]
  for (const v of vectors) {
    const labels = Object.entries(v.metric)
      .map(([k, val]) => `${k}="${val}"`)
      .join(", ")
    lines.push(`{${labels}} => ${v.value[1]}`)
  }
  return lines.join("\n")
}

function formatMatrixResult(matrices: PromQLMatrix[]): string {
  if (matrices.length === 0) {
    return "Query returned no results."
  }
  const lines = [`Results: ${matrices.length} series`, ""]
  for (const m of matrices) {
    const labels = Object.entries(m.metric)
      .map(([k, val]) => `${k}="${val}"`)
      .join(", ")
    lines.push(`{${labels}}:`)
    for (const [ts, val] of m.values) {
      lines.push(`  ${new Date(ts * 1000).toISOString()} => ${val}`)
    }
    lines.push("")
  }
  return lines.join("\n").trimEnd()
}

export function createObsTools(
  client: PromQLClient,
): Record<string, ToolDefinition> {
  return {
    obs_promql: {
      description:
        "Run an arbitrary PromQL query against Prometheus/Thanos. Supports both instant and range queries.",
      args: {
        query: z.string().describe("PromQL query expression"),
        time: z
          .string()
          .optional()
          .describe("Evaluation timestamp for instant query (RFC3339 or Unix)"),
        start: z
          .string()
          .optional()
          .describe("Range query start time (RFC3339 or Unix)"),
        end: z
          .string()
          .optional()
          .describe("Range query end time (RFC3339 or Unix)"),
        step: z
          .string()
          .optional()
          .describe("Range query step (e.g. '15s', '1m')"),
      },
      async execute(args: {
        query: string
        time?: string
        start?: string
        end?: string
        step?: string
      }) {
        try {
          if (args.start && args.end && args.step) {
            const result = await client.rangeQuery(
              args.query,
              args.start,
              args.end,
              args.step,
            )
            return formatMatrixResult(result.result as PromQLMatrix[])
          }
          const result = await client.instantQuery(args.query, args.time)
          return formatVectorResult(result.result as PromQLVector[])
        } catch (error) {
          return `PromQL query failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    obs_alerts: {
      description:
        "List active firing alerts from AlertManager. Filter by severity or namespace.",
      args: {
        severity: z
          .enum(["critical", "warning", "info"])
          .optional()
          .describe("Filter alerts by severity level"),
        namespace: z
          .string()
          .optional()
          .describe("Filter alerts by namespace"),
      },
      async execute(args: { severity?: string; namespace?: string }) {
        try {
          const alerts = await client.alerts(true, false)
          let filtered = alerts
          if (args.severity) {
            filtered = filtered.filter(
              (a) => a.labels.severity === args.severity,
            )
          }
          if (args.namespace) {
            filtered = filtered.filter(
              (a) => a.labels.namespace === args.namespace,
            )
          }
          if (filtered.length === 0) {
            return "No active alerts matching filters."
          }
          const lines = [`Active Alerts: ${filtered.length}`, ""]
          for (const a of filtered) {
            const severity = (a.labels.severity ?? "unknown").toUpperCase()
            const name = a.labels.alertname ?? "unknown"
            const ns = a.labels.namespace ?? "cluster"
            const desc = a.annotations.description ?? "No description"
            lines.push(
              `[${severity}] ${name} | ${ns} | since ${a.activeAt} | ${desc}`,
            )
          }
          return lines.join("\n")
        } catch (error) {
          return `Failed to query alerts: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    obs_alert_silence: {
      description:
        "Silence a firing alert in AlertManager for a specified duration.",
      args: {
        alertName: z
          .string()
          .describe("Name of the alert to silence"),
        duration: z
          .string()
          .describe("Silence duration (e.g. '1h', '30m', '2h')"),
        comment: z
          .string()
          .describe("Reason for silencing the alert"),
      },
      async execute(
        args: { alertName: string; duration: string; comment: string },
        ctx: ToolContext,
      ) {
        try {
          parseDuration(args.duration)
        } catch (error) {
          return `Invalid duration: ${error instanceof Error ? error.message : String(error)}`
        }
        try {
          await ctx.ask({
            permission: `Silence alert '${args.alertName}' for ${args.duration}? Comment: ${args.comment}`,
            patterns: ["obs_alert_silence"],
            always: [],
            metadata: {
              alertName: args.alertName,
              duration: args.duration,
              comment: args.comment,
            },
          })
        } catch {
          return "Alert silencing cancelled by user."
        }
        try {
          const matchers = [
            {
              name: "alertname",
              value: args.alertName,
              isRegex: false,
              isEqual: true,
            },
          ]
          const silenceId = await client.silenceAlert(
            matchers,
            args.duration,
            "tinycode",
            args.comment,
          )
          return `Alert '${args.alertName}' silenced for ${args.duration}. Silence ID: ${silenceId}`
        } catch (error) {
          return `Failed to silence alert: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredObsTools(): Record<string, ToolDefinition> {
  return {
    obs_promql: {
      description:
        "Run an arbitrary PromQL query against Prometheus/Thanos.",
      args: {
        query: z.string().describe("PromQL query expression"),
      },
      async execute() {
        return UNCONFIGURED_MESSAGE
      },
    },
    obs_alerts: {
      description: "List active firing alerts from AlertManager.",
      args: {
        severity: z
          .enum(["critical", "warning", "info"])
          .optional()
          .describe("Filter alerts by severity level"),
      },
      async execute() {
        return UNCONFIGURED_MESSAGE
      },
    },
    obs_alert_silence: {
      description:
        "Silence a firing alert in AlertManager for a specified duration.",
      args: {
        alertName: z.string().describe("Name of the alert to silence"),
        duration: z.string().describe("Silence duration"),
        comment: z.string().describe("Reason for silencing the alert"),
      },
      async execute() {
        return UNCONFIGURED_MESSAGE
      },
    },
  }
}

function formatAlertSummary(alerts: Alert[]): string {
  const bySeverity: Record<string, string[]> = {}
  for (const a of alerts) {
    const severity = a.labels.severity ?? "unknown"
    if (!bySeverity[severity]) {
      bySeverity[severity] = []
    }
    bySeverity[severity]!.push(a.labels.alertname ?? "unknown")
  }

  const parts: string[] = []
  for (const severity of ["critical", "warning", "info"]) {
    const names = bySeverity[severity]
    if (names && names.length > 0) {
      parts.push(`${names.length} ${severity} (${names.join(", ")})`)
    }
  }

  return parts.length > 0 ? parts.join(", ") : "none"
}

export default {
  schema: optionsSchema,
  server: async (input, options): Promise<Hooks> => {
    const parsed = optionsSchema.safeParse(options)
    const opts = parsed.success ? parsed.data : undefined

    if (!opts?.prometheusUrl) {
      return {
        tool: createUnconfiguredObsTools(),
      }
    }

    const tokenFn = opts.token
      ? async () => opts.token!
      : async () => ""

    const client = createPromQLClient({
      baseUrl: opts.prometheusUrl,
      tokenFn,
      alertManagerUrl: opts.alertManagerUrl,
    })

    let cachedAlertSummary: string | null = null

    return {
      "session.start": async () => {
        try {
          const alerts = await client.alerts(true, false)
          if (alerts.length > 0) {
            cachedAlertSummary = formatAlertSummary(alerts)
          }
        } catch {
          // Prometheus unreachable — skip alert injection
        }
      },

      "experimental.chat.system.transform": async (
        _event: unknown,
        output: { system: string[] },
      ) => {
        if (cachedAlertSummary) {
          output.system.push(
            `<observability-context>firing-alerts: ${cachedAlertSummary}</observability-context>`,
          )
        }
      },

      tool: createObsTools(client),
    }
  },
} satisfies PluginModule
