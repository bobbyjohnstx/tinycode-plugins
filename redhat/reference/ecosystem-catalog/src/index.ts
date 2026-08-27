import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"

const PYXIS_BASE = "https://catalog.redhat.com/api/containers/v1"

async function pyxisGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${PYXIS_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  })
  if (!res.ok) {
    throw new Error(`Pyxis API ${res.status}: ${await res.text().catch(() => "unknown")}`)
  }
  return res.json()
}

interface PyxisRepo {
  repository?: string
  registry?: string
  description?: string
  display_data?: {
    name?: string
    short_description?: string
    long_description?: string
  }
  application_categories?: string[]
  build_categories?: string[]
  last_update_date?: string
}

interface PyxisOperatorBundle {
  csv_display_name?: string
  csv_description?: string
  package?: string
  version?: string
  ocp_version?: string
  organization?: string
  channel_name?: string
  capabilities?: string
}

interface PyxisResponse<T> {
  data: T[]
  page: number
  page_size: number
  total: number
}

function formatRepo(repo: PyxisRepo): string {
  const dd = repo.display_data ?? {}
  const parts = [
    `Image: ${repo.registry ?? "registry.redhat.com"}/${repo.repository ?? "unknown"}`,
    `Name: ${dd.name ?? repo.repository ?? "unknown"}`,
  ]
  if (dd.short_description) parts.push(`Description: ${dd.short_description}`)
  if (repo.application_categories?.length) {
    parts.push(`Categories: ${repo.application_categories.join(", ")}`)
  }
  if (repo.last_update_date) parts.push(`Updated: ${repo.last_update_date.split("T")[0]}`)
  return parts.join(" | ")
}

function formatOperator(op: PyxisOperatorBundle): string {
  const parts = [
    `Operator: ${op.csv_display_name ?? op.package ?? "unknown"}`,
    `Package: ${op.package ?? "unknown"}`,
    `Version: ${op.version ?? "unknown"}`,
  ]
  if (op.ocp_version) parts.push(`OCP: ${op.ocp_version}`)
  if (op.organization) parts.push(`Source: ${op.organization}`)
  if (op.channel_name) parts.push(`Channel: ${op.channel_name}`)
  return parts.join(" | ")
}

function createTools(): Record<string, ToolDefinition> {
  return {
    ecosystem_search: {
      description:
        "Search the Red Hat Ecosystem Catalog for certified container images by repository name (e.g., ubi9, nodejs-18, httpd-24). Uses the Pyxis API.",
      args: {
        repository: z.string().describe("Container image repository name to look up (e.g., ubi9, nodejs-18, httpd-24)"),
        page_size: z.number().optional().describe("Number of results (default 10, max 50)"),
      },
      async execute(args: { repository: string; page_size?: number }) {
        try {
          const pageSize = Math.min(args.page_size ?? 10, 50)
          const data = (await pyxisGet("/repositories", {
            page_size: String(pageSize),
            filter: `repository==${args.repository}`,
            include: "data.repository,data.registry,data.display_data,data.application_categories,data.last_update_date",
          })) as PyxisResponse<PyxisRepo>

          if (data.data.length === 0) {
            return `No container image found for repository "${args.repository}". Try an exact repository name like ubi9, nodejs-18, httpd-24, or postgresql-16.`
          }
          return data.data.map(formatRepo).join("\n")
        } catch (error) {
          return `Search failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ecosystem_operator: {
      description:
        "Search certified operators in the Red Hat Ecosystem Catalog by package name. Returns operator name, version, supported OCP versions, and source catalog.",
      args: {
        package: z.string().describe("Operator package name (e.g., amq-streams, elasticsearch-operator, grafana-operator)"),
        page_size: z.number().optional().describe("Number of results (default 5, max 20)"),
      },
      async execute(args: { package: string; page_size?: number }) {
        try {
          const pageSize = Math.min(args.page_size ?? 5, 20)
          const data = (await pyxisGet("/operators/bundles", {
            page_size: String(pageSize),
            filter: `package==${args.package}`,
            include:
              "data.csv_display_name,data.package,data.version,data.ocp_version,data.organization,data.channel_name,data.capabilities",
            sort_by: "creation_date[desc]",
          })) as PyxisResponse<PyxisOperatorBundle>

          if (data.data.length === 0) {
            return `No operator found for package "${args.package}". Try an exact package name like amq-streams, elasticsearch-operator, or grafana-operator.`
          }
          return data.data.map(formatOperator).join("\n")
        } catch (error) {
          return `Operator lookup failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ecosystem_browse: {
      description:
        "Browse the Red Hat Ecosystem Catalog — list recent certified container images or operators. Useful for discovering what's available.",
      args: {
        type: z.enum(["containers", "operators"]).describe("What to browse"),
        page_size: z.number().optional().describe("Number of results (default 10, max 50)"),
        page: z.number().optional().describe("Page number for pagination (default 0)"),
      },
      async execute(args: { type: string; page_size?: number; page?: number }) {
        try {
          const pageSize = Math.min(args.page_size ?? 10, 50)
          const page = args.page ?? 0

          if (args.type === "containers") {
            const data = (await pyxisGet("/repositories", {
              page_size: String(pageSize),
              page: String(page),
              sort_by: "last_update_date[desc]",
              include:
                "data.repository,data.registry,data.display_data,data.application_categories,data.last_update_date",
            })) as PyxisResponse<PyxisRepo>

            if (data.data.length === 0) return "No results."
            const header = `Showing ${data.data.length} of ${data.total} certified container images (page ${page}):\n`
            return header + data.data.map(formatRepo).join("\n")
          }

          const data = (await pyxisGet("/operators/bundles", {
            page_size: String(pageSize),
            page: String(page),
            sort_by: "creation_date[desc]",
            include:
              "data.csv_display_name,data.package,data.version,data.ocp_version,data.organization,data.channel_name",
          })) as PyxisResponse<PyxisOperatorBundle>

          if (data.data.length === 0) return "No results."
          const header = `Showing ${data.data.length} of ${data.total} operator bundles (page ${page}):\n`
          return header + data.data.map(formatOperator).join("\n")
        } catch (error) {
          return `Browse failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export default {
  server: async (): Promise<Hooks> => ({
    tool: createTools(),
  }),
} satisfies PluginModule
