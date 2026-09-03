import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { writeDocument } from "../src/writer"
import { readDocument } from "../src/reader"

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "doc-writer-"))
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("writeDocument", () => {
  describe("Word (.docx)", () => {
    it("creates new file with append_paragraph", async () => {
      const filePath = join(tempDir, "new-word.docx")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "append_paragraph", text: "Hello Word" }]),
      )
      expect(result.success).toBe(true)
      expect(result.operationsApplied).toBe(1)

      const content = await readDocument(filePath)
      expect(content).toContain("Hello Word")
    })

    it("replaces text in existing file", async () => {
      const filePath = join(tempDir, "replace-word.docx")
      await writeDocument(
        filePath,
        JSON.stringify([{ type: "append_paragraph", text: "Hello World" }]),
      )
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "replace_text", find: "World", replace: "Document" }]),
      )
      expect(result.success).toBe(true)
      expect(result.message).toContain("Replaced")

      const content = await readDocument(filePath)
      expect(content).toContain("Hello Document")
    })

    it("insert_after appends at end with warning when search not found", async () => {
      const filePath = join(tempDir, "insert-word.docx")
      await writeDocument(
        filePath,
        JSON.stringify([{ type: "append_paragraph", text: "First paragraph" }]),
      )
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "insert_after", search: "NONEXISTENT", text: "New text" }]),
      )
      expect(result.message).toContain("Warning")
      expect(result.message).toContain("Could not find")
    })

    it("insert_after appends when search text found", async () => {
      const filePath = join(tempDir, "insert-found-word.docx")
      await writeDocument(
        filePath,
        JSON.stringify([{ type: "append_paragraph", text: "Target paragraph" }]),
      )
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "insert_after", search: "Target", text: "After text" }]),
      )
      expect(result.success).toBe(true)
      expect(result.operationsApplied).toBe(1)
    })
  })

  describe("Excel (.xlsx)", () => {
    it("creates new file with set_cell using letter column", async () => {
      const filePath = join(tempDir, "new-excel.xlsx")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "set_cell", row: 1, col: "B", value: "Test Value" }]),
      )
      expect(result.success).toBe(true)
      expect(result.operationsApplied).toBe(1)

      const content = await readDocument(filePath)
      expect(content).toContain("Test Value")
    })

    it("set_cell with number column", async () => {
      const filePath = join(tempDir, "num-col-excel.xlsx")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "set_cell", row: 1, col: 2, value: "Num Col" }]),
      )
      expect(result.success).toBe(true)

      const content = await readDocument(filePath)
      expect(content).toContain("Num Col")
    })

    it("append_row adds data", async () => {
      const filePath = join(tempDir, "append-excel.xlsx")
      const result = await writeDocument(
        filePath,
        JSON.stringify([
          { type: "append_row", values: ["Name", "Age"] },
          { type: "append_row", values: ["Alice", 30] },
        ]),
      )
      expect(result.success).toBe(true)
      expect(result.operationsApplied).toBe(2)

      const content = await readDocument(filePath)
      expect(content).toContain("Name | Age")
      expect(content).toContain("Alice | 30")
    })

    it("set_column fills values vertically", async () => {
      const filePath = join(tempDir, "setcol-excel.xlsx")
      const result = await writeDocument(
        filePath,
        JSON.stringify([
          { type: "set_column", col: "A", startRow: 1, values: ["X", "Y", "Z"] },
        ]),
      )
      expect(result.success).toBe(true)

      const content = await readDocument(filePath)
      expect(content).toContain("X")
      expect(content).toContain("Y")
      expect(content).toContain("Z")
    })

    it("auto-creates named sheet", async () => {
      const filePath = join(tempDir, "sheet-excel.xlsx")
      const result = await writeDocument(
        filePath,
        JSON.stringify([
          { type: "set_cell", sheet: "Custom", row: 1, col: 1, value: "In Custom Sheet" },
        ]),
      )
      expect(result.success).toBe(true)

      const content = await readDocument(filePath)
      expect(content).toContain("=== Sheet: Custom ===")
      expect(content).toContain("In Custom Sheet")
    })
  })

  describe("PowerPoint (.pptx)", () => {
    it("creates new file with add_slide", async () => {
      const filePath = join(tempDir, "new-pptx.pptx")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "add_slide", title: "My Title", content: "My Content" }]),
      )
      expect(result.success).toBe(true)
      expect(result.operationsApplied).toBe(1)

      const content = await readDocument(filePath)
      expect(content).toContain("My Title")
      expect(content).toContain("My Content")
    })

    it("creates slide with title only", async () => {
      const filePath = join(tempDir, "title-pptx.pptx")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "add_slide", title: "Title Only" }]),
      )
      expect(result.success).toBe(true)

      const content = await readDocument(filePath)
      expect(content).toContain("Title Only")
    })
  })

  describe("PDF", () => {
    it("creates new file with add_page", async () => {
      const filePath = join(tempDir, "new-pdf.pdf")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "add_page", title: "Page Title", content: "Page body text" }]),
      )
      expect(result.success).toBe(true)
      expect(result.operationsApplied).toBe(1)

      const content = await readDocument(filePath)
      expect(content).toContain("Page Title")
      expect(content).toContain("Page body text")
    })

    it("add_paragraph appends text", async () => {
      const filePath = join(tempDir, "para-pdf.pdf")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "add_paragraph", text: "A paragraph of text" }]),
      )
      expect(result.success).toBe(true)

      const content = await readDocument(filePath)
      expect(content).toContain("A paragraph of text")
    })

    it("add_text appends text", async () => {
      const filePath = join(tempDir, "text-pdf.pdf")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "add_text", text: "Some text content" }]),
      )
      expect(result.success).toBe(true)

      const content = await readDocument(filePath)
      expect(content).toContain("Some text content")
    })
  })

  describe("CSV", () => {
    it("creates new file with append_row", async () => {
      const filePath = join(tempDir, "new-csv.csv")
      const result = await writeDocument(
        filePath,
        JSON.stringify([
          { type: "append_row", values: ["Name", "Age"] },
          { type: "append_row", values: ["Alice", "30"] },
        ]),
      )
      expect(result.success).toBe(true)
      expect(result.operationsApplied).toBe(2)

      const content = await readFile(filePath, "utf-8")
      expect(content).toContain("Name")
      expect(content).toContain("Alice")
    })

    it("set_cell uses 1-indexed coordinates", async () => {
      const filePath = join(tempDir, "setcell-csv.csv")
      await writeDocument(
        filePath,
        JSON.stringify([
          { type: "append_row", values: ["A", "B"] },
          { type: "append_row", values: ["C", "D"] },
        ]),
      )
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "set_cell", row: 2, col: 1, value: "Updated" }]),
      )
      expect(result.success).toBe(true)

      const content = await readFile(filePath, "utf-8")
      expect(content).toContain("Updated")
      // Row 2 col 1 should be "Updated", not "C"
      expect(content).not.toContain("C,D")
    })

    it("auto-extends rows and columns", async () => {
      const filePath = join(tempDir, "extend-csv.csv")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "set_cell", row: 3, col: 5, value: "Far" }]),
      )
      expect(result.success).toBe(true)

      const content = await readFile(filePath, "utf-8")
      expect(content).toContain("Far")
    })
  })

  describe("Text files", () => {
    it("replace_content creates new file", async () => {
      const filePath = join(tempDir, "new-text.txt")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "replace_content", text: "Brand new content" }]),
      )
      expect(result.success).toBe(true)

      const content = await readFile(filePath, "utf-8")
      expect(content).toBe("Brand new content")
    })

    it("append_text adds to existing", async () => {
      const filePath = join(tempDir, "append-text.txt")
      await writeFile(filePath, "Hello")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "append_text", text: " World" }]),
      )
      expect(result.success).toBe(true)

      const content = await readFile(filePath, "utf-8")
      expect(content).toBe("Hello World")
    })

    it("replace_text reports occurrence count", async () => {
      const filePath = join(tempDir, "replacetext.txt")
      await writeFile(filePath, "foo bar foo baz foo")
      const result = await writeDocument(
        filePath,
        JSON.stringify([{ type: "replace_text", find: "foo", replace: "qux" }]),
      )
      expect(result.success).toBe(true)
      expect(result.message).toContain("3 occurrences")

      const content = await readFile(filePath, "utf-8")
      expect(content).toBe("qux bar qux baz qux")
    })
  })

  describe("Error handling", () => {
    it("returns error for invalid JSON", async () => {
      const result = await writeDocument(
        join(tempDir, "test.txt"),
        "not valid json",
      )
      expect(result.success).toBe(false)
      expect(result.message).toContain("Invalid JSON")
      expect(result.operationsApplied).toBe(0)
    })

    it("warns on unknown operation type without failing", async () => {
      const filePath = join(tempDir, "unknown-op.txt")
      const result = await writeDocument(
        filePath,
        JSON.stringify([
          { type: "replace_content", text: "content" },
          { type: "nonexistent_op" },
        ]),
      )
      expect(result.success).toBe(true)
      expect(result.operationsApplied).toBe(1)
      expect(result.message).toContain("unknown operation type")
    })
  })
})
