import type { Hooks, PluginModule, ToolContext, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createApiClient } from "tinycode-plugin-redhat-shared/api"
import { createMlflowClient } from "tinycode-plugin-redhat-shared/mlflow"
import { createMlflowReadClient } from "./mlflow-read-client"
import type {
  MlflowReadClient,
  Experiment,
  Run,
  RunComparison,
  Artifact,
  RegisteredModel,
  ModelVersion,
} from "./mlflow-read-client"

const optionsSchema = z
  .object({
    mlflowUrl: z.string().url().describe("MLFlow tracking server URL"),
  })
  .optional()

type MlflowWriter = {
  logMetric(runId: string, key: string, value: number, step?: number): Promise<void>
}

const VALID_STAGES = ["Staging", "Production", "Archived"] as const

function notConfigured(): string {
  return "MLFlow tools not configured. Set mlflowUrl in plugin options."
}

function formatExperiments(experiments: Experiment[]): string {
  if (experiments.length === 0) {
    return "No experiments found."
  }
  const lines = [
    `Experiments: ${experiments.length}`,
    "",
    ...experiments.map(
      (e) => `- ${e.name} (id: ${e.experiment_id}) [${e.lifecycle_stage}]`,
    ),
  ]
  return lines.join("\n")
}

function formatRuns(runs: Run[]): string {
  if (runs.length === 0) {
    return "No runs found."
  }
  const lines = [
    `Runs: ${runs.length}`,
    "",
    ...runs.map((r) => {
      const metricsStr = r.data.metrics
        .map((m) => `${m.key}=${m.value}`)
        .join(", ")
      const started = new Date(r.info.start_time).toISOString()
      return `- ${r.info.run_id} [${r.info.status}] started ${started}${metricsStr ? ` | ${metricsStr}` : ""}`
    }),
  ]
  return lines.join("\n")
}

function formatComparison(comparison: RunComparison): string {
  if (comparison.runs.length === 0) {
    return "No runs to compare."
  }

  const allParamKeys = new Set<string>()
  const allMetricKeys = new Set<string>()
  for (const run of comparison.runs) {
    for (const key of Object.keys(run.params)) allParamKeys.add(key)
    for (const key of Object.keys(run.metrics)) allMetricKeys.add(key)
  }

  const paramKeys = [...allParamKeys].sort()
  const metricKeys = [...allMetricKeys].sort()

  const header = ["Key", ...comparison.runs.map((r) => r.runId.substring(0, 8))]
  const separator = header.map((h) => "-".repeat(h.length))

  const rows: string[][] = []
  for (const key of paramKeys) {
    rows.push([`param:${key}`, ...comparison.runs.map((r) => r.params[key] ?? "-")])
  }
  for (const key of metricKeys) {
    rows.push([
      `metric:${key}`,
      ...comparison.runs.map((r) => r.metrics[key] !== undefined ? String(r.metrics[key]) : "-"),
    ])
  }

  const lines = [
    `Comparing ${comparison.runs.length} runs:`,
    "",
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ]
  return lines.join("\n")
}

function formatArtifacts(artifacts: Artifact[]): string {
  if (artifacts.length === 0) {
    return "No artifacts found."
  }
  const lines = [
    `Artifacts: ${artifacts.length}`,
    "",
    ...artifacts.map((a) => {
      const type = a.is_dir ? "dir" : "file"
      const size = a.file_size != null ? ` (${a.file_size} bytes)` : ""
      return `- ${a.path} [${type}]${size}`
    }),
  ]
  return lines.join("\n")
}

function formatModels(models: RegisteredModel[]): string {
  if (models.length === 0) {
    return "No registered models found."
  }
  const lines = [
    `Registered models: ${models.length}`,
    "",
    ...models.map((m) => {
      const latest = m.latest_versions[0]
      const versionInfo = latest
        ? ` (v${latest.version} [${latest.current_stage}])`
        : ""
      return `- ${m.name}${versionInfo}`
    }),
  ]
  return lines.join("\n")
}

function formatModelVersion(version: ModelVersion): string {
  const lines = [
    `Model: ${version.name} v${version.version}`,
    `Stage: ${version.current_stage}`,
    `Status: ${version.status}`,
    `Source: ${version.source}`,
    `Run ID: ${version.run_id}`,
    `Created: ${new Date(version.creation_timestamp).toISOString()}`,
  ]
  return lines.join("\n")
}

