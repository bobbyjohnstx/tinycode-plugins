import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createRhdhClient } from "./rhdh-client"
import type { CatalogEntity, RhdhClient } from "./rhdh-client"

const optionsSchema = z
  .object({
    baseUrl: z.string().url(),
    apiToken: z.string().optional(),
  })
  .optional()

function notConfigured(): string {
  return "RHDH plugin not configured. Set baseUrl in plugin options."
}

function formatEntity(entity: CatalogEntity): string {
  const lines: string[] = []
  const meta = entity.metadata
  const spec = entity.spec

  lines.push(`${entity.kind ?? "Unknown"}: ${meta?.name ?? "unknown"}`)
  if (meta?.namespace) lines.push(`Namespace: ${meta.namespace}`)
  if (meta?.title) lines.push(`Title: ${meta.title}`)
  if (meta?.description) lines.push(`Description: ${meta.description}`)
  if (spec?.type) lines.push(`Type: ${spec.type}`)
  if (spec?.lifecycle) lines.push(`Lifecycle: ${spec.lifecycle}`)
  if (spec?.owner) lines.push(`Owner: ${spec.owner}`)
  if (spec?.system) lines.push(`System: ${spec.system}`)

  if (meta?.tags && meta.tags.length > 0) {
    lines.push(`Tags: ${meta.tags.join(", ")}`)
  }

  if (meta?.links && meta.links.length > 0) {
    lines.push("", "Links:")
    for (const link of meta.links) {
      lines.push(`- ${link.title ?? "link"}: ${link.url ?? ""}`)
    }
  }

  if (entity.relations && entity.relations.length > 0) {
    lines.push("", "Relations:")
    for (const rel of entity.relations) {
      lines.push(`- ${rel.type ?? "unknown"} -> ${rel.targetRef ?? "unknown"}`)
    }
  }

  return lines.join("\n")
}

function formatEntityList(entities: CatalogEntity[]): string {
  if (entities.length === 0) {
    return "No entities found matching the search criteria."
  }

  const lines = [`Entities found: ${entities.length}`, ""]
  for (const entity of entities) {
    const kind = entity.kind ?? "Unknown"
    const name = entity.metadata?.name ?? "unknown"
    const ns = entity.metadata?.namespace ?? "default"
    const desc = entity.metadata?.description ? ` - ${entity.metadata.description}` : ""
    const lifecycle = entity.spec?.lifecycle ? ` [${entity.spec.lifecycle}]` : ""
    lines.push(`- ${kind}:${ns}/${name}${lifecycle}${desc}`)
  }

  return lines.join("\n")
}

function formatDependencies(entity: CatalogEntity): string {
  const relations = entity.relations ?? []
  const name = entity.metadata?.name ?? "unknown"
  const kind = entity.kind ?? "Unknown"

  const grouped: Record<string, string[]> = {}
  for (const rel of relations) {
    const type = rel.type ?? "unknown"
    const target = rel.targetRef ?? "unknown"
    if (!grouped[type]) {
      grouped[type] = []
    }
    grouped[type]!.push(target)
  }

  if (Object.keys(grouped).length === 0) {
    return `No dependencies found for ${kind}:${name}.`
  }

  const lines = [`Dependencies for ${kind}:${name}`, ""]
  for (const [type, targets] of Object.entries(grouped)) {
    lines.push(`${type}:`)
    for (const target of targets) {
      lines.push(`  - ${target}`)
    }
  }

  return lines.join("\n")
}

