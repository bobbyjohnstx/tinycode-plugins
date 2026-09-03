import type { IssueProvider, ProviderConfig, ListIssuesParams, CreateIssueParams, UpdateIssueParams, CommentParams, NormalizedIssue, NormalizedComment } from "../types.js"
import { ProviderError } from "../types.js"

function createConfig(): ProviderConfig {
  const baseUrl =
    (process.env.GITEA_URL ?? "http://localhost:3000") + "/api/v1"
  const token = process.env.GITEA_TOKEN ?? ""
  return {
    baseUrl,
    token,
    authHeader: { key: "Authorization", value: `token ${token}` },
  }
}

export class GiteaProvider implements IssueProvider {
  readonly name = "gitea"
  private config: ProviderConfig

  constructor(config?: ProviderConfig) {
    this.config = config ?? createConfig()
  }

  private checkToken(): void {
    if (!this.config.token) {
      throw new ProviderError(
        "Gitea token not configured. Set GITEA_TOKEN environment variable.",
        undefined,
        "gitea",
      )
    }
  }

  private async request(path: string, options?: RequestInit): Promise<Response> {
    return fetch(`${this.config.baseUrl}${path}`, {
      ...options,
      headers: {
        [this.config.authHeader.key]: this.config.authHeader.value,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    })
  }

  private handleResponse(response: Response): void {
    if (response.ok) return
    if (response.status === 404) {
      throw new ProviderError(
        "Repository or issue not found",
        404,
        "gitea",
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        "Authentication failed. Check your GITEA_TOKEN.",
        response.status,
        "gitea",
      )
    }
    throw new ProviderError(
      `Gitea API error: ${response.status} ${response.statusText}`,
      response.status,
      "gitea",
    )
  }

  private async resolveLabels(
    owner: string,
    repo: string,
    names: string[],
  ): Promise<number[]> {
    const response = await this.request(
      `/repos/${owner}/${repo}/labels`,
    )
    this.handleResponse(response)
    const allLabels = (await response.json()) as Array<{
      id: number
      name: string
    }>

    const ids: number[] = []
    const missing: string[] = []
    for (const name of names) {
      const found = allLabels.find((l) => l.name === name)
      if (found) {
        ids.push(found.id)
      } else {
        missing.push(name)
      }
    }

    if (missing.length > 0) {
      const quoted = missing.map((n) => `"${n}"`).join(", ")
      throw new ProviderError(
        `Labels not found in repository: ${quoted}`,
        undefined,
        "gitea",
      )
    }

    return ids
  }

  private normalizeIssue(raw: Record<string, unknown>): NormalizedIssue {
    const labels = Array.isArray(raw.labels)
      ? (raw.labels as Array<{ name: string }>).map((l) => l.name)
      : []
    return {
      number: raw.number as number,
      title: raw.title as string,
      body: (raw.body as string) ?? "",
      state: raw.state as "open" | "closed",
      labels,
      url: raw.html_url as string,
      created_at: raw.created_at as string,
      updated_at: raw.updated_at as string,
    }
  }

  async listIssues(params: ListIssuesParams): Promise<NormalizedIssue[]> {
    this.checkToken()
    const query = new URLSearchParams()
    if (params.state) query.set("state", params.state)
    if (params.labels) query.set("labels", params.labels)
    if (params.page) query.set("page", String(params.page))
    if (params.limit) query.set("limit", String(params.limit))

    const qs = query.toString()
    const path = `/repos/${params.owner}/${params.repo}/issues${qs ? `?${qs}` : ""}`
    const response = await this.request(path)
    this.handleResponse(response)
    const issues = (await response.json()) as Array<Record<string, unknown>>
    return issues.map((i) => this.normalizeIssue(i))
  }

  async createIssue(params: CreateIssueParams): Promise<NormalizedIssue> {
    this.checkToken()
    const body: Record<string, unknown> = {
      title: params.title,
    }
    if (params.body !== undefined) body.body = params.body
    if (params.labels && params.labels.length > 0) {
      body.labels = await this.resolveLabels(
        params.owner,
        params.repo,
        params.labels,
      )
    }

    const response = await this.request(
      `/repos/${params.owner}/${params.repo}/issues`,
      { method: "POST", body: JSON.stringify(body) },
    )
    this.handleResponse(response)
    const raw = (await response.json()) as Record<string, unknown>
    return this.normalizeIssue(raw)
  }

  async updateIssue(params: UpdateIssueParams): Promise<NormalizedIssue> {
    this.checkToken()
    const body: Record<string, unknown> = {}
    if (params.title !== undefined) body.title = params.title
    if (params.body !== undefined) body.body = params.body
    if (params.state !== undefined) body.state = params.state

    const response = await this.request(
      `/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}`,
      { method: "PATCH", body: JSON.stringify(body) },
    )
    this.handleResponse(response)
    const raw = (await response.json()) as Record<string, unknown>
    return this.normalizeIssue(raw)
  }

  async commentOnIssue(params: CommentParams): Promise<NormalizedComment> {
    this.checkToken()
    const response = await this.request(
      `/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}/comments`,
      { method: "POST", body: JSON.stringify({ body: params.body }) },
    )
    this.handleResponse(response)
    const raw = (await response.json()) as Record<string, unknown>
    return {
      id: raw.id as number,
      body: raw.body as string,
      url: raw.html_url as string,
      created_at: raw.created_at as string,
    }
  }
}
