import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput, Hooks } from "tinycode-plugin"

let handoffDir: string

async function loadPlugin(dir: string): Promise<Hooks> {
  process.env.HANDOFF_DIR = dir
  // Re-import to pick up new env
  const mod = await import("../src/index")
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
  return mod.default.server(input, undefined)
}

async function writeStateFile(
  dir: string,
  sessionID: string,
  state: Record<string, unknown>,
) {
  const content = JSON.stringify({ sessionID, timestamp: Date.now(), ...state })
  await writeFile(join(dir, `${sessionID}.json`), content, "utf-8")
}

beforeEach(async () => {
  handoffDir = await mkdtemp(join(tmpdir(), "handoff-test-"))
})

afterEach(async () => {
  delete process.env.HANDOFF_DIR
  await rm(handoffDir, { recursive: true, force: true })
})

describe("tinycode-plugin-rh-handoff", () => {
  it("session.end writes state file to handoff directory", async () => {
    const hooks = await loadPlugin(handoffDir)

    await hooks["session.end"]!({ sessionID: "sess-abc" }, {})

    const files = await readdir(handoffDir)
    expect(files).toContain("sess-abc.json")

    const raw = await readFile(join(handoffDir, "sess-abc.json"), "utf-8")
    const state = JSON.parse(raw)
    expect(state.sessionID).toBe("sess-abc")
    expect(state.timestamp).toBeGreaterThan(0)
    expect(state.goal).toBe("")
    expect(state.decisions).toEqual([])
    expect(state.openTasks).toEqual([])
    expect(state.filesModified).toEqual([])
  })

  it("session.start loads most recent state file by timestamp", async () => {
    // Write two state files with different timestamps
    await writeStateFile(handoffDir, "old-sess", {
      timestamp: 1000,
      goal: "old goal",
      decisions: ["old decision"],
      openTasks: [],
      filesModified: [],
    })
    await writeStateFile(handoffDir, "new-sess", {
      timestamp: 2000,
      goal: "new goal",
      decisions: ["new decision"],
      openTasks: ["task1"],
      filesModified: ["file1.ts"],
    })

    const hooks = await loadPlugin(handoffDir)
    await hooks["session.start"]!(
      { sessionID: "current-sess" },
      {},
    )

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!(
      { model: {} as never },
      output,
    )

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toContain("new goal")
    expect(output.system[0]).toContain("new decision")
    expect(output.system[0]).toContain("task1")
    expect(output.system[0]).toContain("file1.ts")
  })

  it("session.start skips own session state file", async () => {
    await writeStateFile(handoffDir, "self-sess", {
      timestamp: 9999,
      goal: "self goal",
      decisions: [],
      openTasks: [],
      filesModified: [],
    })
    await writeStateFile(handoffDir, "other-sess", {
      timestamp: 5000,
      goal: "other goal",
      decisions: ["other decision"],
      openTasks: [],
      filesModified: [],
    })

    const hooks = await loadPlugin(handoffDir)
    await hooks["session.start"]!({ sessionID: "self-sess" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!(
      { model: {} as never },
      output,
    )

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toContain("other goal")
    expect(output.system[0]).not.toContain("self goal")
  })

  it("experimental.chat.system.transform injects loaded state into system prompt", async () => {
    await writeStateFile(handoffDir, "prev-sess", {
      timestamp: 1000,
      goal: "build handoff plugin",
      decisions: ["use JSON files", "store in ~/.tinycode"],
      openTasks: ["write tests", "add validation"],
      filesModified: ["src/index.ts", "test/index.test.ts"],
    })

    const hooks = await loadPlugin(handoffDir)
    await hooks["session.start"]!({ sessionID: "new-sess" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!(
      { model: {} as never },
      output,
    )

    expect(output.system.length).toBe(1)
    const block = output.system[0]!
    expect(block).toContain("<previous-session>")
    expect(block).toContain("Goal: build handoff plugin")
    expect(block).toContain("Key decisions: use JSON files; store in ~/.tinycode")
    expect(block).toContain("Open tasks: write tests; add validation")
    expect(block).toContain("Files modified: src/index.ts, test/index.test.ts")
    expect(block).toContain("</previous-session>")
  })

  it("handoff_save tool updates in-memory state", async () => {
    const hooks = await loadPlugin(handoffDir)

    const result = await hooks.tool!.handoff_save.execute(
      {
        goal: "test goal",
        decisions: ["decision A"],
        openTasks: ["task X"],
        filesModified: ["a.ts"],
      },
      { sessionID: "tool-sess" } as any,
    )

    expect(result).toContain("saved")

    // Now end session to persist
    await hooks["session.end"]!({ sessionID: "tool-sess" }, {})

    const raw = await readFile(join(handoffDir, "tool-sess.json"), "utf-8")
    const state = JSON.parse(raw)
    expect(state.goal).toBe("test goal")
    expect(state.decisions).toEqual(["decision A"])
    expect(state.openTasks).toEqual(["task X"])
    expect(state.filesModified).toEqual(["a.ts"])
  })

  it("no previous state file results in no injection", async () => {
    const hooks = await loadPlugin(handoffDir)
    await hooks["session.start"]!({ sessionID: "fresh-sess" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!(
      { model: {} as never },
      output,
    )

    expect(output.system.length).toBe(0)
  })

  it("corrupted JSON file is skipped gracefully", async () => {
    await writeFile(
      join(handoffDir, "corrupt.json"),
      "not valid json {{{",
      "utf-8",
    )
    await writeStateFile(handoffDir, "good-sess", {
      timestamp: 1000,
      goal: "good goal",
      decisions: [],
      openTasks: [],
      filesModified: [],
    })

    const hooks = await loadPlugin(handoffDir)
    await hooks["session.start"]!({ sessionID: "new-sess" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!(
      { model: {} as never },
      output,
    )

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toContain("good goal")
  })

  it("empty handoff directory results in no injection", async () => {
    const hooks = await loadPlugin(handoffDir)
    await hooks["session.start"]!({ sessionID: "fresh" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!(
      { model: {} as never },
      output,
    )

    expect(output.system.length).toBe(0)
  })

  it("state block only includes non-empty fields", async () => {
    await writeStateFile(handoffDir, "partial-sess", {
      timestamp: 1000,
      goal: "some goal",
      decisions: [],
      openTasks: [],
      filesModified: [],
    })

    const hooks = await loadPlugin(handoffDir)
    await hooks["session.start"]!({ sessionID: "new" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!(
      { model: {} as never },
      output,
    )

    expect(output.system.length).toBe(1)
    const block = output.system[0]!
    expect(block).toContain("Goal: some goal")
    expect(block).not.toContain("Key decisions:")
    expect(block).not.toContain("Open tasks:")
    expect(block).not.toContain("Files modified:")
  })

  it("handoff_save merges with existing state", async () => {
    const hooks = await loadPlugin(handoffDir)

    await hooks.tool!.handoff_save.execute(
      { goal: "initial goal", decisions: ["d1"] },
      { sessionID: "merge-sess" } as any,
    )
    await hooks.tool!.handoff_save.execute(
      { decisions: ["d2"], openTasks: ["t1"] },
      { sessionID: "merge-sess" } as any,
    )

    await hooks["session.end"]!({ sessionID: "merge-sess" }, {})

    const raw = await readFile(join(handoffDir, "merge-sess.json"), "utf-8")
    const state = JSON.parse(raw)
    expect(state.goal).toBe("initial goal")
    expect(state.decisions).toEqual(["d1", "d2"])
    expect(state.openTasks).toEqual(["t1"])
  })
})
