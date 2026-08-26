import { describe, it, expect } from "bun:test"
import {
  createMockShell,
  createMockInput,
} from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const sampleInferenceServices = {
  items: [
    {
      metadata: { name: "granite-code", namespace: "rhoai-models" },
      spec: {
        predictor: {
          model: {
            modelFormat: { name: "vLLM" },
            runtime: "vllm-runtime",
            storageUri: "s3://models/granite-code",
          },
        },
      },
      status: {
        url: "https://granite-code-rhoai-models.apps.cluster.example.com",
        conditions: [{ type: "Ready", status: "True" }],
      },
    },
    {
      metadata: { name: "llama-2", namespace: "rhoai-models" },
      spec: {
        predictor: {
          model: {
            modelFormat: { name: "vLLM" },
            runtime: "vllm-runtime",
            storageUri: "s3://models/llama-2",
          },
        },
      },
      status: {
        url: "https://llama-2-rhoai-models.apps.cluster.example.com",
        conditions: [{ type: "Ready", status: "False" }],
      },
    },
  ],
}

const sampleServingRuntimes = {
  items: [
    {
      metadata: { name: "vllm-runtime", namespace: "rhoai-models" },
      spec: {
        supportedModelFormats: [{ name: "vLLM", autoSelect: true }],
        containers: [
          {
            name: "kserve-container",
            image: "quay.io/modh/vllm:latest",
          },
        ],
      },
    },
    {
      metadata: { name: "caikit-runtime", namespace: "rhoai-models" },
      spec: {
        supportedModelFormats: [
          { name: "caikit", autoSelect: true },
        ],
        containers: [
          {
            name: "kserve-container",
            image: "quay.io/modh/caikit-tgis-serving:latest",
          },
        ],
      },
    },
  ],
}

const sampleSingleModel = {
  metadata: { name: "granite-code", namespace: "rhoai-models" },
  spec: {
    predictor: {
      model: {
        modelFormat: { name: "vLLM" },
        runtime: "vllm-runtime",
        storageUri: "s3://models/granite-code",
      },
    },
  },
  status: {
    url: "https://granite-code-rhoai-models.apps.cluster.example.com",
    conditions: [
      { type: "Ready", status: "True" },
      { type: "PredictorReady", status: "True", reason: "Deployed" },
    ],
  },
}

const samplePods = {
  items: [
    {
      metadata: { name: "granite-code-predictor-abc123" },
      spec: {
        containers: [
          {
            name: "kserve-container",
            resources: {
              limits: { "nvidia.com/gpu": "1", memory: "16Gi" },
              requests: { "nvidia.com/gpu": "1", memory: "16Gi" },
            },
          },
        ],
      },
      status: { phase: "Running" },
    },
  ],
}

