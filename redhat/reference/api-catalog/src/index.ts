import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import type { ApiClient } from "tinycode-plugin-redhat-shared/api"
import { createConsoleApiClient } from "tinycode-plugin-redhat-shared/console-auth"
import { API_CATALOG, searchCatalog, parseOpenApiEndpoints } from "./catalog-client"
import type { ApiEndpoint } from "./catalog-client"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const optionsSchema = z
  .object({
    consoleOfflineToken: z
      .string()
      .optional()
      .describe("Console.redhat.com offline token for live spec fetching"),
    catalogPath: z
      .string()
      .optional()
      .describe("Local path to cached API specs"),
  })
  .optional()

const MAX_SPEC_LENGTH = 5000

const NOT_AVAILABLE_MSG =
  "API spec not available. Configure consoleOfflineToken for live fetching or catalogPath for cached specs."

async function loadSpecFromCache(
  catalogPath: string,
  apiName: string,
): Promise<Record<string, unknown> | null> {
  try {
    const filePath = join(catalogPath, `${apiName}.json`)
    const content = await readFile(filePath, "utf-8")
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

async function fetchSpecFromConsole(
  client: ApiClient,
  apiName: string,
): Promise<Record<string, unknown> | null> {
  try {
    const entry = API_CATALOG.find((e) => e.name === apiName)
    if (!entry) return null

    const response = await client.get<Record<string, unknown>>(
      `${entry.basePath}/openapi.json`,
    )
    return response.data
  } catch {
    return null
  }
}

async function resolveSpec(
  consoleClient: ApiClient | null,
  catalogPath: string | null,
  apiName: string,
): Promise<Record<string, unknown> | null> {
  if (catalogPath) {
    const cached = await loadSpecFromCache(catalogPath, apiName)
    if (cached) return cached
  }

  if (consoleClient) {
    return fetchSpecFromConsole(consoleClient, apiName)
  }

  return null
}

function formatSpec(spec: Record<string, unknown>): string {
  const json = JSON.stringify(spec, null, 2)
  if (json.length > MAX_SPEC_LENGTH) {
    return (
      json.slice(0, MAX_SPEC_LENGTH) +
      `\n\n... (truncated, full spec is ${json.length} characters)`
    )
  }
  return json
}

function formatEndpoints(
  endpoints: ApiEndpoint[],
  search?: string,
): string {
  let filtered = endpoints
  if (search) {
    const lower = search.toLowerCase()
    filtered = endpoints.filter(
      (ep) =>
        ep.path.toLowerCase().includes(lower) ||
        ep.method.toLowerCase().includes(lower) ||
        ep.description.toLowerCase().includes(lower),
    )
  }

  if (filtered.length === 0) return "No matching endpoints found."

  return filtered
    .map((ep) => {
      const params = ep.params.length > 0 ? ` [${ep.params.join(", ")}]` : ""
      return `${ep.method} ${ep.path}${params} — ${ep.description || "(no description)"}`
    })
    .join("\n")
}

export function createCatalogTools(
  consoleClient: ApiClient | null,
  catalogPath: string | null,
): Record<string, ToolDefinition> {
  return {
    rh_api_list: {
      description:
        "List all Red Hat console.redhat.com APIs with name, description, and version. Filter by keyword search.",
      args: {
        search: z
          .string()
          .optional()
          .describe("Filter APIs by keyword match on name or description"),
      },
      async execute(args: { search?: string }) {
        const results = args.search
          ? searchCatalog(args.search)
          : API_CATALOG

        if (results.length === 0) return "No APIs found matching the search query."

        return results
          .map(
            (api) =>
              `${api.name} (${api.version}) [${api.platform}] — ${api.description} [${api.basePath}]`,
          )
          .join("\n")
      },
    },

    rh_api_spec: {
      description:
        "Fetch the OpenAPI spec for a specific Red Hat console.redhat.com API. Returns formatted JSON, truncated if very large.",
      args: {
        api: z.string().describe("API name (e.g., 'cost-management', 'insights')"),
      },
      async execute(args: { api: string }) {
        const entry = API_CATALOG.find((e) => e.name === args.api)
        if (!entry) {
          return `Unknown API "${args.api}". Use rh_api_list to see available APIs.`
        }

        try {
          const spec = await resolveSpec(consoleClient, catalogPath, args.api)
          if (!spec) return NOT_AVAILABLE_MSG
          return formatSpec(spec)
        } catch (error) {
          return `Failed to fetch spec: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rh_api_endpoints: {
      description:
        "List endpoints for a Red Hat console.redhat.com API without the full spec. Shows method, path, description, and parameters.",
      args: {
        api: z.string().describe("API name (e.g., 'cost-management', 'insights')"),
        search: z
          .string()
          .optional()
          .describe("Filter endpoints by keyword match on path, method, or description"),
      },
      async execute(args: { api: string; search?: string }) {
        const entry = API_CATALOG.find((e) => e.name === args.api)
        if (!entry) {
          return `Unknown API "${args.api}". Use rh_api_list to see available APIs.`
        }

        try {
          const spec = await resolveSpec(consoleClient, catalogPath, args.api)
          if (!spec) return NOT_AVAILABLE_MSG
          const endpoints = parseOpenApiEndpoints(spec)
          return formatEndpoints(endpoints, args.search)
        } catch (error) {
          return `Failed to fetch endpoints: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export default {
  schema: optionsSchema,
  server: async (_input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined

    let consoleClient: ApiClient | null = null
    if (parsed?.consoleOfflineToken) {
      consoleClient = createConsoleApiClient(
        { offlineToken: parsed.consoleOfflineToken },
        "",
      )
    }

    const catalogPath = parsed?.catalogPath ?? null

    return {
      tool: createCatalogTools(consoleClient, catalogPath),
    }
  },
} satisfies PluginModule
