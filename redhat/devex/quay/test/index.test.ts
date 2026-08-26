import { describe, it, expect } from "bun:test"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

describe("tinycode-plugin-quay", () => {
  it("loads without error", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks).toBeDefined()
  })
})
