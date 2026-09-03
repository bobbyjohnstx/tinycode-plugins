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
  const baseUrl =
    (process.env.GITLAB_URL ?? "https://gitlab.com") + "/api/v4"
  const token = process.env.GITLAB_TOKEN ?? ""
  return {
    baseUrl,
    token,
    authHeader: { key: "PRIVATE-TOKEN", value: token },
  }
}

export class GitLabProvider implements IssueProvider {
  readonly name = "gitlab"
  private config: ProviderConfig

  constructor(config?: ProviderConfig) {
    this.config = config ?? createConfig()
  }

  private projectPath(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`)
  }

  private checkToken(): void {
    if (!this.config.token) {
      throw new ProviderError(
        "GitLab token not configured. Set GITLAB_TOKEN environment variable.",
        undefined,
        "gitlab",
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
        "gitlab",
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        "Authentication failed. Check your GITLAB_TOKEN.",
        response.status,
        "gitlab",
      )
    }
    throw new ProviderError(
      `GitLab API error: ${response.status} ${response.statusText}`,
      response.status,
      "gitlab",
    )
  }

  private mapStateFromGitLab(state: string): "open" | "closed" {
    return state === "opened" ? "open" : "closed"
  }

  private mapStateToGitLab(state: string): string {
    return state === "open" ? "opened" : "closed"
  }

  private stateEvent(state: string): string {
    return state === "closed" ? "close" : "reopen"
  }

  private normalizeIssue(raw: Record<string, unknown>): NormalizedIssue {
    const labels = Array.isArray(raw.labels)
      ? (raw.labels as string[])
      : []
    return {
      number: raw.iid as number,
      title: raw.title as string,
      body: (raw.description as string) ?? "",
      state: this.mapStateFromGitLab(raw.state as string),
      labels,
      url: raw.web_url as string,
      created_at: raw.created_at as string,
      updated_at: raw.updated_at as string,
    }
  }

  async listIssues(params: ListIssuesParams): Promise<NormalizedIssue[]> {
    this.checkToken()
    const project = this.projectPath(params.owner, params.repo)
    const query = new URLSearchParams()
    if (params.state) query.set("state", this.mapStateToGitLab(params.state))
    if (params.labels) query.set("labels", params.labels)
    if (params.page) query.set("page", String(params.page))
    if (params.limit) query.set("per_page", String(params.limit))

    const qs = query.toString()
    const path = `/projects/${project}/issues${qs ? `?${qs}` : ""}`
    const response = await this.request(path)
    this.handleResponse(response)
    const issues = (await response.json()) as Array<Record<string, unknown>>
    return issues.map((i) => this.normalizeIssue(i))
  }

  async createIssue(params: CreateIssueParams): Promise<NormalizedIssue> {
    this.checkToken()
    const project = this.projectPath(params.owner, params.repo)
    const body: Record<string, unknown> = {
      title: params.title,
    }
    if (params.body !== undefined) body.description = params.body
    if (params.labels && params.labels.length > 0) {
      body.labels = params.labels.join(",")
    }

    const response = await this.request(
      `/projects/${project}/issues`,
      { method: "POST", body: JSON.stringify(body) },
    )
    this.handleResponse(response)
    const raw = (await response.json()) as Record<string, unknown>
    return this.normalizeIssue(raw)
  }

  async updateIssue(params: UpdateIssueParams): Promise<NormalizedIssue> {
    this.checkToken()
    const project = this.projectPath(params.owner, params.repo)
    const body: Record<string, unknown> = {}
    if (params.title !== undefined) body.title = params.title
    if (params.body !== undefined) body.description = params.body
    if (params.state !== undefined) {
      body.state_event = this.stateEvent(params.state)
    }

    const response = await this.request(
      `/projects/${project}/issues/${params.issueNumber}`,
      { method: "PUT", body: JSON.stringify(body) },
    )
    this.handleResponse(response)
    const raw = (await response.json()) as Record<string, unknown>
    return this.normalizeIssue(raw)
  }

  async commentOnIssue(params: CommentParams): Promise<NormalizedComment> {
    this.checkToken()
    const project = this.projectPath(params.owner, params.repo)
    const response = await this.request(
      `/projects/${project}/issues/${params.issueNumber}/notes`,
      { method: "POST", body: JSON.stringify({ body: params.body }) },
    )
    this.handleResponse(response)
    const raw = (await response.json()) as Record<string, unknown>
    return {
      id: raw.id as number,
      body: raw.body as string,
      url: (raw.noteable_iid
        ? `${this.config.baseUrl.replace("/api/v4", "")}/-/issues/${raw.noteable_iid}#note_${raw.id}`
        : "") as string,
      created_at: raw.created_at as string,
    }
  }
}
