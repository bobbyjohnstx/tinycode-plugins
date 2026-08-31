import { describe, it, expect, afterEach } from "bun:test"
import plugin from "../src/index"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockPyxisResponse(data: unknown) {
  globalThis.fetch = (() => {
    return Promise.resolve(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
  }) as typeof fetch
}

function mockPyxisError(status = 500) {
  globalThis.fetch = (() => {
    return Promise.resolve(
      new Response("Internal Server Error", {
        status,
        headers: { "content-type": "text/plain" },
      }),
    )
  }) as typeof fetch
}

async function getTools() {
  const hooks = await plugin.server()
  return hooks.tool!
}

describe("tinycode-plugin-ecosystem-catalog", () => {
  describe("plugin loading", () => {
    it("exports server function", () => {
      expect(plugin.server).toBeFunction()
    })

    it("registers all three tools", async () => {
      const tools = await getTools()
      expect(tools.ecosystem_search).toBeDefined()
      expect(tools.ecosystem_operator).toBeDefined()
      expect(tools.ecosystem_browse).toBeDefined()
    })

    it("all tools have descriptions", async () => {
      const tools = await getTools()
      expect(tools.ecosystem_search.description).toBeTruthy()
      expect(tools.ecosystem_operator.description).toBeTruthy()
      expect(tools.ecosystem_browse.description).toBeTruthy()
    })
  })

  describe("ecosystem_search", () => {
    it("returns container image results", async () => {
      mockPyxisResponse({
        data: [
          {
            repository: "ubi9",
            registry: "registry.access.redhat.com",
            display_data: {
              name: "Red Hat Universal Base Image 9",
              short_description: "UBI 9 base image",
            },
            application_categories: ["base-image"],
            last_update_date: "2026-01-15T00:00:00Z",
          },
        ],
        page: 0,
        page_size: 10,
        total: 1,
      })
      const tools = await getTools()
      const result = (await tools.ecosystem_search.execute(
        { repository: "ubi9" },
        {} as never,
      )) as string
      expect(result).toContain("ubi9")
      expect(result).toContain("Red Hat Universal Base Image 9")
      expect(result).toContain("base-image")
    })

    it("returns no results for unknown repository", async () => {
      mockPyxisResponse({ data: [], page: 0, page_size: 10, total: 0 })
      const tools = await getTools()
      const result = (await tools.ecosystem_search.execute(
        { repository: "nonexistent-xyz" },
        {} as never,
      )) as string
      expect(result).toContain("No container image found")
    })

    it("handles API errors gracefully", async () => {
      mockPyxisError()
      const tools = await getTools()
      const result = (await tools.ecosystem_search.execute(
        { repository: "ubi9" },
        {} as never,
      )) as string
      expect(result).toContain("Search failed")
    })
  })

  describe("ecosystem_operator", () => {
    it("returns operator details", async () => {
      mockPyxisResponse({
        data: [
          {
            csv_display_name: "AMQ Streams",
            package: "amq-streams",
            version: "2.6.0",
            ocp_version: "v4.12-v4.14",
            organization: "Red Hat",
            channel_name: "stable",
          },
        ],
        page: 0,
        page_size: 5,
        total: 1,
      })
      const tools = await getTools()
      const result = (await tools.ecosystem_operator.execute(
        { package: "amq-streams" },
        {} as never,
      )) as string
      expect(result).toContain("AMQ Streams")
      expect(result).toContain("amq-streams")
      expect(result).toContain("v4.12-v4.14")
      expect(result).toContain("Red Hat")
    })

    it("returns not found for unknown operator", async () => {
      mockPyxisResponse({ data: [], page: 0, page_size: 5, total: 0 })
      const tools = await getTools()
      const result = (await tools.ecosystem_operator.execute(
        { package: "nonexistent" },
        {} as never,
      )) as string
      expect(result).toContain("No operator found")
    })

    it("handles API errors gracefully", async () => {
      mockPyxisError()
      const tools = await getTools()
      const result = (await tools.ecosystem_operator.execute(
        { package: "amq-streams" },
        {} as never,
      )) as string
      expect(result).toContain("Operator lookup failed")
    })
  })

  describe("ecosystem_browse", () => {
    it("browses container images", async () => {
      mockPyxisResponse({
        data: [
          {
            repository: "nodejs-18",
            registry: "registry.access.redhat.com",
            display_data: { name: "Node.js 18" },
            last_update_date: "2026-01-10T00:00:00Z",
          },
        ],
        page: 0,
        page_size: 10,
        total: 100,
      })
      const tools = await getTools()
      const result = (await tools.ecosystem_browse.execute(
        { type: "containers" },
        {} as never,
      )) as string
      expect(result).toContain("certified container images")
      expect(result).toContain("nodejs-18")
      expect(result).toContain("Node.js 18")
    })

    it("browses operator bundles", async () => {
      mockPyxisResponse({
        data: [
          {
            csv_display_name: "Grafana Operator",
            package: "grafana-operator",
            version: "5.0.0",
            ocp_version: "v4.12",
            organization: "Community",
            channel_name: "v5",
          },
        ],
        page: 0,
        page_size: 10,
        total: 50,
      })
      const tools = await getTools()
      const result = (await tools.ecosystem_browse.execute(
        { type: "operators" },
        {} as never,
      )) as string
      expect(result).toContain("operator bundles")
      expect(result).toContain("Grafana Operator")
    })

    it("returns no results when empty", async () => {
      mockPyxisResponse({ data: [], page: 0, page_size: 10, total: 0 })
      const tools = await getTools()
      const result = (await tools.ecosystem_browse.execute(
        { type: "containers" },
        {} as never,
      )) as string
      expect(result).toBe("No results.")
    })

    it("handles API errors gracefully", async () => {
      mockPyxisError()
      const tools = await getTools()
      const result = (await tools.ecosystem_browse.execute(
        { type: "containers" },
        {} as never,
      )) as string
      expect(result).toContain("Browse failed")
    })
  })
})
