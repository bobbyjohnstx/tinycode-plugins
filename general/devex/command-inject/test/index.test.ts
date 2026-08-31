import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test"
import { mkdtemp, writeFile, rm, mkdir, symlink, chmod } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { PluginInput } from "tinycode-plugin"
import plugin from "../src/index"

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "command-inject-test-"))
})

afterAll(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

const originalEnv = process.env.COMMAND_INJECT_DIR

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.COMMAND_INJECT_DIR
  } else {
    process.env.COMMAND_INJECT_DIR = originalEnv
  }
})

function createMinimalInput(): PluginInput {
  const shell = (() => ({})) as unknown as PluginInput["$"]
  return {
    client: {} as PluginInput["client"],
    project: { id: "test", worktree: "/tmp/test", time: { created: Date.now() } },
    directory: "/tmp/test",
    worktree: "/tmp/test",
    serverUrl: new URL("http://localhost:4096"),
    $: shell,
  }
}

async function getTools() {
  const input = createMinimalInput()
  const hooks = await plugin.server(input, undefined)
  return hooks.tool ?? {}
}

describe("tinycode-plugin-gen-command-inject", () => {
  describe("discovery", () => {
    it("registers zero tools when COMMAND_INJECT_DIR is not set", async () => {
      delete process.env.COMMAND_INJECT_DIR
      const tools = await getTools()
      expect(Object.keys(tools)).toHaveLength(0)
    })

    it("registers zero tools for non-existent directory without error", async () => {
      process.env.COMMAND_INJECT_DIR = join(tempDir, "does-not-exist")
      const tools = await getTools()
      expect(Object.keys(tools)).toHaveLength(0)
    })

    it("registers zero tools for empty directory", async () => {
      const emptyDir = join(tempDir, "empty")
      await mkdir(emptyDir, { recursive: true })
      process.env.COMMAND_INJECT_DIR = emptyDir
      const tools = await getTools()
      expect(Object.keys(tools)).toHaveLength(0)
    })

    it("registers one tool for directory with one executable script", async () => {
      const dir = join(tempDir, "one-script")
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "deploy.sh"), "#!/bin/bash\necho hello\n")
      await chmod(join(dir, "deploy.sh"), 0o755)
      process.env.COMMAND_INJECT_DIR = dir

      const tools = await getTools()
      expect(Object.keys(tools)).toHaveLength(1)
      expect(tools.deploy).toBeDefined()
    })

    it("strips extension and replaces special chars in tool name", async () => {
      const dir = join(tempDir, "name-derivation")
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "run-tests.py"), "#!/usr/bin/env python3\nprint('ok')\n")
      await chmod(join(dir, "run-tests.py"), 0o755)
      process.env.COMMAND_INJECT_DIR = dir

      const tools = await getTools()
      expect(tools.run_tests).toBeDefined()
    })

    it("handles spaces in filename by replacing with underscores", async () => {
      const dir = join(tempDir, "space-name")
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "my script.bash"), "#!/bin/bash\necho ok\n")
      await chmod(join(dir, "my script.bash"), 0o755)
      process.env.COMMAND_INJECT_DIR = dir

      const tools = await getTools()
      expect(tools.my_script).toBeDefined()
    })

    it("extracts description from # description: comment", async () => {
      const dir = join(tempDir, "description-hash")
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, "build.sh"),
        "#!/bin/bash\n# description: Build the project\necho building\n",
      )
      await chmod(join(dir, "build.sh"), 0o755)
      process.env.COMMAND_INJECT_DIR = dir

      const tools = await getTools()
      expect(tools.build.description).toBe("Build the project")
    })

    it("extracts description from // description: comment", async () => {
      const dir = join(tempDir, "description-slash")
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, "lint.sh"),
        "#!/bin/bash\n// description: Run the linter\necho linting\n",
      )
      await chmod(join(dir, "lint.sh"), 0o755)
      process.env.COMMAND_INJECT_DIR = dir

      const tools = await getTools()
      expect(tools.lint.description).toBe("Run the linter")
    })

    it("falls back to 'Run <filename>' when no description comment found", async () => {
      const dir = join(tempDir, "no-description")
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "check.sh"), "#!/bin/bash\necho check\n")
      await chmod(join(dir, "check.sh"), 0o755)
      process.env.COMMAND_INJECT_DIR = dir

      const tools = await getTools()
      expect(tools.check.description).toBe("Run check.sh")
    })

    it("skips symlinks", async () => {
      const dir = join(tempDir, "symlink-test")
      await mkdir(dir, { recursive: true })
      const realScript = join(dir, "real.sh")
      await writeFile(realScript, "#!/bin/bash\necho real\n")
      await chmod(realScript, 0o755)
      await symlink(realScript, join(dir, "linked.sh"))
      process.env.COMMAND_INJECT_DIR = dir

      const tools = await getTools()
      expect(Object.keys(tools)).toHaveLength(1)
      expect(tools.real).toBeDefined()
      expect(tools.linked).toBeUndefined()
    })

    it("skips non-executable files", async () => {
      const dir = join(tempDir, "no-exec")
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "readme.txt"), "just a readme\n")
      await writeFile(join(dir, "run.sh"), "#!/bin/bash\necho ok\n")
      await chmod(join(dir, "run.sh"), 0o755)
      process.env.COMMAND_INJECT_DIR = dir

      const tools = await getTools()
      expect(Object.keys(tools)).toHaveLength(1)
      expect(tools.run).toBeDefined()
    })

    it("skips subdirectories", async () => {
      const dir = join(tempDir, "with-subdir")
      await mkdir(dir, { recursive: true })
      await mkdir(join(dir, "subdir"), { recursive: true })
      await writeFile(join(dir, "top.sh"), "#!/bin/bash\necho top\n")
      await chmod(join(dir, "top.sh"), 0o755)
      await writeFile(join(dir, "subdir", "nested.sh"), "#!/bin/bash\necho nested\n")
      await chmod(join(dir, "subdir", "nested.sh"), 0o755)
      process.env.COMMAND_INJECT_DIR = dir

      const tools = await getTools()
      expect(Object.keys(tools)).toHaveLength(1)
      expect(tools.top).toBeDefined()
    })
  })
})
