import type { Hooks, PluginInput, PluginModule, ToolContext, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { createPromQLClient } from "tinycode-plugin-redhat-shared/promql"
import { createAcmClient, type AcmClient } from "./acm-client"

const optionsSchema = z
  .object({
    hubUrl: z.string().url().optional().describe("ACM Hub cluster URL"),
    thanosUrl: z
      .string()
      .url()
      .optional()
      .describe("Thanos query URL for ACM observability"),
    token: z.string().optional().describe("Bearer token for ACM hub"),
  })
  .optional()

export function createAcmTools(
  client: AcmClient,
  $: PluginInput["$"],
): Record<string, ToolDefinition> {
  return {
    acm_clusters: {
      description:
        "List managed clusters with status, version, and cloud provider. Optionally filter by Ready or NotReady status.",
      args: {
        status: z
          .enum(["Ready", "NotReady"])
          .optional()
          .describe("Filter clusters by status"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of clusters to return (default: 50)"),
      },
      async execute(args: { status?: "Ready" | "NotReady"; limit?: number }) {
        try {
          const clusters = await client.listClusters(args.status)
          if (clusters.length === 0) {
            return "No managed clusters found."
          }
          const max = args.limit ?? 50
          if (clusters.length > max) {
            return JSON.stringify(clusters.slice(0, max), null, 2) +
              `\n\n(Showing ${max} of ${clusters.length} clusters. Use status filter or increase limit.)`
          }
          return JSON.stringify(clusters, null, 2)
        } catch (error) {
          return `Error listing clusters: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    acm_cluster_detail: {
      description:
        "Get detailed information for a single managed cluster including installed add-ons and their status.",
      args: {
        name: z.string().describe("Name of the managed cluster"),
      },
      async execute(args: { name: string }) {
        try {
          const detail = await client.getClusterDetail(args.name)
          return JSON.stringify(detail, null, 2)
        } catch (error) {
          return `Error getting cluster detail: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    acm_policies: {
      description:
        "List governance policies across the ACM hub. Optionally filter by namespace.",
      args: {
        namespace: z
          .string()
          .optional()
          .describe("Filter policies by namespace"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of policies to return (default: 50)"),
      },
      async execute(args: { namespace?: string; limit?: number }) {
        try {
          const policies = await client.listPolicies(args.namespace)
          if (policies.length === 0) {
            return "No governance policies found."
          }
          const max = args.limit ?? 50
          if (policies.length > max) {
            return JSON.stringify(policies.slice(0, max), null, 2) +
              `\n\n(Showing ${max} of ${policies.length} policies. Use namespace filter or increase limit.)`
          }
          return JSON.stringify(policies, null, 2)
        } catch (error) {
          return `Error listing policies: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    acm_violations: {
      description:
        "List active policy violations across managed clusters. Optionally filter by cluster or severity.",
      args: {
        cluster: z
          .string()
          .optional()
          .describe("Filter violations by cluster name"),
        severity: z
          .string()
          .optional()
          .describe("Filter violations by severity (e.g. high, medium, low)"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of violations to return (default: 50)"),
      },
      async execute(args: { cluster?: string; severity?: string; limit?: number }) {
        try {
          let violations = await client.listViolations(args.cluster)
          if (args.severity) {
            violations = violations.filter((v) => v.severity === args.severity)
          }
          if (violations.length === 0) {
            return "No active policy violations."
          }
          const max = args.limit ?? 50
          if (violations.length > max) {
            return JSON.stringify(violations.slice(0, max), null, 2) +
              `\n\n(Showing ${max} of ${violations.length} violations. Use cluster/severity filter or increase limit.)`
          }
          return JSON.stringify(violations, null, 2)
        } catch (error) {
          return `Error listing violations: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    acm_applications: {
      description:
        "List ACM-managed applications and their sync status. Optionally filter by target cluster.",
      args: {
        cluster: z
          .string()
          .optional()
          .describe("Filter applications by target cluster name"),
      },
      async execute(args: { cluster?: string }) {
        try {
          const apps = await client.listApplications(args.cluster)
          if (apps.length === 0) {
            return "No ACM-managed applications found."
          }
          return JSON.stringify(apps, null, 2)
        } catch (error) {
          return `Error listing applications: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    acm_app_deploy: {
      description:
        "Deploy an ApplicationSet or Application manifest to the ACM hub. Requires user confirmation before applying.",
      args: {
        yaml: z
          .string()
          .describe("YAML manifest content for the ApplicationSet or Application"),
      },
      async execute(args: { yaml: string }, ctx: ToolContext) {
        try {
          await ctx.ask({
            permission: "acm_app_deploy",
            patterns: ["oc apply"],
            always: [],
            metadata: { yaml: args.yaml },
          })
          const result = await $`echo ${args.yaml} | oc apply -f -`.text()
          return result || "Applied successfully"
        } catch (error) {
          return `Error deploying application: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    acm_observability: {
      description:
        "Run a PromQL query against the ACM Thanos observability endpoint. Requires thanosUrl to be configured.",
      args: {
        query: z.string().describe("PromQL query to execute"),
        time: z
          .string()
          .optional()
          .describe("Evaluation timestamp (RFC3339 or Unix timestamp)"),
      },
      async execute(args: { query: string; time?: string }) {
        return `ACM observability not configured. Set thanosUrl in plugin options.`
      },
    },
  }
}

export function createObservabilityTool(
  thanosUrl: string,
  tokenFn: () => Promise<string>,
): ToolDefinition {
  const promql = createPromQLClient({
    baseUrl: thanosUrl,
    tokenFn,
  })

  return {
    description:
      "Run a PromQL query against the ACM Thanos observability endpoint.",
    args: {
      query: z.string().describe("PromQL query to execute"),
      time: z
        .string()
        .optional()
        .describe("Evaluation timestamp (RFC3339 or Unix timestamp)"),
    },
    async execute(args: { query: string; time?: string }) {
      try {
        const result = await promql.instantQuery(args.query, args.time)
        return JSON.stringify(result, null, 2)
      } catch (error) {
        return `Error querying ACM observability: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }
}

export default {
  schema: optionsSchema,
  server: async (input, options): Promise<Hooks> => {
    const oc = createOcClient(input.$)
    const client = createAcmClient(oc)
    const parsed = optionsSchema.safeParse(options)
    const opts = parsed.success ? parsed.data : undefined

    const tools = createAcmTools(client, input.$)

    if (opts?.thanosUrl && opts.token) {
      tools.acm_observability = createObservabilityTool(
        opts.thanosUrl,
        async () => opts.token!,
      )
    }

    return {
      tool: tools,

      "experimental.chat.system.transform": async (_event, output) => {
        try {
          const clusters = await client.listClusters()
          const readyCount = clusters.filter((c) => c.status === "Ready").length
          const violations = await client.listViolations()
          output.system.push(
            `<acm-context>clusters: ${clusters.length} (${readyCount} ready), violations: ${violations.length}</acm-context>`,
          )
        } catch {
          output.system.push(
            "<acm-context>ACM hub unavailable</acm-context>",
          )
        }
      },
    }
  },
} satisfies PluginModule
