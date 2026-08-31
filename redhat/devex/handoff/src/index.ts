import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

interface SessionState {
  sessionID: string
  timestamp: number
  goal: string
  decisions: string[]
  openTasks: string[]
  filesModified: string[]
}

function getHandoffDir(): string {
  return process.env.HANDOFF_DIR ?? join(homedir(), ".tinycode", "handoff")
}

function emptyState(sessionID: string): SessionState {
  return {
    sessionID,
    timestamp: Date.now(),
    goal: "",
    decisions: [],
    openTasks: [],
    filesModified: [],
  }
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

async function loadMostRecentState(
  dir: string,
  currentSessionID: string,
): Promise<SessionState | null> {
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return null
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"))
  if (jsonFiles.length === 0) return null

  let best: SessionState | null = null

  for (const file of jsonFiles) {
    try {
      const raw = await readFile(join(dir, file), "utf-8")
      const parsed = JSON.parse(raw) as SessionState
      if (parsed.sessionID === currentSessionID) continue
      if (!best || parsed.timestamp > best.timestamp) {
        best = parsed
      }
    } catch {
      // Skip corrupted files
    }
  }

  return best
}

function formatStateBlock(state: SessionState): string {
  const lines: string[] = []

  if (state.goal) {
    lines.push(`Goal: ${state.goal}`)
  }
  if (state.decisions.length > 0) {
    lines.push(`Key decisions: ${state.decisions.join("; ")}`)
  }
  if (state.openTasks.length > 0) {
    lines.push(`Open tasks: ${state.openTasks.join("; ")}`)
  }
  if (state.filesModified.length > 0) {
    lines.push(`Files modified: ${state.filesModified.join(", ")}`)
  }

  if (lines.length === 0) return ""

  return `<previous-session>\n${lines.join("\n")}\n</previous-session>`
}

export default {
  server: async (_input, _options): Promise<Hooks> => {
    let loadedState: SessionState | null = null
    let currentState: SessionState = emptyState("")

    const handoff_save: ToolDefinition = {
      description:
        "Save session context for handoff to the next session. Call this to persist goal, decisions, open tasks, and modified files.",
      args: {
        goal: z.string().optional().describe("High-level goal of this session"),
        decisions: z
          .array(z.string())
          .optional()
          .describe("Key decisions made during this session"),
        openTasks: z
          .array(z.string())
          .optional()
          .describe("Unfinished work items to carry over"),
        filesModified: z
          .array(z.string())
          .optional()
          .describe("File paths touched during this session"),
      },
      async execute(args: {
        goal?: string
        decisions?: string[]
        openTasks?: string[]
        filesModified?: string[]
      }) {
        if (args.goal !== undefined) {
          currentState = { ...currentState, goal: args.goal }
        }
        if (args.decisions !== undefined) {
          currentState = {
            ...currentState,
            decisions: [...currentState.decisions, ...args.decisions],
          }
        }
        if (args.openTasks !== undefined) {
          currentState = {
            ...currentState,
            openTasks: [...currentState.openTasks, ...args.openTasks],
          }
        }
        if (args.filesModified !== undefined) {
          currentState = {
            ...currentState,
            filesModified: [...currentState.filesModified, ...args.filesModified],
          }
        }
        return "Session context saved. Will be persisted when session ends."
      },
    }

    return {
      tool: { handoff_save },

      "session.start": async (input, _output) => {
        const dir = getHandoffDir()
        loadedState = await loadMostRecentState(dir, input.sessionID)
        currentState = emptyState(input.sessionID)
      },

      "experimental.chat.system.transform": async (_input, output) => {
        if (!loadedState) return
        const block = formatStateBlock(loadedState)
        if (block) {
          output.system.push(block)
        }
      },

      "session.end": async (input, _output) => {
        const dir = getHandoffDir()
        await ensureDir(dir)
        const state: SessionState = {
          ...currentState,
          sessionID: input.sessionID,
          timestamp: Date.now(),
        }
        const filePath = join(dir, `${input.sessionID}.json`)
        await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8")
      },

      dispose: async () => {
        loadedState = null
        currentState = emptyState("")
      },
    }
  },
} satisfies PluginModule
