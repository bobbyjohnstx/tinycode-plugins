import type { Hooks, PluginModule, ToolContext, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createAapClient } from "./aap-client"
import type { AapClient, Collection, Inventory, Job, JobTemplate } from "./aap-client"
import { createLintTools } from "./lint-tools"

const optionsSchema = z
  .object({
    controllerUrl: z.string().url(),
    oauthToken: z.string().optional(),
  })
  .optional()

function notConfigured(): string {
  return "AAP plugin not configured. Set controllerUrl in plugin options."
}

function formatTemplates(templates: JobTemplate[]): string {
  if (templates.length === 0) {
    return "No job templates found."
  }

  const lines = [
    `Job templates: ${templates.length}`,
    "",
    ...templates.map((t) => {
      const name = t.name ?? "unknown"
      const desc = t.description ? ` — ${t.description}` : ""
      const status = t.status ? ` [${t.status}]` : ""
      return `- #${t.id ?? "?"} ${name}${desc}${status}`
    }),
  ]

  return lines.join("\n")
}

function formatJob(job: Job): string {
  const lines = [
    `Job #${job.id ?? "?"}`,
    `Name: ${job.name ?? "unknown"}`,
    `Status: ${job.status ?? "unknown"}`,
  ]

  if (job.started) {
    lines.push(`Started: ${job.started}`)
  }
  if (job.finished) {
    lines.push(`Finished: ${job.finished}`)
  }
  if (job.elapsed !== undefined) {
    lines.push(`Elapsed: ${job.elapsed}s`)
  }

  return lines.join("\n")
}

function formatInventories(inventories: Inventory[]): string {
  if (inventories.length === 0) {
    return "No inventories found."
  }

  const lines = [
    `Inventories: ${inventories.length}`,
    "",
    ...inventories.map((inv) => {
      const name = inv.name ?? "unknown"
      const desc = inv.description ? ` — ${inv.description}` : ""
      const hosts = inv.total_hosts ?? 0
      const failures = inv.hosts_with_active_failures ?? 0
      return `- #${inv.id ?? "?"} ${name}${desc} (${hosts} hosts, ${failures} failures)`
    }),
  ]

  return lines.join("\n")
}

function formatCollections(collections: Collection[]): string {
  if (collections.length === 0) {
    return "No collections found."
  }

  const lines = [
    `Collections: ${collections.length}`,
    "",
    ...collections.map((c) => {
      const ns = c.namespace?.name ?? "unknown"
      const name = c.name ?? "unknown"
      const version = c.latest_version?.version ?? "?"
      const desc = c.description ? ` — ${c.description}` : ""
      return `- ${ns}.${name} v${version}${desc}`
    }),
  ]

  return lines.join("\n")
}

