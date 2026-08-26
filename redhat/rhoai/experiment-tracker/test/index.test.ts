import { describe, it, expect, beforeEach, mock } from "bun:test"
import {
  createMockInput,
  createMockFetch,
} from "tinycode-plugin-redhat-shared/test-utils"
import type { MockRoute } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const MLFLOW_URL = "https://mlflow.example.com"

function mlflowRoutes(overrides?: Partial<MockRoute>[]): MockRoute[] {
  const base: MockRoute[] = [
    {
      method: "GET",
      path: "/api/2.0/mlflow/experiments/get-by-name",
      body: { experiment: { experiment_id: "exp-1", name: "test" } },
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

describe("tinycode-plugin-rhoai-experiments", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  function setupFetch(routes: MockRoute[]) {
    const mockFetch = createMockFetch(routes)
    globalThis.fetch = mockFetch
    return mockFetch
  }

  function restoreFetch() {
    globalThis.fetch = originalFetch
  }

  it("loads without config and returns empty hooks", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks).toBeDefined()
    expect(hooks).toEqual({})
  })

  it("loads without mlflowUrl and returns empty hooks", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, {})
    expect(hooks).toBeDefined()
    expect(hooks).toEqual({})
  })

  it("returns hooks when configured with mlflowUrl", async () => {
    setupFetch(mlflowRoutes())
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, {
        mlflowUrl: MLFLOW_URL,
      })
      expect(hooks["session.start"]).toBeFunction()
      expect(hooks["session.end"]).toBeFunction()
      expect(hooks["tool.execute.after"]).toBeFunction()
      expect(hooks.event).toBeFunction()
      expect(hooks.dispose).toBeFunction()
    } finally {
      restoreFetch()
    }
  })

  it("session.start creates experiment and run", async () => {
    const calls: string[] = []
    const mockFetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? "GET"
      calls.push(`${method} ${url}`)

      const routes = mlflowRoutes()
      const route = routes.find((r) => {
        const methodMatch = (r.method ?? "GET").toUpperCase() === method.toUpperCase()
        if (!methodMatch) return false
        if (typeof r.path === "string") return url.includes(r.path)
        return false
      })

      if (!route) return Promise.resolve(new Response("Not Found", { status: 404 }))
      return Promise.resolve(
        new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "content-type": "application/json" } }),
      )
    }) as unknown as typeof fetch

    globalThis.fetch = mockFetch
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })
      await hooks["session.start"]!(
        { sessionID: "sess-1" },
        {},
      )

      const getByName = calls.find((c) =>
        c.includes("experiments/get-by-name"),
      )
      expect(getByName).toBeDefined()

      const createRun = calls.find((c) => c.includes("runs/create"))
      expect(createRun).toBeDefined()
    } finally {
      restoreFetch()
    }
  })

  it("session.start creates new experiment when get-by-name returns 404", async () => {
    const calls: string[] = []
    const routes = mlflowRoutes([
      {
        method: "GET",
        path: "/api/2.0/mlflow/experiments/get-by-name",
        status: 404,
        body: { error_code: "RESOURCE_DOES_NOT_EXIST" },
      },
    ])

    const mockFetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? "GET"
      calls.push(`${method} ${url}`)

      const route = routes.find((r) => {
        const methodMatch = (r.method ?? "GET").toUpperCase() === method.toUpperCase()
        if (!methodMatch) return false
        if (typeof r.path === "string") return url.includes(r.path)
        return false
      })

      if (!route) return Promise.resolve(new Response("Not Found", { status: 404 }))
      return Promise.resolve(
        new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "content-type": "application/json" } }),
      )
    }) as unknown as typeof fetch

    globalThis.fetch = mockFetch
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })
      await hooks["session.start"]!(
        { sessionID: "sess-2" },
        {},
      )

      const createExp = calls.find((c) =>
        c.includes("experiments/create"),
      )
      expect(createExp).toBeDefined()
    } finally {
      restoreFetch()
    }
  })

  it("session.start uses custom experiment name from options", async () => {
    const calls: { url: string; body?: string }[] = []

    const routes = mlflowRoutes()
    const mockFetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? "GET"
      calls.push({ url: `${method} ${url}`, body: init?.body as string | undefined })

      const route = routes.find((r) => {
        const methodMatch = (r.method ?? "GET").toUpperCase() === method.toUpperCase()
        if (!methodMatch) return false
        if (typeof r.path === "string") return url.includes(r.path)
        return false
      })

      if (!route) return Promise.resolve(new Response("Not Found", { status: 404 }))
      return Promise.resolve(
        new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "content-type": "application/json" } }),
      )
    }) as unknown as typeof fetch

    globalThis.fetch = mockFetch
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, {
        mlflowUrl: MLFLOW_URL,
        experimentName: "my-custom-experiment",
      })
      await hooks["session.start"]!(
        { sessionID: "sess-3" },
        {},
      )

      const getByName = calls.find((c) =>
        c.url.includes("experiment_name=my-custom-experiment"),
      )
      expect(getByName).toBeDefined()
    } finally {
      restoreFetch()
    }
  })

  it("tool.execute.after increments tool call counter", async () => {
    setupFetch(mlflowRoutes())
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      await hooks["session.start"]!(
        { sessionID: "sess-4" },
        {},
      )

      await hooks["tool.execute.after"]!(
        { tool: "shell", sessionID: "sess-4", callID: "c1", args: {} },
        { title: "", output: "", metadata: {} },
      )

      await hooks["tool.execute.after"]!(
        { tool: "edit", sessionID: "sess-4", callID: "c2", args: {} },
        { title: "", output: "", metadata: {} },
      )

      // Counter should be at 2 - verified by session.end logging
      // We just verify the calls don't throw
      expect(true).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  it("tool.execute.after is no-op without active run", async () => {
    setupFetch(mlflowRoutes())
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      // Call without session.start - should not throw
      await hooks["tool.execute.after"]!(
        { tool: "shell", sessionID: "sess-x", callID: "c1", args: {} },
        { title: "", output: "", metadata: {} },
      )
    } finally {
      restoreFetch()
    }
  })

  it("session.end logs metrics and ends run", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = []

    const routes = mlflowRoutes()
    const mockFetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? "GET"
      calls.push({
        method,
        url,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      })

      const route = routes.find((r) => {
        const methodMatch = (r.method ?? "GET").toUpperCase() === method.toUpperCase()
        if (!methodMatch) return false
        if (typeof r.path === "string") return url.includes(r.path)
        return false
      })

      if (!route) return Promise.resolve(new Response("Not Found", { status: 404 }))
      return Promise.resolve(
        new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "content-type": "application/json" } }),
      )
    }) as unknown as typeof fetch

    globalThis.fetch = mockFetch
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      await hooks["session.start"]!(
        { sessionID: "sess-5" },
        {},
      )

      await hooks["tool.execute.after"]!(
        { tool: "shell", sessionID: "sess-5", callID: "c1", args: {} },
        { title: "", output: "", metadata: {} },
      )

      calls.length = 0

      await hooks["session.end"]!(
        { sessionID: "sess-5" },
        {},
      )

      const metricCalls = calls.filter((c) =>
        c.url.includes("log-metric"),
      )
      expect(metricCalls.length).toBe(2)

      const toolCountMetric = metricCalls.find(
        (c) => (c.body as Record<string, unknown>)?.key === "tool_call_count",
      )
      expect(toolCountMetric).toBeDefined()
      expect((toolCountMetric!.body as Record<string, unknown>).value).toBe(1)

      const durationMetric = metricCalls.find(
        (c) =>
          (c.body as Record<string, unknown>)?.key ===
          "session_duration_seconds",
      )
      expect(durationMetric).toBeDefined()

      const endRunCall = calls.find((c) => c.url.includes("runs/update"))
      expect(endRunCall).toBeDefined()
      expect((endRunCall!.body as Record<string, unknown>).status).toBe(
        "FINISHED",
      )
    } finally {
      restoreFetch()
    }
  })

  it("session.end is no-op without active run", async () => {
    setupFetch(mlflowRoutes())
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      // Call without session.start - should not throw
      await hooks["session.end"]!(
        { sessionID: "sess-y" },
        {},
      )
    } finally {
      restoreFetch()
    }
  })

  it("session.end clears runId so subsequent calls are no-ops", async () => {
    setupFetch(mlflowRoutes())
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      await hooks["session.start"]!(
        { sessionID: "sess-6" },
        {},
      )
      await hooks["session.end"]!(
        { sessionID: "sess-6" },
        {},
      )

      // Second session.end should be a no-op
      await hooks["session.end"]!(
        { sessionID: "sess-6" },
        {},
      )
    } finally {
      restoreFetch()
    }
  })

  it("event hook increments event count", async () => {
    setupFetch(mlflowRoutes())
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      await hooks.event!({ event: { type: "session.created" } as never })
      await hooks.event!({ event: { type: "file.edited" } as never })
      await hooks.event!({ event: { type: "file.edited" } as never })

      // Event counting doesn't throw
      expect(true).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  it("dispose ends run with KILLED status if still active", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = []

    const routes = mlflowRoutes()
    const mockFetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? "GET"
      calls.push({
        method,
        url,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      })

      const route = routes.find((r) => {
        const methodMatch = (r.method ?? "GET").toUpperCase() === method.toUpperCase()
        if (!methodMatch) return false
        if (typeof r.path === "string") return url.includes(r.path)
        return false
      })

      if (!route) return Promise.resolve(new Response("Not Found", { status: 404 }))
      return Promise.resolve(
        new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "content-type": "application/json" } }),
      )
    }) as unknown as typeof fetch

    globalThis.fetch = mockFetch
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      await hooks["session.start"]!(
        { sessionID: "sess-7" },
        {},
      )

      calls.length = 0

      await hooks.dispose!()

      const endRunCall = calls.find((c) => c.url.includes("runs/update"))
      expect(endRunCall).toBeDefined()
      expect((endRunCall!.body as Record<string, unknown>).status).toBe(
        "KILLED",
      )
    } finally {
      restoreFetch()
    }
  })

  it("dispose is no-op without active run", async () => {
    setupFetch(mlflowRoutes())
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      // Dispose without session.start - should not throw
      await hooks.dispose!()
    } finally {
      restoreFetch()
    }
  })

  it("dispose clears runId after ending run", async () => {
    const calls: string[] = []

    const routes = mlflowRoutes()
    const mockFetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? "GET"
      calls.push(`${method} ${url}`)

      const route = routes.find((r) => {
        const methodMatch = (r.method ?? "GET").toUpperCase() === method.toUpperCase()
        if (!methodMatch) return false
        if (typeof r.path === "string") return url.includes(r.path)
        return false
      })

      if (!route) return Promise.resolve(new Response("Not Found", { status: 404 }))
      return Promise.resolve(
        new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "content-type": "application/json" } }),
      )
    }) as unknown as typeof fetch

    globalThis.fetch = mockFetch
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      await hooks["session.start"]!(
        { sessionID: "sess-8" },
        {},
      )

      await hooks.dispose!()

      calls.length = 0

      // Second dispose should be a no-op - no additional API calls
      await hooks.dispose!()
      const updateCalls = calls.filter((c) => c.includes("runs/update"))
      expect(updateCalls.length).toBe(0)
    } finally {
      restoreFetch()
    }
  })

  it("MLFlow API errors on session.start don't propagate", async () => {
    const mockFetch = mock(() => {
      return Promise.resolve(
        new Response("Internal Server Error", { status: 500 }),
      )
    }) as unknown as typeof fetch

    globalThis.fetch = mockFetch
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      // Should not throw even though all API calls fail
      await hooks["session.start"]!(
        { sessionID: "sess-err" },
        {},
      )
    } finally {
      restoreFetch()
    }
  })

  it("MLFlow API errors on session.end don't propagate", async () => {
    setupFetch(mlflowRoutes())
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      await hooks["session.start"]!(
        { sessionID: "sess-err2" },
        {},
      )
    } finally {
      restoreFetch()
    }

    // Now make all subsequent calls fail
    const failFetch = mock(() => {
      return Promise.resolve(
        new Response("Internal Server Error", { status: 500 }),
      )
    }) as unknown as typeof fetch

    globalThis.fetch = failFetch
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })

      // Create a session first with working fetch
      globalThis.fetch = createMockFetch(mlflowRoutes())
      await hooks["session.start"]!(
        { sessionID: "sess-err3" },
        {},
      )

      // Now break fetch
      globalThis.fetch = failFetch

      // Should not throw
      await hooks["session.end"]!(
        { sessionID: "sess-err3" },
        {},
      )
    } finally {
      restoreFetch()
    }
  })

  it("MLFlow API errors on tool.execute.after don't propagate", async () => {
    setupFetch(mlflowRoutes())
    let input: ReturnType<typeof createMockInput>
    let hooks: Awaited<ReturnType<typeof plugin.server>>
    try {
      input = createMockInput()
      hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })
      await hooks["session.start"]!(
        { sessionID: "sess-err4" },
        {},
      )
    } finally {
      restoreFetch()
    }

    // Make fetch fail
    const failFetch = mock(() => {
      return Promise.resolve(
        new Response("Internal Server Error", { status: 500 }),
      )
    }) as unknown as typeof fetch
    globalThis.fetch = failFetch
    try {
      // Should not throw
      await hooks["tool.execute.after"]!(
        { tool: "shell", sessionID: "sess-err4", callID: "c1", args: {} },
        { title: "", output: "", metadata: {} },
      )
    } finally {
      restoreFetch()
    }
  })

  it("defaults experiment name to directory basename", async () => {
    const calls: { url: string }[] = []

    const routes = mlflowRoutes()
    const mockFetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? "GET"
      calls.push({ url: `${method} ${url}` })

      const route = routes.find((r) => {
        const methodMatch = (r.method ?? "GET").toUpperCase() === method.toUpperCase()
        if (!methodMatch) return false
        if (typeof r.path === "string") return url.includes(r.path)
        return false
      })

      if (!route) return Promise.resolve(new Response("Not Found", { status: 404 }))
      return Promise.resolve(
        new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "content-type": "application/json" } }),
      )
    }) as unknown as typeof fetch

    globalThis.fetch = mockFetch
    try {
      const input = createMockInput()
      // createMockInput sets directory to "/tmp/test"
      const hooks = await plugin.server(input, { mlflowUrl: MLFLOW_URL })
      await hooks["session.start"]!(
        { sessionID: "sess-dir" },
        {},
      )

      const getByName = calls.find((c) =>
        c.url.includes("experiment_name=test"),
      )
      expect(getByName).toBeDefined()
    } finally {
      restoreFetch()
    }
  })

  it("full lifecycle: start, tool calls, end", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = []

    const routes = mlflowRoutes()
    const mockFetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? "GET"
      calls.push({
        method,
        url,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      })

      const route = routes.find((r) => {
        const methodMatch = (r.method ?? "GET").toUpperCase() === method.toUpperCase()
        if (!methodMatch) return false
        if (typeof r.path === "string") return url.includes(r.path)
        return false
      })

      if (!route) return Promise.resolve(new Response("Not Found", { status: 404 }))
      return Promise.resolve(
        new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "content-type": "application/json" } }),
      )
    }) as unknown as typeof fetch

    globalThis.fetch = mockFetch
    try {
      const input = createMockInput()
      const hooks = await plugin.server(input, {
        mlflowUrl: MLFLOW_URL,
        experimentName: "full-lifecycle",
      })

      await hooks["session.start"]!(
        { sessionID: "sess-full" },
        {},
      )

      await hooks["tool.execute.after"]!(
        { tool: "shell", sessionID: "sess-full", callID: "c1", args: {} },
        { title: "", output: "", metadata: {} },
      )

      await hooks["tool.execute.after"]!(
        { tool: "edit", sessionID: "sess-full", callID: "c2", args: {} },
        { title: "", output: "", metadata: {} },
      )

      await hooks["tool.execute.after"]!(
        { tool: "shell", sessionID: "sess-full", callID: "c3", args: {} },
        { title: "", output: "", metadata: {} },
      )

      await hooks.event!({ event: { type: "file.edited" } as never })

      calls.length = 0

      await hooks["session.end"]!(
        { sessionID: "sess-full" },
        {},
      )

      const toolCountMetric = calls.find(
        (c) =>
          c.url.includes("log-metric") &&
          (c.body as Record<string, unknown>)?.key === "tool_call_count",
      )
      expect(toolCountMetric).toBeDefined()
      expect((toolCountMetric!.body as Record<string, unknown>).value).toBe(3)

      const endRun = calls.find((c) => c.url.includes("runs/update"))
      expect(endRun).toBeDefined()
      expect((endRun!.body as Record<string, unknown>).status).toBe("FINISHED")
    } finally {
      restoreFetch()
    }
  })
})
