import { describe, it, expect } from "bun:test"
import type { PluginInput } from "tinycode-plugin"
import { createMockShell } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

function createMockInput(shell?: PluginInput["$"]): PluginInput {
  const defaultShell = (() => {
    const s = ((
      _strings: TemplateStringsArray,
      ..._expressions: unknown[]
    ) => {
      const result = {
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
        exitCode: 0,
        text: () => "",
        json: () => ({}),
        arrayBuffer: () => new ArrayBuffer(0),
        bytes: () => new Uint8Array(0),
        blob: () => new Blob(),
      }
      const promise = Promise.resolve(result)
      const chainable: Record<string, unknown> = {}
      Object.assign(chainable, {
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
        finally: promise.finally.bind(promise),
        quiet: () => chainable,
        nothrow: () => chainable,
        cwd: () => chainable,
        env: () => chainable,
        throws: () => chainable,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({}),
      })
      return chainable
    }) as unknown as PluginInput["$"]
    s.braces = () => []
    s.escape = (input: string) => input
    s.env = () => s
    s.cwd = () => s
    s.nothrow = () => s
    s.throws = () => s
    return s
  })()

  return {
    client: {} as PluginInput["client"],
    project: {
      id: "test-project",
      worktree: "/tmp/test",
      time: { created: Date.now() },
    },
    directory: "/tmp/test",
    worktree: "/tmp/test",
    serverUrl: new URL("http://localhost:4096"),
    $: shell ?? defaultShell,
  }
}

