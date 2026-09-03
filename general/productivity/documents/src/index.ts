import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import path from "node:path"
import { readDocument } from "./reader.js"

export function createTools(): Record<string, ToolDefinition> {
  return {
    read_document: {
      description:
        "Read the contents of a document file (PDF, Word, Excel, PowerPoint, CSV, or text)",
      args: {
        path: z.string().describe("Path to the document file to read"),
      },
      async execute(args: { path: string }, context) {
        const filePath = path.resolve(context.directory, args.path)
        return readDocument(filePath)
      },
    },
    write_document: {
      description:
        "Write or modify a document file using structured operations (Word, Excel, PowerPoint, PDF, CSV, or text)",
      args: {
        path: z.string().describe("Path to the document file to write"),
        operations: z
          .string()
          .describe(
            "JSON string of operations array — each operation has a 'type' field plus format-specific parameters",
          ),
      },
      async execute(args, context) {
        return "Not yet implemented"
      },
    },
    convert_document: {
      description:
        "Convert a document to JSON or Markdown format (supports Excel, CSV, Word, PDF)",
      args: {
        input: z.string().describe("Path to the source document"),
        output: z.string().describe("Path for the converted output file"),
        format: z.enum(["json", "markdown"]).describe("Output format"),
      },
      async execute(args, context) {
        return "Not yet implemented"
      },
    },
  }
}

export default {
  server: async (): Promise<Hooks> => ({
    tool: createTools(),
  }),
} satisfies PluginModule
