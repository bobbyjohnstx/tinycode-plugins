import { readdir, readFile, stat } from "node:fs/promises"
import { join, resolve, relative, basename, extname } from "node:path"

export type LocalSearchConfig = {
  basePath: string
  extensions?: string[] // default: [".txt", ".md", ".json"]
  maxFiles?: number // safety cap, default: 50000
}

export type SearchResult = {
  filePath: string // relative to basePath
  title: string
  score: number
  snippet: string // first ~200 chars
}

export type LocalSearchIndex = {
  build(): Promise<void>
  search(query: string, limit?: number): Promise<SearchResult[]>
  getContent(filePath: string): Promise<string>
  count(): number
}

type IndexEntry = {
  relativePath: string
  title: string
  filenameLower: string
  titleLower: string
  snippet: string
}

function extractTitle(content: string, filename: string): string {
  const firstLine = content.split("\n", 1)[0]?.trim() ?? ""
  if (firstLine.length === 0) {
    return filename
  }
  // Strip markdown heading prefix
  const cleaned = firstLine.replace(/^#+\s*/, "")
  return cleaned || filename
}

async function collectFiles(
  dir: string,
  extensions: Set<string>,
  maxFiles: number,
  results: string[],
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (results.length >= maxFiles) return

    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      await collectFiles(fullPath, extensions, maxFiles, results)
    } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
      results.push(fullPath)
    }
  }
}

export function createLocalSearchIndex(config: LocalSearchConfig): LocalSearchIndex {
  const extensions = new Set(config.extensions ?? [".txt", ".md", ".json"])
  const maxFiles = config.maxFiles ?? 50000
  const resolvedBase = resolve(config.basePath)

  let entries: IndexEntry[] = []
  let built = false

  return {
    async build(): Promise<void> {
      const filePaths: string[] = []
      await collectFiles(resolvedBase, extensions, maxFiles, filePaths)

      const indexed: IndexEntry[] = []

      for (const fullPath of filePaths) {
        let content: string
        try {
          content = await readFile(fullPath, "utf-8")
        } catch {
          continue
        }

        const relativePath = relative(resolvedBase, fullPath)
        const filename = basename(fullPath)
        const title = extractTitle(content, filename)
        const snippet = content.slice(0, 200)

        indexed.push({
          relativePath,
          title,
          filenameLower: filename.toLowerCase(),
          titleLower: title.toLowerCase(),
          snippet,
        })
      }

      entries = indexed
      built = true
    },

    async search(query: string, limit = 20): Promise<SearchResult[]> {
      if (!built) {
        await this.build()
      }

      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((k) => k.length > 0)

      if (keywords.length === 0) {
        return []
      }

      const scored: SearchResult[] = []

      for (const entry of entries) {
        let score = 0
        for (const keyword of keywords) {
          if (entry.titleLower.includes(keyword)) score++
          if (entry.filenameLower.includes(keyword)) score++
        }

        if (score > 0) {
          scored.push({
            filePath: entry.relativePath,
            title: entry.title,
            score,
            snippet: entry.snippet,
          })
        }
      }

      scored.sort((a, b) => b.score - a.score)

      return scored.slice(0, limit)
    },

    async getContent(filePath: string): Promise<string> {
      const resolved = resolve(resolvedBase, filePath)

      if (!resolved.startsWith(resolvedBase + "/") && resolved !== resolvedBase) {
        throw new Error(`Path traversal detected: ${filePath}`)
      }

      return readFile(resolved, "utf-8")
    },

    count(): number {
      return entries.length
    },
  }
}
