import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { pruneStaleToolOutputs } from "../src/index"

function mockToolPart(
  tool: string,
  input: Record<string, unknown>,
  output: string,
): any {
  return {
    id: crypto.randomUUID(),
    sessionID: "sess-1",
    messageID: "msg-1",
    type: "tool",
    callID: crypto.randomUUID(),
    tool,
    state: {
      status: "completed",
      input,
      output,
      title: `${tool} result`,
      metadata: {},
      time: { start: Date.now() - 1000, end: Date.now() },
    },
  }
}

function mockTextPart(content: string): any {
  return {
    id: crypto.randomUUID(),
    sessionID: "sess-1",
    messageID: "msg-1",
    type: "text",
    content,
  }
}

function mockMessage(role: "user" | "assistant", parts: any[]): any {
  return {
    info: {
      id: crypto.randomUUID(),
      sessionID: "sess-1",
      role,
      time: { created: Date.now() },
    },
    parts,
  }
}

describe("context-pruning", () => {
  describe("age-based pruning", () => {
    it("prunes tool output older than threshold", () => {
      const messages = [
        mockMessage("user", [mockToolPart("Read", { file: "a.ts" }, "contents a")]),
        mockMessage("assistant", [mockToolPart("Bash", { cmd: "ls" }, "dir listing")]),
        mockMessage("user", [mockToolPart("Edit", { file: "b.ts" }, "edit result")]),
        mockMessage("assistant", [mockToolPart("Grep", { pattern: "foo" }, "grep result")]),
        mockMessage("user", [mockToolPart("Write", { file: "c.ts" }, "write result")]),
      ]

      pruneStaleToolOutputs(messages, 3)

      // messages.length=5, threshold=3 → ageThresholdIdx=2 → indices 0,1 pruned
      expect(messages[0]!.parts[0].state.output).toContain("[pruned: Read output")
      expect(messages[0]!.parts[0].state.output).toContain("older than threshold")
      expect(messages[1]!.parts[0].state.output).toContain("[pruned: Bash output")
      expect(messages[1]!.parts[0].state.output).toContain("older than threshold")
      // indices 2,3,4 kept
      expect(messages[2]!.parts[0].state.output).toBe("edit result")
      expect(messages[3]!.parts[0].state.output).toBe("grep result")
      expect(messages[4]!.parts[0].state.output).toBe("write result")
    })

    it("keeps recent tool outputs within threshold", () => {
      const messages = [
        mockMessage("user", [mockToolPart("Read", { file: "a.ts" }, "contents")]),
        mockMessage("assistant", [mockToolPart("Bash", { cmd: "ls" }, "listing")]),
      ]

      pruneStaleToolOutputs(messages, 20)

      expect(messages[0]!.parts[0].state.output).toBe("contents")
      expect(messages[1]!.parts[0].state.output).toBe("listing")
    })
  })

  describe("superseded/duplicate pruning", () => {
    it("prunes earlier call when same tool called with same args", () => {
      const messages = [
        mockMessage("user", [mockToolPart("Read", { file: "a.ts" }, "old contents")]),
        mockMessage("assistant", [mockTextPart("I see the file")]),
        mockMessage("user", [mockToolPart("Read", { file: "a.ts" }, "new contents")]),
      ]

      pruneStaleToolOutputs(messages, 100)

      expect(messages[0]!.parts[0].state.output).toContain("[pruned: Read output")
      expect(messages[0]!.parts[0].state.output).toContain("superseded by more recent call")
      expect(messages[2]!.parts[0].state.output).toBe("new contents")
    })

    it("prunes all but the latest when same tool+args called multiple times", () => {
      const messages = [
        mockMessage("user", [mockToolPart("Bash", { cmd: "test" }, "run 1")]),
        mockMessage("assistant", [mockToolPart("Bash", { cmd: "test" }, "run 2")]),
        mockMessage("user", [mockToolPart("Bash", { cmd: "test" }, "run 3")]),
      ]

      pruneStaleToolOutputs(messages, 100)

      expect(messages[0]!.parts[0].state.output).toContain("superseded")
      expect(messages[1]!.parts[0].state.output).toContain("superseded")
      expect(messages[2]!.parts[0].state.output).toBe("run 3")
    })
  })

  describe("different args preservation", () => {
    it("keeps both when same tool called with different args", () => {
      const messages = [
        mockMessage("user", [mockToolPart("Read", { file: "a.ts" }, "contents a")]),
        mockMessage("user", [mockToolPart("Read", { file: "b.ts" }, "contents b")]),
      ]

      pruneStaleToolOutputs(messages, 100)

      expect(messages[0]!.parts[0].state.output).toBe("contents a")
      expect(messages[1]!.parts[0].state.output).toBe("contents b")
    })
  })

  describe("non-tool parts", () => {
    it("never modifies text parts", () => {
      const messages = [
        mockMessage("user", [mockTextPart("hello world")]),
        mockMessage("assistant", [mockTextPart("response text")]),
      ]

      pruneStaleToolOutputs(messages, 1)

      expect(messages[0]!.parts[0].content).toBe("hello world")
      expect(messages[1]!.parts[0].content).toBe("response text")
    })

    it("prunes tool parts but leaves text parts in the same message untouched", () => {
      const messages = [
        mockMessage("user", [
          mockTextPart("check this"),
          mockToolPart("Read", { file: "a.ts" }, "old contents"),
        ]),
        mockMessage("assistant", [mockTextPart("got it")]),
        mockMessage("user", [mockToolPart("Read", { file: "a.ts" }, "new contents")]),
      ]

      pruneStaleToolOutputs(messages, 100)

      expect(messages[0]!.parts[0].content).toBe("check this")
      expect(messages[0]!.parts[1].state.output).toContain("superseded")
      expect(messages[2]!.parts[0].state.output).toBe("new contents")
    })
  })

  describe("edge cases", () => {
    it("handles empty message array", () => {
      const messages: any[] = []
      pruneStaleToolOutputs(messages, 20)
      expect(messages).toHaveLength(0)
    })

    it("single message with one tool output below threshold is not pruned", () => {
      const messages = [
        mockMessage("user", [mockToolPart("Read", { file: "a.ts" }, "contents")]),
      ]

      pruneStaleToolOutputs(messages, 20)

      expect(messages[0]!.parts[0].state.output).toBe("contents")
    })

    it("skips tool parts that are not completed", () => {
      const pendingPart: any = {
        id: "p1",
        sessionID: "sess-1",
        messageID: "msg-1",
        type: "tool",
        callID: "c1",
        tool: "Read",
        state: { status: "pending" },
      }
      const messages = [
        mockMessage("user", [pendingPart]),
        mockMessage("user", [mockToolPart("Read", { file: "a.ts" }, "contents")]),
      ]

      pruneStaleToolOutputs(messages, 1)

      expect(messages[0]!.parts[0].state.status).toBe("pending")
      expect(messages[1]!.parts[0].state.output).toBe("contents")
    })

    it("handles input key order differences as equivalent", () => {
      const messages = [
        mockMessage("user", [
          mockToolPart("Read", { file: "a.ts", line: 1 }, "old output"),
        ]),
        mockMessage("user", [
          mockToolPart("Read", { line: 1, file: "a.ts" }, "new output"),
        ]),
      ]

      pruneStaleToolOutputs(messages, 100)

      expect(messages[0]!.parts[0].state.output).toContain("superseded")
      expect(messages[1]!.parts[0].state.output).toBe("new output")
    })
  })

  describe("configurable threshold via env var", () => {
    const originalEnv = process.env.CONTEXT_PRUNE_THRESHOLD

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CONTEXT_PRUNE_THRESHOLD
      } else {
        process.env.CONTEXT_PRUNE_THRESHOLD = originalEnv
      }
    })

    it("uses env var threshold when set", async () => {
      process.env.CONTEXT_PRUNE_THRESHOLD = "2"

      const plugin = (await import("../src/index")).default
      const hooks = await plugin.server({} as any, undefined)

      const messages = [
        mockMessage("user", [mockToolPart("Read", { file: "a.ts" }, "old")]),
        mockMessage("assistant", [mockToolPart("Bash", { cmd: "ls" }, "listing")]),
        mockMessage("user", [mockToolPart("Edit", { file: "b.ts" }, "edit")]),
      ]

      const output = { messages }
      await hooks["experimental.chat.messages.transform"]!({} as any, output)

      // threshold=2, length=3, ageThresholdIdx=1 → index 0 pruned
      expect(messages[0]!.parts[0].state.output).toContain("older than threshold")
      expect(messages[1]!.parts[0].state.output).toBe("listing")
      expect(messages[2]!.parts[0].state.output).toBe("edit")
    })

    it("defaults to threshold of 20 when env var is not set", async () => {
      delete process.env.CONTEXT_PRUNE_THRESHOLD

      const plugin = (await import("../src/index")).default
      const hooks = await plugin.server({} as any, undefined)

      // 5 messages, default threshold 20 → nothing aged out
      const messages = Array.from({ length: 5 }, (_, i) =>
        mockMessage("user", [mockToolPart("Tool" + i, { idx: i }, `output ${i}`)]),
      )

      const output = { messages }
      await hooks["experimental.chat.messages.transform"]!({} as any, output)

      for (const msg of messages) {
        expect(msg.parts[0].state.output).not.toContain("[pruned:")
      }
    })
  })
})
