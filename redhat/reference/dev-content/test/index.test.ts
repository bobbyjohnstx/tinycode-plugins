import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createMockInput, createMockShell } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "rh-dev-content-test-"))
  await mkdir(join(tempDir, "articles"), { recursive: true })
  await mkdir(join(tempDir, "cheatsheets"), { recursive: true })
  await mkdir(join(tempDir, "learning-paths"), { recursive: true })
  await writeFile(
    join(tempDir, "articles", "quarkus-guide.txt"),
    "Quarkus Getting Started\nBuild your first Quarkus app with this guide.",
  )
  await writeFile(
    join(tempDir, "cheatsheets", "podman-cheatsheet.txt"),
    "Podman Cheatsheet\nCommon podman commands for container management.",
  )
  await writeFile(
    join(tempDir, "learning-paths", "kubernetes-basics.txt"),
    "Kubernetes Learning Path\nModule 1: Pods and Deployments.",
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
  return getTools({ contentPath: tempDir })
}

describe("tinycode-plugin-rh-dev-content", () => {
  describe("plugin loading", () => {
    it("loads without error when no options provided", async () => {
      const tools = await getTools(undefined)
      expect(tools).toBeDefined()
      expect(tools.rh_dev_search).toBeDefined()
      expect(tools.rh_dev_article).toBeDefined()
      expect(tools.rh_dev_cheatsheet).toBeDefined()
      expect(tools.rh_dev_learning_path).toBeDefined()
    })

    it("loads with valid options and returns configured tools", async () => {
      const tools = await getConfiguredTools()
      expect(tools).toBeDefined()
      expect(tools.rh_dev_search).toBeDefined()
    })
  })

  describe("tool descriptions", () => {
    it("all tools have descriptions", async () => {
      const tools = await getConfiguredTools()
      expect(tools.rh_dev_search.description).toBeTruthy()
      expect(tools.rh_dev_article.description).toBeTruthy()
      expect(tools.rh_dev_cheatsheet.description).toBeTruthy()
      expect(tools.rh_dev_learning_path.description).toBeTruthy()
    })
  })

  describe("unconfigured tools", () => {
    it("rh_dev_search returns not-configured message", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rh_dev_search.execute({ query: "quarkus" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("rh_dev_article returns not-configured message", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rh_dev_article.execute({ path: "test.txt" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("rh_dev_cheatsheet returns not-configured message", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rh_dev_cheatsheet.execute({ topic: "podman" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("rh_dev_learning_path returns not-configured message", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rh_dev_learning_path.execute(
        { topic: "kubernetes" },
        {} as never,
      )
      expect(result).toContain("not configured")
    })
  })

  describe("rh_dev_search", () => {
    it("returns results matching query", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.rh_dev_search.execute(
        { query: "quarkus" },
        {} as never,
      )) as string
      expect(result).toContain("Quarkus Getting Started")
      expect(result).toContain("[ARTICLE]")
    })

    it("returns no results for unmatched query", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.rh_dev_search.execute(
        { query: "nonexistent" },
        {} as never,
      )) as string
      expect(result).toContain("No results found")
    })

    it("filters by type when specified", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.rh_dev_search.execute(
        { query: "podman", type: "cheatsheet" },
        {} as never,
      )) as string
      expect(result).toContain("[CHEATSHEET]")
      expect(result).not.toContain("[ARTICLE]")
    })

    it("excludes non-matching types", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.rh_dev_search.execute(
        { query: "quarkus", type: "cheatsheet" },
        {} as never,
      )) as string
      expect(result).toContain("No results found")
    })
  })

  describe("rh_dev_article", () => {
    it("returns full content for valid path", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.rh_dev_article.execute(
        { path: "articles/quarkus-guide.txt" },
        {} as never,
      )) as string
      expect(result).toContain("Quarkus Getting Started")
      expect(result).toContain("Build your first Quarkus app")
    })

    it("returns error for invalid path", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.rh_dev_article.execute(
        { path: "nonexistent/file.txt" },
        {} as never,
      )) as string
      expect(result).toContain("Failed to read article")
    })
  })

  describe("rh_dev_cheatsheet", () => {
    it("returns cheatsheet results for matching topic", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.rh_dev_cheatsheet.execute(
        { topic: "podman" },
        {} as never,
      )) as string
      expect(result).toContain("Podman Cheatsheet")
      expect(result).toContain("[CHEATSHEET]")
    })

    it("returns no results when no cheatsheets match", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.rh_dev_cheatsheet.execute(
        { topic: "nonexistent" },
        {} as never,
      )) as string
      expect(result).toContain("No results found")
    })
  })

  describe("rh_dev_learning_path", () => {
    it("returns learning path results for matching topic", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.rh_dev_learning_path.execute(
        { topic: "kubernetes" },
        {} as never,
      )) as string
      expect(result).toContain("Kubernetes Learning Path")
      expect(result).toContain("[LEARNING PATH]")
    })

    it("returns no results when no learning paths match", async () => {
      const tools = await getConfiguredTools()
      const result = (await tools.rh_dev_learning_path.execute(
        { topic: "nonexistent" },
        {} as never,
      )) as string
      expect(result).toContain("No results found")
    })
  })

  describe("system transform hook", () => {
    it("injects framework context when detected", async () => {
      const shell = createMockShell([
        { match: "ls -1", output: "pom.xml\nsrc\nREADME.md" },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, { contentPath: tempDir })

      const sessionStart = hooks["session.start"] as (
        event: unknown,
        output: unknown,
      ) => Promise<void>
      await sessionStart({}, {})

      const transform = hooks["experimental.chat.system.transform"] as (
        event: unknown,
        output: { system: string[] },
      ) => Promise<void>
      const output = { system: [] as string[] }
      await transform({}, output)

      expect(output.system.length).toBe(1)
      expect(output.system[0]).toContain("detected-framework: java")
      expect(output.system[0]).toContain("<rh-dev-content>")
    })

    it("omits framework when not detected", async () => {
      const shell = createMockShell([
        { match: "ls -1", output: "README.md\nLICENSE" },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, { contentPath: tempDir })

      const sessionStart = hooks["session.start"] as (
        event: unknown,
        output: unknown,
      ) => Promise<void>
      await sessionStart({}, {})

      const transform = hooks["experimental.chat.system.transform"] as (
        event: unknown,
        output: { system: string[] },
      ) => Promise<void>
      const output = { system: [] as string[] }
      await transform({}, output)

      expect(output.system[0]).not.toContain("detected-framework")
    })

    it("is not present when contentPath not configured", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      expect(hooks["experimental.chat.system.transform"]).toBeUndefined()
    })
  })
})
