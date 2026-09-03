export interface NormalizedIssue {
  number: number
  title: string
  body: string
  state: "open" | "closed"
  labels: string[]
  url: string
  created_at: string
  updated_at: string
}

export interface NormalizedComment {
  id: number
  body: string
  url: string
  created_at: string
}

export interface ProviderConfig {
  baseUrl: string
  token: string
  authHeader: { key: string; value: string }
}

export interface ListIssuesParams {
  owner: string
  repo: string
  state?: "open" | "closed"
  labels?: string
  page?: number
  limit?: number
}

export interface CreateIssueParams {
  owner: string
  repo: string
  title: string
  body?: string
  labels?: string[]
}

export interface UpdateIssueParams {
  owner: string
  repo: string
  issueNumber: number
  title?: string
  body?: string
  state?: "open" | "closed"
}

export interface CommentParams {
  owner: string
  repo: string
  issueNumber: number
  body: string
}

export interface IssueProvider {
  readonly name: string
  listIssues(params: ListIssuesParams): Promise<NormalizedIssue[]>
  createIssue(params: CreateIssueParams): Promise<NormalizedIssue>
  updateIssue(params: UpdateIssueParams): Promise<NormalizedIssue>
  commentOnIssue(params: CommentParams): Promise<NormalizedComment>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly provider?: string,
  ) {
    super(message)
  }
}
