import type { PluginInput } from "tinycode-plugin"

export type MockCommand = {
  match: string | RegExp
  output?: string
  exitCode?: number
  json?: unknown
}

export type MockRoute = {
  method?: string
  path: string | RegExp
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

function exprToString(expr: unknown): string {
  if (Array.isArray(expr)) return expr.map(exprToString).join(" ")
  if (expr === undefined || expr === null) return ""
  return String(expr)
}

export function createMockShell(commands: MockCommand[]): PluginInput["$"] {
  const shell = ((strings: TemplateStringsArray, ...expressions: unknown[]) => {
    const cmd = strings.reduce((acc, str, i) => {
      return acc + str + exprToString(expressions[i])
    }, "")

    const match = commands.find((c) => {
      if (typeof c.match === "string") return cmd.includes(c.match)
      return c.match.test(cmd)
    })

    const exitCode = match ? (match.exitCode ?? 0) : 1
    const output = match?.output ?? ""
    const jsonOutput = match?.json

    const outputObj = {
      stdout: Buffer.from(output),
      stderr: Buffer.from(""),
      exitCode,
      text: () => output,
      json: () => jsonOutput ?? JSON.parse(output || "{}"),
      arrayBuffer: () => new ArrayBuffer(0),
      bytes: () => new Uint8Array(0),
      blob: () => new Blob(),
    }

    const promise = Promise.resolve(outputObj)
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
      text: () => Promise.resolve(output),
      json: () => Promise.resolve(jsonOutput ?? JSON.parse(output || "{}")),
      lines: () =>
        (async function* () {
          for (const line of output.split("\n")) yield line
        })(),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      blob: () => Promise.resolve(new Blob()),
      stdin: new WritableStream(),
      [Symbol.toStringTag]: "MockShellPromise",
    })

    return chainable
  }) as unknown as PluginInput["$"]

  shell.braces = () => []
  shell.escape = (input: string) => input
  shell.env = () => shell
  shell.cwd = () => shell
  shell.nothrow = () => shell
  shell.throws = () => shell

  return shell
}

export function createMockInput(shell?: PluginInput["$"]): PluginInput {
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
    $: shell ?? createMockShell([]),
  }
}

export function createMockFetch(routes: MockRoute[]): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? "GET"

    const route = routes.find((r) => {
      const methodMatch = (r.method ?? "GET").toUpperCase() === method.toUpperCase()
      if (!methodMatch) return false
      if (typeof r.path === "string") return url.includes(r.path)
      return r.path.test(url)
    })

    if (!route) {
      return Promise.resolve(new Response("Not Found", { status: 404 }))
    }

    return Promise.resolve(
      new Response(JSON.stringify(route.body), {
        status: route.status ?? 200,
        headers: route.headers,
      }),
    )
  }) as typeof fetch
}