describe("tinycode-plugin-rhoai-models", () => {
  it("loads without error", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks).toBeDefined()
  })

  it("registers all three tools", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks.tool).toBeDefined()
    const toolNames = Object.keys(hooks.tool!)
    expect(toolNames).toContain("rhoai_list_models")
    expect(toolNames).toContain("rhoai_model_status")
    expect(toolNames).toContain("rhoai_list_runtimes")
    expect(toolNames).toHaveLength(3)
  })

  describe("rhoai_list_models", () => {
    it("returns formatted model list", async () => {
      const shell = createMockShell([
        {
          match: /oc.*get.*inferenceservices/,
          output: JSON.stringify(sampleInferenceServices),
          json: sampleInferenceServices,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.rhoai_list_models!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Models found: 2")
      expect(result).toContain("granite-code")
      expect(result).toContain("llama-2")
      expect(result).toContain("Ready")
      expect(result).toContain("Not Ready")
      expect(result).toContain("vLLM")
      expect(result).toContain("vllm-runtime")
    })

    it("passes namespace from args", async () => {
      const emptyList = { items: [] }
      const shell = createMockShell([
        {
          match: /oc.*get.*inferenceservices.*--namespace.*custom-ns/,
          output: JSON.stringify(emptyList),
          json: emptyList,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.rhoai_list_models!.execute(
        { namespace: "custom-ns" },
        undefined as any,
      )
      expect(result).toContain("No InferenceService resources found")
    })

    it("uses configured namespace from options", async () => {
      const emptyList = { items: [] }
      const shell = createMockShell([
        {
          match: /oc.*get.*inferenceservices.*--namespace.*configured-ns/,
          output: JSON.stringify(emptyList),
          json: emptyList,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, { namespace: "configured-ns" })
      const result = await hooks.tool!.rhoai_list_models!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("No InferenceService resources found")
    })

    it("returns error when oc command fails", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.rhoai_list_models!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Error listing models")
    })
  })

  describe("rhoai_model_status", () => {
    it("returns detailed model status with pods", async () => {
      const shell = createMockShell([
        {
          match: /oc.*get.*inferenceservices\/granite-code/,
          output: JSON.stringify(sampleSingleModel),
          json: sampleSingleModel,
        },
        {
          match: /oc.*get.*pods.*--selector.*serving\.kserve\.io\/inferenceservice=granite-code/,
          output: JSON.stringify(samplePods),
          json: samplePods,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.rhoai_model_status!.execute(
        { name: "granite-code" },
        undefined as any,
      )
      expect(result).toContain("Model: granite-code")
      expect(result).toContain("Namespace: rhoai-models")
      expect(result).toContain("Format: vLLM")
      expect(result).toContain("Status: Ready")
      expect(result).toContain("Storage: s3://models/granite-code")
      expect(result).toContain("Conditions:")
      expect(result).toContain("PredictorReady: True (Deployed)")
      expect(result).toContain("granite-code-predictor-abc123")
      expect(result).toContain("GPU: 1")
    })

    it("handles missing pods gracefully", async () => {
      const shell = createMockShell([
        {
          match: /oc.*get.*inferenceservices\/granite-code/,
          output: JSON.stringify(sampleSingleModel),
          json: sampleSingleModel,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.rhoai_model_status!.execute(
        { name: "granite-code" },
        undefined as any,
      )
      expect(result).toContain("Model: granite-code")
      expect(result).toContain("Pods: none found")
    })

    it("passes namespace from args", async () => {
      const shell = createMockShell([
        {
          match: /oc.*get.*inferenceservices\/test-model.*--namespace.*my-ns/,
          output: JSON.stringify(sampleSingleModel),
          json: sampleSingleModel,
        },
        {
          match: /oc.*get.*pods.*--namespace.*my-ns/,
          output: JSON.stringify({ items: [] }),
          json: { items: [] },
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.rhoai_model_status!.execute(
        { name: "test-model", namespace: "my-ns" },
        undefined as any,
      )
      expect(result).toContain("Model: granite-code")
    })

    it("returns error when model not found", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.rhoai_model_status!.execute(
        { name: "nonexistent" },
        undefined as any,
      )
      expect(result).toContain("Error getting model status")
    })
  })

  describe("rhoai_list_runtimes", () => {
    it("returns formatted runtime list", async () => {
      const shell = createMockShell([
        {
          match: /oc.*get.*servingruntimes/,
          output: JSON.stringify(sampleServingRuntimes),
          json: sampleServingRuntimes,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.rhoai_list_runtimes!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("ServingRuntimes found: 2")
      expect(result).toContain("vllm-runtime")
      expect(result).toContain("caikit-runtime")
      expect(result).toContain("quay.io/modh/vllm:latest")
      expect(result).toContain("Supported formats: vLLM")
    })

    it("returns empty message when no runtimes found", async () => {
      const emptyList = { items: [] }
      const shell = createMockShell([
        {
          match: /oc.*get.*servingruntimes/,
          output: JSON.stringify(emptyList),
          json: emptyList,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.rhoai_list_runtimes!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("No ServingRuntime resources found")
    })

    it("returns error when oc command fails", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.rhoai_list_runtimes!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Error listing runtimes")
    })
  })

  describe("tool descriptions", () => {
    it("all tools have descriptions", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      for (const [_name, tool] of Object.entries(hooks.tool!)) {
        expect(tool.description).toBeTruthy()
        expect(typeof tool.description).toBe("string")
      }
    })
  })
})
