import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { convertDocument } from "../src/converter"

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "doc-converter-"))
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function createExcelFixture(): Promise<string> {
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("People")
  ws.addRow(["Name", "Age", "City"])
  ws.addRow(["Alice", 30, "NYC"])
  ws.addRow(["Bob", 25, "LA"])
  const filePath = join(tempDir, "fixture.xlsx")
  await wb.xlsx.writeFile(filePath)
  return filePath
}

async function createCsvFixture(): Promise<string> {
  const filePath = join(tempDir, "fixture.csv")
  await writeFile(filePath, "Name,Age,City\nAlice,30,NYC\nBob,25,LA\n")
  return filePath
}

async function createDocxFixture(): Promise<string> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx")
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun("First paragraph")] }),
          new Paragraph({ children: [new TextRun("Second paragraph")] }),
        ],
      },
    ],
  })
  const buffer = await Packer.toBuffer(doc)
  const filePath = join(tempDir, "fixture.docx")
  await writeFile(filePath, buffer)
  return filePath
}

async function createPdfFixture(): Promise<string> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib")
  const doc = await PDFDocument.create()
  const page = doc.addPage()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText("PDF content here", { x: 50, y: 700, font, size: 12 })
  const bytes = await doc.save()
  const filePath = join(tempDir, "fixture.pdf")
  await writeFile(filePath, bytes)
  return filePath
}

describe("convertDocument", () => {
  describe("Excel -> JSON", () => {
    it("converts with header-keyed records", async () => {
      const inputPath = await createExcelFixture()
      const outputPath = join(tempDir, "excel-out.json")
      const result = await convertDocument(inputPath, outputPath, "json")

      expect(result).toContain("JSON")
      expect(result).toContain("fixture.xlsx")

      const content = await readFile(outputPath, "utf-8")
      const data = JSON.parse(content)
      expect(data.sheets).toBeDefined()
      expect(data.sheets.People).toBeArray()
      expect(data.sheets.People[0].Name).toBe("Alice")
      expect(data.sheets.People[0].Age).toBe("30")
    })
  })

  describe("Excel -> Markdown", () => {
    it("converts to pipe-delimited table", async () => {
      const inputPath = await createExcelFixture()
      const outputPath = join(tempDir, "excel-out.md")
      const result = await convertDocument(inputPath, outputPath, "markdown")

      expect(result).toContain("Markdown")

      const content = await readFile(outputPath, "utf-8")
      expect(content).toContain("| Name | Age | City |")
      expect(content).toContain("| --- | --- | --- |")
      expect(content).toContain("| Alice | 30 | NYC |")
    })
  })

  describe("CSV -> JSON", () => {
    it("converts to header-keyed records", async () => {
      const inputPath = await createCsvFixture()
      const outputPath = join(tempDir, "csv-out.json")
      const result = await convertDocument(inputPath, outputPath, "json")

      expect(result).toContain("JSON")

      const content = await readFile(outputPath, "utf-8")
      const data = JSON.parse(content)
      expect(data).toBeArray()
      expect(data[0].Name).toBe("Alice")
    })
  })

  describe("CSV -> Markdown", () => {
    it("converts to pipe-delimited table", async () => {
      const inputPath = await createCsvFixture()
      const outputPath = join(tempDir, "csv-out.md")
      const result = await convertDocument(inputPath, outputPath, "markdown")

      expect(result).toContain("Markdown")

      const content = await readFile(outputPath, "utf-8")
      expect(content).toContain("| Name | Age | City |")
      expect(content).toContain("| --- |")
    })
  })

  describe("Word -> JSON", () => {
    it("converts with paragraphs and tables arrays", async () => {
      const inputPath = await createDocxFixture()
      const outputPath = join(tempDir, "docx-out.json")
      const result = await convertDocument(inputPath, outputPath, "json")

      expect(result).toContain("JSON")

      const content = await readFile(outputPath, "utf-8")
      const data = JSON.parse(content)
      expect(data.paragraphs).toBeArray()
      expect(data.tables).toBeArray()
      expect(data.paragraphs.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("Word -> Markdown", () => {
    it("converts paragraphs to plain text", async () => {
      const inputPath = await createDocxFixture()
      const outputPath = join(tempDir, "docx-out.md")
      const result = await convertDocument(inputPath, outputPath, "markdown")

      expect(result).toContain("Markdown")

      const content = await readFile(outputPath, "utf-8")
      expect(content).toContain("First paragraph")
    })
  })

  describe("PDF -> JSON", () => {
    it("converts with pages and metadata", async () => {
      const inputPath = await createPdfFixture()
      const outputPath = join(tempDir, "pdf-out.json")
      const result = await convertDocument(inputPath, outputPath, "json")

      expect(result).toContain("JSON")

      const content = await readFile(outputPath, "utf-8")
      const data = JSON.parse(content)
      expect(data.pages).toBeArray()
      expect(data.pages[0].pageNumber).toBe(1)
      expect(data.pages[0].text).toContain("PDF content here")
      expect(data.metadata.pageCount).toBe(1)
    })
  })

  describe("PDF -> Markdown", () => {
    it("converts with page headings and separators", async () => {
      const inputPath = await createPdfFixture()
      const outputPath = join(tempDir, "pdf-out.md")
      const result = await convertDocument(inputPath, outputPath, "markdown")

      expect(result).toContain("Markdown")

      const content = await readFile(outputPath, "utf-8")
      expect(content).toContain("## Page 1")
      expect(content).toContain("---")
    })
  })

  describe("Error handling", () => {
    it("returns error for unsupported input format", async () => {
      const pptxPath = join(tempDir, "test.pptx")
      await writeFile(pptxPath, "fake")
      const result = await convertDocument(
        pptxPath,
        join(tempDir, "out.json"),
        "json",
      )
      expect(result).toContain("Unsupported input format")
      expect(result).toContain(".pptx")
    })

    it("returns error for missing input file", async () => {
      const result = await convertDocument(
        join(tempDir, "nonexistent.xlsx"),
        join(tempDir, "out.json"),
        "json",
      )
      expect(result).toContain("Error reading")
    })
  })
})
