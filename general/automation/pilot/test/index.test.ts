import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import plugin from "../src/index"

const mockIssues = [
  {
    number: 1,
    title: "Fix login bug",
    body: "Login is broken",
    state: "open",
    labels: [{ name: "bug" }, { name: "urgent" }],
    html_url: "http://gitea.test/org/app/issues/1",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  },
  {
    number: 2,
    title: "Add dark mode",
    body: "",
    state: "open",
    labels: [],
    html_url: "http://gitea.test/org/app/issues/2",
    created_at: "2026-08-02T12:00:00Z",
    updated_at: "2026-08-02T12:00:00Z",
  },
]

function mockResponse(body: unknown, status = 200, statusText = "OK") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  })
}

function mockShell(remoteUrl: string) {
  return Object.assign(
    (_strings: TemplateStringsArray) => ({
      quiet: () => ({
        nothrow: () => ({
          text: async () => remoteUrl,
        }),
      }),
    }),
  ) as unknown
}

describe("tinycode-plugin-gen-pilot", () => {
  const originalFetch = globalThis.fetch
  let responseQueue: Response[]
  const savedToken = process.env.GITEA_TOKEN
  const savedUrl = process.env.GITEA_URL
  const savedProvider = process.env.PILOT_PROVIDER

  beforeEach(() => {
    responseQueue = []
    process.env.GITEA_TOKEN = "test-token"
    process.env.GITEA_URL = "http://gitea.test"
    delete process.env.PILOT_PROVIDER
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (savedToken !== undefined) process.env.GITEA_TOKEN = savedToken
    else delete process.env.GITEA_TOKEN
    if (savedUrl !== undefined) process.env.GITEA_URL = savedUrl
    else delete process.env.GITEA_URL
    if (savedProvider !== undefined) process.env.PILOT_PROVIDER = savedProvider
    else delete process.env.PILOT_PROVIDER
  })

  function setMockResponses(...responses: Response[]) {
    responseQueue = [...responses]
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return responseQueue.shift() ?? mockResponse({}, 500, "No more mocks")
    }) as typeof fetch
  }

  async function getTools() {
    const $ = mockShell("https://gitea.example.com/org/app.git\n")
    const hooks = await plugin.server({ $ } as never, undefined)
    return hooks.tool!
  }

  describe("plugin loading", () => {
    it("registers all 4 tools with pilot_ prefix and no gitea_ names", async () => {
      const tools = await getTools()
      expect(tools.pilot_issues_list).toBeDefined()
      expect(tools.pilot_issue_create).toBeDefined()
      expect(tools.pilot_issue_update).toBeDefined()
      expect(tools.pilot_issue_comment).toBeDefined()
      expect(tools.gitea_issues_list).toBeUndefined()
      expect(tools.gitea_issue_create).toBeUndefined()
      expect(tools.gitea_issue_update).toBeUndefined()
      expect(tools.gitea_issue_comment).toBeUndefined()
    })
  })

  describe("pilot_issues_list", () => {
    it("returns formatted issue list", async () => {
      setMockResponses(mockResponse(mockIssues))
      const tools = await getTools()

      const result = (await tools.pilot_issues_list.execute(
        { owner: "org", repo: "app" },
        {} as never,
      )) as string

      expect(result).toContain("## Issues for org/app (open)")
      expect(result).toContain("**#1** Fix login bug")
      expect(result).toContain("bug, urgent")
      expect(result).toContain("**#2** Add dark mode")
      expect(result).toContain("Labels: none")
      expect(result).toContain("2026-08-01")
    })

    it("returns no-issues message for empty list", async () => {
      setMockResponses(mockResponse([]))
      const tools = await getTools()

      const result = (await tools.pilot_issues_list.execute(
        { owner: "org", repo: "app" },
        {} as never,
      )) as string

      expect(result).toContain("No issues found")
    })
  })

  describe("pilot_issue_create", () => {
    it("returns formatted creation confirmation", async () => {
      setMockResponses(
        mockResponse({
          number: 42,
          title: "New feature",
          body: "",
          state: "open",
          labels: [],
          html_url: "http://gitea.test/org/app/issues/42",
          created_at: "2026-08-01T00:00:00Z",
          updated_at: "2026-08-01T00:00:00Z",
        }),
      )
      const tools = await getTools()

      const result = (await tools.pilot_issue_create.execute(
        { owner: "org", repo: "app", title: "New feature", body: "Description" },
        {} as never,
      )) as string

      expect(result).toBe(
        "Created issue #42: New feature\nURL: http://gitea.test/org/app/issues/42",
      )
    })
  })

  describe("pilot_issue_update", () => {
    it("returns formatted update confirmation", async () => {
      setMockResponses(
        mockResponse({
          number: 5,
          title: "Updated title",
          body: "",
          state: "closed",
          labels: [],
          html_url: "http://gitea.test/org/app/issues/5",
          created_at: "2026-08-01T00:00:00Z",
          updated_at: "2026-08-02T00:00:00Z",
        }),
      )
      const tools = await getTools()

      const result = (await tools.pilot_issue_update.execute(
        { owner: "org", repo: "app", issue_number: 5, title: "Updated title" },
        {} as never,
      )) as string

      expect(result).toBe("Updated issue #5: Updated title")
    })
  })

  describe("pilot_issue_comment", () => {
    it("returns formatted comment confirmation", async () => {
      setMockResponses(
        mockResponse({
          id: 99,
          body: "LGTM",
          html_url: "http://gitea.test/org/app/issues/7#comment-99",
          created_at: "2026-08-01T00:00:00Z",
        }),
      )
      const tools = await getTools()

      const result = (await tools.pilot_issue_comment.execute(
        { owner: "org", repo: "app", issue_number: 7, body: "LGTM" },
        {} as never,
      )) as string

      expect(result).toBe("Comment added to issue #7")
    })
  })

  describe("error handling", () => {
    it("returns user-friendly error on HTTP 404", async () => {
      setMockResponses(mockResponse({}, 404, "Not Found"))
      const tools = await getTools()

      const result = (await tools.pilot_issues_list.execute(
        { owner: "org", repo: "missing" },
        {} as never,
      )) as string

      expect(result).toBe("Repository or issue not found")
    })

    it("returns auth error on HTTP 401", async () => {
      setMockResponses(mockResponse({}, 401, "Unauthorized"))
      const tools = await getTools()

      const result = (await tools.pilot_issue_create.execute(
        { owner: "org", repo: "app", title: "test" },
        {} as never,
      )) as string

      expect(result).toContain("Authentication failed")
    })

    it("returns missing token message when GITEA_TOKEN is not set", async () => {
      delete process.env.GITEA_TOKEN
      const tools = await getTools()

      const result = (await tools.pilot_issues_list.execute(
        { owner: "org", repo: "app" },
        {} as never,
      )) as string

      expect(result).toContain("token not configured")
    })
  })
})
