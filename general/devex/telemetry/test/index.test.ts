import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput, Hooks } from "tinycode-plugin"

let tmpDir: string

async function loadPlugin(): Promise<Hooks> {
  const input: PluginInput = {
    client: {} as PluginInput["client"],
    project: {
      id: "test-project",
      worktree: "/tmp/test",
      time: { created: Date.now() },
    },
    directory: "/tmp/test",
    worktree: "/tmp/test",
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
  }
  const mod = await import("../src/index")
  return mod.default.server(input, undefined)
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "telemetry-test-"))
  process.env.TELEMETRY_DB = join(tmpDir, "telemetry.db")
})

afterEach(async () => {
  delete process.env.TELEMETRY_DB
  await rm(tmpDir, { recursive: true, force: true })
})

describe("tinycode-plugin-telemetry", () => {
  it("session.start creates a session row in DB", async () => {
    const hooks = await loadPlugin()

    await hooks["session.start"]!({ sessionID: "sess-1" }, {})

    // Verify by running telemetry_report
    const report = (await hooks.tool!.telemetry_report.execute(
      {},
      {} as never,
    )) as string
    expect(report).toContain("Total sessions: 1")
    await hooks.dispose?.()
  })

  it("tool.execute.after buffers a tool call", async () => {
    const hooks = await loadPlugin()

    await hooks["session.start"]!({ sessionID: "sess-2" }, {})
    await hooks["tool.execute.after"]!(
      { tool: "Read", sessionID: "sess-2", callID: "call-1", args: { path: "/foo" } },
      { title: "Read", output: "file content", metadata: {} },
    )

    // Before session.end, tool calls are only in buffer — report should show 0 tool calls
    const reportBefore = (await hooks.tool!.telemetry_report.execute(
      {},
      {} as never,
    )) as string
    expect(reportBefore).toContain("Total tool calls: 0")

    await hooks.dispose?.()
  })

  it("session.end flushes buffer to DB and updates session", async () => {
    const hooks = await loadPlugin()

    await hooks["session.start"]!({ sessionID: "sess-3" }, {})
    await hooks["tool.execute.after"]!(
      { tool: "Read", sessionID: "sess-3", callID: "call-1", args: { path: "/a" } },
      { title: "Read", output: "", metadata: {} },
    )
    await hooks["tool.execute.after"]!(
      { tool: "Edit", sessionID: "sess-3", callID: "call-2", args: { file: "/b" } },
      { title: "Edit", output: "", metadata: {} },
    )
    await hooks["session.end"]!({ sessionID: "sess-3" }, {})

    const report = (await hooks.tool!.telemetry_report.execute(
      {},
      {} as never,
    )) as string
    expect(report).toContain("Total tool calls: 2")
    expect(report).toContain("tools: 2")
    await hooks.dispose?.()
  })

  it("telemetry_report returns formatted summary", async () => {
    const hooks = await loadPlugin()

    await hooks["session.start"]!({ sessionID: "sess-4" }, {})
    await hooks["tool.execute.after"]!(
      { tool: "Read", sessionID: "sess-4", callID: "c1", args: {} },
      { title: "Read", output: "", metadata: {} },
    )
    await hooks["tool.execute.after"]!(
      { tool: "Read", sessionID: "sess-4", callID: "c2", args: {} },
      { title: "Read", output: "", metadata: {} },
    )
    await hooks["tool.execute.after"]!(
      { tool: "Bash", sessionID: "sess-4", callID: "c3", args: {} },
      { title: "Bash", output: "", metadata: {} },
    )
    await hooks["session.end"]!({ sessionID: "sess-4" }, {})

    const report = (await hooks.tool!.telemetry_report.execute(
      {},
      {} as never,
    )) as string

    expect(report).toContain("--- Telemetry Report ---")
    expect(report).toContain("Total sessions: 1")
    expect(report).toContain("Total tool calls: 3")
    expect(report).toContain("Average tool calls per session: 3.0")
    expect(report).toContain("Top 10 tools by call count:")
    expect(report).toContain("Read: 2")
    expect(report).toContain("Bash: 1")
    expect(report).toContain("Last 5 sessions:")
    expect(report).toContain("sess-4")
    await hooks.dispose?.()
  })

  it("telemetry_query filters by tool name", async () => {
    const hooks = await loadPlugin()

    await hooks["session.start"]!({ sessionID: "sess-5" }, {})
    await hooks["tool.execute.after"]!(
      { tool: "Read", sessionID: "sess-5", callID: "c1", args: {} },
      { title: "Read", output: "", metadata: {} },
    )
    await hooks["tool.execute.after"]!(
      { tool: "Edit", sessionID: "sess-5", callID: "c2", args: {} },
      { title: "Edit", output: "", metadata: {} },
    )
    await hooks["session.end"]!({ sessionID: "sess-5" }, {})

    const result = (await hooks.tool!.telemetry_query.execute(
      { tool: "Read" },
      {} as never,
    )) as string

    expect(result).toContain("Read")
    expect(result).not.toContain("Edit")
    expect(result).toContain("1 result(s)")
    await hooks.dispose?.()
  })

  it("telemetry_query filters by days", async () => {
    const hooks = await loadPlugin()

    await hooks["session.start"]!({ sessionID: "sess-6" }, {})
    await hooks["tool.execute.after"]!(
      { tool: "Read", sessionID: "sess-6", callID: "c1", args: {} },
      { title: "Read", output: "", metadata: {} },
    )
    await hooks["session.end"]!({ sessionID: "sess-6" }, {})

    // Recent calls should appear with days=1
    const result = (await hooks.tool!.telemetry_query.execute(
      { days: 1 },
      {} as never,
    )) as string
    expect(result).toContain("1 result(s)")

    // With days=0, nothing should match (cutoff is now)
    const empty = (await hooks.tool!.telemetry_query.execute(
      { days: 0 },
      {} as never,
    )) as string
    expect(empty).toContain("No tool calls found")
    await hooks.dispose?.()
  })

  it("first run creates DB and tables automatically", async () => {
    const hooks = await loadPlugin()

    // Just querying should work without prior session.start
    const report = (await hooks.tool!.telemetry_report.execute(
      {},
      {} as never,
    )) as string
    expect(report).toContain("No telemetry data")
    await hooks.dispose?.()
  })

  it("empty DB returns no telemetry data message", async () => {
    const hooks = await loadPlugin()

    const report = (await hooks.tool!.telemetry_report.execute(
      {},
      {} as never,
    )) as string
    expect(report).toBe("No telemetry data collected yet.")

    const query = (await hooks.tool!.telemetry_query.execute(
      {},
      {} as never,
    )) as string
    expect(query).toContain("No tool calls found")
    await hooks.dispose?.()
  })
})
