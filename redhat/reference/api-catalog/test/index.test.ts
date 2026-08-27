import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"
import { API_CATALOG, searchCatalog, parseOpenApiEndpoints } from "../src/catalog-client"

let tempDir: string

const mockSpec = {
  openapi: "3.0.0",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/reports": {
      get: {
        summary: "List cost reports",
        parameters: [
          { name: "limit", in: "query" },
          { name: "offset", in: "query" },
        ],
      },
      post: {
        summary: "Create a report",
        parameters: [],
      },
    },
    "/reports/{id}": {
      get: {
        summary: "Get report by ID",
        parameters: [{ name: "id", in: "path" }],
      },
      delete: {
        description: "Delete a report",
        parameters: [{ name: "id", in: "path" }],
      },
    },
  },
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "api-catalog-test-"))
  await mkdir(tempDir, { recursive: true })
  await writeFile(
    join(tempDir, "cost-management.json"),
    JSON.stringify(mockSpec),
  )
})

afterAll(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

async function getTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

describe("tinycode-plugin-rh-api-catalog", () => {
  describe("plugin loading", () => {
    it("loads without error", async () => {
      const tools = await getTools(undefined)
      expect(tools).toBeDefined()
    })

    it("registers all three tools", async () => {
      const tools = await getTools(undefined)
      expect(tools.rh_api_list).toBeDefined()
      expect(tools.rh_api_spec).toBeDefined()
      expect(tools.rh_api_endpoints).toBeDefined()
    })

    it("all tools have descriptions", async () => {
      const tools = await getTools(undefined)
      expect(tools.rh_api_list.description).toBeTruthy()
      expect(tools.rh_api_spec.description).toBeTruthy()
      expect(tools.rh_api_endpoints.description).toBeTruthy()
    })
  })

  describe("rh_api_list", () => {
    it("lists all APIs with platform tags", async () => {
      const tools = await getTools(undefined)
      const result = (await tools.rh_api_list.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("cost-management")
      expect(result).toContain("insights")
      expect(result).toContain("vulnerability")
      expect(result).toContain("[both]")
      expect(result).toContain("[rhel]")
      expect(result).toContain("[ocp]")
    })

    it("filters by search term", async () => {
      const tools = await getTools(undefined)
      const result = (await tools.rh_api_list.execute(
        { search: "cost" },
        {} as never,
      )) as string
      expect(result).toContain("cost-management")
      expect(result).not.toContain("rbac")
    })

    it("returns empty for no match", async () => {
      const tools = await getTools(undefined)
      const result = (await tools.rh_api_list.execute(
        { search: "zzzznonexistent" },
        {} as never,
      )) as string
      expect(result).toContain("No APIs found")
    })

    it("always works even unconfigured", async () => {
      const tools = await getTools(undefined)
      const result = (await tools.rh_api_list.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("cost-management")
    })
  })

  describe("rh_api_spec", () => {
    it("returns spec from local cache", async () => {
      const tools = await getTools({ catalogPath: tempDir })
      const result = (await tools.rh_api_spec.execute(
        { api: "cost-management" },
        {} as never,
      )) as string
      expect(result).toContain("openapi")
      expect(result).toContain("3.0.0")
      expect(result).toContain("/reports")
    })

    it("returns not available when unconfigured and no cache", async () => {
      const tools = await getTools(undefined)
      const result = (await tools.rh_api_spec.execute(
        { api: "cost-management" },
        {} as never,
      )) as string
      expect(result).toContain("not available")
    })

    it("handles missing spec file gracefully", async () => {
      const tools = await getTools({ catalogPath: tempDir })
      const result = (await tools.rh_api_spec.execute(
        { api: "insights" },
        {} as never,
      )) as string
      expect(result).toContain("not available")
    })
  })

  describe("rh_api_endpoints", () => {
    it("lists endpoints from cached spec", async () => {
      const tools = await getTools({ catalogPath: tempDir })
      const result = (await tools.rh_api_endpoints.execute(
        { api: "cost-management" },
        {} as never,
      )) as string
      expect(result).toContain("GET /reports")
      expect(result).toContain("POST /reports")
      expect(result).toContain("List cost reports")
    })

    it("filters endpoints by search", async () => {
      const tools = await getTools({ catalogPath: tempDir })
      const result = (await tools.rh_api_endpoints.execute(
        { api: "cost-management", search: "delete" },
        {} as never,
      )) as string
      expect(result).toContain("DELETE")
      expect(result).not.toContain("POST")
    })

    it("returns not available when unconfigured", async () => {
      const tools = await getTools(undefined)
      const result = (await tools.rh_api_endpoints.execute(
        { api: "cost-management" },
        {} as never,
      )) as string
      expect(result).toContain("not available")
    })
  })

  describe("catalog-client", () => {
    it("every API_CATALOG entry has a valid platform field", () => {
      const validPlatforms = ["ocp", "rhel", "both"]
      for (const entry of API_CATALOG) {
        expect(validPlatforms).toContain(entry.platform)
      }
    })

    it("searchCatalog for ocp returns ocp-vulnerability and gathering", () => {
      const results = searchCatalog("ocp")
      expect(results.some((r) => r.name === "ocp-vulnerability")).toBe(true)
      expect(results.some((r) => r.name === "gathering")).toBe(true)
    })

    it("searchCatalog filters correctly", () => {
      const results = searchCatalog("cost")
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe("cost-management")

      const patchResults = searchCatalog("RHEL")
      expect(patchResults.length).toBeGreaterThan(0)
      expect(patchResults.some((r) => r.name === "patch")).toBe(true)
    })

    it("parseOpenApiEndpoints extracts paths", () => {
      const endpoints = parseOpenApiEndpoints(mockSpec)
      expect(endpoints.length).toBe(4)

      const getReports = endpoints.find(
        (e) => e.method === "GET" && e.path === "/reports",
      )
      expect(getReports).toBeDefined()
      expect(getReports!.description).toBe("List cost reports")
      expect(getReports!.params).toEqual(["limit", "offset"])

      const deleteReport = endpoints.find((e) => e.method === "DELETE")
      expect(deleteReport).toBeDefined()
      expect(deleteReport!.params).toEqual(["id"])
    })
  })
})
