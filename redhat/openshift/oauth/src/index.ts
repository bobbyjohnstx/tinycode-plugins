import type { PluginModule } from "tinycode-plugin"
import { z } from "zod"
import { tokenManager } from "tinycode-plugin-redhat-shared/auth"

const schema = z
  .object({
    server: z.string().url().optional(),
  })
  .optional()

export default {
  schema,
  server: async (input, options) => {
    const config = schema.parse(options ?? {})

    return {
      auth: {
        provider: "openshift",
        methods: [
          {
            type: "api" as const,
            label: "OpenShift API Token",
            prompts: [
              {
                type: "text" as const,
                key: "server",
                message: "OpenShift cluster API URL",
                placeholder: "https://api.mycluster.example.com:6443",
                validate: (value: string) => {
                  try {
                    new URL(value)
                    return undefined
                  } catch {
                    return "Must be a valid URL"
                  }
                },
              },
              {
                type: "text" as const,
                key: "token",
                message: "API token (starts with sha256~)",
                placeholder: "sha256~...",
                validate: (value: string) => {
                  if (!value.startsWith("sha256~")) {
                    return "Token must start with sha256~"
                  }
                  return undefined
                },
              },
            ],
            authorize: async (inputs?: Record<string, string>) => {
              const server = inputs?.server ?? config?.server
              const token = inputs?.token
              if (!server || !token) {
                return { type: "failed" as const }
              }

              const result = await input
                .$`oc login --token=${token} --server=${server} --insecure-skip-tls-verify`
                .nothrow()
                .quiet()
              if (result.exitCode !== 0) {
                return { type: "failed" as const }
              }

              tokenManager.setToken(server, {
                token,
                source: "oauth",
                server,
              })

              return {
                type: "success" as const,
                key: token,
                metadata: { server },
              }
            },
          },
        ],
      },

      "shell.env": async (
        _event: { cwd: string; sessionID?: string; callID?: string },
        output: { env: Record<string, string> },
      ) => {
        output.env["OC_EDITOR"] = "cat"
      },
    }
  },
} satisfies PluginModule
