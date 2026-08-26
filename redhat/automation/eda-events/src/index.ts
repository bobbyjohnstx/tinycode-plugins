import type { Hooks, PluginModule } from "tinycode-plugin"
import { z } from "zod"

const optionsSchema = z
  .object({
    edaEndpoint: z.string().url(),
    events: z.array(z.string()).optional(),
    sensitivePatterns: z.array(z.string()).optional(),
  })
  .optional()

type EdaEvent = {
  type: string
  timestamp: string
  sessionId: string
  data: Record<string, unknown>
}

function sanitize(
  data: Record<string, unknown>,
  patterns: RegExp[],
): Record<string, unknown> {
  if (patterns.length === 0) return data

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && patterns.some((p) => p.test(value))) {
      result[key] = "[REDACTED]"
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = sanitize(value as Record<string, unknown>, patterns)
    } else {
      result[key] = value
    }
  }
  return result
}

type DeliveryStats = {
  sent: number
  failed: number
  lastError: string | null
}

function createEventSender(
  endpoint: string,
  patterns: RegExp[],
  allowedEvents: string[] | undefined,
): { fire: (event: EdaEvent) => void; stats: DeliveryStats } {
  const stats: DeliveryStats = { sent: 0, failed: 0, lastError: null }

  function fire(event: EdaEvent): void {
    if (allowedEvents && !allowedEvents.includes(event.type)) return

    const sanitized = {
      ...event,
      data: sanitize(event.data, patterns),
    }

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sanitized),
    })
      .then((res) => {
        if (res.ok) {
          stats.sent++
        } else {
          stats.failed++
          stats.lastError = `HTTP ${res.status}`
        }
      })
      .catch((err) => {
        stats.failed++
        stats.lastError = err instanceof Error ? err.message : String(err)
      })
  }

  return { fire, stats }
}

export default {
  schema: optionsSchema,
  server: async (_input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined

    if (!parsed?.edaEndpoint) {
      return {}
    }

    const endpoint = parsed.edaEndpoint
    const allowedEvents = parsed.events
    const patterns = (parsed.sensitivePatterns ?? []).map(
      (p) => new RegExp(p),
    )

    const { fire, stats } = createEventSender(endpoint, patterns, allowedEvents)

    let sessionId = ""
    let startTime = 0

    return {
      "session.start": async (event, _output) => {
        sessionId = event.sessionID
        startTime = Date.now()

        fire({
          type: "tinycode.session.started",
          timestamp: new Date().toISOString(),
          sessionId,
          data: {
            sessionId,
            projectDirectory: _input.directory,
          },
        })
      },

      "session.end": async (event, _output) => {
        const duration = Date.now() - startTime

        fire({
          type: "tinycode.session.ended",
          timestamp: new Date().toISOString(),
          sessionId: event.sessionID,
          data: {
            sessionId: event.sessionID,
            duration,
            delivery: {
              sent: stats.sent,
              failed: stats.failed,
              lastError: stats.lastError,
            },
          },
        })
      },

      "tool.execute.after": async (event, _output) => {
        const tool = event.tool
        const args = event.args as Record<string, unknown>
        const argsStr = JSON.stringify(args)

        let eventType: string | undefined

        if (
          tool === "shell" &&
          (argsStr.includes("docker build") ||
            argsStr.includes("podman build"))
        ) {
          eventType = "tinycode.image.built"
        } else if (tool === "edit" && typeof args["file"] === "string") {
          const file = args["file"]
          if (/Dockerfile/.test(file)) {
            eventType = "tinycode.dockerfile.changed"
          } else if (/k8s\/.*\.ya?ml$/.test(file)) {
            eventType = "tinycode.manifest.changed"
          }
        } else if (tool === "shell" && argsStr.includes("git push")) {
          eventType = "tinycode.code.pushed"
        }

        if (!eventType) return

        fire({
          type: eventType,
          timestamp: new Date().toISOString(),
          sessionId,
          data: {
            tool,
            args,
          },
        })
      },

      dispose: async () => {
        sessionId = ""
        startTime = 0
      },
    }
  },
} satisfies PluginModule
