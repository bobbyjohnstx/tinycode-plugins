# tinycode-plugin-gen-documents

Read, write, and convert office documents (Word, Excel, PowerPoint, PDF, CSV, text) from your tinycode session.

All libraries are pure JavaScript — no native dependencies.

## Install

```bash
tinycode plugin add tinycode-plugin-gen-documents
```

## Tools

### `read_document`

Read and extract text content from a document file.

```
path: "report.xlsx"
```

No permission prompt — read-only operation.

**Output format by type:**

- **Excel** — `=== Sheet: Name ===` header, then `Row N: val | val | val` per row
- **Word** — Paragraphs and tables in document order
- **PowerPoint** — `=== Slide N ===` header with extracted text per slide
- **PDF** — `--- Page N ---` header with extracted text per page
- **CSV** — `Row N: val | val | val` per row
- **Text/other** — Raw file content

### `write_document`

Create or modify a document using structured JSON operations. Permission-gated.

```
path: "data.xlsx"
operations: '[{"type": "set_cell", "sheet": "Sheet1", "row": 1, "col": "A", "value": "Name"}]'
```

The `operations` parameter is a JSON string containing a single operation object or an array of operations. Each operation has a `type` field plus format-specific parameters.

#### Word (.docx) operations

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `append_paragraph` | `text` | Append a paragraph at the end |
| `replace_text` | `find`, `replace` | Replace all occurrences of text |
| `insert_after` | `search`, `text` | Append paragraph (search text noted in message) |

#### Excel (.xlsx) operations

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `set_cell` | `sheet?`, `row`, `col`, `value` | Set a cell value. `col` accepts letters ("A") or numbers (1). |
| `append_row` | `sheet?`, `values` | Append a row of values |
| `set_column` | `sheet?`, `col`, `startRow`, `values` | Set a column of values starting at a row |

Sheet defaults to the first worksheet. If a named sheet doesn't exist, it's created.

#### PowerPoint (.pptx) operations

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `add_slide` | `title?`, `content?` | Add a slide with optional title and body text |

#### PDF operations

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `add_page` | `title?`, `content?` | Add a new page with optional title and content |
| `add_paragraph` | `text`, `fontSize?` | Add a text paragraph (default 12pt) |
| `add_text` | `text`, `fontSize?` | Add text content (default 12pt) |

#### CSV operations

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `append_row` | `values` | Append a row of values |
| `set_cell` | `row`, `col`, `value` | Set a cell (1-indexed) |

#### Text operations

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `replace_content` | `text` | Replace entire file content |
| `append_text` | `text` | Append to end of file |
| `replace_text` | `find`, `replace` | Replace all occurrences |

### `convert_document`

Convert a document to JSON or Markdown format. Permission-gated.

```
input: "data.xlsx"
output: "data.json"
format: "json"
```

**Supported conversions:**

| Input | JSON output | Markdown output |
|-------|-------------|-----------------|
| Excel (.xlsx) | `{ sheets: { Name: [{header: value}] } }` | Pipe-delimited tables per sheet |
| CSV | `[{header: value}]` records array | Pipe-delimited table |
| Word (.docx) | `{ paragraphs: [], tables: [[[]]] }` | Paragraphs and tables |
| PDF | `{ pages: [{pageNumber, text}], metadata: {pageCount} }` | `## Page N` sections |

## Examples

**Read a spreadsheet:**
```
> Read the quarterly revenue data from report.xlsx
```

**Update specific cells:**
```
> Set cell B5 in the Revenue sheet of report.xlsx to 150000
```

**Create a new document:**
```
> Create a Word document called summary.docx with a project status update
```

**Convert Excel to Markdown for review:**
```
> Convert data.xlsx to Markdown so I can review the tables
```

## Development

```bash
cd general/productivity/documents

# Run tests (49 tests across 4 files)
bun test

# Type check
tsc --noEmit
```

## Libraries

| Package | Purpose |
|---------|---------|
| mammoth | Word (.docx) reading |
| docx | Word (.docx) writing |
| exceljs | Excel (.xlsx) read/write |
| jszip | PowerPoint (.pptx) reading (ZIP + XML) |
| pptxgenjs | PowerPoint (.pptx) writing |
| unpdf | PDF reading |
| pdf-lib | PDF writing |
| papaparse | CSV read/write |
