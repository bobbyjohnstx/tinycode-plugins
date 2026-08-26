import type { PluginInput } from "tinycode-plugin"

type Shell = PluginInput["$"]

export class OcError extends Error {
  readonly exitCode: number
  readonly stderr: string

  constructor(message: string, exitCode: number, stderr: string) {
    super(message)
    this.name = "OcError"
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

export type OcGetOptions = {
  namespace?: string
  selector?: string
  fieldSelector?: string
}

export type OcLogOptions = {
  container?: string
  tail?: number
  since?: string
}

export type OcVersionInfo = {
  clientVersion: Record<string, string>
  serverVersion?: Record<string, string>
  openshiftVersion?: string
}

export type OcClient = {
  isAvailable(): Promise<boolean>
  isLoggedIn(): Promise<boolean>
  get<T = unknown>(resource: string, options?: OcGetOptions): Promise<T>
  apply(manifest: string): Promise<string>
  logs(pod: string, options?: OcLogOptions): Promise<string>
  describe(resource: string, name: string, namespace?: string): Promise<string>
  whoami(): Promise<string>
  token(): Promise<string>
  version(): Promise<OcVersionInfo>
  raw(...args: string[]): Promise<string>
}

export function createOcClient(shell: Shell): OcClient {
  async function exec(args: string[]) {
    const result = await shell`oc ${args}`.quiet().nothrow()
    if (result.exitCode !== 0) {
      throw new OcError(
        `oc ${args.join(" ")} failed with exit code ${result.exitCode}`,
        result.exitCode,
        result.stderr.toString(),
      )
    }
    return result
  }

  return {
    async isAvailable(): Promise<boolean> {
      const result = await shell`which oc`.quiet().nothrow()
      return result.exitCode === 0
    },

    async isLoggedIn(): Promise<boolean> {
      const result = await shell`oc whoami`.quiet().nothrow()
      return result.exitCode === 0
    },

    async get<T = unknown>(resource: string, options?: OcGetOptions): Promise<T> {
      const args = ["get", resource, "-o", "json"]
      if (options?.namespace) args.push("--namespace", options.namespace)
      if (options?.selector) args.push("--selector", options.selector)
      if (options?.fieldSelector) args.push("--field-selector", options.fieldSelector)
      const result = await exec(args)
      return result.json() as T
    },

    async apply(manifest: string): Promise<string> {
      const result = await shell`echo ${manifest} | oc apply -f -`.quiet().nothrow()
      if (result.exitCode !== 0) {
        throw new OcError(
          `oc apply failed with exit code ${result.exitCode}`,
          result.exitCode,
          result.stderr.toString(),
        )
      }
      return result.text()
    },

    async logs(pod: string, options?: OcLogOptions): Promise<string> {
      const args = ["logs", pod]
      if (options?.container) args.push("--container", options.container)
      if (options?.tail !== undefined) args.push("--tail", String(options.tail))
      if (options?.since) args.push("--since", options.since)
      const result = await exec(args)
      return result.text()
    },

    async describe(resource: string, name: string, namespace?: string): Promise<string> {
      const args = ["describe", resource, name]
      if (namespace) args.push("--namespace", namespace)
      const result = await exec(args)
      return result.text()
    },

    async whoami(): Promise<string> {
      const result = await exec(["whoami"])
      return result.text().trim()
    },

    async token(): Promise<string> {
      const result = await exec(["whoami", "-t"])
      return result.text().trim()
    },

    async version(): Promise<OcVersionInfo> {
      const result = await exec(["version", "-o", "json"])
      return result.json() as OcVersionInfo
    },

    async raw(...args: string[]): Promise<string> {
      const result = await exec(args)
      return result.text()
    },
  }
}
