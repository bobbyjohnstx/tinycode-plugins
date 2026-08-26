import { describe, it, expect } from "bun:test"
import { createMockShell, createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import { createLintTools } from "../src/lint-tools"
import plugin from "../src/index"

function lintTool(commands: Parameters<typeof createMockShell>[0]) {
  const $ = createMockShell(commands)
  const tools = createLintTools($)
  return tools.aap_lint_playbook
}

const sampleViolations = [
  {
    type: "issue",
    check_name: "yaml[truthy]",
    categories: ["formatting"],
    severity: "minor",
    description: "Truthy value should be one of [false, true]",
    fingerprint: "abc123",
    location: { path: "playbook.yml", lines: { begin: 5, end: 5 } },
    content: { body: "" },
  },
  {
    type: "issue",
    check_name: "no-changed-when",
    categories: ["idempotency"],
    severity: "major",
    description: "Commands should not change things if nothing needs doing",
    fingerprint: "def456",
    location: { path: "playbook.yml", lines: { begin: 12, end: 12 } },
    content: { body: "" },
  },
  {
    type: "issue",
    check_name: "syntax-check[specific]",
    categories: ["syntax"],
    severity: "blocker",
    description: "Syntax error in playbook",
    fingerprint: "ghi789",
    location: { path: "playbook.yml", lines: { begin: 1, end: 1 } },
    content: { body: "" },
  },
]

describe("aap_lint_playbook", () => {
  it("returns install message when ansible-lint is not installed", async () => {
    const tool = lintTool([
      { match: "which ansible-lint", output: "", exitCode: 1 },
    ])
    const result = await tool.execute({ filePath: "playbook.yml" }, {} as never)
    expect(result).toContain("ansible-lint not found")
    expect(result).toContain("pip install ansible-lint")
  })

  it("returns success message when playbook passes all checks", async () => {
    const tool = lintTool([
      { match: "which ansible-lint", output: "/usr/bin/ansible-lint", exitCode: 0 },
      { match: "ansible-lint", output: "", exitCode: 0 },
    ])
    const result = await tool.execute({ filePath: "site.yml" }, {} as never)
    expect(result).toContain("passed all lint checks")
    expect(result).toContain("site.yml")
    expect(result).toContain("production")
  })

  it("formats violations from JSON output on exit code 2", async () => {
    const tool = lintTool([
      { match: "which ansible-lint", output: "/usr/bin/ansible-lint", exitCode: 0 },
      { match: "ansible-lint", output: JSON.stringify(sampleViolations), exitCode: 2 },
    ])
    const result = await tool.execute({ filePath: "playbook.yml" }, {} as never)
    expect(result).toContain("Violations found: 3")
    expect(result).toContain("[minor] yaml[truthy] at playbook.yml:5")
    expect(result).toContain("Truthy value should be one of [false, true]")
    expect(result).toContain("[major] no-changed-when at playbook.yml:12")
    expect(result).toContain("[blocker] syntax-check[specific] at playbook.yml:1")
  })

  it("returns error message on fatal error (exit code 1, non-JSON output)", async () => {
    const tool = lintTool([
      { match: "which ansible-lint", output: "/usr/bin/ansible-lint", exitCode: 0 },
      { match: "ansible-lint", output: "ERROR: file not found: missing.yml", exitCode: 1 },
    ])
    const result = await tool.execute({ filePath: "missing.yml" }, {} as never)
    expect(result).toContain("ansible-lint error")
    expect(result).toContain("file not found")
  })

  it("handles JSON parse failure gracefully", async () => {
    const tool = lintTool([
      { match: "which ansible-lint", output: "/usr/bin/ansible-lint", exitCode: 0 },
      { match: "ansible-lint", output: "not valid json", exitCode: 2 },
    ])
    const result = await tool.execute({ filePath: "playbook.yml" }, {} as never)
    expect(result).toContain("Lint failed:")
  })

  it("uses custom profile when provided", async () => {
    const tool = lintTool([
      { match: "which ansible-lint", output: "/usr/bin/ansible-lint", exitCode: 0 },
      { match: "ansible-lint", output: "", exitCode: 0 },
    ])
    const result = await tool.execute({ filePath: "playbook.yml", profile: "safety" }, {} as never)
    expect(result).toContain("passed all lint checks")
    expect(result).toContain("safety")
  })

  it("defaults to production profile", async () => {
    const tool = lintTool([
      { match: "which ansible-lint", output: "/usr/bin/ansible-lint", exitCode: 0 },
      { match: "ansible-lint", output: "", exitCode: 0 },
    ])
    const result = await tool.execute({ filePath: "playbook.yml" }, {} as never)
    expect(result).toContain("production")
  })

  it("formats single violation correctly", async () => {
    const singleViolation = [sampleViolations[0]]
    const tool = lintTool([
      { match: "which ansible-lint", output: "/usr/bin/ansible-lint", exitCode: 0 },
      { match: "ansible-lint", output: JSON.stringify(singleViolation), exitCode: 2 },
    ])
    const result = await tool.execute({ filePath: "playbook.yml" }, {} as never)
    expect(result).toContain("Violations found: 1")
    expect(result).toContain("[minor] yaml[truthy] at playbook.yml:5")
  })

  it("includes profile in violations output", async () => {
    const singleViolation = [sampleViolations[0]]
    const tool = lintTool([
      { match: "which ansible-lint", output: "/usr/bin/ansible-lint", exitCode: 0 },
      { match: "ansible-lint", output: JSON.stringify(singleViolation), exitCode: 2 },
    ])
    const result = await tool.execute({ filePath: "playbook.yml", profile: "shared" }, {} as never)
    expect(result).toContain("(profile: shared)")
  })
})

describe("lint tool registration in plugin", () => {
  it("registers aap_lint_playbook when AAP controller is not configured", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks.tool!.aap_lint_playbook).toBeDefined()
  })

  it("registers aap_lint_playbook when AAP controller is configured", async () => {
    globalThis.fetch = (() => Promise.resolve(new Response("{}"))) as unknown as typeof fetch
    const input = createMockInput()
    const hooks = await plugin.server(input, {
      controllerUrl: "https://controller.example.com",
      oauthToken: "test-token",
    })
    expect(hooks.tool!.aap_lint_playbook).toBeDefined()
  })
})
