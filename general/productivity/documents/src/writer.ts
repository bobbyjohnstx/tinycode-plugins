import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import JSZip from "jszip"
import Papa from "papaparse"
import { columnLetterToNumber } from "./types.js"
import type { WriteResult, DocumentOperation } from "./types.js"

export async function writeDocument(
  filePath: string,
  operationsJson: string,
): Promise<WriteResult> {
  let operations: DocumentOperation[]
  try {
    const parsed: unknown = JSON.parse(operationsJson)
    operations = Array.isArray(parsed) ? parsed : [parsed]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, message: `Invalid JSON: ${message}`, operationsApplied: 0 }
  }

  const ext = path.extname(filePath).toLowerCase()
  const filename = path.basename(filePath)

  try {
    switch (ext) {
      case ".docx":
        return await writeDocx(filePath, operations)
      case ".xlsx":
        return await writeXlsx(filePath, operations)
      case ".pptx":
        return await writePptx(filePath, operations)
      case ".pdf":
        return await writePdf(filePath, operations)
      case ".csv":
        return await writeCsv(filePath, operations)
      default:
        return await writeText(filePath, operations)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, message: `Failed to write ${filename}: ${message}`, operationsApplied: 0 }
  }
}

async function writeDocx(
  filePath: string,
  operations: DocumentOperation[],
): Promise<WriteResult> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx")

  let existingText = ""
  let existingParagraphs: string[] = []
  let fileExists = false

  try {
    const buffer = await readFile(filePath)
    fileExists = true
    const mammoth = (await import("mammoth")).default
    const result = await mammoth.extractRawText({ buffer })
    existingText = result.value
    existingParagraphs = existingText
      .split("\n\n")
      .map((p) => p.trim())
      .filter((p) => p !== "")
  } catch {
    // File doesn't exist — start fresh
  }

  let operationsApplied = 0
  const messages: string[] = []
  const paragraphs = [...existingParagraphs]

  for (const op of operations) {
    switch (op.type) {
      case "append_paragraph": {
        const o = op as { type: "append_paragraph"; text: string }
        paragraphs.push(o.text)
        operationsApplied++
        messages.push(`Appended paragraph with ${o.text.length} characters`)
        break
      }
      case "replace_text": {
        if (!("find" in op)) break
        const o = op as { type: "replace_text"; find: string; replace: string }
        let count = 0
        for (let i = 0; i < paragraphs.length; i++) {
          if (paragraphs[i]!.includes(o.find)) {
            paragraphs[i] = paragraphs[i]!.replaceAll(o.find, o.replace)
            count++
          }
        }
        operationsApplied++
        messages.push(`Replaced '${o.find}' with '${o.replace}' in ${count} locations`)
        break
      }
      case "insert_after": {
        const o = op as { type: "insert_after"; search: string; text: string }
        const found = paragraphs.some((p) => p.includes(o.search))
        if (found) {
          paragraphs.push(o.text)
          operationsApplied++
          messages.push(
            `Inserted text after '${o.search}' (note: added at end due to library limitations)`,
          )
        } else {
          messages.push(`Warning: Could not find '${o.search}' to insert after`)
        }
        break
      }
      default: {
        const t = (op as { type: string }).type
        messages.push(`Warning: unknown operation type '${t}'`)
      }
    }
  }

  // Build new document from paragraphs
  const doc = new Document({
    sections: [
      {
        children: paragraphs.map(
          (text) => new Paragraph({ children: [new TextRun(text)] }),
        ),
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  await writeFile(filePath, buffer)

  return { success: true, message: messages.join("; "), operationsApplied }
}

async function writeXlsx(
  filePath: string,
  operations: DocumentOperation[],
): Promise<WriteResult> {
  const workbook = new ExcelJS.Workbook()

  try {
    await workbook.xlsx.readFile(filePath)
  } catch {
    // File doesn't exist — start with empty workbook
  }

  let operationsApplied = 0
  const messages: string[] = []

  for (const op of operations) {
    const sheetName =
      ("sheet" in op && typeof op.sheet === "string" ? op.sheet : undefined) ??
      (workbook.worksheets.length > 0 ? workbook.worksheets[0]!.name : "Sheet1")

    let worksheet = workbook.getWorksheet(sheetName)
    if (!worksheet) {
      worksheet = workbook.addWorksheet(sheetName)
    }

    switch (op.type) {
      case "set_cell": {
        const o = op as { type: "set_cell"; row: number; col: number | string; value: unknown }
        const colNum = columnLetterToNumber(o.col)
        worksheet.getCell(o.row, colNum).value = o.value as ExcelJS.CellValue
        operationsApplied++
        messages.push(`Set cell row ${o.row}, col ${o.col} = '${o.value}'`)
        break
      }
      case "append_row": {
        const o = op as { type: "append_row"; values: unknown[] }
        worksheet.addRow(o.values)
        operationsApplied++
        messages.push(`Appended row with ${o.values.length} values`)
        break
      }
      case "set_column": {
        const o = op as {
          type: "set_column"
          col: number | string
          startRow: number
          values: unknown[]
        }
        const colNum = columnLetterToNumber(o.col)
        for (let i = 0; i < o.values.length; i++) {
          worksheet.getCell(o.startRow + i, colNum).value = o.values[i] as ExcelJS.CellValue
        }
        operationsApplied++
        messages.push(`Set column ${o.col} starting at row ${o.startRow} with ${o.values.length} values`)
        break
      }
      default: {
        const t = (op as { type: string }).type
        messages.push(`Warning: unknown operation type '${t}'`)
      }
    }
  }

  await workbook.xlsx.writeFile(filePath)
  return { success: true, message: messages.join("; "), operationsApplied }
}

async function writePptx(
  filePath: string,
  operations: DocumentOperation[],
): Promise<WriteResult> {
  const PptxGenJS = (await import("pptxgenjs")).default
  const pres = new PptxGenJS()

  // If file exists, read existing slides and recreate them
  try {
    const buffer = await readFile(filePath)
    const zip = await JSZip.loadAsync(buffer)
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)/)![1]!, 10)
        const numB = parseInt(b.match(/slide(\d+)/)![1]!, 10)
        return numA - numB
      })

    for (const slideFile of slideFiles) {
      const xml = await zip.file(slideFile)!.async("string")
      const textParts: string[] = []
      const textRegex = /<a:t>([^<]*)<\/a:t>/g
      let match: RegExpExecArray | null
      while ((match = textRegex.exec(xml)) !== null) {
        if (match[1]!.trim()) textParts.push(match[1]!)
      }
      if (textParts.length > 0) {
        const slide = pres.addSlide()
        slide.addText(textParts.join("\n"), { x: 0.5, y: 0.5, w: 9, h: 5 })
      }
    }
  } catch {
    // File doesn't exist — start fresh
  }

  let operationsApplied = 0
  const messages: string[] = []

  for (const op of operations) {
    switch (op.type) {
      case "add_slide": {
        const o = op as { type: "add_slide"; title?: string; content?: string }
        const slide = pres.addSlide()
        if (o.title) {
          slide.addText(o.title, { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 24, bold: true })
        }
        if (o.content) {
          slide.addText(o.content, { x: 0.5, y: 1.75, w: 9, h: 4, fontSize: 14 })
        }
        operationsApplied++
        messages.push(`Added slide: '${o.title ?? "(untitled)"}'`)
        break
      }
      default: {
        const t = (op as { type: string }).type
        messages.push(`Warning: unknown operation type '${t}'`)
      }
    }
  }

  await pres.writeFile({ fileName: filePath })
  return { success: true, message: messages.join("; "), operationsApplied }
}

