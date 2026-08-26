import { describe, it, expect, beforeEach, mock } from "bun:test"
import {
  createMockInput,
  createMockFetch,
} from "tinycode-plugin-redhat-shared/test-utils"
import type { MockRoute } from "tinycode-plugin-redhat-shared/test-utils"
import {
  createLastSessionBlock,
  fetchLastRun,
  createSystemTransformHook,
} from "../src/read-side"
import type { LastRunInfo } from "../src/read-side"
import { createApiClient } from "tinycode-plugin-redhat-shared/api"
import plugin from "../src/index"

const MLFLOW_URL = "https://mlflow.example.com"

function readSideRoutes(overrides?: Partial<MockRoute>[]): MockRoute[] {
  const base: MockRoute[] = [
    {
      method: "GET",
      path: "/api/2.0/mlflow/experiments/get-by-name",
      body: { experiment: { experiment_id: "exp-1", name: "test" } },
    },
    {
      method: "POST",
      path: "/api/2.0/mlflow/runs/search",
      body: {
        runs: [
          {
            info: {
              run_id: "run-prev-1",
              status: "FINISHED",
              start_time: 1000000,
              end_time: 3700000,
            },
            data: {
              metrics: [
                { key: "accuracy", value: 0.85 },
                { key: "loss", value: 0.12 },
              ],
              params: [{ key: "model", value: "granite-3.3-8b" }],
            },
          },
        ],
      },
    },
    {
      method: "POST",
      path: "/api/2.0/mlflow/experiments/create",
      body: { experiment_id: "exp-new" },
    },
    {
      method: "POST",
      path: "/api/2.0/mlflow/runs/create",
      body: { run: { info: { run_id: "run-1" } } },
    },
    {
      method: "POST",
      path: "/api/2.0/mlflow/runs/log-metric",
      body: {},
    },
    {
      method: "POST",
      path: "/api/2.0/mlflow/runs/log-param",
      body: {},
    },
    {
      method: "POST",
      path: "/api/2.0/mlflow/runs/update",
      body: {},
    },
  ]

  if (overrides) {
    for (const override of overrides) {
      const idx = base.findIndex(
        (r) =>
          r.path === override.path &&
          (override.method ?? "GET") === (r.method ?? "GET"),
      )
      if (idx >= 0) {
        base[idx] = { ...base[idx]!, ...override }
      } else {
        base.push(override as MockRoute)
      }
    }
  }

  return base
}

describe("createLastSessionBlock", () => {
  it("formats run info with all fields", () => {
    const info: LastRunInfo = {
      runId: "run-42",
      status: "FINISHED",
      metrics: { accuracy: 0.85, loss: 0.12 },
      params: { model: "granite-3.3-8b" },
      duration: 2700,
    }

    const block = createLastSessionBlock(info)

    expect(block).toContain("<last-session>")
    expect(block).toContain("</last-session>")
    expect(block).toContain("run=run-42")
    expect(block).toContain("status=FINISHED")
    expect(block).toContain("duration=45m")
    expect(block).toContain("accuracy=0.85")
    expect(block).toContain("loss=0.12")
    expect(block).toContain("model=granite-3.3-8b")
  })

  it("returns empty string for null", () => {
    const block = createLastSessionBlock(null)
    expect(block).toBe("")
  })

  it("formats run without duration or params", () => {
    const info: LastRunInfo = {
      runId: "run-99",
      status: "FINISHED",
      metrics: { accuracy: 0.9 },
      params: {},
    }

    const block = createLastSessionBlock(info)

    expect(block).toContain("run=run-99")
    expect(block).not.toContain("duration=")
    expect(block).not.toContain("params:")
    expect(block).toContain("accuracy=0.9")
  })
})

