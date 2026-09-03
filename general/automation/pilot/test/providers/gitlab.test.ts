import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { GitLabProvider } from "../../src/providers/gitlab"
import { ProviderError } from "../../src/types"

function mockResponse(body: unknown, status = 200, statusText = "OK") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  })
}

function gitlabIssue(overrides: Record<string, unknown> = {}) {
  return {
    iid: 1,
    title: "Bug",
    description: "desc",
    state: "opened",
    labels: ["bug"],
    web_url: "https://gitlab.com/mygroup/myproject/-/issues/1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  }
}

describe("GitLabProvider", () => {
  let provider: GitLabProvider
  let capturedCalls: Array<{ url: string; opts?: RequestInit }>
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    capturedCalls = []
    provider = new GitLabProvider({
      baseUrl: "https://gitlab.com/api/v4",
      token: "glpat-test123",
      authHeader: { key: "PRIVATE-TOKEN", value: "glpat-test123" },
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function setMockResponse(response: Response) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedCalls.push({ url: String(input), opts: init })
      return response
    }) as typeof fetch
  }

  it("listIssues URL-encodes project path and normalizes opened to open", async () => {
    setMockResponse(mockResponse([gitlabIssue()]))

    const issues = await provider.listIssues({
      owner: "mygroup",
      repo: "myproject",
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]!.state).toBe("open")
    expect(issues[0]!.url).toBe(
      "https://gitlab.com/mygroup/myproject/-/issues/1",
    )
    expect(issues[0]!.body).toBe("desc")

    expect(capturedCalls[0]!.url).toContain(
      "/projects/mygroup%2Fmyproject/issues",
    )
  })

  it("listIssues with state open sends state=opened", async () => {
    setMockResponse(mockResponse([]))

    await provider.listIssues({
      owner: "mygroup",
      repo: "myproject",
      state: "open",
    })

    expect(capturedCalls[0]!.url).toContain("state=opened")
  })

  it("listIssues with nested group encodes correctly", async () => {
    setMockResponse(mockResponse([]))

    await provider.listIssues({
      owner: "group/subgroup",
      repo: "project",
    })

    expect(capturedCalls[0]!.url).toContain(
      "/projects/group%2Fsubgroup%2Fproject/issues",
    )
  })

  it("createIssue sends labels as comma-separated string", async () => {
    setMockResponse(
      mockResponse(gitlabIssue({ iid: 42, labels: ["bug", "feature"] })),
    )

    await provider.createIssue({
      owner: "mygroup",
      repo: "myproject",
      title: "New issue",
      labels: ["bug", "feature"],
    })

    const body = JSON.parse(capturedCalls[0]!.opts!.body as string)
    expect(body.labels).toBe("bug,feature")
  })

  it("updateIssue with state closed sends PUT with state_event close", async () => {
    setMockResponse(mockResponse(gitlabIssue({ state: "closed" })))

    await provider.updateIssue({
      owner: "mygroup",
      repo: "myproject",
      issueNumber: 1,
      state: "closed",
    })

    expect(capturedCalls[0]!.opts!.method).toBe("PUT")
    const body = JSON.parse(capturedCalls[0]!.opts!.body as string)
    expect(body.state_event).toBe("close")
    expect(body.state).toBeUndefined()
  })

  it("updateIssue with state open sends PUT with state_event reopen", async () => {
    setMockResponse(mockResponse(gitlabIssue()))

    await provider.updateIssue({
      owner: "mygroup",
      repo: "myproject",
      issueNumber: 1,
      state: "open",
    })

    const body = JSON.parse(capturedCalls[0]!.opts!.body as string)
    expect(body.state_event).toBe("reopen")
  })

  it("updateIssue with only title sends no state_event", async () => {
    setMockResponse(mockResponse(gitlabIssue({ title: "Updated" })))

    await provider.updateIssue({
      owner: "mygroup",
      repo: "myproject",
      issueNumber: 1,
      title: "Updated",
    })

    const body = JSON.parse(capturedCalls[0]!.opts!.body as string)
    expect(body.title).toBe("Updated")
    expect(body.state_event).toBeUndefined()
  })

  it("commentOnIssue sends POST to notes endpoint", async () => {
    setMockResponse(
      mockResponse({
        id: 99,
        body: "Looks good",
        created_at: "2026-01-01T00:00:00Z",
      }),
    )

    const comment = await provider.commentOnIssue({
      owner: "mygroup",
      repo: "myproject",
      issueNumber: 1,
      body: "Looks good",
    })

    expect(comment.id).toBe(99)
    expect(comment.body).toBe("Looks good")
    expect(capturedCalls[0]!.url).toContain(
      "/projects/mygroup%2Fmyproject/issues/1/notes",
    )
  })

  it("throws ProviderError when token is missing", async () => {
    const noTokenProvider = new GitLabProvider({
      baseUrl: "https://gitlab.com/api/v4",
      token: "",
      authHeader: { key: "PRIVATE-TOKEN", value: "" },
    })

    await expect(
      noTokenProvider.listIssues({ owner: "org", repo: "repo" }),
    ).rejects.toThrow(
      "GitLab token not configured. Set GITLAB_TOKEN environment variable.",
    )
  })

  it("throws ProviderError on HTTP 404", async () => {
    setMockResponse(mockResponse({}, 404, "Not Found"))

    try {
      await provider.listIssues({ owner: "org", repo: "missing" })
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).statusCode).toBe(404)
    }
  })
})
