import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createQuayClient } from "./quay-client"
import type { QuayClient, QuaySecurityResult } from "./quay-client"

const optionsSchema = z
  .object({
    registryUrl: z.string().url().default("https://quay.io"),
    apiToken: z.string().optional(),
  })
  .optional()

function notConfigured(): string {
  return "Quay plugin is not configured. Set registryUrl in plugin options."
}

function parseRepository(repository: string): { namespace: string; name: string } | null {
  const parts = repository.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null
  }
  return { namespace: parts[0], name: parts[1] }
}

const SEVERITY_ORDER: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
  Negligible: 4,
  Unknown: 5,
}

function formatVulnerabilities(data: QuaySecurityResult): string {
  const features = data.data?.Layer?.Features ?? []
  const vulns: Array<{
    cve: string
    severity: string
    pkg: string
    version: string
    fixedBy: string
  }> = []

  for (const feature of features) {
    for (const vuln of feature.Vulnerabilities ?? []) {
      vulns.push({
        cve: vuln.Name ?? "unknown",
        severity: vuln.Severity ?? "Unknown",
        pkg: feature.Name ?? "unknown",
        version: feature.Version ?? "unknown",
        fixedBy: vuln.FixedBy ?? "no fix available",
      })
    }
  }

  if (vulns.length === 0) {
    return `Scan status: ${data.status ?? "unknown"}\nNo vulnerabilities found.`
  }

  vulns.sort((a, b) => {
    const aOrder = SEVERITY_ORDER[a.severity] ?? 5
    const bOrder = SEVERITY_ORDER[b.severity] ?? 5
    return aOrder - bOrder
  })

  const lines = [
    `Scan status: ${data.status ?? "unknown"}`,
    `Vulnerabilities found: ${vulns.length}`,
    "",
    ...vulns.map(
      (v) => `- ${v.cve} [${v.severity}] in ${v.pkg}@${v.version} | Fix: ${v.fixedBy}`,
    ),
  ]

  return lines.join("\n")
}

