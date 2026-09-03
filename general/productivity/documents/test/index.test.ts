import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { ToolDefinition, ToolContext } from "tinycode-plugin"
import plugin from "../src/index"

function createMockToolContext(overrides: Partial<ToolContext>): ToolContext {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
    progress: () => {},
    messages: async () => Object.freeze([]),
    sessionInfo: async () => Object.freeze({ id: "test-session", model: "test-model", agent: "test-agent" }),
    ...overrides,
  }
}

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "doc-integration-"))
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function getTools(): Promise<Record<string, ToolDefinition>> {
  const hooks = await plugin.server({} as never, undefined)
  return hooks.tool!
}

describe("tinycode-plugin-gen-documents", () => {
  describe("plugin registration", () => {
    it("registers exactly three tools", async () => {
      const tools = await getTools()
      expect(Object.keys(tools).sort()).toEqual([
        "convert_document",
        "read_document",
        "write_document",
      ])
    })

    it("all tools have descriptions", async () => {
      const tools = await getTools()
      expect(tools.read_document!.description).toBeTruthy()
      expect(tools.write_document!.description).toBeTruthy()
      expect(tools.convert_document!.description).toBeTruthy()
    })
  })

  describe("tool args", () => {
    it("read_document has path arg", async () => {
      const tools = await getTools()
      expect(tools.read_document!.args).toHaveProperty("path")
    })

    it("write_document has path and operations args", async () => {
      const tools = await getTools()
      expect(tools.write_document!.args).toHaveProperty("path")
      expect(tools.write_document!.args).toHaveProperty("operations")
    })

    it("convert_document has input, output, and format args", async () => {
      const tools = await getTools()
      expect(tools.convert_document!.args).toHaveProperty("input")
      expect(tools.convert_document!.args).toHaveProperty("output")
      expect(tools.convert_document!.args).toHaveProperty("format")
    })
  })

  describe("permission gates", () => {
    it("read_document does NOT call context.ask", async () => {
      let askCalled = false
      const ctx = createMockToolContext({
        directory: tempDir,
        ask: async () => {
          askCalled = true
        },
      })

      const tools = await getTools()
      // Create a text file for read to succeed on
      const { writeFile } = await import("node:fs/promises")
      await writeFile(join(tempDir, "read-gate.txt"), "content")

      await tools.read_document!.execute({ path: "read-gate.txt" }, ctx)
      expect(askCalled).toBe(false)
    })

    it("write_document calls context.ask", async () => {
      let askCalled = false
      const ctx = createMockToolContext({
        directory: tempDir,
        ask: async () => {
          askCalled = true
        },
      })

      const tools = await getTools()
      await tools.write_document!.execute(
        {
          path: "write-gate.txt",
          operations: JSON.stringify([{ type: "replace_content", text: "hello" }]),
        },
        ctx,
      )
      expect(askCalled).toBe(true)
    })

    it("convert_document calls context.ask", async () => {
      let askCalled = false
      const ctx = createMockToolContext({
        directory: tempDir,
        ask: async () => {
          askCalled = true
        },
      })

      // Create a CSV file to convert
      const { writeFile } = await import("node:fs/promises")
      await writeFile(join(tempDir, "convert-gate.csv"), "A,B\n1,2\n")

      const tools = await getTools()
      await tools.convert_document!.execute(
        { input: "convert-gate.csv", output: "convert-gate.json", format: "json" },
        ctx,
      )
      expect(askCalled).toBe(true)
    })
  })

  describe("end-to-end flow", () => {
    it("write -> read -> convert an Excel file", async () => {
      const ctx = createMockToolContext({
        directory: tempDir,
        ask: async () => {},
      })

      const tools = await getTools()

      // 1. Create an Excel file via write_document
      const writeResult = await tools.write_document!.execute(
        {
          path: "e2e-test.xlsx",
          operations: JSON.stringify([
            { type: "append_row", values: ["Name", "Score"] },
            { type: "append_row", values: ["Alice", 95] },
            { type: "append_row", values: ["Bob", 87] },
          ]),
        },
        ctx,
      )
      expect(typeof writeResult === "string" ? writeResult : writeResult.output).toContain(
        "Appended row",
      )

      // 2. Read it back via read_document
      const readResult = (await tools.read_document!.execute(
        { path: "e2e-test.xlsx" },
        ctx,
      )) as string
      expect(readResult).toContain("=== Sheet:")
      expect(readResult).toContain("Name | Score")
      expect(readResult).toContain("Alice | 95")

      // 3. Convert to JSON via convert_document
      const convertResult = (await tools.convert_document!.execute(
        { input: "e2e-test.xlsx", output: "e2e-test.json", format: "json" },
        ctx,
      )) as string
      expect(convertResult).toContain("JSON")

      const jsonContent = await readFile(join(tempDir, "e2e-test.json"), "utf-8")
      const data = JSON.parse(jsonContent)
      expect(data.sheets).toBeDefined()
      const sheetName = Object.keys(data.sheets)[0]!
      expect(data.sheets[sheetName][0].Name).toBe("Alice")
    })
  })
})
