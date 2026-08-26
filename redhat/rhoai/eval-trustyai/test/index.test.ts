import { describe, it, expect, beforeEach } from "bun:test"
import type { ToolContext } from "tinycode-plugin"
import {
  createMockShell,
  createMockInput,
  createMockFetch,
} from "tinycode-plugin-redhat-shared/test-utils"
import type { MockRoute } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"
import {
  createEvalTools,
  createUnconfiguredEvalTools,
  createTrustyTools,
  createUnconfiguredTrustyTools,
  createWorkbenchTools,
} from "../src/index"
import type { EvalClient, EvalResult } from "../src/eval-client"
import type { TrustyAIClient, TrustyMetrics, TrustyAlert } from "../src/trustyai-client"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"

const mockCtx = {
  ask: async () => {},
} as unknown as ToolContext

const denyCtx = {
  ask: async () => {
    throw new Error("Permission denied")
  },
} as unknown as ToolContext

function createMockEvalClient(
  overrides: Partial<EvalClient> = {},
): EvalClient {
  return {
    runEval: async () => "eval-001",
    getEvalStatus: async () => ({
      eval_id: "eval-001",
      status: "pending",
      model: "granite-3b",
      provider: "lm-eval",
      created_at: "2026-08-25T10:00:00Z",
    }),
    compareEvals: async () => ({ evals: [] }),
    ...overrides,
  }
}

function createMockTrustyClient(
  overrides: Partial<TrustyAIClient> = {},
): TrustyAIClient {
  return {
    getMetrics: async () => ({
      model: "granite-3b",
      driftScore: 0.05,
      biasMetrics: {},
      featureDistributions: {},
    }),
    getAlerts: async () => [],
    ...overrides,
  }
}

const sampleCompletedEval: EvalResult = {
  eval_id: "eval-001",
  status: "completed",
  model: "granite-3b",
  provider: "lm-eval",
  results: { mmlu: 0.72, hellaswag: 0.65 },
  created_at: "2026-08-25T10:00:00Z",
  completed_at: "2026-08-25T10:30:00Z",
}

const samplePendingEval: EvalResult = {
  eval_id: "eval-002",
  status: "pending",
  model: "llama-2",
  provider: "ragas",
  created_at: "2026-08-25T11:00:00Z",
}

const sampleMetrics: TrustyMetrics = {
  model: "granite-3b",
  driftScore: 0.12,
  biasMetrics: { gender: 0.03, age: 0.07 },
  featureDistributions: {
    income: { mean: 50000, stddev: 15000 },
    age: { mean: 35, stddev: 10 },
  },
}

const sampleAlerts: TrustyAlert[] = [
  {
    id: "alert-1",
    type: "drift",
    model: "granite-3b",
    metric: "psi",
    threshold: 0.1,
    currentValue: 0.15,
    severity: "warning",
    triggeredAt: "2026-08-25T09:00:00Z",
  },
  {
    id: "alert-2",
    type: "bias",
    model: "llama-2",
    metric: "demographic_parity",
    threshold: 0.05,
    currentValue: 0.09,
    severity: "critical",
    triggeredAt: "2026-08-25T08:30:00Z",
  },
]

const sampleNotebooks = {
  items: [
    {
      metadata: { name: "my-workbench", namespace: "rhoai-project" },
      status: {
        readyReplicas: 1,
        conditions: [{ type: "Ready", status: "True" }],
      },
      spec: {
        template: {
          spec: {
            containers: [
              {
                image: "quay.io/modh/odh-minimal-notebook:latest",
                resources: {
                  limits: { "nvidia.com/gpu": "1", memory: "8Gi" },
                  requests: { "nvidia.com/gpu": "1", memory: "8Gi" },
                },
              },
            ],
          },
        },
      },
    },
    {
      metadata: { name: "stopped-workbench", namespace: "rhoai-project" },
      status: { readyReplicas: 0 },
      spec: {
        template: {
          spec: {
            containers: [
              {
                image: "quay.io/modh/odh-pytorch-notebook:latest",
                resources: { limits: { memory: "4Gi" } },
              },
            ],
          },
        },
      },
    },
  ],
}