describe("fetchLastRun", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  function restoreFetch() {
    globalThis.fetch = originalFetch
  }

  it("queries MLFlow and returns last run info", async () => {
    globalThis.fetch = createMockFetch(readSideRoutes())
    try {
      const api = createApiClient({
        baseUrl: MLFLOW_URL,
        tokenFn: async () => "",
      })

      const result = await fetchLastRun(api, "test-experiment")

      expect(result).not.toBeNull()
      expect(result!.runId).toBe("run-prev-1")
      expect(result!.status).toBe("FINISHED")
      expect(result!.metrics.accuracy).toBe(0.85)
      expect(result!.metrics.loss).toBe(0.12)
      expect(result!.params.model).toBe("granite-3.3-8b")
      expect(result!.duration).toBe(2700)
    } finally {
      restoreFetch()
    }
  })

  it("returns null when no prior runs exist", async () => {
    const routes = readSideRoutes([
      {
        method: "POST",
        path: "/api/2.0/mlflow/runs/search",
        body: { runs: [] },
      },
    ])
    globalThis.fetch = createMockFetch(routes)
    try {
      const api = createApiClient({
        baseUrl: MLFLOW_URL,
        tokenFn: async () => "",
      })

      const result = await fetchLastRun(api, "test-experiment")
      expect(result).toBeNull()
    } finally {
      restoreFetch()
    }
  })

  it("throws when MLFlow is unreachable", async () => {
    const failFetch = mock(() => {
      return Promise.reject(new Error("Connection refused"))
    }) as unknown as typeof fetch

    globalThis.fetch = failFetch
    try {
      const api = createApiClient({
        baseUrl: MLFLOW_URL,
        tokenFn: async () => "",
      })

      await expect(fetchLastRun(api, "test-experiment")).rejects.toThrow()
    } finally {
      restoreFetch()
    }
  })
})

describe("createSystemTransformHook", () => {
  it("injects last-session block into system prompt", async () => {
    const lastRunRef: { current: LastRunInfo | null } = {
      current: {
        runId: "run-77",
        status: "FINISHED",
        metrics: { accuracy: 0.92 },
        params: { lr: "0.001" },
        duration: 600,
      },
    }

    const hook = createSystemTransformHook(lastRunRef)
    const output = { system: ["existing system prompt"] }
    await hook({ sessionID: "s1", model: {} }, output)

    expect(output.system.length).toBe(2)
    expect(output.system[1]).toContain("<last-session>")
    expect(output.system[1]).toContain("run=run-77")
  })

  it("skips injection when no last run", async () => {
    const lastRunRef: { current: LastRunInfo | null } = { current: null }

    const hook = createSystemTransformHook(lastRunRef)
    const output = { system: ["existing system prompt"] }
    await hook({ sessionID: "s1", model: {} }, output)

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toBe("existing system prompt")
  })
})

describe("read-side integration with plugin", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  function restoreFetch() {
    globalThis.fetch = originalFetch
  }

  it("plugin includes system transform hook when mlflowUrl configured", async () => {
    globalThis.fetch = createMockFetch(readSideRoutes())
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      expect(hooks["experimental.chat.system.transform"]).toBeFunction()
    } finally {
      restoreFetch()
    }
  })

  it("plugin loads without mlflowUrl and omits read-side hooks", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)

    expect(hooks["experimental.chat.system.transform"]).toBeUndefined()
  })

  it("existing tools still work alongside read-side hooks", async () => {
    const calls: string[] = []

    const routes = readSideRoutes()
    const mockFetch = mock(
      (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        const method = init?.method ?? "GET"
        calls.push(`${method} ${url}`)

        const route = routes.find((r) => {
          const methodMatch =
            (r.method ?? "GET").toUpperCase() === method.toUpperCase()
          if (!methodMatch) return false
          if (typeof r.path === "string") return url.includes(r.path)
          return false
        })

        if (!route)
          return Promise.resolve(new Response("Not Found", { status: 404 }))
        return Promise.resolve(
          new Response(JSON.stringify(route.body), {
            status: route.status ?? 200,
          }),
        )
      },
    ) as unknown as typeof fetch

    globalThis.fetch = mockFetch
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      await hooks["session.start"]!({ sessionID: "sess-read" }, {})

      // Verify read-side query happened (runs/search for prior runs)
      const searchCall = calls.find((c) => c.includes("runs/search"))
      expect(searchCall).toBeDefined()

      // Verify write-side still works (experiment lookup + run creation)
      const getByName = calls.find((c) =>
        c.includes("experiments/get-by-name"),
      )
      expect(getByName).toBeDefined()

      const createRun = calls.find((c) => c.includes("runs/create"))
      expect(createRun).toBeDefined()

      // Tool tracking still works
      await hooks["tool.execute.after"]!(
        { tool: "shell", sessionID: "sess-read", callID: "c1", args: {} },
        { title: "", output: "", metadata: {} },
      )

      // System transform has last session data
      const output = { system: ["base prompt"] }
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-read", model: {} as never },
        output,
      )
      expect(output.system.length).toBe(2)
      expect(output.system[1]).toContain("run=run-prev-1")
    } finally {
      restoreFetch()
    }
  })
})
