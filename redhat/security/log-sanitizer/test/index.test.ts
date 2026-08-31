import { describe, it, expect } from "bun:test"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

async function getHook() {
  const input = createMockInput()
  const hooks = await plugin.server(input, undefined)
  return hooks["tool.execute.after"]!
}

function makeOutput(text: string) {
  return { title: "test", output: text, metadata: {} }
}

const mockInput = { tool: "bash", sessionID: "s1", callID: "c1", args: {} }

describe("tinycode-plugin-rh-log-sanitizer", () => {
  describe("plugin loading", () => {
    it("loads without error", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      expect(hooks).toBeDefined()
    })

    it("registers tool.execute.after hook", async () => {
      const hook = await getHook()
      expect(hook).toBeDefined()
      expect(typeof hook).toBe("function")
    })
  })

  describe("API key redaction", () => {
    it("redacts OpenAI sk-proj keys", async () => {
      const hook = await getHook()
      const output = makeOutput("key: sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234")
      await hook(mockInput, output)
      expect(output.output).toBe("key: [REDACTED:api-key]")
    })

    it("redacts OpenAI sk-live keys", async () => {
      const hook = await getHook()
      const output = makeOutput("token=sk-live-abcdefghijklmnopqrstuvwxyz123456")
      await hook(mockInput, output)
      expect(output.output).toBe("token=[REDACTED:api-key]")
    })

    it("redacts GitHub personal access tokens (ghp_)", async () => {
      const hook = await getHook()
      const output = makeOutput("GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh")
      await hook(mockInput, output)
      expect(output.output).toBe("GITHUB_TOKEN=[REDACTED:api-key]")
    })

    it("redacts GitHub server tokens (ghs_)", async () => {
      const hook = await getHook()
      const output = makeOutput("auth: ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh")
      await hook(mockInput, output)
      expect(output.output).toBe("auth: [REDACTED:api-key]")
    })

    it("redacts AWS access key IDs", async () => {
      const hook = await getHook()
      const output = makeOutput("aws_key=AKIAIOSFODNN7EXAMPLE")
      await hook(mockInput, output)
      expect(output.output).toBe("aws_key=[REDACTED:api-key]")
    })

    it("redacts Slack bot tokens (xoxb-)", async () => {
      const hook = await getHook()
      const output = makeOutput("SLACK_TOKEN=xoxb-FAKE-TEST-TOKEN-00000000000")
      await hook(mockInput, output)
      expect(output.output).toBe("SLACK_TOKEN=[REDACTED:api-key]")
    })

    it("redacts Slack user tokens (xoxp-)", async () => {
      const hook = await getHook()
      const output = makeOutput("xoxp-FAKE-TEST-TOKEN-00000000000")
      await hook(mockInput, output)
      expect(output.output).toBe("[REDACTED:api-key]")
    })
  })

  describe("bearer token redaction", () => {
    it("redacts Authorization: Bearer header", async () => {
      const hook = await getHook()
      const output = makeOutput("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")
      await hook(mockInput, output)
      expect(output.output).toBe("Authorization: Bearer [REDACTED:bearer-token]")
    })

    it("redacts standalone Bearer token", async () => {
      const hook = await getHook()
      const output = makeOutput("Bearer abcdefghijklmnopqrstuvwxyz1234567890ABCD")
      await hook(mockInput, output)
      expect(output.output).toBe("Bearer [REDACTED:bearer-token]")
    })

    it("does not redact short Bearer values", async () => {
      const hook = await getHook()
      const output = makeOutput("Bearer shorttoken")
      await hook(mockInput, output)
      expect(output.output).toBe("Bearer shorttoken")
    })
  })

  describe("private key redaction", () => {
    it("redacts RSA private key", async () => {
      const hook = await getHook()
      const keyContent = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"
      const output = makeOutput(`cert:\n${keyContent}`)
      await hook(mockInput, output)
      expect(output.output).toContain("[REDACTED:private-key]")
      expect(output.output).not.toContain("BEGIN RSA PRIVATE KEY")
    })

    it("redacts EC private key", async () => {
      const hook = await getHook()
      const keyContent = "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEE...\n-----END EC PRIVATE KEY-----"
      const output = makeOutput(keyContent)
      await hook(mockInput, output)
      expect(output.output).toBe("[REDACTED:private-key]")
    })

    it("redacts generic private key", async () => {
      const hook = await getHook()
      const keyContent = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----"
      const output = makeOutput(keyContent)
      await hook(mockInput, output)
      expect(output.output).toBe("[REDACTED:private-key]")
    })
  })

  describe("high-entropy string redaction", () => {
    it("redacts long base64-like token strings", async () => {
      const hook = await getHook()
      const output = makeOutput("secret=aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB3cD4eF5gH6i")
      await hook(mockInput, output)
      expect(output.output).toBe("secret=[REDACTED:high-entropy]")
    })
  })

  describe("no false positives", () => {
    it("passes normal text through unchanged", async () => {
      const hook = await getHook()
      const text = "This is a normal log message with no secrets."
      const output = makeOutput(text)
      await hook(mockInput, output)
      expect(output.output).toBe(text)
    })

    it("passes empty string through unchanged", async () => {
      const hook = await getHook()
      const output = makeOutput("")
      await hook(mockInput, output)
      expect(output.output).toBe("")
    })

    it("does not redact normal URLs", async () => {
      const hook = await getHook()
      const text = "Visit https://example.com/path/to/resource for details"
      const output = makeOutput(text)
      await hook(mockInput, output)
      expect(output.output).toBe(text)
    })

    it("does not redact normal file paths", async () => {
      const hook = await getHook()
      const text = "/usr/local/bin/node /home/user/project/src/index.ts"
      const output = makeOutput(text)
      await hook(mockInput, output)
      expect(output.output).toBe(text)
    })

    it("preserves output with no secrets exactly", async () => {
      const hook = await getHook()
      const text = "Build completed successfully in 12.5s\nAll 42 tests passed\nCoverage: 87.3%"
      const output = makeOutput(text)
      await hook(mockInput, output)
      expect(output.output).toBe(text)
    })
  })

  describe("secrets in JSON", () => {
    it("catches API key embedded in JSON string", async () => {
      const hook = await getHook()
      const json = JSON.stringify({ apiKey: "sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234" })
      const output = makeOutput(json)
      await hook(mockInput, output)
      expect(output.output).not.toContain("sk-proj-")
      expect(output.output).toContain("[REDACTED:api-key]")
    })

    it("catches bearer token in JSON", async () => {
      const hook = await getHook()
      const json = JSON.stringify({ auth: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N" })
      const output = makeOutput(json)
      await hook(mockInput, output)
      expect(output.output).not.toContain("eyJhbGci")
      expect(output.output).toContain("[REDACTED:bearer-token]")
    })
  })

  describe("multiple secrets in one output", () => {
    it("redacts all secrets in multi-line output", async () => {
      const hook = await getHook()
      const text = [
        "Connecting with token: sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234",
        "GitHub auth: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ",
        "Normal log line here",
      ].join("\n")
      const output = makeOutput(text)
      await hook(mockInput, output)
      expect(output.output).not.toContain("sk-proj-")
      expect(output.output).not.toContain("ghp_")
      expect(output.output).not.toContain("eyJhbGci")
      expect(output.output).toContain("[REDACTED:api-key]")
      expect(output.output).toContain("[REDACTED:bearer-token]")
      expect(output.output).toContain("Normal log line here")
    })
  })
})
