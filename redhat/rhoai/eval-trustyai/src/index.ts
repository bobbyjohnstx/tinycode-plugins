import type { Hooks, PluginModule, ToolContext, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import type { OcClient } from "tinycode-plugin-redhat-shared/oc"
import { createEvalClient } from "./eval-client"
import type { EvalClient, EvalResult } from "./eval-client"
import { createTrustyAIClient } from "./trustyai-client"
import type { TrustyAIClient, TrustyAlert } from "./trustyai-client"

const optionsSchema = z
  .object({
    evalApiUrl: z.string().url().optional().describe("EvalHub API URL"),
    trustyaiUrl: z
      .string()
      .url()
      .optional()
      .describe("TrustyAI service URL"),
    namespace: z
      .string()
      .optional()
      .describe("Default namespace for workbench queries"),
    token: z.string().optional().describe("Bearer token"),
  })
  .optional()

function formatEvalResult(result: EvalResult): string {
  const lines = [
    `Eval: ${result.eval_id}`,
    `Model: ${result.model}`,
    `Provider: ${result.provider}`,
    `Status: ${result.status}`,
    `Created: ${result.created_at}`,
  ]
  if (result.completed_at) {
    lines.push(`Completed: ${result.completed_at}`)
  }
  if (result.error) {
    lines.push(`Error: ${result.error}`)
  }
  if (result.results && Object.keys(result.results).length > 0) {
    lines.push("", "Results:")
    for (const [task, score] of Object.entries(result.results)) {
      lines.push(`  ${task}: ${score}`)
    }
  }
  return lines.join("\n")
}

function formatAlert(alert: TrustyAlert): string {
  return `[${alert.severity.toUpperCase()}] ${alert.type}: ${alert.model} — ${alert.metric} at ${alert.currentValue} (threshold: ${alert.threshold})`
}

export function createEvalTools(
  evalClient: EvalClient,
): Record<string, ToolDefinition> {
  return {
    rhoai_eval_run: {
      description:
        "Run a model evaluation using lm-eval, ragas, garak, or guidellm. Requires confirmation before starting.",
      args: {
        model: z.string().describe("Model name to evaluate"),
        provider: z
          .enum(["lm-eval", "ragas", "garak", "guidellm"])
          .describe("Evaluation provider/framework"),
        config: z
          .string()
          .optional()
          .describe("JSON string of evaluation config (tasks, numFewShot, batchSize)"),
      },
      async execute(
        args: { model: string; provider: string; config?: string },
        ctx: ToolContext,
      ) {
        try {
          await ctx.ask({
            permission: "rhoai_eval_run",
            patterns: [`Run ${args.provider} evaluation on ${args.model}`],
            always: [],
            metadata: {},
          })
          const evalConfig = args.config
            ? JSON.parse(args.config)
            : undefined
          const evalId = await evalClient.runEval(
            args.model,
            args.provider,
            evalConfig,
          )
          return `Evaluation started. Eval ID: ${evalId}\nUse rhoai_eval_status to check progress.`
        } catch (error) {
          return `Failed to run evaluation: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhoai_eval_status: {
      description:
        "Check the status and results of a model evaluation. Displays scores as a table when completed.",
      args: {
        evalId: z.string().describe("Evaluation ID to check"),
      },
      async execute(args: { evalId: string }) {
        try {
          const result = await evalClient.getEvalStatus(args.evalId)
          return formatEvalResult(result)
        } catch (error) {
          return `Failed to get eval status: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhoai_eval_compare: {
      description:
        "Compare results across multiple evaluations side by side.",
      args: {
        evalIds: z
          .array(z.string())
          .describe("List of evaluation IDs to compare"),
      },
      async execute(args: { evalIds: string[] }) {
        try {
          const comparison = await evalClient.compareEvals(args.evalIds)
          if (comparison.evals.length === 0) {
            return "No evaluations found."
          }
          const lines = ["Evaluation Comparison:", ""]
          for (const eval_ of comparison.evals) {
            lines.push(formatEvalResult(eval_), "")
          }
          return lines.join("\n").trim()
        } catch (error) {
          return `Failed to compare evals: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredEvalTools(): Record<string, ToolDefinition> {
  const msg =
    "EvalHub not configured. Set evalApiUrl in plugin options to enable evaluation tools."
  return {
    rhoai_eval_run: {
      description: "Run a model evaluation.",
      args: {
        model: z.string(),
        provider: z.enum(["lm-eval", "ragas", "garak", "guidellm"]),
        config: z.string().optional(),
      },
      async execute() {
        return msg
      },
    },
    rhoai_eval_status: {
      description: "Check evaluation status.",
      args: { evalId: z.string() },
      async execute() {
        return msg
      },
    },
    rhoai_eval_compare: {
      description: "Compare evaluation results.",
      args: { evalIds: z.array(z.string()) },
      async execute() {
        return msg
      },
    },
  }
}

export function createTrustyTools(
  trustyClient: TrustyAIClient,
): Record<string, ToolDefinition> {
  return {
    rhoai_trusty_metrics: {
      description:
        "Get TrustyAI fairness and drift metrics for a deployed model. Shows drift score, bias metrics, and feature distributions.",
      args: {
        model: z.string().describe("Model name to query metrics for"),
      },
      async execute(args: { model: string }) {
        try {
          const metrics = await trustyClient.getMetrics(args.model)
          const lines = [
            `Model: ${metrics.model}`,
            `Drift Score: ${metrics.driftScore}`,
            "",
            "Bias Metrics:",
          ]
          for (const [metric, value] of Object.entries(metrics.biasMetrics)) {
            lines.push(`  ${metric}: ${value}`)
          }
          lines.push("", "Feature Distributions:")
          for (const [feature, dist] of Object.entries(
            metrics.featureDistributions,
          )) {
            lines.push(
              `  ${feature}: mean=${dist.mean}, stddev=${dist.stddev}`,
            )
          }
          return lines.join("\n")
        } catch (error) {
          return `Failed to get metrics: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhoai_trusty_alerts: {
      description:
        "List active TrustyAI alerts for drift and bias across all models.",
      args: {},
      async execute() {
        try {
          const alerts = await trustyClient.getAlerts()
          if (alerts.length === 0) {
            return "No active alerts."
          }
          const lines = [`Active Alerts (${alerts.length}):`, ""]
          for (const alert of alerts) {
            lines.push(formatAlert(alert))
          }
          return lines.join("\n")
        } catch (error) {
          return `Failed to get alerts: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredTrustyTools(): Record<
  string,
  ToolDefinition
> {
  const msg =
    "TrustyAI not configured. Set trustyaiUrl in plugin options to enable TrustyAI tools."
  return {
    rhoai_trusty_metrics: {
      description: "Get TrustyAI metrics.",
      args: { model: z.string() },
      async execute() {
        return msg
      },
    },
    rhoai_trusty_alerts: {
      description: "List TrustyAI alerts.",
      args: {},
      async execute() {
        return msg
      },
    },
  }
}

type NotebookItem = {
  metadata?: { name?: string; namespace?: string }
  status?: {
    conditions?: Array<{ type?: string; status?: string }>
    readyReplicas?: number
  }
  spec?: {
    template?: {
      spec?: {
        containers?: Array<{
          image?: string
          resources?: {
            limits?: Record<string, string>
            requests?: Record<string, string>
          }
        }>
      }
    }
  }
}

export function createWorkbenchTools(
  oc: OcClient,
  defaultNamespace?: string,
): Record<string, ToolDefinition> {
  return {
    rhoai_workbench_list: {
      description:
        "List RHOAI workbenches (Jupyter notebooks). Shows name, status, image, and GPU allocation.",
      args: {
        namespace: z
          .string()
          .optional()
          .describe(
            "Namespace to query. Defaults to the configured namespace or current context.",
          ),
      },
      async execute(args: { namespace?: string }) {
        try {
          const ns = args.namespace ?? defaultNamespace
          const data = await oc.get<{ items: NotebookItem[] }>(
            "notebooks.kubeflow.org",
            ns ? { namespace: ns } : undefined,
          )
          const items = data.items ?? []
          if (items.length === 0) {
            return "No workbenches found."
          }
          const lines = [`Workbenches found: ${items.length}`, ""]
          for (const nb of items) {
            const name = nb.metadata?.name ?? "unknown"
            const ready =
              nb.status?.readyReplicas && nb.status.readyReplicas > 0
                ? "Ready"
                : "Stopped"
            const container =
              nb.spec?.template?.spec?.containers?.[0]
            const image = container?.image ?? "unknown"
            const gpu =
              container?.resources?.limits?.["nvidia.com/gpu"] ?? "none"
            lines.push(
              `${name} | ${ready} | image: ${image} | GPU: ${gpu}`,
            )
          }
          return lines.join("\n")
        } catch (error) {
          return `Error listing workbenches: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export default {
  schema: optionsSchema,
  server: async (input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined
    const namespace = parsed?.namespace
    const tokenFn = parsed?.token
      ? async () => parsed.token!
      : undefined

    const oc = createOcClient(input.$)

    let evalTools: Record<string, ToolDefinition>
    if (parsed?.evalApiUrl) {
      const evalClient = createEvalClient({
        apiUrl: parsed.evalApiUrl,
        tokenFn,
      })
      evalTools = createEvalTools(evalClient)
    } else {
      evalTools = createUnconfiguredEvalTools()
    }

    let trustyTools: Record<string, ToolDefinition>
    if (parsed?.trustyaiUrl) {
      const trustyClient = createTrustyAIClient({
        apiUrl: parsed.trustyaiUrl,
        tokenFn,
      })
      trustyTools = createTrustyTools(trustyClient)
    } else {
      trustyTools = createUnconfiguredTrustyTools()
    }

    const workbenchTools = createWorkbenchTools(oc, namespace)

    return {
      tool: {
        ...evalTools,
        ...trustyTools,
        ...workbenchTools,
      },
    }
  },
} satisfies PluginModule
