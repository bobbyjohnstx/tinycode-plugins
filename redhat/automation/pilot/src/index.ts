import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"

const MISSING_TOKEN_MSG =
  "Gitea token not configured. Set GITEA_TOKEN environment variable."

function getConfig() {
  return {
    url: process.env.GITEA_URL || "http://localhost:3000",
    token: process.env.GITEA_TOKEN,
  }
}

async function giteaFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const { url, token } = getConfig()
  return fetch(`${url}${path}`, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })
}

function handleError(response: Response): string {
  if (response.status === 404) return "Issue or repository not found"
  if (response.status === 401 || response.status === 403)
    return "Authentication failed. Check your GITEA_TOKEN."
  return `Gitea API error: ${response.status} ${response.statusText}`
}

function createTools(): Record<string, ToolDefinition> {
  return {
    gitea_issues_list: {
      description:
        "List issues in a Gitea repository with optional state and label filters",
      args: {
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        state: z
          .enum(["open", "closed", "all"])
          .optional()
          .describe("Issue state filter (default: open)"),
        labels: z
          .string()
          .optional()
          .describe("Comma-separated label filter"),
        page: z.number().optional().describe("Page number (default: 1)"),
      },
      async execute(args) {
        const { token } = getConfig()
        if (!token) return MISSING_TOKEN_MSG

        const state = args.state || "open"
        const page = args.page || 1
        const params = new URLSearchParams({
          state,
          page: String(page),
          limit: "20",
        })
        if (args.labels) params.set("labels", args.labels)

        const response = await giteaFetch(
          `/api/v1/repos/${args.owner}/${args.repo}/issues?${params}`,
        )
        if (!response.ok) return handleError(response)

        const issues = (await response.json()) as Array<{
          number: number
          title: string
          state: string
          labels: Array<{ name: string }>
          created_at: string
        }>

        const lines = issues.map((issue, i) => {
          const labels =
            issue.labels.map((l) => l.name).join(", ") || "none"
          const date = issue.created_at.split("T")[0]
          return `${i + 1}. **#${issue.number}** ${issue.title} — ${issue.state} | Labels: ${labels} | Created: ${date}`
        })

        return `## Issues for ${args.owner}/${args.repo} (${state})\n\n${lines.join("\n")}`
      },
    },

    gitea_issue_create: {
      description: "Create a new issue in a Gitea repository",
      args: {
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        title: z.string().describe("Issue title"),
        body: z.string().optional().describe("Issue body"),
        labels: z.array(z.number()).optional().describe("Label IDs"),
      },
      async execute(args) {
        const { token } = getConfig()
        if (!token) return MISSING_TOKEN_MSG

        const response = await giteaFetch(
          `/api/v1/repos/${args.owner}/${args.repo}/issues`,
          {
            method: "POST",
            body: JSON.stringify({
              title: args.title,
              body: args.body,
              labels: args.labels,
            }),
          },
        )
        if (!response.ok) return handleError(response)

        const issue = (await response.json()) as {
          number: number
          title: string
          html_url: string
        }
        return `Created issue #${issue.number}: ${issue.title}\nURL: ${issue.html_url}`
      },
    },

    gitea_issue_update: {
      description: "Update an existing issue in a Gitea repository",
      args: {
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        issue_number: z.number().describe("Issue number"),
        title: z.string().optional().describe("New title"),
        body: z.string().optional().describe("New body"),
        state: z
          .enum(["open", "closed"])
          .optional()
          .describe("New state"),
      },
      async execute(args) {
        const { token } = getConfig()
        if (!token) return MISSING_TOKEN_MSG

        const updates: Record<string, unknown> = {}
        if (args.title !== undefined) updates.title = args.title
        if (args.body !== undefined) updates.body = args.body
        if (args.state !== undefined) updates.state = args.state

        const response = await giteaFetch(
          `/api/v1/repos/${args.owner}/${args.repo}/issues/${args.issue_number}`,
          {
            method: "PATCH",
            body: JSON.stringify(updates),
          },
        )
        if (!response.ok) return handleError(response)

        const issue = (await response.json()) as {
          number: number
          title: string
        }
        return `Updated issue #${issue.number}: ${issue.title}`
      },
    },

    gitea_issue_comment: {
      description: "Add a comment to an issue in a Gitea repository",
      args: {
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        issue_number: z.number().describe("Issue number"),
        body: z.string().describe("Comment body"),
      },
      async execute(args) {
        const { token } = getConfig()
        if (!token) return MISSING_TOKEN_MSG

        const response = await giteaFetch(
          `/api/v1/repos/${args.owner}/${args.repo}/issues/${args.issue_number}/comments`,
          {
            method: "POST",
            body: JSON.stringify({ body: args.body }),
          },
        )
        if (!response.ok) return handleError(response)

        return `Comment added to issue #${args.issue_number}`
      },
    },
  }
}

export default {
  server: async (): Promise<Hooks> => ({
    tool: createTools(),
  }),
} satisfies PluginModule
