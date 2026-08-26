import type { ApiClient } from "./api"

type CreateExperimentResponse = {
  experiment_id: string
}

type GetExperimentResponse = {
  experiment: {
    experiment_id: string
    name: string
  }
}

type RunTag = {
  key: string
  value: string
}

type CreateRunResponse = {
  run: {
    info: {
      run_id: string
    }
  }
}

export type MlflowClient = {
  createExperiment(name: string): Promise<string>
  getExperimentByName(name: string): Promise<string | undefined>
  createRun(
    experimentId: string,
    tags?: RunTag[],
  ): Promise<string>
  logMetric(
    runId: string,
    key: string,
    value: number,
    step?: number,
  ): Promise<void>
  logParam(runId: string, key: string, value: string): Promise<void>
  endRun(runId: string, status: string): Promise<void>
}

export function createMlflowClient(api: ApiClient): MlflowClient {
  return {
    async createExperiment(name) {
      const res = await api.post<CreateExperimentResponse>(
        "/api/2.0/mlflow/experiments/create",
        { name },
      )
      return res.data.experiment_id
    },

    async getExperimentByName(name) {
      try {
        const res = await api.get<GetExperimentResponse>(
          "/api/2.0/mlflow/experiments/get-by-name",
          { experiment_name: name },
        )
        return res.data.experiment.experiment_id
      } catch {
        return undefined
      }
    },

    async createRun(experimentId, tags) {
      const res = await api.post<CreateRunResponse>(
        "/api/2.0/mlflow/runs/create",
        { experiment_id: experimentId, tags },
      )
      return res.data.run.info.run_id
    },

    async logMetric(runId, key, value, step) {
      await api.post("/api/2.0/mlflow/runs/log-metric", {
        run_id: runId,
        key,
        value,
        step,
      })
    },

    async logParam(runId, key, value) {
      await api.post("/api/2.0/mlflow/runs/log-param", {
        run_id: runId,
        key,
        value,
      })
    },

    async endRun(runId, status) {
      await api.post("/api/2.0/mlflow/runs/update", {
        run_id: runId,
        status,
        end_time: Date.now(),
      })
    },
  }
}
