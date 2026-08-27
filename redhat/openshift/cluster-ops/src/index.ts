import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import {
  createConsoleAuthClient,
  createConsoleApiClient,
} from "tinycode-plugin-redhat-shared/console-auth"
import { createCoreTools } from "./core-tools"
import { createGitOpsTools } from "./gitops-tools"
import {
  createInsightsTools,
  createUnconfiguredInsightsTools,
} from "./insights-tools"
import { createObsTools } from "./obs-tools"

const optionsSchema = z
  .object({
    consoleOfflineToken: z.string().optional(),
    clusterId: z.string().optional(),
  })
  .optional()

export default {
  schema: optionsSchema,
  server: async (input, options): Promise<Hooks> => {
    const oc = createOcClient(input.$)
    const parsed = optionsSchema.safeParse(options)
    const opts = parsed.success ? parsed.data : undefined

    let insightsTools: Record<string, ToolDefinition>
    if (opts?.consoleOfflineToken && opts.clusterId) {
      const authClient = createConsoleAuthClient({
        offlineToken: opts.consoleOfflineToken,
      })
      const insightsClient = createConsoleApiClient(
        { offlineToken: opts.consoleOfflineToken },
        "/api/insights/v1",
        authClient,
      )
      const vulnerabilityClient = createConsoleApiClient(
        { offlineToken: opts.consoleOfflineToken },
        "/api/ocp-vulnerability/v1",
        authClient,
      )
      insightsTools = createInsightsTools(
        insightsClient,
        vulnerabilityClient,
        opts.clusterId,
      )
    } else {
      insightsTools = createUnconfiguredInsightsTools()
    }

    return {
      "shell.env": async (
        _event: { cwd: string; sessionID?: string; callID?: string },
        output: { env: Record<string, string> },
      ) => {
        output.env["OC_EDITOR"] = "cat"
      },

      tool: {
        ...createCoreTools(oc),
        ...createGitOpsTools(oc),
        ...insightsTools,
        ...createObsTools(oc),
      },
    }
  },
} satisfies PluginModule
