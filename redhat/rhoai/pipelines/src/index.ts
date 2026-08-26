import type { Hooks, PluginModule, ToolContext, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createApiClient } from "tinycode-plugin-redhat-shared/api"
import { createPipelineClient } from "./pipeline-client"
import type {
  PipelineClient,
  Pipeline,
  PipelineRunDetail,
  PipelineTask,
} from "./pipeline-client"

const optionsSchema = z
  .object({
    pipelinesUrl: z.string().url().describe("Data Science Pipelines API URL"),
    namespace: z.string().optional().describe("Default namespace"),
    token: z.string().optional().describe("Bearer token"),
  })
  .optional()

function notConfigured(): string {
  return "RHOAI Pipelines not configured. Set pipelinesUrl in plugin options."
}

function formatPipelines(pipelines: Pipeline[]): string {
  if (pipelines.length === 0) {
    return "No pipelines found."
  }
  const lines = [
    `Pipelines: ${pipelines.length}`,
    "",
    ...pipelines.map((p) => {
      const desc = p.description ? ` - ${p.description}` : ""
      return `- ${p.display_name} (id: ${p.pipeline_id})${desc} [created ${p.created_at}]`
    }),
  ]
  return lines.join("\n")
}

function taskStatusIcon(state: string): string {
  switch (state.toUpperCase()) {
    case "SUCCEEDED":
      return "DONE"
    case "RUNNING":
      return "RUNNING"
    case "PENDING":
      return "PENDING"
    case "FAILED":
      return "FAILED"
    case "SKIPPED":
      return "SKIPPED"
    case "CANCELLED":
      return "CANCELLED"
    default:
      return state
  }
}

function formatRunStatus(detail: PipelineRunDetail): string {
  const lines = [
    `Run: ${detail.display_name} (${detail.run_id})`,
    `State: ${detail.state}`,
    `Created: ${detail.created_at}`,
  ]
  if (detail.finished_at) {
    lines.push(`Finished: ${detail.finished_at}`)
  }
  if (detail.error) {
    lines.push(`Error: ${detail.error}`)
  }
  if (detail.tasks.length > 0) {
    lines.push("", "Tasks:")
    for (const task of detail.tasks) {
      const icon = taskStatusIcon(task.state)
      lines.push(`  ${icon} ${task.display_name} (${task.task_id})`)
    }
  }
  return lines.join("\n")
}

export function createPipelineTools(
  client: PipelineClient,
): Record<string, ToolDefinition> {
  return {
    rhoai_pipeline_list: {
      description:
        "List RHOAI Data Science Pipelines with name, description, and created date.",
      args: {
        namespace: z
          .string()
          .optional()
          .describe("Namespace to filter pipelines"),
      },
      async execute(args: { namespace?: string }) {
        try {
          const pipelines = await client.listPipelines(args.namespace)
          return formatPipelines(pipelines)
        } catch (error) {
          return `Failed to list pipelines: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhoai_pipeline_run: {
      description:
        "Trigger a pipeline run with optional parameters. Requires user confirmation.",
      args: {
        pipelineId: z.string().describe("Pipeline ID to run"),
        params: z
          .string()
          .optional()
          .describe("JSON string of runtime parameters"),
      },
      async execute(
        args: { pipelineId: string; params?: string },
        ctx: ToolContext,
      ) {
        try {
          let parsedParams: Record<string, string> = {}
          if (args.params) {
            try {
              parsedParams = JSON.parse(args.params) as Record<string, string>
            } catch {
              return "Invalid params JSON. Provide a valid JSON object string."
            }
          }
          await ctx.ask({
            permission: "rhoai_pipeline_run",
            patterns: [`Run pipeline ${args.pipelineId}`],
            always: [],
            metadata: {},
          })
          const runId = await client.createRun(args.pipelineId, parsedParams)
          return `Pipeline run started. Run ID: ${runId}`
        } catch (error) {
          return `Failed to trigger pipeline run: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhoai_pipeline_status: {
      description:
        "Check the status of a pipeline run including per-task completion.",
      args: {
        runId: z.string().describe("Run ID to check status for"),
      },
      async execute(args: { runId: string }) {
        try {
          const detail = await client.getRunStatus(args.runId)
          return formatRunStatus(detail)
        } catch (error) {
          return `Failed to get run status: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhoai_pipeline_create: {
      description:
        "Create a new pipeline from a YAML definition. Requires user confirmation.",
      args: {
        yaml: z.string().describe("Pipeline YAML definition"),
      },
      async execute(args: { yaml: string }, ctx: ToolContext) {
        try {
          await ctx.ask({
            permission: "rhoai_pipeline_create",
            patterns: ["Create new pipeline from YAML"],
            always: [],
            metadata: {},
          })
          const pipelineId = await client.createPipeline(args.yaml)
          return `Pipeline created. Pipeline ID: ${pipelineId}`
        } catch (error) {
          return `Failed to create pipeline: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredPipelineTools(): Record<string, ToolDefinition> {
  return {
    rhoai_pipeline_list: {
      description: "List RHOAI Data Science Pipelines.",
      args: {
        namespace: z.string().optional().describe("Namespace to filter"),
      },
      async execute() {
        return notConfigured()
      },
    },
    rhoai_pipeline_run: {
      description: "Trigger a pipeline run.",
      args: {
        pipelineId: z.string().describe("Pipeline ID"),
        params: z.string().optional().describe("JSON parameters"),
      },
      async execute() {
        return notConfigured()
      },
    },
    rhoai_pipeline_status: {
      description: "Check pipeline run status.",
      args: {
        runId: z.string().describe("Run ID"),
      },
      async execute() {
        return notConfigured()
      },
    },
    rhoai_pipeline_create: {
      description: "Create a pipeline from YAML.",
      args: {
        yaml: z.string().describe("Pipeline YAML"),
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

    if (!parsed?.pipelinesUrl) {
      return {
        tool: createUnconfiguredPipelineTools(),
      }
    }

    const token = parsed.token
    const client = createPipelineClient({
      apiUrl: parsed.pipelinesUrl,
      tokenFn: token ? async () => token : undefined,
    })

    return {
      tool: createPipelineTools(client),
    }
  },
} satisfies PluginModule
