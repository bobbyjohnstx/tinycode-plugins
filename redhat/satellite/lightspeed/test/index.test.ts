import { describe, it, expect, afterEach } from "bun:test"
import { createMockInput, createMockFetch } from "tinycode-plugin-redhat-shared/test-utils"
import type { MockRoute } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const satelliteUrl = "https://satellite.example.com"
const token = "test-satellite-token"
const configuredOptions = { satelliteUrl, token }

function setupFetch(routes: MockRoute[]) {
  globalThis.fetch = createMockFetch(routes)
}

async function getTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

describe("tinycode-plugin-satellite-lightspeed", () => {
  describe("plugin loading", () => {
    it("loads without options and returns tools", async () => {
      const tools = await getTools(undefined)
      expect(tools).toBeDefined()
      expect(tools.satellite_query).toBeDefined()
      expect(tools.satellite_hosts).toBeDefined()
      expect(tools.satellite_errata).toBeDefined()
      expect(tools.satellite_content_views).toBeDefined()
    })

    it("returns config-needed message when no options provided", async () => {
      const tools = await getTools(undefined)
      const result = await tools.satellite_query.execute({ question: "test" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("returns config-needed message when token missing", async () => {
      const tools = await getTools({ satelliteUrl })
      const result = await tools.satellite_query.execute({ question: "test" }, {} as never)
      expect(result).toContain("not configured")
    })
  })

  describe("unconfigured tools return config message", () => {
    it("satellite_hosts returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.satellite_hosts.execute({}, {} as never)
      expect(result).toContain("not configured")
    })

    it("satellite_errata returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.satellite_errata.execute({}, {} as never)
      expect(result).toContain("not configured")
    })

    it("satellite_content_views returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.satellite_content_views.execute({}, {} as never)
      expect(result).toContain("not configured")
    })
  })

  describe("satellite_query", () => {
    it("returns Lightspeed answer on success", async () => {
      setupFetch([
        {
          method: "POST",
          path: "/api/v2/lightspeed/chats",
          body: { answer: "To manage RHEL hosts, use the Hosts page in Satellite." },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.satellite_query.execute({ question: "How do I manage hosts?" }, {} as never)
      expect(result).toContain("To manage RHEL hosts")
      expect(result).toContain("Hosts page in Satellite")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "POST", path: "/api/v2/lightspeed/chats", status: 500, body: { error: "Internal error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.satellite_query.execute({ question: "test" }, {} as never)
      expect(result).toContain("Failed to query Lightspeed")
    })
  })

  describe("satellite_hosts", () => {
    it("returns formatted host list on success", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v2/hosts",
          body: {
            total: 2,
            results: [
              { id: 1, name: "web01.example.com", operatingsystem_name: "RHEL 9.2", environment_name: "production", global_status_label: "OK" },
              { id: 2, name: "db01.example.com", operatingsystem_name: "RHEL 8.8", environment_name: "staging", global_status_label: "Warning" },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.satellite_hosts.execute({}, {} as never)
      expect(result).toContain("Hosts: 2")
      expect(result).toContain("web01.example.com")
      expect(result).toContain("RHEL 9.2")
      expect(result).toContain("[production]")
      expect(result).toContain("OK")
      expect(result).toContain("db01.example.com")
      expect(result).toContain("[staging]")
    })

    it("returns no-hosts message when empty", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/hosts", body: { total: 0, results: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.satellite_hosts.execute({}, {} as never)
      expect(result).toContain("No hosts found")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/hosts", status: 500, body: { error: "error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.satellite_hosts.execute({}, {} as never)
      expect(result).toContain("Failed to list hosts")
    })
  })

  describe("satellite_errata", () => {
    it("returns formatted errata list on success", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v2/errata",
          body: {
            total: 2,
            results: [
              { errata_id: "RHSA-2025:001", title: "Critical kernel update", type: "security", severity: "Critical" },
              { errata_id: "RHBA-2025:002", title: "Bash bug fix", type: "bugfix", severity: "Moderate" },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.satellite_errata.execute({}, {} as never)
      expect(result).toContain("Errata: 2")
      expect(result).toContain("RHSA-2025:001")
      expect(result).toContain("Critical kernel update")
      expect(result).toContain("[security]")
      expect(result).toContain("(Critical)")
      expect(result).toContain("RHBA-2025:002")
      expect(result).toContain("[bugfix]")
    })

    it("returns no-errata message when empty", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/errata", body: { total: 0, results: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.satellite_errata.execute({}, {} as never)
      expect(result).toContain("No errata found")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/errata", status: 500, body: { error: "error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.satellite_errata.execute({}, {} as never)
      expect(result).toContain("Failed to list errata")
    })
  })

  describe("satellite_content_views", () => {
    it("returns formatted content view list on success", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v2/content_views",
          body: {
            total: 2,
            results: [
              { id: 1, name: "RHEL Base", label: "rhel_base", composite: false, last_published: "2025-06-15T12:00:00Z" },
              { id: 2, name: "App Stack", label: "app_stack", composite: true, last_published: "2025-07-01T08:30:00Z" },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.satellite_content_views.execute({}, {} as never)
      expect(result).toContain("Content views: 2")
      expect(result).toContain("RHEL Base")
      expect(result).toContain("(rhel_base)")
      expect(result).toContain("App Stack")
      expect(result).toContain("[composite]")
      expect(result).toContain("last published:")
    })

    it("returns no-content-views message when empty", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/content_views", body: { total: 0, results: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.satellite_content_views.execute({}, {} as never)
      expect(result).toContain("No content views found")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/content_views", status: 500, body: { error: "error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.satellite_content_views.execute({}, {} as never)
      expect(result).toContain("Failed to list content views")
    })
  })
})
