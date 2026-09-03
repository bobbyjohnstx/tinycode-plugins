import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { GitHubProvider } from "../../src/providers/github"
import { ProviderError } from "../../src/types"

function mockResponse(body: unknown, status = 200, statusText = "OK") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  })
}

describe("GitHubProvider", () => {
  let provider: GitHubProvider
  let capturedCalls: Array<{ url: string; opts?: RequestInit }>
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    capturedCalls = []
    provider = new GitHubProvider({
      baseUrl: "https://api.github.com",
      token: "ghp_test123",
      authHeader: { key: "Authorization", value: "Bearer ghp_test123" },
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockFetch(response: Response) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedCalls.push({ url: String(input), opts: init })
      return response
    }) as typeof fetch
  }

  it("listIssues sends GET and normalizes response", async () => {
    mockFetch(
      mockResponse([
        {
          number: 1,
          title: "Bug",
          body: "desc",
          state: "open",
          labels: [{ name: "bug" }],
          html_url: "https://github.com/org/repo/issues/1",
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
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]!.labels).toEqual(["bug"])
    expect(issues[0]!.url).toBe("https://github.com/org/repo/issues/1")

    expect(capturedCalls).toHaveLength(1)
    const url = capturedCalls[0]!.url
    expect(url).toContain("https://api.github.com/repos/org/repo/issues")
    expect(url).toContain("state=open")
    expect(url).toContain("labels=bug")
  })

  it("createIssue sends labels as string array (no resolution needed)", async () => {
    mockFetch(
      mockResponse({
        number: 42,
        title: "Feature",
        body: "",
        state: "open",
        labels: [{ name: "bug" }],
        html_url: "https://github.com/org/repo/issues/42",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      }),
    )

    await provider.createIssue({
      owner: "org",
      repo: "repo",
      title: "Feature",
      labels: ["bug"],
    })

    expect(capturedCalls).toHaveLength(1)
    const body = JSON.parse(capturedCalls[0]!.opts!.body as string)
    expect(body.labels).toEqual(["bug"])
  })

  it("updateIssue sends PATCH with provided fields", async () => {
    mockFetch(
      mockResponse({
        number: 5,
        title: "Updated",
        body: "",
        state: "closed",
        labels: [],
        html_url: "https://github.com/org/repo/issues/5",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      }),
    )

    await provider.updateIssue({
      owner: "org",
      repo: "repo",
      issueNumber: 5,
      state: "closed",
    })

    expect(capturedCalls[0]!.opts!.method).toBe("PATCH")
    const body = JSON.parse(capturedCalls[0]!.opts!.body as string)
    expect(body.state).toBe("closed")
  })

  it("commentOnIssue sends POST to comments endpoint", async () => {
    mockFetch(
      mockResponse({
        id: 99,
        body: "Nice",
        html_url: "https://github.com/org/repo/issues/7#issuecomment-99",
        created_at: "2026-01-01T00:00:00Z",
      }),
    )

    const comment = await provider.commentOnIssue({
      owner: "org",
      repo: "repo",
      issueNumber: 7,
      body: "Nice",
    })

    expect(comment.id).toBe(99)
    expect(capturedCalls[0]!.url).toContain(
      "/repos/org/repo/issues/7/comments",
    )
  })

  it("throws ProviderError when token is missing", async () => {
    const noTokenProvider = new GitHubProvider({
      baseUrl: "https://api.github.com",
      token: "",
      authHeader: { key: "Authorization", value: "Bearer " },
    })

    await expect(
      noTokenProvider.listIssues({ owner: "org", repo: "repo" }),
    ).rejects.toThrow(
      "GitHub token not configured. Set GITHUB_TOKEN or GH_TOKEN environment variable.",
    )
  })

  it("throws ProviderError on HTTP 404", async () => {
    mockFetch(mockResponse({}, 404, "Not Found"))

    try {
      await provider.listIssues({ owner: "org", repo: "missing" })
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).statusCode).toBe(404)
    }
  })

  it("throws ProviderError on HTTP 401/403 referencing GITHUB_TOKEN", async () => {
    mockFetch(mockResponse({}, 403, "Forbidden"))

    try {
      await provider.listIssues({ owner: "org", repo: "repo" })
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).message).toContain("GITHUB_TOKEN")
      expect((err as ProviderError).statusCode).toBe(403)
    }
  })
})
