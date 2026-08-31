import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { readdir, lstat, readFile } from "node:fs/promises"
import { join, parse } from "node:path"

function deriveToolName(filename: string): string {
  const { name } = parse(filename)
  return name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()
}

const DESCRIPTION_RE = /^(?:#|\/\/)\s*description:\s*(.+)$/i

async function extractDescription(filePath: string, filename: string): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8")
    const lines = content.split("\n").slice(0, 5)
    for (const line of lines) {
      const match = line.match(DESCRIPTION_RE)
      if (match) return match[1]!.trim()
    }
  } catch {
    // fall through to default
  }
  return `Run ${filename}`
}

async function discoverScripts(
  dir: string,
): Promise<Array<{ path: string; filename: string }>> {
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const scripts: Array<{ path: string; filename: string }> = []

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = await lstat(fullPath)

    if (stat.isSymbolicLink()) continue
    if (!stat.isFile()) continue
    if ((stat.mode & 0o111) === 0) continue

    scripts.push({ path: fullPath, filename: entry })
  }

  return scripts
}

export default {
  server: async (input): Promise<Hooks> => {
    const dir = process.env.COMMAND_INJECT_DIR
    if (!dir) return { tool: {} }

    const scripts = await discoverScripts(dir)
    const tools: Record<string, ToolDefinition> = {}

    for (const script of scripts) {
      const toolName = deriveToolName(script.filename)
      const description = await extractDescription(script.path, script.filename)

      tools[toolName] = {
        description,
        args: {
          args: z
            .string()
            .optional()
            .describe("Raw arguments passed to the script"),
        },
        async execute(toolArgs: { args?: string }) {
          const scriptPath = script.path
          const rawArgs = toolArgs.args ?? ""
          try {
            const result = await input.$`${scriptPath} ${rawArgs}`.text()
            return result
          } catch (error: unknown) {
            const shellError = error as { stderr?: Buffer; exitCode?: number }
            const stderr = shellError.stderr
              ? shellError.stderr.toString()
              : String(error)
            const exitCode = shellError.exitCode ?? 1
            return `Error (exit code ${exitCode}): ${stderr}`
          }
        },
      }
    }

    return { tool: tools }
  },
} satisfies PluginModule
