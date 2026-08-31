import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import plugin from "../src/index"

const mockIssues = [
  {
    number: 1,
    title: "Fix login bug",
    state: "open",
    labels: [{ name: "bug" }, { name: "urgent" }],
    created_at: "2026-08-01T10:00:00Z",
  },
  {
    number: 2,
    title: "Add dark mode",
    state: "open",
    labels: [],
    created_at: "2026-08-02T12:00:00Z",
  },
]

function mockResponse(body: unknown, status = 200, statusText = "OK") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  })
}

describe("tinycode-plugin-pilot", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>
  const savedToken = process.env.GITEA_TOKEN
  const savedUrl = process.env.GITEA_URL

  beforeEach(() => {
    process.env.GITEA_TOKEN = "test-token"
    process.env.GITEA_URL = "http://gitea.test"
  })

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore()
    if (savedToken !== undefined) process.env.GITEA_TOKEN = savedToken
    else delete process.env.GITEA_TOKEN
    if (savedUrl !== undefined) process.env.GITEA_URL = savedUrl
    else delete process.env.GITEA_URL
  })

  async function getTools() {
    const hooks = await plugin.server({} as never, undefined)
    return hooks.tool!
  }

  describe("plugin loading", () => {
    it("registers all 4 tools", async () => {
      const tools = await getTools()
      expect(tools.gitea_issues_list).toBeDefined()
      expect(tools.gitea_issue_create).toBeDefined()
      expect(tools.gitea_issue_update).toBeDefined()
      expect(tools.gitea_issue_comment).toBeDefined()
    })
  })

  describe("missing GITEA_TOKEN", () => {
    it("returns setup instructions for all tools", async () => {
      delete process.env.GITEA_TOKEN
      const tools = await getTools()

      const listResult = await tools.gitea_issues_list.execute(
        { owner: "org", repo: "app" },
        {} as never,
      )
      expect(listResult).toBe(
        "Gitea token not configured. Set GITEA_TOKEN environment variable.",
      )

      const createResult = await tools.gitea_issue_create.execute(
        { owner: "org", repo: "app", title: "test" },
        {} as never,
      )
      expect(createResult).toBe(
        "Gitea token not configured. Set GITEA_TOKEN environment variable.",
      )

      const updateResult = await tools.gitea_issue_update.execute(
        { owner: "org", repo: "app", issue_number: 1 },
        {} as never,
      )
      expect(updateResult).toBe(
        "Gitea token not configured. Set GITEA_TOKEN environment variable.",
      )

      const commentResult = await tools.gitea_issue_comment.execute(
        { owner: "org", repo: "app", issue_number: 1, body: "test" },
        {} as never,
      )
      expect(commentResult).toBe(
        "Gitea token not configured. Set GITEA_TOKEN environment variable.",
      )
    })
  })

  describe("gitea_issues_list", () => {
    it("returns formatted issue list", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse(mockIssues),
      )
      const tools = await getTools()

      const result = (await tools.gitea_issues_list.execute(
        { owner: "org", repo: "app" },
        {} as never,
      )) as string

      expect(result).toContain("## Issues for org/app (open)")
      expect(result).toContain("**#1** Fix login bug")
      expect(result).toContain("bug, urgent")
      expect(result).toContain("**#2** Add dark mode")
      expect(result).toContain("Labels: none")
      expect(result).toContain("2026-08-01")

      const url = fetchSpy.mock.calls[0]![0] as string
      expect(url).toContain("http://gitea.test/api/v1/repos/org/app/issues")
      expect(url).toContain("state=open")
      expect(url).toContain("limit=20")
    })

    it("passes state and labels filters", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse([]),
      )
      const tools = await getTools()

      await tools.gitea_issues_list.execute(
        { owner: "org", repo: "app", state: "closed", labels: "bug,critical" },
        {} as never,
      )

      const url = fetchSpy.mock.calls[0]![0] as string
      expect(url).toContain("state=closed")
      expect(url).toContain("labels=bug%2Ccritical")
    })
  })

  describe("gitea_issue_create", () => {
    it("sends correct POST body and returns issue info", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({
          number: 42,
          title: "New feature",
          html_url: "http://gitea.test/org/app/issues/42",
        }),
      )
      const tools = await getTools()

      const result = (await tools.gitea_issue_create.execute(
        {
          owner: "org",
          repo: "app",
          title: "New feature",
          body: "Description here",
          labels: [1, 3],
        },
        {} as never,
      )) as string

      expect(result).toBe(
        "Created issue #42: New feature\nURL: http://gitea.test/org/app/issues/42",
      )

      const call = fetchSpy.mock.calls[0]!
      const url = call[0] as string
      const opts = call[1] as RequestInit
      expect(url).toBe("http://gitea.test/api/v1/repos/org/app/issues")
      expect(opts.method).toBe("POST")
      expect(JSON.parse(opts.body as string)).toEqual({
        title: "New feature",
        body: "Description here",
        labels: [1, 3],
      })
    })
  })

  describe("gitea_issue_update", () => {
    it("sends correct PATCH body with only provided fields", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ number: 5, title: "Updated title" }),
      )
      const tools = await getTools()

      const result = (await tools.gitea_issue_update.execute(
        {
          owner: "org",
          repo: "app",
          issue_number: 5,
          title: "Updated title",
          state: "closed",
        },
        {} as never,
      )) as string

      expect(result).toBe("Updated issue #5: Updated title")

      const call = fetchSpy.mock.calls[0]!
      const url = call[0] as string
      const opts = call[1] as RequestInit
      expect(url).toBe("http://gitea.test/api/v1/repos/org/app/issues/5")
      expect(opts.method).toBe("PATCH")
      expect(JSON.parse(opts.body as string)).toEqual({
        title: "Updated title",
        state: "closed",
      })
    })
  })

  describe("gitea_issue_comment", () => {
    it("sends correct POST body", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ id: 99 }),
      )
      const tools = await getTools()

      const result = (await tools.gitea_issue_comment.execute(
        { owner: "org", repo: "app", issue_number: 7, body: "LGTM" },
        {} as never,
      )) as string

      expect(result).toBe("Comment added to issue #7")

      const call = fetchSpy.mock.calls[0]!
      const url = call[0] as string
      const opts = call[1] as RequestInit
      expect(url).toBe(
        "http://gitea.test/api/v1/repos/org/app/issues/7/comments",
      )
      expect(opts.method).toBe("POST")
      expect(JSON.parse(opts.body as string)).toEqual({ body: "LGTM" })
    })
  })

  describe("error handling", () => {
    it("handles 404 response", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({}, 404, "Not Found"),
      )
      const tools = await getTools()

      const result = (await tools.gitea_issues_list.execute(
        { owner: "org", repo: "missing" },
        {} as never,
      )) as string

      expect(result).toBe("Issue or repository not found")
    })

    it("handles 401 response", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({}, 401, "Unauthorized"),
      )
      const tools = await getTools()

      const result = (await tools.gitea_issue_create.execute(
        { owner: "org", repo: "app", title: "test" },
        {} as never,
      )) as string

      expect(result).toBe("Authentication failed. Check your GITEA_TOKEN.")
    })
  })
})
