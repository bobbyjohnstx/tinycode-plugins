import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import mammoth from "mammoth"
import JSZip from "jszip"
import Papa from "papaparse"

export async function convertDocument(
  inputPath: string,
  outputPath: string,
  format: "json" | "markdown",
): Promise<string> {
  const ext = path.extname(inputPath).toLowerCase()
  const inputName = path.basename(inputPath)
  const outputName = path.basename(outputPath)

  try {
    switch (ext) {
      case ".xlsx":
        return await convertExcel(inputPath, outputPath, format, inputName, outputName)
      case ".csv":
        return await convertCsv(inputPath, outputPath, format, inputName, outputName)
      case ".docx":
        return await convertDocx(inputPath, outputPath, format, inputName, outputName)
      case ".pdf":
        return await convertPdf(inputPath, outputPath, format, inputName, outputName)
      default:
        return `Unsupported input format: ${ext}. Supported: .xlsx, .csv, .docx, .pdf`
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error reading ${inputName}: ${message}`
  }
}

async function convertExcel(
  inputPath: string,
  outputPath: string,
  format: "json" | "markdown",
  inputName: string,
  outputName: string,
): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(inputPath)

  let totalRows = 0

  if (format === "json") {
    const sheets: Record<string, Record<string, unknown>[]> = {}

    for (const worksheet of workbook.worksheets) {
      const rows: Record<string, unknown>[] = []
      const headers: string[] = []

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          for (let col = 1; col <= (worksheet.columnCount || 0); col++) {
            headers.push(formatValue(row.getCell(col).value))
          }
        } else {
          const record: Record<string, unknown> = {}
          for (let col = 1; col <= headers.length; col++) {
            const header = headers[col - 1]!
            record[header] = formatValue(row.getCell(col).value)
          }
          rows.push(record)
          totalRows++
        }
      })

      sheets[worksheet.name] = rows
    }

    const output = JSON.stringify({ sheets }, null, 2)
    await writeFile(outputPath, output, "utf-8")
    return `Converted ${inputName} (${workbook.worksheets.length} sheets, ${totalRows} rows) to JSON -> ${outputName}`
  }

  // Markdown
  const sections: string[] = []

  for (const worksheet of workbook.worksheets) {
    const tableRows: string[][] = []

    worksheet.eachRow((row) => {
      const values: string[] = []
      for (let col = 1; col <= (worksheet.columnCount || 0); col++) {
        values.push(formatValue(row.getCell(col).value))
      }
      tableRows.push(values)
      totalRows++
    })

    if (tableRows.length > 0) {
      sections.push(`## ${worksheet.name}\n\n${renderMarkdownTable(tableRows)}`)
    }
  }

  const output = sections.join("\n\n")
  await writeFile(outputPath, output, "utf-8")
  return `Converted ${inputName} (${workbook.worksheets.length} sheets, ${totalRows} rows) to Markdown -> ${outputName}`
}

async function convertCsv(
  inputPath: string,
  outputPath: string,
  format: "json" | "markdown",
  inputName: string,
  outputName: string,
): Promise<string> {
  const content = await readFile(inputPath, "utf-8")

  if (format === "json") {
    const result = Papa.parse<Record<string, string>>(content, { header: true })
    const output = JSON.stringify(result.data, null, 2)
    await writeFile(outputPath, output, "utf-8")
    return `Converted ${inputName} (${result.data.length} rows) to JSON -> ${outputName}`
  }

  // Markdown
  const result = Papa.parse<string[]>(content, { header: false })
  const output = renderMarkdownTable(result.data)
  await writeFile(outputPath, output, "utf-8")
  return `Converted ${inputName} (${result.data.length} rows) to Markdown -> ${outputName}`
}

async function convertDocx(
  inputPath: string,
  outputPath: string,
  format: "json" | "markdown",
  inputName: string,
  outputName: string,
): Promise<string> {
  const buffer = await readFile(inputPath)
  const { value: rawText } = await mammoth.extractRawText({ buffer })

  // Extract tables from XML
  const zip = await JSZip.loadAsync(buffer)
  const docXml = await zip.file("word/document.xml")?.async("string")

  const paragraphs = rawText
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p !== "")

  const tables = extractDocxTables(docXml ?? "")

  if (format === "json") {
    const data = { paragraphs, tables }
    const output = JSON.stringify(data, null, 2)
    await writeFile(outputPath, output, "utf-8")
    return `Converted ${inputName} (${paragraphs.length} paragraphs, ${tables.length} tables) to JSON -> ${outputName}`
  }

  // Markdown
  const parts: string[] = []
  for (const para of paragraphs) {
    parts.push(para)
  }
  for (const table of tables) {
    if (table.length > 0) {
      parts.push(renderMarkdownTable(table))
    }
  }

  const output = parts.join("\n\n")
  await writeFile(outputPath, output, "utf-8")
  return `Converted ${inputName} (${paragraphs.length} paragraphs, ${tables.length} tables) to Markdown -> ${outputName}`
}

function extractDocxTables(xml: string): string[][][] {
  const tables: string[][][] = []
  const tableRegex = /<w:tbl>[\s\S]*?<\/w:tbl>/g
  let tableMatch: RegExpExecArray | null

  while ((tableMatch = tableRegex.exec(xml)) !== null) {
    const rows: string[][] = []
    const rowRegex = /<w:tr[\s>][\s\S]*?<\/w:tr>/g
    let rowMatch: RegExpExecArray | null

    while ((rowMatch = rowRegex.exec(tableMatch[0])) !== null) {
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
        cells.push(textParts.join(""))
      }

      rows.push(cells)
    }

    tables.push(rows)
  }

  return tables
}

async function convertPdf(
  inputPath: string,
  outputPath: string,
  format: "json" | "markdown",
  inputName: string,
  outputName: string,
): Promise<string> {
  const { extractText } = await import("unpdf")
  const buffer = await readFile(inputPath)
  const result = await extractText(new Uint8Array(buffer), { mergePages: false })

  if (format === "json") {
    const data = {
      pages: result.text.map((text, i) => ({
        pageNumber: i + 1,
        text,
      })),
      metadata: {
        pageCount: result.totalPages,
      },
    }
    const output = JSON.stringify(data, null, 2)
    await writeFile(outputPath, output, "utf-8")
    return `Converted ${inputName} (${result.totalPages} pages) to JSON -> ${outputName}`
  }

  // Markdown
  const pages = result.text.map(
    (text, i) => `## Page ${i + 1}\n\n${text}\n\n---`,
  )
  const output = pages.join("\n\n")
  await writeFile(outputPath, output, "utf-8")
  return `Converted ${inputName} (${result.totalPages} pages) to Markdown -> ${outputName}`
}

function renderMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return ""

  const header = rows[0]!
  const headerLine = `| ${header.join(" | ")} |`
  const separatorLine = `| ${header.map(() => "---").join(" | ")} |`

  const dataLines = rows
    .slice(1)
    .map((row) => `| ${row.join(" | ")} |`)

  return [headerLine, separatorLine, ...dataLines].join("\n")
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object" && value !== null) {
    if ("result" in value) return String((value as { result: unknown }).result ?? "")
    if ("text" in value) return String((value as { text: unknown }).text ?? "")
    if ("richText" in value) {
      const rt = value as { richText: Array<{ text: string }> }
      return rt.richText.map((r) => r.text).join("")
    }
  }
  return String(value)
}
