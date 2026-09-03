import type { PluginInput } from "tinycode-plugin"
import type { IssueProvider } from "./types.js"
import { GiteaProvider } from "./providers/gitea.js"
import { GitHubProvider } from "./providers/github.js"
import { GitLabProvider } from "./providers/gitlab.js"

export interface ParsedRemote {
  host: string
  owner: string
  repo: string
}

/**
 * Parse a git remote URL into host, owner, and repo.
 * Handles:
 *   - https://{host}/{owner}/{repo}[.git]
 *   - git@{host}:{owner}/{repo}[.git]
 *   - ssh://git@{host}/{owner}/{repo}[.git]
 * For paths with 3+ segments (GitLab nested groups): last segment = repo, rest = owner.
 */
export function parseGitRemoteUrl(url: string): ParsedRemote | null {
  let host: string
  let pathPart: string

  // ssh://git@{host}/{path}
  const sshProtoMatch = url.match(
    /^ssh:\/\/[^@]+@([^/]+)\/(.+?)(?:\.git)?$/,
  )
  if (sshProtoMatch) {
    host = sshProtoMatch[1]!
    pathPart = sshProtoMatch[2]!
  } else {
    // git@{host}:{path}
    const sshMatch = url.match(/^[^@]+@([^:]+):(.+?)(?:\.git)?$/)
    if (sshMatch) {
      host = sshMatch[1]!
      pathPart = sshMatch[2]!
    } else {
      // https://{host}/{path}
      try {
        const parsed = new URL(url)
        host = parsed.hostname
        pathPart = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "")
      } catch {
        return null
      }
    }
  }

  if (!pathPart || !host) return null

  const segments = pathPart.split("/")
  if (segments.length < 2) return null

  const repo = segments[segments.length - 1]!
  const owner = segments.slice(0, -1).join("/")

  return { host, owner, repo }
}

const KNOWN_HOSTS: Record<string, "github" | "gitlab"> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
}

/**
 * Detect the provider from a remote URL with optional env override.
 * Priority: envOverride > URL host detection > default (gitea).
 */
export function detectProvider(
  remoteUrl: string | null,
  envOverride?: string,
): "gitea" | "github" | "gitlab" {
  if (
    envOverride === "github" ||
    envOverride === "gitlab" ||
    envOverride === "gitea"
  ) {
    return envOverride
  }

  if (!remoteUrl) return "gitea"

  const parsed = parseGitRemoteUrl(remoteUrl)
  if (!parsed) return "gitea"

  return KNOWN_HOSTS[parsed.host] ?? "gitea"
}

/**
 * Create the appropriate IssueProvider based on git remote URL and env vars.
 * - Reads PILOT_PROVIDER env for override
 * - Uses $ shell to run `git remote get-url origin` for auto-detection
 * - Falls back to GiteaProvider when detection fails
 *
 * Known limitations:
 * - GitHub Enterprise not supported (uses different API base URL)
 * - Self-hosted GitLab indistinguishable from self-hosted Gitea by URL; use PILOT_PROVIDER
 * - Only checks the `origin` remote
 */
export async function createProvider($?: PluginInput["$"]): Promise<IssueProvider> {
  const envOverride = process.env.PILOT_PROVIDER

  let remoteUrl: string | null = null
  if ($) {
    try {
      remoteUrl =
        (await $`git remote get-url origin`.quiet().nothrow().text()).trim() ||
        null
    } catch {
      remoteUrl = null
    }
  }

  const providerName = detectProvider(remoteUrl, envOverride)

  switch (providerName) {
    case "github":
      return new GitHubProvider()
    case "gitlab":
      return new GitLabProvider()
    default:
      return new GiteaProvider()
  }
}
