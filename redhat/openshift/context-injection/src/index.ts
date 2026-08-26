import type { Hooks, PluginModule } from "tinycode-plugin"
import { z } from "zod"
import { createConsoleApiClient } from "tinycode-plugin-redhat-shared/console-auth"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { queryClusterContext, type ClusterContext, type AlertSummary } from "./cluster-info"
import { queryCostContext, formatCostBlock, type CostContext } from "./cost-context"

const optionsSchema = z
  .object({
    consoleOfflineToken: z.string().optional(),
  })
  .optional()

function formatAlertLine(label: string, alerts: AlertSummary["critical"]): string {
  const details = alerts.map((a) => `${a.name}: ${a.namespace || "cluster"}`).join(", ")
  return `${label}: ${alerts.length} (${details})`
}

function formatContextBlock(ctx: ClusterContext): string {
  const lines = [
    `cluster: ${ctx.cluster}`,
    `version: ${ctx.version}`,
    `nodes: ${ctx.nodes}`,
    `namespace: ${ctx.namespace}`,
    `operators: [${ctx.operators.join(", ")}]`,
  ]

  if (ctx.alerts) {
    if (ctx.alerts.critical.length > 0) {
      lines.push(formatAlertLine("firing-alerts-critical", ctx.alerts.critical))
    }
    if (ctx.alerts.warning.length > 0) {
      lines.push(formatAlertLine("firing-alerts-warning", ctx.alerts.warning))
    }
    if (ctx.alerts.info > 0) {
      lines.push(`firing-alerts-info: ${ctx.alerts.info}`)
    }
  }

  return `<cluster-context>\n${lines.join("\n")}\n</cluster-context>`
}

export default {
  schema: optionsSchema,
  server: async (input, options): Promise<Hooks> => {
    const oc = createOcClient(input.$)
    const parsed = optionsSchema.safeParse(options)
    const opts = parsed.success ? parsed.data : undefined

    let cachedContext: ClusterContext | null = null
    let cachedCostContext: CostContext | null = null

    return {
      "session.start": async (_event, _output) => {
        cachedContext = await queryClusterContext(oc)

        if (opts?.consoleOfflineToken && cachedContext) {
          const apiClient = createConsoleApiClient(
            { offlineToken: opts.consoleOfflineToken },
            "/api/cost-management/v1",
          )
          cachedCostContext = await queryCostContext(
            apiClient,
            cachedContext.cluster,
            cachedContext.namespace,
          )
        }
      },

      "experimental.chat.system.transform": async (_event, output) => {
        if (cachedContext) {
          output.system.push(formatContextBlock(cachedContext))
        } else {
          output.system.push("<cluster-context>not connected</cluster-context>")
        }
        if (cachedCostContext) {
          output.system.push(formatCostBlock(cachedCostContext))
        }
      },

      dispose: async () => {
        cachedContext = null
        cachedCostContext = null
      },
    }
  },
} satisfies PluginModule
