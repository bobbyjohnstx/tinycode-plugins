import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { Database } from "bun:sqlite"
import { z } from "zod"
import { mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { homedir } from "node:os"

interface BufferedToolCall {
  toolName: string
  argsHash: string
  timestamp: number
  durationMs: number
  success: number
}

function getDbPath(): string {
  return process.env.TELEMETRY_DB ?? join(homedir(), ".tinycode", "telemetry.db")
}

function initDb(dbPath: string): Database {
  const db = new Database(dbPath, { create: true })
  db.exec("PRAGMA journal_mode = WAL")
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      tool_count INTEGER DEFAULT 0
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      args_hash TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      duration_ms INTEGER,
      success INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `)
  return db
}

function hashArgs(args: unknown): string {
  const str = JSON.stringify(args ?? {})
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(str)
  return hasher.digest("hex").slice(0, 16)
}

function formatReport(db: Database): string {
  const sessionCount = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM sessions",
  ).get()
  const toolCallCount = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM tool_calls",
  ).get()

  if (!sessionCount?.count && !toolCallCount?.count) {
    return "No telemetry data collected yet."
  }

  const totalSessions = sessionCount?.count ?? 0
  const totalCalls = toolCallCount?.count ?? 0
  const avgPerSession = totalSessions > 0 ? (totalCalls / totalSessions).toFixed(1) : "0"

  const topTools = db
    .query<{ tool_name: string; count: number }, []>(
      "SELECT tool_name, COUNT(*) as count FROM tool_calls GROUP BY tool_name ORDER BY count DESC LIMIT 10",
    )
    .all()

  const recentSessions = db
    .query<
      { id: string; started_at: number; ended_at: number | null; tool_count: number },
      []
    >(
      "SELECT id, started_at, ended_at, tool_count FROM sessions ORDER BY started_at DESC LIMIT 5",
    )
    .all()

  const lines: string[] = [
    "--- Telemetry Report ---",
    "",
    `Total sessions: ${totalSessions}`,
    `Total tool calls: ${totalCalls}`,
    `Average tool calls per session: ${avgPerSession}`,
    "",
    "Top 10 tools by call count:",
  ]

  for (const t of topTools) {
    lines.push(`  ${t.tool_name}: ${t.count}`)
  }

  lines.push("")
  lines.push("Last 5 sessions:")
  for (const s of recentSessions) {
    const startedAt = new Date(s.started_at).toISOString()
    const endedAt = s.ended_at ? new Date(s.ended_at).toISOString() : "active"
    lines.push(`  ${s.id} | started: ${startedAt} | ended: ${endedAt} | tools: ${s.tool_count}`)
  }

  return lines.join("\n")
}

function queryToolCalls(
  db: Database,
  tool?: string,
  days?: number,
): string {
  const effectiveDays = days ?? 7
  const cutoff = effectiveDays === 0
    ? Date.now() + 1
    : Date.now() - effectiveDays * 24 * 60 * 60 * 1000

  let sql = "SELECT tool_name, args_hash, timestamp, duration_ms, success, session_id FROM tool_calls WHERE timestamp >= ?"
  const params: (string | number)[] = [cutoff]

  if (tool) {
    sql += " AND tool_name = ?"
    params.push(tool)
  }

  sql += " ORDER BY timestamp DESC"

  const rows = db.query<
    {
      tool_name: string
      args_hash: string
      timestamp: number
      duration_ms: number | null
      success: number
      session_id: string
    },
    (string | number)[]
  >(sql).all(...params)

  if (rows.length === 0) {
    return `No tool calls found${tool ? ` for "${tool}"` : ""} in the last ${effectiveDays} day(s).`
  }

  const lines: string[] = [
    `Tool calls${tool ? ` for "${tool}"` : ""} (last ${effectiveDays} day(s)): ${rows.length} result(s)`,
    "",
  ]

  for (const r of rows) {
    const ts = new Date(r.timestamp).toISOString()
    const status = r.success ? "ok" : "fail"
    lines.push(`  ${r.tool_name} | ${ts} | ${status} | session: ${r.session_id}`)
  }

  return lines.join("\n")
}

export default {
  server: async (): Promise<Hooks> => {
    let db: Database | null = null
    let currentSessionId: string | null = null
    const buffer: BufferedToolCall[] = []

    function ensureDb(): Database {
      if (!db) {
        const dbPath = getDbPath()
        const dir = dirname(dbPath)
        // Sync mkdir for simplicity — only runs once
        try {
          require("node:fs").mkdirSync(dir, { recursive: true })
        } catch {
          // directory may already exist
        }
        db = initDb(dbPath)
      }
      return db
    }

    const telemetry_report: ToolDefinition = {
      description:
        "Show a telemetry summary: total sessions, total tool calls, top 10 tools by call count, average calls per session, and last 5 sessions.",
      args: {},
      async execute() {
        const database = ensureDb()
        return formatReport(database)
      },
    }

    const telemetry_query: ToolDefinition = {
      description:
        "Query tool call telemetry records, optionally filtered by tool name and recency.",
      args: {
        tool: z.string().optional().describe("Filter by tool name"),
        days: z.number().optional().describe("Number of days to look back (default 7)"),
      },
      async execute(args: { tool?: string; days?: number }) {
        const database = ensureDb()
        return queryToolCalls(database, args.tool, args.days)
      },
    }

    return {
      tool: { telemetry_report, telemetry_query },

      "session.start": async (input, _output) => {
        currentSessionId = input.sessionID
        buffer.length = 0
        const database = ensureDb()
        database
          .query("INSERT OR IGNORE INTO sessions (id, started_at) VALUES (?, ?)")
          .run(input.sessionID, Date.now())
      },

      "tool.execute.after": async (input, _output) => {
        if (!currentSessionId) return
        buffer.push({
          toolName: input.tool,
          argsHash: hashArgs(input.args),
          timestamp: Date.now(),
          durationMs: 0,
          success: 1,
        })
      },

      "session.end": async (input, _output) => {
        const database = ensureDb()
        const sessionId = input.sessionID

        if (buffer.length > 0) {
          const insertCall = database.query(
            "INSERT INTO tool_calls (session_id, tool_name, args_hash, timestamp, duration_ms, success) VALUES (?, ?, ?, ?, ?, ?)",
          )
          const tx = database.transaction(() => {
            for (const call of buffer) {
              insertCall.run(
                sessionId,
                call.toolName,
                call.argsHash,
                call.timestamp,
                call.durationMs,
                call.success,
              )
            }
          })
          tx()
        }

        database
          .query("UPDATE sessions SET ended_at = ?, tool_count = ? WHERE id = ?")
          .run(Date.now(), buffer.length, sessionId)

        buffer.length = 0
        currentSessionId = null
      },

      dispose: async () => {
        if (db) {
          db.close()
          db = null
        }
        buffer.length = 0
        currentSessionId = null
      },
    }
  },
} satisfies PluginModule
