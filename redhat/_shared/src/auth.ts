import type { PluginInput } from "tinycode-plugin"

type Shell = PluginInput["$"]

export type TokenSource = "kubeconfig" | "env" | "option" | "oauth"

export type TokenResult = {
  token: string
  source: TokenSource
  server: string
}

export type ResolveTokenOptions = {
  token?: string
}

class TokenManager {
  private tokens: Map<string, TokenResult> = new Map()

  setToken(clusterUrl: string, result: TokenResult): void {
    this.tokens.set(clusterUrl, result)
  }

  getToken(clusterUrl: string): TokenResult | undefined {
    return this.tokens.get(clusterUrl)
  }

  removeToken(clusterUrl: string): void {
    this.tokens.delete(clusterUrl)
  }

  clear(): void {
    this.tokens.clear()
  }
}

export const tokenManager = new TokenManager()

export async function resolveToken(
  shell: Shell,
  options?: ResolveTokenOptions,
): Promise<TokenResult> {
  const serverResult = await shell`oc whoami --show-server`.quiet().nothrow()
  const server = serverResult.exitCode === 0 ? serverResult.text().trim() : ""

  if (server) {
    const cached = tokenManager.getToken(server)
    if (cached) return cached
  }

  if (options?.token) {
    return { token: options.token, source: "option", server }
  }

  const envToken = process.env.OPENSHIFT_TOKEN
  if (envToken) {
    return { token: envToken, source: "env", server }
  }

  const tokenResult = await shell`oc whoami -t`.quiet().nothrow()
  if (tokenResult.exitCode === 0) {
    const token = tokenResult.text().trim()
    return { token, source: "kubeconfig", server }
  }

  throw new Error("No OpenShift token available from any source")
}

export function createTokenFn(
  shell: Shell,
  options?: ResolveTokenOptions,
): () => Promise<string> {
  return async () => {
    const result = await resolveToken(shell, options)
    return result.token
  }
}
