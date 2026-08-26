import type { Hooks, PluginInput, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createLocalSearchIndex } from "tinycode-plugin-redhat-shared/local-search"
import type { LocalSearchIndex, SearchResult } from "tinycode-plugin-redhat-shared/local-search"

const optionsSchema = z
  .object({
    contentPath: z
      .string()
      .describe(
        "Path to Red Hat developer content directory (e.g., ~/offline-repo/RH_developers/txt/)",
      ),
    learningPathsPath: z.string().optional().describe("Path to learning paths directory"),
  })
  .optional()

type ContentType = "article" | "cheatsheet" | "learning-path"

const NOT_CONFIGURED_MSG =
  "Developer content search not configured. Set contentPath in plugin options to the directory containing Red Hat developer content files."

function inferContentType(filePath: string): ContentType {
  const lower = filePath.toLowerCase()
  if (lower.includes("cheatsheet")) return "cheatsheet"
  if (lower.includes("learning")) return "learning-path"
  return "article"
}

function formatResult(result: SearchResult): string {
  const type = inferContentType(result.filePath)
  const label = type.toUpperCase().replace("-", " ")
  const snippet = result.snippet.replace(/\n/g, " ").slice(0, 120)
  return `[${label}] ${result.title} | ${result.filePath} | ${snippet}`
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No results found."
  }
  return results.map(formatResult).join("\n")
}

async function searchWithType(
  index: LocalSearchIndex,
  query: string,
  type: ContentType | undefined,
  limit: number,
): Promise<string> {
  const results = await index.search(query, limit)
  const filtered = type ? results.filter((r) => inferContentType(r.filePath) === type) : results
  return formatResults(filtered)
}

function createTools(index: LocalSearchIndex): Record<string, ToolDefinition> {
  return {
    rh_dev_search: {
      description:
        "Search indexed Red Hat developer articles by keyword. Returns title, file path, snippet, and content type (article/cheatsheet/learning-path).",
      args: {
        query: z.string().describe("Search query keyword(s)"),
        type: z
          .enum(["article", "cheatsheet", "learning-path"])
          .optional()
          .describe("Filter by content type"),
        limit: z.number().optional().describe("Max results to return (default 10)"),
      },
      async execute(args: { query: string; type?: ContentType; limit?: number }) {
        try {
          return await searchWithType(index, args.query, args.type, args.limit ?? 10)
        } catch (error) {
          return `Search failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rh_dev_article: {
      description: "Read full article content by file path from the developer content index.",
      args: {
        path: z.string().describe("File path (relative to content directory) of the article"),
      },
      async execute(args: { path: string }) {
        try {
          return await index.getContent(args.path)
        } catch (error) {
          return `Failed to read article: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rh_dev_cheatsheet: {
      description:
        "Search Red Hat developer cheatsheets by topic. Returns matching cheatsheet results.",
      args: {
        topic: z.string().describe("Cheatsheet topic to search for"),
      },
      async execute(args: { topic: string }) {
        try {
          return await searchWithType(index, args.topic, "cheatsheet", 10)
        } catch (error) {
          return `Cheatsheet search failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rh_dev_learning_path: {
      description:
        "Search Red Hat developer learning paths by topic. Returns matching learning path results.",
      args: {
        topic: z.string().describe("Learning path topic to search for"),
      },
      async execute(args: { topic: string }) {
        try {
          return await searchWithType(index, args.topic, "learning-path", 10)
        } catch (error) {
          return `Learning path search failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

function createUnconfiguredTools(): Record<string, ToolDefinition> {
  return {
    rh_dev_search: {
      description:
        "Search indexed Red Hat developer articles by keyword. Returns title, file path, snippet, and content type.",
      args: {
        query: z.string().describe("Search query keyword(s)"),
        type: z
          .enum(["article", "cheatsheet", "learning-path"])
          .optional()
          .describe("Filter by content type"),
        limit: z.number().optional().describe("Max results to return (default 10)"),
      },
      async execute(_args: { query: string; type?: ContentType; limit?: number }) {
        return NOT_CONFIGURED_MSG
      },
    },

    rh_dev_article: {
      description: "Read full article content by file path from the developer content index.",
      args: {
        path: z.string().describe("File path (relative to content directory) of the article"),
      },
      async execute(_args: { path: string }) {
        return NOT_CONFIGURED_MSG
      },
    },

    rh_dev_cheatsheet: {
      description: "Search Red Hat developer cheatsheets by topic.",
      args: {
        topic: z.string().describe("Cheatsheet topic to search for"),
      },
      async execute(_args: { topic: string }) {
        return NOT_CONFIGURED_MSG
      },
    },

    rh_dev_learning_path: {
      description: "Search Red Hat developer learning paths by topic.",
      args: {
        topic: z.string().describe("Learning path topic to search for"),
      },
      async execute(_args: { topic: string }) {
        return NOT_CONFIGURED_MSG
      },
    },
  }
}

async function detectFramework($: PluginInput["$"]): Promise<string | null> {
  try {
    const result = await $`ls -1`.quiet().nothrow().text()
    const files = result.split("\n")
    if (files.includes("pom.xml") || files.includes("build.gradle")) return "java"
    if (files.includes("package.json")) return "javascript"
    if (files.includes("requirements.txt") || files.includes("pyproject.toml")) return "python"
    if (files.includes("go.mod")) return "go"
    if (files.includes("Cargo.toml")) return "rust"
    if (files.includes("Containerfile") || files.includes("Dockerfile")) return "container"
    return null
  } catch {
    return null
  }
}

export default {
  schema: optionsSchema,
  server: async (input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined

    if (!parsed?.contentPath) {
      return {
        tool: createUnconfiguredTools(),
      }
    }

    const index = createLocalSearchIndex({ basePath: parsed.contentPath })

    let detectedFramework: string | null = null

    return {
      "session.start": async (_event: unknown, _output: unknown) => {
        detectedFramework = await detectFramework(input.$)
      },

      "experimental.chat.system.transform": async (
        _event: unknown,
        output: { system: string[] },
      ) => {
        const lines = ["<rh-dev-content>"]
        lines.push(`indexed-content: ${parsed.contentPath}`)
        if (detectedFramework) {
          lines.push(`detected-framework: ${detectedFramework}`)
        }
        lines.push("</rh-dev-content>")
        output.system.push(lines.join("\n"))
      },

      tool: createTools(index),
    }
  },
} satisfies PluginModule