describe("tinycode-plugin-ocp-oauth", () => {
  it("loads without error", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input)
    expect(hooks).toBeDefined()
  })

  it("registers auth hook with provider openshift", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input)
    expect(hooks.auth).toBeDefined()
    expect(hooks.auth!.provider).toBe("openshift")
  })

  it("auth method is type api with correct label", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input)
    const method = hooks.auth!.methods[0]!
    expect(method.type).toBe("api")
    expect(method.label).toBe("OpenShift API Token")
  })

  it("has two prompts: server and token", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input)
    const method = hooks.auth!.methods[0]!
    expect(method.prompts).toHaveLength(2)
    expect(method.prompts![0]!.key).toBe("server")
    expect(method.prompts![0]!.type).toBe("text")
    expect(method.prompts![1]!.key).toBe("token")
    expect(method.prompts![1]!.type).toBe("text")
  })

  describe("server URL validator", () => {
    it("accepts valid URLs", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input)
      const prompt = hooks.auth!.methods[0]!.prompts![0]! as {
        validate: (value: string) => string | undefined
      }
      expect(
        prompt.validate("https://api.mycluster.example.com:6443"),
      ).toBeUndefined()
      expect(prompt.validate("http://localhost:8443")).toBeUndefined()
    })

    it("rejects invalid URLs", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input)
      const prompt = hooks.auth!.methods[0]!.prompts![0]! as {
        validate: (value: string) => string | undefined
      }
      expect(prompt.validate("not-a-url")).toBe("Must be a valid URL")
      expect(prompt.validate("")).toBe("Must be a valid URL")
    })
  })

  describe("token validator", () => {
    it("accepts tokens starting with sha256~", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input)
      const prompt = hooks.auth!.methods[0]!.prompts![1]! as {
        validate: (value: string) => string | undefined
      }
      expect(prompt.validate("sha256~abc123")).toBeUndefined()
    })

    it("rejects tokens without sha256~ prefix", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input)
      const prompt = hooks.auth!.methods[0]!.prompts![1]! as {
        validate: (value: string) => string | undefined
      }
      expect(prompt.validate("badtoken")).toBe("Token must start with sha256~")
      expect(prompt.validate("")).toBe("Token must start with sha256~")
    })
  })

  describe("authorize", () => {
    it("returns success when oc login succeeds", async () => {
      const shell = createMockShell([
        { match: "oc login", output: "Login successful", exitCode: 0 },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input)
      const method = hooks.auth!.methods[0]!
      const result = await method.authorize!({
        server: "https://api.mycluster.example.com:6443",
        token: "sha256~testtoken123",
      })
      expect(result).toEqual({
        type: "success",
        key: "sha256~testtoken123",
        metadata: { server: "https://api.mycluster.example.com:6443" },
      })
    })

    it("returns failed when oc login fails", async () => {
      const shell = createMockShell([
        { match: "oc login", output: "error: login failed", exitCode: 1 },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input)
      const method = hooks.auth!.methods[0]!
      const result = await method.authorize!({
        server: "https://api.mycluster.example.com:6443",
        token: "sha256~testtoken123",
      })
      expect(result).toEqual({ type: "failed" })
    })

    it("returns failed when server is missing", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input)
      const method = hooks.auth!.methods[0]!
      const result = await method.authorize!({
        token: "sha256~testtoken123",
      })
      expect(result).toEqual({ type: "failed" })
    })

    it("returns failed when token is missing", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input)
      const method = hooks.auth!.methods[0]!
      const result = await method.authorize!({
        server: "https://api.mycluster.example.com:6443",
      })
      expect(result).toEqual({ type: "failed" })
    })

    it("uses server from config when not in inputs", async () => {
      const server = "https://api.config-cluster.example.com:6443"
      const token = "sha256~configtoken"
      const shell = createMockShell([
        { match: "oc login", output: "Login successful", exitCode: 0 },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, { server })
      const method = hooks.auth!.methods[0]!
      const result = await method.authorize!({ token })
      expect(result).toEqual({
        type: "success",
        key: token,
        metadata: { server },
      })
    })

    it("does NOT include --insecure-skip-tls-verify by default", async () => {
      const shell = createMockShell([
        { match: /oc login.*--insecure-skip-tls-verify/, output: "flag present", exitCode: 1 },
        { match: "oc login", output: "Login successful", exitCode: 0 },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input)
      const method = hooks.auth!.methods[0]!
      const result = await method.authorize!({
        server: "https://api.example.com:6443",
        token: "sha256~test",
      })
      expect(result.type).toBe("success")
    })

    it("includes --insecure-skip-tls-verify when option is true", async () => {
      const shell = createMockShell([
        { match: /oc login.*--insecure-skip-tls-verify/, output: "Login successful", exitCode: 0 },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, { insecureSkipTlsVerify: true })
      const method = hooks.auth!.methods[0]!
      const result = await method.authorize!({
        server: "https://api.example.com:6443",
        token: "sha256~test",
      })
      expect(result.type).toBe("success")
    })

    it("does NOT include --insecure-skip-tls-verify when option is false", async () => {
      const shell = createMockShell([
        { match: /oc login.*--insecure-skip-tls-verify/, output: "flag present", exitCode: 1 },
        { match: "oc login", output: "Login successful", exitCode: 0 },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, { insecureSkipTlsVerify: false })
      const method = hooks.auth!.methods[0]!
      const result = await method.authorize!({
        server: "https://api.example.com:6443",
        token: "sha256~test",
      })
      expect(result.type).toBe("success")
    })
  })

  describe("shell.env", () => {
    it("sets OC_EDITOR to cat", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input)
      const output = { env: {} as Record<string, string> }
      await hooks["shell.env"]!({ cwd: "/tmp" }, output)
      expect(output.env["OC_EDITOR"]).toBe("cat")
    })
  })

  describe("schema", () => {
    it("validates valid options with server URL", () => {
      const result = plugin.schema!.safeParse({
        server: "https://example.com",
      })
      expect(result.success).toBe(true)
    })

    it("rejects invalid server URLs", () => {
      const result = plugin.schema!.safeParse({ server: "not-a-url" })
      expect(result.success).toBe(false)
    })

    it("accepts undefined options", () => {
      const result = plugin.schema!.safeParse(undefined)
      expect(result.success).toBe(true)
    })

    it("accepts empty object", () => {
      const result = plugin.schema!.safeParse({})
      expect(result.success).toBe(true)
    })
  })
})