function createTools(client: RhdhClient): Record<string, ToolDefinition> {
  return {
    rhdh_catalog_search: {
      description:
        "Search the RHDH software catalog by name, kind (Component/API/System/Group), or lifecycle stage.",
      args: {
        query: z.string().optional().describe("Search by entity name (substring match)"),
        kind: z
          .string()
          .optional()
          .describe("Filter by entity kind: Component, API, System, or Group"),
        lifecycle: z
          .string()
          .optional()
          .describe("Filter by lifecycle stage (e.g. production, experimental)"),
      },
      async execute(args: { query?: string; kind?: string; lifecycle?: string }) {
        try {
          const filter: Record<string, string> = {}
          if (args.kind) filter["kind"] = args.kind
          if (args.lifecycle) filter["spec.lifecycle"] = args.lifecycle
          if (args.query) filter["metadata.name"] = args.query

          const entities = await client.searchEntities(filter)
          return formatEntityList(entities)
        } catch (error) {
          return `Failed to search catalog: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhdh_catalog_entity: {
      description:
        "Get full entity details from the RHDH catalog: metadata, spec, relations, and links.",
      args: {
        kind: z.string().describe("Entity kind (e.g. Component, API, System, Group)"),
        name: z.string().describe("Entity name"),
        namespace: z
          .string()
          .optional()
          .default("default")
          .describe("Entity namespace (defaults to 'default')"),
      },
      async execute(args: { kind: string; name: string; namespace?: string }) {
        try {
          const ns = args.namespace ?? "default"
          const entity = await client.getEntity(args.kind, ns, args.name)
          return formatEntity(entity)
        } catch (error) {
          return `Failed to get entity: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhdh_api_spec: {
      description:
        "Fetch the OpenAPI or AsyncAPI specification for an API entity in the RHDH catalog.",
      args: {
        name: z.string().describe("API entity name"),
        namespace: z
          .string()
          .optional()
          .default("default")
          .describe("API entity namespace (defaults to 'default')"),
      },
      async execute(args: { name: string; namespace?: string }) {
        try {
          const ns = args.namespace ?? "default"
          const entity = await client.getEntity("API", ns, args.name)

          const definition = entity.spec?.definition
          if (!definition) {
            return `No API specification found for API:${ns}/${args.name}.`
          }

          const lines = [
            `API Spec for ${entity.metadata?.name ?? args.name}`,
            `Type: ${entity.spec?.type ?? "unknown"}`,
            "",
            definition,
          ]
          return lines.join("\n")
        } catch (error) {
          return `Failed to get API spec: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhdh_techdocs: {
      description: "Fetch TechDocs content for a component in the RHDH catalog.",
      args: {
        kind: z.string().describe("Entity kind (e.g. Component)"),
        name: z.string().describe("Entity name"),
        namespace: z
          .string()
          .optional()
          .default("default")
          .describe("Entity namespace (defaults to 'default')"),
      },
      async execute(args: { kind: string; name: string; namespace?: string }) {
        try {
          const ns = args.namespace ?? "default"
          const content = await client.getTechDocs(ns, args.kind, args.name)
          if (!content) {
            return `No TechDocs found for ${args.kind}:${ns}/${args.name}.`
          }
          return `TechDocs for ${args.kind}:${ns}/${args.name}\n\n${content}`
        } catch (error) {
          return `Failed to get TechDocs: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhdh_dependencies: {
      description:
        "Get the dependency graph for an entity: consumesApi, providesApi, dependsOn, dependencyOf relations.",
      args: {
        kind: z.string().describe("Entity kind (e.g. Component, API, System)"),
        name: z.string().describe("Entity name"),
        namespace: z
          .string()
          .optional()
          .default("default")
          .describe("Entity namespace (defaults to 'default')"),
      },
      async execute(args: { kind: string; name: string; namespace?: string }) {
        try {
          const ns = args.namespace ?? "default"
          const entity = await client.getEntity(args.kind, ns, args.name)
          return formatDependencies(entity)
        } catch (error) {
          return `Failed to get dependencies: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

function createUnconfiguredTools(): Record<string, ToolDefinition> {
  return {
    rhdh_catalog_search: {
      description: "Search the RHDH software catalog by name, kind, or lifecycle.",
      args: {
        query: z.string().optional().describe("Search by entity name"),
        kind: z.string().optional().describe("Filter by entity kind"),
        lifecycle: z.string().optional().describe("Filter by lifecycle stage"),
      },
      async execute(_args: { query?: string; kind?: string; lifecycle?: string }) {
        return notConfigured()
      },
    },

    rhdh_catalog_entity: {
      description: "Get full entity details from the RHDH catalog.",
      args: {
        kind: z.string().describe("Entity kind"),
        name: z.string().describe("Entity name"),
        namespace: z.string().optional().default("default").describe("Entity namespace"),
      },
      async execute(_args: { kind: string; name: string; namespace?: string }) {
        return notConfigured()
      },
    },

    rhdh_api_spec: {
      description: "Fetch API specification for an API entity in the RHDH catalog.",
      args: {
        name: z.string().describe("API entity name"),
        namespace: z.string().optional().default("default").describe("API entity namespace"),
      },
      async execute(_args: { name: string; namespace?: string }) {
        return notConfigured()
      },
    },

    rhdh_techdocs: {
      description: "Fetch TechDocs content for a component in the RHDH catalog.",
      args: {
        kind: z.string().describe("Entity kind"),
        name: z.string().describe("Entity name"),
        namespace: z.string().optional().default("default").describe("Entity namespace"),
      },
      async execute(_args: { kind: string; name: string; namespace?: string }) {
        return notConfigured()
      },
    },

    rhdh_dependencies: {
      description: "Get the dependency graph for an entity.",
      args: {
        kind: z.string().describe("Entity kind"),
        name: z.string().describe("Entity name"),
        namespace: z.string().optional().default("default").describe("Entity namespace"),
      },
      async execute(_args: { kind: string; name: string; namespace?: string }) {
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

    if (!parsed?.baseUrl) {
      return {
        tool: createUnconfiguredTools(),
      }
    }

    const client = createRhdhClient(parsed.baseUrl, parsed.apiToken)

    return {
      tool: createTools(client),
    }
  },
} satisfies PluginModule
