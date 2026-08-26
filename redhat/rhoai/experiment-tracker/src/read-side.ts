import type { ApiClient } from "tinycode-plugin-redhat-shared/api"

export type LastRunInfo = {
  runId: string
  status: string
  metrics: Record<string, number>
  params: Record<string, string>
  duration?: number
}

type RunSearchResult = {
  runs?: Array<{
    info: {
      run_id: string
      status: string
      start_time: number
      end_time?: number
    }
    data: {
      metrics: Array<{ key: string; value: number }>
      params: Array<{ key: string; value: string }>
    }
  }>
}

export function createLastSessionBlock(lastRun: LastRunInfo | null): string {
  if (!lastRun) return ""

  const parts: string[] = [`run=${lastRun.runId}`, `status=${lastRun.status}`]

  if (lastRun.duration !== undefined) {
    const minutes = Math.round(lastRun.duration / 60)
    parts.push(`duration=${minutes}m`)
  }

  const metricEntries = Object.entries(lastRun.metrics)
  if (metricEntries.length > 0) {
    parts.push(
      `metrics: ${metricEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`,
    )
  }

  const paramEntries = Object.entries(lastRun.params)
  if (paramEntries.length > 0) {
    parts.push(
      `params: ${paramEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`,
    )
  }

  return `<last-session>${parts.join(" ")}</last-session>`
}

export async function fetchLastRun(
  api: ApiClient,
  experimentName: string,
): Promise<LastRunInfo | null> {
  const expRes = await api.get<{
    experiment: { experiment_id: string }
  }>("/api/2.0/mlflow/experiments/get-by-name", {
    experiment_name: experimentName,
  })

  const experimentId = expRes.data.experiment.experiment_id

  const runsRes = await api.post<RunSearchResult>(
    "/api/2.0/mlflow/runs/search",
    {
      experiment_ids: [experimentId],
      filter: "status = 'FINISHED'",
      order_by: ["start_time DESC"],
      max_results: 1,
    },
  )

  const runs = runsRes.data.runs
  if (!runs || runs.length === 0) return null

  const run = runs[0]!
  const metrics: Record<string, number> = {}
  for (const m of run.data.metrics) metrics[m.key] = m.value
  const params: Record<string, string> = {}
  for (const p of run.data.params) params[p.key] = p.value

  const duration =
    run.info.end_time !== undefined
      ? (run.info.end_time - run.info.start_time) / 1000
      : undefined

  return {
    runId: run.info.run_id,
    status: run.info.status,
    metrics,
    params,
    duration,
  }
}

export function createSystemTransformHook(lastRunRef: {
  current: LastRunInfo | null
}) {
  return async (
    _input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ) => {
    const block = createLastSessionBlock(lastRunRef.current)
    if (block) {
      output.system.push(block)
    }
  }
}
