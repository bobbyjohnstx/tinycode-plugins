import type { Hooks, PluginModule, ToolContext, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createConsoleAuthClient } from "tinycode-plugin-redhat-shared/console-auth"
import type { RhdpClient, ProvisionStatus, ActiveEnvironment, CatalogItem } from "./rhdp-client"
import { createRhdpClient } from "./rhdp-client"

const DEFAULT_RHDP_API_URL = "https://demo.redhat.com/api/v1"

const optionsSchema = z
  .object({
    consoleOfflineToken: z
      .string()
      .describe("Console.redhat.com offline token for RHDP API access"),
    rhdpApiUrl: z
      .string()
      .url()
      .optional()
      .describe("RHDP API URL (default: https://demo.redhat.com/api/v1)"),
  })
  .optional()

const NOT_CONFIGURED_MSG =
  "RHDP Provisioner not configured. Set consoleOfflineToken in plugin options."

function formatCatalogItem(item: CatalogItem): string {
  const parts = [
    `Name: ${item.name}`,
    `Description: ${item.description}`,
    `Category: ${item.category}`,
  ]
  if (item.estimatedTime) {
    parts.push(`Estimated Time: ${item.estimatedTime}`)
  }
  return parts.join(" | ")
}

function formatProvisionStatus(status: ProvisionStatus): string {
  const parts = [
    `Order: ${status.orderId}`,
    `Status: ${status.status}`,
    `Started: ${status.startedAt}`,
  ]
  if (status.consoleUrl) parts.push(`Console: ${status.consoleUrl}`)
  if (status.apiUrl) parts.push(`API: ${status.apiUrl}`)
  if (status.credentials) {
    parts.push(`Username: ${status.credentials.username}`)
    parts.push(`Password: [REDACTED -- view credentials at ${status.consoleUrl ?? "the provisioning console"}]`)
  }
  if (status.expiresAt) parts.push(`Expires: ${status.expiresAt}`)
  if (status.error) parts.push(`Error: ${status.error}`)
  return parts.join(" | ")
}

function formatActiveEnvironment(env: ActiveEnvironment): string {
  const parts = [
    `Name: ${env.catalogItemName}`,
    `Status: ${env.status}`,
    `Started: ${env.startedAt}`,
  ]
  if (env.consoleUrl) parts.push(`Console: ${env.consoleUrl}`)
  if (env.expiresAt) parts.push(`Expires: ${env.expiresAt}`)
  return parts.join(" | ")
}

export function createRhdpTools(
  client: RhdpClient,
): Record<string, ToolDefinition> {
  return {
    rhdp_search: {
      description:
        "Search the Red Hat Demo Platform catalog for available demo environments. Returns name, description, category, and estimated provisioning time.",
      args: {
        query: z.string().describe("Search query keyword(s)"),
        category: z
          .enum(["workshop", "demo", "lab", "open-environment"])
          .optional()
          .describe("Filter by catalog category"),
      },
      async execute(args: { query: string; category?: string }) {
        try {
          const items = await client.searchCatalog(args.query, args.category)
          if (items.length === 0) return "No catalog items found."
          return items.map(formatCatalogItem).join("\n")
        } catch (error) {
          return `Catalog search failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhdp_provision: {
      description:
        "Request provisioning of an RHDP demo environment. Requires user confirmation before provisioning begins.",
      args: {
        catalogItemId: z
          .string()
          .describe("ID of the catalog item to provision"),
      },
      async execute(args: { catalogItemId: string }, ctx: ToolContext) {
        try {
          await ctx.ask({
            permission: "Provision demo environment?",
            patterns: ["approve", "yes"],
            always: [],
            metadata: {},
          })
          const status = await client.provision(args.catalogItemId)
          return formatProvisionStatus(status)
        } catch (error) {
          return `Provisioning failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhdp_status: {
      description:
        "Check the provisioning status of an RHDP demo environment order. Returns status, connection details, credentials, and expiry.",
      args: {
        orderId: z.string().describe("Order ID to check status for"),
      },
      async execute(args: { orderId: string }) {
        try {
          const status = await client.getStatus(args.orderId)
          return formatProvisionStatus(status)
        } catch (error) {
          return `Status check failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhdp_list_active: {
      description:
        "List all active RHDP demo environments. Returns name, status, console URL, and expiry for each environment.",
      args: {},
      async execute() {
        try {
          const envs = await client.listActive()
          if (envs.length === 0) return "No active environments."
          return envs.map(formatActiveEnvironment).join("\n")
        } catch (error) {
          return `Failed to list environments: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredRhdpTools(): Record<string, ToolDefinition> {
  return {
    rhdp_search: {
      description:
        "Search the Red Hat Demo Platform catalog for available demo environments.",
      args: {
        query: z.string().describe("Search query keyword(s)"),
        category: z
          .enum(["workshop", "demo", "lab", "open-environment"])
          .optional()
          .describe("Filter by catalog category"),
      },
      async execute(_args: { query: string; category?: string }) {
        return NOT_CONFIGURED_MSG
      },
    },

    rhdp_provision: {
      description: "Request provisioning of an RHDP demo environment.",
      args: {
        catalogItemId: z
          .string()
          .describe("ID of the catalog item to provision"),
      },
      async execute(_args: { catalogItemId: string }) {
        return NOT_CONFIGURED_MSG
      },
    },

    rhdp_status: {
      description:
        "Check the provisioning status of an RHDP demo environment order.",
      args: {
        orderId: z.string().describe("Order ID to check status for"),
      },
      async execute(_args: { orderId: string }) {
        return NOT_CONFIGURED_MSG
      },
    },

    rhdp_list_active: {
      description: "List all active RHDP demo environments.",
      args: {},
      async execute() {
        return NOT_CONFIGURED_MSG
      },
    },
  }
}

export default {
  schema: optionsSchema,
  server: async (_input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined

    if (!parsed?.consoleOfflineToken) {
      return {
        tool: createUnconfiguredRhdpTools(),
      }
    }

    const apiUrl = parsed.rhdpApiUrl ?? DEFAULT_RHDP_API_URL
    const authClient = createConsoleAuthClient({
      offlineToken: parsed.consoleOfflineToken,
    })

    const rhdpClient = createRhdpClient({
      apiUrl,
      tokenFn: () => authClient.getAccessToken(),
    })

    return {
      tool: createRhdpTools(rhdpClient),
    }
  },
} satisfies PluginModule