function createTools(client: QuayClient): Record<string, ToolDefinition> {
  return {
    quay_search: {
      description:
        "Search Quay container registry for repositories by name or keyword. Returns repo name, description, star count, and last modified.",
      args: {
        query: z.string().describe("Search query for repository name or keyword"),
      },
      async execute(args: { query: string }) {
        try {
          const result = await client.searchRepositories(args.query)
          const repos = result.results ?? []
          if (repos.length === 0) {
            return `No repositories found matching "${args.query}".`
          }
          const lines = [
            `Repositories matching "${args.query}": ${repos.length}`,
            "",
            ...repos.map((r) => {
              const fullName = r.namespace && r.name ? `${r.namespace}/${r.name}` : r.name ?? "unknown"
              const stars = r.star_count ?? 0
              const desc = r.description ? `: ${r.description}` : ""
              return `- ${fullName} (${stars} stars)${desc}`
            }),
          ]
          return lines.join("\n")
        } catch (error) {
          return `Failed to search repositories: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    quay_tags: {
      description:
        "List tags for a Quay repository. Returns tag name, digest, size, and last modified.",
      args: {
        repository: z
          .string()
          .describe('Repository in "namespace/name" format (e.g. "redhat/ubi9")'),
      },
      async execute(args: { repository: string }) {
        try {
          const parsed = parseRepository(args.repository)
          if (!parsed) {
            return `Invalid repository format "${args.repository}". Expected "namespace/name" (e.g. "redhat/ubi9").`
          }
          const result = await client.listTags(parsed.namespace, parsed.name)
          const tags = result.tags ?? []
          if (tags.length === 0) {
            return `No tags found for ${args.repository}.`
          }
          const lines = [
            `Tags for ${args.repository}: ${tags.length}`,
            "",
            ...tags.map((t) => {
              const name = t.name ?? "unknown"
              const digest = t.manifest_digest ? t.manifest_digest.substring(0, 19) : "unknown"
              const size = t.size ? `${Math.round(t.size / 1024 / 1024)}MB` : "unknown size"
              const modified = t.last_modified ?? "unknown"
              return `- ${name} (${digest}) ${size} | Modified: ${modified}`
            }),
          ]
          return lines.join("\n")
        } catch (error) {
          return `Failed to list tags: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    quay_manifest: {
      description:
        "Get manifest details for a specific image digest in a Quay repository. Returns layers, architecture, and config.",
      args: {
        repository: z
          .string()
          .describe('Repository in "namespace/name" format (e.g. "redhat/ubi9")'),
        digest: z.string().describe("Manifest digest (e.g. sha256:abc123...)"),
      },
      async execute(args: { repository: string; digest: string }) {
        try {
          const parsed = parseRepository(args.repository)
          if (!parsed) {
            return `Invalid repository format "${args.repository}". Expected "namespace/name" (e.g. "redhat/ubi9").`
          }
          const result = await client.getManifest(parsed.namespace, parsed.name, args.digest)
          const lines = [
            `Manifest: ${result.digest ?? args.digest}`,
            `Manifest list: ${result.is_manifest_list ? "yes" : "no"}`,
            `Config media type: ${result.config_media_type ?? "unknown"}`,
          ]
          if (result.layers_compressed_size != null) {
            lines.push(`Compressed size: ${Math.round(result.layers_compressed_size / 1024 / 1024)}MB`)
          }
          if (result.manifest_data) {
            lines.push("", "Manifest data:", result.manifest_data)
          }
          return lines.join("\n")
        } catch (error) {
          return `Failed to get manifest: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    quay_vulnerabilities: {
      description:
        "Get Clair vulnerability scan results for a manifest in a Quay repository. Returns CVEs with severity, package, and fix version, sorted by severity.",
      args: {
        repository: z
          .string()
          .describe('Repository in "namespace/name" format (e.g. "redhat/ubi9")'),
        digest: z.string().describe("Manifest digest (e.g. sha256:abc123...)"),
      },
      async execute(args: { repository: string; digest: string }) {
        try {
          const parsed = parseRepository(args.repository)
          if (!parsed) {
            return `Invalid repository format "${args.repository}". Expected "namespace/name" (e.g. "redhat/ubi9").`
          }
          const result = await client.getVulnerabilities(parsed.namespace, parsed.name, args.digest)
          return formatVulnerabilities(result)
        } catch (error) {
          return `Failed to get vulnerabilities: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    quay_labels: {
      description: "Get labels on a manifest in a Quay repository.",
      args: {
        repository: z
          .string()
          .describe('Repository in "namespace/name" format (e.g. "redhat/ubi9")'),
        digest: z.string().describe("Manifest digest (e.g. sha256:abc123...)"),
      },
      async execute(args: { repository: string; digest: string }) {
        try {
          const parsed = parseRepository(args.repository)
          if (!parsed) {
            return `Invalid repository format "${args.repository}". Expected "namespace/name" (e.g. "redhat/ubi9").`
          }
          const result = await client.getLabels(parsed.namespace, parsed.name, args.digest)
          const labels = result.labels ?? []
          if (labels.length === 0) {
            return `No labels found for ${args.repository}@${args.digest}.`
          }
          const lines = [
            `Labels for ${args.repository}@${args.digest}: ${labels.length}`,
            "",
            ...labels.map((l) => `- ${l.key ?? "unknown"}: ${l.value ?? ""} (${l.source_type ?? "unknown"})`),
          ]
          return lines.join("\n")
        } catch (error) {
          return `Failed to get labels: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

function createUnconfiguredTools(): Record<string, ToolDefinition> {
  return {
    quay_search: {
      description:
        "Search Quay container registry for repositories by name or keyword.",
      args: {
        query: z.string().describe("Search query for repository name or keyword"),
      },
      async execute(_args: { query: string }) {
        return notConfigured()
      },
    },

    quay_tags: {
      description: "List tags for a Quay repository.",
      args: {
        repository: z
          .string()
          .describe('Repository in "namespace/name" format (e.g. "redhat/ubi9")'),
      },
      async execute(_args: { repository: string }) {
        return notConfigured()
      },
    },

    quay_manifest: {
      description: "Get manifest details for a specific image digest in a Quay repository.",
      args: {
        repository: z
          .string()
          .describe('Repository in "namespace/name" format (e.g. "redhat/ubi9")'),
        digest: z.string().describe("Manifest digest (e.g. sha256:abc123...)"),
      },
      async execute(_args: { repository: string; digest: string }) {
        return notConfigured()
      },
    },

    quay_vulnerabilities: {
      description:
        "Get Clair vulnerability scan results for a manifest in a Quay repository.",
      args: {
        repository: z
          .string()
          .describe('Repository in "namespace/name" format (e.g. "redhat/ubi9")'),
        digest: z.string().describe("Manifest digest (e.g. sha256:abc123...)"),
      },
      async execute(_args: { repository: string; digest: string }) {
        return notConfigured()
      },
    },

    quay_labels: {
      description: "Get labels on a manifest in a Quay repository.",
      args: {
        repository: z
          .string()
          .describe('Repository in "namespace/name" format (e.g. "redhat/ubi9")'),
        digest: z.string().describe("Manifest digest (e.g. sha256:abc123...)"),
      },
      async execute(_args: { repository: string; digest: string }) {
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

    if (!parsed?.registryUrl) {
      return {
        tool: createUnconfiguredTools(),
      }
    }

    const client = createQuayClient(parsed.registryUrl, parsed.apiToken)

    return {
      tool: createTools(client),
    }
  },
} satisfies PluginModule
