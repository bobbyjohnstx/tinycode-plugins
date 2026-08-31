import { describe, it, expect, mock, beforeEach } from "bun:test"
import type { ToolDefinition } from "tinycode-plugin"

const MOCK_DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title"><a class="result__a" href="https://example.com/page1">Example Page One</a></h2>
  <a class="result__snippet">This is the <b>first</b> result snippet with some text.</a>
</div>
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title"><a class="result__a" href="https://example.com/page2">Example Page Two</a></h2>
  <a class="result__snippet">This is the <b>second</b> result snippet.</a>
</div>
`

const MOCK_EMPTY_HTML = `
<div class="no-results">No results found</div>
`

let mockFetch: ReturnType<typeof mock>

beforeEach(() => {
  mockFetch = mock()
  globalThis.fetch = mockFetch as typeof fetch
})

async function getTools(): Promise<Record<string, ToolDefinition>> {
  // Re-import to pick up the mocked fetch each time
  const plugin = await import("../src/index")
  const hooks = await plugin.default.server({} as never, undefined)
  return hooks.tool!
}

describe("tinycode-plugin-web-search", () => {
  describe("plugin loading", () => {
    it("exports both search tools", async () => {
      mockFetch.mockResolvedValue(new Response(MOCK_DDG_HTML))
      const tools = await getTools()
      expect(tools.web_search).toBeDefined()
      expect(tools.rh_kb_search).toBeDefined()
    })

    it("all tools have descriptions", async () => {
      const tools = await getTools()
      expect(tools.web_search.description).toBeTruthy()
      expect(tools.rh_kb_search.description).toBeTruthy()
    })
  })

  describe("web_search", () => {
    it("returns formatted results from mocked DDG HTML response", async () => {
      mockFetch.mockResolvedValue(new Response(MOCK_DDG_HTML))
      const tools = await getTools()
      const result = (await tools.web_search.execute(
        { query: "test query" },
        {} as never,
      )) as string

      expect(result).toContain("1.")
      expect(result).toContain("**Example Page One**")
      expect(result).toContain("https://example.com/page1")
      expect(result).toContain("first result snippet")
      expect(result).toContain("2.")
      expect(result).toContain("**Example Page Two**")
      expect(result).toContain("https://example.com/page2")
    })

    it("strips HTML from result snippets", async () => {
      mockFetch.mockResolvedValue(new Response(MOCK_DDG_HTML))
      const tools = await getTools()
      const result = (await tools.web_search.execute(
        { query: "test query" },
        {} as never,
      )) as string

      expect(result).not.toContain("<b>")
      expect(result).not.toContain("</b>")
      expect(result).toContain("first result snippet")
    })

    it("returns 'No results found' for empty results", async () => {
      mockFetch.mockResolvedValue(new Response(MOCK_EMPTY_HTML))
      const tools = await getTools()
      const result = (await tools.web_search.execute(
        { query: "nonexistent" },
        {} as never,
      )) as string

      expect(result).toContain("No results found")
    })

    it("returns 'Search unavailable' on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"))
      const tools = await getTools()
      const result = (await tools.web_search.execute(
        { query: "test" },
        {} as never,
      )) as string

      expect(result).toContain("Search unavailable")
    })

    it("URL-encodes special characters in query", async () => {
      mockFetch.mockResolvedValue(new Response(MOCK_DDG_HTML))
      const tools = await getTools()
      await tools.web_search.execute(
        { query: "test query with spaces & symbols" },
        {} as never,
      )

      const calledUrl = (mockFetch.mock.calls[0] as [string])[0]
      expect(calledUrl).toContain("test+query+with+spaces+%26+symbols")
    })

    it("respects maxResults parameter", async () => {
      mockFetch.mockResolvedValue(new Response(MOCK_DDG_HTML))
      const tools = await getTools()
      const result = (await tools.web_search.execute(
        { query: "test", maxResults: 1 },
        {} as never,
      )) as string

      expect(result).toContain("1.")
      expect(result).not.toContain("2.")
    })
  })

  describe("rh_kb_search", () => {
    it("prepends site:access.redhat.com to query", async () => {
      mockFetch.mockResolvedValue(new Response(MOCK_DDG_HTML))
      const tools = await getTools()
      await tools.rh_kb_search.execute(
        { query: "openshift upgrade" },
        {} as never,
      )

      const calledUrl = (mockFetch.mock.calls[0] as [string])[0]
      expect(calledUrl).toContain("site%3Aaccess.redhat.com")
      expect(calledUrl).toContain("openshift+upgrade")
    })

    it("returns formatted results", async () => {
      mockFetch.mockResolvedValue(new Response(MOCK_DDG_HTML))
      const tools = await getTools()
      const result = (await tools.rh_kb_search.execute(
        { query: "openshift" },
        {} as never,
      )) as string

      expect(result).toContain("1.")
      expect(result).toContain("**Example Page One**")
    })

    it("returns 'No results found' for empty results", async () => {
      mockFetch.mockResolvedValue(new Response(MOCK_EMPTY_HTML))
      const tools = await getTools()
      const result = (await tools.rh_kb_search.execute(
        { query: "nonexistent" },
        {} as never,
      )) as string

      expect(result).toContain("No results found")
    })

    it("returns 'Search unavailable' on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"))
      const tools = await getTools()
      const result = (await tools.rh_kb_search.execute(
        { query: "test" },
        {} as never,
      )) as string

      expect(result).toContain("Search unavailable")
    })
  })
})
