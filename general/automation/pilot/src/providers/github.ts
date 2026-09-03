import type {
  IssueProvider,
  ProviderConfig,
  ListIssuesParams,
  CreateIssueParams,
  UpdateIssueParams,
  CommentParams,
  NormalizedIssue,
  NormalizedComment,
} from "../types.js"
import { ProviderError } from "../types.js"

function createConfig(): ProviderConfig {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ""
  return {
    baseUrl: "https://api.github.com",
    token,
    authHeader: { key: "Authorization", value: `Bearer ${token}` },
  }
}

export class GitHubProvider implements IssueProvider {
  readonly name = "github"
  private config: ProviderConfig

  constructor(config?: ProviderConfig) {
    this.config = config ?? createConfig()
  }

  private checkToken(): void {
    if (!this.config.token) {
      throw new ProviderError(
        "GitHub token not configured. Set GITHUB_TOKEN or GH_TOKEN environment variable.",
        undefined,
        "github",
      )
    }
  }

  private async request(
    path: string,
    options?: RequestInit,
  ): Promise<Response> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...options,
      headers: {
        [this.config.authHeader.key]: this.config.authHeader.value,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
        ...options?.headers,
      },
    })
    return response
  }

  private handleResponse(response: Response): void {
    if (response.ok) return
    if (response.status === 404) {
      throw new ProviderError(
        "Repository or issue not found",
        404,
        "github",
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        "Authentication failed. Check your GITHUB_TOKEN.",
        response.status,
        "github",
      )
    }
    throw new ProviderError(
      `GitHub API error: ${response.status} ${response.statusText}`,
      response.status,
      "github",
    )
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
    if (params.limit) query.set("per_page", String(params.limit))

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
      body.labels = params.labels
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
