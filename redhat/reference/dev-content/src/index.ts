import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { stripHtml } from "tinycode-plugin-redhat-shared/html"
import { z } from "zod"

const BASE_URL = "https://developers.redhat.com"

const TOPICS = [
  "kubernetes", "containers", "kubernetes/operators",
  "automation", "devops", "devsecops", "ansible-automation-applications-and-services", "ci-cd",
  "enterprise-java", "python", "go", "rust", "nodejs", "dotnet",
  "gitops", "developer-productivity", "developer-tools",
  "observability", "microservices", "serverless", "event-driven", "api-management",
  "security", "secure-coding",
  "ai-ml", "data-science", "kafka-kubernetes",
  "linux", "virtualization", "edge-computing", "databases",
] as const

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Accept: "text/html",
      "User-Agent": "tinycode-plugin-dev-content/0.1.0",
    },
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`)
  }
  return res.text()
}

interface ArticleLink {
  title: string
  url: string
  date?: string
  author?: string
}

function parseTopicPage(html: string): ArticleLink[] {
  const articles: ArticleLink[] = []
  const linkPattern = /<a[^>]*href="(\/articles\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = linkPattern.exec(html)) !== null) {
    const url = match[1]!
    const title = stripHtml(match[2]!)
    if (title.length > 10 && !articles.some((a) => a.url === url)) {
      articles.push({ title, url: `${BASE_URL}${url}` })
    }
  }
  return articles
}

function parseRssFeed(xml: string): ArticleLink[] {
  const articles: ArticleLink[] = []
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null

  while ((match = itemPattern.exec(xml)) !== null) {
    const item = match[1]!
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      ?? item.match(/<title>(.*?)<\/title>/)?.[1]
      ?? "Untitled"
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? ""
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]
    const creator = item.match(/<dc:creator><!\[CDATA\[(.*?)\]\]><\/dc:creator>/)?.[1]
      ?? item.match(/<dc:creator>(.*?)<\/dc:creator>/)?.[1]

    if (link) {
      articles.push({
        title: stripHtml(title),
        url: link,
        date: pubDate ? new Date(pubDate).toISOString().split("T")[0] : undefined,
        author: creator,
      })
    }
  }
  return articles
}

function extractArticleContent(html: string): string {
  const bodyMatch = html.match(
    /<div[^>]*class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i,
  )
  if (bodyMatch) {
    return stripHtml(bodyMatch[1]!)
  }

  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  if (mainMatch) {
    return stripHtml(mainMatch[1]!)
  }

  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  if (articleMatch) {
    return stripHtml(articleMatch[1]!)
  }

  return stripHtml(html).slice(0, 5000)
}

function extractArticleMeta(html: string): { title: string; author?: string; date?: string } {
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1]
    ?? html.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1]
    ?? "Untitled"
  const author = html.match(/<meta[^>]*name="author"[^>]*content="([^"]+)"/i)?.[1]
  const date = html.match(/<meta[^>]*property="article:published_time"[^>]*content="([^"]+)"/i)?.[1]
    ?? html.match(/<time[^>]*datetime="([^"]+)"/i)?.[1]

  return {
    title: stripHtml(title),
    author,
    date: date?.split("T")[0],
  }
}

function formatArticleLink(a: ArticleLink): string {
  const parts = [a.title, a.url]
  if (a.date) parts.push(`Date: ${a.date}`)
  if (a.author) parts.push(`Author: ${a.author}`)
  return parts.join(" | ")
}

function createTools(): Record<string, ToolDefinition> {
  return {
    rh_dev_search: {
      description:
        "Browse Red Hat developer articles by topic. Available topics include: kubernetes, containers, ai-ml, python, go, rust, nodejs, enterprise-java, security, devops, gitops, automation, microservices, and more.",
      args: {
        topic: z.string().describe(
          "Topic slug (e.g., kubernetes, ai-ml, python, containers, security, devops, gitops, enterprise-java)",
        ),
        page: z.number().optional().describe("Page number (default 1, 25 articles per page)"),
      },
      async execute(args: { topic: string; page?: number }) {
        try {
          const topic = args.topic.toLowerCase()
          if (!TOPICS.includes(topic as (typeof TOPICS)[number])) {
            return `Unknown topic "${topic}". Available topics: ${TOPICS.join(", ")}`
          }
          const page = args.page ?? 1
          const url = `${BASE_URL}/topics/${topic}/all?page=${page}`
          const html = await fetchHtml(url)
          const articles = parseTopicPage(html)

          if (articles.length === 0) {
            return `No articles found for topic "${topic}" on page ${page}.`
          }
          return `Articles on "${topic}" (page ${page}):\n` + articles.map(formatArticleLink).join("\n")
        } catch (error) {
          return `Search failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rh_dev_article: {
      description:
        "Read the full content of a Red Hat developer article by URL. Returns the article title, metadata, and body text.",
      args: {
        url: z.string().describe("Full URL of the article (e.g., https://developers.redhat.com/articles/2026/...)"),
      },
      async execute(args: { url: string }) {
        try {
          const html = await fetchHtml(args.url)
          const meta = extractArticleMeta(html)
          const content = extractArticleContent(html)

          const header = [`# ${meta.title}`]
          if (meta.author) header.push(`Author: ${meta.author}`)
          if (meta.date) header.push(`Date: ${meta.date}`)
          header.push("")

          const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n\n[Content truncated]" : content
          return header.join("\n") + truncated
        } catch (error) {
          return `Failed to read article: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rh_dev_recent: {
      description:
        "Get the most recent Red Hat developer articles from the RSS feed. Returns titles, URLs, dates, and authors.",
      args: {
        limit: z.number().optional().describe("Number of articles to return (default 10, max 25)"),
      },
      async execute(args: { limit?: number }) {
        try {
          const xml = await fetchHtml(`${BASE_URL}/blog/feed/`)
          const articles = parseRssFeed(xml)
          const limited = articles.slice(0, Math.min(args.limit ?? 10, 25))

          if (limited.length === 0) {
            return "No recent articles found."
          }
          return `Recent Red Hat developer articles:\n` + limited.map(formatArticleLink).join("\n")
        } catch (error) {
          return `Failed to fetch recent articles: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export default {
  server: async (): Promise<Hooks> => ({
    tool: createTools(),
  }),
} satisfies PluginModule
