import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const originalFetch = globalThis.fetch
const edaEndpoint = "https://eda.example.com/webhook"

let fetchCalls: Array<{ url: string; body: Record<string, unknown> }>

function capturingFetch() {
  fetchCalls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const body = JSON.parse((init?.body as string) ?? "{}")
    fetchCalls.push({ url, body })
    return new Response("ok", { status: 200 })
  }) as typeof fetch
}

function failingFetch() {
  globalThis.fetch = (() => {
    return Promise.reject(new Error("network error"))
  }) as unknown as typeof fetch
}

async function getHooks(options?: Record<string, unknown>) {
  const input = createMockInput()
  return plugin.server(input, options)
}

beforeEach(() => {
  capturingFetch()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("tinycode-plugin-eda-events", () => {
  describe("plugin loading", () => {
    it("loads without config and returns empty hooks", async () => {
      const hooks = await getHooks(undefined)
      expect(hooks).toBeDefined()
      expect(hooks["session.start"]).toBeUndefined()
      expect(hooks["session.end"]).toBeUndefined()
      expect(hooks["tool.execute.after"]).toBeUndefined()
    })

    it("loads with empty object and returns empty hooks", async () => {
      const hooks = await getHooks({})
      expect(hooks["session.start"]).toBeUndefined()
    })

    it("loads with invalid endpoint and returns empty hooks", async () => {
      const hooks = await getHooks({ edaEndpoint: "not-a-url" })
      expect(hooks["session.start"]).toBeUndefined()
    })

    it("loads with valid config and returns all hooks", async () => {
      const hooks = await getHooks({ edaEndpoint })
      expect(hooks["session.start"]).toBeDefined()
      expect(hooks["session.end"]).toBeDefined()
      expect(hooks["tool.execute.after"]).toBeDefined()
      expect(hooks.dispose).toBeDefined()
    })
  })

  describe("session.start", () => {
    it("fires tinycode.session.started webhook", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-1" }, {})
      await Bun.sleep(10)

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0]!.url).toBe(edaEndpoint)
      expect(fetchCalls[0]!.body["type"]).toBe("tinycode.session.started")
      expect(fetchCalls[0]!.body["sessionId"]).toBe("sess-1")
      const data = fetchCalls[0]!.body["data"] as Record<string, unknown>
      expect(data["sessionId"]).toBe("sess-1")
      expect(data["projectDirectory"]).toBe("/tmp/test")
    })
  })

  describe("session.end", () => {
    it("fires tinycode.session.ended webhook with duration and delivery stats", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-2" }, {})
      await Bun.sleep(50)
      await hooks["session.end"]!({ sessionID: "sess-2" }, {})
      await Bun.sleep(10)

      expect(fetchCalls.length).toBe(2)
      const endCall = fetchCalls[1]!
      expect(endCall.body["type"]).toBe("tinycode.session.ended")
      expect(endCall.body["sessionId"]).toBe("sess-2")
      const data = endCall.body["data"] as Record<string, unknown>
      expect(data["sessionId"]).toBe("sess-2")
      expect(typeof data["duration"]).toBe("number")
      expect(data["duration"] as number).toBeGreaterThanOrEqual(40)
      const delivery = data["delivery"] as Record<string, unknown>
      expect(delivery["sent"]).toBe(1)
      expect(delivery["failed"]).toBe(0)
    })
  })

  describe("tool.execute.after", () => {
    it("fires tinycode.image.built for docker build", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-3" }, {})
      await hooks["tool.execute.after"]!(
        { tool: "shell", sessionID: "sess-3", callID: "c1", args: { command: "docker build -t myapp ." } },
        { title: "", output: "", metadata: {} },
      )
      await Bun.sleep(10)

      const toolCall = fetchCalls[1]!
      expect(toolCall.body["type"]).toBe("tinycode.image.built")
    })

    it("fires tinycode.image.built for podman build", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-3b" }, {})
      await hooks["tool.execute.after"]!(
        { tool: "shell", sessionID: "sess-3b", callID: "c1", args: { command: "podman build -t myapp ." } },
        { title: "", output: "", metadata: {} },
      )
      await Bun.sleep(10)

      const toolCall = fetchCalls[1]!
      expect(toolCall.body["type"]).toBe("tinycode.image.built")
    })

    it("fires tinycode.dockerfile.changed for Dockerfile edits", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-4" }, {})
      await hooks["tool.execute.after"]!(
        { tool: "edit", sessionID: "sess-4", callID: "c2", args: { file: "Dockerfile" } },
        { title: "", output: "", metadata: {} },
      )
      await Bun.sleep(10)

      const toolCall = fetchCalls[1]!
      expect(toolCall.body["type"]).toBe("tinycode.dockerfile.changed")
    })

    it("fires tinycode.dockerfile.changed for Dockerfile.prod", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-4b" }, {})
      await hooks["tool.execute.after"]!(
        { tool: "edit", sessionID: "sess-4b", callID: "c2", args: { file: "Dockerfile.prod" } },
        { title: "", output: "", metadata: {} },
      )
      await Bun.sleep(10)

      const toolCall = fetchCalls[1]!
      expect(toolCall.body["type"]).toBe("tinycode.dockerfile.changed")
    })

    it("fires tinycode.manifest.changed for k8s YAML edits", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-5" }, {})
      await hooks["tool.execute.after"]!(
        { tool: "edit", sessionID: "sess-5", callID: "c3", args: { file: "k8s/deployment.yaml" } },
        { title: "", output: "", metadata: {} },
      )
      await Bun.sleep(10)

      const toolCall = fetchCalls[1]!
      expect(toolCall.body["type"]).toBe("tinycode.manifest.changed")
    })

    it("fires tinycode.manifest.changed for k8s yml files", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-5b" }, {})
      await hooks["tool.execute.after"]!(
        { tool: "edit", sessionID: "sess-5b", callID: "c3", args: { file: "k8s/service.yml" } },
        { title: "", output: "", metadata: {} },
      )
      await Bun.sleep(10)

      const toolCall = fetchCalls[1]!
      expect(toolCall.body["type"]).toBe("tinycode.manifest.changed")
    })

    it("fires tinycode.code.pushed for git push", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-6" }, {})
      await hooks["tool.execute.after"]!(
        { tool: "shell", sessionID: "sess-6", callID: "c4", args: { command: "git push origin main" } },
        { title: "", output: "", metadata: {} },
      )
      await Bun.sleep(10)

      const toolCall = fetchCalls[1]!
      expect(toolCall.body["type"]).toBe("tinycode.code.pushed")
    })

    it("ignores non-matching tools", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-7" }, {})
      fetchCalls = [] // clear session.start call
      await hooks["tool.execute.after"]!(
        { tool: "shell", sessionID: "sess-7", callID: "c5", args: { command: "ls -la" } },
        { title: "", output: "", metadata: {} },
      )
      await Bun.sleep(10)

      expect(fetchCalls.length).toBe(0)
    })

    it("ignores edit of non-matching files", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-7b" }, {})
      fetchCalls = []
      await hooks["tool.execute.after"]!(
        { tool: "edit", sessionID: "sess-7b", callID: "c5b", args: { file: "src/index.ts" } },
        { title: "", output: "", metadata: {} },
      )
      await Bun.sleep(10)

      expect(fetchCalls.length).toBe(0)
    })
  })

  describe("event filtering", () => {
    it("only forwards events in the events allow list", async () => {
      const hooks = await getHooks({
        edaEndpoint,
        events: ["tinycode.session.started"],
      })
      await hooks["session.start"]!({ sessionID: "sess-8" }, {})
      await hooks["session.end"]!({ sessionID: "sess-8" }, {})
      await Bun.sleep(10)

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0]!.body["type"]).toBe("tinycode.session.started")
    })
  })

  describe("sensitive pattern stripping", () => {
    it("redacts values matching sensitive patterns", async () => {
      const hooks = await getHooks({
        edaEndpoint,
        sensitivePatterns: ["^sk-.*", "^token-.*"],
      })
      await hooks["session.start"]!({ sessionID: "sess-9" }, {})
      await Bun.sleep(10)

      // session.start data doesn't typically have sensitive values,
      // test via tool.execute.after with known args
      fetchCalls = []
      await hooks["tool.execute.after"]!(
        {
          tool: "shell",
          sessionID: "sess-9",
          callID: "c6",
          args: { command: "docker build -t myapp .", secret: "sk-abc123" },
        },
        { title: "", output: "", metadata: {} },
      )
      await Bun.sleep(10)

      expect(fetchCalls.length).toBe(1)
      const data = fetchCalls[0]!.body["data"] as Record<string, unknown>
      const args = data["args"] as Record<string, unknown>
      expect(args["secret"]).toBe("[REDACTED]")
      expect(args["command"]).toBe("docker build -t myapp .")
    })
  })

  describe("error handling", () => {
    it("does not throw when webhook POST fails", async () => {
      failingFetch()
      const hooks = await getHooks({ edaEndpoint })

      await hooks["session.start"]!({ sessionID: "sess-10" }, {})
      await Bun.sleep(10)
    })

    it("tracks failed delivery count in session.end", async () => {
      failingFetch()
      const hooks = await getHooks({ edaEndpoint })

      await hooks["session.start"]!({ sessionID: "sess-10b" }, {})
      await Bun.sleep(10)

      capturingFetch()
      await hooks["session.end"]!({ sessionID: "sess-10b" }, {})
      await Bun.sleep(10)

      expect(fetchCalls.length).toBe(1)
      const data = fetchCalls[0]!.body["data"] as Record<string, unknown>
      const delivery = data["delivery"] as Record<string, unknown>
      expect(delivery["failed"]).toBe(1)
      expect(delivery["lastError"]).toBe("network error")
    })
  })

  describe("dispose", () => {
    it("clears state without error", async () => {
      const hooks = await getHooks({ edaEndpoint })
      await hooks["session.start"]!({ sessionID: "sess-11" }, {})
      await hooks.dispose!()
      // No assertion needed — test passes if no exception thrown
    })
  })
})
