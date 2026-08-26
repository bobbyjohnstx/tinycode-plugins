import { describe, it, expect } from "bun:test"
import type { ToolContext } from "tinycode-plugin"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import {
  createPipelineTools,
  createUnconfiguredPipelineTools,
} from "../src/index"
import type {
  PipelineClient,
  Pipeline,
  PipelineRunDetail,
} from "../src/pipeline-client"
import plugin from "../src/index"

function createMockPipelineClient(
  overrides: Partial<PipelineClient> = {},
): PipelineClient {
  return {
    listPipelines: async () => [],
    listRuns: async () => [],
    getRunStatus: async () => ({
      run_id: "run-1",
      display_name: "test-run",
      pipeline_id: "pipe-1",
      state: "SUCCEEDED",
      created_at: "2024-01-01T00:00:00Z",
      tasks: [],
    }),
    createRun: async () => "run-1",
    createPipeline: async () => "pipe-1",
    ...overrides,
  }
}

const mockCtx = {
  ask: async () => {},
} as unknown as ToolContext

const denyCtx = {
  ask: async () => {
    throw new Error("Permission denied")
  },
} as unknown as ToolContext

const samplePipelines: Pipeline[] = [
  {
    pipeline_id: "pipe-abc",
    display_name: "training-pipeline",
    description: "Trains the sentiment model",
    created_at: "2024-01-15T10:00:00Z",
  },
  {
    pipeline_id: "pipe-def",
    display_name: "inference-pipeline",
    created_at: "2024-02-01T12:00:00Z",
  },
]

const sampleRunDetail: PipelineRunDetail = {
  run_id: "run-abc-123",
  display_name: "training-run-1",
  pipeline_id: "pipe-abc",
  state: "RUNNING",
  created_at: "2024-03-01T08:00:00Z",
  tasks: [
    {
      task_id: "task-1",
      display_name: "data-preprocessing",
      state: "SUCCEEDED",
      start_time: "2024-03-01T08:00:00Z",
      end_time: "2024-03-01T08:05:00Z",
    },
    {
      task_id: "task-2",
      display_name: "model-training",
      state: "RUNNING",
      start_time: "2024-03-01T08:05:00Z",
    },
    {
      task_id: "task-3",
      display_name: "model-evaluation",
      state: "PENDING",
    },
  ],
}

const completedRunDetail: PipelineRunDetail = {
  run_id: "run-def-456",
  display_name: "training-run-2",
  pipeline_id: "pipe-abc",
  state: "SUCCEEDED",
  created_at: "2024-03-01T08:00:00Z",
  finished_at: "2024-03-01T09:00:00Z",
  tasks: [
    {
      task_id: "task-1",
      display_name: "data-preprocessing",
      state: "SUCCEEDED",
    },
    {
      task_id: "task-2",
      display_name: "model-training",
      state: "SUCCEEDED",
    },
  ],
}