function createTools(client: AapClient): Record<string, ToolDefinition> {
  return {
    aap_list_templates: {
      description:
        "List job templates from AAP Controller with name, description, and last run status.",
      args: {
        search: z.string().optional().describe("Filter templates by name"),
      },
      async execute(args: { search?: string }) {
        try {
          const result = await client.listTemplates(args.search)
          return formatTemplates(result.results ?? [])
        } catch (error) {
          return `Failed to list templates: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    aap_launch_job: {
      description:
        "Launch a job template on AAP Controller. Requires user confirmation before launching. Returns the job ID.",
      args: {
        templateId: z.number().describe("The job template ID to launch"),
        extraVars: z
          .string()
          .optional()
          .describe("Extra variables as JSON or YAML string"),
      },
      async execute(args: { templateId: number; extraVars?: string }, ctx: ToolContext) {
        try {
          await ctx.ask({
            permission: "aap_launch_job",
            patterns: [`Launch job template #${args.templateId}`],
            always: [],
            metadata: {
              templateId: String(args.templateId),
              ...(args.extraVars ? { extraVars: args.extraVars } : {}),
            },
          })

          const result = await client.launchJob(args.templateId, args.extraVars)
          const jobId = result.job ?? result.id ?? "unknown"
          return `Job launched successfully. Job ID: ${jobId}`
        } catch (error) {
          return `Failed to launch job: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    aap_job_status: {
      description:
        "Check the status of a job on AAP Controller (pending, running, successful, failed).",
      args: {
        jobId: z.number().describe("The job ID to check"),
      },
      async execute(args: { jobId: number }) {
        try {
          const result = await client.getJobStatus(args.jobId)
          return formatJob(result)
        } catch (error) {
          return `Failed to get job status: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    aap_job_output: {
      description: "Get the stdout output of a job from AAP Controller.",
      args: {
        jobId: z.number().describe("The job ID to get output for"),
      },
      async execute(args: { jobId: number }) {
        try {
          const output = await client.getJobOutput(args.jobId)
          if (!output || (typeof output === "string" && output.trim() === "")) {
            return "No output available for this job."
          }
          return typeof output === "string" ? output : JSON.stringify(output)
        } catch (error) {
          return `Failed to get job output: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    aap_list_inventories: {
      description:
        "List inventories from AAP Controller with host counts.",
      args: {
        search: z.string().optional().describe("Filter inventories by name"),
      },
      async execute(args: { search?: string }) {
        try {
          const result = await client.listInventories(args.search)
          return formatInventories(result.results ?? [])
        } catch (error) {
          return `Failed to list inventories: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    aap_hub_search: {
      description:
        "Search Automation Hub for Ansible collections by keyword.",
      args: {
        keyword: z.string().describe("Search keyword for collections"),
      },
      async execute(args: { keyword: string }) {
        try {
          const result = await client.searchCollections(args.keyword)
          return formatCollections(result.results ?? [])
        } catch (error) {
          return `Failed to search collections: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

function createUnconfiguredTools(): Record<string, ToolDefinition> {
  return {
    aap_list_templates: {
      description:
        "List job templates from AAP Controller with name, description, and last run status.",
      args: {
        search: z.string().optional().describe("Filter templates by name"),
      },
      async execute(_args: { search?: string }) {
        return notConfigured()
      },
    },

    aap_launch_job: {
      description:
        "Launch a job template on AAP Controller. Requires user confirmation before launching. Returns the job ID.",
      args: {
        templateId: z.number().describe("The job template ID to launch"),
        extraVars: z
          .string()
          .optional()
          .describe("Extra variables as JSON or YAML string"),
      },
      async execute(_args: { templateId: number; extraVars?: string }) {
        return notConfigured()
      },
    },

    aap_job_status: {
      description:
        "Check the status of a job on AAP Controller (pending, running, successful, failed).",
      args: {
        jobId: z.number().describe("The job ID to check"),
      },
      async execute(_args: { jobId: number }) {
        return notConfigured()
      },
    },

    aap_job_output: {
      description: "Get the stdout output of a job from AAP Controller.",
      args: {
        jobId: z.number().describe("The job ID to get output for"),
      },
      async execute(_args: { jobId: number }) {
        return notConfigured()
      },
    },

    aap_list_inventories: {
      description:
        "List inventories from AAP Controller with host counts.",
      args: {
        search: z.string().optional().describe("Filter inventories by name"),
      },
      async execute(_args: { search?: string }) {
        return notConfigured()
      },
    },

    aap_hub_search: {
      description:
        "Search Automation Hub for Ansible collections by keyword.",
      args: {
        keyword: z.string().describe("Search keyword for collections"),
      },
      async execute(_args: { keyword: string }) {
        return notConfigured()
      },
    },
  }
}

export default {
  schema: optionsSchema,
  server: async (input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined
    const lintTools = createLintTools(input.$)

    if (!parsed?.controllerUrl || !parsed.oauthToken) {
      return {
        tool: { ...createUnconfiguredTools(), ...lintTools },
      }
    }

    const token = parsed.oauthToken
    const client = createAapClient(parsed.controllerUrl, token)

    return {
      tool: { ...createTools(client), ...lintTools },
      "shell.env": async (
        _event: { cwd: string; sessionID?: string; callID?: string },
        output: { env: Record<string, string> },
      ) => {
        output.env["CONTROLLER_HOST"] = parsed.controllerUrl
        output.env["CONTROLLER_OAUTH_TOKEN"] = token
      },
    }
  },
} satisfies PluginModule
