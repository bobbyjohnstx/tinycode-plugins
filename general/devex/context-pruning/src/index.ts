import type { Hooks, PluginModule } from "tinycode-plugin"

function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return "[" + value.map(sortedStringify).join(",") + "]"
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${sortedStringify(obj[k])}`,
  )
  return "{" + entries.join(",") + "}"
}

export function pruneStaleToolOutputs(
  messages: { info: unknown; parts: any[] }[],
  threshold: number,
): void {
  const latestOccurrence = new Map<string, number>()

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    for (const part of messages[msgIdx]!.parts) {
      if (part.type !== "tool" || part.state?.status !== "completed") continue
      const key = sortedStringify({ tool: part.tool, input: part.state.input })
      latestOccurrence.set(key, msgIdx)
    }
  }

  const ageThresholdIdx = messages.length - threshold

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    for (const part of messages[msgIdx]!.parts) {
      if (part.type !== "tool" || part.state?.status !== "completed") continue

      const key = sortedStringify({ tool: part.tool, input: part.state.input })
      const latestIdx = latestOccurrence.get(key)!

      if (latestIdx > msgIdx) {
        part.state.output = `[pruned: ${part.tool} output — superseded by more recent call]`
      } else if (msgIdx < ageThresholdIdx) {
        part.state.output = `[pruned: ${part.tool} output — older than threshold]`
      }
    }
  }
}

export default {
  server: async (_input, _options): Promise<Hooks> => {
    return {
      "experimental.chat.messages.transform": async (_event, output) => {
        const threshold = parseInt(
          process.env.CONTEXT_PRUNE_THRESHOLD ?? "20",
          10,
        )
        pruneStaleToolOutputs(output.messages, threshold)
      },
    }
  },
} satisfies PluginModule
