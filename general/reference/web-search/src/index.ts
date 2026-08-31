import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { stripHtml } from "tinycode-plugin-redhat-shared/html"
import { z } from "zod"

const DDG_HTML_URL = "https://html.duckduckgo.com/html/"

interface SearchResult {
  title: string
  url: string
  snippet: string
}

function parseDdgHtml(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const resultPattern =
    /<a\s+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetPattern = /<a\s+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi

  const titles: { url: string; title: string }[] = []
  let match: RegExpExecArray | null
  while ((match = resultPattern.exec(html)) !== null) {
    titles.push({ url: match[1]!, title: stripHtml(match[2]!) })
  }

  const snippets: string[] = []
  while ((match = snippetPattern.exec(html)) !== null) {
    snippets.push(stripHtml(match[1]!))
  }

  for (let i = 0; i < titles.length; i++) {
    const entry = titles[i]!
    results.push({
      title: entry.title,
      url: entry.url,
      snippet: snippets[i] ?? "",
    })
  }

  return results
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No results found."
  }
  return results
    .map((r, i) => `${i + 1}. **${r.title}** - ${r.url}\n   ${r.snippet}`)
    .join("\n")
}

function buildSearchUrl(query: string): string {
  const params = new URLSearchParams({ q: query })
  return `${DDG_HTML_URL}?${params.toString()}`
}

function createTools(): Record<string, ToolDefinition> {
  return {
    web_search: {
      description:
        "Search the web using DuckDuckGo. Returns titles, URLs, and snippets for matching pages.",
      args: {
        query: z.string().describe("Search query"),
        maxResults: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default 8)"),
      },
      async execute(args: { query: string; maxResults?: number }) {
        try {
          const url = buildSearchUrl(args.query)
          const res = await fetch(url, {
            headers: {
              Accept: "text/html",
              "User-Agent": "tinycode-plugin-gen-web-search/0.1.0",
            },
          })
          if (!res.ok) {
            return `Search unavailable: HTTP ${res.status}`
          }
          const html = await res.text()
          const results = parseDdgHtml(html)
          const limited = results.slice(0, args.maxResults ?? 8)
          return formatResults(limited)
        } catch (error) {
          return `Search unavailable: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rh_kb_search: {
      description:
        "Search the Red Hat knowledge base (access.redhat.com) using DuckDuckGo. Returns titles, URLs, and snippets for matching KB articles.",
      args: {
        query: z.string().describe("Search query for Red Hat knowledge base"),
        maxResults: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default 8)"),
      },
      async execute(args: { query: string; maxResults?: number }) {
        try {
          const scopedQuery = `site:access.redhat.com ${args.query}`
          const url = buildSearchUrl(scopedQuery)
          const res = await fetch(url, {
            headers: {
              Accept: "text/html",
              "User-Agent": "tinycode-plugin-gen-web-search/0.1.0",
            },
          })
          if (!res.ok) {
            return `Search unavailable: HTTP ${res.status}`
          }
          const html = await res.text()
          const results = parseDdgHtml(html)
          const limited = results.slice(0, args.maxResults ?? 8)
          return formatResults(limited)
        } catch (error) {
          return `Search unavailable: ${error instanceof Error ? error.message : String(error)}`
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