describe("tinycode-plugin-rhoai-eval-trustyai", () => {
  it("loads without error", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks).toBeDefined()
  })

  it("registers all six tools", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks.tool).toBeDefined()
    const toolNames = Object.keys(hooks.tool!)
    expect(toolNames).toContain("rhoai_eval_run")
    expect(toolNames).toContain("rhoai_eval_status")
    expect(toolNames).toContain("rhoai_eval_compare")
    expect(toolNames).toContain("rhoai_trusty_metrics")
    expect(toolNames).toContain("rhoai_trusty_alerts")
    expect(toolNames).toContain("rhoai_workbench_list")
    expect(toolNames).toHaveLength(6)
  })

  it("all tools have descriptions", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    for (const [_name, tool] of Object.entries(hooks.tool!)) {
      expect(tool.description).toBeTruthy()
      expect(typeof tool.description).toBe("string")
    }
  })

  describe("eval tools", () => {
    it("returns unconfigured message when evalApiUrl not set", async () => {
      const tools = createUnconfiguredEvalTools()
      const result = await tools.rhoai_eval_run.execute(
        { model: "test", provider: "lm-eval" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("EvalHub not configured")
    })

    it("runs eval after permission", async () => {
      const evalClient = createMockEvalClient({
        runEval: async () => "eval-123",
      })
      const tools = createEvalTools(evalClient)
      const result = await tools.rhoai_eval_run.execute(
        { model: "granite-3b", provider: "lm-eval" },
        mockCtx,
      )
      expect(result).toContain("Evaluation started")
      expect(result).toContain("eval-123")
    })

    it("returns error on eval permission denied", async () => {
      const evalClient = createMockEvalClient()
      const tools = createEvalTools(evalClient)
      const result = await tools.rhoai_eval_run.execute(
        { model: "granite-3b", provider: "lm-eval" },
        denyCtx,
      )
      expect(result).toContain("Failed to run evaluation")
      expect(result).toContain("Permission denied")
    })

    it("gets eval status with results", async () => {
      const evalClient = createMockEvalClient({
        getEvalStatus: async () => sampleCompletedEval,
      })
      const tools = createEvalTools(evalClient)
      const result = await tools.rhoai_eval_status.execute(
        { evalId: "eval-001" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("eval-001")
      expect(result).toContain("completed")
      expect(result).toContain("granite-3b")
      expect(result).toContain("mmlu: 0.72")
      expect(result).toContain("hellaswag: 0.65")
    })

    it("gets eval status pending", async () => {
      const evalClient = createMockEvalClient({
        getEvalStatus: async () => samplePendingEval,
      })
      const tools = createEvalTools(evalClient)
      const result = await tools.rhoai_eval_status.execute(
        { evalId: "eval-002" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("eval-002")
      expect(result).toContain("pending")
      expect(result).toContain("llama-2")
      expect(result).not.toContain("Results:")
    })

    it("compares evals", async () => {
      const evalClient = createMockEvalClient({
        compareEvals: async () => ({
          evals: [
            sampleCompletedEval,
            {
              ...sampleCompletedEval,
              eval_id: "eval-002",
              model: "llama-2",
              results: { mmlu: 0.68, hellaswag: 0.61 },
            },
          ],
        }),
      })
      const tools = createEvalTools(evalClient)
      const result = await tools.rhoai_eval_compare.execute(
        { evalIds: ["eval-001", "eval-002"] },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("Evaluation Comparison")
      expect(result).toContain("granite-3b")
      expect(result).toContain("llama-2")
      expect(result).toContain("mmlu: 0.72")
      expect(result).toContain("mmlu: 0.68")
    })
  })

  describe("trustyai tools", () => {
    it("returns unconfigured when trustyaiUrl not set", async () => {
      const tools = createUnconfiguredTrustyTools()
      const result = await tools.rhoai_trusty_metrics.execute(
        { model: "test" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("TrustyAI not configured")
    })

    it("gets trusty metrics", async () => {
      const trustyClient = createMockTrustyClient({
        getMetrics: async () => sampleMetrics,
      })
      const tools = createTrustyTools(trustyClient)
      const result = await tools.rhoai_trusty_metrics.execute(
        { model: "granite-3b" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("granite-3b")
      expect(result).toContain("Drift Score: 0.12")
      expect(result).toContain("gender: 0.03")
      expect(result).toContain("age: 0.07")
      expect(result).toContain("income: mean=50000, stddev=15000")
    })

    it("lists trusty alerts", async () => {
      const trustyClient = createMockTrustyClient({
        getAlerts: async () => sampleAlerts,
      })
      const tools = createTrustyTools(trustyClient)
      const result = await tools.rhoai_trusty_alerts.execute(
        {},
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("Active Alerts (2)")
      expect(result).toContain("[WARNING] drift: granite-3b")
      expect(result).toContain("[CRITICAL] bias: llama-2")
      expect(result).toContain("threshold: 0.1")
      expect(result).toContain("threshold: 0.05")
    })

    it("returns no alerts message", async () => {
      const trustyClient = createMockTrustyClient({
        getAlerts: async () => [],
      })
      const tools = createTrustyTools(trustyClient)
      const result = await tools.rhoai_trusty_alerts.execute(
        {},
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("No active alerts")
    })

    it("returns error on failure", async () => {
      const trustyClient = createMockTrustyClient({
        getMetrics: async () => {
          throw new Error("connection refused")
        },
      })
      const tools = createTrustyTools(trustyClient)
      const result = await tools.rhoai_trusty_metrics.execute(
        { model: "granite-3b" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("Failed to get metrics")
      expect(result).toContain("connection refused")
    })
  })

  describe("workbench tools", () => {
    it("lists workbenches", async () => {
      const shell = createMockShell([
        {
          match: /oc.*get.*notebooks\.kubeflow\.org/,
          output: JSON.stringify(sampleNotebooks),
          json: sampleNotebooks,
        },
      ])
      const oc = createOcClient(shell)
      const tools = createWorkbenchTools(oc)
      const result = await tools.rhoai_workbench_list.execute(
        {},
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("Workbenches found: 2")
      expect(result).toContain("my-workbench")
      expect(result).toContain("Ready")
      expect(result).toContain("stopped-workbench")
      expect(result).toContain("Stopped")
      expect(result).toContain("GPU: 1")
      expect(result).toContain("GPU: none")
    })

    it("returns empty when no workbenches", async () => {
      const emptyList = { items: [] }
      const shell = createMockShell([
        {
          match: /oc.*get.*notebooks\.kubeflow\.org/,
          output: JSON.stringify(emptyList),
          json: emptyList,
        },
      ])
      const oc = createOcClient(shell)
      const tools = createWorkbenchTools(oc)
      const result = await tools.rhoai_workbench_list.execute(
        {},
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("No workbenches found")
    })

    it("returns error on oc failure", async () => {
      const shell = createMockShell([])
      const oc = createOcClient(shell)
      const tools = createWorkbenchTools(oc)
      const result = await tools.rhoai_workbench_list.execute(
        {},
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("Error listing workbenches")
    })
  })

  describe("mixed config", () => {
    it("eval tools unconfigured but workbench works", async () => {
      const shell = createMockShell([
        {
          match: /oc.*get.*notebooks\.kubeflow\.org/,
          output: JSON.stringify(sampleNotebooks),
          json: sampleNotebooks,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)

      const evalResult = await hooks.tool!.rhoai_eval_run.execute(
        { model: "test", provider: "lm-eval" },
        undefined as unknown as ToolContext,
      )
      expect(evalResult).toContain("EvalHub not configured")

      const wbResult = await hooks.tool!.rhoai_workbench_list.execute(
        {},
        undefined as unknown as ToolContext,
      )
      expect(wbResult).toContain("Workbenches found: 2")
    })
  })
})
