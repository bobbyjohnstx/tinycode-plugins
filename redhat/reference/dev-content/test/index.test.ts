import { describe, it, expect, afterEach } from "bun:test"
import plugin from "../src/index"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetchResponse(handler: (url: string) => { ok: boolean; text: string }) {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const result = handler(url)
    return Promise.resolve(
      new Response(result.text, {
        status: result.ok ? 200 : 404,
        headers: { "content-type": "text/html" },
      }),
    )
  }) as typeof fetch
}

async function getTools() {
  const hooks = await plugin.server()
  return hooks.tool!
}

describe("tinycode-plugin-rh-dev-content", () => {
  describe("plugin loading", () => {
    it("exports server function", () => {
      expect(plugin.server).toBeFunction()
    })

    it("returns all three tools", async () => {
      const tools = await getTools()
      expect(tools).toBeDefined()
      expect(tools.rh_dev_search).toBeDefined()
      expect(tools.rh_dev_article).toBeDefined()
      expect(tools.rh_dev_recent).toBeDefined()
    })
  })

  describe("tool descriptions", () => {
    it("all tools have descriptions", async () => {
      const tools = await getTools()
      expect(tools.rh_dev_search.description).toBeTruthy()
      expect(tools.rh_dev_article.description).toBeTruthy()
      expect(tools.rh_dev_recent.description).toBeTruthy()
    })
  })

  describe("rh_dev_search", () => {
    it("returns articles for valid topic", async () => {
      mockFetchResponse(() => ({
        ok: true,
        text: `<html><body>
          <a href="/articles/2026/quarkus-guide">Quarkus Getting Started Guide for Developers</a>
          <a href="/articles/2026/quarkus-reactive">Building Reactive Apps with Quarkus Framework</a>
        </body></html>`,
      }))
      const tools = await getTools()
      const result = (await tools.rh_dev_search.execute(
        { topic: "kubernetes" },
        {} as never,
      )) as string
      expect(result).toContain('Articles on "kubernetes"')
      expect(result).toContain("Quarkus Getting Started Guide for Developers")
    })

    it("rejects unknown topics", async () => {
      const tools = await getTools()
      const result = (await tools.rh_dev_search.execute(
        { topic: "nonexistent" },
        {} as never,
      )) as string
      expect(result).toContain("Unknown topic")
      expect(result).toContain("Available topics")
    })

    it("returns no articles when page has no matching links", async () => {
      mockFetchResponse(() => ({
        ok: true,
        text: "<html><body>No content here</body></html>",
      }))
      const tools = await getTools()
      const result = (await tools.rh_dev_search.execute(
        { topic: "kubernetes" },
        {} as never,
      )) as string
      expect(result).toContain("No articles found")
    })

    it("handles fetch errors gracefully", async () => {
      mockFetchResponse(() => ({ ok: false, text: "Server Error" }))
      const tools = await getTools()
      const result = (await tools.rh_dev_search.execute(
        { topic: "kubernetes" },
        {} as never,
      )) as string
      expect(result).toContain("Search failed")
    })
  })

  describe("rh_dev_article", () => {
    it("returns article content and metadata", async () => {
      mockFetchResponse(() => ({
        ok: true,
        text: `<html>
          <head><title>Quarkus Guide</title><meta name="author" content="Jane Doe"></head>
          <body><article><h1>Quarkus Guide</h1><p>Build your first app.</p></article></body>
        </html>`,
      }))
      const tools = await getTools()
      const result = (await tools.rh_dev_article.execute(
        { url: "https://developers.redhat.com/articles/2026/quarkus-guide" },
        {} as never,
      )) as string
      expect(result).toContain("Quarkus Guide")
      expect(result).toContain("Build your first app")
      expect(result).toContain("Jane Doe")
    })

    it("returns error for failed fetch", async () => {
      mockFetchResponse(() => ({ ok: false, text: "Not Found" }))
      const tools = await getTools()
      const result = (await tools.rh_dev_article.execute(
        { url: "https://developers.redhat.com/articles/nonexistent" },
        {} as never,
      )) as string
      expect(result).toContain("Failed to read article")
    })
  })

  describe("rh_dev_recent", () => {
    it("returns recent articles from RSS feed", async () => {
      mockFetchResponse(() => ({
        ok: true,
        text: `<?xml version="1.0"?>
        <rss><channel>
          <item>
            <title><![CDATA[Getting Started with OpenShift]]></title>
            <link>https://developers.redhat.com/articles/2026/openshift-start</link>
            <pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate>
            <dc:creator><![CDATA[Jane Doe]]></dc:creator>
          </item>
          <item>
            <title><![CDATA[Kubernetes Best Practices]]></title>
            <link>https://developers.redhat.com/articles/2026/k8s-practices</link>
            <pubDate>Tue, 02 Jan 2026 00:00:00 GMT</pubDate>
          </item>
        </channel></rss>`,
      }))
      const tools = await getTools()
      const result = (await tools.rh_dev_recent.execute({}, {} as never)) as string
      expect(result).toContain("Recent Red Hat developer articles")
      expect(result).toContain("Getting Started with OpenShift")
      expect(result).toContain("Kubernetes Best Practices")
      expect(result).toContain("Jane Doe")
    })

    it("respects limit parameter", async () => {
      mockFetchResponse(() => ({
        ok: true,
        text: `<?xml version="1.0"?>
        <rss><channel>
          <item><title>Article 1</title><link>https://example.com/1</link></item>
          <item><title>Article 2</title><link>https://example.com/2</link></item>
          <item><title>Article 3</title><link>https://example.com/3</link></item>
        </channel></rss>`,
      }))
      const tools = await getTools()
      const result = (await tools.rh_dev_recent.execute({ limit: 1 }, {} as never)) as string
      expect(result).toContain("Article 1")
      expect(result).not.toContain("Article 2")
    })

    it("handles fetch errors gracefully", async () => {
      mockFetchResponse(() => ({ ok: false, text: "Server Error" }))
      const tools = await getTools()
      const result = (await tools.rh_dev_recent.execute({}, {} as never)) as string
      expect(result).toContain("Failed to fetch recent articles")
    })
  })
})