async function writePdf(
  filePath: string,
  operations: DocumentOperation[],
): Promise<WriteResult> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib")

  let pdfDoc: Awaited<ReturnType<typeof PDFDocument.create>>
  try {
    const existing = await readFile(filePath)
    pdfDoc = await PDFDocument.load(existing)
  } catch {
    pdfDoc = await PDFDocument.create()
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  let operationsApplied = 0
  const messages: string[] = []

  // Track current page and Y position
  let currentPage = pdfDoc.getPageCount() > 0 ? pdfDoc.getPage(pdfDoc.getPageCount() - 1) : null
  let currentY = currentPage ? 50 : 0 // Assume near bottom if existing pages

  function ensurePage(): { page: ReturnType<typeof pdfDoc.addPage>; width: number; height: number } {
    const page = pdfDoc.addPage()
    const { width, height } = page.getSize()
    currentPage = page
    currentY = height - 50
    return { page, width, height }
  }

  function drawTextBlock(
    text: string,
    fontSize: number,
    useFont: typeof font,
  ): void {
    if (!currentPage || currentY < 50) {
      ensurePage()
    }

    const lines = wrapText(text, 80)
    for (const line of lines) {
      if (currentY < 50) {
        ensurePage()
      }
      currentPage!.drawText(line, {
        x: 50,
        y: currentY,
        size: fontSize,
        font: useFont,
        color: rgb(0, 0, 0),
      })
      currentY -= fontSize * 1.5
    }
  }

  for (const op of operations) {
    switch (op.type) {
      case "add_page": {
        const o = op as { type: "add_page"; title?: string; content?: string }
        ensurePage()
        if (o.title) {
          drawTextBlock(o.title, 24, boldFont)
          currentY -= 12 // Extra spacing after title
        }
        if (o.content) {
          drawTextBlock(o.content, 12, font)
        }
        operationsApplied++
        messages.push(`Added page: '${o.title ?? "(untitled)"}'`)
        break
      }
      case "add_paragraph": {
        const o = op as { type: "add_paragraph"; text: string; fontSize?: number }
        drawTextBlock(o.text, o.fontSize ?? 12, font)
        operationsApplied++
        messages.push(`Added paragraph with ${o.text.length} characters`)
        break
      }
      case "add_text": {
        const o = op as { type: "add_text"; text: string; fontSize?: number }
        drawTextBlock(o.text, o.fontSize ?? 12, font)
        operationsApplied++
        messages.push(`Added text: '${o.text.length > 50 ? o.text.slice(0, 50) + "..." : o.text}'`)
        break
      }
      default: {
        const t = (op as { type: string }).type
        messages.push(`Warning: unknown operation type '${t}'`)
      }
    }
  }

  const pdfBytes = await pdfDoc.save()
  await writeFile(filePath, pdfBytes)
  return { success: true, message: messages.join("; "), operationsApplied }
}

