import { describe, it, expect } from "bun:test"

describe("auth module", () => {
  it("exports cleanly (tokenManager singleton removed per #49)", async () => {
    const mod = await import("../src/auth")
    expect(mod).toBeDefined()
  })
})
