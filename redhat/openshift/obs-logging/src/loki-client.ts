import { createApiClient } from "tinycode-plugin-redhat-shared/api"

export type LogEntry = {
  timestamp: string
  line: string
  labels: Record<string, string>
}

export type LokiClient = {
  query(
    logql: string,
    limit?: number,
    start?: string,
    end?: string,
  ): Promise<LogEntry[]>
  labels(): Promise<string[]>
}

export function createLokiClient(config: {
  baseUrl: string
  tokenFn?: () => Promise<string>
}): LokiClient {
  const client = createApiClient({
    baseUrl: config.baseUrl,
    tokenFn: config.tokenFn ?? (async () => null),
  })

  return {
    async query(logql, limit, start, end) {
      const params: Record<string, string> = { query: logql }
      if (limit) params.limit = String(limit)
      if (start) params.start = start
      if (end) params.end = end

      const res = await client.get<{
        data: {
          result: Array<{
            stream: Record<string, string>
            values: [string, string][]
          }>
        }
      }>("/loki/api/v1/query_range", params)

      const entries: LogEntry[] = []
      for (const stream of res.data.data.result) {
        for (const [ts, line] of stream.values) {
          entries.push({ timestamp: ts, line, labels: stream.stream })
        }
      }
      return entries
    },

    async labels() {
      const res = await client.get<{ data: string[] }>("/loki/api/v1/labels")
      return res.data.data ?? []
    },
  }
}
