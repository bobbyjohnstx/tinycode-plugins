import { describe, it, expect } from "bun:test"
import { createMockShell, createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

async function getTools(commands: Parameters<typeof createMockShell>[0]) {
  const shell = createMockShell(commands)
  const input = createMockInput(shell)
  const hooks = await plugin.server(input, undefined)
  return hooks.tool!
}

describe("code_review", () => {
  it("returns formatted diff output", async () => {
    const diffOutput = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import express from 'express'
+import cors from 'cors'
 const app = express()`
    const statOutput = ` src/app.ts | 1 +
 1 file changed, 1 insertion(+)`

    const tools = await getTools([
      { match: "git diff HEAD", output: diffOutput },
      { match: "git diff --stat HEAD", output: statOutput },
    ])

    const result = await tools.code_review.execute({ ref: "HEAD" })
    expect(result).toContain("## Code Review: HEAD")
    expect(result).toContain("**Files changed:** 1 file changed")
    expect(result).toContain("```diff")
    expect(result).toContain("+import cors from 'cors'")
    expect(result).toContain("Review this diff for:")
  })

  it("scopes diff to a path", async () => {
    const diffOutput = "diff --git a/src/utils.ts b/src/utils.ts\n--- a/src/utils.ts\n+++ b/src/utils.ts"
    const statOutput = " src/utils.ts | 1 +\n 1 file changed"

    const tools = await getTools([
      { match: "git diff HEAD -- src/", output: diffOutput },
      { match: "git diff --stat HEAD -- src/", output: statOutput },
    ])

    const result = await tools.code_review.execute({ ref: "HEAD", path: "src/" })
    expect(result).toContain("## Code Review: HEAD src/")
    expect(result).toContain("src/utils.ts")
  })

  it("uses ref argument in diff command", async () => {
    const diffOutput = "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts"
    const statOutput = " file.ts | 1 +\n 1 file changed"

    const tools = await getTools([
      { match: "git diff HEAD~3", output: diffOutput },
      { match: "git diff --stat HEAD~3", output: statOutput },
    ])

    const result = await tools.code_review.execute({ ref: "HEAD~3" })
    expect(result).toContain("## Code Review: HEAD~3")
  })

  it("shows staged changes when staged flag is set", async () => {
    const diffOutput = "diff --git a/staged.ts b/staged.ts\n--- a/staged.ts\n+++ b/staged.ts"
    const statOutput = " staged.ts | 1 +\n 1 file changed"

    const tools = await getTools([
      { match: "git diff --cached", output: diffOutput },
      { match: "git diff --stat --cached", output: statOutput },
    ])

    const result = await tools.code_review.execute({ staged: true })
    expect(result).toContain("## Code Review: (staged)")
    expect(result).toContain("staged.ts")
  })

  it("returns message when no changes found", async () => {
    const tools = await getTools([
      { match: "git diff", output: "" },
    ])

    const result = await tools.code_review.execute({})
    expect(result).toBe("No changes to review.")
  })

  it("truncates large diffs at 10000 characters", async () => {
    const largeDiff = "diff --git a/big.ts b/big.ts\n" + "x".repeat(15000)
    const statOutput = " big.ts | 100 +\n 1 file changed"

    const tools = await getTools([
      { match: "git diff HEAD", output: largeDiff },
      { match: "git diff --stat HEAD", output: statOutput },
    ])

    const result = await tools.code_review.execute({ ref: "HEAD" })
    expect(result).toContain("[Diff truncated")
    expect(result).toContain("10000 chars")
    expect(result).toContain(String(largeDiff.length))
  })

  it("returns error message when not a git repo", async () => {
    const tools = await getTools([
      { match: "git diff", output: "fatal: not a git repository", exitCode: 128 },
    ])

    const result = await tools.code_review.execute({})
    expect(result).toContain("fatal: not a git repository")
  })
})

describe("code_review_diff_stat", () => {
  it("returns stat output", async () => {
    const statOutput = ` src/app.ts  | 5 +++--
 src/util.ts | 3 ++-
 2 files changed, 5 insertions(+), 3 deletions(-)`

    const tools = await getTools([
      { match: "git diff --stat", output: statOutput },
    ])

    const result = await tools.code_review_diff_stat.execute({})
    expect(result).toContain("src/app.ts")
    expect(result).toContain("2 files changed")
  })

  it("returns message when no changes found", async () => {
    const tools = await getTools([
      { match: "git diff --stat", output: "" },
    ])

    const result = await tools.code_review_diff_stat.execute({})
    expect(result).toBe("No changes found.")
  })

  it("supports ref and path arguments", async () => {
    const statOutput = " src/app.ts | 2 +-\n 1 file changed"

    const tools = await getTools([
      { match: "git diff --stat HEAD~5 -- src/", output: statOutput },
    ])

    const result = await tools.code_review_diff_stat.execute({ ref: "HEAD~5", path: "src/" })
    expect(result).toContain("src/app.ts")
  })

  it("supports staged flag", async () => {
    const statOutput = " staged.ts | 1 +\n 1 file changed"

    const tools = await getTools([
      { match: "git diff --stat --cached", output: statOutput },
    ])

    const result = await tools.code_review_diff_stat.execute({ staged: true })
    expect(result).toContain("staged.ts")
  })
})