export function createMlflowTools(
  readClient: MlflowReadClient,
  writeClient: MlflowWriter,
): Record<string, ToolDefinition> {
  return {
    mlflow_experiments: {
      description:
        "List MLFlow experiments with name, id, and lifecycle stage.",
      args: {},
      async execute() {
        try {
          const experiments = await readClient.listExperiments()
          return formatExperiments(experiments)
        } catch (error) {
          return `Failed to list experiments: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    mlflow_runs: {
      description:
        "List MLFlow runs for an experiment. Shows run id, status, start time, and metrics summary.",
      args: {
        experimentId: z.string().describe("Experiment ID to list runs for"),
        filter: z.string().optional().describe("Optional filter expression for runs"),
      },
      async execute(args: { experimentId: string; filter?: string }) {
        try {
          const runs = await readClient.listRuns(args.experimentId, args.filter)
          return formatRuns(runs)
        } catch (error) {
          return `Failed to list runs: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    mlflow_compare: {
      description:
        "Compare 2-5 MLFlow runs side-by-side. Shows params and metrics for each run in a diff table.",
      args: {
        runIds: z
          .array(z.string())
          .min(2)
          .max(5)
          .describe("Array of 2-5 run IDs to compare"),
      },
      async execute(args: { runIds: string[] }) {
        try {
          const comparison = await readClient.compareRuns(args.runIds)
          return formatComparison(comparison)
        } catch (error) {
          return `Failed to compare runs: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    mlflow_artifacts: {
      description:
        "List artifacts for an MLFlow run. Shows path, type (file/dir), and size.",
      args: {
        runId: z.string().describe("Run ID to list artifacts for"),
        path: z.string().optional().describe("Optional subdirectory path within artifacts"),
      },
      async execute(args: { runId: string; path?: string }) {
        try {
          const artifacts = await readClient.listArtifacts(args.runId, args.path)
          return formatArtifacts(artifacts)
        } catch (error) {
          return `Failed to list artifacts: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    mlflow_model_registry: {
      description:
        "List registered models in the MLFlow model registry with latest version info.",
      args: {},
      async execute() {
        try {
          const models = await readClient.listRegisteredModels()
          return formatModels(models)
        } catch (error) {
          return `Failed to list models: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    mlflow_model_version: {
      description:
        "Get detailed information about a specific model version including stage, status, source, and run ID.",
      args: {
        name: z.string().describe("Registered model name"),
        version: z.string().describe("Model version number"),
      },
      async execute(args: { name: string; version: string }) {
        try {
          const version = await readClient.getModelVersion(args.name, args.version)
          return formatModelVersion(version)
        } catch (error) {
          return `Failed to get model version: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    mlflow_promote: {
      description:
        'Transition an MLFlow model version to a new stage (Staging, Production, or Archived). Requires user confirmation.',
      args: {
        name: z.string().describe("Registered model name"),
        version: z.string().describe("Model version number"),
        stage: z
          .enum(["Staging", "Production", "Archived"])
          .describe("Target stage"),
      },
      async execute(
        args: { name: string; version: string; stage: string },
        ctx: ToolContext,
      ) {
        if (!VALID_STAGES.includes(args.stage as typeof VALID_STAGES[number])) {
          return `Invalid stage "${args.stage}". Valid stages: ${VALID_STAGES.join(", ")}`
        }
        try {
          await ctx.ask({
            permission: "mlflow_promote",
            patterns: [`Promote ${args.name} v${args.version} to ${args.stage}`],
            always: [],
            metadata: {},
          })
          await readClient.transitionModelStage(args.name, args.version, args.stage)
          return `Model ${args.name} v${args.version} transitioned to ${args.stage}.`
        } catch (error) {
          return `Failed to promote model: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    mlflow_log_metric: {
      description:
        "Log a metric value to an MLFlow run.",
      args: {
        runId: z.string().describe("Run ID to log metric to"),
        key: z.string().describe("Metric name"),
        value: z.number().describe("Metric value"),
        step: z.number().optional().describe("Optional step number"),
      },
      async execute(args: { runId: string; key: string; value: number; step?: number }) {
        try {
          await writeClient.logMetric(args.runId, args.key, args.value, args.step)
          return `Logged metric ${args.key}=${args.value} to run ${args.runId}.`
        } catch (error) {
          return `Failed to log metric: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredMlflowTools(): Record<string, ToolDefinition> {
  return {
    mlflow_experiments: {
      description: "List MLFlow experiments.",
      args: {},
      async execute() {
        return notConfigured()
      },
    },
    mlflow_runs: {
      description: "List MLFlow runs for an experiment.",
      args: {
        experimentId: z.string().describe("Experiment ID"),
        filter: z.string().optional().describe("Filter expression"),
      },
      async execute() {
        return notConfigured()
      },
    },
    mlflow_compare: {
      description: "Compare MLFlow runs side-by-side.",
      args: {
        runIds: z.array(z.string()).describe("Run IDs to compare"),
      },
      async execute() {
        return notConfigured()
      },
    },
    mlflow_artifacts: {
      description: "List artifacts for an MLFlow run.",
      args: {
        runId: z.string().describe("Run ID"),
        path: z.string().optional().describe("Subdirectory path"),
      },
      async execute() {
        return notConfigured()
      },
    },
    mlflow_model_registry: {
      description: "List registered models.",
      args: {},
      async execute() {
        return notConfigured()
      },
    },
    mlflow_model_version: {
      description: "Get model version details.",
      args: {
        name: z.string().describe("Model name"),
        version: z.string().describe("Version number"),
      },
      async execute() {
        return notConfigured()
      },
    },
    mlflow_promote: {
      description: "Transition model version stage.",
      args: {
        name: z.string().describe("Model name"),
        version: z.string().describe("Version number"),
        stage: z.string().describe("Target stage"),
      },
      async execute() {
        return notConfigured()
      },
    },
    mlflow_log_metric: {
      description: "Log a metric to an MLFlow run.",
      args: {
        runId: z.string().describe("Run ID"),
        key: z.string().describe("Metric name"),
        value: z.number().describe("Metric value"),
        step: z.number().optional().describe("Step number"),
      },
      async execute() {
        return notConfigured()
      },
    },
  }
}

export default {
  schema: optionsSchema,
  server: async (_input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined

    if (!parsed?.mlflowUrl) {
      return {
        tool: createUnconfiguredMlflowTools(),
      }
    }

    const apiClient = createApiClient({
      baseUrl: parsed.mlflowUrl,
      tokenFn: async () => "",
    })
    const readClient = createMlflowReadClient({ mlflowUrl: parsed.mlflowUrl })
    const writeClient = createMlflowClient(apiClient)

    return {
      tool: createMlflowTools(readClient, writeClient),
    }
  },
} satisfies PluginModule
