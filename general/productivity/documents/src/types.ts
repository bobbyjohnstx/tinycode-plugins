export type WordOperation =
  | { type: "append_paragraph"; text: string }
  | { type: "replace_text"; find: string; replace: string }
  | { type: "insert_after"; search: string; text: string }

export type ExcelOperation =
  | { type: "set_cell"; sheet?: string; row: number; col: number | string; value: unknown }
  | { type: "append_row"; sheet?: string; values: unknown[] }
  | { type: "set_column"; sheet?: string; col: number | string; startRow: number; values: unknown[] }

export type PowerPointOperation = { type: "add_slide"; title?: string; content?: string }

export type PdfOperation =
  | { type: "add_page"; title?: string; content?: string }
  | { type: "add_paragraph"; text: string; fontSize?: number }
  | { type: "add_text"; text: string; fontSize?: number }

export type CsvOperation =
  | { type: "append_row"; values: unknown[] }
  | { type: "set_cell"; row: number; col: number; value: string }

export type TextOperation =
  | { type: "replace_content"; text: string }
  | { type: "append_text"; text: string }
  | { type: "replace_text"; find: string; replace: string }

export type DocumentOperation =
  | WordOperation
  | ExcelOperation
  | PowerPointOperation
  | PdfOperation
  | CsvOperation
  | TextOperation

export type WriteResult = {
  success: boolean
  message: string
  operationsApplied: number
}

/**
 * Convert an Excel column letter (e.g. "A", "M", "AA") to a 1-based column number.
 * If `col` is already a number, returns it directly.
 */
export function columnLetterToNumber(col: string | number): number {
  if (typeof col === "number") return col
  let result = 0
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 64)
  }
  return result
}

export const SUPPORTED_EXTENSIONS: Record<string, string> = {
  ".pdf": "pdf",
  ".docx": "word",
  ".xlsx": "excel",
  ".xls": "excel-legacy",
  ".pptx": "powerpoint",
  ".csv": "csv",
  ".txt": "text",
  ".md": "text",
  ".json": "text",
  ".xml": "text",
  ".yaml": "text",
  ".yml": "text",
}
