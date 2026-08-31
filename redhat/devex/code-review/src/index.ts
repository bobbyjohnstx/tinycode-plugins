import type { Hooks, PluginInput, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"

const MAX_DIFF_LENGTH = 10000

function buildDiffArgs(args: {
  ref?: string
  path?: string
  staged?: boolean
  stat?: boolean
}): string {
  const parts: string[] = ["git", "diff"]

  if (args.stat) parts.push("--stat")
  if (args.staged) parts.push("--cached")
  if (args.ref) parts.push(args.ref)
  if (args.path) parts.push("--", args.path)

  return parts.join(" ")
}

function formatHeader(args: { ref?: string; path?: string; staged?: boolean }): string {
  const parts: string[] = []
  if (args.staged) parts.push("(staged)")
  if (args.ref) parts.push(args.ref)
  if (args.path) parts.push(args.path)
  return parts.join(" ") || "(working tree)"
}

function extractFileCount(statOutput: string): string {
  const match = statOutput.match(/(\d+ files? changed.*)/)
  return match ? match[1]!.trim() : "unknown"
}

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_LENGTH) return diff

  const total = diff.length
  return (
    diff.slice(0, MAX_DIFF_LENGTH) +
    `\n\n[Diff truncated — showing first ${MAX_DIFF_LENGTH} chars of ${total} total]`
  )
}

function createTools($: PluginInput["$"]): Record<string, ToolDefinition> {
  const diffArgs = {
    path: z.string().optional().describe("File or directory to scope the diff"),
    ref: z.string().optional().describe("Git ref to diff against (e.g. HEAD, HEAD~3, main)"),
    staged: z.boolean().optional().describe("Show staged changes (git diff --cached)"),
  }

  return {
    code_review: {
      description:
        "Gather a git diff and format it for AI-assisted code review. Retrieves and structures the diff for the LLM to analyze.",
      args: diffArgs,
      async execute(args: { path?: string; ref?: string; staged?: boolean }) {
        try {
          const diffCmd = buildDiffArgs(args)
          const diffOutput = await $`${diffCmd}`.quiet().nothrow().text()

          if (!diffOutput.trim()) {
            return "No changes to review."
          }

          const statCmd = buildDiffArgs({ ...args, stat: true })
          const statOutput = await $`${statCmd}`.quiet().nothrow().text()
          const fileCount = extractFileCount(statOutput)
          const header = formatHeader(args)
          const diff = truncateDiff(diffOutput.trim())

          return [
            `## Code Review: ${header}`,
            "",
            `**Files changed:** ${fileCount}`,
            "",
            "```diff",
            diff,
            "```",
            "",
            "Review this diff for: correctness, security, performance, and maintainability issues.",
          ].join("\n")
        } catch (error) {
          return `Error running git diff: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    code_review_diff_stat: {
      description:
        "Show a lightweight diff stat overview (files changed, insertions, deletions) without the full diff content.",
      args: diffArgs,
      async execute(args: { path?: string; ref?: string; staged?: boolean }) {
        try {
          const cmd = buildDiffArgs({ ...args, stat: true })
          const output = await $`${cmd}`.quiet().nothrow().text()

          if (!output.trim()) {
            return "No changes found."
          }

          return output.trim()
        } catch (error) {
          return `Error running git diff --stat: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export default {
  server: async (input): Promise<Hooks> => {
    const tools = createTools(input.$)
    return { tool: tools }
  },
} satisfies PluginModule