describe("tinycode-plugin-rhoai-pipelines", () => {
  describe("plugin loading", () => {
    it("loads without error", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      expect(hooks).toBeDefined()
      expect(hooks.tool).toBeDefined()
    })

    it("registers all four tools", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      const toolNames = Object.keys(hooks.tool!)
      expect(toolNames).toHaveLength(4)
      expect(toolNames).toContain("rhoai_pipeline_list")
      expect(toolNames).toContain("rhoai_pipeline_run")
      expect(toolNames).toContain("rhoai_pipeline_status")
      expect(toolNames).toContain("rhoai_pipeline_create")
    })

    it("all tools have descriptions", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      for (const [_name, tool] of Object.entries(hooks.tool!)) {
        expect(tool.description).toBeTruthy()
        expect(typeof tool.description).toBe("string")
      }
    })

    it("returns unconfigured message when pipelinesUrl not set", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      const tools = hooks.tool!
      const results = await Promise.all([
        tools.rhoai_pipeline_list.execute({}, {} as never),
        tools.rhoai_pipeline_run.execute(
          { pipelineId: "p1" },
          {} as never,
        ),
        tools.rhoai_pipeline_status.execute(
          { runId: "r1" },
          {} as never,
        ),
        tools.rhoai_pipeline_create.execute(
          { yaml: "apiVersion: v1" },
          {} as never,
        ),
      ])
      for (const result of results) {
        expect(result as string).toContain("not configured")
      }
    })
  })

  describe("rhoai_pipeline_list", () => {
    it("lists pipelines", async () => {
      const client = createMockPipelineClient({
        listPipelines: async () => samplePipelines,
      })
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_list.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("Pipelines: 2")
      expect(result).toContain("training-pipeline")
      expect(result).toContain("pipe-abc")
      expect(result).toContain("Trains the sentiment model")
      expect(result).toContain("inference-pipeline")
    })

    it("returns empty when no pipelines", async () => {
      const client = createMockPipelineClient()
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_list.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("No pipelines found")
    })

    it("returns error on failure", async () => {
      const client = createMockPipelineClient({
        listPipelines: async () => {
          throw new Error("Connection refused")
        },
      })
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_list.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("Failed to list pipelines")
      expect(result).toContain("Connection refused")
    })
  })

  describe("rhoai_pipeline_run", () => {
    it("triggers run after permission", async () => {
      let calledWith: { pipelineId: string; params: Record<string, string> } | undefined
      const client = createMockPipelineClient({
        createRun: async (pipelineId, params) => {
          calledWith = { pipelineId, params }
          return "run-new-123"
        },
      })
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_run.execute(
        { pipelineId: "pipe-abc", params: '{"epochs":"10"}' },
        mockCtx,
      )) as string
      expect(result).toContain("run-new-123")
      expect(calledWith?.pipelineId).toBe("pipe-abc")
      expect(calledWith?.params).toEqual({ epochs: "10" })
    })

    it("returns error on permission denied", async () => {
      const client = createMockPipelineClient()
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_run.execute(
        { pipelineId: "pipe-abc" },
        denyCtx,
      )) as string
      expect(result).toContain("Failed to trigger pipeline run")
      expect(result).toContain("Permission denied")
    })

    it("returns error on invalid params JSON", async () => {
      const client = createMockPipelineClient()
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_run.execute(
        { pipelineId: "pipe-abc", params: "not-json" },
        mockCtx,
      )) as string
      expect(result).toContain("Invalid params JSON")
    })
  })

  describe("rhoai_pipeline_status", () => {
    it("shows run status with tasks", async () => {
      const client = createMockPipelineClient({
        getRunStatus: async () => sampleRunDetail,
      })
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_status.execute(
        { runId: "run-abc-123" },
        {} as never,
      )) as string
      expect(result).toContain("training-run-1")
      expect(result).toContain("RUNNING")
      expect(result).toContain("Tasks:")
      expect(result).toContain("DONE data-preprocessing")
      expect(result).toContain("RUNNING model-training")
      expect(result).toContain("PENDING model-evaluation")
    })

    it("formats completed run", async () => {
      const client = createMockPipelineClient({
        getRunStatus: async () => completedRunDetail,
      })
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_status.execute(
        { runId: "run-def-456" },
        {} as never,
      )) as string
      expect(result).toContain("SUCCEEDED")
      expect(result).toContain("Finished:")
      expect(result).toContain("DONE data-preprocessing")
      expect(result).toContain("DONE model-training")
    })

    it("returns error on failure", async () => {
      const client = createMockPipelineClient({
        getRunStatus: async () => {
          throw new Error("Run not found")
        },
      })
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_status.execute(
        { runId: "bad-run" },
        {} as never,
      )) as string
      expect(result).toContain("Failed to get run status")
      expect(result).toContain("Run not found")
    })
  })

  describe("rhoai_pipeline_create", () => {
    it("creates pipeline after permission", async () => {
      const client = createMockPipelineClient({
        createPipeline: async () => "pipe-new-456",
      })
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_create.execute(
        { yaml: "apiVersion: pipeline/v1" },
        mockCtx,
      )) as string
      expect(result).toContain("pipe-new-456")
      expect(result).toContain("Pipeline created")
    })

    it("returns error on permission denied", async () => {
      const client = createMockPipelineClient()
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_create.execute(
        { yaml: "apiVersion: pipeline/v1" },
        denyCtx,
      )) as string
      expect(result).toContain("Failed to create pipeline")
      expect(result).toContain("Permission denied")
    })

    it("returns error on failure", async () => {
      const client = createMockPipelineClient({
        createPipeline: async () => {
          throw new Error("Invalid pipeline spec")
        },
      })
      const tools = createPipelineTools(client)
      const result = (await tools.rhoai_pipeline_create.execute(
        { yaml: "bad-yaml" },
        mockCtx,
      )) as string
      expect(result).toContain("Failed to create pipeline")
      expect(result).toContain("Invalid pipeline spec")
    })
  })
})
