import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test"
import type { ToolDefinition } from "tinycode-plugin"

let spawnSpy: ReturnType<typeof spyOn>
let mockFetch: ReturnType<typeof mock>
let originalPlatform: PropertyDescriptor | undefined
let originalEnv: string | undefined

function setPlatform(platform: string) {
  Object.defineProperty(process, "platform", { value: platform, writable: true })
}

beforeEach(() => {
  originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
  originalEnv = process.env.NTFY_TOPIC
  delete process.env.NTFY_TOPIC

  spawnSpy = spyOn(Bun, "spawn").mockImplementation(
    (() => ({ exited: Promise.resolve(0) })) as typeof Bun.spawn,
  )

  mockFetch = mock()
  globalThis.fetch = mockFetch as typeof fetch
})

afterEach(() => {
  spawnSpy.mockRestore()
  if (originalPlatform) {
    Object.defineProperty(process, "platform", originalPlatform)
  }
  if (originalEnv !== undefined) {
    process.env.NTFY_TOPIC = originalEnv
  } else {
    delete process.env.NTFY_TOPIC
  }
})

async function getTools(): Promise<Record<string, ToolDefinition>> {
  const mod = await import("../src/index")
  const hooks = await mod.default.server({} as never, undefined)
  return hooks.tool!
}

describe("tinycode-plugin-rh-notify", () => {
  describe("plugin loading", () => {
    it("registers a notify tool with correct name and description", async () => {
      const tools = await getTools()
      expect(tools.notify).toBeDefined()
      expect(tools.notify.description).toBeTruthy()
    })
  })

  describe("macOS notifications", () => {
    it("calls osascript with correct command on darwin", async () => {
      setPlatform("darwin")
      const tools = await getTools()
      const result = await tools.notify.execute(
        { title: "Test Title", message: "Test Message" },
        {} as never,
      )

      expect(spawnSpy).toHaveBeenCalledTimes(1)
      const args = spawnSpy.mock.calls[0]![0] as string[]
      expect(args[0]).toBe("osascript")
      expect(args[1]).toBe("-e")
      expect(args[2]).toContain("display notification")
      expect(args[2]).toContain("Test Message")
      expect(args[2]).toContain("Test Title")
      expect(result).toBe("Notification sent")
    })
  })

  describe("Linux notifications", () => {
    it("calls notify-send with correct arguments on linux", async () => {
      setPlatform("linux")
      const tools = await getTools()
      const result = await tools.notify.execute(
        { title: "Test Title", message: "Test Message" },
        {} as never,
      )

      expect(spawnSpy).toHaveBeenCalledTimes(1)
      const args = spawnSpy.mock.calls[0]![0] as string[]
      expect(args[0]).toBe("notify-send")
      expect(args[1]).toBe("Test Title")
      expect(args[2]).toBe("Test Message")
      expect(result).toBe("Notification sent")
    })
  })

  describe("unsupported platform", () => {
    it("returns warning message on unsupported platform", async () => {
      setPlatform("win32")
      const tools = await getTools()
      const result = await tools.notify.execute(
        { title: "Test", message: "Test" },
        {} as never,
      )

      expect(spawnSpy).not.toHaveBeenCalled()
      expect(result).toContain("not supported")
    })
  })

  describe("ntfy.sh integration", () => {
    it("sends push notification when NTFY_TOPIC is set", async () => {
      setPlatform("darwin")
      process.env.NTFY_TOPIC = "my-test-topic"
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }))

      const tools = await getTools()
      await tools.notify.execute(
        { title: "Push Title", message: "Push Message" },
        {} as never,
      )

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe("https://ntfy.sh/my-test-topic")
      expect(opts.method).toBe("POST")
      expect(opts.headers).toEqual(
        expect.objectContaining({ Title: "Push Title" }),
      )
      expect(opts.body).toBe("Push Message")
    })

    it("does not call fetch when NTFY_TOPIC is not set", async () => {
      setPlatform("darwin")
      const tools = await getTools()
      await tools.notify.execute(
        { title: "Test", message: "Test" },
        {} as never,
      )

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe("error handling", () => {
    it("returns warning when spawn fails, does not throw", async () => {
      setPlatform("darwin")
      spawnSpy.mockImplementation((() => {
        throw new Error("spawn failed")
      }) as typeof Bun.spawn)

      const tools = await getTools()
      const result = await tools.notify.execute(
        { title: "Test", message: "Test" },
        {} as never,
      )

      expect(result).toContain("spawn failed")
      expect(typeof result).toBe("string")
    })

    it("returns warning when fetch fails, does not throw", async () => {
      setPlatform("darwin")
      process.env.NTFY_TOPIC = "test-topic"
      mockFetch.mockRejectedValue(new Error("network error"))

      const tools = await getTools()
      const result = await tools.notify.execute(
        { title: "Test", message: "Test" },
        {} as never,
      )

      expect(typeof result).toBe("string")
      expect(result).toContain("network error")
    })
  })

  describe("special character escaping", () => {
    it("escapes quotes in title and message for osascript", async () => {
      setPlatform("darwin")
      const tools = await getTools()
      await tools.notify.execute(
        { title: 'He said "hello"', message: "It's done" },
        {} as never,
      )

      const args = spawnSpy.mock.calls[0]![0] as string[]
      const script = args[2] as string
      expect(script).not.toContain('"hello"')
      expect(script).not.toContain("It's")
      expect(script).toContain('\\"hello\\"')
      expect(script).toContain("It\\'s")
    })
  })
})
