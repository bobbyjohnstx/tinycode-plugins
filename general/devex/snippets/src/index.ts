import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { TEMPLATES } from "./templates"
import { readdir, readFile } from "node:fs/promises"
import { join, parse } from "node:path"
import { homedir } from "node:os"

async function loadCustomTemplates(): Promise<
  Record<string, { description: string; content: string }>
> {
  const dir =
    process.env.SNIPPETS_DIR || join(homedir(), ".tinycode", "snippets")
  try {
    const files = await readdir(dir)
    const templates: Record<string, { description: string; content: string }> =
      {}
    for (const file of files) {
      if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        const name = parse(file).name
        const content = await readFile(join(dir, file), "utf-8")
        templates[name] = { description: `Custom template: ${name}`, content }
      }
    }
    return templates
  } catch {
    return {}
  }
}

async function getAllTemplates(): Promise<
  Record<string, { description: string; content: string }>
> {
  const custom = await loadCustomTemplates()
  return { ...TEMPLATES, ...custom }
}

function expandTemplate(
  content: string,
  variables: Record<string, string>,
): { result: string; unresolved: string[] } {
  let result = content
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value)
  }
  const matches = result.match(/\{\{[^}]+\}\}/g)
  const unresolved = matches ? [...new Set(matches)] : []
  return { result, unresolved }
}

export function createTools(): Record<string, ToolDefinition> {
  return {
    snippet_list: {
      description:
        "List available snippet templates with their names and descriptions",
      args: {},
      async execute() {
        const templates = await getAllTemplates()
        return Object.entries(templates)
          .map(([name, { description }]) => `${name} — ${description}`)
          .join("\n")
      },
    },
    snippet_expand: {
      description:
        "Expand a snippet template by name, replacing {{variable}} placeholders with provided values",
      args: {
        name: z
          .string()
          .describe("Template name (e.g., 'deployment', 'service')"),
        variables: z
          .record(z.string(), z.string())
          .optional()
          .describe("Variable substitutions as key-value pairs"),
      },
      async execute(args: { name: string; variables?: Record<string, string> }) {
        const templates = await getAllTemplates()
        const template = templates[args.name]
        if (!template) {
          const available = Object.keys(templates).join(", ")
          return `Unknown template "${args.name}". Available templates: ${available}`
        }

        const { result, unresolved } = expandTemplate(
          template.content,
          args.variables ?? {},
        )

        if (unresolved.length > 0) {
          return `${result}\n\nNote: Unresolved variables: ${unresolved.join(", ")}`
        }
        return result
      },
    },
  }
}

export default {
  server: async (): Promise<Hooks> => ({
    tool: createTools(),
  }),
} satisfies PluginModule
