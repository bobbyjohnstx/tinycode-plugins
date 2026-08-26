import type { Hooks, PluginModule } from "tinycode-plugin"
import { z } from "zod"
import { createApiClient } from "tinycode-plugin-redhat-shared/api"
import { createMlflowClient } from "tinycode-plugin-redhat-shared/mlflow"
import type { LastRunInfo } from "./read-side"
import { fetchLastRun, createSystemTransformHook } from "./read-side"

const optionsSchema = z
  .object({
    mlflowUrl: z.string().url(),
    experimentName: z.string().optional(),
  })
  .optional()

export default {
  schema: optionsSchema,
  server: async (input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined

    if (!parsed?.mlflowUrl) {
      return {}
    }

    const api = createApiClient({
      baseUrl: parsed.mlflowUrl,
      tokenFn: async () => "",
    })
    const mlflow = createMlflowClient(api)

    const experimentName =
      parsed.experimentName ?? input.directory.split("/").pop() ?? "default"

    let runId: string | undefined
    let toolCallCount = 0
    let eventCount = 0
    let startTime = 0
    let _modelId: string | undefined
    const lastRunRef: { current: LastRunInfo | null } = { current: null }

    return {
      "session.start": async (event, _output) => {
        try {
          try {
            lastRunRef.current = await fetchLastRun(api, experimentName)
          } catch {
            // read-side is best-effort
          }

          let experimentId = await mlflow.getExperimentByName(experimentName)
          if (!experimentId) {
            experimentId = await mlflow.createExperiment(experimentName)
          }

          runId = await mlflow.createRun(experimentId, [
            { key: "sessionID", value: event.sessionID },
          ])

          startTime = Date.now()
          toolCallCount = 0
          eventCount = 0
        } catch {
          // fire-and-forget: don't fail the hook
        }
      },

      "tool.execute.after": async (event, _output) => {
        if (!runId) return

        toolCallCount++

        try {
          await mlflow.logMetric(runId, event.tool, 1, toolCallCount)
        } catch {
          // fire-and-forget
        }
      },

      "session.end": async (_event, _output) => {
        if (!runId) return

        const durationSeconds = (Date.now() - startTime) / 1000

        try {
          await mlflow.logMetric(runId, "tool_call_count", toolCallCount)
          await mlflow.logMetric(
            runId,
            "session_duration_seconds",
            durationSeconds,
          )
          await mlflow.endRun(runId, "FINISHED")
        } catch {
          // fire-and-forget
        }

        runId = undefined
      },

      event: async (_input) => {
        eventCount++
      },

      dispose: async () => {
        if (!runId) return

        try {
          await mlflow.endRun(runId, "KILLED")
        } catch {
          // fire-and-forget
        }

        runId = undefined
      },

      "experimental.chat.system.transform":
        createSystemTransformHook(lastRunRef),
    }
  },
} satisfies PluginModule
