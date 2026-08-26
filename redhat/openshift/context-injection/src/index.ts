import type { Hooks, PluginModule } from "tinycode-plugin"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { queryClusterContext, type ClusterContext, type AlertSummary } from "./cluster-info"

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
  server: async (input, _options): Promise<Hooks> => {
    const oc = createOcClient(input.$)
    let cachedContext: ClusterContext | null = null

    return {
      "session.start": async (_event, _output) => {
        cachedContext = await queryClusterContext(oc)
      },

      "experimental.chat.system.transform": async (_event, output) => {
        if (cachedContext) {
          output.system.push(formatContextBlock(cachedContext))
        } else {
          output.system.push("<cluster-context>not connected</cluster-context>")
        }
      },

      dispose: async () => {
        cachedContext = null
      },
    }
  },
} satisfies PluginModule
