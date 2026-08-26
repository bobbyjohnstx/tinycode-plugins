import type { PluginModule, Hooks, ToolDefinition } from "tinycode-plugin"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { z } from "zod"

// Local tool helper — equivalent to SDK's tool() which is identity.
// Avoids runtime import of tinycode-plugin (its bun export condition
// points to a src/ directory not shipped in the npm tarball).
function tool(input: {
  description: string
  args: z.ZodRawShape
  execute: (args: any, context: any) => Promise<string>
}): ToolDefinition {
  return input as ToolDefinition
}

type K8sList<T> = { items: T[] }

type TektonPipeline = {
  metadata: { name: string; namespace: string; creationTimestamp: string }
  spec: { tasks?: Array<{ name: string }> }
}

type TektonPipelineRun = {
  metadata: {
    name: string
    namespace: string
    creationTimestamp: string
    labels?: Record<string, string>
  }
  spec: {
    pipelineRef?: { name: string }
    params?: Array<{ name: string; value: string }>
  }
  status?: {
    conditions?: Array<{
      type: string
      status: string
      reason?: string
      message?: string
    }>
    startTime?: string
    completionTime?: string
    childReferences?: Array<{
      name: string
      pipelineTaskName: string
      kind: string
    }>
  }
}

type TektonTask = {
  metadata: { name: string; namespace?: string; creationTimestamp: string }
  spec: { steps?: Array<{ name: string; image?: string }> }
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${totalSeconds}s`
}

function getRunStatus(run: TektonPipelineRun): string {
  const condition = run.status?.conditions?.[0]
  if (!condition) return "Unknown"
  if (condition.status === "True") return condition.reason ?? "Succeeded"
  if (condition.status === "False") return condition.reason ?? "Failed"
  return condition.reason ?? "Running"
}

export default {
  server: async (input, _options): Promise<Hooks> => {
    const oc = createOcClient(input.$)

    return {
      "shell.env": async (_input, output) => {
        output.env["OC_EDITOR"] = "cat"
      },

      tool: {
        tekton_list_pipelines: tool({
          description:
            "List Tekton pipelines in a namespace. Returns name, creation date, and tasks in each pipeline.",
          args: {
            namespace: z.string().describe("Kubernetes namespace"),
          },
          async execute(args) {
            try {
              const result = await oc.get<K8sList<TektonPipeline>>(
                "pipelines",
                { namespace: args.namespace },
              )
              if (result.items.length === 0) {
                return "No pipelines found in namespace " + args.namespace
              }
              const pipelines = result.items.map((p) => ({
                name: p.metadata.name,
                created: p.metadata.creationTimestamp,
                tasks: p.spec.tasks?.map((t) => t.name) ?? [],
              }))
              return JSON.stringify(pipelines, null, 2)
            } catch (error) {
              return `Error listing pipelines: ${error instanceof Error ? error.message : String(error)}`
            }
          },
        }),

        tekton_list_runs: tool({
          description:
            "List PipelineRuns in a namespace with status, start time, and duration. Optionally filter by pipeline name.",
          args: {
            namespace: z.string().describe("Kubernetes namespace"),
            pipeline: z
              .string()
              .optional()
              .describe("Filter by pipeline name"),
          },
          async execute(args) {
            try {
              const options: { namespace: string; selector?: string } = {
                namespace: args.namespace,
              }
              if (args.pipeline) {
                options.selector = `tekton.dev/pipeline=${args.pipeline}`
              }
              const result = await oc.get<K8sList<TektonPipelineRun>>(
                "pipelineruns",
                options,
              )
              if (result.items.length === 0) return "No PipelineRuns found"
              const runs = result.items.map((r) => ({
                name: r.metadata.name,
                pipeline: r.spec.pipelineRef?.name ?? "unknown",
                status: getRunStatus(r),
                startTime: r.status?.startTime ?? "not started",
                duration:
                  r.status?.startTime && r.status.completionTime
                    ? formatDuration(
                        r.status.startTime,
                        r.status.completionTime,
                      )
                    : "in progress",
              }))
              return JSON.stringify(runs, null, 2)
            } catch (error) {
              return `Error listing PipelineRuns: ${error instanceof Error ? error.message : String(error)}`
            }
          },
        }),

        tekton_run_status: tool({
          description:
            "Get detailed status of a specific PipelineRun including each task's status, conditions, and timing.",
          args: {
            namespace: z.string().describe("Kubernetes namespace"),
            name: z.string().describe("PipelineRun name"),
          },
          async execute(args) {
            try {
              const pr = await oc.get<TektonPipelineRun>(
                `pipelineruns/${args.name}`,
                { namespace: args.namespace },
              )
              const condition = pr.status?.conditions?.[0]
              const tasks =
                pr.status?.childReferences?.map((ref) => ({
                  name: ref.pipelineTaskName,
                  taskRunName: ref.name,
                  kind: ref.kind,
                })) ?? []
              const status = {
                name: pr.metadata.name,
                pipeline: pr.spec.pipelineRef?.name ?? "unknown",
                status: getRunStatus(pr),
                condition: condition
                  ? {
                      type: condition.type,
                      status: condition.status,
                      reason: condition.reason,
                      message: condition.message,
                    }
                  : null,
                startTime: pr.status?.startTime ?? null,
                completionTime: pr.status?.completionTime ?? null,
                duration:
                  pr.status?.startTime && pr.status.completionTime
                    ? formatDuration(
                        pr.status.startTime,
                        pr.status.completionTime,
                      )
                    : null,
                tasks,
              }
              return JSON.stringify(status, null, 2)
            } catch (error) {
              return `Error getting PipelineRun status: ${error instanceof Error ? error.message : String(error)}`
            }
          },
        }),

        tekton_run_logs: tool({
          description:
            "Get logs for a task in a PipelineRun. Retrieves the pod logs for the specified task's TaskRun.",
          args: {
            namespace: z.string().describe("Kubernetes namespace"),
            run: z.string().describe("PipelineRun name"),
            task: z
              .string()
              .describe("Task name from the pipeline"),
            container: z
              .string()
              .optional()
              .describe("Specific step container name"),
            tail: z
              .number()
              .optional()
              .describe("Number of log lines from the end"),
          },
          async execute(args) {
            try {
              const pr = await oc.get<TektonPipelineRun>(
                `pipelineruns/${args.run}`,
                { namespace: args.namespace },
              )
              const ref = pr.status?.childReferences?.find(
                (r) => r.pipelineTaskName === args.task,
              )
              if (!ref) {
                return `Task "${args.task}" not found in PipelineRun "${args.run}"`
              }
              const podName = `${ref.name}-pod`
              const logArgs = [
                "logs",
                `pod/${podName}`,
                "--namespace",
                args.namespace,
              ]
              if (args.container) {
                logArgs.push("--container", args.container)
              } else {
                logArgs.push("--all-containers=true")
              }
              if (args.tail !== undefined) {
                logArgs.push("--tail", String(args.tail))
              }
              return await oc.raw(...logArgs)
            } catch (error) {
              return `Error getting logs: ${error instanceof Error ? error.message : String(error)}`
            }
          },
        }),

        tekton_list_tasks: tool({
          description:
            "List available Tasks (namespace-scoped) and ClusterTasks.",
          args: {
            namespace: z
              .string()
              .describe("Kubernetes namespace for namespace-scoped Tasks"),
          },
          async execute(args) {
            const results: Array<{
              name: string
              scope: string
              steps: string[]
            }> = []

            try {
              const tasks = await oc.get<K8sList<TektonTask>>("tasks", {
                namespace: args.namespace,
              })
              for (const t of tasks.items) {
                results.push({
                  name: t.metadata.name,
                  scope: "namespace",
                  steps: t.spec.steps?.map((s) => s.name) ?? [],
                })
              }
            } catch {
              // Tasks not accessible or none found
            }

            try {
              const clusterTasks =
                await oc.get<K8sList<TektonTask>>("clustertasks")
              for (const t of clusterTasks.items) {
                results.push({
                  name: t.metadata.name,
                  scope: "cluster",
                  steps: t.spec.steps?.map((s) => s.name) ?? [],
                })
              }
            } catch {
              // ClusterTasks not accessible or none found
            }

            if (results.length === 0)
              return "No Tasks or ClusterTasks found"
            return JSON.stringify(results, null, 2)
          },
        }),

        tekton_start_run: tool({
          description:
            "Start a pipeline run by creating a PipelineRun resource. Requires user confirmation before creating.",
          args: {
            namespace: z.string().describe("Kubernetes namespace"),
            pipeline: z.string().describe("Pipeline name to run"),
            params: z
              .record(z.string(), z.string())
              .optional()
              .describe("Pipeline parameters as key-value pairs"),
          },
          async execute(args, ctx) {
            await ctx.ask({
              permission: "tekton.start-run",
              patterns: [`pipeline/${args.pipeline}`],
              always: [
                `tekton.start-run:${args.pipeline}:${args.namespace}`,
              ],
              metadata: {
                pipeline: args.pipeline,
                namespace: args.namespace,
              },
            })

            try {
              const runName = `${args.pipeline}-run-${Date.now()}`
              const params = args.params
                ? Object.entries(args.params).map(([name, value]) => ({
                    name,
                    value,
                  }))
                : []

              const manifest = JSON.stringify({
                apiVersion: "tekton.dev/v1",
                kind: "PipelineRun",
                metadata: {
                  name: runName,
                  namespace: args.namespace,
                },
                spec: {
                  pipelineRef: { name: args.pipeline },
                  ...(params.length > 0 ? { params } : {}),
                },
              })

              const result = await oc.apply(manifest)
              return JSON.stringify(
                {
                  created: runName,
                  namespace: args.namespace,
                  pipeline: args.pipeline,
                  result: result.trim(),
                },
                null,
                2,
              )
            } catch (error) {
              return `Error starting pipeline run: ${error instanceof Error ? error.message : String(error)}`
            }
          },
        }),
      },
    }
  },
} satisfies PluginModule
