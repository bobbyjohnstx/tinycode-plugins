import { describe, it, expect } from "bun:test"
import type { ToolContext } from "tinycode-plugin"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import { createMlflowTools, createUnconfiguredMlflowTools } from "../src/index"
import type {
  MlflowReadClient,
  Experiment,
  Run,
  RunComparison,
  Artifact,
  RegisteredModel,
  ModelVersion,
} from "../src/mlflow-read-client"
import plugin from "../src/index"

type MlflowWriter = {
  logMetric(runId: string, key: string, value: number, step?: number): Promise<void>
}

function createMockReadClient(
  overrides: Partial<MlflowReadClient> = {},
): MlflowReadClient {
  return {
    listExperiments: async () => [],
    listRuns: async () => [],
    compareRuns: async () => ({ runs: [] }),
    listArtifacts: async () => [],
    listRegisteredModels: async () => [],
    getModelVersion: async () => ({
      name: "",
      version: "",
      current_stage: "",
      status: "",
      source: "",
      run_id: "",
      creation_timestamp: 0,
    }),
    transitionModelStage: async () => {},
    ...overrides,
  }
}

function createMockWriter(
  overrides: Partial<MlflowWriter> = {},
): MlflowWriter {
  return {
    logMetric: async () => {},
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

const sampleExperiments: Experiment[] = [
  {
    experiment_id: "1",
    name: "sentiment-analysis",
    artifact_location: "s3://mlflow/1",
    lifecycle_stage: "active",
    last_update_time: 1700000000000,
  },
  {
    experiment_id: "2",
    name: "image-classification",
    artifact_location: "s3://mlflow/2",
    lifecycle_stage: "deleted",
  },
]

const sampleRuns: Run[] = [
  {
    info: {
      run_id: "run-abc-123",
      experiment_id: "1",
      status: "FINISHED",
      start_time: 1700000000000,
      end_time: 1700003600000,
      artifact_uri: "s3://mlflow/1/run-abc-123/artifacts",
      lifecycle_stage: "active",
    },
    data: {
      metrics: [
        { key: "accuracy", value: 0.95, timestamp: 1700003600000, step: 0 },
        { key: "loss", value: 0.05, timestamp: 1700003600000, step: 0 },
      ],
      params: [
        { key: "learning_rate", value: "0.001" },
        { key: "epochs", value: "10" },
      ],
      tags: [{ key: "mlflow.runName", value: "baseline" }],
    },
  },
  {
    info: {
      run_id: "run-def-456",
      experiment_id: "1",
      status: "RUNNING",
      start_time: 1700010000000,
      artifact_uri: "s3://mlflow/1/run-def-456/artifacts",
      lifecycle_stage: "active",
    },
    data: {
      metrics: [],
      params: [{ key: "learning_rate", value: "0.01" }],
      tags: [],
    },
  },
]

const sampleComparison: RunComparison = {
  runs: [
    {
      runId: "run-abc-123",
      params: { learning_rate: "0.001", epochs: "10" },
      metrics: { accuracy: 0.95, loss: 0.05 },
    },
    {
      runId: "run-def-456",
      params: { learning_rate: "0.01", epochs: "20" },
      metrics: { accuracy: 0.97, loss: 0.03 },
    },
  ],
}

const sampleArtifacts: Artifact[] = [
  { path: "model", is_dir: true },
  { path: "model/weights.bin", is_dir: false, file_size: 1048576 },
  { path: "metrics.json", is_dir: false, file_size: 256 },
]

const sampleModels: RegisteredModel[] = [
  {
    name: "sentiment-model",
    latest_versions: [
      {
        name: "sentiment-model",
        version: "3",
        current_stage: "Production",
        status: "READY",
        source: "s3://mlflow/1/run-abc-123/artifacts/model",
        run_id: "run-abc-123",
        creation_timestamp: 1700000000000,
      },
    ],
  },
  {
    name: "image-classifier",
    latest_versions: [
      {
        name: "image-classifier",
        version: "1",
        current_stage: "Staging",
        status: "READY",
        source: "s3://mlflow/2/run-xyz/artifacts/model",
        run_id: "run-xyz",
        creation_timestamp: 1700050000000,
      },
    ],
  },
]

const sampleModelVersion: ModelVersion = {
  name: "sentiment-model",
  version: "3",
  current_stage: "Production",
  status: "READY",
  source: "s3://mlflow/1/run-abc-123/artifacts/model",
  run_id: "run-abc-123",
  creation_timestamp: 1700000000000,
}

describe("tinycode-plugin-mlflow-tools", () => {
  describe("plugin loading", () => {
    it("loads without error", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      expect(hooks).toBeDefined()
      expect(hooks.tool).toBeDefined()
    })

    it("registers all eight tools", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      const toolNames = Object.keys(hooks.tool!)
      expect(toolNames).toHaveLength(8)
      expect(toolNames).toContain("mlflow_experiments")
      expect(toolNames).toContain("mlflow_runs")
      expect(toolNames).toContain("mlflow_compare")
      expect(toolNames).toContain("mlflow_artifacts")
      expect(toolNames).toContain("mlflow_model_registry")
      expect(toolNames).toContain("mlflow_model_version")
      expect(toolNames).toContain("mlflow_promote")
      expect(toolNames).toContain("mlflow_log_metric")
    })

    it("all tools have descriptions", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      for (const [_name, tool] of Object.entries(hooks.tool!)) {
        expect(tool.description).toBeTruthy()
        expect(typeof tool.description).toBe("string")
      }
    })

    it("returns unconfigured message when mlflowUrl not set", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      const tools = hooks.tool!
      const results = await Promise.all([
        tools.mlflow_experiments.execute({}, {} as never),
        tools.mlflow_runs.execute({ experimentId: "1" }, {} as never),
        tools.mlflow_compare.execute({ runIds: ["a", "b"] }, {} as never),
        tools.mlflow_artifacts.execute({ runId: "a" }, {} as never),
        tools.mlflow_model_registry.execute({}, {} as never),
        tools.mlflow_model_version.execute({ name: "m", version: "1" }, {} as never),
        tools.mlflow_promote.execute({ name: "m", version: "1", stage: "Staging" }, {} as never),
        tools.mlflow_log_metric.execute({ runId: "a", key: "k", value: 1 }, {} as never),
      ])
      for (const result of results) {
        expect(result as string).toContain("not configured")
      }
    })
  })

  describe("mlflow_experiments", () => {
    it("lists experiments", async () => {
      const readClient = createMockReadClient({
        listExperiments: async () => sampleExperiments,
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_experiments.execute({}, {} as never)) as string
      expect(result).toContain("Experiments: 2")
      expect(result).toContain("sentiment-analysis")
      expect(result).toContain("id: 1")
      expect(result).toContain("[active]")
      expect(result).toContain("image-classification")
      expect(result).toContain("[deleted]")
    })

    it("returns empty message when no experiments", async () => {
      const readClient = createMockReadClient()
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_experiments.execute({}, {} as never)) as string
      expect(result).toContain("No experiments found")
    })

    it("returns error on failure", async () => {
      const readClient = createMockReadClient({
        listExperiments: async () => {
          throw new Error("Connection refused")
        },
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_experiments.execute({}, {} as never)) as string
      expect(result).toContain("Failed to list experiments")
      expect(result).toContain("Connection refused")
    })
  })

  describe("mlflow_runs", () => {
    it("lists runs for experiment", async () => {
      const readClient = createMockReadClient({
        listRuns: async () => sampleRuns,
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_runs.execute(
        { experimentId: "1" },
        {} as never,
      )) as string
      expect(result).toContain("Runs: 2")
      expect(result).toContain("run-abc-123")
      expect(result).toContain("[FINISHED]")
      expect(result).toContain("accuracy=0.95")
      expect(result).toContain("run-def-456")
      expect(result).toContain("[RUNNING]")
    })

    it("returns error on failure", async () => {
      const readClient = createMockReadClient({
        listRuns: async () => {
          throw new Error("Experiment not found")
        },
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_runs.execute(
        { experimentId: "999" },
        {} as never,
      )) as string
      expect(result).toContain("Failed to list runs")
      expect(result).toContain("Experiment not found")
    })
  })

  describe("mlflow_compare", () => {
    it("compares runs side-by-side", async () => {
      const readClient = createMockReadClient({
        compareRuns: async () => sampleComparison,
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_compare.execute(
        { runIds: ["run-abc-123", "run-def-456"] },
        {} as never,
      )) as string
      expect(result).toContain("Comparing 2 runs")
      expect(result).toContain("param:learning_rate")
      expect(result).toContain("param:epochs")
      expect(result).toContain("metric:accuracy")
      expect(result).toContain("metric:loss")
      expect(result).toContain("0.001")
      expect(result).toContain("0.01")
      expect(result).toContain("0.95")
      expect(result).toContain("0.97")
    })

    it("handles comparison error", async () => {
      const readClient = createMockReadClient({
        compareRuns: async () => {
          throw new Error("Run not found")
        },
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_compare.execute(
        { runIds: ["bad-1", "bad-2"] },
        {} as never,
      )) as string
      expect(result).toContain("Failed to compare runs")
      expect(result).toContain("Run not found")
    })
  })

  describe("mlflow_artifacts", () => {
    it("lists artifacts for run", async () => {
      const readClient = createMockReadClient({
        listArtifacts: async () => sampleArtifacts,
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_artifacts.execute(
        { runId: "run-abc-123" },
        {} as never,
      )) as string
      expect(result).toContain("Artifacts: 3")
      expect(result).toContain("model [dir]")
      expect(result).toContain("model/weights.bin [file]")
      expect(result).toContain("1048576 bytes")
      expect(result).toContain("metrics.json [file]")
    })

    it("returns error on failure", async () => {
      const readClient = createMockReadClient({
        listArtifacts: async () => {
          throw new Error("Run not found")
        },
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_artifacts.execute(
        { runId: "bad-run" },
        {} as never,
      )) as string
      expect(result).toContain("Failed to list artifacts")
      expect(result).toContain("Run not found")
    })
  })

  describe("mlflow_model_registry", () => {
    it("lists registered models", async () => {
      const readClient = createMockReadClient({
        listRegisteredModels: async () => sampleModels,
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_model_registry.execute({}, {} as never)) as string
      expect(result).toContain("Registered models: 2")
      expect(result).toContain("sentiment-model")
      expect(result).toContain("v3")
      expect(result).toContain("[Production]")
      expect(result).toContain("image-classifier")
      expect(result).toContain("v1")
      expect(result).toContain("[Staging]")
    })

    it("returns empty message when no models", async () => {
      const readClient = createMockReadClient()
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_model_registry.execute({}, {} as never)) as string
      expect(result).toContain("No registered models found")
    })
  })

  describe("mlflow_model_version", () => {
    it("gets model version details", async () => {
      const readClient = createMockReadClient({
        getModelVersion: async () => sampleModelVersion,
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_model_version.execute(
        { name: "sentiment-model", version: "3" },
        {} as never,
      )) as string
      expect(result).toContain("Model: sentiment-model v3")
      expect(result).toContain("Stage: Production")
      expect(result).toContain("Status: READY")
      expect(result).toContain("Source: s3://mlflow/1/run-abc-123/artifacts/model")
      expect(result).toContain("Run ID: run-abc-123")
    })

    it("returns error on failure", async () => {
      const readClient = createMockReadClient({
        getModelVersion: async () => {
          throw new Error("Model not found")
        },
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_model_version.execute(
        { name: "bad-model", version: "99" },
        {} as never,
      )) as string
      expect(result).toContain("Failed to get model version")
      expect(result).toContain("Model not found")
    })
  })

  describe("mlflow_promote", () => {
    it("transitions model stage after permission", async () => {
      let transitioned = false
      const readClient = createMockReadClient({
        transitionModelStage: async () => {
          transitioned = true
        },
      })
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_promote.execute(
        { name: "sentiment-model", version: "3", stage: "Staging" },
        mockCtx,
      )) as string
      expect(result).toContain("transitioned to Staging")
      expect(transitioned).toBe(true)
    })

    it("returns error when permission denied", async () => {
      const readClient = createMockReadClient()
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_promote.execute(
        { name: "sentiment-model", version: "3", stage: "Production" },
        denyCtx,
      )) as string
      expect(result).toContain("Failed to promote model")
      expect(result).toContain("Permission denied")
    })

    it("validates stage value", async () => {
      const readClient = createMockReadClient()
      const tools = createMlflowTools(readClient, createMockWriter())
      const result = (await tools.mlflow_promote.execute(
        { name: "m", version: "1", stage: "InvalidStage" },
        mockCtx,
      )) as string
      expect(result).toContain("Invalid stage")
      expect(result).toContain("Staging")
      expect(result).toContain("Production")
      expect(result).toContain("Archived")
    })
  })

  describe("mlflow_log_metric", () => {
    it("logs metric to run", async () => {
      let logged = false
      const writer = createMockWriter({
        logMetric: async () => {
          logged = true
        },
      })
      const tools = createMlflowTools(createMockReadClient(), writer)
      const result = (await tools.mlflow_log_metric.execute(
        { runId: "run-abc-123", key: "accuracy", value: 0.99 },
        {} as never,
      )) as string
      expect(result).toContain("Logged metric accuracy=0.99")
      expect(result).toContain("run-abc-123")
      expect(logged).toBe(true)
    })

    it("returns error on failure", async () => {
      const writer = createMockWriter({
        logMetric: async () => {
          throw new Error("Run is not active")
        },
      })
      const tools = createMlflowTools(createMockReadClient(), writer)
      const result = (await tools.mlflow_log_metric.execute(
        { runId: "bad-run", key: "loss", value: 0.5 },
        {} as never,
      )) as string
      expect(result).toContain("Failed to log metric")
      expect(result).toContain("Run is not active")
    })
  })
})
