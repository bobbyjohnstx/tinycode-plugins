import { describe, it, expect } from "bun:test"
import type { ToolDefinition } from "tinycode-plugin"
import plugin from "../src/index"

async function getTools(): Promise<Record<string, ToolDefinition>> {
  const hooks = await plugin.server({} as never, undefined)
  return hooks.tool!
}

describe("tinycode-plugin-gen-documents", () => {
  it("registers read_document, write_document, and convert_document tools", async () => {
    const tools = await getTools()
    expect(tools.read_document).toBeDefined()
    expect(tools.write_document).toBeDefined()
    expect(tools.convert_document).toBeDefined()
  })

  it("all tools have descriptions", async () => {
    const tools = await getTools()
    expect(tools.read_document.description).toBeTruthy()
    expect(tools.write_document.description).toBeTruthy()
    expect(tools.convert_document.description).toBeTruthy()
  })

  it("tool stubs return not-yet-implemented", async () => {
    const tools = await getTools()
    const result = await tools.read_document.execute({ path: "test.txt" }, {} as never)
    expect(result).toBe("Not yet implemented")
  })
})
