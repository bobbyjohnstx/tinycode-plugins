import type { Hooks, PluginModule } from "tinycode-plugin"
import { z } from "zod"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { createApiClient } from "tinycode-plugin-redhat-shared/api"
import { createConsoleAuthClient } from "tinycode-plugin-redhat-shared/console-auth"
import { listModels, getModelStatus, listRuntimes } from "./model-discovery"
import {
  createSandboxTools,
  createUnconfiguredSandboxTools,
} from "./sandbox-tools"

const SANDBOX_API_BASE_URL = "https://api.sandbox.devshift.net/api/v1"

const optionsSchema = z
  .object({
    namespace: z.string().optional(),
    routeHost: z.string().optional(),
    consoleOfflineToken: z.string().optional(),
  })
  .optional()

export default {
  schema: optionsSchema,
  server: async (input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined
    const namespace = parsed?.namespace

    const oc = createOcClient(input.$)

    let sandboxTools: Record<string, import("tinycode-plugin").ToolDefinition>
    if (parsed?.consoleOfflineToken) {
      const authClient = createConsoleAuthClient({
        offlineToken: parsed.consoleOfflineToken,
      })
      const sandboxClient = createApiClient({
        baseUrl: SANDBOX_API_BASE_URL,
        tokenFn: () => authClient.getAccessToken(),
      })
      sandboxTools = createSandboxTools(sandboxClient)
    } else {
      sandboxTools = createUnconfiguredSandboxTools()
    }

    return {
      tool: {
        rhoai_list_models: {
          description:
            "List deployed models in RHOAI. Queries InferenceService resources and returns model name, serving runtime, status (ready/not ready), and URL.",
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
              const ns = args.namespace ?? namespace
              return await listModels(oc, ns)
            } catch (error) {
              return `Error listing models: ${error instanceof Error ? error.message : String(error)}`
            }
          },
        },

        rhoai_model_status: {
          description:
            "Get detailed status of a specific RHOAI model. Returns replicas, GPU allocation, conditions, and pod information.",
          args: {
            name: z.string().describe("Name of the InferenceService to query"),
            namespace: z
              .string()
              .optional()
              .describe(
                "Namespace of the model. Defaults to the configured namespace or current context.",
              ),
          },
          async execute(args: { name: string; namespace?: string }) {
            try {
              const ns = args.namespace ?? namespace
              return await getModelStatus(oc, args.name, ns)
            } catch (error) {
              return `Error getting model status: ${error instanceof Error ? error.message : String(error)}`
            }
          },
        },

        rhoai_list_runtimes: {
          description:
            "List available ServingRuntimes in RHOAI. Shows which runtimes are configured (vLLM, Caikit, TGIS, etc.) with supported model formats and container images.",
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
              const ns = args.namespace ?? namespace
              return await listRuntimes(oc, ns)
            } catch (error) {
              return `Error listing runtimes: ${error instanceof Error ? error.message : String(error)}`
            }
          },
        },

        ...sandboxTools,
      },
    }
  },
} satisfies PluginModule
