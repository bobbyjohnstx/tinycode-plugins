import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createSatelliteClient } from "./satellite-client"
import type { ContentView, Erratum, Host, SatelliteClient } from "./satellite-client"

const optionsSchema = z
  .object({
    satelliteUrl: z.string().url(),
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .optional()

function notConfigured(): string {
  return "Satellite plugin not configured. Set satelliteUrl in plugin options."
}

function formatHosts(hosts: Host[]): string {
  if (hosts.length === 0) {
    return "No hosts found."
  }

  const lines = [
    `Hosts: ${hosts.length}`,
    "",
    ...hosts.map((h) => {
      const name = h.name ?? "unknown"
      const os = h.operatingsystem_name ? ` (${h.operatingsystem_name})` : ""
      const env = h.environment_name ? ` [${h.environment_name}]` : ""
      const status = h.global_status_label ? ` — ${h.global_status_label}` : ""
      return `- ${name}${os}${env}${status}`
    }),
  ]

  return lines.join("\n")
}

function formatErrata(errata: Erratum[]): string {
  if (errata.length === 0) {
    return "No errata found."
  }

  const lines = [
    `Errata: ${errata.length}`,
    "",
    ...errata.map((e) => {
      const id = e.errata_id ?? "unknown"
      const title = e.title ?? "untitled"
      const type = e.type ? ` [${e.type}]` : ""
      const severity = e.severity ? ` (${e.severity})` : ""
      return `- ${id}: ${title}${type}${severity}`
    }),
  ]

  return lines.join("\n")
}

function formatContentViews(views: ContentView[]): string {
  if (views.length === 0) {
    return "No content views found."
  }

  const lines = [
    `Content views: ${views.length}`,
    "",
    ...views.map((v) => {
      const name = v.name ?? "unknown"
      const label = v.label ? ` (${v.label})` : ""
      const composite = v.composite ? " [composite]" : ""
      const published = v.last_published ? ` — last published: ${v.last_published}` : ""
      return `- ${name}${label}${composite}${published}`
    }),
  ]

  return lines.join("\n")
}

function createTools(client: SatelliteClient): Record<string, ToolDefinition> {
  return {
    satellite_query: {
      description:
        "Ask Satellite Lightspeed a question about RHEL, host management, errata, or content views.",
      args: {
        question: z.string().describe("The question to ask Lightspeed"),
      },
      async execute(args: { question: string }) {
        try {
          return await client.queryLightspeed(args.question)
        } catch (error) {
          return `Failed to query Lightspeed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    satellite_hosts: {
      description:
        "Search managed hosts in Satellite with name, OS, environment, and status.",
      args: {
        search: z.string().optional().describe("Search query to filter hosts"),
      },
      async execute(args: { search?: string }) {
        try {
          const result = await client.listHosts(args.search)
          return formatHosts(result.results ?? [])
        } catch (error) {
          return `Failed to list hosts: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    satellite_errata: {
      description:
        "Search available errata in Satellite with ID, title, type, and severity.",
      args: {
        search: z.string().optional().describe("Search query to filter errata"),
        type: z
          .enum(["security", "bugfix", "enhancement"])
          .optional()
          .describe("Filter by errata type"),
      },
      async execute(args: { search?: string; type?: string }) {
        try {
          const result = await client.listErrata(args.search, args.type)
          return formatErrata(result.results ?? [])
        } catch (error) {
          return `Failed to list errata: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    satellite_content_views: {
      description:
        "List content views in Satellite with name, label, composite flag, and last published date.",
      args: {},
      async execute(_args: Record<string, never>) {
        try {
          const result = await client.listContentViews()
          return formatContentViews(result.results ?? [])
        } catch (error) {
          return `Failed to list content views: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

function createUnconfiguredTools(): Record<string, ToolDefinition> {
  return {
    satellite_query: {
      description:
        "Ask Satellite Lightspeed a question about RHEL, host management, errata, or content views.",
      args: {
        question: z.string().describe("The question to ask Lightspeed"),
      },
      async execute(_args: { question: string }) {
        return notConfigured()
      },
    },

    satellite_hosts: {
      description:
        "Search managed hosts in Satellite with name, OS, environment, and status.",
      args: {
        search: z.string().optional().describe("Search query to filter hosts"),
      },
      async execute(_args: { search?: string }) {
        return notConfigured()
      },
    },

    satellite_errata: {
      description:
        "Search available errata in Satellite with ID, title, type, and severity.",
      args: {
        search: z.string().optional().describe("Search query to filter errata"),
        type: z
          .enum(["security", "bugfix", "enhancement"])
          .optional()
          .describe("Filter by errata type"),
      },
      async execute(_args: { search?: string; type?: string }) {
        return notConfigured()
      },
    },

    satellite_content_views: {
      description:
        "List content views in Satellite with name, label, composite flag, and last published date.",
      args: {},
      async execute(_args: Record<string, never>) {
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

    if (!parsed?.satelliteUrl || !parsed.username || !parsed.password) {
      return {
        tool: createUnconfiguredTools(),
      }
    }

    const client = createSatelliteClient(parsed.satelliteUrl, parsed.username, parsed.password)

    return {
      tool: createTools(client),
    }
  },
} satisfies PluginModule
