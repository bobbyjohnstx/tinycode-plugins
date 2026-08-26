import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ecosystem-catalog-test-"))
  await mkdir(join(tempDir, "partners"), { recursive: true })
  await mkdir(join(tempDir, "hardware"), { recursive: true })

  await writeFile(
    join(tempDir, "partners", "netapp-storage.txt"),
    "NetApp Trident Storage\nCategory: storage\nPlatform: OCP\nOperator: trident-csi\nCertified: Yes\nSupported OCP: 4.12, 4.13, 4.14\nInstall: OperatorHub",
  )
  await writeFile(
    join(tempDir, "partners", "nvidia-ai.txt"),
    "NVIDIA GPU Operator\nCategory: AI-ML\nPlatform: OCP\nOperator: gpu-operator\nCertified: Yes",
  )
  await writeFile(
    join(tempDir, "hardware", "dell-server.txt"),
    "Dell PowerEdge R750\nCategory: certified hardware\nPlatform: RHEL\nVendor: Dell\nModel: R750\nCertified RHEL: 8.8, 9.2",
  )
  await writeFile(
    join(tempDir, "partners", "palo-alto-security.txt"),
    "Palo Alto Networks Prisma Cloud\nCategory: security\nPlatform: OCP, RHEL",
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

async function getConfiguredTools() {
  return getTools({ catalogPath: tempDir })
}

describe("tinycode-plugin-ecosystem-catalog", () => {
  describe("plugin loading", () => {
    it("loads without error", async () => {
      const tools = await getTools(undefined)
      expect(tools).toBeDefined()
    })

    it("registers all three tools", async () => {
      const tools = await getConfiguredTools()
      expect(tools.ecosystem_search).toBeDefined()
      expect(tools.ecosystem_operator).toBeDefined()
      expect(tools.ecosystem_hardware).toBeDefined()
    })

    it("all tools have descriptions", async () => {
      const tools = await getConfiguredTools()
      expect(tools.ecosystem_search.description).toBeTruthy()
      expect(tools.ecosystem_operator.description).toBeTruthy()
      expect(tools.ecosystem_hardware.description).toBeTruthy()
    })
  })

  describe("unconfigured tools", () => {
    it("ecosystem_search returns unconfigured message", async () => {
      const tools = await getTools(undefined)
      const result = await tools.ecosystem_search.execute(
        { query: "netapp" },
        {} as never,
      )
      expect(result).toContain("not configured")
    })

    it("ecosystem_operator returns unconfigured message", async () => {
      const tools = await getTools(undefined)
      const result = await tools.ecosystem_operator.execute(
        { operatorName: "trident" },
        {} as never,
      )
      expect(result).toContain("not configured")
    })

    it("ecosystem_hardware returns unconfigured message", async () => {
      const tools = await getTools(undefined)
      const result = await tools.ecosystem_hardware.execute(
        { query: "dell" },
        {} as never,
      )
      expect(result).toContain("not configured")
    })
  })

  describe("ecosystem_search", () => {
    it("searches catalog by keyword", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.ecosystem_search.execute(
        { query: "NetApp" },
        {} as never,
      )) as string
      expect(result).toContain("NetApp Trident Storage")
    })

    it("filters by category", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.ecosystem_search.execute(
        { query: "NetApp", category: "storage" },
        {} as never,
      )) as string
      expect(result).toContain("storage")
      expect(result).toContain("NetApp")
    })

    it("filters by platform", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.ecosystem_search.execute(
        { query: "NetApp", platform: "OCP" },
        {} as never,
      )) as string
      expect(result).toContain("NetApp")
      expect(result).toContain("OCP")
    })

    it("returns empty for no matches", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.ecosystem_search.execute(
        { query: "nonexistent-xyz" },
        {} as never,
      )) as string
      expect(result).toContain("No results found")
    })

    it("returns error on failure", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, { catalogPath: "/nonexistent/path/xyz" })
      const tools = hooks.tool!
      const result = (await tools.ecosystem_search.execute(
        { query: "test" },
        {} as never,
      )) as string
      expect(result).toContain("No results found")
    })
  })

  describe("ecosystem_operator", () => {
    it("gets operator details", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.ecosystem_operator.execute(
        { operatorName: "trident-csi" },
        {} as never,
      )) as string
      expect(result).toContain("trident-csi")
      expect(result).toContain("4.12")
      expect(result).toContain("OperatorHub")
      expect(result).toContain("certified")
    })

    it("returns not found for unknown operator", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.ecosystem_operator.execute(
        { operatorName: "nonexistent-operator" },
        {} as never,
      )) as string
      expect(result).toContain("No operator found")
    })
  })

  describe("ecosystem_hardware", () => {
    it("searches hardware", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.ecosystem_hardware.execute(
        { query: "Dell" },
        {} as never,
      )) as string
      expect(result).toContain("Dell")
      expect(result).toContain("R750")
    })

    it("returns empty for no hardware matches", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.ecosystem_hardware.execute(
        { query: "nonexistent-hardware-xyz" },
        {} as never,
      )) as string
      expect(result).toContain("No hardware results found")
    })
  })
})
