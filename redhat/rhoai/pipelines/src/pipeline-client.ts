import { createApiClient } from "tinycode-plugin-redhat-shared/api"
import type { ApiClient } from "tinycode-plugin-redhat-shared/api"

export type Pipeline = {
  pipeline_id: string
  display_name: string
  description?: string
  created_at: string
}

export type PipelineTask = {
  task_id: string
  display_name: string
  state: string
  start_time?: string
  end_time?: string
}

export type PipelineRun = {
  run_id: string
  display_name: string
  pipeline_id: string
  state: string
  created_at: string
  finished_at?: string
  error?: string
}

export type PipelineRunDetail = PipelineRun & {
  tasks: PipelineTask[]
}

export type PipelineClient = {
  listPipelines(namespace?: string): Promise<Pipeline[]>
  listRuns(pipelineId?: string): Promise<PipelineRun[]>
  getRunStatus(runId: string): Promise<PipelineRunDetail>
  createRun(pipelineId: string, params: Record<string, string>): Promise<string>
  createPipeline(yaml: string): Promise<string>
}

export function createPipelineClient(config: {
  apiUrl: string
  tokenFn?: () => Promise<string>
}): PipelineClient {
  const client = createApiClient({
    baseUrl: config.apiUrl,
    tokenFn: config.tokenFn ?? (async () => ""),
  })

  return {
    async listPipelines(namespace) {
      const query: Record<string, string> = {}
      if (namespace) query.namespace = namespace
      const res = await client.get<{ pipelines: Pipeline[] }>(
        "/apis/v2beta1/pipelines",
        query,
      )
      return res.data.pipelines ?? []
    },

    async listRuns(pipelineId) {
      const query: Record<string, string> = {}
      if (pipelineId) query.pipeline_id = pipelineId
      const res = await client.get<{ runs: PipelineRun[] }>(
        "/apis/v2beta1/runs",
        query,
      )
      return res.data.runs ?? []
    },

    async getRunStatus(runId) {
      const res = await client.get<PipelineRunDetail>(
        `/apis/v2beta1/runs/${runId}`,
      )
      return res.data
    },

    async createRun(pipelineId, params) {
      const body = {
        pipeline_id: pipelineId,
        runtime_config: { parameters: params },
      }
      const res = await client.post<{ run_id: string }>(
        "/apis/v2beta1/runs",
        body,
      )
      return res.data.run_id
    },

    async createPipeline(yaml) {
      const res = await client.post<{ pipeline_id: string }>(
        "/apis/v2beta1/pipelines",
        { pipeline_spec: yaml },
      )
      return res.data.pipeline_id
    },
  }
}
