import { describe, expect, test } from "bun:test"
import { stripHtml } from "../src/html"

describe("stripHtml", () => {
  test("removes basic HTML tags", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world")
  })

  test("removes nested tags", () => {
    expect(stripHtml("<div><span><a href='#'>link</a></span></div>")).toBe("link")
  })

  test("removes script tags and content", () => {
    expect(stripHtml("before<script>alert('xss')</script>after")).toBe("beforeafter")
  })

  test("removes style tags and content", () => {
    expect(stripHtml("before<style>.a { color: red; }</style>after")).toBe("beforeafter")
  })

  test("decodes HTML entities", () => {
    expect(stripHtml("&amp; &lt; &gt; &quot; &#39; &nbsp;")).toBe('& < > " \'')
  })

  test("collapses whitespace", () => {
    expect(stripHtml("<p>  lots   of    space  </p>")).toBe("lots of space")
  })

  test("returns empty string for empty input", () => {
    expect(stripHtml("")).toBe("")
  })

  test("passes through plain text unchanged", () => {
    expect(stripHtml("no html here")).toBe("no html here")
  })

  test("handles multiline HTML", () => {
    const html = `<div>
      <h1>Title</h1>
      <p>Paragraph</p>
    </div>`
    expect(stripHtml(html)).toBe("Title Paragraph")
  })
})
