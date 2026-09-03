import { readFile } from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import mammoth from "mammoth"
import JSZip from "jszip"
import Papa from "papaparse"

export async function readDocument(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  const filename = path.basename(filePath)

  try {
    switch (ext) {
      case ".pdf":
        return await readPdf(filePath)
      case ".docx":
        return await readDocx(filePath)
      case ".xlsx":
        return await readXlsx(filePath)
      case ".xls":
        return `Unsupported format: .xls files are not supported. Please convert to .xlsx`
      case ".pptx":
        return await readPptx(filePath)
      case ".csv":
        return await readCsv(filePath)
      default:
        return await readText(filePath)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error reading ${filename}: ${message}`
  }
}

async function readPdf(filePath: string): Promise<string> {
  const { extractText } = await import("unpdf")
  const buffer = await readFile(filePath)
  const result = await extractText(new Uint8Array(buffer), { mergePages: false })

  const pages: string[] = []
  for (let i = 0; i < result.text.length; i++) {
    const text = result.text[i]
    if (text && text.trim()) {
      pages.push(`--- Page ${i + 1} ---\n${text}`)
    }
  }

  if (pages.length === 0) {
    return "(No text content could be extracted from this PDF)"
  }
  return pages.join("\n\n")
}

async function readDocx(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)

  // Use mammoth for paragraph text extraction
  const { value: rawText } = await mammoth.extractRawText({ buffer })

  // Also try to extract tables via JSZip XML parsing
  const zip = await JSZip.loadAsync(buffer)
  const docXml = await zip.file("word/document.xml")?.async("string")

  const content: string[] = []

  if (docXml) {
    // Parse document XML to get paragraphs and tables in order
    const parts = extractDocxParts(docXml)
    if (parts.length > 0) {
      content.push(...parts)
    }
  }

  // Fall back to mammoth raw text if XML parsing yielded nothing
  if (content.length === 0) {
    const text = rawText.trim()
    if (text) {
      content.push(text)
    }
  }

  if (content.length === 0) {
    return "(No text content could be extracted from this Word document)"
  }
  return content.join("\n\n")
}

function extractDocxParts(xml: string): string[] {
  const parts: string[] = []

  // Match body content — paragraphs and tables
  // We need to track position through the XML to maintain order
  const bodyMatch = xml.match(/<w:body>([\s\S]*?)<\/w:body>/)
  if (!bodyMatch) return parts

  const body = bodyMatch[1]!

  // Split into top-level elements (paragraphs and tables)
  const elementRegex = /<w:p[\s>][\s\S]*?<\/w:p>|<w:tbl>[\s\S]*?<\/w:tbl>/g
  let match: RegExpExecArray | null

  while ((match = elementRegex.exec(body)) !== null) {
    const element = match[0]

    if (element.startsWith("<w:tbl>")) {
      const tableText = extractDocxTable(element)
      if (tableText) {
        parts.push(tableText)
      }
    } else {
      // Paragraph — extract text from <w:t> elements
      const textParts: string[] = []
      const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g
      let textMatch: RegExpExecArray | null
      while ((textMatch = textRegex.exec(element)) !== null) {
        textParts.push(textMatch[1]!)
      }
      const text = textParts.join("").trim()
      if (text) {
        parts.push(text)
      }
    }
  }

  return parts
}

function extractDocxTable(tableXml: string): string {
  const rows: string[] = ["--- Table ---"]
  const rowRegex = /<w:tr[\s>][\s\S]*?<\/w:tr>/g
  let rowMatch: RegExpExecArray | null
  let rowNum = 0

  while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
    rowNum++
    const cells: string[] = []
    const cellRegex = /<w:tc[\s>][\s\S]*?<\/w:tc>/g
    let cellMatch: RegExpExecArray | null

    while ((cellMatch = cellRegex.exec(rowMatch[0])) !== null) {
      const textParts: string[] = []
      const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g
      let textMatch: RegExpExecArray | null
      while ((textMatch = textRegex.exec(cellMatch[0])) !== null) {
        textParts.push(textMatch[1]!)
      }
      cells.push(textParts.join("").trim())
    }

    if (cells.some((c) => c !== "")) {
      rows.push(`Row ${rowNum}: ${cells.join(" | ")}`)
    }
  }

  return rows.length > 1 ? rows.join("\n") : ""
}

async function readXlsx(filePath: string): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const sheets: string[] = []

  for (const worksheet of workbook.worksheets) {
    const sheetLines: string[] = [`=== Sheet: ${worksheet.name} ===\n`]

    worksheet.eachRow((row, rowNumber) => {
      const values: string[] = []
      for (let col = 1; col <= (worksheet.columnCount || 0); col++) {
        const cell = row.getCell(col)
        values.push(formatCellValue(cell.value))
      }
      if (values.some((v) => v.trim() !== "")) {
        sheetLines.push(`Row ${rowNumber}: ${values.join(" | ")}`)
      }
    })

    if (sheetLines.length > 1) {
      sheets.push(sheetLines.join("\n"))
    }
  }

  if (sheets.length === 0) {
    return "(No data could be extracted from this Excel file)"
  }
  return sheets.join("\n\n")
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object" && value !== null) {
    // Formula cell
    if ("result" in value) return String((value as { result: unknown }).result ?? "")
    // Rich text
    if ("text" in value) return String((value as { text: unknown }).text ?? "")
    // Hyperlink or other complex types
    if ("richText" in value) {
      const rt = value as { richText: Array<{ text: string }> }
      return rt.richText.map((r) => r.text).join("")
    }
  }
  return String(value)
}

async function readPptx(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)

  // Find slide files
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)![1]!, 10)
      const numB = parseInt(b.match(/slide(\d+)/)![1]!, 10)
      return numA - numB
    })

  const slides: string[] = []

  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.file(slideFiles[i]!)!.async("string")
    // Extract text from <a:t> elements
    const textParts: string[] = []
    const textRegex = /<a:t>([^<]*)<\/a:t>/g
    let match: RegExpExecArray | null
    while ((match = textRegex.exec(xml)) !== null) {
      if (match[1]!.trim()) {
        textParts.push(match[1]!)
      }
    }

    if (textParts.length > 0) {
      slides.push(`=== Slide ${i + 1} ===\n${textParts.join("\n")}`)
    }
  }

  if (slides.length === 0) {
    return "(No text content could be extracted from this presentation)"
  }
  return slides.join("\n\n")
}

async function readCsv(filePath: string): Promise<string> {
  let content: string
  try {
    content = await readFile(filePath, "utf-8")
  } catch {
    // Try latin-1 fallback
    const buffer = await readFile(filePath)
    content = Buffer.from(buffer).toString("latin1")
  }

  const result = Papa.parse<string[]>(content, { header: false })
  const rows: string[] = []

  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i]!
    if (row.some((cell) => cell.trim() !== "")) {
      rows.push(`Row ${i + 1}: ${row.join(" | ")}`)
    }
  }

  if (rows.length === 0) {
    return "(No data could be extracted from this CSV file)"
  }
  return rows.join("\n")
}

async function readText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8")
  } catch {
    const buffer = await readFile(filePath)
    return Buffer.from(buffer).toString("latin1")
  }
}
