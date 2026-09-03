import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { GiteaProvider } from "../../src/providers/gitea"
import { ProviderError } from "../../src/types"

function mockResponse(body: unknown, status = 200, statusText = "OK") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  })
}

describe("GiteaProvider", () => {
  let provider: GiteaProvider
  let capturedCalls: Array<{ url: string; opts?: RequestInit }>
  let responseQueue: Response[]
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    capturedCalls = []
    responseQueue = []
    provider = new GiteaProvider({
      baseUrl: "http://gitea.test/api/v1",
      token: "test-token",
      authHeader: { key: "Authorization", value: "token test-token" },
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function setMockResponses(...responses: Response[]) {
    responseQueue = [...responses]
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedCalls.push({ url: String(input), opts: init })
      return responseQueue.shift() ?? mockResponse({}, 500, "No more mocks")
    }) as typeof fetch
  }

  it("listIssues sends GET with query params and normalizes response", async () => {
    setMockResponses(
      mockResponse([
        {
          number: 1,
          title: "Bug",
          body: "desc",
          state: "open",
          labels: [{ name: "bug" }],
          html_url: "http://gitea.test/org/repo/issues/1",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ]),
    )

    const issues = await provider.listIssues({
      owner: "org",
      repo: "repo",
      state: "open",
      labels: "bug",
      page: 1,
      limit: 20,
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]!.number).toBe(1)
    expect(issues[0]!.labels).toEqual(["bug"])
    expect(issues[0]!.url).toBe("http://gitea.test/org/repo/issues/1")

    expect(capturedCalls).toHaveLength(1)
    const url = capturedCalls[0]!.url
    expect(url).toContain("/api/v1/repos/org/repo/issues")
    expect(url).toContain("state=open")
    expect(url).toContain("labels=bug")
    expect(url).toContain("page=1")
    expect(url).toContain("limit=20")
  })

  it("listIssues with state open sends state=open", async () => {
    setMockResponses(mockResponse([]))
    await provider.listIssues({ owner: "org", repo: "repo", state: "open" })

    const url = capturedCalls[0]!.url
    expect(url).toContain("state=open")
  })

  it("createIssue with labels resolves names to IDs", async () => {
    setMockResponses(
      mockResponse([
        { id: 1, name: "bug" },
        { id: 2, name: "docs" },
        { id: 3, name: "feature" },
      ]),
      mockResponse({
        number: 42,
        title: "New",
        body: "",
        state: "open",
        labels: [{ name: "bug" }, { name: "feature" }],
        html_url: "http://gitea.test/org/repo/issues/42",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      }),
    )

    const issue = await provider.createIssue({
      owner: "org",
      repo: "repo",
      title: "New",
      labels: ["bug", "feature"],
    })

    expect(issue.number).toBe(42)
    expect(capturedCalls[0]!.url).toContain("/repos/org/repo/labels")

    const body = JSON.parse(capturedCalls[1]!.opts!.body as string)
    expect(body.labels).toEqual([1, 3])
  })

  it("createIssue throws ProviderError for unresolved labels", async () => {
    setMockResponses(mockResponse([{ id: 1, name: "bug" }]))

    await expect(
      provider.createIssue({
        owner: "org",
        repo: "repo",
        title: "New",
        labels: ["nonexistent"],
      }),
    ).rejects.toThrow('Labels not found in repository: "nonexistent"')
  })

  it("createIssue without labels skips label resolution", async () => {
    setMockResponses(
      mockResponse({
        number: 10,
        title: "No labels",
        body: "",
        state: "open",
        labels: [],
        html_url: "http://gitea.test/org/repo/issues/10",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      }),
    )

    await provider.createIssue({ owner: "org", repo: "repo", title: "No labels" })

    expect(capturedCalls).toHaveLength(1)
    expect(capturedCalls[0]!.url).toContain("/repos/org/repo/issues")
    expect(capturedCalls[0]!.url).not.toContain("/labels")
  })

  it("updateIssue sends PATCH with only provided fields", async () => {
    setMockResponses(
      mockResponse({
        number: 5,
        title: "Updated",
        body: "",
        state: "closed",
        labels: [],
        html_url: "http://gitea.test/org/repo/issues/5",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      }),
    )

    await provider.updateIssue({
      owner: "org",
      repo: "repo",
      issueNumber: 5,
      title: "Updated",
    })

    expect(capturedCalls[0]!.url).toContain("/repos/org/repo/issues/5")
    expect(capturedCalls[0]!.opts!.method).toBe("PATCH")
    const body = JSON.parse(capturedCalls[0]!.opts!.body as string)
    expect(body).toEqual({ title: "Updated" })
    expect(body.state).toBeUndefined()
  })

  it("commentOnIssue sends POST to comments endpoint", async () => {
    setMockResponses(
      mockResponse({
        id: 99,
        body: "LGTM",
        html_url: "http://gitea.test/org/repo/issues/7#comment-99",
        created_at: "2026-01-01T00:00:00Z",
      }),
    )

    const comment = await provider.commentOnIssue({
      owner: "org",
      repo: "repo",
      issueNumber: 7,
      body: "LGTM",
    })

    expect(comment.id).toBe(99)
    expect(comment.body).toBe("LGTM")
    expect(capturedCalls[0]!.url).toContain("/repos/org/repo/issues/7/comments")
    expect(capturedCalls[0]!.opts!.method).toBe("POST")
  })

  it("throws ProviderError when token is missing", async () => {
    const noTokenProvider = new GiteaProvider({
      baseUrl: "http://gitea.test/api/v1",
      token: "",
      authHeader: { key: "Authorization", value: "token " },
    })

    await expect(
      noTokenProvider.listIssues({ owner: "org", repo: "repo" }),
    ).rejects.toThrow(
      "Gitea token not configured. Set GITEA_TOKEN environment variable.",
    )
  })

  it("throws ProviderError on HTTP 404", async () => {
    setMockResponses(mockResponse({}, 404, "Not Found"))

    try {
      await provider.listIssues({ owner: "org", repo: "missing" })
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).message).toBe(
        "Repository or issue not found",
      )
      expect((err as ProviderError).statusCode).toBe(404)
    }
  })

  it("throws ProviderError on HTTP 401/403", async () => {
    setMockResponses(mockResponse({}, 401, "Unauthorized"))

    try {
      await provider.listIssues({ owner: "org", repo: "repo" })
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).message).toBe(
        "Authentication failed. Check your GITEA_TOKEN.",
      )
      expect((err as ProviderError).statusCode).toBe(401)
    }
  })
})
