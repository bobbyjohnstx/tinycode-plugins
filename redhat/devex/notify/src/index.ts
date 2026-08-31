import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"

function escapeForOsascript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'")
}

async function sendDesktopNotification(
  title: string,
  message: string,
): Promise<string | null> {
  const platform = process.platform

  if (platform === "darwin") {
    const safeTitle = escapeForOsascript(title)
    const safeMessage = escapeForOsascript(message)
    const proc = Bun.spawn([
      "osascript",
      "-e",
      `display notification "${safeMessage}" with title "${safeTitle}"`,
    ])
    await proc.exited
    return null
  }

  if (platform === "linux") {
    const proc = Bun.spawn(["notify-send", title, message])
    await proc.exited
    return null
  }

  return "Desktop notifications not supported on this platform"
}

async function sendPushNotification(
  title: string,
  message: string,
): Promise<string | null> {
  const topic = process.env.NTFY_TOPIC
  if (!topic) return null

  const response = await fetch(`https://ntfy.sh/${topic}`, {
    method: "POST",
    headers: { Title: title },
    body: message,
  })

  if (!response.ok) {
    return `Push notification warning: HTTP ${response.status}`
  }

  return null
}

function createTools(): Record<string, ToolDefinition> {
  return {
    notify: {
      description:
        "Send a desktop notification and optional push notification via ntfy.sh. Use to alert the user when a long-running task completes.",
      args: {
        title: z.string().describe("Notification title"),
        message: z.string().describe("Notification body"),
      },
      async execute(args: { title: string; message: string }) {
        const warnings: string[] = []

        try {
          const desktopResult = await sendDesktopNotification(
            args.title,
            args.message,
          )
          if (desktopResult) {
            warnings.push(desktopResult)
          }
        } catch (error) {
          warnings.push(
            `Desktop notification failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }

        try {
          const pushResult = await sendPushNotification(
            args.title,
            args.message,
          )
          if (pushResult) {
            warnings.push(pushResult)
          }
        } catch (error) {
          warnings.push(
            `Push notification failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }

        if (warnings.length > 0) {
          return warnings.join("; ")
        }

        return "Notification sent"
      },
    },
  }
}

export default {
  server: async (): Promise<Hooks> => ({
    tool: createTools(),
  }),
} satisfies PluginModule
