import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createLocalSearchIndex } from "tinycode-plugin-redhat-shared/local-search"
import type { LocalSearchIndex, SearchResult } from "tinycode-plugin-redhat-shared/local-search"

const optionsSchema = z
  .object({
    catalogPath: z
      .string()
      .describe(
        "Path to ecosystem catalog data directory (e.g., ~/offline-repo/RH_ecosystem/)",
      ),
  })
  .optional()

const NOT_CONFIGURED_MSG =
  "Ecosystem catalog not configured. Set catalogPath in plugin options to the directory containing Red Hat ecosystem catalog data."

const CATEGORY_KEYWORDS = ["storage", "networking", "security", "ai-ml"] as const
const PLATFORM_KEYWORDS = ["ocp", "rhel", "ansible"] as const

function matchesFilter(
  result: SearchResult,
  content: string,
  filter: string,
  keywords: readonly string[],
): boolean {
  const lower = filter.toLowerCase()
  const valid = keywords.some((k) => k === lower)
  if (!valid) return false
  const combined = (result.filePath + " " + content).toLowerCase()
  return combined.includes(lower)
}

function extractField(content: string, field: string): string | null {
  const regex = new RegExp(`^${field}:\\s*(.+)$`, "im")
  const match = content.match(regex)
  return match?.[1] ? match[1].trim() : null
}

function inferCertification(content: string): string {
  const lower = content.toLowerCase()
  if (lower.includes("certified")) return "certified"
  if (lower.includes("validated")) return "validated"
  return "unknown"
}

function formatSearchResult(result: SearchResult, content: string): string {
  const category = extractField(content, "Category") ?? "unknown"
  const platform = extractField(content, "Platform") ?? "unknown"
  const operator = extractField(content, "Operator")
  const certification = inferCertification(content)

  const parts = [
    `Partner: ${result.title}`,
    `Category: ${category}`,
    `Platform: ${platform}`,
    `Certification: ${certification}`,
  ]
  if (operator) {
    parts.push(`Operator: ${operator}`)
  }
  parts.push(`Path: ${result.filePath}`)
  return parts.join(" | ")
}

function formatOperatorResult(content: string, title: string): string {
  const operator = extractField(content, "Operator") ?? title
  const ocpVersions = extractField(content, "Supported OCP") ?? "unknown"
  const install = extractField(content, "Install") ?? "unknown"
  const certified = inferCertification(content)

  return [
    `Operator: ${operator}`,
    `Supported OCP: ${ocpVersions}`,
    `Install: ${install}`,
    `Certification: ${certified}`,
  ].join(" | ")
}

function formatHardwareResult(result: SearchResult, content: string): string {
  const vendor = extractField(content, "Vendor") ?? "unknown"
  const model = extractField(content, "Model") ?? result.title
  const certified = inferCertification(content)
  const versions =
    extractField(content, "Certified RHEL") ??
    extractField(content, "Supported OCP") ??
    "unknown"

  return [
    `Vendor: ${vendor}`,
    `Model: ${model}`,
    `Certification: ${certified}`,
    `Supported: ${versions}`,
    `Path: ${result.filePath}`,
  ].join(" | ")
}

export function createCatalogTools(
  index: LocalSearchIndex,
): Record<string, ToolDefinition> {
  return {
    ecosystem_search: {
      description:
        "Search the Red Hat Ecosystem Catalog by keyword, category, or platform. Returns partner name, product, certification level, and operator name if present.",
      args: {
        query: z.string().describe("Search query keyword(s)"),
        category: z
          .enum(["storage", "networking", "security", "AI-ML"])
          .optional()
          .describe("Filter by category"),
        platform: z
          .enum(["OCP", "RHEL", "Ansible"])
          .optional()
          .describe("Filter by platform"),
        limit: z.number().optional().describe("Max results to return (default 10)"),
      },
      async execute(args: {
        query: string
        category?: string
        platform?: string
        limit?: number
      }) {
        try {
          const results = await index.search(args.query, args.limit ?? 10)
          const formatted: string[] = []

          for (const result of results) {
            const content = await index.getContent(result.filePath)

            if (args.category && !matchesFilter(result, content, args.category, CATEGORY_KEYWORDS)) {
              continue
            }
            if (args.platform && !matchesFilter(result, content, args.platform, PLATFORM_KEYWORDS)) {
              continue
            }

            formatted.push(formatSearchResult(result, content))
          }

          return formatted.length > 0 ? formatted.join("\n") : "No results found."
        } catch (error) {
          return `Search failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ecosystem_operator: {
      description:
        "Get certified operator details from the Red Hat Ecosystem Catalog. Returns operator name, supported OCP versions, install method, and certification status.",
      args: {
        operatorName: z.string().describe("Name of the operator to look up"),
      },
      async execute(args: { operatorName: string }) {
        try {
          const searchQuery = args.operatorName.replace(/-/g, " ")
          const results = await index.search(searchQuery, 10)

          for (const result of results) {
            const content = await index.getContent(result.filePath)
            const operator = extractField(content, "Operator")
            if (operator && operator.toLowerCase().includes(args.operatorName.toLowerCase())) {
              return formatOperatorResult(content, result.title)
            }
          }

          return `No operator found matching "${args.operatorName}".`
        } catch (error) {
          return `Operator lookup failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ecosystem_hardware: {
      description:
        "Search certified hardware in the Red Hat Ecosystem Catalog. Returns vendor, model, certification status, and supported versions.",
      args: {
        query: z.string().describe("Hardware search query (vendor, model, etc.)"),
      },
      async execute(args: { query: string }) {
        try {
          const results = await index.search(args.query, 20)
          const formatted: string[] = []

          for (const result of results) {
            const content = await index.getContent(result.filePath)
            const combined = (result.filePath + " " + content).toLowerCase()
            if (
              combined.includes("hardware") ||
              combined.includes("server") ||
              combined.includes("certified hardware")
            ) {
              formatted.push(formatHardwareResult(result, content))
            }
          }

          return formatted.length > 0 ? formatted.join("\n") : "No hardware results found."
        } catch (error) {
          return `Hardware search failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredCatalogTools(): Record<string, ToolDefinition> {
  return {
    ecosystem_search: {
      description:
        "Search the Red Hat Ecosystem Catalog by keyword, category, or platform.",
      args: {
        query: z.string().describe("Search query keyword(s)"),
        category: z
          .enum(["storage", "networking", "security", "AI-ML"])
          .optional()
          .describe("Filter by category"),
        platform: z
          .enum(["OCP", "RHEL", "Ansible"])
          .optional()
          .describe("Filter by platform"),
        limit: z.number().optional().describe("Max results to return (default 10)"),
      },
      async execute(_args: {
        query: string
        category?: string
        platform?: string
        limit?: number
      }) {
        return NOT_CONFIGURED_MSG
      },
    },

    ecosystem_operator: {
      description: "Get certified operator details from the Red Hat Ecosystem Catalog.",
      args: {
        operatorName: z.string().describe("Name of the operator to look up"),
      },
      async execute(_args: { operatorName: string }) {
        return NOT_CONFIGURED_MSG
      },
    },

    ecosystem_hardware: {
      description: "Search certified hardware in the Red Hat Ecosystem Catalog.",
      args: {
        query: z.string().describe("Hardware search query (vendor, model, etc.)"),
      },
      async execute(_args: { query: string }) {
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

    if (!parsed?.catalogPath) {
      return {
        tool: createUnconfiguredCatalogTools(),
      }
    }

    const index = createLocalSearchIndex({ basePath: parsed.catalogPath })

    return {
      tool: createCatalogTools(index),
    }
  },
} satisfies PluginModule
