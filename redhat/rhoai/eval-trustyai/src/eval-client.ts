import { createApiClient } from "tinycode-plugin-redhat-shared/api"

export type EvalConfig = {
  tasks?: string[]
  numFewShot?: number
  batchSize?: number
}

export type EvalResult = {
  eval_id: string
  status: "pending" | "running" | "completed" | "failed"
  model: string
  provider: string
  results?: Record<string, number>
  error?: string
  created_at: string
  completed_at?: string
}

export type EvalComparison = {
  evals: EvalResult[]
}

export type EvalClient = {
  runEval(
    model: string,
    provider: string,
    config?: EvalConfig,
  ): Promise<string>
  getEvalStatus(evalId: string): Promise<EvalResult>
  compareEvals(evalIds: string[]): Promise<EvalComparison>
}

export function createEvalClient(config: {
  apiUrl: string
  tokenFn?: () => Promise<string>
}): EvalClient {
  const client = createApiClient({
    baseUrl: config.apiUrl,
    tokenFn: config.tokenFn ?? (async () => null),
  })

  return {
    async runEval(model, provider, evalConfig) {
      const res = await client.post<{ eval_id: string }>(
        "/api/v1/evaluations",
        { model, provider, config: evalConfig },
      )
      return res.data.eval_id
    },

    async getEvalStatus(evalId) {
      const res = await client.get<EvalResult>(
        `/api/v1/evaluations/${evalId}`,
      )
      return res.data
    },

    async compareEvals(evalIds) {
      const evals = await Promise.all(
        evalIds.map(async (id) => {
          const res = await client.get<EvalResult>(
            `/api/v1/evaluations/${id}`,
          )
          return res.data
        }),
      )
      return { evals }
    },
  }
}
