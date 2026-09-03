import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readDocument } from "../src/reader"

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "doc-reader-"))
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("readDocument", () => {
  describe("PDF", () => {
    let pdfPath: string

    beforeAll(async () => {
      const { PDFDocument, StandardFonts } = await import("pdf-lib")
      const doc = await PDFDocument.create()
      const page = doc.addPage()
      const font = await doc.embedFont(StandardFonts.Helvetica)
      page.drawText("Hello PDF", { x: 50, y: 700, font, size: 12 })
      const bytes = await doc.save()
      pdfPath = join(tempDir, "test.pdf")
      await writeFile(pdfPath, bytes)
    })

    it("reads PDF with page markers", async () => {
      const result = await readDocument(pdfPath)
      expect(result).toContain("--- Page 1 ---")
      expect(result).toContain("Hello PDF")
    })
  })

  describe("Word (.docx)", () => {
    let docxPath: string

    beforeAll(async () => {
      const { Document, Packer, Paragraph, TextRun } = await import("docx")
      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({ children: [new TextRun("Test paragraph one")] }),
              new Paragraph({ children: [new TextRun("Test paragraph two")] }),
            ],
          },
        ],
      })
      const buffer = await Packer.toBuffer(doc)
      docxPath = join(tempDir, "test.docx")
      await writeFile(docxPath, buffer)
    })

    it("reads Word document paragraphs", async () => {
      const result = await readDocument(docxPath)
      expect(result).toContain("Test paragraph one")
      expect(result).toContain("Test paragraph two")
    })
  })

  describe("Excel (.xlsx)", () => {
    let xlsxPath: string

    beforeAll(async () => {
      const ExcelJS = (await import("exceljs")).default
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet("Data")
      ws.addRow(["Name", "Age", "City"])
      ws.addRow(["Alice", 30, "NYC"])
      ws.addRow(["Bob", 25, "LA"])
      xlsxPath = join(tempDir, "test.xlsx")
      await wb.xlsx.writeFile(xlsxPath)
    })

    it("reads Excel with sheet headers and row format", async () => {
      const result = await readDocument(xlsxPath)
      expect(result).toContain("=== Sheet: Data ===")
      expect(result).toContain("Row 1: Name | Age | City")
      expect(result).toContain("Row 2: Alice | 30 | NYC")
      expect(result).toContain("Row 3: Bob | 25 | LA")
    })
  })

  describe("PowerPoint (.pptx)", () => {
    let pptxPath: string

    beforeAll(async () => {
      const PptxGenJS = (await import("pptxgenjs")).default
      const pres = new PptxGenJS()
      const slide = pres.addSlide()
      slide.addText("Slide Title Text", { x: 1, y: 1, w: 5, h: 1 })
      pptxPath = join(tempDir, "test.pptx")
      await pres.writeFile({ fileName: pptxPath })
    })

    it("reads PowerPoint with slide markers", async () => {
      const result = await readDocument(pptxPath)
      expect(result).toContain("=== Slide 1 ===")
      expect(result).toContain("Slide Title Text")
    })
  })

  describe("CSV", () => {
    let csvPath: string

    beforeAll(async () => {
      csvPath = join(tempDir, "test.csv")
      await writeFile(csvPath, "Name,Age,City\nAlice,30,NYC\nBob,25,LA\n")
    })

    it("reads CSV with row format", async () => {
      const result = await readDocument(csvPath)
      expect(result).toContain("Row 1: Name | Age | City")
      expect(result).toContain("Row 2: Alice | 30 | NYC")
      expect(result).toContain("Row 3: Bob | 25 | LA")
    })
  })

  describe("Text files", () => {
    let textPath: string

    beforeAll(async () => {
      textPath = join(tempDir, "test.txt")
      await writeFile(textPath, "Hello, plain text world!")
    })

    it("reads text file content", async () => {
      const result = await readDocument(textPath)
      expect(result).toBe("Hello, plain text world!")
    })
  })

  describe("Error handling", () => {
    it("returns error for missing file", async () => {
      const result = await readDocument(join(tempDir, "nonexistent.pdf"))
      expect(result).toContain("Error reading")
    })

    it("returns unsupported format for .xls", async () => {
      const xlsPath = join(tempDir, "test.xls")
      await writeFile(xlsPath, "fake xls content")
      const result = await readDocument(xlsPath)
      expect(result).toContain("Unsupported format: .xls")
    })
  })
})
