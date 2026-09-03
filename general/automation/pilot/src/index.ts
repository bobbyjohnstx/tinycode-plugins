import type {
  Hooks,
  PluginModule,
  PluginInput,
  PluginOptions,
  ToolDefinition,
} from "tinycode-plugin"
import { z } from "zod"
import type { IssueProvider, NormalizedIssue } from "./types.js"
import { ProviderError } from "./types.js"
import { createProvider } from "./provider-factory.js"

function formatIssueList(
  issues: NormalizedIssue[],
  owner: string,
  repo: string,
  state: string,
): string {
  if (issues.length === 0) return `No issues found for ${owner}/${repo} (${state})`

  const lines = issues.map((issue, i) => {
    const labels = issue.labels.join(", ") || "none"
    const date = issue.created_at.split("T")[0]
    return `${i + 1}. **#${issue.number}** ${issue.title} — ${issue.state} | Labels: ${labels} | Created: ${date}`
  })

  return `## Issues for ${owner}/${repo} (${state})\n\n${lines.join("\n")}`
}

function handleProviderError(err: unknown): string {
  if (err instanceof ProviderError) return err.message
  return `Unexpected error: ${String(err)}`
}

function createTools(provider: IssueProvider): Record<string, ToolDefinition> {
  return {
    pilot_issues_list: {
      description:
        "List issues in a repository with optional state and label filters",
      args: {
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        state: z
          .enum(["open", "closed"])
          .optional()
          .describe("Issue state filter (default: open)"),
        labels: z
          .string()
          .optional()
          .describe("Comma-separated label filter"),
        page: z.number().optional().describe("Page number (default: 1)"),
      },
      async execute(args: {
        owner: string
        repo: string
        state?: "open" | "closed"
        labels?: string
        page?: number
      }) {
        const state = args.state || "open"
        try {
          const issues = await provider.listIssues({
            owner: args.owner,
            repo: args.repo,
            state,
            labels: args.labels,
            page: args.page,
            limit: 20,
          })
          return formatIssueList(issues, args.owner, args.repo, state)
        } catch (err) {
          return handleProviderError(err)
        }
      },
    },

    pilot_issue_create: {
      description: "Create a new issue in a repository",
      args: {
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        title: z.string().describe("Issue title"),
        body: z.string().optional().describe("Issue body"),
        labels: z
          .array(z.string())
          .optional()
          .describe("Label names"),
      },
      async execute(args: {
        owner: string
        repo: string
        title: string
        body?: string
        labels?: string[]
      }) {
        try {
          const issue = await provider.createIssue({
            owner: args.owner,
            repo: args.repo,
            title: args.title,
            body: args.body,
            labels: args.labels,
          })
          return `Created issue #${issue.number}: ${issue.title}\nURL: ${issue.url}`
        } catch (err) {
          return handleProviderError(err)
        }
      },
    },

    pilot_issue_update: {
      description: "Update an existing issue in a repository",
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
      async execute(args: {
        owner: string
        repo: string
        issue_number: number
        title?: string
        body?: string
        state?: "open" | "closed"
      }) {
        try {
          const issue = await provider.updateIssue({
            owner: args.owner,
            repo: args.repo,
            issueNumber: args.issue_number,
            title: args.title,
            body: args.body,
            state: args.state,
          })
          return `Updated issue #${issue.number}: ${issue.title}`
        } catch (err) {
          return handleProviderError(err)
        }
      },
    },

    pilot_issue_comment: {
      description: "Add a comment to an issue in a repository",
      args: {
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        issue_number: z.number().describe("Issue number"),
        body: z.string().describe("Comment body"),
      },
      async execute(args: {
        owner: string
        repo: string
        issue_number: number
        body: string
      }) {
        try {
          await provider.commentOnIssue({
            owner: args.owner,
            repo: args.repo,
            issueNumber: args.issue_number,
            body: args.body,
          })
          return `Comment added to issue #${args.issue_number}`
        } catch (err) {
          return handleProviderError(err)
        }
      },
    },
  }
}

export default {
  server: async (input: PluginInput, options?: PluginOptions): Promise<Hooks> => {
    const provider = await createProvider(input.$)
    return {
      tool: createTools(provider),
    }
  },
} satisfies PluginModule
