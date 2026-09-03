import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  parseGitRemoteUrl,
  detectProvider,
  createProvider,
} from "../src/provider-factory"
import { GiteaProvider } from "../src/providers/gitea"
import { GitHubProvider } from "../src/providers/github"
import { GitLabProvider } from "../src/providers/gitlab"

describe("parseGitRemoteUrl", () => {
  it("parses HTTPS format", () => {
    const result = parseGitRemoteUrl("https://github.com/owner/repo.git")
    expect(result).toEqual({ host: "github.com", owner: "owner", repo: "repo" })
  })

  it("parses HTTPS without .git suffix", () => {
    const result = parseGitRemoteUrl("https://github.com/owner/repo")
    expect(result).toEqual({ host: "github.com", owner: "owner", repo: "repo" })
  })

  it("parses SSH colon format", () => {
    const result = parseGitRemoteUrl("git@github.com:owner/repo.git")
    expect(result).toEqual({ host: "github.com", owner: "owner", repo: "repo" })
  })

  it("parses SSH slash format", () => {
    const result = parseGitRemoteUrl(
      "ssh://git@gitlab.com/owner/repo.git",
    )
    expect(result).toEqual({
      host: "gitlab.com",
      owner: "owner",
      repo: "repo",
    })
  })

  it("parses GitLab nested group HTTPS", () => {
    const result = parseGitRemoteUrl(
      "https://gitlab.com/group/subgroup/project.git",
    )
    expect(result).toEqual({
      host: "gitlab.com",
      owner: "group/subgroup",
      repo: "project",
    })
  })

  it("parses GitLab nested group SSH", () => {
    const result = parseGitRemoteUrl(
      "git@gitlab.com:group/subgroup/project.git",
    )
    expect(result).toEqual({
      host: "gitlab.com",
      owner: "group/subgroup",
      repo: "project",
    })
  })

  it("parses self-hosted URL", () => {
    const result = parseGitRemoteUrl(
      "https://gitea.example.com/owner/repo.git",
    )
    expect(result).toEqual({
      host: "gitea.example.com",
      owner: "owner",
      repo: "repo",
    })
  })

  it("returns null for invalid URL", () => {
    const result = parseGitRemoteUrl("not-a-url")
    expect(result).toBeNull()
  })
})

describe("detectProvider", () => {
  it("PILOT_PROVIDER=github overrides URL", () => {
    expect(
      detectProvider("https://gitlab.com/owner/repo.git", "github"),
    ).toBe("github")
  })

  it("PILOT_PROVIDER=gitlab overrides URL", () => {
    expect(
      detectProvider("https://github.com/owner/repo.git", "gitlab"),
    ).toBe("gitlab")
  })

  it("PILOT_PROVIDER=gitea overrides URL", () => {
    expect(
      detectProvider("https://github.com/owner/repo.git", "gitea"),
    ).toBe("gitea")
  })

  it("detects github.com host", () => {
    expect(
      detectProvider("https://github.com/owner/repo.git"),
    ).toBe("github")
  })

  it("detects gitlab.com host", () => {
    expect(
      detectProvider("https://gitlab.com/owner/repo.git"),
    ).toBe("gitlab")
  })

  it("defaults to gitea for unknown host", () => {
    expect(
      detectProvider("https://gitea.example.com/owner/repo.git"),
    ).toBe("gitea")
  })

  it("defaults to gitea when URL is null", () => {
    expect(detectProvider(null)).toBe("gitea")
  })
})

describe("createProvider", () => {
  const savedProvider = process.env.PILOT_PROVIDER
  const savedGiteaToken = process.env.GITEA_TOKEN
  const savedGithubToken = process.env.GITHUB_TOKEN
  const savedGhToken = process.env.GH_TOKEN
  const savedGitlabToken = process.env.GITLAB_TOKEN

  beforeEach(() => {
    delete process.env.PILOT_PROVIDER
    process.env.GITEA_TOKEN = "test"
    process.env.GITHUB_TOKEN = "test"
    process.env.GITLAB_TOKEN = "test"
  })

  afterEach(() => {
    if (savedProvider !== undefined) process.env.PILOT_PROVIDER = savedProvider
    else delete process.env.PILOT_PROVIDER
    if (savedGiteaToken !== undefined) process.env.GITEA_TOKEN = savedGiteaToken
    else delete process.env.GITEA_TOKEN
    if (savedGithubToken !== undefined) process.env.GITHUB_TOKEN = savedGithubToken
    else delete process.env.GITHUB_TOKEN
    if (savedGhToken !== undefined) process.env.GH_TOKEN = savedGhToken
    else delete process.env.GH_TOKEN
    if (savedGitlabToken !== undefined) process.env.GITLAB_TOKEN = savedGitlabToken
    else delete process.env.GITLAB_TOKEN
  })

  it("returns GitHubProvider when git remote is github.com", async () => {
    const mock$ = Object.assign(
      (strings: TemplateStringsArray) => ({
        quiet: () => ({
          nothrow: () => ({
            text: async () => "https://github.com/owner/repo.git\n",
          }),
        }),
      }),
    ) as unknown as Parameters<typeof createProvider>[0]

    const provider = await createProvider(mock$)
    expect(provider).toBeInstanceOf(GitHubProvider)
  })

  it("returns GiteaProvider when git remote fails", async () => {
    const mock$ = Object.assign(
      (strings: TemplateStringsArray) => ({
        quiet: () => ({
          nothrow: () => ({
            text: async () => "",
          }),
        }),
      }),
    ) as unknown as Parameters<typeof createProvider>[0]

    const provider = await createProvider(mock$)
    expect(provider).toBeInstanceOf(GiteaProvider)
  })

  it("PILOT_PROVIDER=gitlab overrides git remote", async () => {
    process.env.PILOT_PROVIDER = "gitlab"

    const mock$ = Object.assign(
      (strings: TemplateStringsArray) => ({
        quiet: () => ({
          nothrow: () => ({
            text: async () => "https://github.com/owner/repo.git\n",
          }),
        }),
      }),
    ) as unknown as Parameters<typeof createProvider>[0]

    const provider = await createProvider(mock$)
    expect(provider).toBeInstanceOf(GitLabProvider)
  })

  it("returns GiteaProvider when $ is undefined", async () => {
    const provider = await createProvider(undefined)
    expect(provider).toBeInstanceOf(GiteaProvider)
  })
})
