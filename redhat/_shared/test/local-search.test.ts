import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createLocalSearchIndex } from "../src/local-search"

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "local-search-test-"))

  // Create test fixture files
  await writeFile(join(tempDir, "guide.md"), "# Getting Started\nThis is a guide to OpenShift.")
  await writeFile(join(tempDir, "readme.txt"), "Project README\nSome details about the project.")
  await writeFile(join(tempDir, "config.json"), '{"name": "test-config"}')
  await writeFile(join(tempDir, "notes.md"), "# OpenShift Notes\nImportant notes about clusters.")
  await writeFile(join(tempDir, "ignored.py"), "print('should be ignored')")

  await mkdir(join(tempDir, "subdir"), { recursive: true })
  await writeFile(join(tempDir, "subdir", "nested.md"), "# Nested Document\nNested content here.")
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("createLocalSearchIndex", () => {
  it("build() indexes files correctly", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })
    await index.build()

    // Should index .txt, .md, .json but not .py
    expect(index.count()).toBe(5)
  })

  it("search() returns ranked results with higher score first", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })
    // "nested" matches filename nested.md (title "Nested Document" + filename)
    // "notes" matches filename notes.md (title "OpenShift Notes" + filename)
    // "nested document" should score higher because both words match title
    const results = await index.search("nested document")

    expect(results.length).toBeGreaterThanOrEqual(1)
    // The nested.md result should have the highest score (both keywords match title+filename)
    expect(results[0]!.filePath).toBe("subdir/nested.md")
    // Results should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score)
    }
  })

  it("search() is case-insensitive", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })

    const upper = await index.search("OPENSHIFT")
    const lower = await index.search("openshift")
    const mixed = await index.search("OpenShift")

    expect(upper.length).toBe(lower.length)
    expect(upper.length).toBe(mixed.length)
    expect(upper.length).toBeGreaterThan(0)
  })

  it("search() with no matches returns empty array", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })
    const results = await index.search("zzzznonexistent")

    expect(results).toEqual([])
  })

  it("search() with empty query returns empty array", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })
    const results = await index.search("   ")

    expect(results).toEqual([])
  })

  it("getContent() reads file content", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })
    const content = await index.getContent("guide.md")

    expect(content).toContain("Getting Started")
    expect(content).toContain("OpenShift")
  })

  it("getContent() rejects path traversal", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })

    await expect(index.getContent("../../etc/passwd")).rejects.toThrow(
      "Path traversal detected",
    )
  })

  it("getContent() rejects path traversal with absolute path escape", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })

    await expect(index.getContent("../../../etc/passwd")).rejects.toThrow(
      "Path traversal detected",
    )
  })

  it("count() returns correct number of indexed files", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })
    expect(index.count()).toBe(0)

    await index.build()
    expect(index.count()).toBe(5)
  })

  it("empty directory returns 0 count", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "local-search-empty-"))
    try {
      const index = createLocalSearchIndex({ basePath: emptyDir })
      await index.build()
      expect(index.count()).toBe(0)
    } finally {
      await rm(emptyDir, { recursive: true, force: true })
    }
  })

  it("respects extensions filter", async () => {
    const index = createLocalSearchIndex({
      basePath: tempDir,
      extensions: [".json"],
    })
    await index.build()

    expect(index.count()).toBe(1)
  })

  it("limit parameter caps results", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })
    await index.build()

    // Search for something that matches multiple files
    const allResults = await index.search("e", 100)
    const limited = await index.search("e", 2)

    expect(allResults.length).toBeGreaterThan(2)
    expect(limited.length).toBe(2)
  })

  it("extracts title from first line with markdown heading stripped", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })
    const results = await index.search("getting started")

    const guideResult = results.find((r) => r.filePath === "guide.md")
    expect(guideResult).toBeDefined()
    expect(guideResult!.title).toBe("Getting Started")
  })

  it("lazy-builds index on first search() call", async () => {
    const index = createLocalSearchIndex({ basePath: tempDir })

    // Should be 0 before any search
    expect(index.count()).toBe(0)

    // search() should trigger build
    await index.search("guide")

    expect(index.count()).toBe(5)
  })
})