function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = []
  for (const rawLine of text.split("\n")) {
    if (rawLine.length <= maxChars) {
      lines.push(rawLine)
      continue
    }
    const words = rawLine.split(" ")
    let current = ""
    for (const word of words) {
      if (current.length + word.length + 1 > maxChars && current.length > 0) {
        lines.push(current)
        current = word
      } else {
        current = current ? `${current} ${word}` : word
      }
    }
    if (current) lines.push(current)
  }
  return lines
}

async function writeCsv(
  filePath: string,
  operations: DocumentOperation[],
): Promise<WriteResult> {
  let rows: string[][] = []

  try {
    const content = await readFile(filePath, "utf-8")
    const result = Papa.parse<string[]>(content, { header: false })
    rows = result.data
  } catch {
    // File doesn't exist — start with empty
  }

  let operationsApplied = 0
  const messages: string[] = []

  for (const op of operations) {
    switch (op.type) {
      case "append_row": {
        const o = op as { type: "append_row"; values: unknown[] }
        rows.push(o.values.map(String))
        operationsApplied++
        messages.push(`Appended row with ${o.values.length} values`)
        break
      }
      case "set_cell": {
        const o = op as { type: "set_cell"; row: number; col: number; value: string }
        const rowIdx = o.row - 1 // Convert to 0-indexed
        const colIdx = o.col - 1

        // Auto-extend rows
        while (rows.length <= rowIdx) {
          rows.push([])
        }
        // Auto-extend columns
        while (rows[rowIdx]!.length <= colIdx) {
          rows[rowIdx]!.push("")
        }

        rows[rowIdx]![colIdx] = o.value
        operationsApplied++
        messages.push(`Set cell (row ${o.row}, col ${o.col}) = '${o.value}'`)
        break
      }
      default: {
        const t = (op as { type: string }).type
        messages.push(`Warning: unknown operation type '${t}'`)
      }
    }
  }

  const output = Papa.unparse(rows)
  await writeFile(filePath, output, "utf-8")
  return { success: true, message: messages.join("; "), operationsApplied }
}

async function writeText(
  filePath: string,
  operations: DocumentOperation[],
): Promise<WriteResult> {
  let content = ""

  try {
    content = await readFile(filePath, "utf-8")
  } catch {
    // File doesn't exist — start with empty string
  }

  let operationsApplied = 0
  const messages: string[] = []

  for (const op of operations) {
    switch (op.type) {
      case "replace_content": {
        const o = op as { type: "replace_content"; text: string }
        content = o.text
        operationsApplied++
        messages.push(`Replaced entire content with ${o.text.length} characters`)
        break
      }
      case "append_text": {
        const o = op as { type: "append_text"; text: string }
        content += o.text
        operationsApplied++
        messages.push(`Appended ${o.text.length} characters`)
        break
      }
      case "replace_text": {
        if (!("find" in op)) break
        const o = op as { type: "replace_text"; find: string; replace: string }
        const count = content.split(o.find).length - 1
        content = content.replaceAll(o.find, o.replace)
        operationsApplied++
        messages.push(`Replaced '${o.find}' with '${o.replace}' (${count} occurrences)`)
        break
      }
      default: {
        const t = (op as { type: string }).type
        messages.push(`Warning: unknown operation type '${t}'`)
      }
    }
  }

  await writeFile(filePath, content, "utf-8")
  return { success: true, message: messages.join("; "), operationsApplied }
}
