import { createApiClient } from "tinycode-plugin-redhat-shared/api"

export type Experiment = {
  experiment_id: string
  name: string
  artifact_location: string
  lifecycle_stage: string
  last_update_time?: number
}

export type RunInfo = {
  run_id: string
  experiment_id: string
  status: "RUNNING" | "FINISHED" | "FAILED" | "KILLED"
  start_time: number
  end_time?: number
  artifact_uri: string
  lifecycle_stage: string
}

export type RunMetric = { key: string; value: number; timestamp: number; step: number }
export type RunParam = { key: string; value: string }
export type RunTag = { key: string; value: string }

export type Run = {
  info: RunInfo
  data: { metrics: RunMetric[]; params: RunParam[]; tags: RunTag[] }
}

export type RunComparison = {
  runs: Array<{ runId: string; params: Record<string, string>; metrics: Record<string, number> }>
}

export type Artifact = { path: string; is_dir: boolean; file_size?: number }
export type RegisteredModel = { name: string; latest_versions: ModelVersion[] }
export type ModelVersion = {
  name: string
  version: string
  current_stage: string
  status: string
  source: string
  run_id: string
  creation_timestamp: number
}

export type MlflowReadClient = {
  listExperiments(): Promise<Experiment[]>
  listRuns(experimentId: string, filter?: string): Promise<Run[]>
  compareRuns(runIds: string[]): Promise<RunComparison>
  listArtifacts(runId: string, path?: string): Promise<Artifact[]>
  listRegisteredModels(): Promise<RegisteredModel[]>
  getModelVersion(name: string, version: string): Promise<ModelVersion>
  transitionModelStage(name: string, version: string, stage: string): Promise<void>
}

export function createMlflowReadClient(config: {
  mlflowUrl: string
  tokenFn?: () => Promise<string>
}): MlflowReadClient {
  const client = createApiClient({
    baseUrl: config.mlflowUrl,
    tokenFn: config.tokenFn ?? (async () => null),
  })

  return {
    async listExperiments() {
      const res = await client.get<{ experiments: Experiment[] }>(
        "/api/2.0/mlflow/experiments/search",
      )
      return res.data.experiments ?? []
    },

    async listRuns(experimentId, filter) {
      const body: Record<string, unknown> = { experiment_ids: [experimentId] }
      if (filter) body.filter = filter
      const res = await client.post<{ runs: Run[] }>(
        "/api/2.0/mlflow/runs/search",
        body,
      )
      return res.data.runs ?? []
    },

    async compareRuns(runIds) {
      const runs = await Promise.all(
        runIds.map(async (id) => {
          const res = await client.get<{ run: Run }>(
            "/api/2.0/mlflow/runs/get",
            { run_id: id },
          )
          const run = res.data.run
          const params: Record<string, string> = {}
          for (const p of run.data.params) params[p.key] = p.value
          const metrics: Record<string, number> = {}
          for (const m of run.data.metrics) metrics[m.key] = m.value
          return { runId: id, params, metrics }
        }),
      )
      return { runs }
    },

    async listArtifacts(runId, path) {
      const query: Record<string, string> = { run_id: runId }
      if (path) query.path = path
      const res = await client.get<{ files: Artifact[] }>(
        "/api/2.0/mlflow/artifacts/list",
        query,
      )
      return res.data.files ?? []
    },

    async listRegisteredModels() {
      const res = await client.get<{ registered_models: RegisteredModel[] }>(
        "/api/2.0/mlflow/registered-models/search",
      )
      return res.data.registered_models ?? []
    },

    async getModelVersion(name, version) {
      const res = await client.get<{ model_version: ModelVersion }>(
        "/api/2.0/mlflow/model-versions/get",
        { name, version },
      )
      return res.data.model_version
    },

    async transitionModelStage(name, version, stage) {
      await client.post(
        "/api/2.0/mlflow/model-versions/transition-stage",
        { name, version, stage, archive_existing_versions: true },
      )
    },
  }
}
